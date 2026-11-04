import { env } from './env.js';
import { HttpError } from './http.js';
import { htmlToPlain, plainLength, sanitizeTelegramHtml, splitForTelegram } from '../../shared/telegramHtml.js';
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

/** Foydalanuvchi kanalda creator yoki administrator ekanligini tekshiradi */
export async function assertUserIsChannelAdmin(chatId: string | number, userId: string | number) {
  try {
    const member: any = await tg('getChatMember', { chat_id: chatId, user_id: Number(userId) });
    if (!['creator', 'administrator'].includes(member.status)) {
      throw new HttpError(403, 'Siz bu kanalning administratorisiz emas. Faqat o\'z kanallarini qo\'shishingiz mumkin.');
    }
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Kanal a\'zoligini tekshirib bo\'lmadi. Bot kanalda admin ekanligiga ishonch hosil qiling.');
  }
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
  /** Uzun post bir necha xabar bo'lib ketganda, keyingi xabarlar */
  extraIds: number[];
  link?: string;
  photoFileId?: string;
}

/** Telegram bitta matnli xabarga 4096 belgi beradi; xavfsizlik uchun biroz kam olamiz */
const PART_LIMIT = 3900;
/** Rasm/fayl izohi (caption) limiti 1024; xavfsizlik uchun 1000 */
const CAPTION_LIMIT = 1000;

/** Ketma-ket xabarlarni yuboradi. Biror bo'lak yuborilmasa, oldingi yuborilganlarni o'chirib, xatoni qaytaradi (qayta urinish dublikat qilmasligi uchun). */
async function sendParts(chatId: string, parts: string[], markup: object | undefined, replyTo?: number): Promise<any[]> {
  const sent: any[] = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      let msg: any;
      try {
        msg = await sendText(chatId, parts[i], last ? markup : undefined, i === 0 ? replyTo : undefined);
      } catch (e) {
        if (i === 0) throw e;
        await sleep(1500);
        msg = await sendText(chatId, parts[i], last ? markup : undefined, undefined);
      }
      sent.push(msg);
      if (!last) await sleep(350); // ketma-ketlik va flood-limitdan saqlanish
    }
  } catch (e) {
    for (const m of sent) {
      try {
        await tg('deleteMessage', { chat_id: chatId, message_id: m.message_id });
      } catch {
        /* o'chirib bo'lmasa ham davom etamiz */
      }
    }
    throw e;
  }
  return sent;
}

/**
 * Postni kanalga yuboradi.
 *  - Matn 1000 belgidan oshsa, rasm/fayl va matn alohida xabar bo'ladi (Telegram caption limiti).
 *  - Matn 4096 dan oshsa, paragraf chegarasida bir necha xabarga bo'linadi; havola tugmasi oxirgisida turadi.
 *  - HTML avtomatik tozalanadi; parse xatosi bo'lsa oddiy matn bilan qayta uriniladi.
 */
export async function sendPostToChannel(channel: Channel, post: Pick<Post, 'text' | 'mediaType' | 'cta'>, media: Media = {}): Promise<SendResult> {
  const chatId = channel.id;
  const text = sanitizeTelegramHtml(post.text);
  if (!text && post.mediaType === 'none') throw new HttpError(400, "Post matni bo'sh");
  const markup = replyMarkup(post.cta);
  let first: any;
  let extra: any[] = [];
  let photoFileId: string | undefined;

  const hasImage = post.mediaType === 'image' && (media.tgFileId || media.imageData);
  const hasFile = post.mediaType === 'file' && media.fileData;
  const fitsCaption = plainLength(text) <= CAPTION_LIMIT;

  if (hasImage) {
    const isUrl = !!media.imageData && /^https?:\/\//i.test(media.imageData);
    const source = media.tgFileId
      ? { fileId: media.tgFileId }
      : isUrl
        ? { url: media.imageData }
        : { dataUrl: media.imageData };
    let photoMsg: any;
    if (fitsCaption) {
      photoMsg = await sendMedia('photo', chatId, source, text, markup);
      first = photoMsg;
    } else {
      photoMsg = await sendMedia('photo', chatId, source, undefined);
      try {
        const msgs = await sendParts(chatId, splitForTelegram(text, PART_LIMIT), markup, photoMsg.message_id);
        first = msgs[0];
        extra = msgs.slice(1);
      } catch (e) {
        try {
          await tg('deleteMessage', { chat_id: chatId, message_id: photoMsg.message_id });
        } catch {
          /* e'tiborsiz */
        }
        throw e;
      }
    }
    const photo = photoMsg.photo as any[] | undefined;
    photoFileId = photo?.[photo.length - 1]?.file_id;
    // Havolaga rasm xabari emas, matn xabari ulanadi
    if (!fitsCaption) {
      const link = channel.username ? `https://t.me/${channel.username.replace(/^@/, '')}/${first.message_id}` : undefined;
      return { messageId: first.message_id, extraIds: [...extra.map((m) => m.message_id), photoMsg.message_id], link, photoFileId };
    }
  } else if (hasFile) {
    if (fitsCaption) {
      first = await sendMedia('document', chatId, { file: media.fileData }, text, markup);
    } else {
      const msgs = await sendParts(chatId, splitForTelegram(text, PART_LIMIT), undefined);
      first = msgs[0];
      extra = msgs.slice(1);
      try {
        const doc = await sendMedia('document', chatId, { file: media.fileData }, undefined, markup, msgs[msgs.length - 1].message_id);
        extra.push(doc);
      } catch (e) {
        for (const m of msgs) {
          try {
            await tg('deleteMessage', { chat_id: chatId, message_id: m.message_id });
          } catch {
            /* e'tiborsiz */
          }
        }
        throw e;
      }
    }
  } else {
    const msgs = await sendParts(chatId, splitForTelegram(text, PART_LIMIT), markup);
    first = msgs[0];
    extra = msgs.slice(1);
  }

  const link = channel.username ? `https://t.me/${channel.username.replace(/^@/, '')}/${first.message_id}` : undefined;
  return { messageId: first.message_id, extraIds: extra.map((m) => m.message_id), link, photoFileId };
}

/** Adminga shaxsiy xabar (bildirishnoma). Xato bo'lsa jim o'tadi. Uzun HTML bo'lsa, oddiy matnga o'tadi. */
export async function dm(userId: string, html: string, extra: Record<string, any> = {}) {
  try {
    return await tg<any>('sendMessage', { chat_id: userId, text: html, parse_mode: 'HTML', ...extra });
  } catch (e) {
    if (!isParseError(e) && !(e instanceof TelegramError && /message is too long/i.test(e.message))) return null;
    try {
      return await tg<any>('sendMessage', { chat_id: userId, text: htmlToPlain(html).slice(0, 4096), ...extra });
    } catch {
      return null;
    }
  }
}

/** Uzun HTML matnni bir necha shaxsiy xabar qilib yuboradi; tugmalar oxirgi xabarda bo'ladi */
export async function dmLong(userId: string, html: string, extra: Record<string, any> = {}) {
  const parts = splitForTelegram(html, 3600);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const { reply_markup, ...rest } = extra;
    await dm(userId, parts[i], { ...rest, ...(last && reply_markup ? { reply_markup } : {}) });
    if (!last) await sleep(300);
  }
}
