import { resetDemo } from '@/lib/service';
import { DEFAULT_PRESET, isPresetId } from '@/lib/tax/presets';
import { body, failure, json } from '../_util';

export async function POST(request: Request) {
  const { preset } = await body<{ preset: string }>(request);
  try {
    await resetDemo(isPresetId(preset) ? preset : DEFAULT_PRESET);
    return json({ ok: true });
  } catch (error) {
    return failure(error, 500);
  }
}
