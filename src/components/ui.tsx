import React from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react';

export const Spinner: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => <RefreshCw className={`${className} animate-spin`} />;

export interface NoticeState {
  type: 'success' | 'error';
  message: string;
}

export const Notice: React.FC<{ notice: NoticeState | null; onClose: () => void }> = ({ notice, onClose }) => {
  if (!notice) return null;
  const ok = notice.type === 'success';
  return (
    <div
      className={`p-3.5 rounded-2xl border text-sm flex items-start gap-3 shadow-lg backdrop-blur animate-fadeIn ${
        ok ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200' : 'bg-red-950/60 border-red-500/40 text-red-200'
      }`}
    >
      {ok ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
      <div className="flex-1 break-words">{notice.message}</div>
      <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Yopish">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`bg-slate-900/80 border border-slate-800 rounded-3xl p-5 shadow-xl backdrop-blur-sm ${className}`}>{children}</div>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: string }> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative w-11 h-6 rounded-full transition shrink-0 ${checked ? 'bg-sky-500' : 'bg-slate-700'}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
  </button>
);

export const TEMPLATES = [
  { id: 'news', title: 'Yangilik & Tech', icon: '⚡️', sampleTopic: "Sun'iy intellekt sohasidagi eng so'nggi yangiliklar va ularning insonlarga ta'siri" },
  { id: 'educational', title: "Ta'lim & Maslahat", icon: '💡', sampleTopic: "Telegram kanalni 0 dan 10 000 obunachiga olib chiqish bo'yicha 5 ta amaliy tavsiya" },
  { id: 'motivation', title: 'Motivatsiya', icon: '🚀', sampleTopic: "Muvaffaqiyatga erishishda intizomning o'rni va odatlarni shakllantirish" },
  { id: 'promo', title: 'Aksiya / Sotuv', icon: '🔥', sampleTopic: "Yangi xizmat uchun cheklangan muddatli taklif e'loni" },
  { id: 'poll', title: 'Mulohaza & Bahs', icon: '🧭', sampleTopic: "Masofadan ishlash yoki ofisda ishlash: qaysi biri samaraliroq?" },
  { id: 'quote', title: 'Iqtibos & Tahlil', icon: '💬', sampleTopic: "Mashhur tadbirkorning iqtibosi va undan 3 ta saboq" },
  { id: 'lifestyle', title: 'Kunlik / Hayot', icon: '☀️', sampleTopic: '' },
  { id: 'story', title: 'Ibratli hikoya', icon: '📖', sampleTopic: '' },
  { id: 'essay', title: 'Chuqur maqola', icon: '🧠', sampleTopic: '' },
  { id: 'myth', title: 'Xurofot va haqiqat', icon: '🔍', sampleTopic: '' },
  { id: 'challenge', title: 'Kunlik topshiriq', icon: '✅', sampleTopic: '' },
  { id: 'custom', title: 'Erkin Mavzu', icon: '✍️', sampleTopic: '' },
] as const;

export const TONES = [
  { id: "do'stona", label: "Do'stona & Samimiy", icon: '😊' },
  { id: 'rasmiy', label: 'Rasmiy & Jiddiy', icon: '👔' },
  { id: 'sotuvchi', label: 'Sotuvchi (Marketing)', icon: '🎯' },
  { id: 'qiziqarli', label: 'Qiziqarli & Yumor', icon: '😄' },
  { id: 'tahliliy', label: 'Ekspert & Tahliliy', icon: '📊' },
] as const;

export const LANGUAGES = [
  { id: 'uz-lat', label: "🇺🇿 O'zbek (Lotin)" },
  { id: 'uz-kir', label: '🇺🇿 Ўзбек (Кирилл)' },
  { id: 'ru', label: '🇷🇺 Русский' },
  { id: 'en', label: '🇬🇧 English' },
] as const;

export const EMOJI_OPTIONS = [
  { id: 'none', label: 'Emojisiz', hint: "Hech qanday emoji yo'q" },
  { id: 'minimal', label: 'Kam emoji', hint: 'Sarlavha va ro\'yxat belgilari' },
  { id: 'rich', label: "Ko'proq emoji", hint: 'Paragraflarda ham, me\'yorida' },
] as const;

export const WEEKDAY_LABELS = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'] as const;

/** Telegram bitta xabarga 4096 belgi beradi; uzunroq post shu chegarada bir necha xabarga bo'linadi */
export const TG_PART = 3900;
export const MIN_CHARS = 300;
export const MAX_CHARS = 5000;

export const templateLabel = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? `${t.icon} ${t.title}` : id;
};

export const inputCls =
  'w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500';
