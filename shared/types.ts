export type PostStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type MediaType = 'none' | 'image' | 'file';

/** Emoji ishlatish darajasi: none = umuman yo'q, minimal = faqat sarlavha va ro'yxat belgilari, rich = ko'proq */
export type EmojiMode = 'none' | 'minimal' | 'rich';
export const EMOJI_MODES: readonly EmojiMode[] = ['none', 'minimal', 'rich'];

/**
 * Avtopilot jadvalidagi bitta slot: admin QAYSI VAQTDA, QAYSI MAVZUDA va QANDAY TURDAGI post chiqishini o'zi belgilaydi.
 */
export interface AutopilotSlot {
  id: string;
  /** Kanal vaqt zonasidagi "HH:MM" */
  time: string;
  /** 0 = Dushanba … 6 = Yakshanba. Bo'sh = har kuni */
  weekdays: number[];
  /** Mavzu. Bo'sh = AI o'zi tanlaydi. Bir nechta qator bo'lsa, navbatma-navbat ishlatiladi */
  topic: string;
  /** Post turi (TEMPLATE_IDS dan). Bo'sh = umumiy aylanma ro'yxatdan */
  templateType: string;
  /** Admin ko'rsatmasi (masalan: "hikoya bilan boshlansin") */
  instructions?: string;
  /** Bo'sh = kanal standarti */
  emojiMode?: EmojiMode;
  /** Bo'sh = kanal standarti (300–5000) */
  maxChars?: number;
  /** Bo'sh = avtopilotning umumiy sozlamasi */
  withImage?: boolean;
}

export interface Autopilot {
  enabled: boolean;
  /** Jadval: har bir slot o'z vaqti, mavzusi va turiga ega. Bo'sh bo'lsa eski `times` ishlatiladi. */
  slots?: AutopilotSlot[];
  /** Kanal vaqt zonasidagi "HH:MM" ko'rinishida yuborish vaqtlari (slotlardan avtomatik hosil bo'ladi) */
  times: string[];
  /**
   * Haftaning kunlari (0 = Dushanba … 6 = Yakshanba).
   * Bo'sh yoki yo'q = har kuni.
   * Masalan [0,1,2,3,4] = ish kunlari.
   */
  weekdays?: number[];
  /** Aylanma mavzular. Bo'sh bo'lsa AI kanal yo'nalishiga qarab o'zi yangi mavzu tanlaydi */
  topics: string[];
  /** Aylanma post turlari (news, educational, ...) */
  templates: string[];
  withImage: boolean;
  /** true bo'lsa post avval adminga tasdiqlash uchun yuboriladi */
  requireApproval: boolean;
  /**
   * Tasdiqlash muddati (soat). requireApproval=true bo'lganda.
   * Muddat o'tsa post avtomatik bekor qilinadi.
   * Default: 24
   */
  approvalDeadlineHours?: number;
}

export interface Channel {
  /** Telegram chat id (masalan -1001234567890) */
  id: string;
  username?: string;
  title: string;
  memberCount: number;
  memberCountAt?: string;
  signature: string;
  tone: string;
  language: string;
  /** Kanal yo'nalishi / brend ovozi — AI shuni hisobga oladi */
  niche: string;
  audience: string;
  timezone: string;
  /**
   * AI yozadigan postning taxminiy maksimal belgi soni (imzosiz).
   * 300–5000. 4096 dan uzun post Telegramga ikki xabar bo'lib yuboriladi.
   */
  maxPostChars?: number;
  /** Emoji ishlatish: none | minimal | rich (admin belgilaydi) */
  emojiMode?: EmojiMode;
  /** Uslub namunasi: AI shu postning ritmi, tuzilishi va sifatiga o'xshatib yozadi */
  styleSample?: string;
  /** AI ishlatmasligi kerak bo'lgan so'z va iboralar */
  bannedPhrases?: string[];
  autopilot: Autopilot;
  createdAt: string;
  /** Kanalni qo'shgan adminning Telegram ID si */
  addedBy?: string;
}

export interface FileData {
  name: string;
  content: string;
  mimeType: string;
  sizeBytes?: number;
  summary?: string;
}

export interface FileMeta {
  name: string;
  mimeType: string;
  sizeBytes?: number;
  summary?: string;
}

export interface CtaButton {
  text: string;
  url: string;
}

export interface Post {
  id: string;
  channelId: string;
  topic: string;
  templateType: string;
  tone: string;
  language: string;
  text: string;
  mediaType: MediaType;
  hasImage?: boolean;
  thumb?: string;
  file?: FileMeta;
  cta?: CtaButton;
  status: PostStatus;
  scheduledFor?: string;
  createdAt: string;
  updatedAt?: string;
  sentAt?: string;
  messageId?: number;
  /** Uzun post bir necha xabar bo'lib ketganda, keyingi xabarlar ID si */
  extraMessageIds?: number[];
  link?: string;
  error?: string;
  attempts?: number;
  source?: 'manual' | 'plan' | 'autopilot';
  /** Autopilot postlari uchun: admin tasdig'ini kutmoqda */
  awaiting?: boolean;
  /** Tasdiqlash muddati tugash vaqti (UTC ISO) */
  approvalDeadline?: string;
}

/** Postni klient bilan almashishda ishlatiladigan to'liq ko'rinish (media bilan) */
export interface PostFull extends Post {
  imageData?: string;
  fileData?: FileData;
}

export interface SessionInfo {
  id: string;
  name: string;
  role: 'owner' | 'admin';
}

/** Har bir admin uchun AI kvotasi (kunlik) */
export interface AdminQuota {
  /** Kunlik limit (0 = cheksiz) */
  dailyLimit: number;
  /** Bugungi ishlatilgan */
  usedToday: number;
  /** YYYY-MM-DD (UTC) */
  date: string;
}

export interface StatsResult {
  totals: { all: number; sent: number; scheduled: number; drafts: number; failed: number };
  media: { image: number; file: number; text: number };
  memberCount: number;
  last30: { date: string; count: number }[];
  byHour: number[];
  byWeekday: number[];
  byTemplate: Record<string, number>;
  streak: number;
  perWeek: number;
  lastSentAt?: string;
  nextScheduledAt?: string;
  autopilotCount: number;
}

export interface PlanIdea {
  topic: string;
  templateType: string;
  note?: string;
  /** "YYYY-MM-DD" kanal vaqti bo'yicha */
  day: string;
  /** "HH:MM" */
  time: string;
  /** UTC ISO — rejalashtirishda ishlatiladi */
  scheduledFor: string;
}

export const TEMPLATE_IDS = ['news', 'motivation', 'educational', 'promo', 'poll', 'quote', 'lifestyle', 'story', 'essay', 'myth', 'challenge', 'custom'] as const;
export const MAX_POST_CHARS = 5000;
export const MIN_POST_CHARS = 300;

/** Avtopilotdagi samarali jadval: slotlar bo'lsa shular, bo'lmasa eski `times` dan hosil qilinadi */
export function effectiveSlots(ap: Pick<Autopilot, 'slots' | 'times' | 'weekdays'>): AutopilotSlot[] {
  if (Array.isArray(ap.slots) && ap.slots.length) return ap.slots;
  return (ap.times || []).map((time) => ({ id: time, time, weekdays: ap.weekdays || [], topic: '', templateType: '' }));
}

export function autopilotTimes(ap: Pick<Autopilot, 'slots' | 'times' | 'weekdays'>): string[] {
  return [...new Set(effectiveSlots(ap).map((s) => s.time))].sort();
}
export const TONE_IDS = ["do'stona", 'rasmiy', 'sotuvchi', 'qiziqarli', 'tahliliy'] as const;
export const LANGUAGE_IDS = ['uz-lat', 'uz-kir', 'ru', 'en'] as const;
