/** Barcha muhit o'zgaruvchilari bitta joyda (lazy — dotenv yuklangandan keyin o'qiladi) */
const list = (v: string | undefined) =>
  (v || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  get botToken() {
    return process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  },
  get runwareKey() {
    return process.env.RUNWARE_API_KEY || '';
  },
  get textModel() {
    return process.env.RUNWARE_TEXT_MODEL || 'google:gemini@3-flash';
  },
  get imageModel() {
    return process.env.RUNWARE_IMAGE_MODEL || 'runware:400@1';
  },
  get adminIds() {
    return list(process.env.ADMIN_IDS);
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD || '';
  },
  get cronSecret() {
    return process.env.CRON_SECRET || '';
  },
  get appUrl() {
    return (process.env.APP_URL || '').replace(/\/+$/, '');
  },
  get redisUrl() {
    return process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
  },
  get redisToken() {
    return process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
  },
};
