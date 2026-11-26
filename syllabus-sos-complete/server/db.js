import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(config.dbPath);
try {
  fs.chmodSync(config.dbPath, 0o600);
} catch {
  /* not fatal on filesystems without chmod */
}

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA trusted_schema = OFF');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

db.exec(`
CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'India',
  address TEXT NOT NULL DEFAULT '',
  college_code TEXT NOT NULL DEFAULT '',
  email_domain TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','rejected','internal')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','teacher','admin')),
  university_id INTEGER NOT NULL REFERENCES universities(id),
  college_name TEXT NOT NULL DEFAULT '',
  college_place TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  degree TEXT NOT NULL DEFAULT '',
  year_of_study INTEGER,
  semester INTEGER,
  student_id TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  faculty_id TEXT NOT NULL DEFAULT '',
  cabin TEXT NOT NULL DEFAULT '',
  tutor_type TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  domain_match INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_uni ON users(university_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT ${NOW},
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (university_id, code)
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  headline TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_per_hour INTEGER NOT NULL CHECK (price_per_hour BETWEEN 0 AND 5000),
  mode TEXT NOT NULL CHECK (mode IN ('online','in_person','chat')),
  availability TEXT NOT NULL DEFAULT '',
  mastery TEXT NOT NULL DEFAULT 'strong' CHECK (mastery IN ('complete','strong')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','removed')),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (user_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_uni ON offers(university_id, status);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  offer_id INTEGER NOT NULL REFERENCES offers(id),
  university_id INTEGER NOT NULL REFERENCES universities(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  learner_id INTEGER NOT NULL REFERENCES users(id),
  tutor_id INTEGER NOT NULL REFERENCES users(id),
  start_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 30 AND 240),
  mode TEXT NOT NULL CHECK (mode IN ('online','in_person','chat')),
  price_total INTEGER NOT NULL CHECK (price_total >= 0),
  fee INTEGER NOT NULL CHECK (fee >= 0),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','accepted','declined','cancelled','completed','disputed','resolved_refund','resolved_release')),
  message TEXT NOT NULL DEFAULT '',
  meeting_url TEXT,
  location TEXT NOT NULL DEFAULT '',
  dispute_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  CHECK (learner_id <> tutor_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_learner ON bookings(learner_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tutor ON bookings(tutor_id);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  txn_id TEXT NOT NULL,
  account INTEGER NOT NULL,
  booking_id INTEGER REFERENCES bookings(id),
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account);
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  tutor_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_pair ON friendships(min(requester_id, addressee_id), max(requester_id, addressee_id));

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_recipient ON messages(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS idx_msg_pair ON messages(sender_id, recipient_id);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('event','hackathon','discussion','opportunity','announcement')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  event_at TEXT,
  venue TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','removed')),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_posts_uni ON posts(university_id, status, id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('user','post','offer','comment','resource','handover')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS course_teachers (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL CHECK (unit_no BETWEEN 1 AND 20),
  unit_name TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (course_id, unit_no, name)
);
CREATE INDEX IF NOT EXISTS idx_topics_course ON topics(course_id);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('notes','worked_example','practice','past_paper','revision','link','explanation')),
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','community','faculty_verified','official','rejected','removed')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_resources_course ON resources(university_id, course_id, status);

CREATE TABLE IF NOT EXISTS resource_versions (
  id INTEGER PRIMARY KEY,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (resource_id, version)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (user_id, resource_id)
);

CREATE TABLE IF NOT EXISTS difficulty_reports (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('understood','needs_practice','needs_help','not_studied')),
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  concept TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('baseline','followup','practice')),
  booking_id INTEGER REFERENCES bookings(id),
  question_ids TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id, topic_id);

CREATE TABLE IF NOT EXISTS quiz_answers (
  attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  chosen INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS missions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  goal TEXT NOT NULL DEFAULT '',
  exam_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','dropped')),
  basis TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS mission_steps (
  id INTEGER PRIMARY KEY,
  mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('read','example','quiz','tutor','followup','review')),
  title TEXT NOT NULL,
  ref_id INTEGER,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS handovers (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  show_author INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','removed')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_uni ON uploaded_files(university_id);

CREATE TABLE IF NOT EXISTS folder_files (
  id INTEGER PRIMARY KEY,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  uploader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_folder_files_course ON folder_files(university_id, course_id);

CREATE TABLE IF NOT EXISTS practice_tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  course_code TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON practice_tasks(user_id, done);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'exam' CHECK (category IN ('exam','event','assignment','study','personal')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_cal_user ON calendar_events(user_id, event_date);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
`);

/* Small migrations for databases created by an earlier version. */
if (!db.prepare('PRAGMA table_info(posts)').all().some((c) => c.name === 'venue')) {
  db.exec("ALTER TABLE posts ADD COLUMN venue TEXT NOT NULL DEFAULT ''");
}
for (const col of [
  'ALTER TABLE universities ADD COLUMN state TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE universities ADD COLUMN country TEXT NOT NULL DEFAULT "India"',
  'ALTER TABLE universities ADD COLUMN address TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE universities ADD COLUMN college_code TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN college_name TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN college_place TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN degree TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN semester INTEGER',
  'ALTER TABLE users ADD COLUMN student_id TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN designation TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN faculty_id TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN cabin TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN tutor_type TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE users ADD COLUMN academic_background TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE courses ADD COLUMN background TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE offers ADD COLUMN syllabus_topics TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE offers ADD COLUMN syllabus_subtopics TEXT NOT NULL DEFAULT ""',
  'ALTER TABLE resources ADD COLUMN file_id INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL',
  'ALTER TABLE handovers ADD COLUMN file_id INTEGER REFERENCES uploaded_files(id) ON DELETE SET NULL',
]) {
  try { db.exec(col); } catch { /* ignore if column already exists */ }
}

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

const norm = (params) => params.map((p) => (p === undefined ? null : p));

export const get = (sql, ...params) => stmt(sql).get(...norm(params));
export const all = (sql, ...params) => stmt(sql).all(...norm(params));
export const run = (sql, ...params) => stmt(sql).run(...norm(params));

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

export function audit(actorId, action, detail = '', ip = null) {
  run('INSERT INTO audit_log (actor_id, action, detail, ip) VALUES (?, ?, ?, ?)', actorId ?? null, action, String(detail).slice(0, 500), ip);
}

export const nowIso = () => new Date().toISOString();
