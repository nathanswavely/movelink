import type { APIRoute } from 'astro';

// Open by design: client-ops's daily check reads it to prove the Worker answers.
export const GET: APIRoute = () =>
  new Response('ok\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
