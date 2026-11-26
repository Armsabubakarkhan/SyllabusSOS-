/* Static audit of the project. Complements the automated tests, which exercise the running server. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`);
  if (!ok) failures++;
};

const pkg = JSON.parse(read('package.json'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
check(Object.keys(deps).length === 0, `Third-party packages: ${Object.keys(deps).length} (nothing to update, nothing unused, no supply chain exposure)`);
check(!fs.existsSync(path.join(ROOT, 'node_modules')), 'No node_modules folder');
check(pkg.private === true, 'package.json is private (cannot be published by accident)');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p) : files.push(p);
  }
})(ROOT);
const src = files.filter((f) => /\.(js|html)$/.test(f) && !f.includes(`${path.sep}test${path.sep}`) && !f.includes(`${path.sep}scripts${path.sep}`));
const text = (f) => fs.readFileSync(f, 'utf8');

const hits = (re, only = src) => only.filter((f) => re.test(text(f))).map((f) => path.relative(ROOT, f));
const show = (arr) => (arr.length ? ` (${arr.join(', ')})` : '');

let r = hits(/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(/);
check(!r.length, `No innerHTML, outerHTML or document.write in app code${show(r)}`);
r = hits(/\beval\(|new Function\(|setTimeout\(\s*['"`]/);
check(!r.length, `No eval or string timers${show(r)}`);
r = hits(/<script(?![^>]*\bsrc=)[^>]*>/i, src.filter((f) => f.endsWith('.html')));
check(!r.length, `No inline scripts in any page, so the CSP can forbid them${show(r)}`);
r = hits(/\sstyle=["']/, src.filter((f) => f.endsWith('.html')));
check(!r.length, `No inline style attributes in pages${show(r)}`);
r = hits(/\son[a-z]+=["']/i, src.filter((f) => f.endsWith('.html')));
check(!r.length, `No inline event handler attributes${show(r)}`);

const serverFiles = src.filter((f) => f.includes(`${path.sep}server${path.sep}`));
r = serverFiles.filter((f) => /(?:run|get|all)\(\s*`[^`]*\$\{/.test(text(f)) && !/NOW|VISIBLE|RES_SELECT|BOOKING_SELECT|OFFER_SELECT|USER_SELECT|USER_COLS|RATING|TUTOR_FIELDS|where|sets|scope|hscope/.test(text(f))).map((f) => path.relative(ROOT, f));
check(!r.length, `Database calls use bound parameters${show(r)}`);

const interpolated = [];
for (const f of serverFiles) {
  const lines = text(f).split('\n');
  lines.forEach((l, i) => {
    const m = /(?:run|get|all)\(\s*`([^`]*)`/.exec(l) || (/(?:run|get|all)\(\s*$/.test(l) ? null : null);
    if (m && /\$\{(?!NOW|where|sets|scope|hscope|VISIBLE|RES_SELECT|BOOKING_SELECT|OFFER_SELECT|USER_SELECT|keys\.map|RATING)/.test(m[1])) interpolated.push(`${path.relative(ROOT, f)}:${i + 1}`);
  });
}
check(!interpolated.length, `No user input is interpolated into SQL${show(interpolated)}`);

const gi = read('.gitignore');
check(/^\.env$/m.test(gi) && /^data\/$/m.test(gi), '.gitignore protects .env and data/');
check(fs.existsSync(path.join(ROOT, '.env.example')) && !/^[A-Z_]*(SECRET|PASSWORD|KEY|TOKEN)[A-Z_]*=\S+/m.test(read('.env.example')), '.env.example holds placeholders only (secret fields are empty)');
check(!fs.existsSync(path.join(ROOT, 'public', '.env')) && !files.some((f) => f.startsWith(path.join(ROOT, 'public')) && /\.(db|sqlite|env|pem|key|log)$/.test(f)), 'Nothing sensitive inside the public folder');

const sec = read('server/security.js');
const http = read('server/http.js');
check(/default-src 'none'/.test(sec) && /frame-ancestors 'none'/.test(sec), 'Content Security Policy is strict (default-src none, no framing)');
check(/Strict-Transport-Security/.test(sec), 'HSTS is sent in production');
check(/scrypt/.test(sec) && /timingSafeEqual/.test(sec), 'Passwords use scrypt with constant time comparison');
check(/X-Requested-With/.test(http) && /Origin not allowed/.test(http), 'Writes are protected against cross-site requests');
check(!/Access-Control-Allow-Origin['"]\s*,\s*['"]\*/.test(http), 'CORS never answers with a wildcard');
check(/HttpOnly/.test(read('server/auth.js')) && /SameSite=Strict/.test(read('server/auth.js')), 'Session cookie is HttpOnly and SameSite=Strict');
check(!/stack/.test(http.replace(/\/\*.*?\*\//gs, '')) || !/err\.stack/.test(http), 'Stack traces are never sent to clients');

const mode = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.statSync(path.join(ROOT, p)).mode & 0o777 : null);
for (const p of ['.env', 'data']) {
  const m = mode(p);
  if (m !== null) {
    if (process.platform === 'win32') {
      check(true, `${p} is present (Windows filesystem does not use Unix permission bits; mode check skipped)`);
    } else {
      check((m & 0o077) === 0, `${p} is private to the owner (mode ${m.toString(8)})`);
    }
  }
}

try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/scan-secrets.js')], { stdio: 'pipe' });
  check(true, 'Secret scan of files and git history is clean');
} catch (e) {
  check(false, `Secret scan found problems:\n${String(e.stdout)}${String(e.stderr)}`);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll static checks passed.');
process.exit(failures ? 1 : 0);
