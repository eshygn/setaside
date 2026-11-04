import { deleteRule } from '@/lib/service';
import { body, json } from '../_util';

export async function DELETE(request: Request) {
  const { id } = await body<{ id: string }>(request);
  if (typeof id !== 'string') return json({ error: 'id is required' }, 400);
  deleteRule(id);
  return json({ ok: true });
}
