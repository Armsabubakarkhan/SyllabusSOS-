import http from 'node:http';
import { config, result } from './config.js';

if (result.problems.length) {
  console.error('Configuration problems:');
  for (const p of result.problems) console.error(`  - ${p}`);
  console.error('Fix these in your environment or .env file and start again.');
  process.exit(1);
}
for (const w of result.warnings) console.warn(`Notice: ${w}`);

const { Router, handleApi, handleStatic, sendError } = await import('./http.js');
const { HttpError, securityHeaders, clientIp, enforce, limiters } = await import('./security.js');
const { autoSettle } = await import('./routes/tutoring.js');
const { createAdmin } = await import('./routes/auth.js');

const router = new Router();
for (const mod of ['auth', 'campus', 'tutoring', 'wallet', 'social', 'academic', 'admin']) {
  (await import(`./routes/${mod}.js`)).register(router);
}

function hostAllowed(req) {
  if (config.nodeEnv === 'development') return true;
  const host = String(req.headers.host || '').toLowerCase();
  return config.allowedHosts.has(host);
}

export function createServer() {
  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req);
    let isApi = false;
    try {
      const url = new URL(req.url || '/', 'http://placeholder.invalid');
      isApi = url.pathname.startsWith('/api/');
      securityHeaders(res, { isApi });
      if (!hostAllowed(req)) throw new HttpError(421, 'Unknown host.');
      enforce(limiters.global, `g:${ip}`);
      const ctx = { req, res, url, ip, user: null, status: 200, headers: null };
      if (isApi) await handleApi(ctx, router);
      else handleStatic(ctx);
    } catch (err) {
      if (!(err instanceof HttpError)) {
        if (/UNIQUE constraint/i.test(String(err?.message))) {
          sendError(res, new HttpError(409, 'That already exists.'), isApi);
          return;
        }
        console.error(`[${new Date().toISOString()}] ${req.method} ${String(req.url).slice(0, 120)}:`, err?.message || err);
      }
      sendError(res, err, isApi);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('server/index.js')) {
  if (config.adminEmail && config.adminPassword) {
    try {
      const r = await createAdmin(config.adminEmail, config.adminPassword);
      if (r.created) console.log('Administrator account created. Remove ADMIN_PASSWORD from your environment now.');
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }
  autoSettle();
  setInterval(autoSettle, 5 * 60 * 1000).unref();
  const server = createServer();
  server.listen(config.port, config.host, () => {
    console.log(`SyllabusSOS++ listening on http://${config.host}:${config.port} (${config.nodeEnv})`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
