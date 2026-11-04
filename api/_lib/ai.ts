import { GoogleGenAI } from '@google/genai';
import { env } from './env.js';
import { HttpError } from './http.js';
import { sanitizeTelegramHtml } from '../../shared/telegramHtml.js';
import { findBannedPhrases, findCtaViolations, findInformalAddress, humanizeText } from '../../shared/humanize.js';
import { MAX_POST_CHARS, MIN_POST_CHARS, type EmojiMode } from '../../shared/types.js';

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
  // Tezlik: minimal thinking
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

interface AskOpts {
  search?: boolean;
  temperature?: number;
  /** true bo'lsa avval asosiy (GEMINI_MODEL) model ishlatiladi: sifat tezlikdan muhim (post yozish) */
  quality?: boolean;
  maxTokens?: number;
  /** Bitta urinish uchun maksimal vaqt (ms) */
  timeoutMs?: number;
  /** Butun chaqiruv (barcha urinishlar) uchun byudjet (ms). Vercel 60 soniyalik limitidan oshmasligi kerak */
  budgetMs?: number;
}

async function askJson(prompt: string, opts: AskOpts = {}): Promise<any> {
  const temperature = opts.temperature ?? 0.85;
  const maxOutputTokens = opts.maxTokens ?? 2048;
  const perTry = opts.timeoutMs ?? 28_000;
  const budget = opts.budgetMs ?? 52_000;
  const startedAt = Date.now();
  // Tezkor rejim: avval fallback (flash-lite). Sifat rejimi: avval asosiy model.
  const order = opts.quality ? [env.textModel, env.fallbackModel] : [env.fallbackModel, env.textModel];
  const models = order.filter((m, i, a) => m && a.indexOf(m) === i);
  const remaining = () => budget - (Date.now() - startedAt);

  const run = async (model: string, withSearch: boolean) => {
    const base: Record<string, any> = withSearch
      ? { tools: [{ googleSearch: {} }], temperature, maxOutputTokens }
      : { responseMimeType: 'application/json', temperature, maxOutputTokens };
    const ms = Math.min(withSearch ? perTry + 12_000 : perTry, Math.max(6_000, remaining()));
    return await callModel(model, prompt, base, ms);
  };
  try {
    let lastErr: any;
    for (const model of models) {
      if (remaining() < 6_000 && lastErr) break;
      try {
        if (opts.search) {
          // Search sekin: avval searchsiz urinib ko'ramiz, keyin search bilan
          try {
            const res = await run(model, false);
            return parseJson(res.text || '');
          } catch {
            /* search bilan qayta */
          }
          if (remaining() < 10_000) throw new HttpError(504, "AI javobi juda sekin keldi. Qayta urinib ko'ring.");
          const res = await run(model, true);
          return parseJson(res.text || '');
        }
        const res = await run(model, false);
        return parseJson(res.text || '');
      } catch (e) {
        lastErr = e;
        if (isQuota(e)) continue; // keyingi model
        if (e instanceof HttpError && e.status === 504) continue;
        // boshqa xato: keyingi modelga o'tamiz
      }
    }
    throw lastErr || new HttpError(502, 'AI javob bermadi');
  } catch (e) {
    throw wrapError(e);
  }
}

const LANG: Record<string, string> = {
  'uz-lat': "O'zbek tili (Lotin yozuvi). Tabiiy, zamonaviy, adabiy me'yorga mos va grammatik jihatdan to'g'ri; rus/ingliz so'zlarini keraksiz aralashtirmang. Apostrof faqat to'g'ri belgi (') bilan yozilsin: Ba'zan, o'zingiz, to'g'ri.",
  'uz-kir': 'Ўзбек тили (Кирилл ёзуви). Табиий, адабий меъёрга мос ва хатосиз.',
  ru: "Русский язык. Живой, современный, без канцеляризмов. Обращение к читателю только на «Вы», с уважением.",
  en: 'English. Natural, engaging, concise. Respectful, formal "you" address, no slang.',
};

const TONE: Record<string, string> = {
  "do'stona": "samimiy va iliq, lekin hurmatli; o'quvchi bilan ishonchli suhbatdoshdek, ammo \"Siz\" deb",
  rasmiy: 'jiddiy, xolis, ishonchli va professional',
  sotuvchi: "diqqatni tortuvchi, ishonchli va aniq; bosim va qo'rqitishsiz, harakatga aniq undovchi",
  qiziqarli: 'yengil, nozik hazil bilan, jonli; kinoyasiz va hech kimni kamsitmasdan',
  tahliliy: 'faktlar, mantiq va ekspert mulohazalariga asoslangan, bosiq',
};

const TEMPLATE: Record<string, string> = {
  news: "Yangilik va tahlil: voqea mohiyati aniq va qisqa, nega muhimligi va o'quvchi hayotiga ta'siri. Faqat tekshirilgan ma'lumot (qidiruv natijasi bo'lsa, shundan). Taxmin va mish-mishdan qoching.",
  motivation:
    "Motivatsion post: bitta kuchli haqiqatdan boshlang, o'quvchini bahonalardan chiqarib, aniq kichik qadamlarga olib boring. Quruq shior va bo'sh va'dalar (\"hammasi mumkin\" kabi) emas, hayotiy va amaliy bo'lsin.",
  educational:
    "Foydali qo'llanma: muammo yoki xato, so'ng 3-5 ta aniq amaliy qadam (har biri qisqa buyruq jumla va 1-2 gaplik izoh), oxirida esda qoladigan yakuniy fikr.",
  promo:
    "Taklif posti: asosiy taklif, o'quvchi uchun aniq foyda, ishonch elementi va tabiiy chaqiruv. Soxta chegirma, to'qima raqam va yolg'on shoshilinchlik yozmang.",
  poll:
    "Mulohaza posti: o'ylantiradigan yoki bahsli mavzuda ikki qarashni adolatli ko'rsating va o'z xulosangizni bering. O'quvchini fikrlashga undang, lekin savol bilan tugatmang va izohga chorlamang.",
  quote:
    "Iqtibos tahlili: faqat 100% ishonchli, muallifi aniq iqtibos (ishonchingiz komil bo'lmasa, iqtibos keltirmay, g'oyani o'z so'zingiz bilan yozing), uning ma'nosi va hayotda qo'llanishi.",
  lifestyle: "Kunlik mulohaza: yengil, shaxsiy ohangdagi, lekin mazmunli fikr yoki ertalabki/kechki xabarnoma. Quruq salomlashuv emas, bitta aniq kuzatish bo'lsin.",
  story:
    "Ibratli hikoya: qisqa, jonli voqea (umumiy obraz, masalan \"Bir inson...\"; real shaxs va tarixiy faktni to'qimang), undan chiqadigan saboq va bugun qo'llash mumkin bo'lgan amaliy xulosa.",
  essay:
    "Chuqur maqola: mavzuni 3-5 ta mazmunli bo'limda oching. Har bo'lim qisqa <b>kichik sarlavha</b> bilan boshlansin va yangi fikr, misol yoki hikoya bersin. Takror va to'ldiruvchi gap bo'lmasin.",
  myth:
    "Xurofot va haqiqat: mavzu bo'yicha keng tarqalgan 3-5 ta noto'g'ri tasavvur va har birining haqiqati, qisqa dalil bilan. Faqat o'zingiz ishongan, umumiy tan olingan fikrlarni yozing.",
  challenge:
    "Kunlik topshiriq: o'quvchi bugun 5-30 daqiqada bajara oladigan bitta aniq mini-topshiriq, nega ishlashi va qanday boshlash kerakligi. Qadamlar aniq va o'lchanadigan bo'lsin.",
  custom: "Mavzuga eng mos, original va yuqori sifatli Telegram post.",
};

const EMOJI_RULE: Record<EmojiMode, string> = {
  none: "Hech qanday emoji va emoji o'rnida turuvchi belgi ishlatmang. Ro'yxat bandlari uchun oddiy raqam (1., 2.) yoki shunchaki yangi qator yetarli.",
  minimal:
    "Kam: faqat sarlavha boshida 1 ta mos emoji va ro'yxat bandlari boshida bir xil belgi (masalan 🔹). Butun postda 6 tadan ko'p emoji bo'lmasin. Gap ichida emoji yo'q.",
  rich: "Ko'proq: sarlavhada 1 ta, ro'yxat bandlarida mazmuniga mos belgilar, ayrim paragraflar boshida 1 tadan. Butun postda 10 tadan oshmasin; gap o'rtasida va ketma-ket emoji qo'ymang.",
};

/** Standart uslub namunasi: kanalda o'z namuna kiritilmagan bo'lsa shu ishlatiladi */
export const DEFAULT_STYLE_SAMPLE = `🎯 Sizni hech kim qutqarishga kelmaydi

Ba'zan inson hayotidagi o'zgarishlarni kutib yashaydi. Yaxshi imkoniyat, qulay vaqt, munosib sharoit yoki uni to'g'ri yo'lga boshlaydigan biror inson paydo bo'lishini kutadi.
Ammo bir haqiqat bor: hayotingizni o'zgartirish mas'uliyati, avvalo, o'zingizning zimmangizda.

Hech kim sizning o'rningizga kitob o'qimaydi, bilim olmaydi, xatolardan saboq chiqarmaydi yoki maqsadlaringiz sari harakat qilmaydi.
Sizga maslahat berishlari mumkin, yo'l ko'rsatishlari mumkin, hatto qo'llab-quvvatlashlari ham mumkin. Lekin birinchi qadamni baribir o'zingiz tashlashingiz kerak.

O'zgarish nimadan boshlanadi?

🔹 Bahona qilishni to'xtating. Vaqt yetishmasligi, imkoniyat yo'qligi yoki sharoitning og'irligi sizni doimo ortga tortmasin.
🔹 Kichik qadamlardan boshlang. Kuniga 10 sahifa kitob o'qish, 20 daqiqa yangi bilim o'rganish yoki bitta foydali odatni shakllantirish — bularning barchasi vaqt o'tishi bilan katta natijaga aylanadi.
🔹 O'zingizga bergan va'dangizda turing. Boshqalarga bergan va'dangizni bajarishga qanchalik harakat qilsangiz, o'zingizga bergan va'dalaringizga ham shunchalik mas'uliyat bilan yondashing.
🔹 Natijani emas, jarayonni seving. Har kuni muvaffaqiyatga erishishingiz shart emas. Ammo har kuni kechagidan yaxshiroq bo'lishga intilishingiz mumkin.

Bir narsani unutmang: Sizning bugungi odatlaringiz — ertangi hayotingizning poydevori.

Bir yildan keyin qayerda bo'lishingizni bugun qabul qilayotgan qarorlaringiz belgilaydi.
O'zgarishni dushanbadan, yangi oydan yoki yangi yildan boshlamang. Bugun boshlang. Chunki hayotingizni o'zgartirish uchun eng yaxshi vaqt — aynan hozir.`;

export interface FinalizeOpts {
  emojiMode?: EmojiMode;
  /** true: hashtag, chorlov va oxirgi savol paragrafini olib tashlaydi (AI yozgan yangi postlar uchun) */
  strict?: boolean;
}

/** Matnni tozalaydi (Telegram HTML + "inson qalami" normallashtirish). Imzo qo'shilmaydi. */
export function cleanBody(text: string, opts: FinalizeOpts = {}): string {
  return humanizeText(sanitizeTelegramHtml(text), { emojiMode: opts.emojiMode, strict: opts.strict });
}

export function finalizeText(text: string, signature?: string, opts: FinalizeOpts = {}): string {
  let out = cleanBody(text, opts);
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
  /** Admin belgilagan maksimal belgi (300–5000), default 1500 */
  maxChars?: number;
  /** Emoji darajasi (admin belgilaydi), default 'minimal' */
  emojiMode?: EmojiMode;
  /** Admin shu post uchun bergan qo'shimcha ko'rsatma */
  instructions?: string;
  /** Kanalning uslub namunasi (bo'sh bo'lsa standart namuna) */
  styleSample?: string;
  /** Ishlatilmasligi kerak bo'lgan so'z va iboralar */
  bannedPhrases?: string[];
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

/** Matnda sifat qoidalariga zid joylar bormi: "sen"lash, taqiqlangan so'z, uzunlik */
function auditText(html: string, p: { maxChars: number; banned: string[]; language: string }): string[] {
  const plain = html.replace(/<[^>]+>/g, '');
  const issues: string[] = [];
  if (p.language === 'uz-lat' || p.language === 'uz-kir') {
    const informal = findInformalAddress(plain);
    if (informal.length) issues.push(`"Sen"lab murojaat qilingan joylar bor (${informal.slice(0, 6).join(', ')}). Hammasini hurmatli "Siz" shakliga o'tkazing (masalan: "hayotingiz", "boshlang", "o'ylab ko'ring")`);
  }
  const cta = findCtaViolations(plain);
  if (cta.length) issues.push(`Taqiqlangan element bor: ${cta.join(', ')}. Olib tashlang`);
  const bad = findBannedPhrases(plain, p.banned);
  if (bad.length) issues.push(`Taqiqlangan so'z/iboralar ishlatilgan: ${bad.join(', ')}. Boshqacha ifodalang`);
  const len = plain.length;
  if (len > p.maxChars * 1.12) issues.push(`Matn juda uzun (${len} belgi). Mazmunni yo'qotmay ${p.maxChars} belgiga yaqinlashtiring, ortiqcha va takroriy gaplarni olib tashlang`);
  if (p.maxChars >= 1200 && len < p.maxChars * 0.6) issues.push(`Matn juda qisqa (${len} belgi). Yangi mazmunli fikr, aniq misol yoki hikoya qo'shib, taxminan ${Math.round(p.maxChars * 0.85)} belgigacha kengaytiring; suv aralashtirmang`);
  return issues;
}

export async function generatePost(p: PostParams): Promise<GeneratedPost> {
  const startedAt = Date.now();
  const requested = p.maxChars && Number.isFinite(p.maxChars) ? Math.floor(p.maxChars) : 1500;
  const maxChars = Math.min(MAX_POST_CHARS, Math.max(MIN_POST_CHARS, requested));
  const minChars = Math.round(maxChars * 0.75);
  const emojiMode: EmojiMode = p.emojiMode || 'minimal';
  const banned = (p.bannedPhrases || []).map((x) => x.trim()).filter(Boolean).slice(0, 40);
  const sample = (p.styleSample || '').trim().slice(0, 3500) || DEFAULT_STYLE_SAMPLE;
  const topicLine = p.autoTopic
    ? "Mavzuni o'zingiz tanlang: kanal yo'nalishiga mos, aniq, o'ziga xos va yangi (umumiy emas)."
    : `Mavzu: ${p.topic}`;

  const lengthRule =
    maxChars >= 2500
      ? `Uzun post: fikrni 3-5 ta mazmunli qismga bo'ling; har qism yangi bilim, aniq misol yoki hikoya bersin. To'ldiruvchi gap qo'shmang, lekin hajm ${minChars}-${maxChars} belgi oralig'ida bo'lsin.`
      : maxChars >= 1000
        ? `Hajm ${minChars}-${maxChars} belgi oralig'ida. Namuna post hajmiga yaqin, to'liq ochilgan fikr.`
        : `Ixcham post: ${minChars}-${maxChars} belgi. Har gap ish bersin.`;

  const prompt = `Siz o'zbek tilidagi nufuzli Telegram kanallar uchun yozadigan tajribali muallif va muharrirsiz. Vazifa: kanalga bitta tayyor, to'liq, nashrga loyiq post yozish. Javob faqat JSON.

KANAL
Nomi: ${p.channelTitle || 'Telegram kanal'}
${p.niche ? `Yo'nalish: ${p.niche}` : ''}
Auditoriya: ${p.audience || "keng o'quvchilar"}
${topicLine}
Post turi: ${TEMPLATE[p.templateType] || TEMPLATE.custom}
Ohang: ${TONE[p.tone] || TONE["do'stona"]}
Til: ${LANG[p.language] || LANG['uz-lat']}
${p.instructions?.trim() ? `Admin ko'rsatmasi (albatta bajaring): ${p.instructions.trim().slice(0, 500)}` : ''}
${p.recentTopics?.length ? `Yaqinda joylangan mavzular (takrorlamang, boshqa burchakdan yozing): ${p.recentTopics.slice(0, 10).join(' | ')}` : ''}
${banned.length ? `Ishlatish TAQIQLANGAN so'z va iboralar: ${banned.join(' | ')}` : ''}
${p.wantFile ? `Qo'shimcha fayl ham kerak: "${p.fileRequest || p.topic}"` : ''}

USLUB NAMUNASI. Faqat ritm, tuzilma, jonli ohang va sifat darajasini o'rganing. Namunadagi mavzu, jumla va iboralarni ko'chirmang:
"""
${sample}
"""

YOZISH QOIDALARI
1. Murojaat: o'quvchiga HAR DOIM "Siz" deb murojaat qiling. "Sen", "sening", "senga" va "-san" shakllari mutlaqo taqiqlanadi. Buyruq shakli ham hurmatli bo'lsin ("boshlang", "o'ylab ko'ring"). Ohang hurmatli, intizomli va xotirjam: kinoya, haqorat, qo'pol so'z, qo'rqitish va bosim yo'q.
2. Tuzilma: birinchi qator o'quvchini to'xtatadigan ilgakli sarlavha (shunchaki mavzu nomi emas); keyin 1-2 qisqa kirish paragrafi (muammo yoki haqiqat); asosiy qism; oxirida esda qoladigan yakuniy fikr.
3. Sifat: bitta aniq markaziy fikr. Har bir gap yangi ma'no qo'shsin. Oldi-qochdi, umumiy, takroriy va suv gaplar yo'q. Aniq misol, aniq harakat va hayotiy kuzatish keltiring. "Bugungi zamonda..." kabi qolipli kirish yo'q.
4. Tabiiylik: post tajribali inson qo'li bilan yozilgandek bo'lsin. Gap uzunligi xilma-xil: qisqa va uzunroq gaplar aralashsin. Ketma-ket bir xil so'z bilan boshlanadigan gaplar, "bu shunchaki X emas, balki Y" qolipi, har joyda uchtalik sanash va ortiqcha ta'kid yo'q. "Xulosa qilib aytganda", "aytish joizki", "shubhasiz", "bebaho", "zamonaviy dunyoda" kabi sun'iy iboralar yo'q. Undov belgisi butun postda ko'pi bilan 1 ta. Uzun tire (—) butun postda ko'pi bilan 3-4 marta. "Xulosa:", "Kirish:" kabi yorliqlar yozmang.
5. Halollik: to'qima statistika, tadqiqot, shaxs va iqtibos yozmang. Aniq bilmagan faktni keltirmang.
6. TAQIQLANGAN: hashtag; "saqlab qo'ying", "do'stlarga yuboring/ulashing", "izohda yozing", "like bosing", "obuna bo'ling" kabi chorlovlar; postni savol bilan tugatish; o'zingizdan imzo yoki kanal manzili yozish (imzo tizim tomonidan qo'shiladi). Post yakuni kuchli fikr yoki harakatga undovchi jumla bo'lsin, savol emas. Postning o'rtasida mavzuni ochuvchi savol-sarlavha (namunadagi "O'zgarish nimadan boshlanadi?" kabi) bo'lishi mumkin.
7. Format: faqat Telegram HTML. Sarlavha <b>...</b> bilan; butun postda qalin yoki kursiv ko'pi bilan 3 joyda. Markdown (*, #, -) yozmang. Paragraflar orasida bo'sh qator. Ro'yxat bandlari alohida qatordan, bandlar orasida bo'sh qator qoldirmang.
8. Emoji: ${EMOJI_RULE[emojiMode]}
9. Hajm: matn (imzosiz) ${lengthRule}
${p.hasImage ? "10. Post rasm bilan chiqadi: rasm matnni takrorlamasin, imagePrompt mavzuning ramziy, chiroyli ifodasi bo'lsin." : ''}

JSON:
{"title":"qisqa ichki nom","text":"HTML post (imzosiz)","imagePrompt":"English image description, no text in image","ctaText":"2-4 so'z","file":${p.wantFile ? '{"name":"file.txt","content":"...","mimeType":"text/plain"}' : 'null'},"readingTime":"2 daqiqa","bestTime":"09:00-11:00","tip":"adminga bir jumlalik maslahat"}`;

  const maxTokens = Math.min(8192, 2600 + Math.round(maxChars * 0.9));
  const d = await askJson(prompt, {
    search: !!p.useSearch,
    temperature: 0.8,
    quality: true,
    maxTokens,
    timeoutMs: maxChars > 2500 ? 50_000 : 38_000,
  });

  const cleanOpts: FinalizeOpts = { emojiMode, strict: true };
  let body = cleanBody(String(d.text || d.formattedText || ''), cleanOpts);
  if (!body) throw new HttpError(502, "AI bo'sh matn qaytardi, qayta urinib ko'ring");

  // Sifat nazorati: sen/taqiqlangan element/uzunlik muammosi bo'lsa, bir marta tuzatamiz (vaqt qolgan bo'lsa)
  const audit = { maxChars, banned, language: p.language };
  const issues = auditText(body, audit);
  if (issues.length && Date.now() - startedAt < 30_000) {
    try {
      const fixed = await fixPost(body, issues, { maxChars, language: p.language, emojiMode, banned });
      const fixedBody = cleanBody(fixed, cleanOpts);
      if (fixedBody && auditText(fixedBody, audit).length <= issues.length) body = fixedBody;
    } catch {
      /* asl matn bilan davom etamiz */
    }
  }

  const text = finalizeText(body, p.signature, { emojiMode: undefined });
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

async function fixPost(text: string, issues: string[], c: { maxChars: number; language: string; emojiMode: EmojiMode; banned: string[] }): Promise<string> {
  const d = await askJson(
    `Quyidagi Telegram postni muharrir sifatida tuzating. Mazmun, tuzilma va uslubni saqlang, faqat muammolarni yo'qoting.

MUAMMOLAR:
${issues.map((x, i) => `${i + 1}. ${x}`).join('\n')}

QOIDALAR: o'quvchiga faqat hurmatli "Siz" bilan murojaat; hashtag yo'q; "saqlab qo'ying/izohda yozing/ulashing" chorlovlari yo'q; post savol bilan tugamasin; sun'iy qolipli iboralar yo'q; faqat Telegram HTML (<b>, <i>); Markdown yo'q. Emoji: ${EMOJI_RULE[c.emojiMode]}${c.banned.length ? `\nTaqiqlangan so'zlar: ${c.banned.join(' | ')}` : ''}
Imzo yoki kanal manzili qo'shmang.

POST:
${text}

JSON qaytaring: {"text":"tuzatilgan post"}`,
    { temperature: 0.5, quality: true, maxTokens: Math.min(8192, 2600 + Math.round(c.maxChars * 0.9)), timeoutMs: 40_000, budgetMs: 40_000 }
  );
  return String(d.text || '');
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
  expand: "Matnni aniq misollar va tafsilotlar bilan kengaytir, lekin suv aralashtirma va takrorlama.",
  fix: "Imlo, grammatika va uslub xatolarini tuzat; ma'no va ohangni o'zgartirma.",
  humanize:
    "Matnni tajribali inson muallif yozgandek tabiiy qil: sun'iy qoliplar, takror, ortiqcha ta'kid va shablon iboralarni ol (\"xulosa qilib aytganda\", \"bu shunchaki ... emas, balki ...\" kabi), gap uzunligini xilma-xil qil. Ma'no, tuzilma, hajm (±10%), emoji miqdori va \"Siz\" murojaatini saqla.",
  'uz-lat': "O'zbek tiliga (Lotin) tarjima qil.",
  'uz-kir': 'Ўзбек тилига (Кирилл) таржима қил.',
  ru: 'Переведи на русский язык.',
  en: 'Translate into English.',
};

export const REWRITE_ACTIONS = [...Object.keys(REWRITE), 'noemoji'];

export async function rewriteText(text: string, action: string, ctx: { bannedPhrases?: string[] } = {}): Promise<string> {
  // Emojilarni olib tashlash AI siz, mahalliy bajariladi
  if (action === 'noemoji') {
    const out = cleanBody(text, { emojiMode: 'none' });
    if (!out) throw new HttpError(502, "Matn bo'sh qoldi");
    return out;
  }
  const instruction = REWRITE[action];
  if (!instruction) throw new HttpError(400, "Noma'lum amal");
  const banned = (ctx.bannedPhrases || []).filter(Boolean);
  const d = await askJson(
    `Quyidagi Telegram post matnini tahrirla.
Vazifa: ${instruction}
Qoidalar: faqat Telegram HTML teglari (<b>, <i>, <u>, <s>, <code>, <blockquote>, <a href>) saqlansin; Markdown ishlatma; havolalarni saqla. O'quvchiga faqat hurmatli "Siz" bilan murojaat qil ("sen" taqiqlangan). Yangi hashtag, "saqlab qo'ying" yoki izohga chorlov qo'shma.${banned.length ? ` Taqiqlangan so'zlar: ${banned.join(' | ')}.` : ''}

MATN:
${text}

JSON qaytar: {"text":"tahrirlangan matn"}`,
    { temperature: 0.6, quality: action === 'humanize' || action === 'expand', maxTokens: 6000, timeoutMs: 40_000 }
  );
  const out = cleanBody(String(d.text || ''));
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
  const ids = ['news', 'motivation', 'educational', 'promo', 'poll', 'quote', 'lifestyle', 'story', 'essay', 'myth', 'challenge', 'custom'];
  const d = await askJson(
    `
Siz Telegram kanal kontent-strategisiz. ${opts.count} ta post g'oyasidan iborat kontent reja tuzing.

Kanal yo'nalishi: ${opts.niche || 'umumiy'}
Auditoriya: ${opts.audience || "keng o'quvchilar"}
${opts.focus ? `Bu reja uchun asosiy e'tibor: ${opts.focus}` : ''}
Til: ${LANG[opts.language] || LANG['uz-lat']}
${opts.recentTopics?.length ? `Yaqinda joylangan (takrorlamang): ${opts.recentTopics.slice(0, 15).join(' | ')}` : ''}

Talablar:
- G'oyalar xilma-xil bo'lsin: foydali qo'llanma, ibratli hikoya, xurofot va haqiqat, kunlik topshiriq, mulohaza, motivatsiya, iqtibos tahlili.
- Har bir mavzu aniq va o'ziga xos (masalan "Biznes haqida" emas, "Birinchi 100 mijozni ijtimoiy tarmoqsiz topishning 4 yo'li").
- templateType faqat shulardan: ${ids.join(', ')}. Sotuv (promo) 5 tadan 1 tadan oshmasin.

JSON massiv qaytaring (aniq ${opts.count} ta):
[{"topic":"aniq mavzu","templateType":"educational","note":"1 jumlada post burchagi"}]`,
    { temperature: 1, maxTokens: Math.min(8192, 1200 + opts.count * 160) }
  );
  const arr = Array.isArray(d) ? d : d.ideas || [];
  return arr
    .filter((x: any) => x?.topic)
    .slice(0, opts.count)
    .map((x: any) => ({
      topic: String(x.topic).slice(0, 300),
      templateType: ids.includes(x.templateType) ? x.templateType : 'custom',
      note: String(x.note || '').slice(0, 300),
    }));
}
