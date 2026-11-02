import { generateFile, generateImage, generatePost, planIdeas, rewriteText } from './ai.js';
import { allAdminIds, authenticate, checkCronSecret, checkPassword, createPasswordToken, isOwner, webhookSecret } from './auth.js';
import { deliverPost, resolveAppUrl, runCron, zonedParts, zonedToUtc } from './core.js';
import { dbConfigured, getDb } from './db.js';
import { env } from './env.js';
import { HttpError, header, originOf, type Req, type Res } from './http.js';
import {
  addExtraAdmin,
  canAccessChannel,
  consumeQuota,
  dequeue,
  deleteChannel,
  deletePost,
  enqueue,
  getChannel,
  getMedia,
  getMeta,
  getPost,
  getPostFull,
  getQuota,
  listChannels,
  listChannelsFor,
  listExtraAdmins,
  listPosts,
  listPostsFor,
  newChannel,
  newId,
  removeExtraAdmin,
  saveChannel,
  saveMedia,
  savePost,
  setMeta,
  setQuotaLimit,
  DEFAULT_AUTOPILOT,
} from './store.js';
import { assertUserIsChannelAdmin, dm, fetchChannelInfo, getMe, normalizeChatRef, sendPostToChannel, tg } from './telegram.js';
import { handleUpdate } from './webhook.js';
import { escapeHtml, plainLength, sanitizeTelegramHtml } from '../../shared/telegramHtml.js';
import { TEMPLATE_IDS, TONE_IDS, LANGUAGE_IDS } from '../../shared/types.js';
import type { Autopilot, Channel, Post, SessionInfo, StatsResult } from '../../shared/types.js';

interface Ctx {
  req: Req;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  session: SessionInfo | null;
}
type Handler = (c: Ctx) => Promise<any>;
type AuthMode = 'none' | 'admin' | 'owner' | 'cron';
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  auth: AuthMode;
  handler: Handler;
}

const routes: Route[] = [];
function add(method: string, pattern: string, auth: AuthMode, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_m, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, auth, handler });
}

const MAX_IMAGE_CHARS = 950_000;
const MAX_FILE_CHARS = 900_000;

const str = (v: any, max: number) => String(v ?? '').trim().slice(0, max);
const isTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

async function mustChannel(id: string | undefined, session?: SessionInfo | null): Promise<Channel> {
  if (!id) throw new HttpError(404, 'Kanal topilmadi');
  if (session) {
    const c = await canAccessChannel(session, String(id));
    if (!c) throw new HttpError(404, 'Kanal topilmadi yoki ruxsat yo\'q');
    return c;
  }
  const c = await getChannel(String(id));
  if (!c) throw new HttpError(404, 'Kanal topilmadi');
  return c;
}

// ======================= Ommaviy =======================
add('GET', '/health', 'none', async () => ({
  success: true,
  bot: !!env.botToken,
  gemini: !!env.geminiKey,
  db: dbConfigured(),
  admins: env.adminIds.length > 0,
  cron: !!env.cronSecret,
  passwordLogin: !!env.adminPassword,
}));

add('POST', '/auth/login', 'none', async ({ body }) => {
  if (!env.adminPassword) throw new HttpError(400, 'Parol bilan kirish yoqilmagan (ADMIN_PASSWORD yo\'q)');
  if (!checkPassword(String(body?.password || ''))) {
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(401, "Parol noto'g'ri");
  }
  return { success: true, token: createPasswordToken() };
});

add('POST', '/telegram/webhook', 'none', async ({ req, body }) => {
  if (header(req, 'x-telegram-bot-api-secret-token') !== webhookSecret()) throw new HttpError(401, 'Noto\'g\'ri kalit');
  await handleUpdate(body);
  return { ok: true };
});

async function cronHandler() {
  return { success: true, ...(await runCron()) };
}
add('GET', '/cron', 'cron', cronHandler);
add('POST', '/cron', 'cron', cronHandler);

add('GET', '/setup', 'cron', async ({ req }) => {
  const origin = env.appUrl || originOf(req);
  await setMeta('appUrl', origin);
  const steps: { name: string; ok: boolean; info: string }[] = [];
  const run = async (name: string, fn: () => Promise<any>) => {
    try {
      await fn();
      steps.push({ name, ok: true, info: 'OK' });
    } catch (e: any) {
      steps.push({ name, ok: false, info: e?.message || 'xato' });
    }
  };

  let botName = '';
  await run('Bot tokenini tekshirish', async () => {
    botName = (await getMe()).username;
  });
  await run('Webhook ulash', () =>
    tg('setWebhook', {
      url: `${origin}/api/telegram/webhook`,
      secret_token: webhookSecret(),
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      drop_pending_updates: true,
    })
  );
  await run('Bot buyruqlari', () =>
    tg('setMyCommands', {
      commands: [
        { command: 'start', description: 'Ilovani ochish' },
        { command: 'kanallar', description: 'Ulangan kanallar' },
        { command: 'id', description: 'Telegram ID ni bilish' },
        { command: 'help', description: 'Yordam' },
      ],
    })
  );
  await run('Menyu tugmasi (Mini App)', () => tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'TelePost', web_app: { url: origin } } }));
  await run('Kanal admin huquqlari andozasi', () =>
    tg('setMyDefaultAdministratorRights', {
      for_channels: true,
      rights: {
        is_anonymous: false,
        can_manage_chat: true,
        can_delete_messages: true,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_promote_members: false,
        can_change_info: false,
        can_invite_users: true,
        can_post_messages: true,
        can_edit_messages: true,
        can_pin_messages: false,
        can_manage_topics: false,
      },
    })
  );

  const rows = steps
    .map((s) => `<tr><td>${s.ok ? '✅' : '❌'}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.info)}</td></tr>`)
    .join('');
  const html = `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TelePost sozlash</title>
<body style="font-family:system-ui;background:#0b1120;color:#e2e8f0;max-width:640px;margin:32px auto;padding:0 16px">
<h2>TelePost AI — sozlash natijasi</h2><p>Manzil: <b>${escapeHtml(origin)}</b></p>
<table cellpadding="8" style="border-collapse:collapse;width:100%">${rows}</table>
<h3>Keyingi qadamlar</h3><ol>
<li>Telegramda ${botName ? `<b>@${escapeHtml(botName)}</b>` : 'botingiz'} ga <code>/start</code> yozing — ilova tugmasi chiqadi.</li>
<li>Botni kanalingizga <b>administrator</b> qilib qo'shing (Post Messages huquqi bilan) — kanal avtomatik ulanadi.</li>
<li>Rejalashtirish va avtopilot uchun <b>cron-job.org</b> da har 1 daqiqada <code>${escapeHtml(origin)}/api/cron?key=CRON_SECRET</code> manzilini chaqirtiring.</li></ol></body></html>`;
  return { __html: html };
});

// ======================= Sessiya va holat =======================
add('GET', '/me', 'admin', async ({ session }) => ({ success: true, user: session }));

add('GET', '/status', 'admin', async () => {
  let bot: any = null;
  let webhook: any = null;
  try {
    bot = await getMe();
    webhook = await tg('getWebhookInfo');
  } catch (e: any) {
    bot = bot || { error: e?.message };
  }
  const channels = await listChannels();
  return {
    success: true,
    bot: bot ? { username: bot.username, error: bot.error } : null,
    webhook: webhook ? { url: webhook.url, pending: webhook.pending_update_count, lastError: webhook.last_error_message } : null,
    webhookOk: !!webhook?.url && webhook.url.endsWith('/api/telegram/webhook'),
    cronLast: await getMeta('cronLast'),
    db: getDb().kind,
    gemini: !!env.geminiKey,
    cronSecret: !!env.cronSecret,
    textModel: env.textModel,
    imageModel: env.imageModel,
    appUrl: await resolveAppUrl(),
    channels: channels.length,
  };
});

// ======================= Kanallar =======================
add('GET', '/channels', 'admin', async ({ session }) => ({
  success: true,
  channels: await listChannelsFor(session!),
}));

add('POST', '/channels', 'admin', async ({ body, session }) => {
  if (!session) throw new HttpError(401, 'Avtorizatsiya kerak');
  const ref = normalizeChatRef(String(body?.chat || ''));
  if (!ref) throw new HttpError(400, "Kanal username'i yoki ID sini kiriting (masalan @kanalim)");
  let info: Channel;
  try {
    info = await fetchChannelInfo(ref);
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    if (/chat not found/i.test(e?.message)) throw new HttpError(400, "Kanal topilmadi. Username to'g'riligini va bot kanalga qo'shilganini tekshiring.");
    throw new HttpError(400, e?.message || 'Kanalni tekshirib bo\'lmadi');
  }
  // Foydalanuvchi o'zi kanal admini ekanligini tekshirish (owner ham)
  if (session.id !== 'password') {
    await assertUserIsChannelAdmin(info.id, session.id);
  }
  const existing = await getChannel(info.id);
  // Boshqa adminning kanalini tortib olish mumkin emas
  if (existing && existing.addedBy && existing.addedBy !== session.id && session.role !== 'owner') {
    throw new HttpError(403, 'Bu kanal allaqachon boshqa admin tomonidan ulangan');
  }
  const channel = existing
    ? { ...existing, title: info.title, username: info.username, memberCount: info.memberCount, memberCountAt: info.memberCountAt }
    : newChannel({ ...info, addedBy: session.id, signature: info.username ? `👉 @${info.username}` : '' });
  await saveChannel(channel);
  return { success: true, channel };
});

function sanitizeAutopilot(input: any, current: Autopilot): Autopilot {
  const a = input || {};
  const times = Array.isArray(a.times)
    ? [...new Set<string>(a.times.map((t: any) => String(t)).filter((t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)).map((t: string) => t.padStart(5, '0')))].sort().slice(0, 8)
    : current.times;
  const weekdays = Array.isArray(a.weekdays)
    ? [...new Set<number>(a.weekdays.map((d: any) => Number(d)).filter((d: number) => d >= 0 && d <= 6))].sort().slice(0, 7)
    : current.weekdays || [];
  const topics = Array.isArray(a.topics) ? a.topics.map((t: any) => str(t, 200)).filter(Boolean).slice(0, 30) : current.topics;
  const templates = Array.isArray(a.templates) ? a.templates.filter((t: any) => (TEMPLATE_IDS as readonly string[]).includes(t)).slice(0, 8) : current.templates;
  let approvalDeadlineHours = current.approvalDeadlineHours ?? 24;
  if (a.approvalDeadlineHours !== undefined) {
    const n = Number(a.approvalDeadlineHours);
    if (Number.isFinite(n)) approvalDeadlineHours = Math.min(168, Math.max(1, Math.floor(n)));
  }
  return {
    enabled: typeof a.enabled === 'boolean' ? a.enabled : current.enabled,
    times,
    weekdays,
    topics,
    templates,
    withImage: typeof a.withImage === 'boolean' ? a.withImage : current.withImage,
    requireApproval: typeof a.requireApproval === 'boolean' ? a.requireApproval : current.requireApproval,
    approvalDeadlineHours,
  };
}

add('PUT', '/channels/:id', 'admin', async ({ params, body, session }) => {
  const c = await mustChannel(params.id, session);
  const b = body || {};
  if (b.signature !== undefined) c.signature = str(b.signature, 300);
  if (b.tone !== undefined && (TONE_IDS as readonly string[]).includes(b.tone)) c.tone = b.tone;
  if (b.language !== undefined && (LANGUAGE_IDS as readonly string[]).includes(b.language)) c.language = b.language;
  if (b.niche !== undefined) c.niche = str(b.niche, 600);
  if (b.audience !== undefined) c.audience = str(b.audience, 300);
  if (b.timezone !== undefined) {
    if (!isTz(String(b.timezone))) throw new HttpError(400, "Vaqt zonasi noto'g'ri (masalan Asia/Tashkent)");
    c.timezone = String(b.timezone);
  }
  if (b.autopilot !== undefined) {
    c.autopilot = sanitizeAutopilot(b.autopilot, c.autopilot);
    if (c.autopilot.enabled && !c.autopilot.times.length) throw new HttpError(400, 'Avtopilot uchun kamida bitta vaqt belgilang');
    if (c.autopilot.enabled && !c.autopilot.topics.length && !c.niche) {
      throw new HttpError(400, "Avtopilot uchun kanal yo'nalishini (niche) yozing yoki mavzular ro'yxatini kiriting");
    }
  }
  await saveChannel(c);
  return { success: true, channel: c };
});

add('DELETE', '/channels/:id', 'admin', async ({ params, session }) => {
  await mustChannel(params.id, session);
  await deleteChannel(params.id);
  return { success: true };
});

add('POST', '/channels/:id/refresh', 'admin', async ({ params, session }) => {
  const c = await mustChannel(params.id, session);
  const info = await fetchChannelInfo(c.id);
  c.title = info.title;
  c.username = info.username;
  c.memberCount = info.memberCount;
  c.memberCountAt = info.memberCountAt;
  await saveChannel(c);
  return { success: true, channel: c };
});

add('POST', '/channels/:id/test', 'admin', async ({ params, session }) => {
  const c = await mustChannel(params.id, session);
  const r = await sendPostToChannel(c, {
    text: `🚀 <b>TelePost AI ulandi!</b>\n\nBu sinov xabari — kanal admini ilovasi orqali yuborildi.\n#TelePostAI`,
    mediaType: 'none',
  });
  return { success: true, link: r.link, messageId: r.messageId };
});

// ======================= Postlar =======================
function pickMedia(b: any) {
  let imageData: string | undefined;
  if (typeof b.imageData === 'string' && b.imageData) {
    if (b.imageData.length > MAX_IMAGE_CHARS) throw new HttpError(413, "Rasm hajmi katta. Kichikroq rasm tanlang yoki qayta siqing.");
    if (!/^(data:image\/(png|jpe?g|webp);base64,|https:\/\/)/i.test(b.imageData)) throw new HttpError(400, "Rasm formati noto'g'ri");
    imageData = b.imageData;
  }
  let fileData: any;
  if (b.fileData && typeof b.fileData.content === 'string') {
    if (b.fileData.content.length > MAX_FILE_CHARS) throw new HttpError(413, 'Fayl hajmi katta (maks ~900 KB)');
    fileData = {
      name: str(b.fileData.name || 'fayl.txt', 120).replace(/[\\/:*?"<>|]/g, '_'),
      content: b.fileData.content,
      mimeType: str(b.fileData.mimeType || 'text/plain', 100),
      sizeBytes: Buffer.byteLength(b.fileData.content, 'utf8'),
      summary: b.fileData.summary ? str(b.fileData.summary, 200) : undefined,
    };
  }
  return { imageData, fileData };
}

function pickCta(c: any) {
  if (!c || !c.text || !c.url) return undefined;
  const url = String(c.url).trim();
  const full = /^(https?:\/\/|tg:\/\/)/i.test(url) ? url : `https://${url}`;
  try {
    new URL(full.replace(/^tg:\/\//i, 'https://'));
  } catch {
    throw new HttpError(400, "Tugma havolasi noto'g'ri");
  }
  return { text: str(c.text, 64), url: full };
}

function parseSchedule(v: any): string {
  const d = new Date(String(v || ''));
  if (isNaN(d.getTime())) throw new HttpError(400, "Rejalashtirish vaqti noto'g'ri");
  if (d.getTime() < Date.now() - 60_000) throw new HttpError(400, "Tanlangan vaqt o'tib ketgan");
  return d.toISOString();
}

function publicPost(p: Post): Post {
  return p;
}

add('GET', '/posts', 'admin', async ({ query, session }) => {
  let posts = await listPostsFor(session!, query.channelId || undefined);
  if (query.status) posts = posts.filter((p) => p.status === query.status);
  return { success: true, posts: posts.slice(0, 300).map(publicPost) };
});

add('GET', '/posts/:id', 'admin', async ({ params, session }) => {
  const post = await getPostFull(params.id);
  if (!post) throw new HttpError(404, 'Post topilmadi');
  await mustChannel(post.channelId, session); // ruxsat tekshiruvi
  return { success: true, post };
});

add('POST', '/posts', 'admin', async ({ body, session }) => {
  const b = body || {};
  const channel = await mustChannel(b.channelId, session);
  const { imageData, fileData } = pickMedia(b);
  const text = sanitizeTelegramHtml(String(b.text || ''));
  const mediaType = imageData ? 'image' : fileData ? 'file' : 'none';
  if (!text && mediaType === 'none') throw new HttpError(400, "Post matni bo'sh");
  if (plainLength(text) > 4096) throw new HttpError(400, 'Matn 4096 belgidan oshmasligi kerak');

  const wanted = b.status === 'sent' ? 'sent' : b.status === 'scheduled' ? 'scheduled' : 'draft';
  const post: Post = {
    id: newId(),
    channelId: channel.id,
    topic: str(b.topic, 300) || 'Nomsiz post',
    templateType: (TEMPLATE_IDS as readonly string[]).includes(b.templateType) ? b.templateType : 'custom',
    tone: str(b.tone, 30) || channel.tone,
    language: str(b.language, 10) || channel.language,
    text,
    mediaType,
    hasImage: !!imageData,
    thumb: typeof b.thumb === 'string' && b.thumb.length < 40_000 ? b.thumb : undefined,
    file: fileData ? { name: fileData.name, mimeType: fileData.mimeType, sizeBytes: fileData.sizeBytes, summary: fileData.summary } : undefined,
    cta: pickCta(b.cta),
    status: 'draft',
    createdAt: new Date().toISOString(),
    source: b.source === 'plan' ? 'plan' : 'manual',
  };

  if (wanted === 'scheduled') {
    post.status = 'scheduled';
    post.scheduledFor = parseSchedule(b.scheduledFor);
  }
  await savePost(post);
  await saveMedia(post.id, { imageData, fileData });

  if (wanted === 'scheduled') {
    await enqueue(post.id, new Date(post.scheduledFor!).getTime());
    return { success: true, post };
  }
  if (wanted === 'sent') {
    const sent = await deliverPost(post.id);
    return { success: true, post: sent };
  }
  return { success: true, post };
});

add('PUT', '/posts/:id', 'admin', async ({ params, body }) => {
  const post = await getPost(params.id);
  if (!post) throw new HttpError(404, 'Post topilmadi');
  if (post.status === 'sent') throw new HttpError(409, "Yuborilgan postni tahrirlab bo'lmaydi. Nusxa oling.");
  if (post.status === 'sending') throw new HttpError(409, 'Post hozir yuborilmoqda');
  const b = body || {};

  if (b.topic !== undefined) post.topic = str(b.topic, 300) || post.topic;
  if (b.text !== undefined) {
    post.text = sanitizeTelegramHtml(String(b.text));
    if (plainLength(post.text) > 4096) throw new HttpError(400, 'Matn 4096 belgidan oshmasligi kerak');
  }
  if (b.cta !== undefined) post.cta = pickCta(b.cta);
  if (b.templateType !== undefined && (TEMPLATE_IDS as readonly string[]).includes(b.templateType)) post.templateType = b.templateType;

  if ('imageData' in b || 'fileData' in b) {
    const { imageData, fileData } = pickMedia(b);
    const media = await getMedia(post.id);
    if ('imageData' in b) {
      media.imageData = imageData;
      delete media.tgFileId;
      post.hasImage = !!imageData;
      post.thumb = imageData && typeof b.thumb === 'string' && b.thumb.length < 40_000 ? b.thumb : undefined;
    }
    if ('fileData' in b) {
      media.fileData = fileData;
      post.file = fileData ? { name: fileData.name, mimeType: fileData.mimeType, sizeBytes: fileData.sizeBytes, summary: fileData.summary } : undefined;
    }
    post.mediaType = media.imageData || media.tgFileId ? 'image' : media.fileData ? 'file' : 'none';
    await saveMedia(post.id, media);
  }

  if (b.status === 'scheduled') {
    post.status = 'scheduled';
    post.scheduledFor = parseSchedule(b.scheduledFor ?? post.scheduledFor);
    post.awaiting = false;
    post.attempts = 0;
    delete post.error;
    await enqueue(post.id, new Date(post.scheduledFor).getTime());
  } else if (b.status === 'draft') {
    post.status = 'draft';
    delete post.scheduledFor;
    delete post.error;
    await dequeue(post.id);
  } else if (post.status === 'failed') {
    post.status = 'draft';
    delete post.error;
  }

  if (!post.text && post.mediaType === 'none') throw new HttpError(400, "Post matni bo'sh");
  await savePost(post);
  return { success: true, post };
});

add('DELETE', '/posts/:id', 'admin', async ({ params, query }) => {
  const post = await getPost(params.id);
  if (!post) return { success: true };
  if (query.fromChannel === '1' && post.status === 'sent' && post.messageId) {
    try {
      await tg('deleteMessage', { chat_id: post.channelId, message_id: post.messageId });
    } catch (e: any) {
      throw new HttpError(502, `Kanaldan o'chirib bo'lmadi: ${e?.message}`);
    }
  }
  await deletePost(params.id);
  return { success: true };
});

add('POST', '/posts/:id/send', 'admin', async ({ params }) => {
  const post = await getPost(params.id);
  if (!post) throw new HttpError(404, 'Post topilmadi');
  if (post.status === 'sending') throw new HttpError(409, 'Post hozir yuborilmoqda');
  const r = await deliverPost(params.id);
  if (r.status === 'failed') throw new HttpError(502, r.error || 'Yuborib bo\'lmadi');
  return { success: true, post: r };
});

add('POST', '/posts/:id/duplicate', 'admin', async ({ params }) => {
  const src = await getPost(params.id);
  if (!src) throw new HttpError(404, 'Post topilmadi');
  const media = await getMedia(src.id);
  const copy: Post = {
    ...src,
    id: newId(),
    status: 'draft',
    createdAt: new Date().toISOString(),
    topic: src.topic,
    source: 'manual',
  };
  delete copy.scheduledFor;
  delete copy.sentAt;
  delete copy.messageId;
  delete copy.link;
  delete copy.error;
  delete copy.attempts;
  delete copy.awaiting;
  await savePost(copy);
  await saveMedia(copy.id, media);
  return { success: true, post: copy };
});

// ======================= AI =======================
async function checkAiQuota(session: SessionInfo | null) {
  if (!session || session.id === 'password' || session.role === 'owner') return; // owner cheksiz
  const { ok, quota } = await consumeQuota(session.id, 1);
  if (!ok) {
    throw new HttpError(429, `AI kunlik limiti tugadi (${quota.usedToday}/${quota.dailyLimit}). Super admin kvotani oshirishi mumkin.`);
  }
}

add('POST', '/ai/post', 'admin', async ({ body, session }) => {
  await checkAiQuota(session);
  const b = body || {};
  let channel = null;
  if (b.channelId) {
    channel = await mustChannel(String(b.channelId), session);
  }
  const auto = !!b.auto;
  const topic = str(b.topic, 1000);
  if (!auto && !topic) throw new HttpError(400, 'Mavzu kiritilishi shart');
  const recent = channel ? (await listPosts(channel.id)).slice(0, 12).map((p) => p.topic) : [];
  const templateType = (TEMPLATE_IDS as readonly string[]).includes(b.templateType) ? b.templateType : 'custom';
  const data = await generatePost({
    topic,
    autoTopic: auto,
    templateType,
    tone: str(b.tone, 30) || channel?.tone || "do'stona",
    language: str(b.language, 10) || channel?.language || 'uz-lat',
    signature: b.includeSignature === false ? '' : channel?.signature,
    niche: channel?.niche,
    audience: channel?.audience,
    channelTitle: channel?.title,
    hasImage: !!b.hasImage,
    wantFile: !!b.wantFile,
    fileRequest: str(b.fileRequest, 400),
    recentTopics: recent,
    useSearch: templateType === 'news',
  });
  return { success: true, data };
});

add('POST', '/ai/image', 'admin', async ({ body, session }) => {
  await checkAiQuota(session);
  const prompt = str(body?.prompt, 1500);
  if (!prompt) throw new HttpError(400, 'Rasm tavsifi kiritilmagan');
  const ratio = ['1:1', '16:9', '4:3', '3:4', '9:16'].includes(body?.aspectRatio) ? body.aspectRatio : '1:1';
  return { success: true, imageUrl: await generateImage(prompt, ratio) };
});

add('POST', '/ai/file', 'admin', async ({ body, session }) => {
  await checkAiQuota(session);
  const topic = str(body?.topic, 500);
  if (!topic) throw new HttpError(400, 'Mavzu kiritilmagan');
  const fileData = await generateFile(topic, str(body?.fileType, 60) || "Qo'llanma", str(body?.instructions, 500), str(body?.language, 10) || 'uz-lat');
  return { success: true, fileData };
});

add('POST', '/ai/rewrite', 'admin', async ({ body, session }) => {
  await checkAiQuota(session);
  const text = String(body?.text || '');
  if (!text.trim()) throw new HttpError(400, "Matn bo'sh");
  return { success: true, text: await rewriteText(text.slice(0, 6000), String(body?.action || '')) };
});

add('POST', '/ai/plan', 'admin', async ({ body, session }) => {
  await checkAiQuota(session);
  const b = body || {};
  const channel = await mustChannel(b.channelId, session);
  const days = Math.min(Math.max(parseInt(b.days) || 7, 1), 14);
  const perDay = Math.min(Math.max(parseInt(b.perDay) || 1, 1), 3);
  const defaults: Record<number, string[]> = { 1: ['10:00'], 2: ['09:00', '19:00'], 3: ['09:00', '14:00', '19:00'] };
  let times: string[] =
    Array.isArray(b.times) && b.times.length
      ? b.times.map(String).filter((t: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(t)).map((t: string) => t.padStart(5, '0')).sort()
      : defaults[perDay];
  times = [...new Set(times)].slice(0, 3);
  if (!times.length) times = defaults[perDay];
  const count = days * times.length;

  const recent = (await listPosts(channel.id)).slice(0, 15).map((p) => p.topic);
  const ideas = await planIdeas({
    niche: channel.niche,
    audience: channel.audience,
    language: channel.language,
    count,
    focus: str(b.focus, 400),
    recentTopics: recent,
  });

  // Vaqt oraliqlarini serverda aniq belgilaymiz (kanal vaqt zonasida), o'tib ketganlarini tashlab ketamiz
  const now = Date.now();
  const slots: { day: string; time: string; at: Date }[] = [];
  const start = new Date();
  for (let off = 0; slots.length < ideas.length && off < 40; off++) {
    const probe = new Date(start.getTime() + off * 86400000);
    const day = zonedParts(probe, channel.timezone).date;
    for (const time of times) {
      const at = zonedToUtc(day, time, channel.timezone);
      if (at.getTime() > now + 5 * 60_000 && slots.length < ideas.length) slots.push({ day, time, at });
    }
  }
  const result = ideas.slice(0, slots.length).map((idea, i) => ({
    ...idea,
    day: slots[i].day,
    time: slots[i].time,
    scheduledFor: slots[i].at.toISOString(),
  }));
  return { success: true, ideas: result, timezone: channel.timezone };
});

// ======================= Statistika =======================
add('GET', '/stats', 'admin', async ({ query, session }) => {
  const channel = query.channelId ? await mustChannel(query.channelId, session) : null;
  const tz = channel?.timezone || 'Asia/Tashkent';
  const posts = channel ? await listPosts(channel.id) : await listPostsFor(session!);
  const sent = posts.filter((p) => p.status === 'sent' && p.sentAt);

  // A'zolar sonini yangilash (30 daqiqada bir marta)
  if (channel && (!channel.memberCountAt || Date.now() - new Date(channel.memberCountAt).getTime() > 30 * 60_000)) {
    try {
      channel.memberCount = await tg('getChatMemberCount', { chat_id: channel.id });
      channel.memberCountAt = new Date().toISOString();
      await saveChannel(channel);
    } catch {
      /* ixtiyoriy */
    }
  }

  const byDate: Record<string, number> = {};
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  const byTemplate: Record<string, number> = {};
  for (const p of sent) {
    const z = zonedParts(new Date(p.sentAt!), tz);
    byDate[z.date] = (byDate[z.date] || 0) + 1;
    byHour[z.hour]++;
    byWeekday[z.weekday]++;
    byTemplate[p.templateType] = (byTemplate[p.templateType] || 0) + 1;
  }

  const last30: { date: string; count: number }[] = [];
  const nowMs = Date.now();
  for (let i = 29; i >= 0; i--) {
    const date = zonedParts(new Date(nowMs - i * 86400000), tz).date;
    last30.push({ date, count: byDate[date] || 0 });
  }
  let streak = 0;
  for (let i = last30.length - 1; i >= 0; i--) {
    if (last30[i].count > 0) streak++;
    else if (i === last30.length - 1) continue; // bugun hali post yo'q bo'lishi mumkin
    else break;
  }
  const last28 = last30.slice(2).reduce((s, d) => s + d.count, 0);
  const scheduled = posts.filter((p) => p.status === 'scheduled' && p.scheduledFor).map((p) => p.scheduledFor!).sort();

  const stats: StatsResult = {
    totals: {
      all: posts.length,
      sent: sent.length,
      scheduled: posts.filter((p) => p.status === 'scheduled').length,
      drafts: posts.filter((p) => p.status === 'draft').length,
      failed: posts.filter((p) => p.status === 'failed').length,
    },
    media: {
      image: posts.filter((p) => p.mediaType === 'image').length,
      file: posts.filter((p) => p.mediaType === 'file').length,
      text: posts.filter((p) => p.mediaType === 'none').length,
    },
    memberCount: channel?.memberCount || 0,
    last30,
    byHour,
    byWeekday,
    byTemplate,
    streak,
    perWeek: Math.round((last28 / 4) * 10) / 10,
    lastSentAt: sent.map((p) => p.sentAt!).sort().pop(),
    nextScheduledAt: scheduled[0],
    autopilotCount: sent.filter((p) => p.source === 'autopilot').length,
  };
  return { success: true, stats };
});

// ======================= Adminlar (faqat ega) =======================
// Super admin ID lari hech kimga ochilmaydi — faqat qo'shimcha adminlar ro'yxati
add('GET', '/admins', 'owner', async () => {
  const admins = await listExtraAdmins();
  const quotas: Record<string, Awaited<ReturnType<typeof getQuota>>> = {};
  for (const id of admins) quotas[id] = await getQuota(id);
  return { success: true, admins, quotas };
});

add('POST', '/admins', 'owner', async ({ body }) => {
  const id = String(body?.id || '').trim();
  if (!/^\d{4,15}$/.test(id)) throw new HttpError(400, "Telegram ID faqat raqamlardan iborat bo'lishi kerak");
  if (isOwner(id)) throw new HttpError(400, 'Bu foydalanuvchi allaqachon ega');
  await addExtraAdmin(id);
  const limit = Number(body?.dailyLimit);
  if (Number.isFinite(limit) && limit >= 0) await setQuotaLimit(id, limit);
  const admins = await listExtraAdmins();
  const quotas: Record<string, Awaited<ReturnType<typeof getQuota>>> = {};
  for (const aid of admins) quotas[aid] = await getQuota(aid);
  return { success: true, admins, quotas };
});

add('DELETE', '/admins/:id', 'owner', async ({ params }) => {
  await removeExtraAdmin(params.id);
  const admins = await listExtraAdmins();
  return { success: true, admins };
});

add('PUT', '/admins/:id/quota', 'owner', async ({ params, body }) => {
  const id = String(params.id || '').trim();
  if (!/^\d{4,15}$/.test(id)) throw new HttpError(400, 'Noto\'g\'ri ID');
  const limit = Number(body?.dailyLimit);
  if (!Number.isFinite(limit) || limit < 0) throw new HttpError(400, 'dailyLimit 0 yoki undan katta son bo\'lsin (0 = cheksiz)');
  const quota = await setQuotaLimit(id, limit);
  return { success: true, quota };
});

add('GET', '/me/quota', 'admin', async ({ session }) => {
  if (!session || session.id === 'password' || session.role === 'owner') {
    return { success: true, quota: { dailyLimit: 0, usedToday: 0, date: new Date().toISOString().slice(0, 10) } };
  }
  return { success: true, quota: await getQuota(session.id) };
});

/** Mini App dan botga preview yuborish (ilova ichida preview shart emas) */
add('POST', '/preview/send', 'admin', async ({ body, session }) => {
  if (!session || session.id === 'password') throw new HttpError(400, 'Faqat Telegram orqali');
  const text = sanitizeTelegramHtml(String(body?.text || ''));
  if (!text) throw new HttpError(400, 'Matn bo\'sh');
  const title = str(body?.title, 120) || 'Preview';
  await dm(session.id, `👁 <b>Preview: ${escapeHtml(title)}</b>\n\n${text}`);
  return { success: true };
});

// ======================= Dispetcher =======================
export async function handle(req: Req, res: Res) {
  const url = new URL(req.url || '/', 'http://localhost');
  let path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = (req.method || 'GET').toUpperCase();
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (method === 'OPTIONS') return res.status(204).end();

    let route: Route | undefined;
    let params: Record<string, string> = {};
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) {
        route = r;
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        break;
      }
    }
    if (!route) throw new HttpError(404, `Marshrut topilmadi: ${method} ${path}`);

    let session: SessionInfo | null = null;
    if (route.auth === 'cron') {
      if (!checkCronSecret(req)) throw new HttpError(401, "Ruxsat yo'q (CRON_SECRET noto'g'ri yoki sozlanmagan)");
    } else if (route.auth !== 'none') {
      session = await authenticate(req);
      if (!session) throw new HttpError(401, 'Kirish talab qilinadi');
      if (route.auth === 'owner' && session.role !== 'owner') throw new HttpError(403, 'Faqat ega uchun');
    }

    const query: Record<string, string> = Object.fromEntries(url.searchParams.entries());
    const out = await route.handler({ req, params, query, body: req.body, session });
    if (out && out.__html) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(out.__html);
    }
    return res.status(200).json(out ?? { success: true });
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error('API xatosi:', e);
    return res.status(status).json({ success: false, error: e?.message || 'Server xatosi' });
  }
}
