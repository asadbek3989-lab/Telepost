import React, { useMemo, useState } from 'react';
import { AlertCircle, Calendar, CheckCircle2, Clock, Copy, ExternalLink, Eye, FileText, MessageSquare, Pencil, RefreshCw, Search, Send, Trash2, Bot } from 'lucide-react';
import type { Channel, Post, PostFull } from '../../shared/types';
import { api, confirmDialog, openLink } from '../lib/api';
import { fmtDateTime } from '../lib/time';
import { htmlToPlain } from '../../shared/telegramHtml';
import { Notice, NoticeState, Spinner, templateLabel } from './ui';
import { TelegramPostPreview } from './TelegramPostPreview';

interface Props {
  channel: Channel;
  posts: Post[];
  onRefresh: () => void;
  onEdit: (post: PostFull) => void;
}

type Filter = 'all' | 'scheduled' | 'sent' | 'draft' | 'failed';

export const PostManager: React.FC<Props> = ({ channel, posts, onRefresh, onEdit }) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [preview, setPreview] = useState<PostFull | null>(null);

  const counts = useMemo(
    () => ({
      all: posts.length,
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      sent: posts.filter((p) => p.status === 'sent').length,
      draft: posts.filter((p) => p.status === 'draft').length,
      failed: posts.filter((p) => p.status === 'failed').length,
    }),
    [posts]
  );

  const list = useMemo(() => {
    let out = posts.filter((p) => (filter === 'all' ? true : filter === 'draft' ? p.status === 'draft' || p.status === 'sending' : p.status === filter));
    if (q.trim()) {
      const s = q.toLowerCase();
      out = out.filter((p) => p.topic.toLowerCase().includes(s) || htmlToPlain(p.text).toLowerCase().includes(s));
    }
    if (filter === 'scheduled') out = [...out].sort((a, b) => (a.scheduledFor || '').localeCompare(b.scheduledFor || ''));
    return out;
  }, [posts, filter, q]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setNotice(null);
    try {
      await fn();
    } catch (e: any) {
      setNotice({ type: 'error', message: e?.message || 'Xatolik' });
      onRefresh();
    } finally {
      setBusyId(null);
    }
  };

  const loadFull = async (id: string) => (await api<{ post: PostFull }>(`/posts/${id}`)).post;

  const send = (p: Post) =>
    run(p.id, async () => {
      const msg = p.status === 'sent' ? 'Bu post kanalga qaytadan (yangi xabar bo\'lib) yuborilsinmi?' : `«${channel.title}» kanaliga hoziroq yuborilsinmi?`;
      if (!(await confirmDialog(msg))) return;
      await api(`/posts/${p.id}/send`, { method: 'POST' });
      setNotice({ type: 'success', message: 'Post kanalga yuborildi!' });
      setPreview(null);
      onRefresh();
    });

  const remove = (p: Post) =>
    run(p.id, async () => {
      if (!(await confirmDialog("Postni ilovadan o'chirasizmi?"))) return;
      let fromChannel = false;
      if (p.status === 'sent' && p.messageId) fromChannel = await confirmDialog("Kanaldan ham o'chirilsinmi? (OK = ha, kanaldan ham o'chadi)");
      await api(`/posts/${p.id}${fromChannel ? '?fromChannel=1' : ''}`, { method: 'DELETE' });
      setPreview(null);
      onRefresh();
    });

  const duplicate = (p: Post) =>
    run(p.id, async () => {
      const r = await api<{ post: Post }>(`/posts/${p.id}/duplicate`, { method: 'POST' });
      const full = await loadFull(r.post.id);
      onRefresh();
      onEdit(full);
    });

  const edit = (p: Post) =>
    run(p.id, async () => {
      onEdit(await loadFull(p.id));
    });

  const openPreview = (p: Post) =>
    run(p.id, async () => {
      setPreview(await loadFull(p.id));
    });

  const badge = (p: Post) => {
    const base = 'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border';
    if (p.status === 'sent') return <span className={`${base} bg-emerald-500/10 text-emerald-400 border-emerald-500/30`}><CheckCircle2 className="w-3 h-3" /> Yuborildi</span>;
    if (p.status === 'scheduled') return <span className={`${base} bg-sky-500/10 text-sky-400 border-sky-500/30`}><Clock className="w-3 h-3" /> Rejada</span>;
    if (p.status === 'sending') return <span className={`${base} bg-amber-500/10 text-amber-300 border-amber-500/30`}><Spinner className="w-3 h-3" /> Yuborilmoqda</span>;
    if (p.status === 'failed') return <span className={`${base} bg-red-500/10 text-red-400 border-red-500/30`}><AlertCircle className="w-3 h-3" /> Xatolik</span>;
    if (p.awaiting) return <span className={`${base} bg-amber-500/10 text-amber-300 border-amber-500/30`}><Bot className="w-3 h-3" /> Tasdiq kutmoqda</span>;
    return <span className={`${base} bg-slate-500/10 text-slate-400 border-slate-700`}>Qoralama</span>;
  };

  const tabs: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Barchasi' },
    { id: 'scheduled', label: 'Rejada' },
    { id: 'sent', label: 'Yuborilgan' },
    { id: 'draft', label: 'Qoralama' },
    { id: 'failed', label: 'Xato' },
  ];

  return (
    <div className="space-y-5">
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-sky-400" /> Reja va tarix
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {counts.all} ta post • {counts.scheduled} tasi navbatda
          </p>
        </div>
        <button onClick={onRefresh} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-1.5 border border-slate-700">
          <RefreshCw className="w-3.5 h-3.5" /> Yangilash
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 bg-slate-900/80 border border-slate-800 p-2.5 rounded-2xl">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 ${filter === t.id ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}`}
            >
              {t.label}
              <span className={`text-[10px] px-1.5 rounded-full ${filter === t.id ? 'bg-white/20' : 'bg-slate-800 text-slate-400'}`}>{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:min-w-[200px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish..." className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />
        </div>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-14 bg-slate-900/50 border border-slate-800/80 rounded-3xl space-y-3">
          <MessageSquare className="w-11 h-11 text-slate-600 mx-auto" />
          <h3 className="text-base font-semibold text-slate-300">Post topilmadi</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">Bu toifada postlar yo'q. «Post yaratish» yoki «Kontent reja» bo'limidan boshlang.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((p) => {
            const loading = busyId === p.id;
            const editable = p.status !== 'sent' && p.status !== 'sending';
            return (
              <div key={p.id} className="bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center">
                    {p.thumb ? (
                      <img src={p.thumb} alt="" className="w-full h-full object-cover" />
                    ) : p.mediaType === 'file' ? (
                      <FileText className="w-6 h-6 text-amber-400" />
                    ) : p.mediaType === 'image' ? (
                      <span className="text-xl">🖼</span>
                    ) : (
                      <span className="text-xl">📝</span>
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badge(p)}
                      {p.source === 'autopilot' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">🤖 avtopilot</span>}
                      <span className="text-[11px] text-slate-500">{templateLabel(p.templateType)}</span>
                    </div>
                    <h4 className="text-sm font-bold text-white truncate">{p.topic}</h4>
                    <p className="text-xs text-slate-400 line-clamp-2">{htmlToPlain(p.text)}</p>
                    <div className="text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
                      {p.status === 'scheduled' && p.scheduledFor && <span className="text-sky-400 font-mono">⏱ {fmtDateTime(p.scheduledFor)}</span>}
                      {p.status === 'sent' && p.sentAt && <span>Yuborildi: {fmtDateTime(p.sentAt)}</span>}
                      {p.link && (
                        <button onClick={() => openLink(p.link!)} className="text-sky-400 hover:underline flex items-center gap-0.5">
                          Kanalda ochish <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {p.error && <p className="text-xs text-red-400 flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {p.error}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 justify-end flex-wrap border-t md:border-t-0 pt-3 md:pt-0 border-slate-800">
                  <button onClick={() => openPreview(p)} disabled={loading} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400" title="Preview"><Eye className="w-4 h-4" /></button>
                  {editable && <button onClick={() => edit(p)} disabled={loading} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200" title="Tahrirlash"><Pencil className="w-4 h-4" /></button>}
                  <button onClick={() => duplicate(p)} disabled={loading} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200" title="Nusxa olish"><Copy className="w-4 h-4" /></button>
                  {p.status !== 'sending' && (
                    <button onClick={() => send(p)} disabled={loading} className="px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
                      {loading ? <Spinner className="w-3.5 h-3.5" /> : p.status === 'sent' ? <RefreshCw className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                      <span>{p.status === 'sent' ? 'Qayta' : 'Yuborish'}</span>
                    </button>
                  )}
                  <button onClick={() => remove(p)} disabled={loading} className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400" title="O'chirish"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn overflow-y-auto" onClick={() => setPreview(null)}>
          <div className="w-full max-w-lg space-y-3 my-auto" onClick={(e) => e.stopPropagation()}>
            <TelegramPostPreview post={preview} channelTitle={channel.title} channelUsername={channel.username ? `@${channel.username}` : ''} />
            <div className="flex justify-end gap-2">
              {preview.status !== 'sent' && (
                <button onClick={() => send(preview)} className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Kanalga yuborish
                </button>
              )}
              <button onClick={() => setPreview(null)} className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium">Yopish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
