export type PostStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type MediaType = 'none' | 'image' | 'file';

export interface Autopilot {
  enabled: boolean;
  /** Kanal vaqt zonasidagi "HH:MM" ko'rinishida kunlik yuborish vaqtlari */
  times: string[];
  /** Aylanma mavzular. Bo'sh bo'lsa AI kanal yo'nalishiga qarab o'zi yangi mavzu tanlaydi */
  topics: string[];
  /** Aylanma post turlari (news, educational, ...) */
  templates: string[];
  withImage: boolean;
  /** true bo'lsa post avval adminga tasdiqlash uchun yuboriladi */
  requireApproval: boolean;
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
  autopilot: Autopilot;
  createdAt: string;
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
  link?: string;
  error?: string;
  attempts?: number;
  source?: 'manual' | 'plan' | 'autopilot';
  /** Autopilot postlari uchun: admin tasdig'ini kutmoqda */
  awaiting?: boolean;
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

export const TEMPLATE_IDS = ['news', 'motivation', 'educational', 'promo', 'poll', 'quote', 'lifestyle', 'custom'] as const;
export const TONE_IDS = ["do'stona", 'rasmiy', 'sotuvchi', 'qiziqarli', 'tahliliy'] as const;
export const LANGUAGE_IDS = ['uz-lat', 'uz-kir', 'ru', 'en'] as const;
