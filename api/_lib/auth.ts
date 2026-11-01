import crypto from 'node:crypto';
import { env } from './env.js';
import { HttpError, header, type Req } from './http.js';
import { listExtraAdmins } from './store.js';
import type { SessionInfo } from '../../shared/types.js';

const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Telegram Mini App initData imzosini tekshiradi (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) */
export function validateInitData(raw: string): { id: string; name: string } | null {
  if (!env.botToken || !raw) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dcs = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = hmac('WebAppData', env.botToken);
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (!safeEqual(calc, hash)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 3 * 24 * 3600) return null;

  try {
    const user = JSON.parse(params.get('user') || '{}');
    if (!user.id) return null;
    return { id: String(user.id), name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id) };
  } catch {
    return null;
  }
}

// ---- Parol orqali kirish (brauzer uchun) ----
const pwKey = () => crypto.createHash('sha256').update(`${env.adminPassword}|${env.botToken}|tp-session`).digest();

export function createPasswordToken(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 30 * 24 * 3600 * 1000, sub: 'password' })).toString('base64url');
  const sig = hmac(pwKey(), payload).toString('base64url');
  return `${payload}.${sig}`;
}

function verifyPasswordToken(token: string): boolean {
  if (!env.adminPassword) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  if (!safeEqual(hmac(pwKey(), payload).toString('base64url'), sig)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

export function checkPassword(pw: string): boolean {
  return !!env.adminPassword && safeEqual(pw, env.adminPassword);
}

// ---- Rollar ----
export function isOwner(userId: string): boolean {
  return env.adminIds.includes(String(userId));
}

export async function isAdminUser(userId: string | number): Promise<boolean> {
  const id = String(userId);
  if (isOwner(id)) return true;
  return (await listExtraAdmins()).includes(id);
}

/** Barcha admin ID lari (egalar + qo'shilganlar) — bildirishnoma yuborish uchun */
export async function allAdminIds(): Promise<string[]> {
  return [...new Set([...env.adminIds, ...(await listExtraAdmins())])];
}

export async function authenticate(req: Req): Promise<SessionInfo | null> {
  const auth = header(req, 'authorization');
  if (auth.startsWith('tma ')) {
    const u = validateInitData(auth.slice(4));
    if (!u) return null;
    if (isOwner(u.id)) return { id: u.id, name: u.name, role: 'owner' };
    if (await isAdminUser(u.id)) return { id: u.id, name: u.name, role: 'admin' };
    throw new HttpError(403, `Ruxsat yo'q. Sizning Telegram ID: ${u.id}. Uni ADMIN_IDS ga qo'shishni egadan so'rang.`);
  }
  if (auth.startsWith('Bearer ')) {
    if (verifyPasswordToken(auth.slice(7))) return { id: 'password', name: 'Admin', role: 'owner' };
  }
  return null;
}

/** Cron / setup himoyasi: Authorization: Bearer <CRON_SECRET> yoki ?key=<CRON_SECRET> */
export function checkCronSecret(req: Req): boolean {
  if (!env.cronSecret) return false;
  const bearer = header(req, 'authorization').replace(/^Bearer\s+/i, '');
  let key = String(req.query?.key || '');
  if (!key) {
    try {
      key = new URL(req.url || '/', 'http://localhost').searchParams.get('key') || '';
    } catch {
      /* e'tiborsiz */
    }
  }
  return safeEqual(bearer, env.cronSecret) || safeEqual(key, env.cronSecret);
}

/** Webhook uchun maxfiy kalit: bot tokenidan hosil qilinadi, alohida env kerak emas */
export function webhookSecret(): string {
  return crypto.createHash('sha256').update(`webhook|${env.botToken}`).digest('hex').slice(0, 40);
}
