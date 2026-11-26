import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, all, run, tx, audit } from '../db.js';
import { HttpError, T, parse, badRequest, clean } from '../security.js';
import { likeTerm, RATING, RATING_N } from './campus.js';

const UPLOAD_DIR = path.join(path.dirname(config.dbPath), 'uploads');
const ALLOWED_EXTS = new Set(['.pdf', '.txt', '.md', '.csv', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.webp', '.zip']);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/* ---------- access helpers ---------- */

export function canReview(user, courseId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher' || !user.verified) return false;
  return !!get('SELECT 1 FROM course_teachers WHERE course_id = ? AND user_id = ?', courseId, user.id);
}

function courseFor(ctx, id) {
  const n = Number(id);
  const c = Number.isInteger(n) ? get('SELECT * FROM courses WHERE id = ? AND university_id = ?', n, ctx.user.university_id) : null;
  if (!c) throw new HttpError(404, 'We could not find that course at your university.');
  return c;
}

function topicFor(ctx, id) {
  const n = Number(id);
  const t = Number.isInteger(n)
    ? get(
        `SELECT t.*, c.university_id, c.code AS course_code, c.name AS course_name FROM topics t JOIN courses c ON c.id = t.course_id
         WHERE t.id = ? AND c.university_id = ?`,
        n, ctx.user.university_id
      )
    : null;
  if (!t) throw new HttpError(404, 'We could not find that topic at your university.');
  return t;
}

const VISIBLE = "('official','faculty_verified','community')";

function resourceVisibleTo(ctx, r) {
  if (!r || r.university_id !== ctx.user.university_id || r.status === 'removed') return false;
  if (['official', 'faculty_verified', 'community'].includes(r.status)) return true;
  if (r.uploader_id === ctx.user.id) return true;
  return r.status === 'pending' && canReview(ctx.user, r.course_id);
}

const RES_SELECT = `SELECT r.id, r.title, r.kind, r.body, r.url, r.source, r.status, r.review_note, r.version, r.created_at, r.updated_at,
  r.course_id, r.topic_id, r.uploader_id, r.university_id, r.file_id,
  f.original_name AS file_name, f.size_bytes AS file_size, f.mime_type AS file_mime,
  u.name AS uploader, u.role AS uploader_role, c.code AS course_code, t.name AS topic_name,
  EXISTS(SELECT 1 FROM bookmarks b WHERE b.resource_id = r.id AND b.user_id = ?) AS saved
  FROM resources r JOIN users u ON u.id = r.uploader_id JOIN courses c ON c.id = r.course_id LEFT JOIN topics t ON t.id = r.topic_id LEFT JOIN uploaded_files f ON f.id = r.file_id`;

const resourceRow = (r, ctx, withBody = false) => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  status: r.status,
  review_note: r.uploader_id === ctx.user.id || canReview(ctx.user, r.course_id) ? r.review_note : '',
  version: r.version,
  url: r.url,
  source: r.source,
  file: r.file_id ? { id: r.file_id, name: r.file_name, size_bytes: r.file_size, mime_type: r.file_mime } : null,
  body: withBody ? r.body : undefined,
  excerpt: withBody ? undefined : r.body.slice(0, 160),
  course: { id: r.course_id, code: r.course_code },
  topic: r.topic_id ? { id: r.topic_id, name: r.topic_name } : null,
  uploader: { id: r.uploader_id, name: r.uploader, role: r.uploader_role },
  mine: r.uploader_id === ctx.user.id,
  saved: !!r.saved,
  can_review: canReview(ctx.user, r.course_id),
  updated_at: r.updated_at,
});

const STATUS_RANK = { official: 0, faculty_verified: 1, community: 2, pending: 3 };

/* ---------- quiz scoring ---------- */

export function conceptResults(rows) {
  const by = new Map();
  for (const r of rows) {
    const c = by.get(r.concept) || { concept: r.concept, correct: 0, total: 0 };
    c.total += 1;
    if (r.correct) c.correct += 1;
    by.set(r.concept, c);
  }
  return [...by.values()].map((c) => {
    let verdict;
    let text;
    if (c.total === 1) {
      verdict = c.correct ? 'early_sign' : 'needs_practice';
      text = c.correct
        ? 'You answered the one question on this correctly. One question is only an early sign, so try a few more.'
        : 'You missed the one question on this. Review it and try more questions.';
    } else if (c.correct === c.total) {
      verdict = 'understood';
      text = 'You answered every question on this correctly.';
    } else if (c.correct === 0) {
      verdict = 'needs_practice';
      text = 'None of the questions on this were correct. Start with a worked example.';
    } else {
      verdict = 'partial';
      text = `You got ${c.correct} of ${c.total} right. Some parts are solid and some need practice.`;
    }
    return { ...c, verdict, text };
  });
}

const parseOptions = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function latestAttempt(userId, topicId) {
  return get('SELECT * FROM quiz_attempts WHERE user_id = ? AND topic_id = ? ORDER BY id DESC LIMIT 1', userId, topicId);
}

function weakConcepts(attemptId) {
  const rows = all(
    `SELECT q.concept, a.correct FROM quiz_answers a JOIN quiz_questions q ON q.id = a.question_id WHERE a.attempt_id = ?`,
    attemptId
  );
  return conceptResults(rows).filter((c) => c.verdict === 'needs_practice' || c.verdict === 'partial').map((c) => c.concept);
}

/* ---------- mission planner (deterministic, no AI provider) ---------- */

export function planMission(user, topic, { goal = '', examDate = null } = {}) {
  const steps = [];
  const resources = all(
    `${RES_SELECT} WHERE r.topic_id = ? AND r.university_id = ? AND r.status IN ${VISIBLE}`,
    user.id, topic.id, user.university_id
  ).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const attempt = latestAttempt(user.id, topic.id);
  const weak = attempt ? weakConcepts(attempt.id) : [];
  const myStatus = get('SELECT status FROM difficulty_reports WHERE user_id = ? AND topic_id = ?', user.id, topic.id)?.status;

  let basis;
  if (!attempt) basis = 'You have not taken a practice check on this topic yet, so this plan starts with one. It will be adjusted when you have results.';
  else if (weak.length) basis = `Your latest practice check on this topic suggests practising: ${weak.join(', ')}. This is a preliminary indicator from a short check.`;
  else basis = 'Your latest practice check on this topic had no clear gaps. This plan focuses on consolidating and testing yourself again.';

  const read = resources.find((r) => ['notes', 'explanation', 'revision', 'link'].includes(r.kind));
  const example = resources.find((r) => r.kind === 'worked_example');
  const practice = resources.find((r) => r.kind === 'practice');
  const hasQuiz = get('SELECT COUNT(*) AS n FROM quiz_questions WHERE topic_id = ?', topic.id).n > 0;

  if (!attempt && hasQuiz) steps.push({ kind: 'quiz', title: `Take the practice check on ${topic.name} to find your gaps`, ref_id: topic.id });
  if (read) steps.push({ kind: 'read', title: `Read: ${read.title} (${statusWord(read.status)})`, ref_id: read.id });
  else steps.push({ kind: 'review', title: `Re-read the syllabus objective: ${topic.objective || topic.name}`, ref_id: topic.id });
  if (example) steps.push({ kind: 'example', title: `Work through: ${example.title} (${statusWord(example.status)})`, ref_id: example.id });
  if (practice) steps.push({ kind: 'example', title: `Practise with: ${practice.title} (${statusWord(practice.status)})`, ref_id: practice.id });
  if (attempt && hasQuiz) steps.push({ kind: 'quiz', title: weak.length ? `Retry the practice check, focusing on: ${weak.join(', ')}` : 'Retry the practice check to confirm your understanding', ref_id: topic.id });

  const needHelp = myStatus === 'needs_help' || weak.length > 0;
  if (needHelp) {
    const tutor = get(
      `SELECT o.id, u.name, ${RATING} AS rating FROM offers o JOIN users u ON u.id = o.user_id
       WHERE o.course_id = ? AND o.university_id = ? AND o.status = 'active' AND u.status = 'active' AND o.user_id <> ?
       ORDER BY rating DESC NULLS LAST, o.price_per_hour ASC LIMIT 1`,
      topic.course_id, user.university_id, user.id
    );
    steps.push(tutor
      ? { kind: 'tutor', title: `Consider a one on one session with ${tutor.name}. You decide whether to request it.`, ref_id: tutor.id }
      : { kind: 'tutor', title: 'No tutor offers this course yet. Ask in the campus feed or check back later.', ref_id: null });
  }
  if (hasQuiz) steps.push({ kind: 'followup', title: 'Take the practice check again after studying or after a session, then compare', ref_id: topic.id });
  steps.push({ kind: 'review', title: 'Update your difficulty status for this topic', ref_id: topic.id });

  return { basis, steps: steps.map((s, i) => ({ position: i + 1, ...s })), goal, exam_date: examDate };
}

const statusWord = (s) => ({ official: 'official teacher resource', faculty_verified: 'teacher verified', community: 'community contribution', pending: 'pending review' }[s] || s);

/* ---------- routes ---------- */

export function register(r) {
  /* ----- syllabus ----- */

  r.get('/api/syllabus', (ctx) => {
    const course = courseFor(ctx, ctx.query.course_id);
    const topics = all(
      `SELECT t.id, t.unit_no, t.unit_name, t.name, t.objective,
        (SELECT COUNT(*) FROM resources r WHERE r.topic_id = t.id AND r.status IN ${VISIBLE}) AS resources,
        (SELECT COUNT(*) FROM quiz_questions q WHERE q.topic_id = t.id) AS questions,
        (SELECT status FROM difficulty_reports d WHERE d.topic_id = t.id AND d.user_id = ?) AS my_status
       FROM topics t WHERE t.course_id = ? ORDER BY t.unit_no, t.id`,
      ctx.user.id, course.id
    );
    const units = [];
    for (const t of topics) {
      let u = units.find((x) => x.unit_no === t.unit_no);
      if (!u) {
        u = { unit_no: t.unit_no, unit_name: t.unit_name, topics: [] };
        units.push(u);
      }
      u.topics.push({ id: t.id, name: t.name, objective: t.objective, resources: t.resources, questions: t.questions, my_status: t.my_status });
    }
    const teachers = all('SELECT u.id, u.name FROM course_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.course_id = ?', course.id);
    return {
      course: { id: course.id, code: course.code, name: course.name, department: course.department, background: course.background || '' },
      units,
      teachers: teachers.map((x) => x.name),
      teacher_profiles: teachers.map((x) => ({ id: x.id, name: x.name })),
      can_edit: canReview(ctx.user, course.id),
    };
  });

  r.post('/api/topics', (ctx) => {
    const b = parse(ctx.body, {
      course_id: T.int({ min: 1 }),
      unit_no: T.int({ min: 1, max: 20 }),
      unit_name: T.str({ min: 3, max: 120 }),
      name: T.str({ min: 3, max: 120 }),
      objective: T.str({ min: 1, max: 300, optional: true, default: '' }),
    });
    const course = courseFor(ctx, b.course_id);
    if (!canReview(ctx.user, course.id)) throw new HttpError(403, 'Only teachers assigned to this course can edit its syllabus.');
    if (get('SELECT 1 FROM topics WHERE course_id = ? AND unit_no = ? AND name = ?', course.id, b.unit_no, b.name)) throw new HttpError(409, 'That topic already exists in this unit.');
    const res = run('INSERT INTO topics (course_id, unit_no, unit_name, name, objective) VALUES (?, ?, ?, ?, ?)', course.id, b.unit_no, b.unit_name, b.name, b.objective);
    audit(ctx.user.id, 'topic.add', `${course.code}:${b.name}`, ctx.ip);
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid) };
  });

  r.get('/api/topics/:id', (ctx) => {
    const t = topicFor(ctx, ctx.params.id);
    const resources = all(
      `${RES_SELECT} WHERE r.topic_id = ? AND r.university_id = ? AND (r.status IN ${VISIBLE} OR r.uploader_id = ? OR (r.status = 'pending' AND ? = 1))
       AND r.status <> 'removed' ORDER BY r.id DESC LIMIT 50`,
      ctx.user.id, t.id, ctx.user.university_id, ctx.user.id, canReview(ctx.user, t.course_id) ? 1 : 0
    ).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
    const tutors = all(
      `SELECT o.id, o.headline, o.price_per_hour, o.mode, o.mastery, u.id AS uid, u.name, ${RATING} AS rating, ${RATING_N} AS rating_count
       FROM offers o JOIN users u ON u.id = o.user_id WHERE o.course_id = ? AND o.university_id = ? AND o.status = 'active' AND u.status = 'active' AND o.user_id <> ?
       ORDER BY rating DESC NULLS LAST, o.price_per_hour LIMIT 5`,
      t.course_id, ctx.user.university_id, ctx.user.id
    );
    const my = get('SELECT status FROM difficulty_reports WHERE user_id = ? AND topic_id = ?', ctx.user.id, t.id);
    const last = latestAttempt(ctx.user.id, t.id);
    return {
      topic: { id: t.id, name: t.name, objective: t.objective, unit_no: t.unit_no, unit_name: t.unit_name, course: { id: t.course_id, code: t.course_code, name: t.course_name } },
      resources: resources.map((x) => resourceRow(x, ctx)),
      tutors: tutors.map((x) => ({ offer_id: x.id, user_id: x.uid, name: x.name, headline: x.headline, price_per_hour: x.price_per_hour, mode: x.mode, mastery: x.mastery, rating: x.rating, rating_count: x.rating_count })),
      my_status: my?.status ?? null,
      questions: get('SELECT COUNT(*) AS n FROM quiz_questions WHERE topic_id = ?', t.id).n,
      last_attempt: last ? { id: last.id, kind: last.kind, score: last.score, total: last.total, created_at: last.created_at } : null,
    };
  });

  /* ----- difficulty radar ----- */

  r.post('/api/topics/:id/difficulty', (ctx) => {
    const t = topicFor(ctx, ctx.params.id);
    const b = parse(ctx.body, { status: T.enum(['understood', 'needs_practice', 'needs_help', 'not_studied']) });
    run(
      `INSERT INTO difficulty_reports (user_id, topic_id, status) VALUES (?, ?, ?)
       ON CONFLICT(user_id, topic_id) DO UPDATE SET status = excluded.status, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ctx.user.id, t.id, b.status
    );
    return { status: b.status };
  });

  r.get('/api/radar', (ctx) => {
    const course = courseFor(ctx, ctx.query.course_id);
    if (!canReview(ctx.user, course.id)) throw new HttpError(403, 'The difficulty radar is for teachers assigned to this course.');
    const min = config.radarMin;
    const rows = all(
      `SELECT t.id, t.unit_no, t.unit_name, t.name,
        COUNT(d.user_id) AS responses,
        SUM(d.status = 'understood') AS understood,
        SUM(d.status = 'needs_practice') AS needs_practice,
        SUM(d.status = 'needs_help') AS needs_help,
        SUM(d.status = 'not_studied') AS not_studied,
        SUM(d.updated_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-14 days')) AS recent,
        (SELECT COUNT(*) FROM resources r WHERE r.topic_id = t.id AND r.status IN ${VISIBLE}) AS resources
       FROM topics t LEFT JOIN difficulty_reports d ON d.topic_id = t.id
       WHERE t.course_id = ? GROUP BY t.id ORDER BY t.unit_no, t.id`,
      course.id
    );
    const topics = rows.map((x) => {
      if (x.responses < min) {
        return { id: x.id, unit_no: x.unit_no, unit_name: x.unit_name, name: x.name, hidden: true, resources: x.resources };
      }
      const struggling = x.needs_practice + x.needs_help;
      return {
        id: x.id, unit_no: x.unit_no, unit_name: x.unit_name, name: x.name, hidden: false,
        responses: x.responses, understood: x.understood, needs_practice: x.needs_practice, needs_help: x.needs_help, not_studied: x.not_studied,
        struggling_share: Math.round((struggling / x.responses) * 100), updated_last_14_days: x.recent, resources: x.resources,
        suggestion: struggling / x.responses >= 0.4 && x.resources < 2
          ? 'Suggestion (not measured data): many responses report difficulty and there are few approved resources. Consider adding a worked example.'
          : null,
      };
    });
    return {
      course: { id: course.id, code: course.code, name: course.name },
      minimum_responses: min,
      note: `Topics with fewer than ${min} responses are hidden to protect students. Reports are voluntary and may not represent every student.`,
      topics,
    };
  });

  /* ----- resources ----- */

  r.get('/api/resources', (ctx) => {
    const params = [ctx.user.id, ctx.user.university_id];
    let where = "r.university_id = ? AND r.status <> 'removed'";
    const reviewer = ctx.user.role === 'admin' || ctx.user.role === 'teacher';
    if (ctx.query.saved === '1') {
      where += ' AND EXISTS (SELECT 1 FROM bookmarks b2 WHERE b2.resource_id = r.id AND b2.user_id = ?)';
      params.push(ctx.user.id);
    }
    if (ctx.query.mine === '1') {
      where += ' AND r.uploader_id = ?';
      params.push(ctx.user.id);
    } else {
      where += ` AND (r.status IN ${VISIBLE} OR r.uploader_id = ? OR (r.status = 'pending' AND ? = 1 AND r.course_id IN (SELECT course_id FROM course_teachers WHERE user_id = ?)) OR (r.status = 'pending' AND ? = 1))`;
      params.push(ctx.user.id, reviewer && ctx.user.role === 'teacher' ? 1 : 0, ctx.user.id, ctx.user.role === 'admin' ? 1 : 0);
    }
    if (Number.isInteger(Number(ctx.query.course_id)) && ctx.query.course_id) { where += ' AND r.course_id = ?'; params.push(Number(ctx.query.course_id)); }
    if (Number.isInteger(Number(ctx.query.topic_id)) && ctx.query.topic_id) { where += ' AND r.topic_id = ?'; params.push(Number(ctx.query.topic_id)); }
    if (['notes', 'worked_example', 'practice', 'past_paper', 'revision', 'link', 'explanation'].includes(ctx.query.kind)) { where += ' AND r.kind = ?'; params.push(ctx.query.kind); }
    if (['official', 'faculty_verified', 'community', 'pending'].includes(ctx.query.status)) { where += ' AND r.status = ?'; params.push(ctx.query.status); }
    if (ctx.query.q) {
      const t = likeTerm(ctx.query.q);
      where += " AND (r.title LIKE ? ESCAPE '\\' OR r.body LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\')";
      params.push(t, t, t, t);
    }
    const rows = all(`${RES_SELECT} WHERE ${where} ORDER BY r.updated_at DESC LIMIT 80`, ...params)
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
    return { resources: rows.map((x) => resourceRow(x, ctx)) };
  });

  r.post('/api/resources', (ctx) => {
    const b = parse(ctx.body, {
      course_id: T.int({ min: 1 }),
      topic_id: T.int({ min: 1, optional: true }),
      title: T.str({ min: 4, max: 140 }),
      kind: T.enum(['notes', 'worked_example', 'practice', 'past_paper', 'revision', 'link', 'explanation']),
      body: T.str({ min: 1, max: 8000, multiline: true, optional: true, default: '' }),
      url: T.httpsUrl({ optional: true }),
      file_id: T.int({ min: 1, optional: true }),
      source: T.str({ min: 1, max: 200, optional: true, default: '' }),
      permission: T.int({ min: 1, max: 1 }),
    });
    const course = courseFor(ctx, b.course_id);
    if (b.topic_id) {
      const t = get('SELECT id FROM topics WHERE id = ? AND course_id = ?', b.topic_id, course.id);
      if (!t) throw badRequest('Choose a topic from this course.', { topic_id: 'Not found' });
    }
    if (b.file_id) {
      const f = get('SELECT id FROM uploaded_files WHERE id = ? AND university_id = ? AND uploader_id = ?', b.file_id, ctx.user.university_id, ctx.user.id);
      if (!f) throw badRequest('Uploaded file not found.', { file_id: 'Not found' });
    }
    if (!b.body && !b.url && !b.file_id) throw badRequest('Add the text of the resource, upload a file, or add a link.', { body: 'Add text, a file, or a link' });
    if (b.kind === 'link' && !b.url) throw badRequest('A link resource needs a link.', { url: 'Required' });
    if (get("SELECT COUNT(*) AS n FROM resources WHERE uploader_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')", ctx.user.id).n >= 15) {
      throw new HttpError(429, 'You have reached the daily upload limit.');
    }
    const reviewer = canReview(ctx.user, course.id);
    const status = reviewer ? 'official' : 'pending';
    const id = tx(() => {
      const res = run(
        `INSERT INTO resources (university_id, course_id, topic_id, uploader_id, title, kind, body, url, file_id, source, status, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ctx.user.university_id, course.id, b.topic_id ?? null, ctx.user.id, b.title, b.kind, b.body, b.url ?? null, b.file_id ?? null, b.source, status, reviewer ? ctx.user.id : null
      );
      const rid = Number(res.lastInsertRowid);
      run('INSERT INTO resource_versions (resource_id, version, title, body, url) VALUES (?, 1, ?, ?, ?)', rid, b.title, b.body, b.url ?? null);
      return rid;
    });
    audit(ctx.user.id, 'resource.submit', `${id}:${status}`, ctx.ip);
    ctx.status = 201;
    return { id, status };
  });

  r.get('/api/resources/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id) ? get(`${RES_SELECT} WHERE r.id = ?`, ctx.user.id, id) : null;
    if (!row || !resourceVisibleTo(ctx, row)) throw new HttpError(404, 'We could not find that resource.');
    const versions = all('SELECT version, title, created_at FROM resource_versions WHERE resource_id = ? ORDER BY version DESC', id);
    return { resource: resourceRow(row, ctx, true), versions };
  });

  r.patch('/api/resources/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id) ? get('SELECT * FROM resources WHERE id = ? AND university_id = ? AND uploader_id = ?', id, ctx.user.university_id, ctx.user.id) : null;
    if (!row || row.status === 'removed') throw new HttpError(404, 'We could not find that resource.');
    const b = parse(ctx.body, {
      title: T.str({ min: 4, max: 140, optional: true }),
      body: T.str({ min: 1, max: 8000, multiline: true, optional: true }),
      url: T.httpsUrl({ optional: true }),
    });
    if (!Object.keys(b).length) throw badRequest('Nothing to update.');
    const next = { title: b.title ?? row.title, body: b.body ?? row.body, url: b.url ?? row.url };
    const reviewer = canReview(ctx.user, row.course_id);
    const status = reviewer ? row.status : 'pending';
    tx(() => {
      const version = row.version + 1;
      run(
        "UPDATE resources SET title = ?, body = ?, url = ?, version = ?, status = ?, review_note = '', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        next.title, next.body, next.url, version, status, id
      );
      run('INSERT INTO resource_versions (resource_id, version, title, body, url) VALUES (?, ?, ?, ?, ?)', id, version, next.title, next.body, next.url);
    });
    audit(ctx.user.id, 'resource.edit', String(id), ctx.ip);
    return { version: row.version + 1, status };
  });

  r.post('/api/resources/:id/review', (ctx) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id) ? get('SELECT * FROM resources WHERE id = ? AND university_id = ?', id, ctx.user.university_id) : null;
    if (!row || row.status === 'removed') throw new HttpError(404, 'We could not find that resource.');
    if (!canReview(ctx.user, row.course_id)) throw new HttpError(403, 'Only teachers assigned to this course can review its resources.');
    const b = parse(ctx.body, {
      decision: T.enum(['verified', 'community', 'reject', 'remove']),
      note: T.str({ min: 1, max: 300, optional: true, default: '' }),
    });
    if (['reject', 'remove'].includes(b.decision) && b.note.length < 5) throw badRequest('Say why, so the contributor can fix it.', { note: 'At least 5 characters' });
    const status = { verified: 'faculty_verified', community: 'community', reject: 'rejected', remove: 'removed' }[b.decision];
    run('UPDATE resources SET status = ?, review_note = ?, reviewed_by = ? WHERE id = ?', status, b.note, ctx.user.id, id);
    audit(ctx.user.id, 'resource.review', `${id}:${status}`, ctx.ip);
    return { status };
  });

  r.post('/api/resources/:id/bookmark', (ctx) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id) ? get('SELECT * FROM resources WHERE id = ? AND university_id = ?', id, ctx.user.university_id) : null;
    if (!row || !resourceVisibleTo(ctx, row)) throw new HttpError(404, 'We could not find that resource.');
    const has = get('SELECT 1 FROM bookmarks WHERE user_id = ? AND resource_id = ?', ctx.user.id, id);
    if (has) run('DELETE FROM bookmarks WHERE user_id = ? AND resource_id = ?', ctx.user.id, id);
    else run('INSERT INTO bookmarks (user_id, resource_id) VALUES (?, ?)', ctx.user.id, id);
    return { saved: !has };
  });

  r.get('/api/review-queue', (ctx) => {
    const admin = ctx.user.role === 'admin';
    const scope = admin ? '1 = 1' : 'r.course_id IN (SELECT course_id FROM course_teachers WHERE user_id = ?)';
    if (!admin && !(ctx.user.role === 'teacher' && ctx.user.verified)) return { resources: [], handovers: [] };
    const p = admin ? [ctx.user.id, ctx.user.university_id] : [ctx.user.id, ctx.user.university_id, ctx.user.id];
    const resources = all(`${RES_SELECT} WHERE r.status = 'pending' AND r.university_id = ? AND ${scope} ORDER BY r.id`, ...p);
    const hscope = admin ? '1 = 1' : 'h.course_id IN (SELECT course_id FROM course_teachers WHERE user_id = ?)';
    const hp = admin ? [ctx.user.university_id] : [ctx.user.university_id, ctx.user.id];
    const handovers = all(
      `SELECT h.id, h.title, h.body, h.created_at, h.file_id, f.original_name AS file_name, f.size_bytes AS file_size,
        c.code AS course_code, u.name AS author
       FROM handovers h JOIN courses c ON c.id = h.course_id JOIN users u ON u.id = h.author_id
       LEFT JOIN uploaded_files f ON f.id = h.file_id
       WHERE h.status = 'pending' AND h.university_id = ? AND ${hscope} ORDER BY h.id`,
      ...hp
    ).map((h) => ({
      ...h,
      file: h.file_id ? { id: h.file_id, name: h.file_name, size_bytes: h.file_size } : null,
    }));
    return { resources: resources.map((x) => resourceRow(x, ctx, true)), handovers };
  });

  /* ----- practice checks ----- */

  r.get('/api/quiz/:topic_id', (ctx) => {
    const t = topicFor(ctx, ctx.params.topic_id);
    const qs = all('SELECT id, concept, prompt, options FROM quiz_questions WHERE topic_id = ? ORDER BY id LIMIT 10', t.id);
    if (!qs.length) throw new HttpError(404, 'There is no practice check for this topic yet.');
    return {
      topic: { id: t.id, name: t.name, course_code: t.course_code },
      note: 'A short check gives a preliminary indication only. It cannot measure your full understanding.',
      questions: qs.map((q) => ({ id: q.id, concept: q.concept, prompt: q.prompt, options: parseOptions(q.options) })),
    };
  });

  r.post('/api/quiz/:topic_id/attempt', (ctx) => {
    const t = topicFor(ctx, ctx.params.topic_id);
    if (!ctx.body || typeof ctx.body !== 'object' || !Array.isArray(ctx.body.answers)) throw badRequest('Send your answers.');
    const kind = ['baseline', 'followup', 'practice'].includes(ctx.body.kind) ? ctx.body.kind : 'practice';
    const qs = all('SELECT * FROM quiz_questions WHERE topic_id = ? ORDER BY id LIMIT 10', t.id);
    if (!qs.length) throw new HttpError(404, 'There is no practice check for this topic yet.');
    const given = new Map();
    for (const a of ctx.body.answers.slice(0, 20)) {
      if (!a || !Number.isInteger(a.question_id) || !Number.isInteger(a.chosen)) throw badRequest('Each answer needs a question and a choice.');
      if (given.has(a.question_id)) throw badRequest('Each question can be answered once.');
      given.set(a.question_id, a.chosen);
    }
    for (const q of qs) {
      if (!given.has(q.id)) throw badRequest('Answer every question before submitting.');
      if (given.get(q.id) < 0 || given.get(q.id) >= parseOptions(q.options).length) throw badRequest('That choice is not available.');
    }
    if (given.size !== qs.length) throw badRequest('Those answers do not match this check.');
    let bookingId = null;
    if (ctx.body.booking_id !== undefined && ctx.body.booking_id !== null) {
      const b = get(
        "SELECT id FROM bookings WHERE id = ? AND learner_id = ? AND status IN ('completed','resolved_release')",
        Number(ctx.body.booking_id), ctx.user.id
      );
      if (!b) throw badRequest('That session is not a completed session of yours.');
      bookingId = b.id;
    }
    const graded = qs.map((q) => ({ q, chosen: given.get(q.id), correct: given.get(q.id) === q.correct_index ? 1 : 0 }));
    const score = graded.reduce((n, g) => n + g.correct, 0);
    const ids = JSON.stringify(qs.map((q) => q.id));
    const previous = all('SELECT * FROM quiz_attempts WHERE user_id = ? AND topic_id = ? ORDER BY id DESC', ctx.user.id, t.id);
    const attemptId = tx(() => {
      const res = run(
        'INSERT INTO quiz_attempts (user_id, topic_id, kind, booking_id, question_ids, score, total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ctx.user.id, t.id, kind, bookingId, ids, score, qs.length
      );
      const aid = Number(res.lastInsertRowid);
      for (const g of graded) run('INSERT INTO quiz_answers (attempt_id, question_id, chosen, correct) VALUES (?, ?, ?, ?)', aid, g.q.id, g.chosen, g.correct);
      return aid;
    });
    const prev = previous[0];
    let comparison = { available: false, note: 'This is your first attempt on this topic, so there is nothing to compare with yet.' };
    if (prev) {
      comparison = prev.question_ids === ids
        ? { available: true, previous: { score: prev.score, total: prev.total, kind: prev.kind }, note: 'Compared with your previous attempt on the same questions. A change may have many causes, including practice effects, and does not prove what caused it.' }
        : { available: false, previous: { score: prev.score, total: prev.total, kind: prev.kind }, note: 'Your previous attempt used different questions, so the two scores are not directly comparable.' };
    }
    const concepts = conceptResults(graded.map((g) => ({ concept: g.q.concept, correct: g.correct })));
    ctx.status = 201;
    return {
      attempt_id: attemptId,
      score,
      total: qs.length,
      concepts,
      review: graded.map((g) => ({ question_id: g.q.id, prompt: g.q.prompt, chosen: g.chosen, correct_index: g.q.correct_index, correct: !!g.correct, options: parseOptions(g.q.options), explanation: g.q.explanation, concept: g.q.concept })),
      comparison,
      note: 'These results are preliminary indicators from a short check, not a measure of your overall ability.',
    };
  });

  r.get('/api/progress', (ctx) => {
    const attempts = all(
      `SELECT a.id, a.kind, a.score, a.total, a.question_ids, a.created_at, a.topic_id, t.name AS topic, c.code AS course_code
       FROM quiz_attempts a JOIN topics t ON t.id = a.topic_id JOIN courses c ON c.id = t.course_id
       WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 100`,
      ctx.user.id
    );
    const byTopic = new Map();
    for (const a of attempts) {
      const e = byTopic.get(a.topic_id) || { topic_id: a.topic_id, topic: a.topic, course_code: a.course_code, attempts: [] };
      e.attempts.push({ id: a.id, kind: a.kind, score: a.score, total: a.total, created_at: a.created_at, set: a.question_ids });
      byTopic.set(a.topic_id, e);
    }
    const topics = [...byTopic.values()].map((e) => {
      const ordered = [...e.attempts].reverse();
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const comparable = ordered.length > 1 && first.set === last.set;
      return {
        topic_id: e.topic_id, topic: e.topic, course_code: e.course_code,
        attempts: e.attempts.map(({ set, ...rest }) => rest),
        comparison: ordered.length < 2
          ? { available: false, note: 'Only one attempt so far.' }
          : comparable
            ? { available: true, first: { score: first.score, total: first.total }, latest: { score: last.score, total: last.total }, note: 'Same questions, first and latest attempt. This is an indicator, not proof of cause.' }
            : { available: false, note: 'Your first and latest attempts used different questions, so they are not directly comparable.' },
      };
    });
    const statuses = all(
      `SELECT d.status, t.name AS topic, c.code AS course_code FROM difficulty_reports d JOIN topics t ON t.id = d.topic_id JOIN courses c ON c.id = t.course_id WHERE d.user_id = ? ORDER BY d.updated_at DESC LIMIT 50`,
      ctx.user.id
    );
    return { topics, statuses };
  });

  /* ----- missions ----- */

  const missionBody = {
    topic_id: T.int({ min: 1 }),
    goal: T.str({ min: 1, max: 300, multiline: true, optional: true, default: '' }),
    exam_date: T.iso({ optional: true }),
  };

  r.post('/api/missions/preview', (ctx) => {
    const b = parse(ctx.body, missionBody);
    const t = topicFor(ctx, b.topic_id);
    return { preview: true, topic: { id: t.id, name: t.name, course_code: t.course_code }, ...planMission(ctx.user, t, { goal: b.goal, examDate: b.exam_date }), engine: 'Rule-based planner using your saved results and approved resources. No AI model is used.' };
  });

  r.post('/api/missions', (ctx) => {
    const raw = ctx.body && typeof ctx.body === 'object' ? ctx.body : {};
    const skip = Array.isArray(raw.skip) ? raw.skip.filter((n) => Number.isInteger(n)).slice(0, 20) : [];
    const { skip: _skip, ...rest } = raw;
    const b = parse(rest, missionBody);
    const t = topicFor(ctx, b.topic_id);
    if (get("SELECT COUNT(*) AS n FROM missions WHERE user_id = ? AND status = 'active'", ctx.user.id).n >= 10) throw new HttpError(409, 'You have 10 active missions. Finish or drop one first.');
    const plan = planMission(ctx.user, t, { goal: b.goal, examDate: b.exam_date });
    const steps = plan.steps.filter((s) => !skip.includes(s.position));
    if (!steps.length) throw badRequest('Keep at least one step.');
    const id = tx(() => {
      const res = run('INSERT INTO missions (user_id, topic_id, goal, exam_date, basis) VALUES (?, ?, ?, ?, ?)', ctx.user.id, t.id, b.goal, b.exam_date ?? null, plan.basis);
      const mid = Number(res.lastInsertRowid);
      steps.forEach((s, i) => run('INSERT INTO mission_steps (mission_id, position, kind, title, ref_id) VALUES (?, ?, ?, ?, ?)', mid, i + 1, s.kind, s.title, s.ref_id ?? null));
      return mid;
    });
    ctx.status = 201;
    return { id };
  });

  r.get('/api/missions', (ctx) => {
    const ms = all(
      `SELECT m.id, m.goal, m.exam_date, m.status, m.basis, m.created_at, t.id AS topic_id, t.name AS topic, c.code AS course_code
       FROM missions m JOIN topics t ON t.id = m.topic_id JOIN courses c ON c.id = t.course_id WHERE m.user_id = ? AND m.status <> 'dropped' ORDER BY m.id DESC LIMIT 30`,
      ctx.user.id
    );
    return {
      missions: ms.map((m) => ({
        ...m,
        steps: all('SELECT id, position, kind, title, ref_id, done FROM mission_steps WHERE mission_id = ? ORDER BY position', m.id).map((s) => ({ ...s, done: !!s.done })),
      })),
    };
  });

  r.post('/api/missions/:id/steps/:sid/toggle', (ctx) => {
    const s = get(
      `SELECT s.id, s.done, s.mission_id FROM mission_steps s JOIN missions m ON m.id = s.mission_id WHERE s.id = ? AND s.mission_id = ? AND m.user_id = ?`,
      Number(ctx.params.sid), Number(ctx.params.id), ctx.user.id
    );
    if (!s) throw new HttpError(404, 'We could not find that step.');
    run('UPDATE mission_steps SET done = ? WHERE id = ?', s.done ? 0 : 1, s.id);
    const left = get('SELECT COUNT(*) AS n FROM mission_steps WHERE mission_id = ? AND done = 0', s.mission_id).n;
    run('UPDATE missions SET status = ? WHERE id = ?', left === 0 ? 'done' : 'active', s.mission_id);
    return { done: !s.done, mission_done: left === 0 };
  });

  r.post('/api/missions/:id/drop', (ctx) => {
    const m = get('SELECT id FROM missions WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!m) throw new HttpError(404, 'We could not find that mission.');
    run("UPDATE missions SET status = 'dropped' WHERE id = ?", m.id);
    return { ok: true };
  });

  /* ----- senior handover ----- */

  r.get('/api/handovers', (ctx) => {
    const params = [ctx.user.university_id, ctx.user.id];
    let where = "h.university_id = ? AND (h.status = 'approved' OR h.author_id = ?)";
    if (Number.isInteger(Number(ctx.query.course_id)) && ctx.query.course_id) { where += ' AND h.course_id = ?'; params.push(Number(ctx.query.course_id)); }
    where += " AND h.status <> 'removed'";
    const rows = all(
      `SELECT h.id, h.title, h.body, h.status, h.review_note, h.show_author, h.author_id, h.created_at, h.file_id,
        f.original_name AS file_name, f.size_bytes AS file_size, f.mime_type AS file_mime,
        c.code AS course_code, c.name AS course_name, u.name AS author
       FROM handovers h JOIN courses c ON c.id = h.course_id JOIN users u ON u.id = h.author_id
       LEFT JOIN uploaded_files f ON f.id = h.file_id WHERE ${where} ORDER BY h.id DESC LIMIT 50`,
      ...params
    );
    return {
      handovers: rows.map((h) => ({
        id: h.id, title: h.title, body: h.body, status: h.status, review_note: h.author_id === ctx.user.id ? h.review_note : '', created_at: h.created_at,
        course: { code: h.course_code, name: h.course_name },
        file: h.file_id ? { id: h.file_id, name: h.file_name, size_bytes: h.file_size, mime_type: h.file_mime } : null,
        author: h.show_author ? h.author : 'A senior who chose to stay anonymous',
        author_id: h.show_author ? h.author_id : null,
        mine: h.author_id === ctx.user.id,
      })),
    };
  });

  r.post('/api/handovers', (ctx) => {
    const b = parse(ctx.body, {
      course_id: T.int({ min: 1 }),
      title: T.str({ min: 6, max: 140 }),
      body: T.str({ min: 10, max: 8000, multiline: true }),
      file_id: T.int({ min: 1, optional: true }),
      show_author: T.int({ min: 0, max: 1 }),
      permission: T.int({ min: 1, max: 1 }),
    });
    if (!b.file_id && b.body.length < 40) {
      throw badRequest('Check the highlighted fields.', { body: 'At least 40 characters (or attach a file)' });
    }
    const course = courseFor(ctx, b.course_id);
    if (b.file_id) {
      const f = get('SELECT id FROM uploaded_files WHERE id = ? AND university_id = ? AND uploader_id = ?', b.file_id, ctx.user.university_id, ctx.user.id);
      if (!f) throw badRequest('Uploaded file not found.', { file_id: 'Not found' });
    }
    if (get("SELECT COUNT(*) AS n FROM handovers WHERE author_id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')", ctx.user.id).n >= 5) {
      throw new HttpError(429, 'You have reached the daily limit for handover collections.');
    }
    const res = run(
      'INSERT INTO handovers (university_id, course_id, author_id, title, body, file_id, show_author) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ctx.user.university_id, course.id, ctx.user.id, b.title, b.body, b.file_id ?? null, b.show_author
    );
    audit(ctx.user.id, 'handover.submit', String(res.lastInsertRowid), ctx.ip);
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid), status: 'pending' };
  });

  /* ----- uploaded files and shared subject folders ----- */

  r.post('/api/files', { maxBody: 6 * 1024 * 1024 }, (ctx) => {
    const b = parse(ctx.body, {
      filename: T.str({ min: 1, max: 180 }),
      mime_type: T.str({ min: 1, max: 120, optional: true, default: 'application/octet-stream' }),
      data_base64: T.raw({ min: 1, max: 6 * 1024 * 1024 }),
    });
    const base = path.basename(b.filename).replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 140) || 'file';
    const ext = path.extname(base).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw badRequest(`Unsupported file type. Allowed: ${[...ALLOWED_EXTS].join(', ')}`, { file: 'Unsupported file type' });
    }
    const rawStr = b.data_base64.includes(',') ? b.data_base64.split(',').pop() : b.data_base64;
    const buf = Buffer.from(rawStr, 'base64');
    if (!buf.byteLength) throw badRequest('The selected file is empty.', { file: 'Empty file' });
    if (buf.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Files must be 4 MB or smaller.');
    fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
    const storedName = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
    const res = run(
      'INSERT INTO uploaded_files (university_id, uploader_id, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)',
      ctx.user.university_id, ctx.user.id, base, storedName, clean(b.mime_type).slice(0, 120) || 'application/octet-stream', buf.byteLength
    );
    const id = Number(res.lastInsertRowid);
    audit(ctx.user.id, 'file.upload', `${id}:${base}`, ctx.ip);
    ctx.status = 201;
    return { file: { id, original_name: base, mime_type: b.mime_type, size_bytes: buf.byteLength } };
  });

  r.get('/api/files/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id)
      ? get('SELECT * FROM uploaded_files WHERE id = ? AND university_id = ?', id, ctx.user.university_id)
      : null;
    if (!row) throw new HttpError(404, 'File not found.');
    const full = path.join(UPLOAD_DIR, path.basename(row.stored_name));
    if (!fs.existsSync(full)) throw new HttpError(404, 'File not found on disk.');
    const buf = fs.readFileSync(full);
    const safeName = row.original_name.replace(/["\\\r\n]/g, '_');
    ctx.headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    };
    return { raw: buf };
  });

  r.get('/api/folders', (ctx) => {
    const courses = all(
      `SELECT c.id, c.code, c.name, c.department, c.background,
        (SELECT COUNT(*) FROM folder_files ff WHERE ff.course_id = c.id AND ff.university_id = c.university_id) AS folder_count,
        (SELECT COUNT(*) FROM resources r WHERE r.course_id = c.id AND r.university_id = c.university_id AND r.status IN ('official','faculty_verified','community')) AS resource_count
       FROM courses c WHERE c.university_id = ? ORDER BY c.code`,
      ctx.user.university_id
    );
    let files = [];
    let selectedCourse = null;
    if (ctx.query.course_id && Number.isInteger(Number(ctx.query.course_id))) {
      const cid = Number(ctx.query.course_id);
      selectedCourse = get('SELECT id, code, name, department, background FROM courses WHERE id = ? AND university_id = ?', cid, ctx.user.university_id);
      if (!selectedCourse) throw new HttpError(404, 'We could not find that subject folder.');
      files = all(
        `SELECT ff.id, ff.title, ff.notes, ff.created_at, ff.uploader_id, u.name AS uploader_name, u.role AS uploader_role,
          f.id AS file_id, f.original_name, f.size_bytes, f.mime_type
         FROM folder_files ff
         JOIN uploaded_files f ON f.id = ff.file_id
         JOIN users u ON u.id = ff.uploader_id
         WHERE ff.university_id = ? AND ff.course_id = ?
         ORDER BY ff.id DESC LIMIT 100`,
        ctx.user.university_id, cid
      ).map((x) => ({
        id: x.id,
        title: x.title,
        notes: x.notes,
        created_at: x.created_at,
        uploader: { id: x.uploader_id, name: x.uploader_name, role: x.uploader_role },
        mine: x.uploader_id === ctx.user.id,
        file: { id: x.file_id, name: x.original_name, size_bytes: x.size_bytes, mime_type: x.mime_type },
      }));
    }
    return { folders: courses, course: selectedCourse, files };
  });

  r.post('/api/folders/:course_id/files', (ctx) => {
    const course = courseFor(ctx, ctx.params.course_id);
    const b = parse(ctx.body, {
      file_id: T.int({ min: 1 }),
      title: T.str({ min: 2, max: 140 }),
      notes: T.str({ min: 1, max: 500, multiline: true, optional: true, default: '' }),
    });
    const f = get('SELECT id, original_name, size_bytes, mime_type FROM uploaded_files WHERE id = ? AND university_id = ? AND uploader_id = ?', b.file_id, ctx.user.university_id, ctx.user.id);
    if (!f) throw badRequest('Uploaded file not found.', { file_id: 'Required' });
    const res = run(
      'INSERT INTO folder_files (university_id, course_id, uploader_id, file_id, title, notes) VALUES (?, ?, ?, ?, ?, ?)',
      ctx.user.university_id, course.id, ctx.user.id, f.id, b.title, b.notes
    );
    audit(ctx.user.id, 'folder.upload', `${course.code}:${f.original_name}`, ctx.ip);
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid) };
  });

  r.delete('/api/folders/files/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const row = Number.isInteger(id)
      ? get('SELECT id, uploader_id, course_id FROM folder_files WHERE id = ? AND university_id = ?', id, ctx.user.university_id)
      : null;
    if (!row) throw new HttpError(404, 'File entry not found.');
    if (row.uploader_id !== ctx.user.id && !canReview(ctx.user, row.course_id)) {
      throw new HttpError(403, 'You can only remove your own uploads.');
    }
    run('DELETE FROM folder_files WHERE id = ?', row.id);
    return { ok: true };
  });

  /* ----- practice task manager (to-do list) ----- */

  r.get('/api/tasks', (ctx) => ({
    tasks: all(
      'SELECT id, title, course_code, due_date, priority, done, created_at FROM practice_tasks WHERE user_id = ? ORDER BY done ASC, id DESC LIMIT 100',
      ctx.user.id
    ).map((t) => ({ ...t, done: !!t.done })),
  }));

  r.post('/api/tasks', (ctx) => {
    const b = parse(ctx.body, {
      title: T.str({ min: 2, max: 160 }),
      course_code: T.str({ min: 1, max: 20, optional: true, default: '' }),
      due_date: T.str({ min: 4, max: 20, optional: true, default: '' }),
      priority: T.enum(['low', 'medium', 'high'], { optional: true, default: 'medium' }),
    });
    const res = run(
      'INSERT INTO practice_tasks (user_id, title, course_code, due_date, priority) VALUES (?, ?, ?, ?, ?)',
      ctx.user.id, b.title, b.course_code.toUpperCase(), b.due_date || null, b.priority
    );
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid) };
  });

  r.post('/api/tasks/:id/toggle', (ctx) => {
    const row = get('SELECT id, done FROM practice_tasks WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!row) throw new HttpError(404, 'Task not found.');
    const next = row.done ? 0 : 1;
    run('UPDATE practice_tasks SET done = ? WHERE id = ?', next, row.id);
    return { done: !!next };
  });

  r.delete('/api/tasks/:id', (ctx) => {
    const row = get('SELECT id FROM practice_tasks WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!row) throw new HttpError(404, 'Task not found.');
    run('DELETE FROM practice_tasks WHERE id = ?', row.id);
    return { ok: true };
  });

  /* ----- personal calendar (my missions) ----- */

  r.get('/api/calendar', (ctx) => {
    const events = all(
      'SELECT id, title, event_date, category, notes, created_at FROM calendar_events WHERE user_id = ? ORDER BY event_date ASC, id ASC LIMIT 200',
      ctx.user.id
    );
    const missionDates = all(
      `SELECT m.id, m.exam_date, t.name AS topic, c.code AS course_code
       FROM missions m JOIN topics t ON t.id = m.topic_id JOIN courses c ON c.id = t.course_id
       WHERE m.user_id = ? AND m.status = 'active' AND m.exam_date IS NOT NULL`,
      ctx.user.id
    ).map((m) => ({
      id: `mission-${m.id}`,
      title: `${m.course_code}: ${m.topic} (Mission exam)`,
      event_date: String(m.exam_date).slice(0, 10),
      category: 'exam',
      notes: 'Linked from learning mission',
      readonly: true,
    }));
    return { events: [...events, ...missionDates] };
  });

  r.post('/api/calendar', (ctx) => {
    const b = parse(ctx.body, {
      title: T.str({ min: 2, max: 140 }),
      event_date: T.str({ min: 8, max: 20 }),
      category: T.enum(['exam', 'event', 'assignment', 'study', 'personal'], { optional: true, default: 'exam' }),
      notes: T.str({ min: 1, max: 400, multiline: true, optional: true, default: '' }),
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.event_date)) {
      throw badRequest('Use YYYY-MM-DD date format.', { event_date: 'Invalid date' });
    }
    const res = run(
      'INSERT INTO calendar_events (user_id, title, event_date, category, notes) VALUES (?, ?, ?, ?, ?)',
      ctx.user.id, b.title, b.event_date, b.category, b.notes
    );
    ctx.status = 201;
    return { id: Number(res.lastInsertRowid) };
  });

  r.delete('/api/calendar/:id', (ctx) => {
    const row = get('SELECT id FROM calendar_events WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!row) throw new HttpError(404, 'Calendar entry not found.');
    run('DELETE FROM calendar_events WHERE id = ?', row.id);
    return { ok: true };
  });

  r.post('/api/handovers/:id/review', (ctx) => {
    const h = get('SELECT * FROM handovers WHERE id = ? AND university_id = ?', Number(ctx.params.id), ctx.user.university_id);
    if (!h || h.status === 'removed') throw new HttpError(404, 'We could not find that collection.');
    if (!canReview(ctx.user, h.course_id)) throw new HttpError(403, 'Only teachers assigned to this course can review handover collections.');
    const b = parse(ctx.body, { decision: T.enum(['approve', 'reject']), note: T.str({ min: 1, max: 300, optional: true, default: '' }) });
    if (b.decision === 'reject' && b.note.length < 5) throw badRequest('Say why, so the author can fix it.', { note: 'At least 5 characters' });
    run('UPDATE handovers SET status = ?, review_note = ?, reviewed_by = ? WHERE id = ?', b.decision === 'approve' ? 'approved' : 'rejected', b.note, ctx.user.id, h.id);
    audit(ctx.user.id, 'handover.review', `${h.id}:${b.decision}`, ctx.ip);
    return { status: b.decision === 'approve' ? 'approved' : 'rejected' };
  });

  r.delete('/api/handovers/:id', (ctx) => {
    const h = get('SELECT id FROM handovers WHERE id = ? AND author_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!h) throw new HttpError(404, 'We could not find that collection.');
    run("UPDATE handovers SET status = 'removed' WHERE id = ?", h.id);
    return { ok: true };
  });

  /* ----- admin: assign teachers to courses ----- */

  r.get('/api/admin/course-teachers', { auth: 'admin' }, () => ({
    assignments: all(
      `SELECT ct.course_id, ct.user_id, c.code, c.name AS course, u.name AS teacher, u.verified, un.name AS university
       FROM course_teachers ct JOIN courses c ON c.id = ct.course_id JOIN users u ON u.id = ct.user_id JOIN universities un ON un.id = c.university_id ORDER BY un.name, c.code`
    ),
    teachers: all("SELECT u.id, u.name, u.verified, un.name AS university FROM users u JOIN universities un ON un.id = u.university_id WHERE u.role = 'teacher' ORDER BY un.name, u.name"),
    courses: all('SELECT c.id, c.code, c.name, un.name AS university FROM courses c JOIN universities un ON un.id = c.university_id ORDER BY un.name, c.code'),
  }));

  r.post('/api/admin/course-teachers', { auth: 'admin' }, (ctx) => {
    const b = parse(ctx.body, { course_id: T.int({ min: 1 }), user_id: T.int({ min: 1 }), remove: T.int({ min: 0, max: 1, optional: true, default: 0 }) });
    const course = get('SELECT id, university_id FROM courses WHERE id = ?', b.course_id);
    const teacher = get("SELECT id, university_id, verified FROM users WHERE id = ? AND role = 'teacher'", b.user_id);
    if (!course || !teacher) throw new HttpError(404, 'We could not find that course or teacher.');
    if (course.university_id !== teacher.university_id) throw badRequest('A teacher can only be assigned to courses at their own university.');
    if (b.remove) run('DELETE FROM course_teachers WHERE course_id = ? AND user_id = ?', course.id, teacher.id);
    else {
      if (!teacher.verified) throw badRequest('Verify the teacher account first.');
      run('INSERT OR IGNORE INTO course_teachers (course_id, user_id) VALUES (?, ?)', course.id, teacher.id);
    }
    audit(ctx.user.id, b.remove ? 'teacher.unassign' : 'teacher.assign', `${course.id}:${teacher.id}`, ctx.ip);
    return { ok: true };
  });
}
