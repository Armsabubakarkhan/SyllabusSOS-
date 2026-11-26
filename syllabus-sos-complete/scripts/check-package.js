/* Pre-deploy and packaging gate: ensures no secrets, .env files, or database files are packaged */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : null;

const FORBIDDEN_EXTENSIONS = ['.db', '.db-wal', '.db-shm', '.sqlite', '.key', '.pem'];
const FORBIDDEN_FILES = ['.env', '.env.local', '.env.production', '.env.development'];

let violations = 0;

function checkFile(filePath, relPath) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (FORBIDDEN_FILES.includes(base)) {
    console.error(`FAIL Forbidden environment file found: ${relPath}`);
    violations++;
  } else if (FORBIDDEN_EXTENSIONS.includes(ext)) {
    console.error(`FAIL Forbidden database or key file found: ${relPath}`);
    violations++;
  }

  if (relPath.startsWith('public' + path.sep) && (base.startsWith('.env') || ext === '.db')) {
    console.error(`FAIL Sensitive file found in public folder: ${relPath}`);
    violations++;
  }
}

function scanDir(dir, baseDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full);

    if (entry.isDirectory()) {
      scanDir(full, baseDir);
    } else {
      checkFile(full, rel);
    }
  }
}

if (target) {
  console.log(`Checking package cleanliness in: ${target}`);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    scanDir(target, target);
  } else {
    console.error(`Target directory ${target} does not exist.`);
    violations++;
  }
} else {
  console.log(`Checking repository hygiene in: ${ROOT}`);
  // In development root, verify public folder and check .gitignore
  const publicDir = path.join(ROOT, 'public');
  if (fs.existsSync(publicDir)) {
    scanDir(publicDir, ROOT);
  }
  const gitignorePath = path.join(ROOT, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    console.error('FAIL .gitignore is missing');
    violations++;
  } else {
    const gi = fs.readFileSync(gitignorePath, 'utf8');
    if (!/^\.env$/m.test(gi) || !/^data\/$/m.test(gi)) {
      console.error('FAIL .gitignore must exclude .env and data/');
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\nCheck-package FAILED: ${violations} forbidden artifact(s) found.`);
  process.exit(1);
} else {
  console.log('PASS Check-package clean: no exposed credentials, .env, or database files in distribution.');
  process.exit(0);
}
