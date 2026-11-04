import { updateSettings } from '@/lib/service';
import { body, json } from '../_util';

export async function POST(request: Request) {
  const { otherIncome, upliftBps } = await body<{ otherIncome: number; upliftBps: number }>(request);
  updateSettings({ otherIncome, upliftBps });
  return json({ ok: true });
}
