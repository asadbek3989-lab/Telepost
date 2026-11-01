import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { HttpError } from './http.js';

/**
 * Minimal kalit-qiymat baza interfeysi.
 *  - Production: Upstash Redis (REST, hech qanday SDK kerak emas)
 *  - Lokal ishlab chiqish: .data/db.json fayli (Upstash sozlanmagan bo'lsa)
 */
export interface Db {
  kind: 'upstash' | 'file';
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { nx?: boolean; exSeconds?: number }): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  zrangebyscore(key: string, min: number, max: number, limit: number): Promise<string[]>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

class UpstashDb implements Db {
  kind = 'upstash' as const;

  private async cmd(args: (string | number)[]): Promise<any> {
    const res = await fetch(env.redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new HttpError(502, `Baza xatosi: ${data.error || res.statusText}`);
    }
    return data.result;
  }

  async get(key: string) {
    return (await this.cmd(['GET', key])) ?? null;
  }
  async set(key: string, value: string, opts?: { nx?: boolean; exSeconds?: number }) {
    const args: (string | number)[] = ['SET', key, value];
    if (opts?.nx) args.push('NX');
    if (opts?.exSeconds) args.push('EX', opts.exSeconds);
    const r = await this.cmd(args);
    return r === 'OK';
  }
  async del(key: string) {
    await this.cmd(['DEL', key]);
  }
  async incr(key: string) {
    return Number(await this.cmd(['INCR', key]));
  }
  async hget(key: string, field: string) {
    return (await this.cmd(['HGET', key, field])) ?? null;
  }
  async hset(key: string, field: string, value: string) {
    await this.cmd(['HSET', key, field, value]);
  }
  async hdel(key: string, field: string) {
    await this.cmd(['HDEL', key, field]);
  }
  async hgetall(key: string) {
    const arr: string[] = (await this.cmd(['HGETALL', key])) || [];
    const out: Record<string, string> = {};
    for (let i = 0; i < arr.length; i += 2) out[arr[i]] = arr[i + 1];
    return out;
  }
  async zadd(key: string, score: number, member: string) {
    await this.cmd(['ZADD', key, score, member]);
  }
  async zrem(key: string, member: string) {
    await this.cmd(['ZREM', key, member]);
  }
  async zrangebyscore(key: string, min: number, max: number, limit: number) {
    return (await this.cmd(['ZRANGEBYSCORE', key, min, max, 'LIMIT', 0, limit])) || [];
  }
  async sadd(key: string, member: string) {
    await this.cmd(['SADD', key, member]);
  }
  async srem(key: string, member: string) {
    await this.cmd(['SREM', key, member]);
  }
  async smembers(key: string) {
    return (await this.cmd(['SMEMBERS', key])) || [];
  }
}

interface FileShape {
  strings: Record<string, string>;
  exp: Record<string, number>;
  hashes: Record<string, Record<string, string>>;
  zsets: Record<string, Record<string, number>>;
  sets: Record<string, string[]>;
}

class FileDb implements Db {
  kind = 'file' as const;
  private file = path.join(process.cwd(), '.data', 'db.json');
  private data: FileShape;

  constructor() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch {
      this.data = { strings: {}, exp: {}, hashes: {}, zsets: {}, sets: {} };
    }
  }
  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
  private alive(key: string) {
    const e = this.data.exp[key];
    if (e && e < Date.now()) {
      delete this.data.strings[key];
      delete this.data.exp[key];
      return false;
    }
    return key in this.data.strings;
  }
  async get(key: string) {
    return this.alive(key) ? this.data.strings[key] : null;
  }
  async set(key: string, value: string, opts?: { nx?: boolean; exSeconds?: number }) {
    if (opts?.nx && this.alive(key)) return false;
    this.data.strings[key] = value;
    if (opts?.exSeconds) this.data.exp[key] = Date.now() + opts.exSeconds * 1000;
    else delete this.data.exp[key];
    this.persist();
    return true;
  }
  async del(key: string) {
    delete this.data.strings[key];
    delete this.data.exp[key];
    this.persist();
  }
  async incr(key: string) {
    const n = Number(this.alive(key) ? this.data.strings[key] : 0) + 1;
    this.data.strings[key] = String(n);
    this.persist();
    return n;
  }
  async hget(key: string, field: string) {
    return this.data.hashes[key]?.[field] ?? null;
  }
  async hset(key: string, field: string, value: string) {
    (this.data.hashes[key] ||= {})[field] = value;
    this.persist();
  }
  async hdel(key: string, field: string) {
    if (this.data.hashes[key]) delete this.data.hashes[key][field];
    this.persist();
  }
  async hgetall(key: string) {
    return { ...(this.data.hashes[key] || {}) };
  }
  async zadd(key: string, score: number, member: string) {
    (this.data.zsets[key] ||= {})[member] = score;
    this.persist();
  }
  async zrem(key: string, member: string) {
    if (this.data.zsets[key]) delete this.data.zsets[key][member];
    this.persist();
  }
  async zrangebyscore(key: string, min: number, max: number, limit: number) {
    return Object.entries(this.data.zsets[key] || {})
      .filter(([, s]) => s >= min && s <= max)
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([m]) => m);
  }
  async sadd(key: string, member: string) {
    const set = (this.data.sets[key] ||= []);
    if (!set.includes(member)) set.push(member);
    this.persist();
  }
  async srem(key: string, member: string) {
    this.data.sets[key] = (this.data.sets[key] || []).filter((m) => m !== member);
    this.persist();
  }
  async smembers(key: string) {
    return [...(this.data.sets[key] || [])];
  }
}

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  if (env.redisUrl && env.redisToken) {
    instance = new UpstashDb();
  } else if (!process.env.VERCEL) {
    instance = new FileDb();
  } else {
    throw new HttpError(
      503,
      "Baza ulanmagan. Vercel > Storage orqali Upstash Redis qo'shing (UPSTASH_REDIS_REST_URL va UPSTASH_REDIS_REST_TOKEN)."
    );
  }
  return instance;
}

export function dbConfigured(): boolean {
  return !!(env.redisUrl && env.redisToken) || !process.env.VERCEL;
}
