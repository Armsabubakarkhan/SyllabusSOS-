/* Validates the environment the same way the server does at startup. */
import fs from 'node:fs';
import path from 'node:path';
import { result, ROOT } from '../server/config.js';

let bad = 0;
const line = (ok, text) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
  if (!ok) bad++;
};

line(result.problems.length === 0, 'Configuration is valid');
for (const p of result.problems) console.log(`      ${p}`);
for (const w of result.warnings) console.log(`NOTE  ${w}`);

const c = result.config;
line(!c.isProd || c.cookieSecure, 'Secure cookies are on in production');
line(c.appSecret.length >= 32, 'APP_SECRET has at least 32 characters');
line(c.corsOrigins.size === 0 || ![...c.corsOrigins].some((o) => o === '*'), 'CORS has no wildcard');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  if (process.platform === 'win32') {
    line(true, '.env is present (Windows filesystem does not use Unix permission bits; mode check skipped)');
  } else {
    const mode = fs.statSync(envFile).mode & 0o777;
    line((mode & 0o077) === 0, `.env is private to the owner (mode ${mode.toString(8)})`);
  }
  const text = fs.readFileSync(envFile, 'utf8');
  line(!/^ADMIN_PASSWORD=.+/m.test(text) || !c.isProd, 'ADMIN_PASSWORD is not left in .env for production');
}
const gi = fs.existsSync(path.join(ROOT, '.gitignore')) ? fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8') : '';
line(/^\.env$/m.test(gi), '.gitignore excludes .env');
line(/^data\/$/m.test(gi), '.gitignore excludes the data folder');
line(c.nodeEnv !== 'production' || c.host !== '0.0.0.0' || c.trustProxy, 'Production on 0.0.0.0 should sit behind a proxy (set TRUST_PROXY=true when it does)');

process.exit(bad ? 1 : 0);
