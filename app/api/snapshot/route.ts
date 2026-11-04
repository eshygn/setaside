import { snapshot } from '@/lib/service';
import { failure, json } from '../_util';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return json(await snapshot());
  } catch (error) {
    return failure(error, 500);
  }
}
