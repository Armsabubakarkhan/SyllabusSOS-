import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, all, run, tx, audit, nowIso } from '../db.js';
import { HttpError, T, parse, badRequest } from '../security.js';
import { ESCROW, PLATFORM, transfer, priceFor } from '../money.js';
import { likeTerm, RATING, RATING_N } from './campus.js';

const TUTOR_FIELDS = `u.id AS tutor_id, u.name AS tutor_name, u.role AS tutor_role, u.verified AS tutor_verified,
  ${RATING} AS rating, ${RATING_N} AS rating_count,
  (SELECT COUNT(*) FROM bookings b WHERE b.tutor_id = u.id AND b.status IN ('completed','resolved_release')) AS sessions_done`;

function offerRow(o) {
  return {
    id: o.id,
    headline: o.headline,
    description: o.description,
    syllabus_topics: o.syllabus_topics || '',
    syllabus_subtopics: o.syllabus_subtopics || '',
    price_per_hour: o.price_per_hour,
    mode: o.mode,
    availability: o.availability,
    mastery: o.mastery,
    status: o.status,
    course: { id: o.course_id, code: o.course_code, name: o.course_name, background: o.course_background || '' },
    tutor: {
      id: o.tutor_id,
      name: o.tutor_name,
      role: o.tutor_role,
      tutor_type: o.tutor_type || '',
      academic_background: o.tutor_background || '',
      verified: !!o.tutor_verified,
      rating: o.rating,
      rating_count: o.rating_count,
      sessions_done: o.sessions_done,
    },
  };
}

const OFFER_SELECT = `SELECT o.id, o.headline, o.description, o.syllabus_topics, o.syllabus_subtopics, o.price_per_hour, o.mode, o.availability, o.mastery, o.status, o.user_id,
  c.id AS course_id, c.code AS course_code, c.name AS course_name, c.background AS course_background,
  u.tutor_type AS tutor_type, u.academic_background AS tutor_background, ${TUTOR_FIELDS}
  FROM offers o JOIN users u ON u.id = o.user_id JOIN courses c ON c.id = o.course_id`;

/* ---------- booking money helpers (call inside tx) ---------- */

function releaseToTutor(b) {
  // Idempotency check: don't double transfer if already settled
  if (get('SELECT 1 FROM ledger WHERE booking_id = ? AND kind = ?', b.id, 'earning')) return;
  const earning = b.price_total - b.fee;
  if (earning > 0) transfer(ESCROW, b.tutor_id, earning, 'earning', b.id, 'Session payment');
  if (b.fee > 0) transfer(ESCROW, PLATFORM, b.fee, 'fee', b.id, 'Platform fee');
}

function refundLearner(b, note = 'Session refund') {
  // Idempotency check: don't double transfer if already refunded
  if (get('SELECT 1 FROM ledger WHERE booking_id = ? AND kind = ?', b.id, 'refund')) return;
  if (b.price_total > 0) transfer(ESCROW, b.learner_id, b.price_total, 'refund', b.id, note);
}

function setStatus(id, from, to, extra = {}) {
  const keys = Object.keys(extra);
  const sets = ['status = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')", ...keys.map((k) => `${k} = ?`)].join(', ');
  const res = run(`UPDATE bookings SET ${sets} WHERE id = ? AND status = ?`, to, ...keys.map((k) => extra[k]), id, from);
  if (res.changes !== 1) throw new HttpError(409, 'This session changed while you were looking at it. Reload and try again.');
}

export const bookingRow = (b) => ({
  id: b.id,
  status: b.status,
  start_at: b.start_at,
  duration_min: b.duration_min,
  mode: b.mode,
  price_total: b.price_total,
  fee: b.fee,
  message: b.message,
  meeting_url: b.meeting_url,
  location: b.location,
  dispute_reason: b.dispute_reason,
  created_at: b.created_at,
  course: { id: b.course_id, code: b.course_code, name: b.course_name },
  learner: { id: b.learner_id, name: b.learner_name },
  tutor: { id: b.tutor_id, name: b.tutor_name },
  reviewed: !!b.reviewed,
});

const BOOKING_SELECT = `SELECT b.*, c.code AS course_code, c.name AS course_name, l.name AS learner_name, t.name AS tutor_name,
  EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS reviewed
  FROM bookings b JOIN courses c ON c.id = b.course_id JOIN users l ON l.id = b.learner_id JOIN users t ON t.id = b.tutor_id`;

function loadBooking(ctx) {
  const id = Number(ctx.params.id);
  const b = Number.isInteger(id) ? get(`${BOOKING_SELECT} WHERE b.id = ?`, id) : null;
  if (!b || (b.learner_id !== ctx.user.id && b.tutor_id !== ctx.user.id)) throw new HttpError(404, 'We could not find that session.');
  return b;
}

/** Cancels stale requests and releases payment for sessions nobody confirmed or disputed within 72 hours. */
export function autoSettle() {
  const now = nowIso();
  let expired = 0;
  let released = 0;
  const stale = all("SELECT * FROM bookings WHERE status = 'requested' AND start_at < ?", now);
  for (const b of stale) {
    try {
      tx(() => {
        setStatus(b.id, 'requested', 'cancelled');
        refundLearner(b, 'Request expired');
        expired++;
      });
      audit(null, 'booking.autoexpire', String(b.id));
    } catch { /* another process settled it */ }
  }
  const cutoff = new Date(Date.now() - 72 * 3600000).toISOString();
  // Strictly only 'accepted' sessions past the 72-hour cutoff (disputed sessions remain on hold)
  const due = all("SELECT * FROM bookings WHERE status = 'accepted' AND datetime(start_at, '+' || duration_min || ' minutes') < datetime(?)", cutoff);
  for (const b of due) {
    try {
      tx(() => {
        setStatus(b.id, 'accepted', 'completed');
        releaseToTutor(b);
        released++;
      });
      audit(null, 'booking.autorelease', String(b.id));
    } catch { /* already handled or disputed */ }
  }
  return { expired, released };
}

export function releaseDisputed(b, outcome) {
  tx(() => {
    if (outcome === 'refund') {
      setStatus(b.id, 'disputed', 'resolved_refund');
      refundLearner(b, 'Refund after review');
    } else {
      setStatus(b.id, 'disputed', 'resolved_release');
      releaseToTutor(b);
    }
  });
}


/** A course is typed, not picked. Match what was typed to a course at the user's university, or add it. */
function resolveCourse(ctx, b) {
  const uni = ctx.user.university_id;
  if (b.course_id) {
    if (!get('SELECT 1 FROM courses WHERE id = ? AND university_id = ?', b.course_id, uni)) {
      throw badRequest('We could not find that course at your university.', { course_name: 'Not found' });
    }
    return b.course_id;
  }
  const typed = (b.course_name || '').trim();
  if (!typed) throw badRequest('Type the name of the course.', { course_name: 'Required' });
  const hit = get(
    `SELECT id FROM courses WHERE university_id = ? AND (LOWER(code) = LOWER(?) OR LOWER(name) = LOWER(?) OR LOWER(code || ' ' || name) = LOWER(?))
     ORDER BY id LIMIT 1`,
    uni, typed, typed, typed
  );
  if (hit) return hit.id;

  const made = get(
    "SELECT COUNT(*) AS n FROM courses WHERE created_by = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')",
    ctx.user.id
  ).n;
  if (made >= 10) throw new HttpError(429, 'You have added the maximum number of new courses for today.');

  let code = (b.course_code || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9][A-Z0-9 \-./]*$/.test(code)) throw badRequest('Course codes use letters, numbers, spaces and dashes.', { course_code: 'Invalid code' });
  if (!code) {
    const initials = typed.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 2 || /^\d+$/.test(w)).map((w) => w[0]).join('').toUpperCase().slice(0, 6);
    code = initials.length >= 2 ? initials : 'COURSE';
  }
  const base = code;
  for (let i = 2; get('SELECT 1 FROM courses WHERE university_id = ? AND code = ?', uni, code); i++) code = `${base}${i}`;
  const id = Number(run('INSERT INTO courses (university_id, code, name, created_by) VALUES (?, ?, ?, ?)', uni, code, typed, ctx.user.id).lastInsertRowid);
  audit(ctx.user.id, 'course.add', code, ctx.ip);
  return id;
}

export function register(r) {
  /* ----- offers ----- */

  r.get('/api/offers', (ctx) => {
    const q = ctx.query;
    const params = [ctx.user.university_id];
    let where = 'o.university_id = ?';
    if (q.mine === '1') {
      where += " AND o.user_id = ? AND o.status <> 'removed'";
      params.push(ctx.user.id);
    } else {
      where += " AND o.status = 'active' AND u.status = 'active'";
    }
    if (q.course_id && Number.isInteger(Number(q.course_id))) {
      where += ' AND o.course_id = ?';
      params.push(Number(q.course_id));
    }
    if (['online', 'in_person', 'chat'].includes(q.mode)) {
      where += ' AND o.mode = ?';
      params.push(q.mode);
    }
    if (q.max_price !== undefined && q.max_price !== '' && Number.isInteger(Number(q.max_price))) {
      where += ' AND o.price_per_hour <= ?';
      params.push(Number(q.max_price));
    }
    if (q.code) {
      const ct = likeTerm(q.code);
      where += " AND c.code LIKE ? ESCAPE '\\'";
      params.push(ct);
    }
    if (q.topic) {
      const tt = likeTerm(q.topic);
      where += " AND (o.syllabus_topics LIKE ? ESCAPE '\\' OR o.syllabus_subtopics LIKE ? ESCAPE '\\' OR o.headline LIKE ? ESCAPE '\\' OR o.description LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM topics t WHERE t.course_id = c.id AND (t.name LIKE ? ESCAPE '\\' OR t.unit_name LIKE ? ESCAPE '\\')))";
      params.push(tt, tt, tt, tt, tt, tt);
    }
    if (q.q) {
      const t = likeTerm(q.q);
      where += " AND (o.headline LIKE ? ESCAPE '\\' OR o.description LIKE ? ESCAPE '\\' OR o.syllabus_topics LIKE ? ESCAPE '\\' OR o.syllabus_subtopics LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM topics tp WHERE tp.course_id = c.id AND tp.name LIKE ? ESCAPE '\\'))";
      params.push(t, t, t, t, t, t, t, t);
    }
    const rows = all(`${OFFER_SELECT} WHERE ${where} ORDER BY rating DESC NULLS LAST, o.id DESC LIMIT 60`, ...params);
    return { offers: rows.map((o) => ({ ...offerRow(o), mine: o.user_id === ctx.user.id })) };
  });

  r.post('/api/offers', (ctx) => {
    const b = parse(ctx.body, {
      course_id: T.int({ min: 1, optional: true }),
      course_name: T.str({ min: 2, max: 120, optional: true }),
      course_code: T.str({ min: 2, max: 20, optional: true }),
      headline: T.str({ min: 8, max: 120 }),
      description: T.str({ min: 1, max: 1000, multiline: true, optional: true, default: '' }),
      syllabus_topics: T.str({ min: 1, max: 1500, multiline: true, optional: true, default: '' }),
      syllabus_subtopics: T.str({ min: 1, max: 2000, multiline: true, optional: true, default: '' }),
      price_per_hour: T.int({ min: 0, max: 5000, optional: true, default: 0 }),
      mode: T.enum(['online', 'in_person', 'chat']),
      availability: T.str({ min: 1, max: 200, optional: true, default: '' }),
      mastery: T.enum(['complete', 'strong']),
    });
    b.course_id = resolveCourse(ctx, b);
    if (get('SELECT COUNT(*) AS n FROM offers WHERE user_id = ? AND status <> ?', ctx.user.id, 'removed').n >= 20) {
      throw new HttpError(409, 'You can offer up to 20 courses.');
    }
    const existing = get('SELECT id, status FROM offers WHERE user_id = ? AND course_id = ?', ctx.user.id, b.course_id);
    if (existing && existing.status !== 'removed') throw new HttpError(409, 'You already offer this course. Edit that listing instead.');
    let id;
    if (existing) {
      run(
        "UPDATE offers SET headline=?, description=?, syllabus_topics=?, syllabus_subtopics=?, price_per_hour=?, mode=?, availability=?, mastery=?, status='active' WHERE id = ?",
        b.headline, b.description, b.syllabus_topics, b.syllabus_subtopics, b.price_per_hour, b.mode, b.availability, b.mastery, existing.id
      );
      id = existing.id;
    } else {
      id = Number(run(
        `INSERT INTO offers (user_id, university_id, course_id, headline, description, syllabus_topics, syllabus_subtopics, price_per_hour, mode, availability, mastery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ctx.user.id, ctx.user.university_id, b.course_id, b.headline, b.description, b.syllabus_topics, b.syllabus_subtopics, b.price_per_hour, b.mode, b.availability, b.mastery
      ).lastInsertRowid);
    }
    audit(ctx.user.id, 'offer.save', String(id), ctx.ip);
    ctx.status = 201;
    return { offer: offerRow(get(`${OFFER_SELECT} WHERE o.id = ?`, id)) };
  });

  r.patch('/api/offers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const o = Number.isInteger(id) ? get('SELECT id FROM offers WHERE id = ? AND user_id = ?', id, ctx.user.id) : null;
    if (!o) throw new HttpError(404, 'We could not find that listing.');
    const b = parse(ctx.body, {
      headline: T.str({ min: 8, max: 120, optional: true }),
      description: T.str({ min: 1, max: 1000, multiline: true, optional: true }),
      syllabus_topics: T.str({ min: 1, max: 1500, multiline: true, optional: true }),
      syllabus_subtopics: T.str({ min: 1, max: 2000, multiline: true, optional: true }),
      price_per_hour: T.int({ min: 0, max: 5000, optional: true }),
      mode: T.enum(['online', 'in_person', 'chat'], { optional: true }),
      availability: T.str({ min: 1, max: 200, optional: true }),
      mastery: T.enum(['complete', 'strong'], { optional: true }),
      status: T.enum(['active', 'paused', 'removed'], { optional: true }),
    });
    const keys = Object.keys(b);
    if (!keys.length) throw badRequest('Nothing to update.');
    run(`UPDATE offers SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => b[k]), id);
    return { offer: offerRow(get(`${OFFER_SELECT} WHERE o.id = ?`, id)) };
  });

  r.get('/api/offers/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const o = Number.isInteger(id) ? get(`${OFFER_SELECT} WHERE o.id = ? AND o.university_id = ? AND o.status <> 'removed'`, id, ctx.user.university_id) : null;
    if (!o) throw new HttpError(404, 'We could not find that listing.');
    const reviews = all(
      `SELECT r.rating, r.comment, r.created_at, u.name AS reviewer FROM reviews r JOIN users u ON u.id = r.reviewer_id
       WHERE r.tutor_id = ? ORDER BY r.id DESC LIMIT 10`,
      o.tutor_id
    );
    return { offer: { ...offerRow(o), mine: o.user_id === ctx.user.id }, reviews, fee_percent: config.feePercent };
  });

  /* ----- profiles ----- */

  r.get('/api/users/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const u = Number.isInteger(id)
      ? get(
          `SELECT u.id, u.name, u.role, u.tutor_type, u.verified, u.academic_background, u.degree,
            u.department, u.year_of_study, u.semester, u.student_id, u.designation, u.faculty_id, u.cabin,
            u.college_name, u.college_place, u.bio, u.created_at, ${RATING} AS rating, ${RATING_N} AS rating_count,
            (SELECT COUNT(*) FROM bookings b WHERE b.tutor_id = u.id AND b.status IN ('completed','resolved_release')) AS sessions_done
           FROM users u WHERE u.id = ? AND u.university_id = ? AND u.status = 'active'`,
          id, ctx.user.university_id
        )
      : null;
    if (!u) throw new HttpError(404, 'We could not find that person.');
    const offers = all(`${OFFER_SELECT} WHERE o.user_id = ? AND o.status = 'active'`, u.id).map(offerRow);
    const fr = get(
      `SELECT id, requester_id, status FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      ctx.user.id, u.id, u.id, ctx.user.id
    );
    return {
      user: { ...u, verified: !!u.verified },
      offers,
      friendship: fr ? { id: fr.id, status: fr.status, incoming: fr.requester_id === u.id } : null,
      is_me: u.id === ctx.user.id,
    };
  });

  /* ----- bookings ----- */

  r.post('/api/bookings', (ctx) => {
    const b = parse(ctx.body, {
      offer_id: T.int({ min: 1 }),
      start_at: T.iso(),
      duration_min: T.int({ min: 30, max: 240 }),
      message: T.str({ min: 1, max: 500, multiline: true, optional: true, default: '' }),
    });
    if (b.duration_min % 15 !== 0) throw badRequest('Choose a length in 15 minute steps.', { duration_min: 'Use 15 minute steps' });
    const start = Date.parse(b.start_at);
    if (start < Date.now() + 30 * 60000) throw badRequest('Pick a time at least 30 minutes from now.', { start_at: 'Too soon' });
    if (start > Date.now() + 90 * 86400000) throw badRequest('Pick a time within the next 90 days.', { start_at: 'Too far ahead' });

    const offer = get(
      `SELECT o.*, u.status AS tutor_status FROM offers o JOIN users u ON u.id = o.user_id
       WHERE o.id = ? AND o.university_id = ? AND o.status = 'active'`,
      b.offer_id, ctx.user.university_id
    );
    if (!offer || offer.tutor_status !== 'active') throw new HttpError(404, 'That listing is not available.');
    if (offer.user_id === ctx.user.id) throw badRequest('You cannot book your own listing.');
    if (get("SELECT COUNT(*) AS n FROM bookings WHERE learner_id = ? AND status = 'requested'", ctx.user.id).n >= 5) {
      throw new HttpError(409, 'You have 5 requests waiting. Wait for replies before booking more.');
    }
    const { total, fee } = priceFor(offer.price_per_hour, b.duration_min, config.feePercent);
    const id = tx(() => {
      const res = run(
        `INSERT INTO bookings (offer_id, university_id, course_id, learner_id, tutor_id, start_at, duration_min, mode, price_total, fee, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        offer.id, offer.university_id, offer.course_id, ctx.user.id, offer.user_id, b.start_at, b.duration_min, offer.mode, total, fee, b.message
      );
      const bid = Number(res.lastInsertRowid);
      if (total > 0) transfer(ctx.user.id, ESCROW, total, 'hold', bid, 'Held until the session is confirmed');
      return bid;
    });
    audit(ctx.user.id, 'booking.request', String(id), ctx.ip);
    ctx.status = 201;
    return { booking: bookingRow(get(`${BOOKING_SELECT} WHERE b.id = ?`, id)) };
  });

  r.get('/api/bookings', (ctx) => {
    autoSettle();
    const rows = all(`${BOOKING_SELECT} WHERE (b.learner_id = ? OR b.tutor_id = ?) ORDER BY b.start_at DESC LIMIT 100`, ctx.user.id, ctx.user.id);
    return { bookings: rows.map((b) => ({ ...bookingRow(b), as: b.learner_id === ctx.user.id ? 'learner' : 'tutor' })) };
  });

  r.get('/api/bookings/:id', (ctx) => {
    const b = loadBooking(ctx);
    return { booking: { ...bookingRow(b), as: b.learner_id === ctx.user.id ? 'learner' : 'tutor' } };
  });

  r.post('/api/bookings/:id/accept', (ctx) => {
    const b = loadBooking(ctx);
    if (b.tutor_id !== ctx.user.id) throw new HttpError(403, 'Only the tutor can accept.');
    if (b.status !== 'requested') throw new HttpError(409, 'This request is no longer open.');
    if (Date.parse(b.start_at) < Date.now()) throw new HttpError(409, 'The requested time has passed.');
    const body = parse(ctx.body ?? {}, {
      meeting_url: T.meetingUrl({ optional: true }),
      location: T.str({ min: 1, max: 150, optional: true }),
    });
    let url = null;
    let location = '';
    if (b.mode === 'online') {
      url = body.meeting_url || `https://meet.jit.si/SyllabusSOS-${crypto.randomBytes(9).toString('base64url')}`;
    } else if (b.mode === 'in_person') {
      if (!body.location) throw badRequest('Say where you will meet.', { location: 'Required' });
      location = body.location;
    }
    tx(() => setStatus(b.id, 'requested', 'accepted', { meeting_url: url, location }));
    audit(ctx.user.id, 'booking.accept', String(b.id), ctx.ip);
    return { booking: bookingRow(get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id)) };
  });

  r.post('/api/bookings/:id/decline', (ctx) => {
    const b = loadBooking(ctx);
    if (b.tutor_id !== ctx.user.id) throw new HttpError(403, 'Only the tutor can decline.');
    tx(() => {
      setStatus(b.id, 'requested', 'declined');
      refundLearner(b, 'Request declined');
    });
    audit(ctx.user.id, 'booking.decline', String(b.id), ctx.ip);
    return { booking: bookingRow(get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id)) };
  });

  r.post('/api/bookings/:id/cancel', (ctx) => {
    const b = loadBooking(ctx);
    const isLearner = b.learner_id === ctx.user.id;
    if (!isLearner && b.status !== 'accepted') throw new HttpError(403, 'Tutors can decline requests or cancel accepted sessions.');
    if (!['requested', 'accepted'].includes(b.status)) throw new HttpError(409, 'This session can no longer be cancelled.');
    tx(() => {
      setStatus(b.id, b.status, 'cancelled');
      refundLearner(b, 'Session cancelled');
    });
    audit(ctx.user.id, 'booking.cancel', String(b.id), ctx.ip);
    return { booking: bookingRow(get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id)) };
  });

  r.post('/api/bookings/:id/complete', (ctx) => {
    const b = loadBooking(ctx);
    if (b.learner_id !== ctx.user.id) throw new HttpError(403, 'Only the learner confirms a finished session.');
    if (b.status !== 'accepted') throw new HttpError(409, 'This session is not waiting for confirmation.');
    if (Date.parse(b.start_at) > Date.now()) throw new HttpError(409, 'You can confirm once the session has started.');
    tx(() => {
      setStatus(b.id, 'accepted', 'completed');
      releaseToTutor(b);
    });
    audit(ctx.user.id, 'booking.complete', String(b.id), ctx.ip);
    return { booking: bookingRow(get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id)) };
  });

  r.post('/api/bookings/:id/dispute', (ctx) => {
    const b = loadBooking(ctx);
    const body = parse(ctx.body, { reason: T.str({ min: 10, max: 500, multiline: true }) });
    if (b.status !== 'accepted') throw new HttpError(409, 'Only accepted sessions can be disputed.');
    if (Date.parse(b.start_at) > Date.now()) throw new HttpError(409, 'You can raise a problem once the session has started.');
    tx(() => setStatus(b.id, 'accepted', 'disputed', { dispute_reason: `${ctx.user.id === b.learner_id ? 'Learner' : 'Tutor'}: ${body.reason}` }));
    audit(ctx.user.id, 'booking.dispute', String(b.id), ctx.ip);
    return { booking: bookingRow(get(`${BOOKING_SELECT} WHERE b.id = ?`, b.id)) };
  });

  r.post('/api/bookings/:id/review', (ctx) => {
    const b = loadBooking(ctx);
    if (b.learner_id !== ctx.user.id) throw new HttpError(403, 'Only the learner can review.');
    if (!['completed', 'resolved_release'].includes(b.status)) throw new HttpError(409, 'You can review after the session is complete.');
    const body = parse(ctx.body, {
      rating: T.int({ min: 1, max: 5 }),
      comment: T.str({ min: 1, max: 500, multiline: true, optional: true, default: '' }),
    });
    if (get('SELECT 1 FROM reviews WHERE booking_id = ?', b.id)) throw new HttpError(409, 'You already reviewed this session.');
    run('INSERT INTO reviews (booking_id, reviewer_id, tutor_id, rating, comment) VALUES (?, ?, ?, ?, ?)', b.id, ctx.user.id, b.tutor_id, body.rating, body.comment);
    ctx.status = 201;
    return { ok: true };
  });
}
