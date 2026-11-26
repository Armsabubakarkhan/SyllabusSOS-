/* Scans working files and git history for leaked secrets. Exit code 1 if anything is found. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'data']);
const SKIP_FILES = new Set(['.env']);

const PATTERNS = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Anthropic or OpenAI style key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['Hardcoded secret assignment', /\b(?:secret|password|passwd|api[_-]?key|token)\b["']?\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}["']/i],
];
const ALLOW = [/example\.test/, /process\.env/, /\.env\.example/, /Wrong-Password-\d/];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (!SKIP_FILES.has(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

function scanText(label, text, found) {
  text.split('\n').forEach((line, i) => {
    if (ALLOW.some((a) => a.test(line))) return;
    for (const [name, re] of PATTERNS) {
      if (re.test(line)) found.push(`${label}:${i + 1}  ${name}`);
    }
  });
}

const found = [];
let files = 0;
for (const f of walk(ROOT)) {
  if (/\.(png|ico|woff2?|db|zip)$/.test(f)) continue;
  files++;
  scanText(path.relative(ROOT, f), fs.readFileSync(f, 'utf8'), found);
}
console.log(`Scanned ${files} working files.`);

if (fs.existsSync(path.join(ROOT, '.git'))) {
  try {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    for (const bad of ['.env', ...tracked.filter((t) => t.startsWith('data/') || t.endsWith('.db'))]) {
      if (bad && tracked.includes(bad)) found.push(`git: ${bad} is tracked by git`);
    }
    const history = execFileSync('git', ['log', '-p', '--all', '--no-color'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    scanText('git history', history, found);
    const commits = execFileSync('git', ['rev-list', '--all', '--count'], { cwd: ROOT, encoding: 'utf8' }).trim();
    console.log(`Scanned git history (${commits} commit${commits === '1' ? '' : 's'}).`);
  } catch (e) {
    console.log(`Git history not scanned: ${e.message.split('\n')[0]}`);
  }
} else {
  console.log('No git repository here, so history was not scanned.');
}

if (found.length) {
  console.error('\nPossible secrets found:');
  for (const f of found) console.error(`  ${f}`);
  process.exit(1);
}
console.log('No secrets found.');
