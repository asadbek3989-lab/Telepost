export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Vercel va Express uchun umumiy minimal so'rov/javob turlari */
export interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, any>;
  body?: any;
}

export interface Res {
  status(code: number): Res;
  setHeader(name: string, value: string | number): any;
  json(body: any): any;
  send(body: any): any;
  end(body?: any): any;
}

export function header(req: Req, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] || '' : v || '';
}

export function originOf(req: Req): string {
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  const proto = header(req, 'x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0]}://${host}`;
}
