import { get, all, run, audit } from '../db.js';
import { HttpError, T, parse, badRequest, enforce, limiters } from '../security.js';
import { balanceOf } from '../money.js';
import { likeTerm } from './campus.js';

function sameCampusUser(ctx, id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return get(
    "SELECT id, name, role, verified FROM users WHERE id = ? AND university_id = ? AND status = 'active'",
    n, ctx.user.university_id
  );
}

const personRow = (u) => ({ id: u.id, name: u.name, role: u.role, verified: !!u.verified });

export function register(r) {
  /* ----- people and friends ----- */

  r.get('/api/people', (ctx) => {
    const params = [ctx.user.university_id, ctx.user.id];
    let where = "u.university_id = ? AND u.id <> ? AND u.status = 'active'";
    if (ctx.query.q) {
      where += " AND u.name LIKE ? ESCAPE '\\'";
      params.push(likeTerm(ctx.query.q));
    }
    const rows = all(
      `SELECT u.id, u.name, u.role, u.verified, u.department, u.year_of_study FROM users u WHERE ${where} ORDER BY u.name LIMIT 30`,
      ...params
    );
    return { people: rows.map((u) => ({ ...personRow(u), department: u.department, year_of_study: u.year_of_study })) };
  });

  r.get('/api/friends', (ctx) => {
    const me = ctx.user.id;
    const rows = all(
      `SELECT f.id, f.status, f.requester_id, u.id AS uid, u.name, u.role, u.verified
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = ? OR f.addressee_id = ?) AND u.status = 'active' AND u.university_id = ?
       ORDER BY u.name`,
      me, me, me, ctx.user.university_id
    );
    const shape = (f) => ({ friendship_id: f.id, user: personRow({ id: f.uid, name: f.name, role: f.role, verified: f.verified }) });
    return {
      friends: rows.filter((f) => f.status === 'accepted').map(shape),
      incoming: rows.filter((f) => f.status === 'pending' && f.requester_id !== me).map(shape),
      outgoing: rows.filter((f) => f.status === 'pending' && f.requester_id === me).map(shape),
    };
  });

  r.post('/api/friends', (ctx) => {
    const b = parse(ctx.body, { user_id: T.int({ min: 1 }) });
    const target = sameCampusUser(ctx, b.user_id);
    if (!target || target.id === ctx.user.id) throw new HttpError(404, 'We could not find that person.');
    const existing = get(
      'SELECT id, requester_id, status FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
      ctx.user.id, target.id, target.id, ctx.user.id
    );
    if (existing) {
      if (existing.status === 'pending' && existing.requester_id === target.id) {
        run("UPDATE friendships SET status = 'accepted' WHERE id = ?", existing.id);
        return { status: 'accepted' };
      }
      throw new HttpError(409, existing.status === 'accepted' ? 'You are already friends.' : 'A request is already waiting.');
    }
    if (get("SELECT COUNT(*) AS n FROM friendships WHERE requester_id = ? AND status = 'pending'", ctx.user.id).n >= 50) {
      throw new HttpError(409, 'You have too many open friend requests.');
    }
    run('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)', ctx.user.id, target.id);
    ctx.status = 201;
    return { status: 'pending' };
  });

  r.post('/api/friends/:id/accept', (ctx) => {
    const f = get('SELECT id, addressee_id, status FROM friendships WHERE id = ?', Number(ctx.params.id));
    if (!f || f.addressee_id !== ctx.user.id) throw new HttpError(404, 'We could not find that request.');
    if (f.status === 'accepted') return { status: 'accepted' };
    run("UPDATE friendships SET status = 'accepted' WHERE id = ?", f.id);
    return { status: 'accepted' };
  });

  r.delete('/api/friends/:id', (ctx) => {
    const f = get('SELECT id, requester_id, addressee_id FROM friendships WHERE id = ?', Number(ctx.params.id));
    if (!f || (f.requester_id !== ctx.user.id && f.addressee_id !== ctx.user.id)) throw new HttpError(404, 'We could not find that friend.');
    run('DELETE FROM friendships WHERE id = ?', f.id);
    return { ok: true };
  });

  /* ----- messages ----- */

  r.get('/api/messages/threads', (ctx) => {
    const me = ctx.user.id;
    const rows = all(
      `SELECT other, MAX(id) AS last_id, SUM(CASE WHEN recipient_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread FROM (
         SELECT id, recipient_id, read_at, CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other
         FROM messages WHERE sender_id = ? OR recipient_id = ?
       ) GROUP BY other ORDER BY last_id DESC LIMIT 50`,
      me, me, me, me
    );
    const threads = [];
    for (const t of rows) {
      const u = sameCampusUser(ctx, t.other);
      if (!u) continue;
      const m = get('SELECT body, created_at, sender_id FROM messages WHERE id = ?', t.last_id);
      threads.push({ user: personRow(u), last: { body: m.body.slice(0, 90), at: m.created_at, mine: m.sender_id === me }, unread: t.unread });
    }
    return { threads };
  });

  r.get('/api/messages/with/:id', (ctx) => {
    const other = sameCampusUser(ctx, ctx.params.id);
    if (!other) throw new HttpError(404, 'We could not find that person.');
    const me = ctx.user.id;
    const after = Number.isInteger(Number(ctx.query.after)) ? Number(ctx.query.after) : 0;
    const rows = all(
      `SELECT id, sender_id, body, created_at FROM messages
       WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) AND id > ?
       ORDER BY id DESC LIMIT 100`,
      me, other.id, other.id, me, after
    ).reverse();
    run("UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL", me, other.id);
    return { user: personRow(other), messages: rows.map((m) => ({ id: m.id, mine: m.sender_id === me, body: m.body, created_at: m.created_at })) };
  });

  r.post('/api/messages', (ctx) => {
    enforce(limiters.message, `msg:${ctx.user.id}`);
    const b = parse(ctx.body, { to: T.int({ min: 1 }), body: T.str({ min: 1, max: 2000, multiline: true }) });
    const other = sameCampusUser(ctx, b.to);
    if (!other || other.id === ctx.user.id) throw new HttpError(404, 'We could not find that person.');
    const res = run('INSERT INTO messages (university_id, sender_id, recipient_id, body) VALUES (?, ?, ?, ?)', ctx.user.university_id, ctx.user.id, other.id, b.body);
    ctx.status = 201;
    return { message: { id: Number(res.lastInsertRowid), mine: true, body: b.body, created_at: new Date().toISOString() } };
  });

  /* ----- community posts ----- */

  r.get('/api/posts', (ctx) => {
    const params = [ctx.user.university_id];
    let where = "p.university_id = ? AND p.status = 'visible'";
    if (['event', 'hackathon', 'discussion', 'opportunity', 'announcement'].includes(ctx.query.kind)) {
      where += ' AND p.kind = ?';
      params.push(ctx.query.kind);
    }
    const before = Number(ctx.query.before);
    if (Number.isInteger(before) && before > 0) {
      where += ' AND p.id < ?';
      params.push(before);
    }
    const rows = all(
      `SELECT p.id, p.kind, p.title, p.body, p.event_at, p.venue, p.created_at, p.user_id, u.name AS author, u.role AS author_role, u.verified AS author_verified,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p JOIN users u ON u.id = p.user_id WHERE ${where} ORDER BY p.id DESC LIMIT 20`,
      ...params
    );
    return {
      posts: rows.map((p) => ({
        id: p.id, kind: p.kind, title: p.title, body: p.body, event_at: p.event_at, venue: p.venue, created_at: p.created_at,
        author: { id: p.user_id, name: p.author, role: p.author_role, verified: !!p.author_verified },
        comment_count: p.comment_count,
        mine: p.user_id === ctx.user.id,
      })),
    };
  });

  r.post('/api/posts', (ctx) => {
    const b = parse(ctx.body, {
      kind: T.enum(['event', 'hackathon', 'discussion', 'opportunity', 'announcement']),
      title: T.str({ min: 4, max: 140 }),
      body: T.str({ min: 1, max: 3000, multiline: true, optional: true, default: '' }),
      event_at: T.iso({ optional: true }),
      venue: T.str({ min: 2, max: 140, optional: true, default: '' }),
    });
    if (b.kind === 'announcement' && !(ctx.user.role === 'admin' || (ctx.user.role === 'teacher' && ctx.user.verified))) {
      throw new HttpError(403, 'Announcements are for verified teachers and administrators.');
    }
    if (['event', 'hackathon'].includes(b.kind) && !b.event_at) throw badRequest('Add the date and time.', { event_at: 'Required' });
    const recent = get("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')", ctx.user.id).n;
    if (recent >= 10) throw new HttpError(429, 'You have reached the daily posting limit.');
    const res = run('INSERT INTO posts (university_id, user_id, kind, title, body, event_at, venue) VALUES (?, ?, ?, ?, ?, ?, ?)', ctx.user.university_id, ctx.user.id, b.kind, b.title, b.body, b.event_at ?? null, b.venue);
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid) };
  });

  r.delete('/api/posts/:id', (ctx) => {
    const p = get("SELECT id, user_id FROM posts WHERE id = ? AND university_id = ? AND status = 'visible'", Number(ctx.params.id), ctx.user.university_id);
    if (!p || (p.user_id !== ctx.user.id && ctx.user.role !== 'admin')) throw new HttpError(404, 'We could not find that post.');
    run("UPDATE posts SET status = 'removed' WHERE id = ?", p.id);
    if (p.user_id !== ctx.user.id) audit(ctx.user.id, 'post.removed', String(p.id), ctx.ip);
    return { ok: true };
  });

  r.get('/api/posts/:id/comments', (ctx) => {
    const p = get("SELECT id FROM posts WHERE id = ? AND university_id = ? AND status = 'visible'", Number(ctx.params.id), ctx.user.university_id);
    if (!p) throw new HttpError(404, 'We could not find that post.');
    const rows = all(
      'SELECT c.id, c.body, c.created_at, u.id AS uid, u.name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.id LIMIT 200',
      p.id
    );
    return { comments: rows.map((c) => ({ id: c.id, body: c.body, created_at: c.created_at, author: { id: c.uid, name: c.name } })) };
  });

  r.post('/api/posts/:id/comments', (ctx) => {
    enforce(limiters.message, `cmt:${ctx.user.id}`);
    const p = get("SELECT id FROM posts WHERE id = ? AND university_id = ? AND status = 'visible'", Number(ctx.params.id), ctx.user.university_id);
    if (!p) throw new HttpError(404, 'We could not find that post.');
    const b = parse(ctx.body, { body: T.str({ min: 1, max: 1000, multiline: true }) });
    const res = run('INSERT INTO comments (post_id, user_id, body) VALUES (?, ?, ?)', p.id, ctx.user.id, b.body);
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid) };
  });

  /* ----- reports ----- */

  r.post('/api/reports', (ctx) => {
    const b = parse(ctx.body, {
      target_type: T.enum(['user', 'post', 'offer', 'comment', 'resource', 'handover']),
      target_id: T.int({ min: 1 }),
      reason: T.str({ min: 10, max: 500, multiline: true }),
    });
    const uni = ctx.user.university_id;
    const exists = {
      user: () => get('SELECT 1 FROM users WHERE id = ? AND university_id = ?', b.target_id, uni),
      post: () => get('SELECT 1 FROM posts WHERE id = ? AND university_id = ?', b.target_id, uni),
      offer: () => get('SELECT 1 FROM offers WHERE id = ? AND university_id = ?', b.target_id, uni),
      comment: () => get('SELECT 1 FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ? AND p.university_id = ?', b.target_id, uni),
      resource: () => get("SELECT 1 FROM resources WHERE id = ? AND university_id = ? AND status IN ('official','faculty_verified','community')", b.target_id, uni),
      handover: () => get("SELECT 1 FROM handovers WHERE id = ? AND university_id = ? AND status = 'approved'", b.target_id, uni),
    }[b.target_type]();
    if (!exists) throw new HttpError(404, 'We could not find what you are reporting.');
    if (get("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')", ctx.user.id).n >= 10) {
      throw new HttpError(429, 'You have reached the daily report limit.');
    }
    run('INSERT INTO reports (reporter_id, university_id, target_type, target_id, reason) VALUES (?, ?, ?, ?, ?)', ctx.user.id, uni, b.target_type, b.target_id, b.reason);
    ctx.status = 201;
    return { ok: true };
  });

  /* ----- dashboard ----- */

  r.get('/api/dashboard', (ctx) => {
    const me = ctx.user.id;
    const uni = ctx.user.university_id;
    const nowIso = new Date().toISOString();
    const upcoming = all(
      `SELECT b.id, b.start_at, b.duration_min, b.status, b.mode, b.meeting_url, b.location, c.code AS course_code, c.name AS course_name,
              CASE WHEN b.learner_id = ? THEN t.name ELSE l.name END AS other, CASE WHEN b.learner_id = ? THEN 'learner' ELSE 'tutor' END AS as_role
       FROM bookings b JOIN courses c ON c.id = b.course_id JOIN users l ON l.id = b.learner_id JOIN users t ON t.id = b.tutor_id
       WHERE (b.learner_id = ? OR b.tutor_id = ?) AND b.status = 'accepted' AND b.start_at > ? ORDER BY b.start_at LIMIT 5`,
      me, me, me, me, new Date(Date.now() - 4 * 3600000).toISOString()
    );
    const events = all(
      `SELECT id, kind, title, event_at, venue FROM posts WHERE university_id = ? AND status = 'visible' AND kind IN ('event','hackathon') AND event_at > ? ORDER BY event_at LIMIT 5`,
      uni, nowIso
    );
    return {
      balance: balanceOf(me),
      requests_waiting: get("SELECT COUNT(*) AS n FROM bookings WHERE tutor_id = ? AND status = 'requested'", me).n,
      to_confirm: get("SELECT COUNT(*) AS n FROM bookings WHERE learner_id = ? AND status = 'accepted' AND start_at < ?", me, nowIso).n,
      unread_messages: get('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL', me).n,
      friend_requests: get("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'", me).n,
      upcoming,
      events,
    };
  });
}
