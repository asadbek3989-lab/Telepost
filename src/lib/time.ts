const pad = (n: number) => String(n).padStart(2, '0');

/** <input type="datetime-local"> uchun QURILMA vaqtidagi qiymat (toISOString UTC bo'lgani uchun ishlatilmaydi) */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local qiymatini (qurilma vaqti) UTC ISO ga aylantiradi */
export function localInputToIso(v: string): string {
  return new Date(v).toISOString();
}

export function inMinutes(min: number): Date {
  return new Date(Date.now() + min * 60_000);
}

export function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

export function fmtDateTime(iso?: string, timeZone?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('uz-UZ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function timeAgo(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'hozirgina';
  if (m < 60) return `${m} daqiqa oldin`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} soat oldin`;
  return `${Math.floor(h / 24)} kun oldin`;
}
