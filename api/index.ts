import { handle } from './_lib/routes.js';

/** Barcha /api/* so'rovlari vercel.json dagi rewrite orqali shu yerga keladi */
export default async function handler(req: any, res: any) {
  await handle(req, res);
}
