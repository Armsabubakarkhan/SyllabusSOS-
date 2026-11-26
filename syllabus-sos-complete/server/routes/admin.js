import { config } from '../config.js';
import { get, all, run, tx, audit } from '../db.js';
import { HttpError, T, parse, badRequest } from '../security.js';
import { destroyAllSessions, requireAdmin } from '../auth.js';
import { ESCROW, PLATFORM, PAYOUTS, balanceOf, ledgerIsBalanced, transfer } from '../money.js';
import { releaseDisputed, autoSettle } from './tutoring.js';
import { likeTerm } from './campus.js';

export function register(r) {
  const A = { auth: 'admin' };

  r.get('/api/admin/stats', A, () => ({
    users: get("SELECT COUNT(*) AS n FROM users WHERE role <> 'admin'").n,
    universities: get("SELECT COUNT(*) AS n FROM universities WHERE status = 'approved'").n,
    pending_universities: get("SELECT COUNT(*) AS n FROM universities WHERE status = 'pending'").n,
    active_offers: get("SELECT COUNT(*) AS n FROM offers WHERE status = 'active'").n,
    bookings: all('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status'),
    disputes: get("SELECT COUNT(*) AS n FROM bookings WHERE status = 'disputed'").n,
    open_reports: get("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").n,
    pending_withdrawals: get("SELECT COUNT(*) AS n FROM withdrawals WHERE status = 'pending'").n,
    ledger_balanced: ledgerIsBalanced(),
    escrow: balanceOf(ESCROW),
    platform_earnings: balanceOf(PLATFORM),
    payouts_owed: balanceOf(PAYOUTS),
  }));

  /* universities */
  r.get('/api/admin/universities', A, () => ({
    universities: all(
      `SELECT un.id, un.slug, un.name, un.city, un.email_domain, un.status, un.is_demo, un.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.university_id = un.id) AS members
       FROM universities un WHERE un.status <> 'internal' ORDER BY un.status, un.name`
    ),
  }));

  r.post('/api/admin/universities', A, (ctx) => {
    const b = parse(ctx.body, {
      name: T.str({ min: 3, max: 120 }),
      city: T.str({ min: 2, max: 80 }),
      email_domain: T.domain({ optional: true }),
    });
    const base = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campus';
    let slug = base;
    let i = 2;
    while (get('SELECT 1 FROM universities WHERE slug = ?', slug)) slug = `${base}-${i++}`;
    const res = run("INSERT INTO universities (slug, name, city, email_domain, status) VALUES (?, ?, ?, ?, 'approved')", slug, b.name, b.city, b.email_domain ?? null);
    audit(ctx.user.id, 'admin.university.create', slug, ctx.ip);
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid), slug };
  });

  r.patch('/api/admin/universities/:id', A, (ctx) => {
    const id = Number(ctx.params.id);
    const u = get("SELECT id FROM universities WHERE id = ? AND status <> 'internal'", id);
    if (!u) throw new HttpError(404, 'We could not find that university.');
    const b = parse(ctx.body, {
      status: T.enum(['approved', 'pending', 'rejected'], { optional: true }),
      name: T.str({ min: 3, max: 120, optional: true }),
      city: T.str({ min: 2, max: 80, optional: true }),
      email_domain: T.domain({ optional: true }),
    });
    const keys = Object.keys(b);
    if (!keys.length) throw badRequest('Nothing to update.');
    run(`UPDATE universities SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => b[k]), id);
    audit(ctx.user.id, 'admin.university.update', `${id}:${keys.join(',')}`, ctx.ip);
    return { ok: true };
  });

  /* users */
  r.get('/api/admin/users', A, (ctx) => {
    const params = [];
    let where = '1 = 1';
    if (ctx.query.q) {
      where = "(u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')";
      params.push(likeTerm(ctx.query.q), likeTerm(ctx.query.q));
    }
    return {
      users: all(
        `SELECT u.id, u.name, u.email, u.role, u.verified, u.domain_match, u.status, u.created_at, un.name AS university
         FROM users u JOIN universities un ON un.id = u.university_id WHERE ${where} ORDER BY u.id DESC LIMIT 100`,
        ...params
      ),
    };
  });

  r.patch('/api/admin/users/:id', A, (ctx) => {
    const id = Number(ctx.params.id);
    const target = get('SELECT id, role FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'We could not find that user.');
    if (target.role === 'admin' || target.id === ctx.user.id) throw new HttpError(403, 'Administrator accounts cannot be changed here.');
    const b = parse(ctx.body, {
      status: T.enum(['active', 'banned'], { optional: true }),
      verified: T.int({ min: 0, max: 1, optional: true }),
      role: T.enum(['student', 'teacher'], { optional: true }),
    });
    const keys = Object.keys(b);
    if (!keys.length) throw badRequest('Nothing to update.');
    run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => b[k]), id);
    if (b.status === 'banned') destroyAllSessions(id);
    audit(ctx.user.id, 'admin.user.update', `${id}:${JSON.stringify(b)}`, ctx.ip);
    return { ok: true };
  });

  /* disputes */
  r.get('/api/admin/disputes', A, () => ({
    disputes: all(
      `SELECT b.id, b.price_total, b.fee, b.start_at, b.dispute_reason, c.code AS course_code, l.name AS learner, t.name AS tutor
       FROM bookings b JOIN courses c ON c.id = b.course_id JOIN users l ON l.id = b.learner_id JOIN users t ON t.id = b.tutor_id
       WHERE b.status = 'disputed' ORDER BY b.id`
    ),
  }));

  r.post('/api/admin/bookings/:id/resolve', A, (ctx) => {
    const b = parse(ctx.body, { outcome: T.enum(['refund', 'release']) });
    const booking = get('SELECT * FROM bookings WHERE id = ?', Number(ctx.params.id));
    if (!booking || booking.status !== 'disputed') throw new HttpError(404, 'We could not find that dispute.');
    releaseDisputed(booking, b.outcome);
    audit(ctx.user.id, 'admin.dispute.resolve', `${booking.id}:${b.outcome}`, ctx.ip);
    return { ok: true };
  });

  /* withdrawals */
  r.get('/api/admin/withdrawals', A, () => ({
    withdrawals: all(
      `SELECT w.id, w.amount, w.note, w.status, w.created_at, u.name, u.email FROM withdrawals w JOIN users u ON u.id = w.user_id
       ORDER BY CASE w.status WHEN 'pending' THEN 0 ELSE 1 END, w.id DESC LIMIT 100`
    ),
  }));

  r.post('/api/admin/withdrawals/:id/resolve', A, (ctx) => {
    const b = parse(ctx.body, { outcome: T.enum(['paid', 'rejected']) });
    const w = get("SELECT * FROM withdrawals WHERE id = ? AND status = 'pending'", Number(ctx.params.id));
    if (!w) throw new HttpError(404, 'We could not find that request.');
    tx(() => {
      run("UPDATE withdrawals SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", b.outcome, w.id);
      if (b.outcome === 'rejected') transfer(PAYOUTS, w.user_id, w.amount, 'withdrawal_refund', null, `Withdrawal ${w.id} rejected`);
    });
    audit(ctx.user.id, 'admin.withdrawal.resolve', `${w.id}:${b.outcome}`, ctx.ip);
    return { ok: true };
  });

  /* reports */
  r.get('/api/admin/reports', A, () => ({
    reports: all(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.created_at, u.name AS reporter, un.name AS university
       FROM reports r JOIN users u ON u.id = r.reporter_id JOIN universities un ON un.id = r.university_id
       ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.id DESC LIMIT 100`
    ),
  }));

  r.post('/api/admin/reports/:id/resolve', A, (ctx) => {
    const b = parse(ctx.body, { action: T.enum(['dismiss', 'remove_content']) });
    const rep = get("SELECT * FROM reports WHERE id = ? AND status = 'open'", Number(ctx.params.id));
    if (!rep) throw new HttpError(404, 'We could not find that report.');
    tx(() => {
      if (b.action === 'remove_content') {
        if (rep.target_type === 'post') run("UPDATE posts SET status = 'removed' WHERE id = ?", rep.target_id);
        else if (rep.target_type === 'offer') run("UPDATE offers SET status = 'removed' WHERE id = ?", rep.target_id);
        else if (rep.target_type === 'comment') run('DELETE FROM comments WHERE id = ?', rep.target_id);
        else if (rep.target_type === 'resource') run("UPDATE resources SET status = 'removed' WHERE id = ?", rep.target_id);
        else if (rep.target_type === 'handover') run("UPDATE handovers SET status = 'removed' WHERE id = ?", rep.target_id);
      }
      run("UPDATE reports SET status = 'resolved' WHERE id = ?", rep.id);
    });
    audit(ctx.user.id, 'admin.report.resolve', `${rep.id}:${b.action}`, ctx.ip);
    return { ok: true };
  });

  r.get('/api/admin/audit', A, () => ({
    entries: all('SELECT id, actor_id, action, detail, ip, created_at FROM audit_log ORDER BY id DESC LIMIT 150'),
  }));

  /* Trigger automatic booking settlement: callable by admin session or X-Settlement-Key header */
  r.post('/api/admin/settle', { auth: 'none' }, (ctx) => {
    const key = ctx.req.headers['x-settlement-key'];
    const isSecretAuthorized = key && config.appSecret && key === config.appSecret;
    if (!isSecretAuthorized) {
      requireAdmin(ctx);
    }
    const result = autoSettle();
    audit(ctx.user ? ctx.user.id : null, 'admin.settle', `expired=${result.expired},released=${result.released}`, ctx.ip);
    return { ok: true, ...result };
  });
}
