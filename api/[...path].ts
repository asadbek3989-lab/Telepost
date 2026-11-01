import { handle } from './_lib/routes.js';

export default async function handler(req: any, res: any) {
  await handle(req, res);
}
