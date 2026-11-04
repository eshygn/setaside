import { setClock } from '@/lib/service';
import { body, failure, json } from '../_util';

// Moves the demo clock and pulls any transactions that "happened" in between from PayPal.
export async function POST(request: Request) {
  const { date } = await body<{ date: string }>(request);
  try {
    return json(await setClock(String(date)));
  } catch (error) {
    return failure(error);
  }
}
