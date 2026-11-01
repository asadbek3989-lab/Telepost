/**
 * Rasm yordamchilari: Vercel so'rov limiti (4.5 MB) va baza hajmi sababli rasmlar JPEG ga siqiladi.
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Rasmni o'qib bo'lmadi"));
    img.src = src;
  });
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Faylni o'qib bo'lmadi"));
    r.readAsDataURL(b);
  });
}

/** Rasmni (File yoki data URL) maxDim gacha kichraytirib, hajmi maxChars dan oshmaguncha JPEG sifatini tushiradi */
export async function compressImage(source: Blob | string, maxDim = 1280, maxChars = 650_000): Promise<string> {
  const src = typeof source === 'string' ? source : await blobToDataUrl(source);
  const img = await loadImage(src);
  let scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  let quality = 0.88;

  for (let i = 0; i < 12; i++) {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= maxChars) return out;
    if (quality > 0.55) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error("Rasmni yetarlicha siqib bo'lmadi, boshqa rasm tanlang");
}

/** Ro'yxatlar uchun kichik ko'rinish */
export async function makeThumb(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const size = 160;
  const scale = Math.max(size / img.width, size / img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/jpeg', 0.6);
}

const PALETTES: [string, string, string][] = [
  ['#0f172a', '#1e3a8a', '#38bdf8'],
  ['#1e1b4b', '#6d28d9', '#f0abfc'],
  ['#052e2b', '#0f766e', '#5eead4'],
  ['#3b0764', '#be185d', '#fda4af'],
  ['#1c1917', '#b45309', '#fcd34d'],
  ['#0c1a3a', '#0369a1', '#7dd3fc'],
];

/** AI rasm ishlamaganda: sarlavhali chiroyli muqova kartasi (Telegram PNG/JPEG qabul qiladi, SVG emas) */
export function makeCoverCard(title: string, channelTitle: string, ratio: '1:1' | '16:9' | '4:3' = '1:1'): string {
  const dims = ratio === '16:9' ? [1280, 720] : ratio === '4:3' ? [1200, 900] : [1080, 1080];
  const [W, H] = dims;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [c1, c2, accent] = PALETTES[hash % PALETTES.length];

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(W * 0.88, H * 0.12, H * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.arc(W * 0.05, H * 0.95, H * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const pad = W * 0.08;
  ctx.fillStyle = accent;
  ctx.font = `700 ${Math.round(H * 0.035)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText((channelTitle || 'TELEPOST').toUpperCase().slice(0, 32), pad, pad);

  const fontSize = Math.round(H * (ratio === '16:9' ? 0.085 : 0.07));
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
  const maxW = W - pad * 2;
  const words = title.replace(/<[^>]+>/g, '').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 5);
  if (lines.length > 5) shown[4] = shown[4].replace(/\s*\S*$/, '') + '…';
  const lh = fontSize * 1.25;
  let y = (H - shown.length * lh) / 2;
  for (const l of shown) {
    ctx.fillText(l, pad, y);
    y += lh;
  }

  ctx.fillStyle = accent;
  ctx.fillRect(pad, H - pad - H * 0.012, W * 0.14, H * 0.012);

  return canvas.toDataURL('image/jpeg', 0.9);
}
