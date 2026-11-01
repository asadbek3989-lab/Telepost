import React, { useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, Image as ImageIcon, Sparkles, XCircle } from 'lucide-react';
import type { Channel, PlanIdea, Post } from '../../shared/types';
import { api } from '../lib/api';
import { compressImage, makeCoverCard, makeThumb } from '../lib/image';
import { fmtDateTime } from '../lib/time';
import { Card, inputCls, Notice, NoticeState, Spinner, templateLabel, Toggle } from './ui';

interface Props {
  channel: Channel;
  onDone: () => void;
  onGoManage: () => void;
}

type ItemState = 'idle' | 'working' | 'done' | 'error';
interface Row extends PlanIdea {
  selected: boolean;
  state: ItemState;
  error?: string;
}

export const PlanView: React.FC<Props> = ({ channel, onDone, onGoManage }) => {
  const [days, setDays] = useState(7);
  const [perDay, setPerDay] = useState(1);
  const [focus, setFocus] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [running, setRunning] = useState(false);
  const [withImage, setWithImage] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const cancelRef = useRef(false);

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...p } : x)));

  async function makePlan() {
    setLoadingPlan(true);
    setNotice(null);
    try {
      const r = await api<{ ideas: PlanIdea[] }>('/ai/plan', { body: { channelId: channel.id, days, perDay, focus } });
      setRows(r.ideas.map((x) => ({ ...x, selected: true, state: 'idle' as ItemState })));
      if (!channel.niche) setNotice({ type: 'error', message: "Maslahat: «Kanallar» bo'limida kanal yo'nalishini yozsangiz, g'oyalar ancha aniq bo'ladi." });
    } catch (e: any) {
      setNotice({ type: 'error', message: e?.message });
    } finally {
      setLoadingPlan(false);
    }
  }

  async function runAll() {
    cancelRef.current = false;
    setRunning(true);
    setNotice(null);
    let okCount = 0;
    const snapshot = rows;
    for (let i = 0; i < snapshot.length; i++) {
      const row = snapshot[i];
      if (!row.selected || row.state === 'done') continue;
      if (cancelRef.current) break;
      patch(i, { state: 'working', error: undefined });
      try {
        const gen = await api<{ data: any }>('/ai/post', {
          body: { channelId: channel.id, topic: row.topic, templateType: row.templateType, hasImage: withImage, includeSignature: true },
        });
        let imageData: string | undefined;
        let thumb: string | undefined;
        if (withImage) {
          try {
            const img = await api<{ imageUrl: string }>('/ai/image', { body: { prompt: gen.data.imagePrompt || row.topic } });
            imageData = await compressImage(img.imageUrl);
          } catch {
            imageData = makeCoverCard(gen.data.title || row.topic, channel.title);
          }
          thumb = await makeThumb(imageData);
        }
        await api<{ post: Post }>('/posts', {
          body: {
            channelId: channel.id,
            topic: row.topic,
            templateType: row.templateType,
            text: gen.data.text,
            imageData,
            thumb,
            status: asDraft ? 'draft' : 'scheduled',
            scheduledFor: asDraft ? undefined : row.scheduledFor,
            source: 'plan',
          },
        });
        okCount++;
        patch(i, { state: 'done' });
      } catch (e: any) {
        patch(i, { state: 'error', error: e?.message || 'Xato' });
      }
    }
    setRunning(false);
    onDone();
    if (okCount > 0) setNotice({ type: 'success', message: `${okCount} ta post ${asDraft ? 'qoralama sifatida saqlandi' : 'rejalashtirildi'}. «Reja va tarix» bo'limida tahrirlashingiz mumkin.` });
  }

  const selectedCount = rows.filter((r) => r.selected && r.state !== 'done').length;
  const doneCount = rows.filter((r) => r.state === 'done').length;

  return (
    <div className="space-y-5 pb-10">
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-sky-400" /> Kontent reja
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">AI butun hafta uchun xilma-xil g'oyalar tuzadi, siz bir bosishda postlarni yozdirib, eng yaxshi vaqtlarga rejalashtirasiz.</p>
      </div>

      <Card className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">Necha kunga</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
              {[3, 5, 7, 10, 14].map((d) => (
                <option key={d} value={d}>{d} kun</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">Kuniga</label>
            <select value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className={inputCls}>
              <option value={1}>1 ta post (10:00)</option>
              <option value={2}>2 ta post (09:00, 19:00)</option>
              <option value={3}>3 ta post (09:00, 14:00, 19:00)</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">E'tibor qaratiladigan yo'nalish (ixtiyoriy)</label>
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Masalan: boshlovchilar uchun, yangi mahsulot lansmani, ramazon..." className={inputCls} />
        </div>
        <p className="text-[11px] text-slate-500">Vaqtlar kanal vaqt zonasida: <b>{channel.timezone}</b>. O'tib ketgan vaqtlar avtomatik o'tkazib yuboriladi.</p>
        <button
          onClick={makePlan}
          disabled={loadingPlan || running}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20 disabled:opacity-60"
        >
          {loadingPlan ? <><Spinner className="w-5 h-5" /> G'oyalar tuzilmoqda...</> : <><Sparkles className="w-5 h-5" /> AI reja tuzsin</>}
        </button>
      </Card>

      {rows.length > 0 && (
        <>
          <Card className="space-y-3 !p-4">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-300 flex items-center gap-1.5"><ImageIcon className="w-4 h-4 text-sky-400" /> Har postga rasm (AI yoki muqova)</span>
              <Toggle checked={withImage} onChange={setWithImage} label="Rasm bilan" />
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-300">Avtomatik yubormay, qoralama sifatida saqlash (o'zim ko'rib chiqaman)</span>
              <Toggle checked={asDraft} onChange={setAsDraft} label="Qoralama" />
            </div>
          </Card>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className={`p-3.5 rounded-2xl border flex items-start gap-3 ${r.state === 'done' ? 'bg-emerald-950/30 border-emerald-500/30' : r.state === 'error' ? 'bg-red-950/30 border-red-500/30' : 'bg-slate-900/80 border-slate-800'}`}>
                <input type="checkbox" checked={r.selected} disabled={running || r.state === 'done'} onChange={(e) => patch(i, { selected: e.target.checked })} className="mt-1.5 w-4 h-4" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md">{asDraft ? 'Qoralama' : fmtDateTime(r.scheduledFor, channel.timezone)}</span>
                    <span className="text-slate-400">{templateLabel(r.templateType)}</span>
                  </div>
                  <input value={r.topic} disabled={running || r.state === 'done'} onChange={(e) => patch(i, { topic: e.target.value })} className="w-full bg-transparent text-sm font-semibold text-white focus:outline-none focus:bg-slate-950/60 rounded px-1 -mx-1" />
                  {r.note && <p className="text-xs text-slate-400">{r.note}</p>}
                  {r.error && <p className="text-xs text-red-400">{r.error}</p>}
                </div>
                <div className="shrink-0 mt-1">
                  {r.state === 'working' && <Spinner className="w-4 h-4 text-sky-400" />}
                  {r.state === 'done' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  {r.state === 'error' && <XCircle className="w-5 h-5 text-red-400" />}
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-3 z-20">
            <div className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl p-3 flex items-center gap-3 shadow-2xl">
              <div className="text-xs text-slate-300 flex-1">
                {running ? 'Postlar yozilmoqda — ilovani yopmang...' : `${selectedCount} ta tanlangan${doneCount ? `, ${doneCount} ta tayyor` : ''}`}
              </div>
              {running ? (
                <button onClick={() => (cancelRef.current = true)} className="px-4 py-2.5 rounded-xl bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-semibold">To'xtatish</button>
              ) : doneCount > 0 && selectedCount === 0 ? (
                <button onClick={onGoManage} className="px-4 py-2.5 rounded-xl bg-sky-500 text-white text-xs font-bold">Rejani ko'rish</button>
              ) : (
                <button onClick={runAll} disabled={selectedCount === 0} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold disabled:opacity-50">
                  {asDraft ? 'Yozib qoralamaga saqlash' : 'Yozib rejalashtirish'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
