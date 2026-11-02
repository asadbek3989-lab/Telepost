import { GoogleGenAI } from '@google/genai';
import { env } from './env.js';
import { HttpError } from './http.js';
import { plainLength, sanitizeTelegramHtml } from '../../shared/telegramHtml.js';

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!env.geminiKey) throw new HttpError(503, "GEMINI_API_KEY sozlanmagan (Vercel > Environment Variables).");
  if (!client) client = new GoogleGenAI({ apiKey: env.geminiKey });
  return client;
}

function wrapError(e: any): HttpError {
  if (e instanceof HttpError) return e;
  let msg = String(e?.message || e);
  try {
    const j = JSON.parse(msg);
    msg = j?.error?.message || msg;
  } catch {
    /* oddiy matn */
  }
  if (/API key|API_KEY|permission|PERMISSION/i.test(msg)) msg = "Gemini API kaliti noto'g'ri yoki ruxsat yo'q";
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) msg = "Gemini limiti tugadi (bepul tarifda kunlik/daqiqalik limit kam). Bir daqiqadan keyin urinib ko'ring yoki aistudio.google.com da billing yoqing";
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

function withTimeout<T>(p: Promise<T>, ms = 45_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new HttpError(504, "AI javobi juda sekin keldi. Qayta urinib ko'ring yoki GEMINI_MODEL ni flash-lite qilib qo'ying.")),
      ms
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

const errText = (e: any) => String(e?.message || e);
const isQuota = (e: any) => /quota|RESOURCE_EXHAUSTED|\b429\b|rate.?limit/i.test(errText(e));
const isThinkingErr = (e: any) => /thinking/i.test(errText(e));

async function callModel(model: string, prompt: string, base: Record<string, any>, ms: number) {
  // Tezlik: minimal thinking + maxOutputTokens
  const speedConfig: Record<string, any> = {
    ...base,
    maxOutputTokens: base.maxOutputTokens ?? 2048,
    thinkingConfig: { thinkingLevel: 'LOW' },
  };
  try {
    return await withTimeout(
      ai().models.generateContent({ model, contents: prompt, config: speedConfig as any }),
      ms
    );
  } catch (e) {
    if (isThinkingErr(e)) {
      const { thinkingConfig: _, ...noThink } = speedConfig;
      return await withTimeout(ai().models.generateContent({ model, contents: prompt, config: noThink as any }), ms);
    }
    throw e;
  }
}

async function askJson(prompt: string, opts: { search?: boolean; temperature?: number } = {}): Promise<any> {
  const temperature = opts.temperature ?? 0.85;
  // Avval tezkor model (fallback), keyin asosiy — odatda flash-lite 5–15 soniyada javob beradi
  const models = [env.fallbackModel, env.textModel].filter((m, i, a) => m && a.indexOf(m) === i);
  const run = async (model: string, withSearch: boolean) => {
    const base: Record<string, any> = withSearch
      ? { tools: [{ googleSearch: {} }], temperature, maxOutputTokens: 2048 }
      : { responseMimeType: 'application/json', temperature, maxOutputTokens: 2048 };
    return await callModel(model, prompt, base, withSearch ? 40_000 : 28_000);
  };
  try {
    let lastErr: any;
    // 1) Tez model, searchsiz
    for (const model of models) {
      try {
        if (opts.search) {
          // Search sekin — avval searchsiz urinib ko'ramiz, keyin search
          try {
            const res = await run(model, false);
            return parseJson(res.text || '');
          } catch {
            /* search bilan qayta */
          }
          const res = await run(model, true);
          return parseJson(res.text || '');
        }
        const res = await run(model, false);
        return parseJson(res.text || '');
      } catch (e) {
        lastErr = e;
        if (isQuota(e)) continue; // keyingi model
        if (e instanceof HttpError && e.status === 504) continue;
        // boshqa xato — keyingi modelga o'tamiz
      }
    }
    throw lastErr || new HttpError(502, 'AI javob bermadi');
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
  /** Admin belgilagan maksimal belgi (300–1000), default 900 */
  maxChars?: number;
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
  // Hard max 1000; default 900; rasm bilan biroz qisqaroq
  const requested = p.maxChars && Number.isFinite(p.maxChars) ? Math.floor(p.maxChars) : 900;
  const maxChars = Math.min(1000, Math.max(300, p.hasImage ? Math.min(requested, 900) : requested));
  const topicLine = p.autoTopic
    ? "Mavzuni o'zing tanla: kanalga mos, aniq va yangi (umumiy emas)."
    : `Mavzu: ${p.topic}`;

  // Qisqa prompt = tezroq javob
  const prompt = `Telegram post yoz. JSON qaytar.

Kanal: ${p.channelTitle || 'Telegram'}
${p.niche ? `Yo'nalish: ${p.niche}` : ''}
Auditoriya: ${p.audience || "o'quvchilar"}
${topicLine}
Turi: ${p.templateType} — ${TEMPLATE[p.templateType] || TEMPLATE.custom}
Ohang: ${TONE[p.tone] || TONE["do'stona"]}
Til: ${LANG[p.language] || LANG['uz-lat']}
${p.recentTopics?.length ? `Takrorlama: ${p.recentTopics.slice(0, 8).join(' | ')}` : ''}
${p.wantFile ? `Fayl ham kerak: "${p.fileRequest || p.topic}"` : ''}

Qoidalar:
- 1-qator kuchli ilgak + emoji. Bo'sh kirish yo'q.
- Qisqa paragraflar, amaliy ma'lumot, oxirida CTA + 3-5 hashtag.
- Faqat Telegram HTML (<b><i><u><s><code><blockquote><a>). Markdown yo'q.
- Matn ≤ ${maxChars} belgi. Imzo qo'shma.

JSON:
{"title":"qisqa nom","text":"HTML post","imagePrompt":"English image description, no text in image","ctaText":"2-4 so'z","file":${p.wantFile ? '{"name":"file.txt","content":"...","mimeType":"text/plain"}' : 'null'},"readingTime":"1 daqiqa","bestTime":"09:00-11:00","tip":"qisqa maslahat"}`;

  const d = await askJson(prompt, { search: !!p.useSearch, temperature: 0.85 });
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

export async function generateImage(prompt: string, aspectRatio = '1:1'): Promise<string> {
  const refined = `${prompt}. Professional high quality editorial illustration for a social media post, clean modern composition, balanced lighting, rich but harmonious colors. Absolutely no text, no letters, no logos, no watermarks.`;
  try {
    const res = await withTimeout(
      ai().models.generateContent({
        model: env.imageModel,
        contents: { parts: [{ text: refined }] },
        config: { imageConfig: { aspectRatio: aspectRatio as any } },
      }),
      40_000
    );
    for (const part of res.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) return `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`;
    }
  } catch (e) {
    throw wrapError(e);
  }
  throw new HttpError(502, 'AI rasm qaytarmadi (limit yoki xavfsizlik filtri bo\'lishi mumkin)');
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
