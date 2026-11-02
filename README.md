# TelePost AI v2.4 — Telegram kanal admini Mini App

Bir nechta kanalni bitta botdan boshqarish: AI post + rasm, kontent reja, rejalashtirish, **avtopilot**, statistika.

## Yangiliklar (v2.4)
- **Har admin faqat o'z kanallarini ko'radi** — boshqalarning kanali yashirin. Kanal qo'shishda foydalanuvchi o'sha kanalda admin ekanligi Telegram orqali tekshiriladi.
- **Super admin (OWNER)** — `ADMIN_IDS` dagi foydalanuvchi. Uning Telegram ID si va kanallari boshqa adminlarga **hech qachon** ko'rinmaydi.
- **AI kunlik kvota** — super admin har bir admin uchun kunlik AI chaqiruv limitini belgilaydi (0 = cheksiz).
- **Haftaning kuni bo'yicha slotlar** — avtopilotda `weekdays` (0=Dushanba … 6=Yakshanba).
- **Tasdiqlash muddati** — `approvalDeadlineHours` (default 24 soat).
- **Preview botga** — Mini App dan `/api/preview/send` orqali botga preview yuborish (ilova ichida preview shart emas).
- Faqat **Gemini API KEY** kerak (boshqa rasm xizmatlari / RUNWARE yo'q).

## Imkoniyatlar
- **Ko'p kanal** — botni kanalga admin qilsangiz, kanal avtomatik ulanadi. Har kanal uchun alohida uslub, til, imzo, vaqt zonasi.
- **AI post** (Gemini): kanal yo'nalishi va oldingi postlarni hisobga oladi, takrorlamaydi. Yangilik turi Google Search bilan.
- **Kontent reja**: bir bosishda 3–14 kunlik g'oyalar → postlarni yozdirib → eng yaxshi vaqtlarga rejalashtirish.
- **Avtopilot**: belgilangan vaqtlarda (va kunlarda) AI o'zi post yozadi; tasdiqlash tugmalari bot orqali keladi (✅ / 🗑).
- AI tahrir tugmalari, rasm/fayl, havola tugmasi, qoralama, nusxa olish.
- Xavfsizlik: Telegram imzosi (initData) tekshiriladi, faqat ruxsat etilganlar kiradi, bot tokeni brauzerga chiqmaydi.

## Vercel'ga deploy (0 dan)
1. **BotFather**: `/newbot` → token oling.
2. **Gemini kalit**: aistudio.google.com → API key.
3. Kodni GitHub'ga yuklang → Vercel'da **Add New Project** → shu repo (Framework: Vite avtomatik).
4. Vercel → **Storage** → Marketplace → **Upstash Redis** qo'shing (env o'zi qo'shiladi).
5. **Environment Variables** (`.env.example` ga qarang):
   `BOT_TOKEN`, `GEMINI_API_KEY`, `ADMIN_IDS`, `CRON_SECRET` (+ ixtiyoriy `ADMIN_PASSWORD`).
   **RUNWARE yoki boshqa kalit kerak emas.**
   ADMIN_ID ni bilmasangiz: deploydan keyin botga `/id` yozing, ID ni qo'shib **Redeploy** qiling.
6. Deploy tugagach brauzerda **bir marta** oching:
   `https://SIZNING-APP.vercel.app/api/setup?key=CRON_SECRET`
   → webhook, menyu tugmasi, buyruqlar avtomatik sozlanadi.
7. Botga `/start` → «TelePost ni ochish». Botni kanalga **administrator** (Post Messages bilan) qiling → kanal ulanadi.
8. **Cron** (rejalashtirish va avtopilot uchun majburiy): https://cron-job.org (bepul) → har **1 daqiqada**
   `https://SIZNING-APP.vercel.app/api/cron?key=CRON_SECRET` ni chaqirsin.
   (Vercel Hobby faqat kuniga 1 marta cron beradi, shuning uchun tashqi cron kerak.)

## Lokal ishga tushirish
```
npm install
cp .env.example .env   # BOT_TOKEN, GEMINI_API_KEY, ADMIN_PASSWORD yozing
npm run dev            # http://localhost:3000 (brauzerda parol bilan kirasiz; baza .data/db.json)
```

## Cheklovlar
- Rasm avtomatik ~650 KB gacha siqiladi, fayl ilovasi ≤ ~900 KB (Vercel/Redis limiti).
- Telegram Bot API ko'rishlar sonini bermaydi — statistikada faqat haqiqiy ma'lumotlar.
