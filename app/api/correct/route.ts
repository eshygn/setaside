import { isCategory } from '@/lib/categories';
import { correct } from '@/lib/service';
import { body, failure, json } from '../_util';

export async function POST(request: Request) {
  const { id, category } = await body<{ id: string; category: string }>(request);
  if (typeof id !== 'string' || !isCategory(category)) return json({ error: 'id and a valid category are required' }, 400);
  try {
    return json(correct(id, category));
  } catch (error) {
    return failure(error);
  }
}
