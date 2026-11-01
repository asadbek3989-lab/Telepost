import { env } from './env.js';
import { HttpError } from './http.js';
import { htmlToPlain, plainLength, sanitizeTelegramHtml } from '../../shared/telegramHtml.js';
import type { Channel, CtaButton, FileData, Post } from '../../shared/types.js';
import type { Media } from './store.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TelegramError extends Error {
  code: number;
  retryAfter?: number;
  constructor(code: number, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
  /** Qayta urinish foydasiz bo'lgan (doimiy) xatolar */
  get permanent() {
    return [400, 401, 403, 404].includes(this.code);
  }
}

function token(): string {
  if (!env.botToken) throw new HttpError(503, "BOT_TOKEN sozlanmagan (Vercel > Environment Variables).");
  return env.botToken;
}

/** Telegram Bot API chaqiruvi. body — JSON obyekt yoki FormData. 429 bo'lsa bir marta qayta urinadi. */
export async function tg<T = any>(method: string, body?: Record<string, any> | FormData, attempt = 0): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new TelegramError(0, "Telegram bilan aloqa o'rnatib bo'lmadi (tarmoq xatosi)");
  }
  const data: any = await res.json().catch(() => ({ ok: false, description: res.statusText, error_code: res.status }));
  if (data.ok) return data.result as T;

  const retryAfter = data.parameters?.retry_after as number | undefined;
  if (data.error_code === 429 && retryAfter && retryAfter <= 8 && attempt < 1) {
    await sleep((retryAfter + 1) * 1000);
    return tg<T>(method, body, attempt + 1);
  }
  throw new TelegramError(data.error_code || 500, data.description || 'Telegram xatosi', retryAfter);
}

let meCache: { id: number; username: string; first_name: string } | null = null;
export async function getMe() {
  if (!meCache) meCache = await tg('getMe');
  return meCache!;
}

/** "@kanal", "t.me/kanal", "https://t.me/kanal" yoki -100... ko'rinishini normallashtiradi */
export function normalizeChatRef(input: string): string {
  let s = (input || '').trim();
  s = s.replace(/^https?:\/\/(www\.)?(t|telegram)\.me\//i, '').replace(/^(t|telegram)\.me\//i, '');
  s = s.replace(/\/.*$/, '').replace(/\?.*$/, '');
  if (/^-?\d+$/.test(s)) return s;
  if (!s) return '';
  return s.startsWith('@') ? s : '@' + s;
}

export async function fetchChannelInfo(chatRef: string): Promise<Channel> {
  const chat: any = await tg('getChat', { chat_id: chatRef });
  if (!['channel', 'supergroup', 'group'].includes(chat.type)) {
    throw new HttpError(400, "Bu kanal yoki guruh emas. Kanal username'ini kiriting.");
  }
  const me = await getMe();
  const member: any = await tg('getChatMember', { chat_id: chat.id, user_id: me.id });
  if (!['administrator', 'creator'].includes(member.status)) {
    throw new HttpError(400, `@${me.username} botini avval kanalga administrator qilib qo'shing.`);
  }
  if (chat.type === 'channel' && member.can_post_messages === false) {
    throw new HttpError(400, "Botda 'Post Messages' (xabar joylash) huquqi yo'q. Admin huquqlarini tekshiring.");
  }
  let memberCount = 0;
  try {
    memberCount = await tg('getChatMemberCount', { chat_id: chat.id });
  } catch {
    /* ixtiyoriy */
  }
  return {
    id: String(chat.id),
    username: chat.username,
    title: chat.title || chat.username || String(chat.id),
    memberCount,
    memberCountAt: new Date().toISOString(),
    signature: '',
    tone: "do'stona",
    language: 'uz-lat',
    niche: '',
    audience: '',
    timezone: 'Asia/Tashkent',
    autopilot: { enabled: false, times: [], topics: [], templates: [], withImage: false, requireApproval: true },
    createdAt: new Date().toISOString(),
  };
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const mime = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
  const buf = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  return { blob: new Blob([buf], { type: mime }), mime };
}

function replyMarkup(cta?: CtaButton) {
  if (!cta?.text || !cta?.url) return undefined;
  const url = /^(https?:\/\/|tg:\/\/)/i.test(cta.url) ? cta.url : `https://${cta.url.replace(/^\/+/, '')}`;
  return { inline_keyboard: [[{ text: cta.text.slice(0, 64), url }]] };
}

const isParseError = (e: unknown) => e instanceof TelegramError && /can't parse entities|unsupported start tag|unmatched end tag/i.test(e.message);

async function sendText(chatId: string, html: string, markup?: object, replyTo?: number) {
  const base: Record<string, any> = {
    chat_id: chatId,
    reply_markup: markup,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  };
  try {
    return await tg<any>('sendMessage', { ...base, text: html, parse_mode: 'HTML' });
  } catch (e) {
    if (!isParseError(e)) throw e;
    return tg<any>('sendMessage', { ...base, text: htmlToPlain(html).slice(0, 4096) });
  }
}

async function sendMedia(
  kind: 'photo' | 'document',
  chatId: string,
  source: { dataUrl?: string; url?: string; fileId?: string; file?: FileData },
  caption: string | undefined,
  markup?: object,
  replyTo?: number
) {
  const method = kind === 'photo' ? 'sendPhoto' : 'sendDocument';
  const field = kind === 'photo' ? 'photo' : 'document';

  const build = (cap: string | undefined, html: boolean) => {
    const f = new FormData();
    f.append('chat_id', chatId);
    if (cap) {
      f.append('caption', cap);
      if (html) f.append('parse_mode', 'HTML');
    }
    if (markup) f.append('reply_markup', JSON.stringify(markup));
    if (replyTo) f.append('reply_parameters', JSON.stringify({ message_id: replyTo, allow_sending_without_reply: true }));

    if (source.fileId) f.append(field, source.fileId);
    else if (source.url) f.append(field, source.url);
    else if (source.dataUrl) {
      const { blob, mime } = dataUrlToBlob(source.dataUrl);
      f.append(field, blob, mime.includes('png') ? 'post.png' : 'post.jpg');
    } else if (source.file) {
      const c = source.file.content;
      const blob = c.startsWith('data:') ? dataUrlToBlob(c).blob : new Blob([c], { type: source.file.mimeType || 'text/plain;charset=utf-8' });
      f.append(field, blob, source.file.name || 'fayl.txt');
    }
    return f;
  };

  try {
    return await tg<any>(method, build(caption, true));
  } catch (e) {
    if (!isParseError(e) || !caption) throw e;
    return tg<any>(method, build(htmlToPlain(caption).slice(0, 1024), false));
  }
}

export interface SendResult {
  messageId: number;
  link?: string;
  photoFileId?: string;
}

/**
 * Postni kanalga yuboradi.
 *  - Matn 1024 belgidan oshsa, rasm/fayl va matn alohida xabar bo'lib ketadi (Telegram caption limiti).
 *  - HTML avtomatik tozalanadi; parse xatosi bo'lsa oddiy matn bilan qayta uriniladi.
 */
export async function sendPostToChannel(channel: Channel, post: Pick<Post, 'text' | 'mediaType' | 'cta'>, media: Media = {}): Promise<SendResult> {
  const chatId = channel.id;
  const text = sanitizeTelegramHtml(post.text);
  if (!text && post.mediaType === 'none') throw new HttpError(400, "Post matni bo'sh");
  const markup = replyMarkup(post.cta);
  let main: any;
  let photoFileId: string | undefined;

  const hasImage = post.mediaType === 'image' && (media.tgFileId || media.imageData);
  const hasFile = post.mediaType === 'file' && media.fileData;

  if (hasImage) {
    const isUrl = !!media.imageData && /^https?:\/\//i.test(media.imageData);
    const source = media.tgFileId
      ? { fileId: media.tgFileId }
      : isUrl
        ? { url: media.imageData }
        : { dataUrl: media.imageData };
    if (plainLength(text) <= 1000) {
      main = await sendMedia('photo', chatId, source, text, markup);
    } else {
      const photoMsg = await sendMedia('photo', chatId, source, undefined);
      main = await sendText(chatId, text, markup, photoMsg.message_id);
      main.__photo = photoMsg;
    }
    const photo = (main.__photo || main).photo as any[] | undefined;
    photoFileId = photo?.[photo.length - 1]?.file_id;
  } else if (hasFile) {
    if (plainLength(text) <= 1000) {
      main = await sendMedia('document', chatId, { file: media.fileData }, text, markup);
    } else {
      main = await sendText(chatId, text, markup);
      await sendMedia('document', chatId, { file: media.fileData }, undefined, undefined, main.message_id);
    }
  } else {
    main = await sendText(chatId, text, markup);
  }

  const link = channel.username ? `https://t.me/${channel.username.replace(/^@/, '')}/${main.message_id}` : undefined;
  return { messageId: main.message_id, link, photoFileId };
}

/** Adminga shaxsiy xabar (bildirishnoma). Xato bo'lsa jim o'tadi. */
export async function dm(userId: string, html: string, extra: Record<string, any> = {}) {
  try {
    return await tg<any>('sendMessage', { chat_id: userId, text: html.slice(0, 4000), parse_mode: 'HTML', ...extra });
  } catch {
    return null;
  }
}
