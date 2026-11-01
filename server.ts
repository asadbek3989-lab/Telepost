/**
 * LOKAL ishlab chiqish serveri (npm run dev).
 * Vercel'da bu fayl ishlatilmaydi — u yerda /api papkasi serverless funksiya sifatida ishlaydi.
 */
import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { handle } from './api/_lib/routes.js';
import { runCron } from './api/_lib/core.js';

dotenv.config({ path: ['.env.local', '.env'] });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));
app.all('/api/*', (req, res) => {
  void handle(req as any, res as any);
});

const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
app.use(vite.middlewares);

app.listen(PORT, () => {
  console.log(`TelePost AI (lokal) → http://localhost:${PORT}`);
  console.log("Eslatma: Telegram ichida ishlashi uchun Vercel'ga deploy qiling. Brauzerda kirish uchun .env ga ADMIN_PASSWORD yozing.");
});

// Lokalda rejalashtirilgan postlar va avtopilot ishlashi uchun har daqiqada cron'ni o'zimiz chaqiramiz
setInterval(() => {
  runCron().catch((e) => console.error('cron xatosi:', e));
}, 60_000);
