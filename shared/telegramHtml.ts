/**
 * Telegram HTML (parse_mode=HTML) uchun xavfsiz tozalagich.
 * Server (yuborishdan oldin) va klient (preview) bir xil funksiyadan foydalanadi.
 * Faqat Telegram qo'llab-quvvatlaydigan teglar qoldiriladi, qolgani olib tashlanadi.
 */

const SIMPLE_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'tg-spoiler']);
const ALIASES: Record<string, string> = {
  strong: 'b',
  em: 'i',
  ins: 'u',
  strike: 's',
  del: 's',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Matn ichidagi (teg bo'lmagan) qismni xavfsiz qoldiradi: tayyor entity'lar saqlanadi, yolg'iz & < > escape qilinadi */
function cleanText(s: string): string {
  return s
    .replace(/&(?!(?:amp|lt|gt|quot|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function safeHref(raw: string): string | null {
  const href = decodeEntities(raw.trim());
  if (/^(https?:\/\/|tg:\/\/|mailto:)/i.test(href)) return href.replace(/"/g, '&quot;');
  if (/^(t\.me\/|www\.)/i.test(href)) return ('https://' + href).replace(/"/g, '&quot;');
  return null;
}

function markdownToHtml(s: string): string {
  return s
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|\n)#{1,6}\s+([^\n]+)/g, '$1<b>$2</b>')
    .replace(/(^|\n)[*-]\s+/g, '$1• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(ul|ol|div)[^>]*>/gi, '');
}

export function sanitizeTelegramHtml(input: string): string {
  if (!input) return '';
  const src = markdownToHtml(
    String(input)
      .replace(/\r\n/g, '\n')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  );
  const out: string[] = [];
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(src))) {
    out.push(cleanText(src.slice(last, m.index)));
    last = m.index + m[0].length;

    const closing = m[0].startsWith('</');
    let name = m[1].toLowerCase();
    name = ALIASES[name] || name;
    const attrs = m[2] || '';

    let supported = SIMPLE_TAGS.has(name) || name === 'a' || name === 'span' || name === 'tg-emoji';
    if (name === 'span' && !closing && !/class\s*=\s*["']tg-spoiler["']/i.test(attrs)) supported = false;
    if (name === 'span' && closing && !stack.includes('tg-spoiler')) supported = false;
    if (!supported) continue;
    if (name === 'span') name = 'tg-spoiler';
    if (name === 'tg-emoji') continue;

    if (closing) {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue;
      while (stack.length - 1 > idx) out.push(`</${stack.pop()}>`);
      out.push(`</${stack.pop()}>`);
      continue;
    }

    if (name === 'a') {
      const hm = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const href = hm ? safeHref(hm[1] ?? hm[2] ?? '') : null;
      if (!href) continue;
      out.push(`<a href="${href}">`);
      stack.push('a');
    } else if (name === 'blockquote') {
      out.push(/expandable/i.test(attrs) ? '<blockquote expandable>' : '<blockquote>');
      stack.push('blockquote');
    } else if (name === 'tg-spoiler') {
      out.push('<tg-spoiler>');
      stack.push('tg-spoiler');
    } else {
      out.push(`<${name}>`);
      stack.push(name);
    }
  }

  out.push(cleanText(src.slice(last)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').replace(/\n{4,}/g, '\n\n\n').trim();
}

/** Teglarsiz, o'qiladigan matn (uzunlikni hisoblash va zaxira yuborish uchun) */
export function htmlToPlain(html: string): string {
  return decodeEntities((html || '').replace(/<[^>]+>/g, '')).trim();
}

export function plainLength(html: string): number {
  return htmlToPlain(html).length;
}
