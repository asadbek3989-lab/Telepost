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
  get geminiKey() {
    return process.env.GEMINI_API_KEY || '';
  },
  get textModel() {
    // Tez model: flash-lite (odatda 5–15 s). Sifat kerak bo'lsa: GEMINI_MODEL=gemini-3.8-flash
    return process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  },
  get fallbackModel() {
    return process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.1-flash-lite';
  },
  get imageModel() {
    return process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image';
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
