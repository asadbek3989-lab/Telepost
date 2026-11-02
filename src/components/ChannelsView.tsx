import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, ChevronUp, Plus, RefreshCw, Send, Settings, Trash2, Users, XCircle, AlertTriangle, LogOut, ShieldCheck } from 'lucide-react';
import type { Channel, SessionInfo } from '../../shared/types';
import { api, clearToken, confirmDialog, inTelegram } from '../lib/api';
import { timeAgo } from '../lib/time';
import { Card, inputCls, LANGUAGES, Notice, NoticeState, Spinner, TEMPLATES, TONES, Toggle } from './ui';

interface Props {
  channels: Channel[];
  session: SessionInfo;
  onChanged: () => void;
  onSelect: (id: string) => void;
  onLogout: () => void;
  onboarding?: boolean;
}

const ZONES = ['Asia/Tashkent', 'Asia/Almaty', 'Asia/Bishkek', 'Asia/Dushanbe', 'Asia/Ashgabat', 'Europe/Moscow', 'Europe/Istanbul', 'Asia/Dubai', 'Europe/Kyiv', 'Europe/London', 'UTC'];

const StatusRow: React.FC<{ ok: boolean | null; label: string; hint?: string }> = ({ ok, label, hint }) => (
  <div className="flex items-start gap-2 text-xs">
    {ok === null ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /> : ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
    <div>
      <span className="text-slate-200">{label}</span>
      {hint && <span className="text-slate-500"> — {hint}</span>}
    </div>
  </div>
);

const ChannelCard: React.FC<{ c: Channel; onChanged: () => void; onSelect: () => void; setNotice: (n: NoticeState) => void }> = ({ c, onChanged, onSelect, setNotice }) => {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(c);
  const [topicsText, setTopicsText] = useState(c.autopilot.topics.join('\n'));
  const [newTime, setNewTime] = useState('12:00');
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'refresh' | 'del'>(null);

  useEffect(() => {
    setF(c);
    setTopicsText(c.autopilot.topics.join('\n'));
  }, [c]);

  const ap = f.autopilot;
  const setAp = (p: Partial<Channel['autopilot']>) => setF({ ...f, autopilot: { ...ap, ...p } });

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string | void>) => {
    setBusy(kind);
    try {
      const msg = await fn();
      if (msg) setNotice({ type: 'success', message: msg });
    } catch (e: any) {
      setNotice({ type: 'error', message: e?.message || 'Xatolik' });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      await api(`/channels/${encodeURIComponent(c.id)}`, {
        method: 'PUT',
        body: {
          signature: f.signature,
          tone: f.tone,
          language: f.language,
          niche: f.niche,
          audience: f.audience,
          timezone: f.timezone,
          autopilot: { ...ap, topics: topicsText.split('\n').map((s) => s.trim()).filter(Boolean) },
        },
      });
      onChanged();
      return 'Sozlamalar saqlandi';
    });

  const toggleTemplate = (id: string) => setAp({ templates: ap.templates.includes(id) ? ap.templates.filter((t) => t !== id) : [...ap.templates, id] });

  return (
    <Card className="!p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center font-bold text-white shrink-0">{c.title.charAt(0).toUpperCase()}</div>
        <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
          <div className="font-bold text-white truncate">{c.title}</div>
          <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
            {c.username && <span className="text-sky-400">@{c.username}</span>}
            <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {c.memberCount.toLocaleString()}</span>
            <span className={c.autopilot.enabled ? 'text-emerald-400' : 'text-slate-500'}>🤖 {c.autopilot.enabled ? `avtopilot: ${c.autopilot.times.join(', ')}` : "avtopilot o'chiq"}</span>
          </div>
        </button>
        <button onClick={() => setOpen(!open)} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 text-xs">
          <Settings className="w-4 h-4" /> {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {open && (
        <div className="pt-3 border-t border-slate-800 space-y-4 text-xs animate-fadeIn">
          <div>
            <label className="font-semibold text-slate-300 mb-1.5 block">Kanal yo'nalishi va uslubi (AI shuni hisobga oladi)</label>
            <textarea value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} rows={3} placeholder="Masalan: Dasturlash va sun'iy intellekt haqida o'zbek tilida qisqa, amaliy maslahatlar. Ohang: do'stona, ortiqcha rasmiyatchiliksiz." className={`${inputCls} resize-none`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Auditoriya</label>
              <input value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="Talabalar, yosh dasturchilar..." className={inputCls} />
            </div>
            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Imzo (post oxiriga)</label>
              <input value={f.signature} onChange={(e) => setF({ ...f, signature: e.target.value })} placeholder="👉 @kanalim" className={inputCls} />
            </div>
            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Standart ohang</label>
              <select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} className={inputCls}>
                {TONES.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Standart til</label>
              <select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })} className={inputCls}>
                {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="font-semibold text-slate-300 mb-1.5 block">Vaqt zonasi (rejalar va avtopilot uchun)</label>
              <select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} className={inputCls}>
                {(ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]).map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5"><Bot className="w-4 h-4 text-indigo-300" /> Avtopilot</div>
                <p className="text-slate-400 mt-0.5">Belgilangan vaqtlarda AI o'zi post yozadi {ap.requireApproval ? 'va sizga tasdiqlash uchun yuboradi' : 'va kanalga yuboradi'}.</p>
              </div>
              <Toggle checked={ap.enabled} onChange={(v) => setAp({ enabled: v })} label="Avtopilot" />
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Kunlik vaqtlar ({f.timezone})</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {ap.times.map((t) => (
                  <button key={t} onClick={() => setAp({ times: ap.times.filter((x) => x !== t) })} className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 hover:border-red-500/50 hover:text-red-300">{t} ✕</button>
                ))}
                {ap.times.length === 0 && <span className="text-slate-500">Vaqt qo'shilmagan</span>}
              </div>
              <div className="flex gap-2">
                <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className={`${inputCls} !w-32 !py-2`} />
                <button onClick={() => newTime && !ap.times.includes(newTime) && setAp({ times: [...ap.times, newTime].sort() })} className="px-3 py-2 rounded-xl bg-sky-500/20 text-sky-300 border border-sky-500/30 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Qo'shish</button>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Mavzular (har qatorda bittadan, aylanma)</label>
              <textarea value={topicsText} onChange={(e) => setTopicsText(e.target.value)} rows={4} placeholder={"Bo'sh qoldirsangiz, AI kanal yo'nalishiga qarab har safar yangi mavzu tanlaydi.\nYoki o'zingiz yozing:\nPython boshlovchilar uchun\nKarerada o'sish sirlari"} className={`${inputCls} resize-none`} />
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1.5 block">Post turlari (aylanma)</label>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button key={t.id} onClick={() => toggleTemplate(t.id)} className={`px-2.5 py-1 rounded-lg border ${ap.templates.includes(t.id) ? 'bg-sky-500/20 border-sky-400 text-sky-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>{t.icon} {t.title}</button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3"><span className="text-slate-200">Har postga AI rasm</span><Toggle checked={ap.withImage} onChange={(v) => setAp({ withImage: v })} /></label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-200">Avval menga tasdiqlash uchun yuborish <span className="text-slate-500">(tavsiya etiladi)</span></span>
                <Toggle checked={ap.requireApproval} onChange={(v) => setAp({ requireApproval: v })} />
              </label>
            </div>
            <p className="text-[11px] text-slate-500">Avtopilot ishlashi uchun cron-job.org da har daqiqada /api/cron chaqirilishi kerak (README ga qarang).</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={save} disabled={busy !== null} className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold flex items-center gap-1.5 disabled:opacity-60">{busy === 'save' && <Spinner className="w-3.5 h-3.5" />} Saqlash</button>
            <button onClick={() => run('test', async () => { await api(`/channels/${encodeURIComponent(c.id)}/test`, { method: 'POST' }); return 'Sinov xabari kanalga yuborildi ✅'; })} disabled={busy !== null} className="px-4 py-2.5 rounded-xl bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5 disabled:opacity-60">{busy === 'test' ? <Spinner className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />} Sinov xabari</button>
            <button onClick={() => run('refresh', async () => { await api(`/channels/${encodeURIComponent(c.id)}/refresh`, { method: 'POST' }); onChanged(); return "Kanal ma'lumotlari yangilandi"; })} disabled={busy !== null} className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 flex items-center gap-1.5 disabled:opacity-60">{busy === 'refresh' ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />} Yangilash</button>
            <button
              onClick={() => run('del', async () => { if (!(await confirmDialog(`«${c.title}» kanali va uning barcha postlari ilovadan o'chirilsinmi? (Telegramdagi kanal o'chmaydi)`))) return; await api(`/channels/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); onChanged(); })}
              disabled={busy !== null}
              className="px-3 py-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 ml-auto flex items-center gap-1.5 disabled:opacity-60"
            ><Trash2 className="w-3.5 h-3.5" /> Olib tashlash</button>
          </div>
        </div>
      )}
    </Card>
  );
};

export const ChannelsView: React.FC<Props> = ({ channels, session, onChanged, onSelect, onLogout, onboarding }) => {
  const [chat, setChat] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [admins, setAdmins] = useState<{ admins: string[]; quotas?: Record<string, { dailyLimit: number; usedToday: number }> } | null>(null);
  const [newAdmin, setNewAdmin] = useState('');
  const [newQuota, setNewQuota] = useState('50');

  const loadStatus = () => api('/status').then(setStatus).catch(() => setStatus(null));
  const loadAdmins = () => session.role === 'owner' && api('/admins').then(setAdmins).catch(() => null);

  useEffect(() => {
    loadStatus();
    loadAdmins();
  }, []);

  const addChannel = async () => {
    if (!chat.trim()) return;
    setAdding(true);
    setNotice(null);
    try {
      const r = await api<{ channel: Channel }>('/channels', { body: { chat } });
      setChat('');
      setNotice({ type: 'success', message: `«${r.channel.title}» ulandi!` });
      onChanged();
      onSelect(r.channel.id);
    } catch (e: any) {
      setNotice({ type: 'error', message: e?.message });
    } finally {
      setAdding(false);
    }
  };

  const addAdmin = async () => {
    try {
      const r = await api<{ admins: string[]; quotas?: any }>('/admins', { body: { id: newAdmin, dailyLimit: Number(newQuota) || 0 } });
      setAdmins({ admins: r.admins, quotas: r.quotas });
      setNewAdmin('');
    } catch (e: any) {
      setNotice({ type: 'error', message: e?.message });
    }
  };

  const removeAdmin = async (id: string) => {
    if (!(await confirmDialog(`${id} adminlikdan olinsinmi?`))) return;
    const r = await api<{ admins: string[] }>(`/admins/${id}`, { method: 'DELETE' });
    setAdmins((a) => (a ? { ...a, admins: r.admins } : a));
  };

  const setAdminQuota = async (id: string) => {
    const val = prompt(`Kunlik AI limiti (${id}). 0 = cheksiz:`, String(admins?.quotas?.[id]?.dailyLimit ?? 50));
    if (val === null) return;
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0) return;
    try {
      await api(`/admins/${id}/quota`, { method: 'PUT', body: { dailyLimit: n } });
      loadAdmins();
    } catch (e: any) {
      setNotice({ type: 'error', message: e?.message });
    }
  };

  const cronOk = status?.cronLast ? Date.now() - new Date(status.cronLast).getTime() < 10 * 60_000 : false;

  return (
    <div className="space-y-5 pb-10">
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {onboarding && (
        <div className="p-5 rounded-3xl bg-gradient-to-r from-sky-950/70 via-slate-900 to-indigo-950/70 border border-sky-500/30">
          <h2 className="text-lg font-bold text-white mb-1">👋 Xush kelibsiz! Birinchi kanalni ulang</h2>
          <ol className="text-xs text-slate-300 list-decimal ml-4 space-y-1">
            <li>Kanalingiz sozlamalarida <b>Administratorlar → Admin qo'shish</b> orqali botni qo'shing.</li>
            <li>Unga <b>«Post Messages»</b> (xabar joylash) huquqini bering.</li>
            <li>Bot qo'shilishi bilan kanal <b>avtomatik ulanadi</b>, yoki quyiga @username yozib qo'shing.</li>
          </ol>
        </div>
      )}

      <Card className="space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5"><Plus className="w-4 h-4 text-sky-400" /> Kanal qo'shish</h3>
        <div className="flex gap-2">
          <input value={chat} onChange={(e) => setChat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addChannel()} placeholder="@kanalim yoki t.me/kanalim" className={inputCls} />
          <button onClick={addChannel} disabled={adding || !chat.trim()} className="px-4 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-50 shrink-0">{adding ? <Spinner /> : <Plus className="w-4 h-4" />} Ulash</button>
        </div>
        <p className="text-[11px] text-slate-500">Istalgancha kanal ulashingiz mumkin. Bot har bir kanalda administrator bo'lishi shart. Yopiq kanal bo'lsa, botni qo'shishning o'zi yetarli.</p>
      </Card>

      {channels.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-300 px-1">Ulangan kanallar ({channels.length})</h3>
          {channels.map((c) => <ChannelCard key={c.id} c={c} onChanged={onChanged} onSelect={() => onSelect(c.id)} setNotice={setNotice} />)}
        </div>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-400" /> Tizim holati</h3>
          <button onClick={loadStatus} className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Tekshirish</button>
        </div>
        {!status ? (
          <Spinner className="w-4 h-4 text-sky-400" />
        ) : (
          <div className="space-y-2">
            <StatusRow ok={!!status.bot && !status.bot.error} label={`Bot${status.bot?.username ? ` @${status.bot.username}` : ''}`} hint={status.bot?.error} />
            <StatusRow ok={status.webhookOk} label="Webhook (bot buyruqlari, kanal avto-ulash, tasdiqlash tugmalari)" hint={status.webhookOk ? undefined : 'brauzerda /api/setup?key=CRON_SECRET ni oching'} />
            <StatusRow ok={status.gemini} label={`Gemini AI (${status.textModel})`} hint={status.gemini ? undefined : 'GEMINI_API_KEY yo\'q'} />
            <StatusRow ok={status.db === 'upstash'} label={`Baza: ${status.db === 'upstash' ? 'Upstash Redis' : 'lokal fayl (faqat test uchun)'}`} />
            <StatusRow ok={cronOk} label="Cron (rejalashtirish va avtopilot)" hint={status.cronLast ? `oxirgi ishga tushish: ${timeAgo(status.cronLast)}` : 'hali ishlamagan — cron-job.org ni sozlang'} />
          </div>
        )}
      </Card>

      {session.role === 'owner' && admins && (
        <Card className="space-y-3">
          <h3 className="text-sm font-bold text-slate-200">Adminlar va AI kvotasi</h3>
          <p className="text-[11px] text-slate-500">Har bir admin faqat o'zi ulagan kanallarni ko'radi. Super admin ID va kanallari boshqalarga ko'rinmaydi. AI kvotasini kunlik belgilang (0 = cheksiz).</p>
          <div className="space-y-1.5 text-xs">
            {(admins.admins || []).map((id) => {
              const q = admins.quotas?.[id];
              return (
                <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700">
                  <span className="text-slate-200">{id}</span>
                  <span className="text-slate-400 ml-auto">{q ? `${q.usedToday}/${q.dailyLimit || '∞'}` : '—'}</span>
                  <button onClick={() => setAdminQuota(id)} className="text-sky-400 hover:text-sky-300">kvota</button>
                  <button onClick={() => removeAdmin(id)} className="text-red-400 hover:text-red-300">✕</button>
                </div>
              );
            })}
            {!admins.admins?.length && <p className="text-slate-500">Hali qo'shimcha admin yo'q</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <input value={newAdmin} onChange={(e) => setNewAdmin(e.target.value.replace(/\D/g, ''))} placeholder="Telegram ID" className={`${inputCls} !py-2 max-w-[140px]`} inputMode="numeric" />
            <input value={newQuota} onChange={(e) => setNewQuota(e.target.value.replace(/\D/g, ''))} placeholder="Kunlik AI" className={`${inputCls} !py-2 max-w-[100px]`} inputMode="numeric" title="Kunlik AI limiti" />
            <button onClick={addAdmin} disabled={newAdmin.length < 4} className="px-4 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm disabled:opacity-50">Qo'shish</button>
          </div>
        </Card>
      )}

      {!inTelegram() && (
        <button onClick={() => { clearToken(); onLogout(); }} className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5"><LogOut className="w-3.5 h-3.5" /> Chiqish</button>
      )}
    </div>
  );
};
