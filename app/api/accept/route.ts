import { accept } from '@/lib/service';
import { body, json } from '../_util';

export async function POST(request: Request) {
  const { ids } = await body<{ ids: string[] }>(request);
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string')) return json({ error: 'ids must be a list of transaction ids' }, 400);
  accept(ids);
  return json({ ok: true });
}
