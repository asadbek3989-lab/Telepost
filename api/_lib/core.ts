import { allAdminIds } from './auth.js';
import { generateImage, generatePost } from './ai.js';
import { env } from './env.js';
import { HttpError } from './http.js';
import {
  claimSlot,
  dequeue,
  dueQueue,
  enqueue,
  getChannel,
  getMedia,
  getMeta,
  getPost,
  listChannels,
  listPosts,
  newId,
  nextCounter,
  releaseSlot,
  saveMedia,
  savePost,
  setMeta,
  acquireLock,
  releaseLock,
} from './store.js';
import { dm, sendPostToChannel, tg, TelegramError } from './telegram.js';
import { escapeHtml, htmlToPlain, plainLength } from '../../shared/telegramHtml.js';
import type { Channel, Post } from '../../shared/types.js';

export async function resolveAppUrl(): Promise<string> {
  return env.appUrl || (await getMeta('appUrl')) || '';
}

/** Postni kanalga yuboradi va natijani saqlaydi. Yuborish xatosida ham Post qaytaradi (status='failed' yoki qayta navbatga). */
export async function deliverPost(postId: string, opts: { retry?: boolean } = {}): Promise<Post> {
  const post = await getPost(postId);
  if (!post) throw new HttpError(404, 'Post topilmadi');
  const channel = await getChannel(post.channelId);
  if (!channel) throw new HttpError(404, "Kanal topilmadi (o'chirilgan bo'lishi mumkin)");

  if (!(await acquireLock(`send:${postId}`, 90))) throw new HttpError(409, 'Post hozir yuborilmoqda, biroz kuting');
  try {
    const media = await getMedia(postId);
    post.status = 'sending';
    await savePost(post);
    try {
      const r = await sendPostToChannel(channel, post, media);
      post.status = 'sent';
      post.sentAt = new Date().toISOString();
      post.messageId = r.messageId;
      post.link = r.link;
      post.awaiting = false;
      delete post.error;
      await dequeue(postId);
      if (r.photoFileId && !media.tgFileId && post.mediaType === 'image') {
        await saveMedia(postId, { ...media, tgFileId: r.photoFileId });
      }
    } catch (e: any) {
      const msg = e?.message || 'Yuborish muvaffaqiyatsiz tugadi';
      post.attempts = (post.attempts || 0) + 1;
      post.error = msg;
      const transient = !(e instanceof TelegramError && e.permanent);
      if (opts.retry && transient && post.attempts < 3) {
        post.status = 'scheduled';
        await enqueue(postId, Date.now() + post.attempts * 2 * 60 * 1000);
      } else {
        post.status = 'failed';
        await dequeue(postId);
      }
    }
    await savePost(post);
    return post;
  } finally {
    await releaseLock(`send:${postId}`);
  }
}

export function zonedParts(date: Date, timeZone: string): { date: string; minutes: number; weekday: number; hour: number } {
  let tz = timeZone || 'Asia/Tashkent';
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  } catch {
    tz = 'Asia/Tashkent';
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  }
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute), weekday: wd, hour };
}

/** Kanal vaqt zonasidagi "YYYY-MM-DD" + "HH:MM" ni UTC ISO ga aylantiradi */
export function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const z = zonedParts(new Date(guess), timeZone);
    const [zy, zmo, zd] = z.date.split('-').map(Number);
    const shown = Date.UTC(zy, zmo - 1, zd, Math.floor(z.minutes / 60), z.minutes % 60);
    guess += asUtc - shown;
  }
  return new Date(guess);
}

/** Adminlarga tasdiqlash uchun post yuboradi. Rasm bo'lsa, Telegram file_id qaytaradi (keyin kanalga shu bilan yuboriladi). */
export async function notifyApproval(post: Post, channel: Channel, imageData?: string): Promise<string | undefined> {
  const admins = (await allAdminIds()).filter((id) => /^\d+$/.test(id));
  const appUrl = await resolveAppUrl();
  let fileId: string | undefined;

  const plain = htmlToPlain(post.text);
  const body = plainLength(post.text) > 3300 ? escapeHtml(plain.slice(0, 3300)) + '…' : post.text;
  const text = `🤖 <b>Avtopilot yangi post tayyorladi</b>\n📣 ${escapeHtml(channel.title)}\n\n${body}`;
  const keyboard: any[][] = [[
    { text: '✅ Kanalga yuborish', callback_data: `ap:${post.id}` },
    { text: "🗑 Rad etish", callback_data: `rj:${post.id}` },
  ]];
  if (appUrl) keyboard.push([{ text: "✏️ Ilovada tahrirlash", web_app: { url: appUrl } }]);

  for (const admin of admins) {
    let replyTo: number | undefined;
    if (imageData || fileId) {
      try {
        const f = new FormData();
        f.append('chat_id', admin);
        if (fileId) f.append('photo', fileId);
        else {
          const comma = imageData!.indexOf(',');
          const mime = imageData!.slice(0, comma).match(/data:(.*?);/)?.[1] || 'image/png';
          f.append('photo', new Blob([Buffer.from(imageData!.slice(comma + 1), 'base64')], { type: mime }), 'post.png');
        }
        const m = await tg<any>('sendPhoto', f);
        fileId ||= m.photo?.[m.photo.length - 1]?.file_id;
        replyTo = m.message_id;
      } catch {
        /* rasm yuborilmasa ham matn yuboriladi */
      }
    }
    await dm(admin, text, {
      reply_markup: { inline_keyboard: keyboard },
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    });
  }
  return fileId;
}

/** Bitta avtopilot posti: AI yozadi -> (tasdiq) -> kanalga yuboradi */
export async function autopilotOne(channel: Channel): Promise<string> {
  const ap = channel.autopilot;
  const idx = await nextCounter(`apidx:${channel.id}`);
  const topic = ap.topics.length ? ap.topics[(idx - 1) % ap.topics.length] : '';
  const templateType = ap.templates.length ? ap.templates[(idx - 1) % ap.templates.length] : 'custom';
  if (!topic && !channel.niche.trim()) {
    throw new Error("Avtopilot uchun kanal yo'nalishi (niche) yoki mavzular ro'yxati kiritilmagan");
  }
  const recent = (await listPosts(channel.id)).slice(0, 15).map((p) => p.topic);

  const gen = await generatePost({
    topic,
    autoTopic: !topic,
    templateType,
    tone: channel.tone,
    language: channel.language,
    signature: channel.signature,
    niche: channel.niche,
    audience: channel.audience,
    channelTitle: channel.title,
    hasImage: ap.withImage,
    recentTopics: recent,
    useSearch: templateType === 'news',
  });

  let imageData: string | undefined;
  if (ap.withImage) {
    try {
      imageData = await generateImage(gen.imagePrompt, '1:1');
    } catch {
      imageData = undefined; // rasmsiz davom etamiz
    }
  }

  const post: Post = {
    id: newId(),
    channelId: channel.id,
    topic: topic || gen.title,
    templateType,
    tone: channel.tone,
    language: channel.language,
    text: gen.text,
    mediaType: imageData ? 'image' : 'none',
    hasImage: false,
    status: 'draft',
    createdAt: new Date().toISOString(),
    source: 'autopilot',
  };

  if (ap.requireApproval) {
    post.awaiting = true;
    const fileId = await notifyApproval(post, channel, imageData);
    if (fileId) await saveMedia(post.id, { tgFileId: fileId });
    else if (imageData && imageData.length < 900_000) {
      await saveMedia(post.id, { imageData });
      post.hasImage = true;
    } else {
      post.mediaType = 'none';
    }
    await savePost(post);
    return `${channel.title}: tasdiqlash uchun yuborildi`;
  }

  await savePost(post);
  if (imageData) await saveMedia(post.id, {}); // rasm bazaga saqlanmaydi (hajm), faqat yuboriladi
  post.status = 'sending';
  try {
    const r = await sendPostToChannel(channel, post, { imageData });
    post.status = 'sent';
    post.sentAt = new Date().toISOString();
    post.messageId = r.messageId;
    post.link = r.link;
    if (r.photoFileId) await saveMedia(post.id, { tgFileId: r.photoFileId });
    await savePost(post);
    return `${channel.title}: post yuborildi`;
  } catch (e: any) {
    post.status = 'failed';
    post.error = e?.message || 'Yuborilmadi';
    await savePost(post);
    throw new Error(post.error);
  }
}

async function runAutopilot(budgetEndMs: number): Promise<string[]> {
  const logs: string[] = [];
  const channels = (await listChannels()).filter((c) => c.autopilot?.enabled && c.autopilot.times?.length);
  const now = new Date();

  for (const channel of channels) {
    const local = zonedParts(now, channel.timezone);
    for (const slot of channel.autopilot.times) {
      const m = slot.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) continue;
      const diff = local.minutes - (Number(m[1]) * 60 + Number(m[2]));
      if (diff < 0 || diff > 30) continue; // faqat oxirgi 30 daqiqa ichidagi slotlar

      if (Date.now() > budgetEndMs - 35_000) {
        logs.push('Vaqt yetmadi, keyingi ishga tushishda davom etadi');
        return logs;
      }
      const slotKey = `${channel.id}:${local.date}:${slot}`;
      if (!(await claimSlot(slotKey))) continue;
      try {
        logs.push(await autopilotOne(channel));
      } catch (e: any) {
        const fails = await nextCounter(`slotfail:${slotKey}`);
        if (fails < 3) await releaseSlot(slotKey);
        else {
          for (const a of (await allAdminIds()).filter((id) => /^\d+$/.test(id))) {
            await dm(a, `⚠️ <b>Avtopilot xatosi</b> (${escapeHtml(channel.title)}, ${slot})\n${escapeHtml(e?.message || 'Noma\'lum xato')}`);
          }
        }
        logs.push(`${channel.title} ${slot}: xato — ${e?.message}`);
      }
    }
  }
  return logs;
}

export async function runCron() {
  const startedAt = Date.now();
  const budgetEnd = startedAt + 55_000;
  await setMeta('cronLast', new Date().toISOString());

  let sent = 0;
  let failed = 0;
  const ids = await dueQueue(Date.now(), 25);
  for (const id of ids) {
    if (Date.now() > budgetEnd - 12_000) break;
    const p = await getPost(id);
    if (!p || p.status !== 'scheduled') {
      await dequeue(id);
      continue;
    }
    try {
      const r = await deliverPost(id, { retry: true });
      if (r.status === 'sent') sent++;
      else if (r.status === 'failed') {
        failed++;
        const channel = await getChannel(r.channelId);
        for (const a of (await allAdminIds()).filter((x) => /^\d+$/.test(x))) {
          await dm(a, `❌ <b>Rejalashtirilgan post yuborilmadi</b> (${escapeHtml(channel?.title || '')})\n<i>${escapeHtml(r.topic)}</i>\n${escapeHtml(r.error || '')}`);
        }
      }
    } catch {
      /* boshqa jarayon yuborayotgan bo'lishi mumkin */
    }
  }

  const autopilot = await runAutopilot(budgetEnd);
  return { sent, failed, autopilot, tookMs: Date.now() - startedAt };
}

