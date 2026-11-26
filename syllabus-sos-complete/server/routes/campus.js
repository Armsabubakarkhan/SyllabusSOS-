import { config } from '../config.js';
import { get, all, run, audit } from '../db.js';
import { HttpError, T, parse, enforce, limiters, badRequest } from '../security.js';

export const likeTerm = (q) => `%${String(q).replace(/[\\%_]/g, (c) => '\\' + c)}%`;

const RATING = `(SELECT ROUND(AVG(rating), 1) FROM reviews WHERE tutor_id = u.id)`;
const RATING_N = `(SELECT COUNT(*) FROM reviews WHERE tutor_id = u.id)`;

function campusCounts(uniId) {
  return {
    members: get("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'", uniId).n,
    courses: get('SELECT COUNT(*) AS n FROM courses WHERE university_id = ?', uniId).n,
    tutors: get("SELECT COUNT(DISTINCT user_id) AS n FROM offers WHERE university_id = ? AND status = 'active'", uniId).n,
  };
}

const shortName = (name) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
};

export function register(r) {
  r.get('/api/config', { auth: 'none' }, () => ({
    demo: config.demoMode || config.paymentsMode === 'test',
    payments_mode: config.paymentsMode,
    fee_percent: config.feePercent,
    currency: 'credits',
  }));

  r.get('/api/universities', { auth: 'none' }, () => {
    const rows = all("SELECT id, slug, name, city FROM universities WHERE status = 'approved' ORDER BY name");
    return { universities: rows.map((u) => ({ ...u, ...campusCounts(u.id) })) };
  });

  r.get('/api/campus/:slug', { auth: 'none' }, (ctx) => {
    const u = get("SELECT id, slug, name, city FROM universities WHERE slug = ? AND status = 'approved'", ctx.params.slug);
    if (!u) throw new HttpError(404, 'We could not find that campus.');
    const courses = all(
      `SELECT c.code, c.name, (SELECT COUNT(*) FROM offers o WHERE o.course_id = c.id AND o.status = 'active') AS tutors
       FROM courses c WHERE c.university_id = ? ORDER BY tutors DESC, c.name LIMIT 24`,
      u.id
    );
    return { campus: { slug: u.slug, name: u.name, city: u.city, ...campusCounts(u.id) }, courses };
  });

  /* Public product demo: sample campuses only, names shortened, no contact details. */
  r.get('/api/public/demo', { auth: 'none' }, (ctx) => {
    enforce(limiters.publicDemo, `demo:${ctx.ip}`);
    const campuses = all(
      `SELECT un.slug, un.name, un.city FROM universities un WHERE un.is_demo = 1 AND un.status = 'approved'
       ORDER BY (SELECT COUNT(*) FROM offers o WHERE o.university_id = un.id AND o.status = 'active') DESC, un.name`
    );
    const slug = ctx.query.university || campuses[0]?.slug;
    const uni = get("SELECT id, slug, name FROM universities WHERE slug = ? AND is_demo = 1 AND status = 'approved'", slug || '');
    if (!uni) return { campuses, offers: [] };
    const params = [uni.id];
    let where = "o.university_id = ? AND o.status = 'active' AND u.status = 'active'";
    if (ctx.query.q) {
      where += " AND (c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR o.headline LIKE ? ESCAPE '\\')";
      const t = likeTerm(ctx.query.q);
      params.push(t, t, t);
    }
    const rows = all(
      `SELECT o.id, o.headline, o.price_per_hour, o.mode, o.mastery, c.code, c.name AS course, u.name AS tutor,
              ${RATING} AS rating, ${RATING_N} AS rating_count
       FROM offers o JOIN users u ON u.id = o.user_id JOIN courses c ON c.id = o.course_id
       WHERE ${where} ORDER BY rating DESC, o.id LIMIT 12`,
      ...params
    );
    return {
      campuses,
      campus: uni,
      offers: rows.map((o) => ({ ...o, tutor: shortName(o.tutor) })),
    };
  });

  r.get('/api/courses', (ctx) => {
    const params = [ctx.user.university_id];
    let where = 'c.university_id = ?';
    if (ctx.query.q) {
      where += " AND (c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\')";
      const t = likeTerm(ctx.query.q);
      params.push(t, t);
    }
    if (ctx.query.background) {
      where += ' AND c.background = ?';
      params.push(ctx.query.background);
    }
    const rows = all(
      `SELECT c.id, c.code, c.name, c.department, c.background,
        (SELECT COUNT(*) FROM offers o WHERE o.course_id = c.id AND o.status = 'active') AS tutors
       FROM courses c WHERE ${where} ORDER BY c.code LIMIT 200`,
      ...params
    );
    return { courses: rows };
  });

  r.post('/api/courses', (ctx) => {
    const b = parse(ctx.body, {
      code: T.str({ min: 2, max: 20 }),
      name: T.str({ min: 3, max: 120 }),
      department: T.str({ min: 1, max: 100, optional: true, default: '' }),
    });
    const code = b.code.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 \-./]*$/.test(code)) throw badRequest('Course codes use letters, numbers, spaces and dashes.', { code: 'Invalid code' });
    const today = get(
      "SELECT COUNT(*) AS n FROM courses WHERE created_by = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')",
      ctx.user.id
    ).n;
    if (today >= 10) throw new HttpError(429, 'You have added the maximum number of courses for today.');
    if (get('SELECT 1 FROM courses WHERE university_id = ? AND code = ?', ctx.user.university_id, code)) {
      throw new HttpError(409, 'That course code already exists at your university.');
    }
    const res = run('INSERT INTO courses (university_id, code, name, department, created_by) VALUES (?, ?, ?, ?, ?)', ctx.user.university_id, code, b.name, b.department, ctx.user.id);
    audit(ctx.user.id, 'course.add', code, ctx.ip);
    ctx.status = 201;
    return { course: { id: Number(res.lastInsertRowid), code, name: b.name, department: b.department, tutors: 0 } };
  });
}

export { RATING, RATING_N };
