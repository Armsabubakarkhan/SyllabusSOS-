import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotenv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const PLACEHOLDER = /(change[-_ ]?me|example|your[-_ ]?secret|placeholder|secret123|password)/i;

export function buildConfig(env) {
  const problems = [];
  const warnings = [];

  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    problems.push('NODE_ENV must be development, production or test.');
  }
  const isProd = nodeEnv === 'production';

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a number from 1 to 65535.');

  const host = env.HOST || '127.0.0.1';

  let appSecret = env.APP_SECRET || '';
  if (!appSecret) {
    if (isProd) problems.push('APP_SECRET is required in production (32+ random characters).');
    else {
      appSecret = crypto.randomBytes(48).toString('base64url');
      warnings.push('APP_SECRET is not set. Using a temporary one, so sessions end on restart.');
    }
  } else {
    if (appSecret.length < 32) problems.push('APP_SECRET must be at least 32 characters.');
    if (PLACEHOLDER.test(appSecret)) problems.push('APP_SECRET looks like a placeholder. Generate a random value.');
  }

  const publicUrl = env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || (env.RENDER_EXTERNAL_HOSTNAME ? `https://${env.RENDER_EXTERNAL_HOSTNAME}` : '');
  let publicHost = '';
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      publicHost = u.host.toLowerCase();
      if (isProd && u.protocol !== 'https:' && !u.hostname.includes('localhost') && !u.hostname.includes('127.0.0.1')) {
        problems.push('PUBLIC_URL must use https in production.');
      }
    } catch {
      problems.push('PUBLIC_URL is not a valid URL.');
    }
  } else if (isProd) {
    if (env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_SERVICE_NAME) {
      publicHost = `${(env.RENDER_SERVICE_NAME || 'syllabus-sos').toLowerCase()}.onrender.com`;
    } else {
      problems.push('PUBLIC_URL is required in production.');
    }
  }

  const allowedHosts = new Set(
    (env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  if (publicHost) allowedHosts.add(publicHost);
  if (env.RENDER_EXTERNAL_HOSTNAME) allowedHosts.add(env.RENDER_EXTERNAL_HOSTNAME.toLowerCase());
  if (env.RENDER_SERVICE_NAME) allowedHosts.add(`${env.RENDER_SERVICE_NAME.toLowerCase()}.onrender.com`);
  const corsOrigins = new Set();
  for (const raw of (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw === '*') {
      problems.push('CORS_ORIGINS must list exact origins. A wildcard is not allowed.');
      continue;
    }
    try {
      const u = new URL(raw);
      if (u.origin !== raw.replace(/\/$/, '')) throw new Error('not an origin');
      if (isProd && u.protocol !== 'https:' && u.hostname !== 'localhost') {
        problems.push(`CORS origin ${raw} must use https in production.`);
      }
      corsOrigins.add(u.origin);
    } catch {
      problems.push(`CORS origin "${raw}" is not a valid origin (example: https://example.edu).`);
    }
  }

  const paymentsMode = env.PAYMENTS_MODE || 'off';
  if (!['off', 'test'].includes(paymentsMode)) problems.push('PAYMENTS_MODE must be off or test.');
  const demoMode = String(env.DEMO_MODE || 'false') === 'true';
  if (paymentsMode === 'test' && isProd && !demoMode) {
    problems.push('PAYMENTS_MODE=test in production needs DEMO_MODE=true so users know credits are not real money.');
  }

  const fee = Number(env.PLATFORM_FEE_PERCENT ?? 10);
  if (!Number.isInteger(fee) || fee < 0 || fee > 30) problems.push('PLATFORM_FEE_PERCENT must be a whole number from 0 to 30.');

  const radarMin = Number(env.RADAR_MIN_RESPONSES || 5);
  if (!Number.isInteger(radarMin) || radarMin < 3 || radarMin > 100) problems.push('RADAR_MIN_RESPONSES must be a whole number from 3 to 100.');

  const sessionDays = Number(env.SESSION_DAYS || 7);
  if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 30) problems.push('SESSION_DAYS must be 1 to 30.');

  if (env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length < 12) problems.push('ADMIN_PASSWORD must be at least 12 characters.');
  if (env.ADMIN_PASSWORD && !env.ADMIN_EMAIL) problems.push('ADMIN_PASSWORD is set but ADMIN_EMAIL is missing.');

  let dbPath = path.resolve(ROOT, env.DATABASE_PATH || 'data/syllabussos.db');
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    dbPath = '/tmp/syllabussos.db';
    try {
      const seedDb = path.resolve(ROOT, 'data/syllabussos.db');
      if (!fs.existsSync(dbPath) && fs.existsSync(seedDb)) {
        fs.copyFileSync(seedDb, dbPath);
      }
    } catch {}
  }
  const publicDir = path.join(ROOT, 'public');
  if (dbPath.startsWith(publicDir + path.sep)) problems.push('DATABASE_PATH must not be inside the public folder.');

  if (!isProd) {
    for (const h of ['localhost', `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) allowedHosts.add(h);
  }

  return {
    problems,
    warnings,
    config: {
      nodeEnv,
      isProd,
      isTest: nodeEnv === 'test',
      host,
      port,
      appSecret,
      publicUrl,
      allowedHosts,
      corsOrigins,
      trustProxy: String(env.TRUST_PROXY || 'false') === 'true',
      dbPath,
      paymentsMode,
      demoMode,
      feePercent: fee,
      radarMin,
      sessionDays,
      adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
      adminPassword: env.ADMIN_PASSWORD || '',
      cookieSecure: isProd,
      cookieName: isProd ? '__Host-sid' : 'sid',
    },
  };
}

const fileEnv = loadDotenv(path.join(ROOT, process.env.ENV_FILE || '.env'));
export const result = buildConfig({ ...fileEnv, ...process.env });
export const config = result.config;
