import { Router, dispatchApiRequest, MAX_BODY } from '../../server/http.js';
import { HttpError } from '../../server/security.js';

const router = new Router();
for (const mod of ['auth', 'campus', 'tutoring', 'wallet', 'social', 'academic', 'admin']) {
  (await import(`../../server/routes/${mod}.js`)).register(router);
}

export default async (req, context) => {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname.startsWith('/.netlify/functions/api')) {
    pathname = pathname.replace('/.netlify/functions/api', '/api');
  }
  if (!pathname.startsWith('/api')) {
    pathname = '/api' + pathname;
  }
  url.pathname = pathname;

  const headers = Object.fromEntries(req.headers);
  if (!headers['host']) headers['host'] = url.host;

  let rawBody = null;
  if (req.method === 'POST' || req.method === 'PATCH') {
    const cl = Number(headers['content-length'] || 0);
    if (cl > MAX_BODY) {
      return new Response(JSON.stringify({ error: 'That request is too large.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    rawBody = await req.text();
    if (Buffer.byteLength(rawBody) > MAX_BODY) {
      return new Response(JSON.stringify({ error: 'That request is too large.' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  }

  try {
    const res = await dispatchApiRequest({
      method: req.method,
      url,
      headers,
      rawBody,
      ip: context?.ip || '127.0.0.1',
      router,
    });

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
    for (const [k, v] of Object.entries(res.headers || {})) {
      responseHeaders.set(k, v);
    }

    if (res.status === 204 || res.body === null || res.body === undefined) {
      return new Response(null, { status: res.status, headers: responseHeaders });
    }
    return new Response(JSON.stringify(res.body), { status: res.status, headers: responseHeaders });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const msg = err instanceof HttpError ? err.message : 'Something went wrong on our side.';
    const payload = { error: msg };
    if (err instanceof HttpError && err.extra?.fields) payload.fields = err.extra.fields;
    const errHeaders = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    if (err instanceof HttpError && err.extra?.retryAfter) errHeaders.set('Retry-After', String(err.extra.retryAfter));
    return new Response(JSON.stringify(payload), { status, headers: errHeaders });
  }
};

export const config = {
  path: ['/api/*', '/.netlify/functions/api/*'],
};
