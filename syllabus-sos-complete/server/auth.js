import crypto from 'node:crypto';
import { config } from './config.js';
import { get, run } from './db.js';
import { HttpError } from './security.js';

const hashToken = (token) => crypto.createHmac('sha256', config.appSecret).update(token).digest('hex');

export function createSession(userId, { ip, ua }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000).toISOString();
  run('INSERT INTO sessions (id, user_id, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?)', hashToken(token), userId, expires, ip, String(ua || '').slice(0, 200));
  return { token, maxAge: config.sessionDays * 86400 };
}

export function sessionCookie(token, maxAge) {
  const parts = [`${config.cookieName}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return sessionCookie('', 0);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function destroySession(req) {
  const token = readCookie(req, config.cookieName);
  if (token) run('DELETE FROM sessions WHERE id = ?', hashToken(token));
}

export function destroyAllSessions(userId, exceptToken = null) {
  if (exceptToken) run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, hashToken(exceptToken));
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function currentToken(req) {
  return readCookie(req, config.cookieName);
}

const USER_COLS = `u.id, u.email, u.name, u.phone, u.role, u.tutor_type, u.verified, u.status,
  u.college_name, u.college_place, u.department, u.degree, u.year_of_study, u.semester,
  u.student_id, u.designation, u.faculty_id, u.cabin, u.academic_background, u.bio,
  u.university_id, un.slug AS uni_slug, un.name AS uni_name, un.city AS uni_city, un.status AS uni_status`;

/** Attaches ctx.user when the session cookie is valid. Never throws. */
export function loadUser(ctx) {
  const token = readCookie(ctx.req, config.cookieName);
  if (!token || token.length > 100) return null;
  const id = hashToken(token);
  const row = get(
    `SELECT s.id AS sid, s.expires_at, s.last_seen_at, ${USER_COLS}
     FROM sessions s JOIN users u ON u.id = s.user_id JOIN universities un ON un.id = u.university_id
     WHERE s.id = ?`,
    id
  );
  if (!row) return null;
  if (row.expires_at <= new Date().toISOString() || row.status !== 'active') {
    run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    run("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", id);
  }
  ctx.user = row;
  return row;
}

export function requireAuth(ctx) {
  if (!ctx.user && !loadUser(ctx)) throw new HttpError(401, 'Sign in to continue.');
  return ctx.user;
}

export function requireAdmin(ctx) {
  const u = requireAuth(ctx);
  if (u.role !== 'admin') throw new HttpError(403, 'You do not have access to this.');
  return u;
}

export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone || '',
  role: u.role,
  tutor_type: u.tutor_type || '',
  verified: !!u.verified,
  college_name: u.college_name || '',
  college_place: u.college_place || '',
  department: u.department,
  degree: u.degree || '',
  semester: u.semester || null,
  student_id: u.student_id || '',
  designation: u.designation || '',
  faculty_id: u.faculty_id || '',
  cabin: u.cabin || '',
  academic_background: u.academic_background || '',
  year_of_study: u.year_of_study,
  bio: u.bio,
  university: { id: u.university_id, slug: u.uni_slug, name: u.uni_name, city: u.uni_city },
});
