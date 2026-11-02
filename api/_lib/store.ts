import { getDb } from './db.js';
import type { AdminQuota, Autopilot, Channel, FileData, Post, PostFull } from '../../shared/types.js';

const K = {
  channels: 'tp:channels',
  posts: 'tp:posts',
  media: (id: string) => `tp:media:${id}`,
  queue: 'tp:queue',
  admins: 'tp:admins',
  quota: (id: string) => `tp:quota:${id}`,
  lock: (id: string) => `tp:lock:${id}`,
  meta: (k: string) => `tp:meta:${k}`,
};

export interface Media {
  imageData?: string;
  tgFileId?: string;
  fileData?: FileData;
}

const parse = <T>(s: string | null | undefined): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export const DEFAULT_AUTOPILOT: Autopilot = {
  enabled: false,
  times: ['09:00', '14:00', '19:00'],
  weekdays: [], // bo'sh = har kuni
  topics: [],
  templates: ['news', 'educational', 'motivation'],
  withImage: true,
  requireApproval: true,
  approvalDeadlineHours: 24,
};

export function newChannel(base: Partial<Channel> & { id: string; title: string }): Channel {
  return {
    memberCount: 0,
    signature: base.username ? `👉 @${base.username.replace(/^@/, '')}` : '',
    tone: "do'stona",
    language: 'uz-lat',
    niche: '',
    audience: '',
    timezone: 'Asia/Tashkent',
    maxPostChars: 900,
    createdAt: new Date().toISOString(),
    ...base,
    autopilot: { ...DEFAULT_AUTOPILOT, ...(base.autopilot || {}) },
  };
}

// ---------- Kanallar ----------
export async function listChannels(): Promise<Channel[]> {
  const all = await getDb().hgetall(K.channels);
  return Object.values(all)
    .map((v) => parse<Channel>(v))
    .filter((c): c is Channel => !!c)
    .map((c) => ({ ...c, autopilot: { ...DEFAULT_AUTOPILOT, ...(c.autopilot || {}) } }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Admin faqat o'z kanallarini, owner barchasini ko'radi */
export async function listChannelsFor(session: { id: string; role: string }): Promise<Channel[]> {
  const all = await listChannels();
  if (session.role === 'owner') return all;
  return all.filter((c) => c.addedBy === session.id);
}

export async function getChannel(id: string): Promise<Channel | null> {
  const c = parse<Channel>(await getDb().hget(K.channels, id));
  return c ? { ...c, autopilot: { ...DEFAULT_AUTOPILOT, ...(c.autopilot || {}) } } : null;
}

export async function canAccessChannel(session: { id: string; role: string }, channelId: string): Promise<Channel | null> {
  const c = await getChannel(channelId);
  if (!c) return null;
  if (session.role === 'owner') return c;
  if (c.addedBy === session.id) return c;
  return null;
}

export async function saveChannel(c: Channel) {
  await getDb().hset(K.channels, c.id, JSON.stringify(c));
}

export async function deleteChannel(id: string) {
  const db = getDb();
  await db.hdel(K.channels, id);
  const posts = await listPosts(id);
  for (const p of posts) await deletePost(p.id);
}

// ---------- Postlar ----------
export async function savePost(post: Post) {
  const db = getDb();
  post.updatedAt = new Date().toISOString();
  await db.hset(K.posts, post.id, JSON.stringify(post));
}

export async function getPost(id: string): Promise<Post | null> {
  return parse<Post>(await getDb().hget(K.posts, id));
}

export async function listPosts(channelId?: string): Promise<Post[]> {
  const all = await getDb().hgetall(K.posts);
  return Object.values(all)
    .map((v) => parse<Post>(v))
    .filter((p): p is Post => !!p && (!channelId || p.channelId === channelId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPostsFor(session: { id: string; role: string }, channelId?: string): Promise<Post[]> {
  const channels = await listChannelsFor(session);
  const allowed = new Set(channels.map((c) => c.id));
  let posts = await listPosts(channelId);
  if (session.role !== 'owner') {
    posts = posts.filter((p) => allowed.has(p.channelId));
  }
  return posts;
}

export async function deletePost(id: string) {
  const db = getDb();
  await db.hdel(K.posts, id);
  await db.del(K.media(id));
  await db.zrem(K.queue, id);
}

export async function getMedia(id: string): Promise<Media> {
  return parse<Media>(await getDb().get(K.media(id))) || {};
}

export async function saveMedia(id: string, media: Media) {
  if (!media.imageData && !media.tgFileId && !media.fileData) {
    await getDb().del(K.media(id));
    return;
  }
  await getDb().set(K.media(id), JSON.stringify(media));
}

export async function getPostFull(id: string): Promise<PostFull | null> {
  const post = await getPost(id);
  if (!post) return null;
  const media = await getMedia(id);
  return { ...post, imageData: media.imageData, fileData: media.fileData };
}

// ---------- Navbat (rejalashtirilgan postlar) ----------
export const enqueue = (id: string, whenMs: number) => getDb().zadd(K.queue, whenMs, id);
export const dequeue = (id: string) => getDb().zrem(K.queue, id);
export const dueQueue = (nowMs: number, limit = 20) => getDb().zrangebyscore(K.queue, 0, nowMs, limit);

// ---------- Adminlar ----------
export const listExtraAdmins = () => getDb().smembers(K.admins);
export const addExtraAdmin = (id: string) => getDb().sadd(K.admins, id);
export const removeExtraAdmin = (id: string) => getDb().srem(K.admins, id);

// ---------- AI kvota ----------
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getQuota(adminId: string): Promise<AdminQuota> {
  const raw = await getDb().get(K.quota(adminId));
  const q = parse<AdminQuota>(raw);
  const today = todayUtc();
  if (!q) return { dailyLimit: 0, usedToday: 0, date: today };
  if (q.date !== today) return { dailyLimit: q.dailyLimit, usedToday: 0, date: today };
  return q;
}

export async function setQuotaLimit(adminId: string, dailyLimit: number): Promise<AdminQuota> {
  const q = await getQuota(adminId);
  q.dailyLimit = Math.max(0, Math.floor(dailyLimit));
  await getDb().set(K.quota(adminId), JSON.stringify(q));
  return q;
}

/** AI chaqirishdan oldin chaqiriladi. Limit oshsa false qaytaradi. */
export async function consumeQuota(adminId: string, cost = 1): Promise<{ ok: boolean; quota: AdminQuota }> {
  const q = await getQuota(adminId);
  if (q.dailyLimit > 0 && q.usedToday + cost > q.dailyLimit) {
    return { ok: false, quota: q };
  }
  q.usedToday += cost;
  await getDb().set(K.quota(adminId), JSON.stringify(q));
  return { ok: true, quota: q };
}

// ---------- Qulf va meta ----------
export const acquireLock = (name: string, seconds: number) =>
  getDb().set(K.lock(name), '1', { nx: true, exSeconds: seconds });
export const releaseLock = (name: string) => getDb().del(K.lock(name));

export const getMeta = (k: string) => getDb().get(K.meta(k));
export const setMeta = (k: string, v: string) => getDb().set(K.meta(k), v);
export const nextCounter = (k: string) => getDb().incr(K.meta(k));
export const claimSlot = (key: string) => getDb().set(K.meta(`slot:${key}`), '1', { nx: true, exSeconds: 172800 });
export const releaseSlot = (key: string) => getDb().del(K.meta(`slot:${key}`));

export function newId(prefix = 'p'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
