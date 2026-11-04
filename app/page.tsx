import { connection } from 'next/server';
import { hasAiKey } from '@/lib/ai/model';
import { ensureReady, snapshot } from '@/lib/service';
import { SetAsideApp } from './ui/app';

export default async function Home() {
  // SQLite and the demo clock change per request: render on demand, never at build time.
  await connection();
  await ensureReady();
  const initial = await snapshot();
  return (
    <SetAsideApp
      initial={initial}
      // AG Grid / AG Studio licence keys are meant to ship to the browser; the PayPal and Gemini
      // secrets never leave the server.
      licenseKey={process.env.AG_GRID_LICENSE_KEY || undefined}
      aiKeyConfigured={hasAiKey()}
      paypalClientId={process.env.PAYPAL_CLIENT_ID || undefined}
    />
  );
}
