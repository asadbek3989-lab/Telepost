import crypto from 'node:crypto';
import { env } from './env.js';
import { HttpError } from './http.js';
import { sanitizeTelegramHtml } from '../../shared/telegramHtml.js';

const RUNWARE_URL = 'https://api.runware.ai/v1';

function key(): string {
  if (!env.runwareKey) throw new HttpError(503, "RUNWARE_API_KEY sozlanmagan (Vercel > Environment Variables).");
  return env.runwareKey;
}

function wrapError(e: any): HttpError {
  if (e instanceof HttpError) return e;
  let msg = String(e?.message || e);
  if (/401|403|unauthor|invalid.*(api)?.*key|forbidden/i.test(msg)) msg = "Runware API kaliti noto'g'ri yoki ruxsat yo'q";
  else if (/429|rate.?limit|too many/i.test(msg)) msg = "Runware so'rov limiti oshdi, birozdan keyin urinib ko'ring";
  else if (/402|insufficient|credit|balance|payment/i.test(msg)) msg = "Runware hisobida mablag' yetarli emas (balansni to'ldiring)";
  return new HttpError(502, `AI xatosi: ${msg.slice(0, 300)}`);
}

function parseJson(raw: string): any {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* pastga */
      }
    }
  }
  throw new HttpError(502, "AI javobini o'qib bo'lmadi, qayta urinib ko'ring");
}

async function askJson(prompt: string, opts: { search?: boolean; temperature?: number } = {}): Promise<any> {
  // Eslatma: Runware'da Google Search yo'q, shuning uchun opts.search e'tiborsiz qoldiriladi.
  const temperature = opts.temperature ?? 0.9;
  try {
    const res = await fetch(`${RUNWARE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
      body: JSON.stringify({
        model: env.textModel,
        messages: [
          { role: 'system', content: 'Faqat so\'ralgan JSON ni qaytar. Hech qanday izoh, kirish yoki markdown belgilarisiz.' },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_completion_tokens: 8192,
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      let m = raw;
      try {
        const j = JSON.parse(raw);
        m = j?.error?.message || j?.errors?.[0]?.message || raw;
      } catch {
        /* oddiy matn */
      }
      throw new Error(`${res.status} ${m}`);
    }
    const j = JSON.parse(raw);
    const content = j?.choices?.[0]?.message?.content;
    const text = Array.isArray(content) ? content.map((c: any) => c?.text || '').join('') : String(content || '');
    return parseJson(text);
  } catch (e) {
    throw wrapError(e);
  }
}

const LANG: Record<string, string> = {
  'uz-lat': "O'zbek tili (Lotin yozuvi). Tabiiy, zamonaviy, grammatik jihatdan to'g'ri; rus/ingliz so'zlarini keraksiz aralashtirmang.",
  'uz-kir': 'Ўзбек тили (Кирилл ёзуви). Табиий ва хатосиз.',
  ru: 'Русский язык. Живой, современный, без канцеляризмов.',
  en: 'English. Natural, engaging, concise.',
};

const TONE: Record<string, string> = {
  "do'stona": "do'stona va samimiy, o'quvchi bilan yaqin suhbatdoshdek",
  rasmiy: 'jiddiy, xolis, ishonchli va professional',
  sotuvchi: 'diqqatni tortuvchi, AIDA formulasida, aniq harakatga undovchi',
  qiziqarli: "yengil yumor bilan, hissiyotga boy, jonli",
  tahliliy: 'faktlar, raqamlar va ekspert mulohazalariga asoslangan',
};

const TEMPLATE: Record<string, string> = {
  news: "Yangilik posti: kuchli sarlavha, voqea mohiyati 1-2 jumlada, nima uchun muhimligi, qisqa xulosa va o'quvchiga savol.",
  motivation: "Motivatsion post: ilhomlantiruvchi voqea yoki fikr, hayotiy saboq va bugunoq qilsa bo'ladigan 3 ta amaliy qadam.",
  educational: "Foydali qo'llanma: muammo, 3-5 ta aniq punkt (har biri amaliy), maslahat va 'saqlab qo'ying' chorlovi.",
  promo: "Sotuv posti: asosiy taklif, o'quvchi uchun aniq foyda, ishonch elementi, cheklov (muddat/son) va harakatga chaqiruv. Soxta chegirma yoki to'qima raqam yozmang.",
  poll: "Muhokama posti: bahsli, lekin do'stona savol, 2-4 variant va izohda fikr yozishga chorlov.",
  quote: "Iqtibos posti: mashhur shaxsning ma'noli fikri (aniq ishonchli bo'lsa), uning tahlili va hayotda qo'llanishi.",
  lifestyle: "Kunlik post: yengil, shaxsiy ohangdagi mulohaza yoki ertalabki/kechki xabarnoma.",
  custom: "Mavzuga eng mos, original va yuqori sifatli Telegram post.",
};

export function finalizeText(text: string, signature?: string): string {
  let out = sanitizeTelegramHtml(text);
  const sig = signature ? sanitizeTelegramHtml(signature) : '';
  if (sig && !out.includes(sig)) out += `\n\n${sig}`;
  return out;
}

export interface PostParams {
  topic: string;
  autoTopic?: boolean;
  templateType: string;
  tone: string;
  language: string;
  signature?: string;
  niche?: string;
  audience?: string;
  channelTitle?: string;
  hasImage: boolean;
  wantFile?: boolean;
  fileRequest?: string;
  recentTopics?: string[];
  useSearch?: boolean;
}

export interface GeneratedPost {
  title: string;
  text: string;
  imagePrompt: string;
  ctaText?: string;
  file?: { name: string; content: string; mimeType: string };
  readingTime?: string;
  bestTime?: string;
  tip?: string;
}

export async function generatePost(p: PostParams): Promise<GeneratedPost> {
  const maxChars = p.hasImage ? 950 : 1600;
  const topicLine = p.autoTopic
    ? "Mavzuni o'zing tanla: kanal yo'nalishiga mos, hozir o'quvchilarni qiziqtiradigan YANGI va aniq mavzu (umumiy emas)."
    : `Mavzu: ${p.topic}`;

  const prompt = `
Sen tajribali Telegram kanal muharriri va SMM mutaxassisisan. Vazifang — kanal obunachilari oxirigacha o'qiydigan, saqlab qo'yadigan va ulashadigan post yozish.

KANAL: ${p.channelTitle || 'Telegram kanal'}
${p.niche ? `Kanal yo'nalishi / brend ovozi: ${p.niche}` : ''}
Auditoriya: ${p.audience || "Telegram kanal o'quvchilari"}
${topicLine}
Post turi: ${p.templateType} — ${TEMPLATE[p.templateType] || TEMPLATE.custom}
Ohang: ${TONE[p.tone] || TONE["do'stona"]}
Til: ${LANG[p.language] || LANG['uz-lat']}
${p.recentTopics?.length ? `Yaqinda joylangan mavzular (TAKRORLAMA, boshqa burchakdan yoz): ${p.recentTopics.slice(0, 12).join(' | ')}` : ''}
${p.useSearch ? "Diqqat: sen internetga ulanmagansan. Eng so'nggi voqea, sana va raqamlarni TO'QIMA; ishonching komil bo'lgan, umumiy va to'g'ri ma'lumot yoki tahlil yoz." : ''}
${p.wantFile ? `Postga ilova qilinadigan fayl ham kerak: "${p.fileRequest || p.topic}". Fayl nomi va to'liq foydali matnini tayyorla.` : ''}

SIFAT TALABLARI:
- 1-qator "ilgak" (hook): qiziqtiradigan, aniq sarlavha + mos emoji. "Bugun sizga ... haqida aytib beraman" kabi bo'sh kirish YO'Q.
- Qisqa paragraflar (1-3 jumla), orasida bo'sh qator. Mobil ekranda o'qish qulay bo'lsin.
- Umumiy "suv" gaplar emas — aniq, amaliy, qiymatli ma'lumot.
- Aniq raqam, sana, ism, statistika va iqtiboslarni FAQAT ishonchli bo'lsagina yoz. Bilmasang to'qima — umumiyroq, lekin to'g'ri ifodala.
- Oxirida o'quvchini harakatga chaqir (savol, "saqlab qo'ying", "do'stingizga yuboring").
- Oxirida mavzuga oid 3-5 ta hashtag.
- Matn uzunligi (teglarsiz) ${maxChars} belgidan oshmasin.

FORMAT (qat'iy):
- Faqat Telegram HTML: <b>, <i>, <u>, <s>, <code>, <blockquote>, <a href="...">. Boshqa teg va Markdown (**, #) ISHLATMA.
- Imzo qo'shma (u avtomatik qo'shiladi).

Faqat quyidagi JSON ni qaytar:
{
  "title": "Postning 3-7 so'zli qisqa nomi (ichki ro'yxat uchun)",
  "text": "Telegram HTML formatidagi tayyor post matni",
  "imagePrompt": "Shu post uchun ingliz tilida batafsil rasm tavsifi: aniq obyekt, kompozitsiya, rang, uslub. Rasmda matn/harf bo'lmasin.",
  "ctaText": "Inline tugma uchun 2-4 so'zli matn (mos kelsa)",
  "file": ${p.wantFile ? '{ "name": "fayl_nomi.txt", "content": "faylning to\'liq matni", "mimeType": "text/plain" }' : 'null'},
  "readingTime": "masalan: 1 daqiqa",
  "bestTime": "bu turdagi post uchun eng yaxshi vaqt oralig'i, masalan 09:00-11:00",
  "tip": "shu postni ko'proq tarqatish uchun 1 ta qisqa maslahat"
}`;

  const d = await askJson(prompt, { search: !!p.useSearch, temperature: 0.9 });
  const text = finalizeText(String(d.text || d.formattedText || ''), p.signature);
  if (!text) throw new HttpError(502, "AI bo'sh matn qaytardi, qayta urinib ko'ring");
  return {
    title: String(d.title || p.topic || 'Post').slice(0, 120),
    text,
    imagePrompt: String(d.imagePrompt || d.suggestedImagePrompt || p.topic),
    ctaText: d.ctaText || d.suggestedCta?.text,
    file: d.file?.content
      ? { name: String(d.file.name || 'qollanma.txt'), content: String(d.file.content), mimeType: d.file.mimeType || 'text/plain' }
      : undefined,
    readingTime: d.readingTime,
    bestTime: d.bestTime || d.bestPostingTime,
    tip: d.tip || d.engagementTip,
  };
}

const IMAGE_SIZES: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1280, 720],
  '4:3': [1152, 864],
  '3:4': [864, 1152],
  '9:16': [720, 1280],
};

export async function generateImage(prompt: string, aspectRatio = '1:1'): Promise<string> {
  const refined = `${prompt}. Professional high quality editorial illustration for a social media post, clean modern composition, balanced lighting, rich but harmonious colors. Absolutely no text, no letters, no logos, no watermarks.`;
  const [width, height] = IMAGE_SIZES[aspectRatio] || IMAGE_SIZES['1:1'];
  try {
    const res = await fetch(RUNWARE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key()}` },
      body: JSON.stringify([
        {
          taskType: 'imageInference',
          taskUUID: crypto.randomUUID(),
          model: env.imageModel,
          positivePrompt: refined,
          width,
          height,
          numberResults: 1,
          outputType: 'dataURI',
          outputFormat: 'JPG',
        },
      ]),
    });
    const raw = await res.text();
    let j: any = null;
    try {
      j = JSON.parse(raw);
    } catch {
      /* pastda */
    }
    if (!res.ok || j?.errors?.length) {
      const m = j?.errors?.[0]?.message || j?.error?.message || raw;
      throw new Error(`${res.status} ${m}`);
    }
    const item = j?.data?.[0];
    if (item?.imageDataURI) return String(item.imageDataURI);
    if (item?.imageBase64Data) return `data:image/jpeg;base64,${item.imageBase64Data}`;
    if (item?.imageURL) {
      const r = await fetch(item.imageURL);
      if (!r.ok) throw new Error(`Rasmni yuklab bo'lmadi (${r.status})`);
      const buf = Buffer.from(await r.arrayBuffer());
      return `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${buf.toString('base64')}`;
    }
  } catch (e) {
    throw wrapError(e);
  }
  throw new HttpError(502, "AI rasm qaytarmadi (limit yoki xavfsizlik filtri bo'lishi mumkin)");
}

export async function generateFile(topic: string, fileType: string, instructions: string, language: string) {
  const d = await askJson(
    `
Sen Telegram kanal obunachilari uchun yuklab olinadigan foydali hujjat tayyorlaysan.
Mavzu: ${topic}
Fayl turi: ${fileType}
Til: ${LANG[language] || LANG['uz-lat']}
Qo'shimcha ko'rsatma: ${instructions || "Amaliy, aniq va batafsil bo'lsin"}

Tuzilma: sarlavha, qisqa kirish, 5-10 ta aniq punkt yoki bosqich, misollar, xulosa. To'qima raqam va manba yozma.
JSON qaytar: {"fileName":"nom.txt","mimeType":"text/plain","content":"to'liq matn","summary":"1 jumlalik ta'rif"}`,
    { temperature: 0.7 }
  );
  const content = String(d.content || '');
  if (!content) throw new HttpError(502, "AI fayl matnini qaytarmadi");
  return {
    name: String(d.fileName || `${topic.slice(0, 24).replace(/\s+/g, '_')}.txt`),
    content,
    mimeType: d.mimeType || 'text/plain',
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    summary: d.summary as string | undefined,
  };
}

const REWRITE: Record<string, string> = {
  shorten: "Matnni taxminan 40% qisqartir, asosiy fikr va formatni saqla.",
  hook: "Faqat birinchi qatorni (ilgakni) ancha kuchliroq, qiziqtiradigan qilib qayta yoz. Qolgan matnni deyarli o'zgartirma.",
  emoji: "Mos joylarga ortiqcha bo'lmagan holda emojilar qo'sh (har paragrafga 1 tadan oshmasin).",
  expand: "Matnni misollar va tafsilotlar bilan kengaytir, lekin suv aralashtirma.",
  fix: "Imlo, grammatika va uslub xatolarini tuzat; ma'no va ohangni o'zgartirma.",
  'uz-lat': "O'zbek tiliga (Lotin) tarjima qil.",
  'uz-kir': 'Ўзбек тилига (Кирилл) таржима қил.',
  ru: 'Переведи на русский язык.',
  en: 'Translate into English.',
};

export async function rewriteText(text: string, action: string): Promise<string> {
  const instruction = REWRITE[action];
  if (!instruction) throw new HttpError(400, "Noma'lum amal");
  const d = await askJson(
    `Quyidagi Telegram post matnini tahrirla.
Vazifa: ${instruction}
Qoidalar: faqat Telegram HTML teglari (<b>, <i>, <u>, <s>, <code>, <blockquote>, <a href>) saqlansin; Markdown ishlatma; hashtag va havolalarni saqla.

MATN:
${text}

JSON qaytar: {"text":"tahrirlangan matn"}`,
    { temperature: 0.6 }
  );
  const out = sanitizeTelegramHtml(String(d.text || ''));
  if (!out) throw new HttpError(502, "AI natija qaytarmadi");
  return out;
}

export async function planIdeas(opts: {
  niche: string;
  audience: string;
  language: string;
  count: number;
  focus?: string;
  recentTopics?: string[];
}): Promise<{ topic: string; templateType: string; note: string }[]> {
  const d = await askJson(
    `
Sen Telegram kanal kontent-strategisan. ${opts.count} ta post g'oyasidan iborat kontent reja tuz.

Kanal yo'nalishi: ${opts.niche || 'umumiy'}
Auditoriya: ${opts.audience || "keng o'quvchilar"}
${opts.focus ? `Bu reja uchun asosiy e'tibor: ${opts.focus}` : ''}
Til: ${LANG[opts.language] || LANG['uz-lat']}
${opts.recentTopics?.length ? `Yaqinda joylangan (takrorlama): ${opts.recentTopics.slice(0, 15).join(' | ')}` : ''}

Talablar:
- G'oyalar xilma-xil bo'lsin: foydali qo'llanma, yangilik/tahlil, savol-muhokama, motivatsiya, iqtibos, shaxsiy hikoya aralashmasi.
- Har bir mavzu aniq va o'ziga xos (masalan "Biznes haqida" emas, "Birinchi 100 mijozni ijtimoiy tarmoqsiz topishning 4 yo'li").
- templateType faqat shulardan: news, motivation, educational, promo, poll, quote, lifestyle, custom. Sotuv (promo) 5 tadan 1 tadan oshmasin.

JSON massiv qaytar (aniq ${opts.count} ta):
[{"topic":"aniq mavzu","templateType":"educational","note":"1 jumlada post burchagi"}]`,
    { temperature: 1 }
  );
  const arr = Array.isArray(d) ? d : d.ideas || [];
  return arr
    .filter((x: any) => x?.topic)
    .slice(0, opts.count)
    .map((x: any) => ({
      topic: String(x.topic).slice(0, 300),
      templateType: ['news', 'motivation', 'educational', 'promo', 'poll', 'quote', 'lifestyle', 'custom'].includes(x.templateType) ? x.templateType : 'custom',
      note: String(x.note || '').slice(0, 300),
    }));
}
