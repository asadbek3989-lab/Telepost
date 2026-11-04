# TelePost AI v2.5 — Telegram kanal admini Mini App

Bir nechta kanalni bitta botdan boshqarish: AI post + rasm, kontent reja, rejalashtirish, **avtopilot**, statistika.

## Yangiliklar (v2.5)
- **Yangi yozuv uslubi va sifat.** AI endi kanal uslub namunasiga (standart: «Sizni hech kim qutqarishga kelmaydi» posti) o'xshatib, ilgakli sarlavha, qisqa kirish, amaliy bandlar va esda qoladigan yakun bilan yozadi. Oldi-qochdi va takroriy gaplar, sun'iy qolipli iboralar taqiqlangan.
- **Doim hurmat bilan «Siz».** «Sen» shakllari taqiqlangan; matnda topilsa, AI bir marta avtomatik tuzatadi.
- **Hashtag, «saqlab qo'ying», «izohga yozing» va savol bilan tugatish yo'q.** Yakun faqat kanal imzosi: `O'z ustida ishlashni to'xtatmaydiganlar uchun maxsus: 👉 @RivojlanishZonasi - Sizning shaxsiy o'sish hududingiz!`
- **Inson yozgandek ko'rinish.** Ko'rinmas belgilar tozalanadi, apostroflar bir xil (`'`), tire va ko'p nuqtalar odatiy ko'rinishga keltiriladi, uzun tire (—) me'yorida qoladi.
- **Emoji — admin qo'lida.** Kanal uchun, har bir post uchun va avtopilotning har bir slotida: Emojisiz / Kam / Ko'proq. Imzodagi emoji o'zgarmaydi.
- **Uzunlik 300–5000 belgi.** Telegram bitta xabarga 4096 belgi beradi, shuning uchun 4096 dan uzun post paragraf chegarasida bir necha xabarga bo'linib yuboriladi (havola tugmasi oxirgisida). Rasm bilan uzun post: avval rasm, keyin matn. Kanaldan o'chirishda barcha bo'laklar o'chadi. Biror bo'lak yuborilmasa, yuborilganlari o'chirilib, post qayta uriniladi (dublikat bo'lmaydi).
- **Avtopilot jadvali (slotlar).** Admin har bir slot uchun o'zi belgilaydi: vaqt, haftaning kunlari, mavzu (bir nechta qator = navbatma-navbat), post turi, qo'shimcha ko'rsatma, emoji, rasm, uzunlik. Eski `times` sozlamalari avtomatik slotga aylanadi.
- **Yangi post turlari:** Ibratli hikoya, Chuqur maqola, Xurofot va haqiqat, Kunlik topshiriq.
- **Kanal sozlamalarida:** uslub namunasi (o'zingiz yoqtirgan postni qo'ying), «ishlatilmasin» so'zlar ro'yxati, «Rivojlanish Zonasi» tayyor andozasi (bir tugma).
- **AI tugmalari:** «Tabiiylashtir» (matnni yanada insoniy qiladi) va «Emojisiz» (AI sarflamaydi).
- **Maxfiylik tuzatishi:** avtopilot tasdiqlash xabarlari, xato bildirishnomalari va `/kanallar` endi faqat kanal egasi va super adminga boradi.

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
- **Avtopilot**: jadvaldagi har bir slot (vaqt, kun, mavzu, tur) bo'yicha AI o'zi post yozadi; tasdiqlash tugmalari bot orqali keladi (✅ / 🗑).
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
