const TOKEN_KEY = 'tp_token';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function tgWebApp(): any {
  return (window as any).Telegram?.WebApp;
}

export function inTelegram(): boolean {
  return !!tgWebApp()?.initData;
}

function authHeader(): string | null {
  const initData = tgWebApp()?.initData;
  if (initData) return `tma ${initData}`;
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? `Bearer ${t}` : null;
  } catch {
    return null;
  }
}

export const setToken = (t: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* e'tiborsiz */
  }
};
export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* e'tiborsiz */
  }
};
export const hasToken = () => {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const auth = authHeader();
  if (auth) headers.Authorization = auth;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Internet yoki serverga ulanib bo'lmadi");
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    if (res.status === 413) throw new ApiError(413, "So'rov juda katta (rasm yoki fayl hajmini kamaytiring)");
    throw new ApiError(res.status, `Server javobini o'qib bo'lmadi (${res.status})`);
  }
  if (!res.ok || data?.success === false) {
    throw new ApiError(res.status, data?.error || `Xatolik (${res.status})`);
  }
  return data as T;
}

/** Telegram ichida chiroyli, tashqarisida oddiy tasdiqlash oynasi */
export function confirmDialog(message: string): Promise<boolean> {
  const tg = tgWebApp();
  if (tg?.showConfirm) {
    return new Promise((resolve) => {
      try {
        tg.showConfirm(message, (ok: boolean) => resolve(!!ok));
      } catch {
        resolve(window.confirm(message));
      }
    });
  }
  return Promise.resolve(window.confirm(message));
}

export function openLink(url: string) {
  const tg = tgWebApp();
  if (tg && /^https:\/\/t\.me\//i.test(url) && tg.openTelegramLink) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function haptic(type: 'success' | 'error' | 'light' = 'light') {
  try {
    const h = tgWebApp()?.HapticFeedback;
    if (!h) return;
    if (type === 'light') h.impactOccurred('light');
    else h.notificationOccurred(type);
  } catch {
    /* e'tiborsiz */
  }
}
