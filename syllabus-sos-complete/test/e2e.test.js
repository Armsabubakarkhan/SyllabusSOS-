import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';

const PORT = 3917;
const DB = `data/test-${process.pid}.db`;
Object.assign(process.env, {
  NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(PORT), APP_SECRET: crypto.randomBytes(40).toString('base64url'),
  DATABASE_PATH: DB, PAYMENTS_MODE: 'test', ENV_FILE: '.env.does-not-exist', PLATFORM_FEE_PERCENT: '10', RADAR_MIN_RESPONSES: '5',
});

const base = `http://127.0.0.1:${PORT}`;
let server;
let dbm;
const PW = 'Correct-Horse-42';

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const h = { 'X-Requested-With': 'sos', ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
}

let uniA;
let uniB;
let courseA;
let topicA;
const emails = new Set();
const email = (tag) => { const e = `${tag}-${crypto.randomBytes(3).toString('hex')}@example.test`; emails.add(e); return e; };

async function signup(tag, universityId, extra = {}) {
  const c = new Client();
  const e = email(tag);
  const r = await c.post('/api/auth/register', { name: `Test ${tag}`, email: e, password: PW, university_id: universityId, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { c, email: e, id: r.data.user.id };
}

before(async () => {
  fs.mkdirSync('data', { recursive: true });
  const { createServer } = await import('../server/index.js');
  dbm = await import('../server/db.js');
  const { createAdmin } = await import('../server/routes/auth.js');
  await createAdmin('admin@example.test', 'Quartz-Lantern-Orbit-77');
  const run = dbm.run;
  run("INSERT INTO universities (slug, name, city, status) VALUES ('uni-a', 'Test University A', 'Pune', 'approved')");
  run("INSERT INTO universities (slug, name, city, status) VALUES ('uni-b', 'Test University B', 'Delhi', 'approved')");
  uniA = dbm.get("SELECT id FROM universities WHERE slug = 'uni-a'").id;
  uniB = dbm.get("SELECT id FROM universities WHERE slug = 'uni-b'").id;
  run("INSERT INTO courses (university_id, code, name) VALUES (?, 'TOC101', 'Theory of Computation')", uniA);
  courseA = dbm.get('SELECT id FROM courses WHERE university_id = ?', uniA).id;
  run("INSERT INTO topics (course_id, unit_no, unit_name, name, objective) VALUES (?, 1, 'Automata', 'NFA to DFA', 'Convert')", courseA);
  topicA = dbm.get('SELECT id FROM topics WHERE course_id = ?', courseA).id;
  const opts = JSON.stringify(['one', 'two', 'three']);
  run("INSERT INTO quiz_questions (topic_id, concept, prompt, options, correct_index, explanation) VALUES (?, 'Closure', 'Q1?', ?, 1, 'because')", topicA, opts);
  run("INSERT INTO quiz_questions (topic_id, concept, prompt, options, correct_index, explanation) VALUES (?, 'Closure', 'Q2?', ?, 2, 'because')", topicA, opts);
  server = createServer();
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
});

after(async () => {
  await new Promise((r) => server.close(r));
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
});

/* ---------- authentication ---------- */

test('register, me, logout, login', async () => {
  const u = await signup('auth', uniA);
  const me = await u.c.get('/api/auth/me');
  assert.equal(me.data.user.email, u.email);
  assert.equal(me.data.user.university.slug, 'uni-a');
  await u.c.post('/api/auth/logout');
  assert.equal((await u.c.get('/api/auth/me')).data.user, null);
  const l = await u.c.post('/api/auth/login', { email: u.email, password: PW });
  assert.equal(l.status, 200);
});

test('weak and common passwords are rejected, duplicate email gives a generic error', async () => {
  const c = new Client();
  const weak = await c.post('/api/auth/register', { name: 'Weak', email: email('weak'), password: 'short', university_id: uniA });
  assert.equal(weak.status, 400);
  const common = await c.post('/api/auth/register', { name: 'Weak', email: email('weak2'), password: 'password123', university_id: uniA });
  assert.equal(common.status, 400);
  const u = await signup('dup', uniA);
  const dup = await new Client().post('/api/auth/register', { name: 'Dup', email: u.email, password: PW, university_id: uniA });
  assert.equal(dup.status, 409);
  assert.doesNotMatch(JSON.stringify(dup.data), /UNIQUE|sqlite|constraint/i);
});

test('passwords are stored as scrypt hashes, never plain text', async () => {
  const u = await signup('hash', uniA);
  const row = dbm.get('SELECT pw_hash FROM users WHERE id = ?', u.id);
  assert.match(row.pw_hash, /^scrypt\$/);
  assert.ok(!row.pw_hash.includes(PW));
});

test('wrong password gives the same message for unknown and known accounts', async () => {
  const u = await signup('login', uniA);
  const a = await new Client().post('/api/auth/login', { email: u.email, password: 'Wrong-Password-1' });
  const b = await new Client().post('/api/auth/login', { email: 'nobody@example.test', password: 'Wrong-Password-1' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.data.error, b.data.error);
});

test('repeated failed logins lock the account or rate limit the caller', async () => {
  const u = await signup('lock', uniA);
  const c = new Client();
  let blocked = false;
  for (let i = 0; i < 10; i++) {
    const r = await c.post('/api/auth/login', { email: u.email, password: `Wrong-Password-${i}` });
    if (r.status === 429) { blocked = true; break; }
  }
  assert.ok(blocked, 'expected a 429 after repeated failures');
  const good = await new Client().post('/api/auth/login', { email: u.email, password: PW });
  assert.equal(good.status, 429, 'correct password must not bypass the lock');
});

/* ---------- access control ---------- */

test('logged-out requests to protected data and pages are refused', async () => {
  const c = new Client();
  for (const p of ['/api/offers', '/api/wallet', '/api/bookings', '/api/messages/threads', '/api/progress', '/api/admin/stats']) {
    assert.equal((await c.get(p)).status, 401, p);
  }
  const page = await fetch(`${base}/app`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login/);
});

test('a student cannot reach admin routes or the admin page, and cannot grant themselves a role', async () => {
  const u = await signup('student', uniA);
  assert.equal((await u.c.get('/api/admin/stats')).status, 403);
  assert.equal((await u.c.get('/api/admin/users')).status, 403);
  const page = await fetch(`${base}/admin`, { headers: { Cookie: u.c.cookie }, redirect: 'manual' });
  assert.equal(page.status, 404);
  assert.equal((await u.c.patch('/api/me', { role: 'admin' })).status, 400);
  assert.equal((await u.c.patch('/api/me', { verified: 1 })).status, 400);
  const reg = await new Client().post('/api/auth/register', { name: 'Evil', email: email('evil'), password: PW, university_id: uniA, role: 'admin' });
  assert.equal(reg.status, 400);
  assert.equal(dbm.get('SELECT role FROM users WHERE id = ?', u.id).role, 'student');
});

test('administrator can use admin routes', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email: 'admin@example.test', password: 'Quartz-Lantern-Orbit-77' });
  assert.equal(r.status, 200);
  const s = await c.get('/api/admin/stats');
  assert.equal(s.status, 200);
  assert.equal(s.data.ledger_balanced, true);
});

test('university isolation: other campuses cannot read listings, people, messages or posts', async () => {
  const tutor = await signup('tutorA', uniA);
  const outsider = await signup('outsiderB', uniB);
  const offer = await tutor.c.post('/api/offers', { course_id: courseA, headline: 'Automata made simple', price_per_hour: 100, mode: 'online', mastery: 'complete' });
  assert.equal(offer.status, 201, JSON.stringify(offer.data));
  const id = offer.data.offer.id;
  assert.equal((await outsider.c.get(`/api/offers/${id}`)).status, 404);
  assert.equal((await outsider.c.get(`/api/users/${tutor.id}`)).status, 404);
  assert.equal((await outsider.c.post('/api/messages', { to: tutor.id, body: 'hello' })).status, 404);
  assert.equal((await outsider.c.post('/api/bookings', { offer_id: id, start_at: new Date(Date.now() + 86400000).toISOString(), duration_min: 60 })).status, 404);
  const list = await outsider.c.get('/api/offers');
  assert.equal(list.data.offers.length, 0);
  assert.equal((await outsider.c.get(`/api/syllabus?course_id=${courseA}`)).status, 404);
});

test('private data is not exposed in public profile or discovery responses', async () => {
  const tutor = await signup('privacy', uniA);
  const viewer = await signup('viewer', uniA);
  const r = await viewer.c.get(`/api/users/${tutor.id}`);
  assert.equal(r.status, 200);
  assert.doesNotMatch(JSON.stringify(r.data), /example\.test|pw_hash|email/);
  const people = await viewer.c.get('/api/people');
  assert.doesNotMatch(JSON.stringify(people.data), /example\.test|pw_hash|email/);
  const demo = await new Client().get('/api/public/demo');
  assert.doesNotMatch(JSON.stringify(demo.data), /@|pw_hash/);
});

/* ---------- request safety ---------- */

test('CSRF and CORS: writes need the custom header and a trusted origin', async () => {
  const u = await signup('csrf', uniA);
  const noHeader = await fetch(`${base}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: u.c.cookie }, body: JSON.stringify({ bio: 'x' }) });
  assert.equal(noHeader.status, 403);
  const evil = await fetch(`${base}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: u.c.cookie, 'X-Requested-With': 'sos', Origin: 'https://evil.example' }, body: JSON.stringify({ bio: 'x' }) });
  assert.equal(evil.status, 403);
  const pre = await fetch(`${base}/api/me`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  assert.equal(pre.status, 403);
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const wrongType = await fetch(`${base}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'text/plain', Cookie: u.c.cookie, 'X-Requested-With': 'sos' }, body: '{"bio":"x"}' });
  assert.equal(wrongType.status, 415);
});

test('unknown hosts are refused and security headers are set', async () => {
  const status = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/config', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.end();
  });
  assert.equal(status, 421);
  const ok = await fetch(`${base}/`);
  assert.match(ok.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('x-frame-options'), 'DENY');
  assert.equal(ok.headers.get('x-powered-by'), null);
});

test('exposed files: env, database, source and traversal are not served', async () => {
  for (const p of ['/.env', '/.env.example', '/data/syllabussos.db', '/server/config.js', '/package.json', '/%2e%2e/package.json', '/js/../../package.json', '/views/admin.html', '/.git/config']) {
    const r = await fetch(base + p, { redirect: 'manual' });
    assert.ok([404, 400].includes(r.status), `${p} returned ${r.status}`);
  }
});

test('errors do not leak internals', async () => {
  const u = await signup('err', uniA);
  const r = await u.c.get('/api/offers/not-a-number');
  assert.equal(r.status, 404);
  const bad = await fetch(`${base}/api/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sos', Cookie: u.c.cookie }, body: '{bad json' });
  assert.equal(bad.status, 400);
  assert.doesNotMatch(await bad.text(), /SyntaxError|\bat \S+\.js|node_modules|\/home\//);
});

test('input is sanitised: markup is stripped and SQL-like text is stored as plain text', async () => {
  const u = await signup('xss', uniA);
  const r = await u.c.post('/api/posts', { kind: 'discussion', title: '<script>alert(1)</script>Hello <img src=x onerror=alert(2)> there', body: "'; DROP TABLE users; --" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const list = await u.c.get('/api/posts');
  const p = list.data.posts.find((x) => x.id === r.data.id);
  assert.ok(!/[<>]/.test(p.title), p.title);
  assert.match(p.title, /Hello/);
  assert.equal(p.body, "'; DROP TABLE users; --");
  assert.ok(dbm.get('SELECT COUNT(*) AS n FROM users').n > 0);
  const nested = await u.c.patch('/api/me', { bio: '<<b>script>alert(1)<</b>/script>' });
  assert.ok(!/<script/i.test(nested.data.user.bio));
});

test('unsafe links are rejected', async () => {
  const u = await signup('links', uniA);
  const js = await u.c.post('/api/resources', { course_id: courseA, title: 'Bad link here', kind: 'link', url: 'javascript:alert(1)', permission: 1 });
  assert.equal(js.status, 400);
  const http = await u.c.post('/api/resources', { course_id: courseA, title: 'Plain http link', kind: 'link', url: 'http://example.com/x', permission: 1 });
  assert.equal(http.status, 400);
  const ok = await u.c.post('/api/resources', { course_id: courseA, title: 'Good https link', kind: 'link', url: 'https://example.com/x', permission: 1 });
  assert.equal(ok.status, 201);
});

/* ---------- credits and bookings ---------- */

async function setupBooking() {
  const tutor = await signup('tutor', uniA);
  const learner = await signup('learner', uniA);
  const o = await tutor.c.post('/api/offers', { course_id: courseA, headline: 'Automata made simple', price_per_hour: 200, mode: 'online', mastery: 'complete' });
  await learner.c.post('/api/wallet/topup', { amount: 500 });
  return { tutor, learner, offerId: o.data.offer.id };
}
const soon = () => new Date(Date.now() + 2 * 86400000).toISOString();

test('booking holds credits, tutor accepts, learner confirms, ledger stays balanced', async () => {
  const { tutor, learner, offerId } = await setupBooking();
  const b = await learner.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 60 });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  assert.equal(b.data.booking.price_total, 200);
  assert.equal(b.data.booking.fee, 20);
  assert.equal((await learner.c.get('/api/wallet')).data.balance, 300);
  assert.equal(b.data.booking.status, 'requested');
  assert.equal((await learner.c.post(`/api/bookings/${b.data.booking.id}/accept`, {})).status, 403, 'learner cannot accept');
  const acc = await tutor.c.post(`/api/bookings/${b.data.booking.id}/accept`, {});
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.match(acc.data.booking.meeting_url, /^https:\/\/meet\.jit\.si\//);
  assert.equal((await learner.c.post(`/api/bookings/${b.data.booking.id}/complete`, {})).status, 409, 'cannot confirm before it starts');
  dbm.run("UPDATE bookings SET start_at = ? WHERE id = ?", new Date(Date.now() - 2 * 3600000).toISOString(), b.data.booking.id);
  assert.equal((await tutor.c.post(`/api/bookings/${b.data.booking.id}/complete`, {})).status, 403, 'tutor cannot confirm own payment');
  const done = await learner.c.post(`/api/bookings/${b.data.booking.id}/complete`, {});
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal((await learner.c.post(`/api/bookings/${b.data.booking.id}/complete`, {})).status, 409, 'double confirm refused');
  assert.equal((await tutor.c.get('/api/wallet')).data.balance, 180);
  assert.equal((await learner.c.get('/api/wallet')).data.balance, 300);
  assert.equal(dbm.get('SELECT COALESCE(SUM(amount),0) AS s FROM ledger').s, 0);
  assert.equal((await learner.c.post(`/api/bookings/${b.data.booking.id}/review`, { rating: 5, comment: 'Clear' })).status, 201);
  assert.equal((await learner.c.post(`/api/bookings/${b.data.booking.id}/review`, { rating: 5 })).status, 409);
});

test('declined and cancelled requests refund every credit', async () => {
  const { tutor, learner, offerId } = await setupBooking();
  const b1 = await learner.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 60 });
  assert.equal((await tutor.c.post(`/api/bookings/${b1.data.booking.id}/decline`, {})).status, 200);
  assert.equal((await learner.c.get('/api/wallet')).data.balance, 500);
  const b2 = await learner.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 90 });
  assert.equal((await learner.c.get('/api/wallet')).data.balance, 200);
  assert.equal((await learner.c.post(`/api/bookings/${b2.data.booking.id}/cancel`, {})).status, 200);
  assert.equal((await learner.c.get('/api/wallet')).data.balance, 500);
  assert.equal((await learner.c.post(`/api/bookings/${b2.data.booking.id}/cancel`, {})).status, 409, 'invalid transition refused');
  assert.equal(dbm.get('SELECT COALESCE(SUM(amount),0) AS s FROM ledger').s, 0);
});

test('cannot book without enough credits, cannot book yourself, cannot book the past', async () => {
  const { tutor, offerId } = await setupBooking();
  const broke = await signup('broke', uniA);
  assert.equal((await broke.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 60 })).status, 402);
  assert.equal((await tutor.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 60 })).status, 400);
  const rich = await signup('rich', uniA);
  await rich.c.post('/api/wallet/topup', { amount: 500 });
  assert.equal((await rich.c.post('/api/bookings', { offer_id: offerId, start_at: new Date(Date.now() - 3600000).toISOString(), duration_min: 60 })).status, 400);
});

test('another member cannot read or change someone else\'s booking', async () => {
  const { learner, offerId } = await setupBooking();
  const b = await learner.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 60 });
  const snoop = await signup('snoop', uniA);
  assert.equal((await snoop.c.get(`/api/bookings/${b.data.booking.id}`)).status, 404);
  assert.equal((await snoop.c.post(`/api/bookings/${b.data.booking.id}/cancel`, {})).status, 404);
  assert.equal((await snoop.c.post(`/api/bookings/${b.data.booking.id}/accept`, {})).status, 404);
  const wallet = await snoop.c.get('/api/wallet');
  assert.equal(wallet.data.balance, 0);
});

test('clients cannot edit balances: the ledger is append only and top-ups are capped', async () => {
  const u = await signup('ledger', uniA);
  await u.c.post('/api/wallet/topup', { amount: 500 });
  assert.throws(() => dbm.run('UPDATE ledger SET amount = 99999 WHERE account = ?', u.id), /append-only/);
  assert.throws(() => dbm.run('DELETE FROM ledger WHERE account = ?', u.id), /append-only/);
  assert.equal((await u.c.post('/api/wallet/topup', { amount: -500 })).status, 400);
  assert.equal((await u.c.post('/api/wallet/topup', { amount: 999999 })).status, 400);
  assert.equal((await u.c.post('/api/wallet/withdraw', { amount: 100000 })).status, 402);
});

test('disputes keep credits held until an administrator decides', async () => {
  const { tutor, learner, offerId } = await setupBooking();
  const b = await learner.c.post('/api/bookings', { offer_id: offerId, start_at: soon(), duration_min: 60 });
  await tutor.c.post(`/api/bookings/${b.data.booking.id}/accept`, {});
  dbm.run('UPDATE bookings SET start_at = ? WHERE id = ?', new Date(Date.now() - 3600000).toISOString(), b.data.booking.id);
  const d = await learner.c.post(`/api/bookings/${b.data.booking.id}/dispute`, { reason: 'The tutor never joined the call.' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.equal((await tutor.c.get('/api/wallet')).data.balance, 0);
  assert.equal((await learner.c.post(`/api/admin/bookings/${b.data.booking.id}/resolve`, { outcome: 'refund' })).status, 403);
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'Quartz-Lantern-Orbit-77' });
  assert.equal((await admin.post(`/api/admin/bookings/${b.data.booking.id}/resolve`, { outcome: 'refund' })).status, 200);
  assert.equal((await learner.c.get('/api/wallet')).data.balance, 500);
  assert.equal(dbm.get('SELECT COALESCE(SUM(amount),0) AS s FROM ledger').s, 0);
});

/* ---------- resources, teachers, radar ---------- */

async function makeTeacher(courseId = courseA) {
  const t = await signup('teacher', uniA, { role: 'teacher' });
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'Quartz-Lantern-Orbit-77' });
  await admin.patch(`/api/admin/users/${t.id}`, { verified: 1 });
  if (courseId) assert.equal((await admin.post('/api/admin/course-teachers', { course_id: courseId, user_id: t.id })).status, 200);
  return t;
}

test('resource review: students cannot approve, assigned teachers can, labels follow review state', async () => {
  const teacher = await makeTeacher();
  const author = await signup('author', uniA);
  const reader = await signup('reader', uniA);
  const r = await author.c.post('/api/resources', { course_id: courseA, topic_id: topicA, title: 'My notes on subset construction', kind: 'notes', body: 'Close, move, close.', permission: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.status, 'pending');
  assert.equal((await reader.c.get(`/api/resources/${r.data.id}`)).status, 404, 'pending is private to author and reviewers');
  assert.equal((await reader.c.post(`/api/resources/${r.data.id}/review`, { decision: 'verified' })).status, 403);
  assert.equal((await author.c.post(`/api/resources/${r.data.id}/review`, { decision: 'verified' })).status, 403, 'authors cannot approve their own');
  assert.equal((await teacher.c.get(`/api/resources/${r.data.id}`)).status, 200);
  assert.equal((await teacher.c.post(`/api/resources/${r.data.id}/review`, { decision: 'reject' })).status, 400, 'rejection needs a reason');
  assert.equal((await teacher.c.post(`/api/resources/${r.data.id}/review`, { decision: 'verified' })).status, 200);
  const seen = await reader.c.get(`/api/resources/${r.data.id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.data.resource.status, 'faculty_verified');
  const edit = await author.c.patch(`/api/resources/${r.data.id}`, { body: 'Close, move, close, repeat.' });
  assert.equal(edit.data.version, 2);
  assert.equal(edit.data.status, 'pending', 'edits go back to review');
  assert.equal((await reader.c.get(`/api/resources/${r.data.id}`)).status, 404);
  assert.equal((await author.c.get(`/api/resources/${r.data.id}`)).data.versions.length, 2);
});

test('teachers can only act on courses they are assigned to', async () => {
  dbm.run("INSERT INTO courses (university_id, code, name) VALUES (?, 'OTHER9', 'Unassigned course')", uniA);
  const other = dbm.get("SELECT id FROM courses WHERE code = 'OTHER9'").id;
  const teacher = await makeTeacher();
  const author = await signup('author2', uniA);
  const r = await author.c.post('/api/resources', { course_id: other, title: 'Notes on another course', kind: 'notes', body: 'hello there', permission: 1 });
  assert.equal((await teacher.c.post(`/api/resources/${r.data.id}/review`, { decision: 'verified' })).status, 403);
  assert.equal((await teacher.c.get(`/api/radar?course_id=${other}`)).status, 403);
  assert.equal((await teacher.c.post('/api/topics', { course_id: other, unit_no: 1, unit_name: 'Unit one', name: 'A topic' })).status, 403);
  const own = await teacher.c.post('/api/resources', { course_id: courseA, title: 'Official slides for unit one', kind: 'notes', body: 'slides text', permission: 1 });
  assert.equal(own.data.status, 'official');
  const stu = await author.c.post('/api/resources', { course_id: courseA, title: 'Student cannot publish official', kind: 'notes', body: 'x y z', permission: 1 });
  assert.equal(stu.data.status, 'pending');
});

test('difficulty radar hides small groups and is closed to students', async () => {
  const teacher = await makeTeacher();
  const students = [];
  for (let i = 0; i < 6; i++) students.push(await signup(`rad${i}`, uniA));
  assert.equal((await students[0].c.get(`/api/radar?course_id=${courseA}`)).status, 403);
  for (let i = 0; i < 3; i++) await students[i].c.post(`/api/topics/${topicA}/difficulty`, { status: 'needs_help' });
  const few = await teacher.c.get(`/api/radar?course_id=${courseA}`);
  assert.equal(few.status, 200);
  const t1 = few.data.topics.find((t) => t.id === topicA);
  assert.equal(t1.hidden, true);
  assert.equal(t1.needs_help, undefined, 'counts must not leak below the threshold');
  for (let i = 3; i < 6; i++) await students[i].c.post(`/api/topics/${topicA}/difficulty`, { status: i === 5 ? 'understood' : 'needs_practice' });
  const many = await teacher.c.get(`/api/radar?course_id=${courseA}`);
  const t2 = many.data.topics.find((t) => t.id === topicA);
  assert.equal(t2.hidden, false);
  assert.ok(t2.responses >= 5);
  assert.ok(!JSON.stringify(many.data).includes('user_id'), 'no individual identities');
  assert.equal((await students[0].c.post(`/api/topics/${topicA}/difficulty`, { status: 'bogus' })).status, 400);
});

/* ---------- practice checks and missions ---------- */

test('practice check is graded on the server and the answer key is never sent', async () => {
  const u = await signup('quiz', uniA);
  const q = await u.c.get(`/api/quiz/${topicA}`);
  assert.equal(q.status, 200);
  assert.doesNotMatch(JSON.stringify(q.data), /correct_index|explanation|because/);
  const [q1, q2] = q.data.questions;
  assert.equal((await u.c.post(`/api/quiz/${topicA}/attempt`, { answers: [{ question_id: q1.id, chosen: 1 }] })).status, 400, 'all questions required');
  assert.equal((await u.c.post(`/api/quiz/${topicA}/attempt`, { answers: [{ question_id: q1.id, chosen: 9 }, { question_id: q2.id, chosen: 0 }] })).status, 400);
  const first = await u.c.post(`/api/quiz/${topicA}/attempt`, { kind: 'baseline', answers: [{ question_id: q1.id, chosen: 0 }, { question_id: q2.id, chosen: 0 }] });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.score, 0);
  assert.equal(first.data.comparison.available, false);
  assert.equal(first.data.concepts[0].verdict, 'needs_practice');
  const second = await u.c.post(`/api/quiz/${topicA}/attempt`, { kind: 'followup', answers: [{ question_id: q1.id, chosen: 1 }, { question_id: q2.id, chosen: 2 }] });
  assert.equal(second.data.score, 2);
  assert.equal(second.data.comparison.available, true);
  assert.equal(second.data.comparison.previous.score, 0);
  assert.match(second.data.comparison.note, /does not prove/);
  const prog = await u.c.get('/api/progress');
  assert.equal(prog.data.topics[0].attempts.length, 2);
  assert.equal(prog.data.topics[0].comparison.available, true);
  dbm.run("INSERT INTO quiz_questions (topic_id, concept, prompt, options, correct_index, explanation) VALUES (?, 'New', 'Q3?', '[\"a\",\"b\"]', 0, 'x')", topicA);
  const third = await u.c.get(`/api/quiz/${topicA}`);
  const ans = third.data.questions.map((x) => ({ question_id: x.id, chosen: 0 }));
  const r3 = await u.c.post(`/api/quiz/${topicA}/attempt`, { answers: ans });
  assert.equal(r3.data.comparison.available, false, 'different question set is not comparable');
  dbm.run('DELETE FROM quiz_questions WHERE prompt = ?', 'Q3?');
});

test('missions use the learner\'s own results and save only after confirmation', async () => {
  const u = await signup('mission', uniA);
  const before = await u.c.post('/api/missions/preview', { topic_id: topicA });
  assert.match(before.data.basis, /not taken a practice check/);
  assert.equal((await u.c.get('/api/missions')).data.missions.length, 0, 'preview saves nothing');
  const q = (await u.c.get(`/api/quiz/${topicA}`)).data.questions;
  await u.c.post(`/api/quiz/${topicA}/attempt`, { answers: q.map((x) => ({ question_id: x.id, chosen: 0 })) });
  const after = await u.c.post('/api/missions/preview', { topic_id: topicA, goal: 'Exam next week' });
  assert.match(after.data.basis, /Closure/);
  assert.match(after.data.engine, /No AI model/);
  const saved = await u.c.post('/api/missions', { topic_id: topicA, goal: 'Exam next week', skip: [1] });
  assert.equal(saved.status, 201);
  const list = (await u.c.get('/api/missions')).data.missions;
  assert.equal(list.length, 1);
  assert.equal(list[0].steps.length, after.data.steps.length - 1);
  const step = list[0].steps[0];
  assert.equal((await u.c.post(`/api/missions/${list[0].id}/steps/${step.id}/toggle`)).data.done, true);
  const other = await signup('mission2', uniA);
  assert.equal((await other.c.post(`/api/missions/${list[0].id}/steps/${step.id}/toggle`)).status, 404);
});

test('handover collections need teacher approval before others see them', async () => {
  const teacher = await makeTeacher();
  const senior = await signup('senior', uniA);
  const junior = await signup('junior', uniA);
  const body = 'Revise automata first, then regular languages, doing two past questions each day and explaining answers aloud.';
  assert.equal((await senior.c.post('/api/handovers', { course_id: courseA, title: 'How I revised', body, show_author: 0, permission: 0 })).status, 400);
  const h = await senior.c.post('/api/handovers', { course_id: courseA, title: 'How I revised', body, show_author: 0, permission: 1 });
  assert.equal(h.status, 201);
  assert.equal((await junior.c.get('/api/handovers')).data.handovers.find((x) => x.id === h.data.id), undefined);
  assert.equal((await junior.c.post(`/api/handovers/${h.data.id}/review`, { decision: 'approve' })).status, 403);
  assert.equal((await teacher.c.post(`/api/handovers/${h.data.id}/review`, { decision: 'approve' })).status, 200);
  const seen = (await junior.c.get('/api/handovers')).data.handovers.find((x) => x.id === h.data.id);
  assert.ok(seen);
  assert.doesNotMatch(seen.author, /Test senior/, 'anonymous authors stay anonymous');
  assert.doesNotMatch(JSON.stringify(seen), new RegExp(senior.email.split('@')[0]));
});

test('account deletion anonymises the profile and ends sessions', async () => {
  const u = await signup('gone', uniA);
  assert.equal((await u.c.post('/api/me/delete', { password: 'Wrong-Password-9' })).status, 403);
  assert.equal((await u.c.post('/api/me/delete', { password: PW })).status, 200);
  assert.equal((await u.c.get('/api/offers')).status, 401);
  const row = dbm.get('SELECT name, email, status FROM users WHERE id = ?', u.id);
  assert.equal(row.name, 'Deleted user');
  assert.match(row.email, /invalid\.local/);
});

/* ---------- separate pages and separate portals ---------- */

const pageOf = (path, cookie) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });

test('How it works, Campuses, Credits, Sign in, Terms and Privacy are each their own page', async () => {
  const seen = new Set();
  for (const p of ['/', '/how-it-works', '/campuses', '/credits', '/login', '/terms', '/privacy']) {
    const res = await pageOf(p);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    seen.add(html.match(/<title>(.*?)<\/title>/)[1]);
    for (const link of ['/how-it-works', '/campuses', '/credits', '/login']) assert.ok(html.includes(`href="${link}"`), `${p} links to ${link}`);
  }
  assert.equal(seen.size, 7, 'every page has its own title');
  const home = await (await pageOf('/')).text();
  assert.ok(!home.includes('id="money"') && !home.includes('id="how"'), 'the home page no longer holds the other pages');
});

test('students and teachers land on different pages and cannot open each other\'s', async () => {
  const s = await signup('portal-s', uniA);
  const t = await signup('portal-t', uniA, { role: 'teacher' });
  const wrong = (await pageOf('/student', t.c.cookie));
  assert.equal(wrong.status, 302);
  assert.equal(wrong.headers.get('location'), '/teacher');
  assert.equal((await pageOf('/teacher', s.c.cookie)).headers.get('location'), '/student');
  assert.equal((await pageOf('/app', s.c.cookie)).headers.get('location'), '/student');
  assert.equal((await pageOf('/app', t.c.cookie)).headers.get('location'), '/teacher');
  const sp = await pageOf('/student', s.c.cookie);
  const tp = await pageOf('/teacher', t.c.cookie);
  assert.equal(sp.status, 200);
  assert.equal(tp.status, 200);
  assert.match(await sp.text(), /data-portal="student"/);
  assert.match(await tp.text(), /data-portal="teacher"/);
  const out = await pageOf('/teacher');
  assert.equal(out.status, 302);
  assert.match(out.headers.get('location'), /^\/login\?as=teacher/);
  /* administrators are sent to the console, and may open the teacher workspace for review tools */
  const admin = new Client();
  await admin.post('/api/auth/login', { email: 'admin@example.test', password: 'Quartz-Lantern-Orbit-77' });
  assert.equal((await pageOf('/app', admin.cookie)).headers.get('location'), '/admin');
  assert.equal((await pageOf('/teacher', admin.cookie)).status, 200);
});

test('sign in as student or teacher checks the account type and gives no session on a mismatch', async () => {
  const s = await signup('door-s', uniA);
  const t = await signup('door-t', uniA, { role: 'teacher' });
  const c = new Client();
  const bad = await c.post('/api/auth/login', { email: t.email, password: PW, portal: 'student' });
  assert.equal(bad.status, 403);
  assert.match(bad.data.error, /teacher account/);
  assert.equal(bad.headers.get('set-cookie'), null);
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  const bad2 = await c.post('/api/auth/login', { email: s.email, password: PW, portal: 'teacher' });
  assert.equal(bad2.status, 403);
  assert.match(bad2.data.error, /student account/);
  const ok = await c.post('/api/auth/login', { email: t.email, password: PW, portal: 'teacher' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'teacher');
  const wrongPw = await new Client().post('/api/auth/login', { email: t.email, password: 'Wrong-Password-1', portal: 'student' });
  assert.equal(wrongPw.status, 401, 'a wrong password never reveals which door the account uses');
});

test('a course is typed: an existing course is matched, a new one is created once', async () => {
  const s = await signup('typed', uniA);
  const body = { headline: 'Automata made simple', price_per_hour: 50, mode: 'online', mastery: 'strong' };
  const none = await s.c.post('/api/offers', body);
  assert.equal(none.status, 400);
  assert.ok(none.data.fields.course_name);
  const a = await s.c.post('/api/offers', { ...body, course_name: 'theory of computation' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  assert.equal(a.data.offer.course.id, courseA, 'typing the name in any case finds the existing course');
  const t2 = await signup('typed2', uniA);
  const byCode = await t2.c.post('/api/offers', { ...body, course_name: 'toc101' });
  assert.equal(byCode.data.offer.course.id, courseA, 'typing the code also finds it');
  const before = dbm.get('SELECT COUNT(*) AS n FROM courses WHERE university_id = ?', uniA).n;
  const fresh = await s.c.post('/api/offers', { ...body, course_name: 'Machine Learning', course_code: 'cs401' });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
  assert.equal(fresh.data.offer.course.name, 'Machine Learning');
  assert.equal(fresh.data.offer.course.code, 'CS401');
  const t3 = await signup('typed3', uniA);
  const again = await t3.c.post('/api/offers', { ...body, course_name: 'Machine learning' });
  assert.equal(again.data.offer.course.id, fresh.data.offer.course.id, 'the same typed course is not duplicated');
  assert.equal(dbm.get('SELECT COUNT(*) AS n FROM courses WHERE university_id = ?', uniA).n, before + 1);
  const search = await t3.c.get('/api/offers?q=machine');
  assert.ok(search.data.offers.some((o) => o.course.name === 'Machine Learning'), 'typing the course name finds the listing');
  /* a course typed at one university never appears at another */
  const other = await signup('typed-other', uniB);
  assert.equal((await other.c.get('/api/offers?q=machine')).data.offers.length, 0);
  const bogus = await s.c.post('/api/offers', { ...body, course_name: 'Course Z', course_code: '<b>x</b>' });
  assert.equal(bogus.status, 400);
});

test('students and teachers can both post events with a place, and the feed shows them', async () => {
  const s = await signup('event-s', uniA);
  const t = await signup('event-t', uniA, { role: 'teacher' });
  const when = new Date(Date.now() + 86400000 * 3).toISOString();
  const a = await s.c.post('/api/posts', { kind: 'event', title: 'Open mic night', event_at: when, venue: 'Seminar Hall 2', body: 'Bring a friend.' });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const b = await t.c.post('/api/posts', { kind: 'event', title: 'Guest lecture on compilers', event_at: when, venue: 'Block C, Room 14' });
  assert.equal(b.status, 201, JSON.stringify(b.data));
  const feed = (await s.c.get('/api/posts?kind=event')).data.posts;
  const mic = feed.find((p) => p.title === 'Open mic night');
  const lec = feed.find((p) => p.title === 'Guest lecture on compilers');
  assert.equal(mic.venue, 'Seminar Hall 2');
  assert.equal(lec.author.role, 'teacher');
  assert.equal((await s.c.post('/api/posts', { kind: 'event', title: 'No date given here' })).status, 400);
  assert.equal((await t.c.post('/api/posts', { kind: 'announcement', title: 'Unverified notice' })).status, 403);
  const other = await signup('event-other', uniB);
  assert.equal((await other.c.get('/api/posts?kind=event')).data.posts.length, 0, 'events stay inside their university');
});

test('API security: hostile Origin, missing CSRF header, oversized body, and invalid content-type are rejected', async () => {
  const u = await signup('sec-parity', uniA);
  
  const hostileRes = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'sos', 'Content-Type': 'application/json', Origin: 'https://evil-attacker.site', Cookie: u.c.cookie },
    body: JSON.stringify({ title: 'Hostile' })
  });
  assert.equal(hostileRes.status, 403);

  const noCsrfRes = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: u.c.cookie },
    body: JSON.stringify({ title: 'No CSRF' })
  });
  assert.equal(noCsrfRes.status, 403);

  const badCtRes = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'sos', 'Content-Type': 'text/plain', Cookie: u.c.cookie },
    body: 'hello'
  });
  assert.equal(badCtRes.status, 415);

  const badJsonRes = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'sos', 'Content-Type': 'application/json', Cookie: u.c.cookie },
    body: '{not valid json'
  });
  assert.equal(badJsonRes.status, 400);

  const bigBody = JSON.stringify({ title: 'Big', data: 'A'.repeat(70 * 1024) });
  const bigRes = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'sos', 'Content-Type': 'application/json', Cookie: u.c.cookie },
    body: bigBody
  });
  assert.equal(bigRes.status, 413);
});

test('peer tutor can register with tutor distinction and log in through teacher/tutor entrance', async () => {
  const c = new Client();
  const e = email('peertutor');
  const reg = await c.post('/api/auth/register', {
    name: 'Peer Tutor Alex',
    email: e,
    password: PW,
    university_id: uniA,
    role: 'teacher',
    tutor_type: 'peer_tutor',
    phone: '+91 9998887776',
    department: 'Computer Science',
    student_id: '1RUA24CS009'
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.tutor_type, 'peer_tutor');
  assert.equal(reg.data.user.phone, '+91 9998887776');
  assert.equal(reg.data.user.student_id, '1RUA24CS009');
  
  await c.post('/api/auth/logout');
  const login = await c.post('/api/auth/login', { email: e, password: PW, portal: 'teacher' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.tutor_type, 'peer_tutor');
});

test('auto settlement: expired bookings refund, 72h accepted bookings release, repeated runs are idempotent, dispute stays on hold', async () => {
  const learner = await signup('settle-l', uniA);
  const tutor = await signup('settle-t', uniA);
  await learner.c.post('/api/wallet/topup', { amount: 500 });

  const off = await tutor.c.post('/api/offers', {
    course_name: 'Theory of Computation',
    headline: 'TOC problem solving',
    price_per_hour: 100,
    mode: 'online',
    mastery: 'strong'
  });

  const futureTime = new Date(Date.now() + 3600000 * 2).toISOString();

  // 1. Expired requested booking: created in future, then moved to past
  const bExpired = await learner.c.post('/api/bookings', {
    offer_id: off.data.offer.id,
    start_at: futureTime,
    duration_min: 60
  });
  assert.equal(bExpired.status, 201);
  dbm.run('UPDATE bookings SET start_at = ? WHERE id = ?', new Date(Date.now() - 3600000).toISOString(), bExpired.data.booking.id);

  // 2. Due accepted booking: finished >72 hours ago
  const bDue = await learner.c.post('/api/bookings', {
    offer_id: off.data.offer.id,
    start_at: futureTime,
    duration_min: 60
  });
  assert.equal(bDue.status, 201);
  await tutor.c.post(`/api/bookings/${bDue.data.booking.id}/accept`);
  dbm.run('UPDATE bookings SET start_at = ? WHERE id = ?', new Date(Date.now() - 80 * 3600000).toISOString(), bDue.data.booking.id);

  // 3. Disputed booking finished >72 hours ago: must NOT be settled
  const bDisputed = await learner.c.post('/api/bookings', {
    offer_id: off.data.offer.id,
    start_at: futureTime,
    duration_min: 60
  });
  assert.equal(bDisputed.status, 201);
  await tutor.c.post(`/api/bookings/${bDisputed.data.booking.id}/accept`);
  dbm.run('UPDATE bookings SET start_at = ? WHERE id = ?', new Date(Date.now() - 80 * 3600000).toISOString(), bDisputed.data.booking.id);
  const dispRes = await learner.c.post(`/api/bookings/${bDisputed.data.booking.id}/dispute`, { reason: 'Tutor never showed up for session' });
  assert.equal(dispRes.status, 200, JSON.stringify(dispRes.data));

  const { autoSettle } = await import('../server/routes/tutoring.js');
  const res1 = autoSettle();
  assert.ok(res1.expired >= 1, 'stale booking was expired and refunded');
  assert.ok(res1.released >= 1, 'due accepted booking was auto-released');

  // Verify disputed booking was NOT touched
  const dispRow = dbm.get('SELECT status FROM bookings WHERE id = ?', bDisputed.data.booking.id);
  assert.equal(dispRow.status, 'disputed', 'disputed session stays on hold');

  // Idempotency: run autoSettle again; should do 0 double releases/refunds
  const res2 = autoSettle();
  assert.equal(res2.expired, 0, 'second run must not expire anything new');
  assert.equal(res2.released, 0, 'second run must not release anything new');

  // Verify ledger is balanced
  const { ledgerIsBalanced } = await import('../server/money.js');
  assert.ok(ledgerIsBalanced(), 'ledger remains 100% balanced after settlement runs');

  // Test /api/admin/settle trigger with secret header
  const triggerRes = await fetch(`${base}/api/admin/settle`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'sos', 'X-Settlement-Key': process.env.APP_SECRET }
  });
  assert.equal(triggerRes.status, 200);
});
