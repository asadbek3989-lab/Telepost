import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Calendar, Clock, Dices, FileText, Image as ImageIcon, MessageSquare, Pencil, RefreshCw, Save, Send, Sparkles, Upload, Wand2 } from 'lucide-react';
import type { Channel, CtaButton, FileData, Post, PostFull } from '../../shared/types';
import { plainLength } from '../../shared/telegramHtml';
import { api, confirmDialog, haptic } from '../lib/api';
import { compressImage, makeCoverCard, makeThumb } from '../lib/image';
import { inMinutes, localInputToIso, toLocalInput, tomorrowAt } from '../lib/time';
import { Card, inputCls, LANGUAGES, Notice, NoticeState, Spinner, TEMPLATES, TONES } from './ui';
import { TelegramPostPreview } from './TelegramPostPreview';

interface Props {
  channel: Channel;
  editPost: PostFull | null;
  onClearEdit: () => void;
  onSaved: (post: Post) => void;
  onGoManage: () => void;
}

interface Draft {
  text: string;
  topic: string;
  templateType: string;
  imageData?: string;
  thumb?: string;
  imageDirty: boolean;
  fileData?: FileData;
  fileDirty: boolean;
  cta?: CtaButton;
  hasTgImage?: boolean;
}

type MediaChoice = 'ai-image' | 'upload' | 'ai-file' | 'none';

const QUICK = [
  "2026-yilda eng talabgir kasblar va ko'nikmalar",
  "Vaqtni boshqarish: Pomodoro va time-blocking",
  "Telegram kanalda post yozishda 5 ta xato",
  "Biznes uchun sun'iy intellekt vositalari",
];

const REWRITES = [
  { id: 'hook', label: '🎣 Kuchli ilgak' },
  { id: 'shorten', label: '✂️ Qisqartir' },
  { id: 'expand', label: '📖 Kengaytir' },
  { id: 'emoji', label: '😊 Emoji' },
  { id: 'fix', label: '✅ Imlo' },
];

export const PostCreator: React.FC<Props> = ({ channel, editPost, onClearEdit, onSaved, onGoManage }) => {
  const [template, setTemplate] = useState('educational');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState(channel.tone);
  const [language, setLanguage] = useState(channel.language);
  const [media, setMedia] = useState<MediaChoice>('ai-image');
  const [imagePrompt, setImagePrompt] = useState('');
  const [ratio, setRatio] = useState<'1:1' | '16:9' | '4:3'>('1:1');
  const [filePrompt, setFilePrompt] = useState('');
  const [includeSignature, setIncludeSignature] = useState(true);
  const [includeCta, setIncludeCta] = useState(false);
  const [ctaText, setCtaText] = useState("Batafsil");
  const [ctaUrl, setCtaUrl] = useState(channel.username ? `https://t.me/${channel.username}` : '');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ bestTime?: string; tip?: string; readingTime?: string } | null>(null);

  const [busy, setBusy] = useState<null | 'post' | 'image' | 'file' | 'submit' | 'rewrite'>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [when, setWhen] = useState(() => toLocalInput(inMinutes(120)));
  const fileInput = useRef<HTMLInputElement>(null);

  // Kanal almashganda standartlarni yangilaymiz
  useEffect(() => {
    setTone(channel.tone);
    setLanguage(channel.language);
    setCtaUrl(channel.username ? `https://t.me/${channel.username}` : '');
  }, [channel.id]);

  // Tahrirlash rejimi
  useEffect(() => {
    if (!editPost) return;
    setEditingId(editPost.id);
    setTopic(editPost.topic);
    setTemplate(editPost.templateType || 'custom');
    setDraft({
      text: editPost.text,
      topic: editPost.topic,
      templateType: editPost.templateType,
      imageData: editPost.imageData,
      thumb: editPost.thumb,
      imageDirty: false,
      fileData: editPost.fileData,
      fileDirty: false,
      cta: editPost.cta,
      hasTgImage: editPost.mediaType === 'image' && !editPost.imageData,
    });
    if (editPost.scheduledFor) setWhen(toLocalInput(new Date(editPost.scheduledFor)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [editPost]);

  const fail = (e: any) => {
    haptic('error');
    setNotice({ type: 'error', message: e?.message || 'Xatolik yuz berdi' });
  };
  const ok = (message: string) => {
    haptic('success');
    setNotice({ type: 'success', message });
  };

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...(d || { text: '', topic, templateType: template, imageDirty: false, fileDirty: false }), ...patch }));

  const mediaType: Post['mediaType'] = draft?.imageData || draft?.hasTgImage ? 'image' : draft?.fileData ? 'file' : 'none';

  const resetAll = () => {
    setDraft(null);
    setEditingId(null);
    setMeta(null);
    onClearEdit();
  };

  async function attachImage(prompt: string, titleForCard: string) {
    setBusy('image');
    try {
      const r = await api<{ imageUrl: string }>('/ai/image', { body: { prompt, aspectRatio: ratio } });
      const img = await compressImage(r.imageUrl);
      update({ imageData: img, thumb: await makeThumb(img), imageDirty: true, hasTgImage: false });
    } catch (e: any) {
      const card = makeCoverCard(titleForCard, channel.title, ratio);
      update({ imageData: card, thumb: await makeThumb(card), imageDirty: true, hasTgImage: false });
      setNotice({ type: 'error', message: `AI rasm chizilmadi (${e?.message}). O'rniga sarlavhali muqova qo'yildi.` });
    } finally {
      setBusy(null);
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) return fail(new Error('Faqat rasm faylini tanlang'));
    try {
      const img = await compressImage(f);
      update({ imageData: img, thumb: await makeThumb(img), imageDirty: true, hasTgImage: false });
      setMedia('upload');
    } catch (err) {
      fail(err);
    }
  };

  async function generate(auto = false) {
    if (!auto && !topic.trim()) return fail(new Error("Avval mavzu yozing yoki 'AI mavzu tanlasin' tugmasini bosing"));
    setNotice(null);
    setBusy('post');
    try {
      const r = await api<{ data: any }>('/ai/post', {
        body: {
          channelId: channel.id,
          topic,
          auto,
          templateType: template,
          tone,
          language,
          hasImage: media === 'ai-image' || media === 'upload',
          wantFile: media === 'ai-file',
          fileRequest: filePrompt || topic,
          includeSignature,
        },
      });
      const d = r.data;
      setMeta({ bestTime: d.bestTime, tip: d.tip, readingTime: d.readingTime });
      const newTopic = auto ? d.title : topic;
      if (auto) setTopic(d.title);
      setImagePrompt(d.imagePrompt || '');
      setEditingId(null);
      onClearEdit();

      const keepUpload = media === 'upload' ? draft?.imageData : undefined;
      const next: Draft = {
        text: d.text,
        topic: newTopic,
        templateType: template,
        imageDirty: !!keepUpload,
        imageData: keepUpload,
        thumb: keepUpload ? draft?.thumb : undefined,
        fileDirty: false,
        cta: includeCta ? { text: ctaText || d.ctaText || 'Batafsil', url: ctaUrl || `https://t.me/${channel.username || ''}` } : undefined,
      };
      if (media === 'ai-file' && d.file) {
        next.fileData = { name: d.file.name, content: d.file.content, mimeType: d.file.mimeType, sizeBytes: new Blob([d.file.content]).size };
        next.fileDirty = true;
      }
      setDraft(next);
      if (media === 'ai-image') await attachImage(d.imagePrompt || newTopic, d.title || newTopic);
      else setBusy(null);
      ok('Post tayyor! Pastda ko\'rib chiqing, kerak bo\'lsa tahrirlang.');
    } catch (e) {
      setBusy(null);
      fail(e);
    }
  }

  async function genFileOnly() {
    const t = topic.trim() || draft?.topic || '';
    if (!t) return fail(new Error('Fayl uchun mavzu kerak'));
    setBusy('file');
    try {
      const r = await api<{ fileData: FileData }>('/ai/file', { body: { topic: t, instructions: filePrompt, language } });
      update({ fileData: r.fileData, fileDirty: true });
      ok(`"${r.fileData.name}" fayli tayyor va postga ulandi`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function rewrite(action: string) {
    if (!draft?.text) return;
    setBusy('rewrite');
    try {
      const r = await api<{ text: string }>('/ai/rewrite', { body: { text: draft.text, action } });
      update({ text: r.text });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  function buildPayload(status: 'draft' | 'scheduled' | 'sent', scheduledFor?: string) {
    const d = draft!;
    const body: Record<string, unknown> = {
      channelId: channel.id,
      topic: d.topic || topic || 'Nomsiz post',
      templateType: d.templateType || template,
      tone,
      language,
      text: d.text,
      cta: d.cta ?? null,
      status,
      scheduledFor,
    };
    if (!editingId || d.imageDirty) {
      body.imageData = d.imageData ?? null;
      body.thumb = d.thumb;
    }
    if (!editingId || d.fileDirty) body.fileData = d.fileData ?? null;
    return body;
  }

  async function submit(status: 'draft' | 'scheduled' | 'sent', scheduledFor?: string) {
    if (!draft || (!draft.text.trim() && mediaType === 'none')) return fail(new Error("Post matni bo'sh"));
    if (status === 'sent') {
      const okay = await confirmDialog(`Post hoziroq «${channel.title}» kanaliga yuborilsinmi?`);
      if (!okay) return;
    }
    setBusy('submit');
    setNotice(null);
    try {
      let post: Post;
      if (editingId) {
        const r = await api<{ post: Post }>(`/posts/${editingId}`, { method: 'PUT', body: buildPayload(status === 'sent' ? 'draft' : status, scheduledFor) });
        post = r.post;
        if (status === 'sent') post = (await api<{ post: Post }>(`/posts/${editingId}/send`, { method: 'POST' })).post;
      } else {
        post = (await api<{ post: Post }>('/posts', { body: buildPayload(status, scheduledFor) })).post;
      }
      onSaved(post);
      setShowSchedule(false);
      if (post.status === 'failed') {
        fail(new Error(`Yuborilmadi: ${post.error}. Bot kanalda admin ekanini va "Post Messages" huquqini tekshiring.`));
        return;
      }
      if (status === 'sent') ok(`🎉 Kanalga yuborildi!${post.link ? ' ' + post.link : ''}`);
      else if (status === 'scheduled') ok(`⏱️ ${new Date(scheduledFor!).toLocaleString('uz-UZ')} ga rejalashtirildi`);
      else ok('Qoralama saqlandi');
      if (status !== 'draft') resetAll();
      else if (!editingId) setEditingId(post.id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const len = draft ? plainLength(draft.text) : 0;
  const longWithMedia = mediaType !== 'none' && len > 1000;
  const disabledAll = busy !== null;

  const mediaBtn = (id: MediaChoice, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setMedia(id)}
      className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1.5 transition ${
        media === id ? 'bg-sky-500/20 border-sky-400 text-sky-300' : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="space-y-5 pb-12">
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {editingId && (
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <Pencil className="w-4 h-4" /> Mavjud postni tahrirlayapsiz
          </span>
          <button onClick={resetAll} className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white">
            Yangi post
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-7 space-y-5">
          <Card>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 block">Post turi</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTemplate(t.id);
                    if (t.sampleTopic && !topic) setTopic(t.sampleTopic);
                  }}
                  className={`p-2.5 rounded-2xl text-left border transition ${
                    template === t.id ? 'bg-gradient-to-br from-sky-500/20 to-indigo-500/10 border-sky-400' : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/80'
                  }`}
                >
                  <span className="text-xl block mb-1">{t.icon}</span>
                  <span className={`text-xs font-semibold leading-tight ${template === t.id ? 'text-sky-300' : 'text-slate-200'}`}>{t.title}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Wand2 className="w-4 h-4 text-sky-400" /> Mavzu yoki g'oya
              </label>
              <button
                onClick={() => generate(true)}
                disabled={disabledAll}
                className="text-xs px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 disabled:opacity-50"
                title={channel.niche ? 'AI kanal yo\'nalishiga mos yangi mavzu tanlaydi' : "Kanal yo'nalishini 'Kanallar' bo'limida kiriting — natija yaxshilanadi"}
              >
                <Dices className="w-3.5 h-3.5" /> AI mavzu tanlasin
              </button>
            </div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              placeholder="Masalan: Sun'iy intellekt 2026-yilda qaysi sohalarni eng ko'p o'zgartirishi haqida tahliliy post..."
              className={`${inputCls} resize-none leading-relaxed`}
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button key={q} onClick={() => setTopic(q)} className="text-xs px-2.5 py-1 rounded-full bg-slate-800 hover:bg-sky-500/20 hover:text-sky-300 text-slate-300 border border-slate-700/60 truncate max-w-[240px]">
                  + {q}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">Ohang</label>
                <select value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls}>
                  {TONES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.icon} {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">Til</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <ImageIcon className="w-4 h-4 text-sky-400" /> Media
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {mediaBtn('ai-image', <Sparkles className="w-4 h-4 text-sky-400" />, 'AI rasm')}
              {mediaBtn('upload', <Upload className="w-4 h-4 text-emerald-400" />, 'Rasm yuklash')}
              {mediaBtn('ai-file', <FileText className="w-4 h-4 text-amber-400" />, 'AI fayl')}
              {mediaBtn('none', <Bookmark className="w-4 h-4 text-slate-400" />, 'Faqat matn')}
            </div>

            {media === 'ai-image' && (
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">Nisbat:</span>
                  <div className="flex gap-1">
                    {(['1:1', '16:9', '4:3'] as const).map((r) => (
                      <button key={r} onClick={() => setRatio(r)} className={`px-2 py-0.5 rounded text-[11px] font-mono border ${ratio === r ? 'bg-sky-500 border-sky-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <input value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} placeholder="Rasm g'oyasi (bo'sh bo'lsa AI post asosida o'zi o'ylaydi)" className={`${inputCls} !py-2 text-xs`} />
                <button
                  onClick={() => attachImage(imagePrompt || draft?.topic || topic, draft?.topic || topic)}
                  disabled={disabledAll || !(imagePrompt || topic)}
                  className="px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-medium border border-sky-500/30 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {busy === 'image' ? <Spinner className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  <span>Alohida rasm chizish</span>
                </button>
              </div>
            )}

            {media === 'upload' && (
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800">
                <input ref={fileInput} type="file" accept="image/*" onChange={handleUpload} className="hidden" />
                <button onClick={() => fileInput.current?.click()} className="w-full border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-xl p-5 flex flex-col items-center gap-1 bg-slate-900/40">
                  <Upload className="w-7 h-7 text-sky-400" />
                  <span className="text-xs font-semibold text-slate-200">Galereya yoki kameradan rasm tanlash</span>
                  <span className="text-[11px] text-slate-500">Rasm avtomatik siqiladi</span>
                </button>
              </div>
            )}

            {media === 'ai-file' && (
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
                <input value={filePrompt} onChange={(e) => setFilePrompt(e.target.value)} placeholder="Masalan: 10 ta amaliy qadamdan iborat checklist" className={`${inputCls} !py-2 text-xs`} />
                <button onClick={genFileOnly} disabled={disabledAll} className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium border border-amber-500/30 flex items-center gap-1.5 disabled:opacity-50">
                  {busy === 'file' ? <Spinner className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                  <span>Faqat faylni yaratish</span>
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 space-y-3 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-200">Kanal imzosini qo'shish {channel.signature && <span className="text-slate-500">({channel.signature.slice(0, 28)})</span>}</span>
                <input type="checkbox" checked={includeSignature} onChange={(e) => setIncludeSignature(e.target.checked)} className="w-4 h-4" />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-200">Post ostiga havola tugmasi</span>
                <input type="checkbox" checked={includeCta} onChange={(e) => setIncludeCta(e.target.checked)} className="w-4 h-4" />
              </label>
              {includeCta && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Tugma matni" className={`${inputCls} !py-2 text-xs`} />
                  <input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://..." className={`${inputCls} !py-2 text-xs`} />
                </div>
              )}
            </div>
          </Card>

          <button
            onClick={() => generate(false)}
            disabled={disabledAll}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold shadow-xl shadow-sky-500/20 active:scale-[0.99] transition flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy === 'post' || busy === 'image' ? (
              <>
                <Spinner className="w-5 h-5" />
                <span>{busy === 'image' ? 'Rasm chizilmoqda...' : 'AI post yozmoqda...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                <span>AI orqali post yaratish</span>
              </>
            )}
          </button>
          {!draft && (
            <button onClick={() => setDraft({ text: '', topic: topic || 'Nomsiz post', templateType: template, imageDirty: false, fileDirty: false })} className="w-full text-xs text-slate-400 hover:text-sky-300 underline underline-offset-4">
              yoki matnni o'zim yozaman
            </button>
          )}
        </div>

        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-28">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 px-1">
            <MessageSquare className="w-4 h-4 text-sky-400" /> Jonli preview
          </h3>

          <TelegramPostPreview
            post={{ text: draft?.text || '', mediaType, imageData: draft?.imageData, fileData: draft?.fileData, cta: draft?.cta }}
            channelTitle={channel.title}
            channelUsername={channel.username ? `@${channel.username}` : ''}
            isEditable={!!draft}
            onTextChange={(text) => update({ text })}
            onImageRemove={() => update({ imageData: undefined, thumb: undefined, imageDirty: true, hasTgImage: false })}
            onFileRemove={() => update({ fileData: undefined, fileDirty: true })}
            onRegenerateImage={() => attachImage(imagePrompt || draft?.topic || topic, draft?.topic || topic)}
            busyImage={busy === 'image'}
          />

          {draft && (
            <>
              <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                <span className={len > 4096 ? 'text-red-400' : ''}>{len} / 4096 belgi</span>
                {meta?.readingTime && <span>⏱ {meta.readingTime}</span>}
              </div>
              {longWithMedia && <p className="text-[11px] text-amber-300/90 px-1">ℹ️ Matn 1000 belgidan uzun: media va matn Telegramda ikki alohida xabar bo'ladi.</p>}
              {(meta?.bestTime || meta?.tip) && (
                <div className="p-3 rounded-2xl bg-sky-500/5 border border-sky-500/20 text-xs text-slate-300 space-y-1">
                  {meta.bestTime && <p>🕒 Eng yaxshi vaqt: <b className="text-sky-300">{meta.bestTime}</b></p>}
                  {meta.tip && <p>💡 {meta.tip}</p>}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {REWRITES.map((r) => (
                  <button key={r.id} onClick={() => rewrite(r.id)} disabled={disabledAll || !draft.text} className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 border border-slate-700 disabled:opacity-50">
                    {busy === 'rewrite' ? '…' : r.label}
                  </button>
                ))}
                <select
                  value=""
                  onChange={(e) => e.target.value && rewrite(e.target.value)}
                  disabled={disabledAll || !draft.text}
                  className="px-2 py-1.5 rounded-lg bg-slate-800 text-[11px] text-slate-200 border border-slate-700"
                >
                  <option value="">🌐 Tarjima</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <Card className="!p-4 space-y-2.5">
            <div className="text-xs font-semibold text-slate-300 flex justify-between">
              <span>Amallar</span>
              <span className="text-sky-400 truncate max-w-[60%]">{channel.title}</span>
            </div>
            <button
              onClick={() => submit('sent')}
              disabled={disabledAll || !draft}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy === 'submit' ? <Spinner /> : <Send className="w-4 h-4" />}
              <span>Hoziroq yuborish</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setShowSchedule(true)} disabled={disabledAll || !draft} className="py-2.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 font-semibold text-xs border border-sky-500/30 flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Clock className="w-4 h-4" /> Rejalashtirish
              </button>
              <button onClick={() => submit('draft')} disabled={disabledAll || !draft} className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 flex items-center justify-center gap-1.5 disabled:opacity-50">
                <Save className="w-4 h-4" /> Qoralama
              </button>
            </div>
            <button onClick={onGoManage} className="w-full text-[11px] text-slate-400 hover:text-sky-300 flex items-center justify-center gap-1">
              <Calendar className="w-3 h-3" /> Reja va tarixni ko'rish
            </button>
          </Card>
        </div>
      </div>

      {showSchedule && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={() => setShowSchedule(false)}>
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-sky-400" /> Yuborish vaqti
            </h3>
            <p className="text-xs text-slate-400">Vaqt qurilmangiz soati bo'yicha. Belgilangan vaqtda post avtomatik yuboriladi.</p>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls} />
            <div className="flex flex-wrap gap-1.5">
              {[
                ['+10 daqiqa', () => inMinutes(10)],
                ['+1 soat', () => inMinutes(60)],
                ['Ertaga 09:00', () => tomorrowAt(9)],
                ['Ertaga 14:00', () => tomorrowAt(14)],
                ['Ertaga 19:00', () => tomorrowAt(19)],
              ].map(([label, fn]) => (
                <button key={label as string} onClick={() => setWhen(toLocalInput((fn as () => Date)()))} className="px-2.5 py-1 rounded-lg bg-slate-800 text-[11px] text-slate-300 hover:bg-slate-700">
                  {label as string}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowSchedule(false)} className="px-4 py-2 text-xs text-slate-400 hover:text-white">
                Bekor
              </button>
              <button
                onClick={() => submit('scheduled', localInputToIso(when))}
                disabled={busy === 'submit' || !when}
                className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy === 'submit' ? <Spinner className="w-3.5 h-3.5" /> : <Calendar className="w-4 h-4" />} Tasdiqlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
