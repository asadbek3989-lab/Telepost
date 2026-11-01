# TelePost AI — Telegram kanal admini Mini App

Bir nechta kanalni bitta botdan boshqarish: AI post + rasm, kontent reja, rejalashtirish, **avtopilot**, statistika.

## Imkoniyatlar
- **Ko'p kanal** — botni kanalga admin qilsangiz, kanal avtomatik ulanadi. Har kanal uchun alohida uslub, til, imzo, vaqt zonasi.
- **AI post** (Runware): kanal yo'nalishi va oldingi postlarni hisobga oladi, takrorlamaydi. Internet qidiruvi yo'q, model o'z bilimiga tayanadi.
- **Kontent reja**: bir bosishda 3–14 kunlik g'oyalar → postlarni yozdirib → eng yaxshi vaqtlarga rejalashtirish.
- **Avtopilot**: belgilangan vaqtlarda AI o'zi post yozadi; tasdiqlash tugmalari bot orqali keladi (✅ / 🗑).
- AI tahrir tugmalari (ilgak, qisqartirish, tarjima…), rasm/fayl, havola tugmasi, qoralama, nusxa olish.
- Xavfsizlik: Telegram imzosi (initData) tekshiriladi, faqat ADMIN_IDS dagilar kiradi, bot tokeni brauzerga chiqmaydi.

## Vercel'ga deploy (0 dan)
1. **BotFather**: `/newbot` → token oling.
2. **Runware kalit**: runware.ai → API Keys.
3. Kodni GitHub'ga yuklang → Vercel'da **Add New Project** → shu repo (Framework: Vite avtomatik).
4. Vercel → **Storage** → Marketplace → **Upstash Redis** qo'shing (env o'zi qo'shiladi).
5. **Environment Variables** (`.env.example` ga qarang):
   `BOT_TOKEN`, `RUNWARE_API_KEY`, `ADMIN_IDS`, `CRON_SECRET` (+ ixtiyoriy `ADMIN_PASSWORD`).
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
cp .env.example .env   # BOT_TOKEN, RUNWARE_API_KEY, ADMIN_PASSWORD yozing
npm run dev            # http://localhost:3000 (brauzerda parol bilan kirasiz; baza .data/db.json)
```

## Cheklovlar
- Rasm avtomatik ~650 KB gacha siqiladi, fayl ilovasi ≤ ~900 KB (Vercel/Redis limiti).
- Telegram Bot API ko'rishlar sonini bermaydi — statistikada faqat haqiqiy ma'lumotlar.
