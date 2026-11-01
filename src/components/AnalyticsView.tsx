import React, { useEffect, useState } from 'react';
import { BarChart3, Calendar, Clock, Flame, Send, Users, Zap, Bot } from 'lucide-react';
import type { Channel, StatsResult } from '../../shared/types';
import { api } from '../lib/api';
import { fmtDateTime, timeAgo } from '../lib/time';
import { Card, Spinner, templateLabel } from './ui';

const WEEKDAYS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

export const AnalyticsView: React.FC<{ channel: Channel; refreshKey: number }> = ({ channel, refreshKey }) => {
  const [s, setS] = useState<StatsResult | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setErr('');
    api<{ stats: StatsResult }>(`/stats?channelId=${encodeURIComponent(channel.id)}`)
      .then((r) => alive && setS(r.stats))
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
  }, [channel.id, refreshKey]);

  if (err) return <p className="text-red-300 text-sm">{err}</p>;
  if (!s) return <div className="flex justify-center py-16"><Spinner className="w-6 h-6 text-sky-400" /></div>;

  const maxDay = Math.max(1, ...s.last30.map((d) => d.count));
  const maxHour = Math.max(1, ...s.byHour);
  const maxWd = Math.max(1, ...s.byWeekday);
  const bestHour = s.totals.sent >= 3 ? s.byHour.indexOf(Math.max(...s.byHour)) : -1;
  const templates = Object.entries(s.byTemplate).sort((a, b) => b[1] - a[1]);

  const tips: string[] = [];
  if (s.totals.sent === 0) tips.push("Hali post yuborilmagan. Birinchi postni yarating yoki «Kontent reja» bilan butun haftani rejalashtiring.");
  if (s.totals.sent > 0 && s.streak === 0) tips.push('Bugun va kecha post yo\'q. Muntazamlik obunachilarni ushlab turadi — avtopilotni yoqing.');
  if (s.totals.sent > 3 && s.perWeek < 3) tips.push(`Haftasiga o'rtacha ${s.perWeek} ta post. Faol kanallar odatda haftasiga 4–7 ta joylaydi.`);
  if (s.totals.scheduled === 0) tips.push("Navbatda rejalashtirilgan post yo'q. «Kontent reja» orqali bir bosishda to'ldiring.");
  if (!channel.autopilot.enabled) tips.push("Avtopilot o'chiq. «Kanallar» bo'limida yoqsangiz, AI o'zi kunlik post yozib yuboradi.");
  if (bestHour >= 0) tips.push(`Postlaringiz eng ko'p soat ${String(bestHour).padStart(2, '0')}:00 atrofida chiqqan — bu sizning odatiy vaqtingiz.`);
  if (s.totals.failed > 0) tips.push(`${s.totals.failed} ta post xato bilan tugagan. «Reja va tarix» da sababini ko'ring.`);

  const kpi = [
    { label: "A'zolar", value: s.memberCount.toLocaleString(), icon: <Users className="w-4 h-4 text-sky-400" /> },
    { label: 'Yuborilgan', value: s.totals.sent, icon: <Send className="w-4 h-4 text-emerald-400" /> },
    { label: 'Navbatda', value: s.totals.scheduled, icon: <Clock className="w-4 h-4 text-amber-400" /> },
    { label: 'Ketma-ket kun', value: s.streak, icon: <Flame className="w-4 h-4 text-orange-400" /> },
    { label: 'Haftasiga', value: s.perWeek, icon: <Calendar className="w-4 h-4 text-indigo-400" /> },
    { label: 'Avtopilot', value: s.autopilotCount, icon: <Bot className="w-4 h-4 text-fuchsia-400" /> },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2"><BarChart3 className="w-5 h-5 text-sky-400" /> Statistika</h2>
        <p className="text-xs text-slate-400 mt-0.5">{channel.title} • oxirgi post: {timeAgo(s.lastSentAt)}{s.nextScheduledAt ? ` • keyingisi: ${fmtDateTime(s.nextScheduledAt, channel.timezone)}` : ''}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpi.map((k) => (
          <div key={k.label} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3.5">
            <div className="flex items-center justify-between text-slate-400 text-[11px] font-semibold mb-1.5"><span>{k.label}</span>{k.icon}</div>
            <div className="text-2xl font-extrabold text-white">{k.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <h3 className="text-sm font-bold text-slate-200 mb-3">So'nggi 30 kun (kunlik postlar)</h3>
        <div className="flex items-end gap-[3px] h-28">
          {s.last30.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col justify-end h-full" title={`${d.date}: ${d.count} ta`}>
              <div className={`w-full rounded-t ${d.count ? 'bg-gradient-to-t from-sky-600 to-sky-400' : 'bg-slate-800'}`} style={{ height: `${d.count ? Math.max(8, (d.count / maxDay) * 100) : 4}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-1.5"><span>{s.last30[0].date.slice(5)}</span><span>bugun</span></div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <h3 className="text-sm font-bold text-slate-200 mb-3">Qaysi soatlarda joylangan</h3>
          <div className="flex items-end gap-[2px] h-20">
            {s.byHour.map((c, h) => (
              <div key={h} className="flex-1 flex flex-col justify-end h-full" title={`${h}:00 — ${c} ta`}>
                <div className={`w-full rounded-t ${h === bestHour ? 'bg-amber-400' : c ? 'bg-indigo-500' : 'bg-slate-800'}`} style={{ height: `${c ? Math.max(8, (c / maxHour) * 100) : 4}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-slate-500 mt-1.5"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        </Card>
        <Card>
          <h3 className="text-sm font-bold text-slate-200 mb-3">Hafta kunlari bo'yicha</h3>
          <div className="flex items-end gap-2 h-20">
            {s.byWeekday.map((c, i) => (
              <div key={i} className="flex-1 flex flex-col justify-end items-center h-full gap-1">
                <div className={`w-full rounded-t ${c ? 'bg-emerald-500' : 'bg-slate-800'}`} style={{ height: `${c ? Math.max(8, (c / maxWd) * 100) : 4}%` }} />
                <span className="text-[10px] text-slate-500">{WEEKDAYS[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <h3 className="text-sm font-bold text-slate-200 mb-3">Kontent xilma-xilligi</h3>
          {templates.length === 0 ? (
            <p className="text-xs text-slate-500">Ma'lumot yo'q</p>
          ) : (
            <div className="space-y-2">
              {templates.map(([t, c]) => (
                <div key={t} className="text-xs">
                  <div className="flex justify-between text-slate-300 mb-0.5"><span>{templateLabel(t)}</span><span>{c}</span></div>
                  <div className="h-1.5 rounded bg-slate-800"><div className="h-full rounded bg-sky-500" style={{ width: `${(c / s.totals.sent) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-3">Media: 🖼 {s.media.image} • 📎 {s.media.file} • 📝 {s.media.text}</p>
        </Card>
        <Card>
          <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-1.5"><Zap className="w-4 h-4 text-amber-400" /> Maslahatlar</h3>
          {tips.length === 0 ? (
            <p className="text-xs text-emerald-300">Hammasi yaxshi ko'rinadi. Shu tempda davom eting! 🚀</p>
          ) : (
            <ul className="space-y-2 text-xs text-slate-300">{tips.map((t, i) => <li key={i} className="flex gap-2"><span>•</span><span>{t}</span></li>)}</ul>
          )}
        </Card>
      </div>
      <p className="text-[11px] text-slate-500">Eslatma: Telegram Bot API kanal postlarining ko'rishlar soni va reaksiyalarini bermaydi, shuning uchun bu yerda faqat haqiqiy ma'lumotlar (joylash faolligi va a'zolar soni) ko'rsatiladi.</p>
    </div>
  );
};
