import { classifyNext } from '@/lib/service';
import { body, failure, json } from '../_util';

// Classifies the next batch of unclassified rows (rules first, then Gemini). The client calls it
// until `remaining` is 0, refreshing the grid between calls so rows fill in as they're done.
export async function POST(request: Request) {
  try {
    const { limit } = await body<{ limit: number }>(request);
    return json(await classifyNext(typeof limit === 'number' ? Math.min(Math.max(limit, 1), 480) : undefined));
  } catch (error) {
    return failure(error, 500);
  }
}
