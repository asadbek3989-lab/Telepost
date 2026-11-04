/**
 * AI matnini "inson qalamidek" tozalovchi yordamchilar.
 * Server (yuborishdan oldin) ishlatadi. Telegram HTML teglariga tegmaydi, faqat matn qismlariga ishlaydi.
 */
import type { EmojiMode } from './types.js';

/** HTML teglarini saqlab, faqat matn qismlariga funksiya qo'llaydi */
function mapText(html: string, fn: (t: string) => string): string {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') && part.endsWith('>') ? part : fn(part)))
    .join('');
}

const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u20E3)(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;

export function countEmoji(html: string): number {
  return (html.replace(/<[^>]+>/g, '').match(EMOJI_RE) || []).length;
}

export function stripEmoji(html: string): string {
  const lead = new RegExp(`(^|\\n|>)[ \\t]*(?:${EMOJI_RE.source})+[ \\t]*`, 'gu');
  return html
    .replace(lead, '$1')
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') && part.endsWith('>') ? part : part.replace(EMOJI_RE, '').replace(/\uFE0F/g, '')))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/(^|\n)[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Ko'p emoji bo'lsa, birinchi `max` tadan keyingilarini olib tashlaydi */
function capEmoji(html: string, max: number): string {
  let seen = 0;
  return mapText(html, (t) =>
    t.replace(EMOJI_RE, (m) => {
      seen++;
      return seen <= max ? m : '';
    })
  ).replace(/[ \t]{2,}/g, ' ');
}

/** Ommaviy so'zlashuvdagi AI-iboralar va kanalga mos kelmaydigan yakunlar */
const CTA_PARAGRAPH_RE =
  /(saqlab\s+qo['’ʻ`]?y|saqlab\s+oling|izoh(?:da|larda|ga)?\s+(?:yozing|qoldiring|bildiring)|fikringizni\s+(?:yozing|izohlarda)|do['’ʻ`]?stlaringizga\s+(?:yuboring|ulashing)|ulashing|obuna\s+bo['’ʻ`]?ling|like\s+bosing|layk\s+bosing|repost|kanalimizga\s+qo['’ʻ`]?shiling)/i;

/** "Sen"lab gapirish belgilari (hurmat talabiga zid) */
const INFORMAL_RE =
  /(?<![\p{L}'’ʻ`])(sen|sening|senga|seni|sendan|senda|senikidek|o['’ʻ`]?zing(?:ni|ga|dan|da|ning)?|hayoting|vaqting|kuching|maqsading|orzuing|qalbing|fikring|ishing|oilang|do['’ʻ`]?sting|yo['’ʻ`]?ling|qo['’ʻ`]?ling|ko['’ʻ`]?zing|boshing|bilasan|qilasan|istaysan|xohlaysan|o['’ʻ`]?ylaysan|bo['’ʻ`]?lasan|ko['’ʻ`]?rasan|qilyapsan|bilmaysan|qilmaysan|boshla|to['’ʻ`]?xta|qil|o['’ʻ`]?yla|qara|esla|unutma)(?![\p{L}'’ʻ`])/giu;

export function findInformalAddress(plain: string): string[] {
  // "qil", "ber", "yoz" kabi qisqa buyruq shakllari ba'zan boshqa so'zlarning qismi bo'lmasa ham muammo emas; faqat aniq mosliklar olinadi
  const out = new Set<string>();
  for (const m of plain.matchAll(INFORMAL_RE)) out.add(m[0].toLowerCase());
  return [...out];
}

export function findBannedPhrases(plain: string, banned: string[]): string[] {
  const low = plain.toLowerCase();
  return banned.filter((b) => b && low.includes(b.toLowerCase()));
}

/** Postda taqiqlangan elementlar bormi: hashtag, "saqlab qo'ying", izohga chorlov va hokazo */
export function findCtaViolations(plain: string): string[] {
  const issues: string[] = [];
  if (/(^|\s)#[\p{L}\d_]{2,}/u.test(plain)) issues.push('hashtag');
  if (CTA_PARAGRAPH_RE.test(plain)) issues.push("saqlash/izoh/ulashishga chorlov");
  return issues;
}

/** Hashtag qatorlari va so'zlarini olib tashlaydi */
function dropHashtags(html: string): string {
  return mapText(html, (t) => t.replace(/(^|[ \t])#[\p{L}\d_]{2,}/gu, '$1'))
    .replace(/[ \t]+\n/g, '\n');
}

/** Matnni paragraflarga bo'lib, CTA bo'lgan qisqa paragraflarni, hamda oxiridagi savol paragrafini olib tashlaydi */
function dropCtaParagraphs(html: string): string {
  const plainOf = (s: string) => s.replace(/<[^>]+>/g, '').trim();
  let paras = html.split(/\n{2,}/);
  paras = paras.filter((p) => {
    const pl = plainOf(p);
    if (!pl) return false;
    return !(pl.length <= 220 && CTA_PARAGRAPH_RE.test(pl));
  });
  // Oxirgi paragraf savol bilan tugasa (muhokamaga chorlov), olib tashlaymiz
  while (paras.length > 1) {
    const last = plainOf(paras[paras.length - 1]);
    if (last.endsWith('?') && last.length <= 260) paras.pop();
    else break;
  }
  return paras.join('\n\n');
}

/** Uzun tire (—) ni haddan tashqari ko'p ishlatishni jilovlaydi */
function limitDashes(html: string, plainLen: number): string {
  const max = Math.max(4, Math.round(plainLen / 450));
  let count = 0;
  return mapText(html, (t) =>
    t.replace(/ — /g, (m) => {
      count++;
      return count <= max ? m : ', ';
    })
  );
}

export interface HumanizeOpts {
  /** undefined bo'lsa, emojilarga tegilmaydi */
  emojiMode?: EmojiMode;
  /** CTA/hashtag/savol yakunlarini ham tozalash (AI yozgan yangi postlar uchun) */
  strict?: boolean;
}

/**
 * Asosiy tozalagich. Bajaradi:
 *  - ko'rinmas (zero-width) va g'alati bo'shliq belgilarini olib tashlaydi;
 *  - apostroflarni (ʻ ’ ‘ `) bitta ' ga keltiradi (namunadagidek: Ba'zan, o'zingiz);
 *  - tire va ko'p nuqtalarni odatiy ko'rinishga keltiradi;
 *  - emoji rejimiga amal qiladi;
 *  - hashtag, "saqlab qo'ying", izohga chorlov, oxirgi savol paragrafini olib tashlaydi.
 */
export function humanizeText(html: string, opts: HumanizeOpts = {}): string {
  let s = String(html || '').replace(/\r\n/g, '\n');

  // Emoji rejimi (ZWJ ketma-ketliklari buzilmasligi uchun zero-width tozalashdan oldin)
  if (opts.emojiMode === 'none') s = stripEmoji(s);
  else if (opts.emojiMode === 'minimal') s = capEmoji(s, 8);
  else if (opts.emojiMode === 'rich') s = capEmoji(s, 24);

  s = mapText(s, (t) =>
    t
      .replace(/[\u200B\u200C\u2060\uFEFF\u00AD\u202F\u2009\u200A]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/(?<=\p{L})[ʻʼ’‘`´′](?=\p{L})/gu, "'")
      .replace(/([oOgG])[ʻʼ’‘`´′]/g, "$1'")
      .replace(/[“”„‟]/g, '"')
      .replace(/…/g, '...')
      .replace(/ [–―] /g, ' — ')
      .replace(/ - (?=\p{L})/gu, ' — ')
      .replace(/(?<=\p{L})--(?=\p{L})/gu, ' — ')
      .replace(/ {2,}/g, ' ')
      .replace(/ +([,.;:!?])/g, '$1')
      .replace(/([!?])\1{1,}/g, '$1')
      .replace(/\.{4,}/g, '...')
  );

  if (opts.strict) {
    s = dropHashtags(s);
    s = dropCtaParagraphs(s);
  }

  const plainLen = s.replace(/<[^>]+>/g, '').length;
  s = limitDashes(s, plainLen);

  return s
    .replace(/^\s*(?:\*{3,}|-{3,}|_{3,}|={3,})\s*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
