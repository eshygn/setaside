// Shared helpers for SetAside's JSON API routes.
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function body<T>(request: Request): Promise<Partial<T>> {
  try {
    return (await request.json()) as Partial<T>;
  } catch {
    return {};
  }
}

export function failure(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[api]', message);
  return json({ error: message }, status);
}
