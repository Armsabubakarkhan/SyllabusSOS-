import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { HttpError, badRequest, enforce, limiters } from './security.js';
import { loadUser, requireAdmin, requireAuth } from './auth.js';

/* ---------- router ---------- */

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, opts, handler) {
    if (typeof opts === 'function') {
      handler = opts;
      opts = {};
    }
    const keys = [];
    const src = pattern.replace(/:([a-z_]+)/gi, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    });
    this.routes.push({ method, re: new RegExp(`^${src}/?$`), keys, opts: { auth: 'user', ...opts }, handler });
  }

  get(p, o, h) { this.add('GET', p, o, h); }
  post(p, o, h) { this.add('POST', p, o, h); }
  patch(p, o, h) { this.add('PATCH', p, o, h); }
  delete(p, o, h) { this.add('DELETE', p, o, h); }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          throw badRequest('Malformed address.');
        }
      });
      return { route: r, params };
    }
    return { route: null, pathMatched };
  }
}

/* ---------- request helpers ---------- */

export const MAX_BODY = 64 * 1024;

function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        if (!tooLarge) {
          tooLarge = true;
          req.pause();
          reject(new HttpError(413, 'That request is too large.'));
        }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!tooLarge) reject(err);
    });
  });
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/* ---------- origin, CORS and CSRF ---------- */

export function checkOrigin(ctx, isWrite) {
  const { req, res } = ctx;
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  let sameOrigin = false;
  let allowed = false;
  if (origin) {
    try {
      sameOrigin = new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
    } catch {
      throw new HttpError(403, 'Origin not allowed.');
    }
    allowed = config.corsOrigins.has(origin);
  } else if (fetchSite === 'cross-site') {
    throw new HttpError(403, 'Origin not allowed.');
  }
  if (origin && !sameOrigin && !allowed) {
    if (isWrite || req.method === 'OPTIONS') throw new HttpError(403, 'Origin not allowed.');
    return;
  }
  if (origin && allowed && !sameOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (isWrite && req.headers['x-requested-with'] !== 'sos') {
    throw new HttpError(403, 'Missing request header.');
  }
}

/* ---------- Shared API dispatcher for Node server and serverless functions ---------- */

export async function dispatchApiRequest({ method, url, headers, rawBody, ip, router }) {
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const origin = headers['origin'];
  const fetchSite = headers['sec-fetch-site'];
  let sameOrigin = false;
  let allowed = false;
  const host = String(headers['host'] || '').toLowerCase();

  if (origin) {
    try {
      sameOrigin = new URL(origin).host.toLowerCase() === host;
    } catch {
      throw new HttpError(403, 'Origin not allowed.');
    }
    allowed = config.corsOrigins.has(origin);
  } else if (fetchSite === 'cross-site') {
    throw new HttpError(403, 'Origin not allowed.');
  }

  if (origin && !sameOrigin && !allowed) {
    if (isWrite || method === 'OPTIONS') throw new HttpError(403, 'Origin not allowed.');
  }

  const outHeaders = {};
  if (origin && allowed && !sameOrigin) {
    outHeaders['Access-Control-Allow-Origin'] = origin;
    outHeaders['Access-Control-Allow-Credentials'] = 'true';
    outHeaders['Vary'] = 'Origin';
  }

  if (method === 'OPTIONS') {
    return {
      status: 204,
      headers: {
        ...outHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
        'Access-Control-Max-Age': '600',
      },
      body: null,
    };
  }

  if (isWrite && headers['x-requested-with'] !== 'sos') {
    throw new HttpError(403, 'Missing request header.');
  }

  const parsedUrl = typeof url === 'string' ? new URL(url, 'http://localhost') : url;
  const { route, params, pathMatched } = router.match(method, parsedUrl.pathname);
  if (!route) {
    if (pathMatched) throw new HttpError(405, 'Method not allowed.');
    throw new HttpError(404, 'Not found.');
  }

  const parsedQuery = {};
  let n = 0;
  for (const [k, v] of parsedUrl.searchParams) {
    if (++n > 20) break;
    if (!(k in parsedQuery)) parsedQuery[k] = v.slice(0, 200);
  }

  const ctx = {
    req: { headers, method, url: parsedUrl.href },
    url: parsedUrl,
    ip: ip || '127.0.0.1',
    params,
    query: parsedQuery,
    user: null,
    status: 200,
    headers: {},
  };

  if (route.opts.auth === 'admin') requireAdmin(ctx);
  else if (route.opts.auth === 'user') requireAuth(ctx);
  else loadUser(ctx);

  if (isWrite && ctx.user) enforce(limiters.write, `w:${ctx.user.id}`);

  ctx.body = null;
  if (method === 'POST' || method === 'PATCH') {
    const limit = route.opts.maxBody || MAX_BODY;
    if (rawBody && (typeof rawBody === 'string' ? rawBody.length : rawBody.byteLength)) {
      const byteLen = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : rawBody.byteLength;
      if (byteLen > limit) throw new HttpError(413, 'That request is too large.');
      const ct = String(headers['content-type'] || '').toLowerCase();
      if (!ct.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
      try {
        ctx.body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw badRequest('That was not valid JSON.');
      }
    } else {
      ctx.body = {};
    }
  }

  const result = await route.handler(ctx);
  return {
    status: ctx.status || (result === undefined ? 204 : 200),
    headers: { ...outHeaders, ...ctx.headers },
    body: result,
  };
}

/* ---------- API dispatch ---------- */

export async function handleApi(ctx, router) {
  const { req, res, url } = ctx;
  let rawBody = null;
  if (req.method === 'POST' || req.method === 'PATCH') {
    let maxBytes = MAX_BODY;
    try {
      const { route } = router.match(req.method, url.pathname);
      if (route?.opts?.maxBody) maxBytes = route.opts.maxBody;
    } catch { /* fall back to default MAX_BODY */ }
    rawBody = await readBody(req, maxBytes);
  }
  const result = await dispatchApiRequest({
    method: req.method,
    url,
    headers: req.headers,
    rawBody,
    ip: ctx.ip,
    router,
  });

  if (res.writableEnded) return;
  if (result.body && Buffer.isBuffer(result.body.raw)) {
    res.writeHead(result.status, { 'Content-Length': result.body.raw.byteLength, ...result.headers });
    res.end(req.method === 'HEAD' ? undefined : result.body.raw);
  } else if (result.status === 204 || result.body === undefined || result.body === null) {
    res.writeHead(result.status, result.headers);
    res.end();
  } else {
    sendJson(res, result.status, result.body, result.headers);
  }
}

/* ---------- pages and static files ---------- */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const PUBLIC_DIR = path.join(ROOT, 'public');
const VIEWS_DIR = path.join(ROOT, 'views');

const PAGES = {
  '/': ['public', 'index.html', 'open'],
  '/how-it-works': ['public', 'how-it-works.html', 'open'],
  '/campuses': ['public', 'campuses.html', 'open'],
  '/credits': ['public', 'credits.html', 'open'],
  '/login': ['public', 'auth.html', 'open'],
  '/terms': ['public', 'terms.html', 'open'],
  '/privacy': ['public', 'privacy.html', 'open'],
  '/student': ['views', 'student.html', 'student'],
  '/teacher': ['views', 'teacher.html', 'teacher'],
  '/app': [null, null, 'portal'],
  '/admin': ['views', 'admin.html', 'admin'],
};

export const portalFor = (role) => (role === 'admin' ? '/admin' : role === 'teacher' ? '/teacher' : '/student');

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/* The public origin comes from configuration, never from the request, so a forged Host header cannot reach a page. */
const originOf = (req) => (config.publicUrl ? new URL(config.publicUrl).origin : `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

function sendOpenPage(req, res, file) {
  let html;
  try {
    html = fs.readFileSync(file, 'utf8').replaceAll('__ORIGIN__', originOf(req));
  } catch {
    throw new HttpError(404, 'Not found.');
  }
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : html);
}

function sendFile(req, res, file, type, cache) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    res.end();
    return true;
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    ETag: etag,
    'Cache-Control': cache,
  });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}

export function handleStatic(ctx) {
  const { req, res, url } = ctx;
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

  let pathname = url.pathname.replace(/\/+$/, '') || '/';
  if (/^\/u\/[a-z0-9-]{1,80}$/.test(pathname)) pathname = '/__campus';

  if (pathname === '/__campus') {
    if (!sendFile(req, res, path.join(PUBLIC_DIR, 'u.html'), TYPES['.html'], 'no-cache')) throw new HttpError(404, 'Not found.');
    return;
  }

  const page = PAGES[pathname];
  if (page) {
    const [dir, file, access] = page;
    if (access === 'portal' || access === 'student' || access === 'teacher') {
      const u = loadUser(ctx);
      if (!u) {
        redirect(res, `/login${access === 'teacher' ? '?as=teacher' : ''}`);
        return;
      }
      /* Each role has its own pages. Anyone who opens the wrong one is sent to their own.
         Administrators may also open the teacher workspace, which holds the review tools. */
      const allowed = u.role === access || (access === 'teacher' && u.role === 'admin');
      if (access === 'portal' || !allowed) {
        redirect(res, portalFor(u.role));
        return;
      }
    }
    if (access === 'admin') {
      const u = loadUser(ctx);
      if (!u || u.role !== 'admin') throw new HttpError(404, 'Not found.');
    }
    const base = dir === 'views' ? VIEWS_DIR : PUBLIC_DIR;
    const cache = access === 'open' ? 'no-cache' : 'no-store';
    if (!dir) throw new HttpError(404, 'Not found.');
    if (access === 'open') {
      sendOpenPage(req, res, path.join(base, file));
      return;
    }
    if (!sendFile(req, res, path.join(base, file), TYPES['.html'], cache)) throw new HttpError(404, 'Not found.');
    return;
  }

  if (pathname === '/sitemap.xml') {
    const urls = ['/', '/how-it-works', '/campuses', '/credits', '/terms', '/privacy'];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${originOf(req)}${u === '/' ? '/' : u}</loc></url>`).join('\n')}\n</urlset>\n`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (pathname === '/robots.txt') {
    const body = fs.readFileSync(path.join(PUBLIC_DIR, 'robots.txt'), 'utf8').replace('__ORIGIN__', originOf(req));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Malformed address.');
  }
  if (rel.includes('\0') || rel.split('/').some((seg) => seg.startsWith('.') || seg === '..')) throw new HttpError(404, 'Not found.');
  const ext = path.extname(rel).toLowerCase();
  if (!TYPES[ext] || ext === '.html') throw new HttpError(404, 'Not found.');
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');
  if (!sendFile(req, res, full, TYPES[ext], 'no-cache')) throw new HttpError(404, 'Not found.');
}

export function sendError(res, err, isApi) {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : 'Something went wrong on our side.';
  if (res.headersSent || res.writableEnded) {
    res.destroy();
    return;
  }
  const headers = {};
  if (err instanceof HttpError && err.extra?.retryAfter) headers['Retry-After'] = String(err.extra.retryAfter);
  if (isApi) {
    const payload = { error: message };
    if (err instanceof HttpError && err.extra?.fields) payload.fields = err.extra.fields;
    sendJson(res, status, payload, headers);
  } else {
    const body = `${status} ${message}`;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
    res.end(body);
  }
}
