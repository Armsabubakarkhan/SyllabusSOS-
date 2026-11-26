import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run, tx, audit, nowIso } from '../db.js';
import { BACKGROUNDS, seedBackgroundForUniversity } from '../catalog.js';
import {
  HttpError, T, parse, badRequest, enforce, limiters, hashPassword, verifyPassword, dummyVerify, passwordProblem,
} from '../security.js';
import {
  createSession, sessionCookie, clearCookie, destroySession, destroyAllSessions, currentToken, loadUser, publicUser,
} from '../auth.js';
import { balanceOf } from '../money.js';

const USER_SELECT = `SELECT u.id, u.email, u.name, u.phone, u.role, u.tutor_type, u.verified, u.status,
  u.college_name, u.college_place, u.department, u.degree, u.year_of_study, u.semester,
  u.student_id, u.designation, u.faculty_id, u.cabin, u.academic_background, u.bio,
  u.university_id, un.slug AS uni_slug, un.name AS uni_name, un.city AS uni_city, un.state AS uni_state
  FROM users u JOIN universities un ON un.id = u.university_id`;

function slugify(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campus';
  let slug = base;
  while (get('SELECT 1 FROM universities WHERE slug = ?', slug)) slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  return slug;
}

const emailMatchesDomain = (email, domain) => {
  if (!domain) return false;
  const host = email.split('@')[1] || '';
  return host === domain || host.endsWith('.' + domain);
};

export function register(r) {
  r.post('/api/auth/register', { auth: 'none' }, async (ctx) => {
    enforce(limiters.authIp, `reg-ip:${ctx.ip}`);
    enforce(limiters.register, `reg:${ctx.ip}`);
    const b = parse(ctx.body, {
      name: T.str({ min: 2, max: 80 }),
      email: T.email(),
      password: T.raw({ min: 1, max: 128 }),
      phone: T.phone({ optional: true }),
      university_id: T.int({ min: 1, optional: true }),
      new_university_name: T.str({ min: 3, max: 120, optional: true }),
      new_university_city: T.str({ min: 2, max: 80, optional: true }),
      new_university_state: T.str({ min: 2, max: 80, optional: true }),
      new_university_country: T.str({ min: 2, max: 80, optional: true }),
      new_university_address: T.str({ min: 2, max: 200, optional: true }),
      new_university_code: T.str({ min: 1, max: 30, optional: true }),
      new_university_domain: T.domain({ optional: true }),
      college_name: T.str({ min: 1, max: 120, optional: true }),
      college_place: T.str({ min: 1, max: 80, optional: true }),
      department: T.str({ min: 1, max: 100, optional: true, default: '' }),
      degree: T.str({ min: 1, max: 60, optional: true }),
      semester: T.int({ min: 1, max: 12, optional: true }),
      student_id: T.str({ min: 1, max: 40, optional: true }),
      designation: T.str({ min: 1, max: 80, optional: true }),
      faculty_id: T.str({ min: 1, max: 40, optional: true }),
      cabin: T.str({ min: 1, max: 60, optional: true }),
      year_of_study: T.int({ min: 1, max: 8, optional: true }),
      academic_background: T.enum(BACKGROUNDS, { optional: true, default: '' }),
      tutor_type: T.str({ max: 40, optional: true, default: '' }),
      role: T.enum(['student', 'teacher'], { optional: true, default: 'student' }),
    });
    const pwProblem = passwordProblem(b.password, b.email);
    if (pwProblem) throw badRequest(pwProblem, { password: pwProblem });
    if (!b.university_id && !b.new_university_name) throw badRequest('Choose your university.', { university_id: 'Required' });

    // If registered as peer tutor, role is student with tutor capabilities
    const assignedRole = b.tutor_type === 'peer_tutor' ? 'student' : b.role;
    const finalTutorType = b.tutor_type || (b.role === 'teacher' ? 'faculty' : '');

    const hash = await hashPassword(b.password);
    const out = tx(() => {
      if (get('SELECT 1 FROM users WHERE email = ?', b.email)) {
        throw new HttpError(409, 'We could not create that account. If you already registered, sign in instead.');
      }
      let uni;
      if (b.university_id) {
        uni = get("SELECT id, email_domain FROM universities WHERE id = ? AND status IN ('approved','pending')", b.university_id);
        if (!uni) throw badRequest('Choose a university from the list.', { university_id: 'Not found' });
      } else {
        const trimmedName = b.new_university_name.trim();
        const baseSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        let existingUni = get(
          `SELECT id, email_domain FROM universities WHERE LOWER(TRIM(name)) = LOWER(?) OR slug = ? LIMIT 1`,
          trimmedName, baseSlug
        );
        if (existingUni) {
          uni = existingUni;
        } else {
          const slug = slugify(trimmedName);
          const res = run(
            `INSERT INTO universities (slug, name, city, state, country, address, college_code, email_domain, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
            slug, trimmedName, b.new_university_city || '', b.new_university_state || '',
            b.new_university_country || 'India', b.new_university_address || '', b.new_university_code || '',
            b.new_university_domain || null
          );
          uni = { id: Number(res.lastInsertRowid), email_domain: b.new_university_domain || null };
          audit(null, 'university.proposed', `${slug}`, ctx.ip);
        }
      }
      const res = run(
        `INSERT INTO users (
           email, name, phone, pw_hash, role, tutor_type, university_id, college_name, college_place,
           department, degree, year_of_study, semester, student_id, designation, faculty_id, cabin, academic_background, domain_match
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        b.email, b.name, b.phone || '', hash, assignedRole, finalTutorType, uni.id, b.college_name || '', b.college_place || '',
        b.department || '', b.degree || '', b.year_of_study ?? null, b.semester ?? null,
        b.student_id || '', b.designation || '', b.faculty_id || '', b.cabin || '', b.academic_background || '',
        emailMatchesDomain(b.email, uni.email_domain) ? 1 : 0
      );
      if (b.academic_background) {
        seedBackgroundForUniversity(uni.id, b.academic_background);
      }
      return Number(res.lastInsertRowid);
    });
    audit(out, 'user.register', b.role, ctx.ip);
    const s = createSession(out, { ip: ctx.ip, ua: ctx.req.headers['user-agent'] });
    ctx.headers = { 'Set-Cookie': sessionCookie(s.token, s.maxAge) };
    ctx.status = 201;
    return { user: publicUser(get(`${USER_SELECT} WHERE u.id = ?`, out)) };
  });

  r.post('/api/auth/login', { auth: 'none' }, async (ctx) => {
    enforce(limiters.authIp, `login-ip:${ctx.ip}`);
    const b = parse(ctx.body, { email: T.email(), password: T.raw({ min: 1, max: 128 }), portal: T.enum(['student', 'teacher'], { optional: true }) });
    enforce(limiters.authEmail, `login-email:${b.email}`);
    const generic = new HttpError(401, 'Email or password is incorrect.');

    const row = get('SELECT id, pw_hash, status, role, tutor_type, failed_logins, locked_until FROM users WHERE email = ?', b.email);
    if (!row) {
      await dummyVerify(b.password);
      throw generic;
    }
    if (row.locked_until && row.locked_until > nowIso()) {
      throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.', { retryAfter: 600 });
    }
    const ok = await verifyPassword(b.password, row.pw_hash);
    if (!ok) {
      const fails = row.failed_logins + 1;
      if (fails >= 8) {
        run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', new Date(Date.now() + 15 * 60000).toISOString(), row.id);
        audit(row.id, 'login.locked', '', ctx.ip);
      } else {
        run('UPDATE users SET failed_logins = ? WHERE id = ?', fails, row.id);
      }
      audit(row.id, 'login.failed', '', ctx.ip);
      throw generic;
    }
    if (row.status !== 'active') throw new HttpError(403, 'This account is suspended.');
    /* The password was right, so it is safe to say which door this account belongs to. No session is created. */
    if (b.portal && row.role !== 'admin' && row.role !== b.portal) {
      if (b.portal === 'teacher' && row.tutor_type === 'peer_tutor') {
        // Peer tutors signing in via Teacher / Tutor portal are authenticated
      } else {
        throw new HttpError(403, row.role === 'teacher'
          ? 'This is a teacher account. Choose Teacher above and sign in again.'
          : 'This is a student account. Choose Student above and sign in again.');
      }
    }

    run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), row.id);
    limiters.authEmail.reset(`login-email:${b.email}`);
    audit(row.id, 'login.ok', '', ctx.ip);
    const s = createSession(row.id, { ip: ctx.ip, ua: ctx.req.headers['user-agent'] });
    ctx.headers = { 'Set-Cookie': sessionCookie(s.token, s.maxAge) };
    return { user: publicUser(get(`${USER_SELECT} WHERE u.id = ?`, row.id)) };
  });

  r.post('/api/auth/logout', { auth: 'none' }, (ctx) => {
    destroySession(ctx.req);
    ctx.headers = { 'Set-Cookie': clearCookie() };
    return { ok: true };
  });

  r.get('/api/auth/me', { auth: 'none' }, (ctx) => {
    const u = loadUser(ctx);
    return { user: u ? publicUser(u) : null };
  });

  r.post('/api/auth/password', async (ctx) => {
    enforce(limiters.authIp, `pw-ip:${ctx.ip}`);
    const b = parse(ctx.body, { current: T.raw(), next: T.raw() });
    const row = get('SELECT pw_hash FROM users WHERE id = ?', ctx.user.id);
    if (!(await verifyPassword(b.current, row.pw_hash))) throw new HttpError(403, 'Your current password is incorrect.');
    const problem = passwordProblem(b.next, ctx.user.email);
    if (problem) throw badRequest(problem, { next: problem });
    run('UPDATE users SET pw_hash = ? WHERE id = ?', await hashPassword(b.next), ctx.user.id);
    destroyAllSessions(ctx.user.id, currentToken(ctx.req));
    audit(ctx.user.id, 'password.changed', '', ctx.ip);
    return { ok: true };
  });

  r.patch('/api/me', (ctx) => {
    const b = parse(ctx.body, {
      name: T.str({ min: 2, max: 80, optional: true }),
      phone: T.phone({ optional: true }),
      academic_background: T.enum(BACKGROUNDS, { optional: true }),
      degree: T.str({ min: 1, max: 60, optional: true }),
      department: T.str({ min: 1, max: 100, optional: true }),
      year_of_study: T.int({ min: 1, max: 8, optional: true }),
      semester: T.int({ min: 1, max: 12, optional: true }),
      student_id: T.str({ min: 1, max: 40, optional: true }),
      college_name: T.str({ min: 1, max: 120, optional: true }),
      college_place: T.str({ min: 1, max: 80, optional: true }),
      designation: T.str({ min: 1, max: 80, optional: true }),
      faculty_id: T.str({ min: 1, max: 40, optional: true }),
      cabin: T.str({ min: 1, max: 60, optional: true }),
      bio: T.str({ min: 1, max: 500, multiline: true, optional: true }),
    });
    const keys = Object.keys(b);
    if (!keys.length) throw badRequest('Nothing to update.');
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    run(`UPDATE users SET ${sets} WHERE id = ?`, ...keys.map((k) => b[k]), ctx.user.id);
    if (b.academic_background) seedBackgroundForUniversity(ctx.user.university_id, b.academic_background);
    return { user: publicUser(get(`${USER_SELECT} WHERE u.id = ?`, ctx.user.id)) };
  });

  r.post('/api/me/delete', async (ctx) => {
    enforce(limiters.authIp, `del-ip:${ctx.ip}`);
    const b = parse(ctx.body, { password: T.raw() });
    const row = get('SELECT pw_hash, role FROM users WHERE id = ?', ctx.user.id);
    if (row.role === 'admin') throw new HttpError(403, 'Administrator accounts cannot be deleted here.');
    if (!(await verifyPassword(b.password, row.pw_hash))) throw new HttpError(403, 'Your password is incorrect.');
    const open = get("SELECT COUNT(*) AS n FROM bookings WHERE (learner_id = ? OR tutor_id = ?) AND status IN ('requested','accepted','disputed')", ctx.user.id, ctx.user.id).n;
    if (open) throw new HttpError(409, 'Finish or cancel your open sessions first.');
    if (balanceOf(ctx.user.id) > 0) throw new HttpError(409, 'Withdraw or use your remaining credits first.');
    const randomHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
    tx(() => {
      run('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?', ctx.user.id, ctx.user.id);
      run("UPDATE posts SET status = 'removed', title = 'Removed', body = '' WHERE user_id = ?", ctx.user.id);
      run('DELETE FROM comments WHERE user_id = ?', ctx.user.id);
      run("UPDATE offers SET status = 'removed' WHERE user_id = ?", ctx.user.id);
      run('DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?', ctx.user.id, ctx.user.id);
      run(
        `UPDATE users SET name = 'Deleted user', email = ?, pw_hash = ?, bio = '', department = '', verified = 0, status = 'banned' WHERE id = ?`,
        `deleted-${ctx.user.id}@invalid.local`, randomHash, ctx.user.id
      );
      destroyAllSessions(ctx.user.id);
    });
    audit(ctx.user.id, 'user.deleted', '', ctx.ip);
    ctx.headers = { 'Set-Cookie': clearCookie() };
    return { ok: true };
  });
}

export async function createAdmin(email, password) {
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(`Admin password rejected: ${problem}`);
  let uni = get("SELECT id FROM universities WHERE slug = 'platform-admin'");
  if (!uni) {
    run("INSERT INTO universities (slug, name, city, status) VALUES ('platform-admin', 'Platform administration', '', 'internal')");
    uni = get("SELECT id FROM universities WHERE slug = 'platform-admin'");
  }
  const existing = get('SELECT id FROM users WHERE email = ?', email);
  if (existing) return { created: false, id: existing.id };
  const res = run(
    "INSERT INTO users (email, name, pw_hash, role, university_id, verified) VALUES (?, 'Administrator', ?, 'admin', ?, 1)",
    email, await hashPassword(password), uni.id
  );
  return { created: true, id: Number(res.lastInsertRowid), configured: !!config.adminEmail };
}
