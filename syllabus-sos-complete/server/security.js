import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);

/* ---------- errors ---------- */

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
export const badRequest = (message, fields) => new HttpError(400, message, fields ? { fields } : {});

/* ---------- text sanitising ---------- */

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;
const TAGLIKE = /<\/?[a-z!?][^>]*>?/gi;

export function clean(value, { multiline = false } = {}) {
  let t = String(value).normalize('NFC').replace(INVISIBLE, '');
  for (let i = 0; i < 6; i++) {
    const next = t.replace(TAGLIKE, '');
    if (next === t) break;
    t = next;
  }
  if (multiline) t = t.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  else t = t.replace(/[\r\n\t]+/g, ' ');
  return t.trim();
}

/* ---------- input validation ---------- */

export const T = {
  str: (o = {}) => ({ t: 'str', min: 1, max: 200, multiline: false, ...o }),
  int: (o = {}) => ({ t: 'int', min: -2147483648, max: 2147483647, ...o }),
  enum: (values, o = {}) => ({ t: 'enum', values, ...o }),
  email: (o = {}) => ({ t: 'email', ...o }),
  iso: (o = {}) => ({ t: 'iso', ...o }),
  meetingUrl: (o = {}) => ({ t: 'meetingUrl', ...o }),
  domain: (o = {}) => ({ t: 'domain', ...o }),
  phone: (o = {}) => ({ t: 'phone', ...o }),
  httpsUrl: (o = {}) => ({ t: 'httpsUrl', ...o }),
  /** Untouched text, used for passwords only. */
  raw: (o = {}) => ({ t: 'raw', min: 1, max: 128, ...o }),
};

export const MEETING_HOSTS = ['meet.jit.si', 'zoom.us', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com'];

function checkOne(key, spec, raw) {
  switch (spec.t) {
    case 'str': {
      if (typeof raw !== 'string') return { err: 'Must be text' };
      const v = clean(raw, { multiline: spec.multiline });
      if (v.length < spec.min) return { err: spec.min === 1 ? 'Required' : `At least ${spec.min} characters` };
      if (v.length > spec.max) return { err: `At most ${spec.max} characters` };
      return { v };
    }
    case 'httpsUrl': {
      if (typeof raw !== 'string') return { err: 'Must be a link' };
      let u;
      try {
        u = new URL(raw.trim());
      } catch {
        return { err: 'Enter a full link starting with https://' };
      }
      if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) {
        return { err: 'Use a public https link' };
      }
      const s = u.toString();
      if (s.length > 300) return { err: 'That link is too long' };
      return { v: s };
    }
    case 'raw': {
      if (typeof raw !== 'string') return { err: 'Must be text' };
      if (raw.length < spec.min) return { err: 'Required' };
      if (raw.length > spec.max) return { err: `At most ${spec.max} characters` };
      return { v: raw };
    }
    case 'int': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return { err: 'Must be a whole number' };
      if (raw < spec.min || raw > spec.max) return { err: `Must be between ${spec.min} and ${spec.max}` };
      return { v: raw };
    }
    case 'enum': {
      if (!spec.values.includes(raw)) return { err: `Must be one of: ${spec.values.join(', ')}` };
      return { v: raw };
    }
    case 'email': {
      if (typeof raw !== 'string') return { err: 'Must be text' };
      const v = raw.trim().toLowerCase();
      if (v.length > 254 || !/^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return { err: 'Enter a valid email address' };
      return { v };
    }
    case 'domain': {
      if (typeof raw !== 'string') return { err: 'Must be text' };
      const v = raw.trim().toLowerCase();
      if (v.length > 100 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) return { err: 'Enter a domain like example.edu' };
      return { v };
    }
    case 'phone': {
      if (typeof raw !== 'string') return { err: 'Must be text' };
      const v = raw.trim();
      if (v.length > 0 && !/^[+]?[\d\s-]{7,20}$/.test(v)) return { err: 'Enter a valid phone number (e.g. +91 9876543210)' };
      return { v };
    }
    case 'iso': {
      if (typeof raw !== 'string') return { err: 'Must be a date and time' };
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return { err: 'Enter a valid date and time' };
      return { v: d.toISOString() };
    }
    case 'meetingUrl': {
      if (typeof raw !== 'string') return { err: 'Must be a link' };
      let u;
      try {
        u = new URL(raw.trim());
      } catch {
        return { err: 'Enter a full link starting with https://' };
      }
      const host = u.hostname.toLowerCase();
      const ok = MEETING_HOSTS.some((h) => host === h || host.endsWith('.' + h));
      if (u.protocol !== 'https:' || u.username || u.password || !ok) {
        return { err: 'Use an https link from Jitsi, Zoom, Google Meet or Microsoft Teams' };
      }
      return { v: u.toString().slice(0, 300) };
    }
    default:
      return { err: 'Invalid' };
  }
}

/** schema: { field: spec | {...spec, optional: true} }  Unknown fields are rejected. */
export function parse(input, schema) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Send a JSON object.');
  const fields = {};
  const out = {};
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) fields[key] = 'Unknown field';
  }
  for (const [key, spec] of Object.entries(schema)) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === '') {
      if (spec.optional) {
        if (spec.default !== undefined) out[key] = spec.default;
        continue;
      }
      fields[key] = 'Required';
      continue;
    }
    const r = checkOne(key, spec, raw);
    if (r.err) fields[key] = r.err;
    else out[key] = r.v;
  }
  if (Object.keys(fields).length) throw badRequest('Check the highlighted fields.', fields);
  return out;
}

/* ---------- passwords ---------- */

const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '1234567890', '123456789', '12345678', 'qwertyuiop', 'qwerty123',
  'iloveyou', 'admin123', 'welcome1', 'welcome123', 'letmein123', 'abc123456', 'university', 'student123', 'changeme123',
  '1q2w3e4r5t', 'monkey1234', 'football1', 'dragon1234', 'sunshine1', 'princess1', 'india12345', 'india@123',
]);

export function passwordProblem(pw, email = '') {
  if (typeof pw !== 'string') return 'Password must be text.';
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || /^(.)\1+$/.test(pw)) return 'That password is too common. Pick something harder to guess.';
  const local = email.split('@')[0];
  if (local && local.length >= 4 && low.includes(local.toLowerCase())) return 'Do not use your email name inside the password.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) return 'Mix letters with at least one number or symbol.';
  return null;
}

const SCRYPT = config.isTest ? { N: 1 << 12, r: 8, p: 1 } : { N: 1 << 16, r: 8, p: 2 };
const KEYLEN = 64;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, KEYLEN, { ...SCRYPT, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(pw).normalize('NFKC'), salt, expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

let dummyHash;
/** Burn the same time for unknown accounts so response timing does not reveal them. */
export async function dummyVerify(pw) {
  dummyHash ??= await hashPassword(crypto.randomBytes(12).toString('hex'));
  await verifyPassword(pw, dummyHash);
}

/* ---------- rate limiting (in memory, per process) ---------- */

export function createLimiter({ windowMs, max, maxKeys = 50000 }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      while (arr.length && arr[0] <= cutoff) arr.shift();
      if (!arr.length) hits.delete(k);
    }
  }, 60000);
  timer.unref();
  return {
    take(key) {
      const now = Date.now();
      let arr = hits.get(key);
      if (!arr) {
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        arr = [];
        hits.set(key, arr);
      }
      while (arr.length && arr[0] <= now - windowMs) arr.shift();
      if (arr.length >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000)) };
      arr.push(now);
      return { ok: true };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

export const limiters = {
  global: createLimiter({ windowMs: 10 * 60 * 1000, max: config.demoMode ? 10000 : (config.isProd ? 900 : 5000) }),
  authIp: createLimiter({ windowMs: 15 * 60 * 1000, max: config.demoMode ? 2000 : (config.isProd ? 15 : (config.isTest ? 400 : 2000)) }),
  authEmail: createLimiter({ windowMs: 15 * 60 * 1000, max: config.demoMode ? 100 : (config.isProd ? 8 : (config.isTest ? 8 : 100)) }),
  register: createLimiter({ windowMs: 60 * 60 * 1000, max: config.demoMode ? 1000 : (config.isProd ? 10 : (config.isTest ? 200 : 1000)) }),
  write: createLimiter({ windowMs: 10 * 60 * 1000, max: config.demoMode ? 5000 : (config.isProd ? 240 : 5000) }),
  message: createLimiter({ windowMs: 60 * 1000, max: config.demoMode ? 500 : (config.isProd ? 30 : 500) }),
  publicDemo: createLimiter({ windowMs: 60 * 1000, max: config.demoMode ? 500 : (config.isProd ? 60 : 500) }),
};

export function enforce(limiter, key) {
  const r = limiter.take(key);
  if (!r.ok) throw new HttpError(429, 'Too many requests. Try again shortly.', { retryAfter: r.retryAfter });
}

/* ---------- headers ---------- */

export function securityHeaders(res, { isApi }) {
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ];
  if (config.isProd) csp.push('upgrade-insecure-requests');
  res.setHeader('Content-Security-Policy', csp.join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (isApi) res.setHeader('Cache-Control', 'no-store');
}

export function clientIp(req) {
  if (config.trustProxy) {
    if (req.headers['cf-connecting-ip']) return String(req.headers['cf-connecting-ip']).trim();
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[0];
  }
  return req.socket.remoteAddress || 'unknown';
}
