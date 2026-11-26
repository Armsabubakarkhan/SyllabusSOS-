import crypto from 'node:crypto';
import { config, result } from './config.js';
import { get, run } from './db.js';
import { hashPassword } from './security.js';
import { createAdmin } from './routes/auth.js';
import { ensureAllBackgroundsForUniversity } from './catalog.js';

if (result.problems.length) {
  for (const p of result.problems) console.error(`Config problem: ${p}`);
  process.exit(1);
}

/* Sample campuses are fictional and flagged is_demo. Their sample people have
   unusable random passwords, so nobody can sign in as them. */

const CAMPUSES = [
  {
    slug: 'meridian-institute',
    name: 'Meridian Institute of Technology',
    city: 'Bengaluru',
    domain: 'meridian.example',
    demo: 1,
    people: [
      { name: 'Ananya Rao', role: 'student', bg: 'Engineering', degree: 'B.Tech / B.E.', dept: 'Computer Science & Engineering', year: 4, sem: 7, sid: 'MIT22CS014', bio: 'Final-year CSE student helping juniors with Automata, NLP and Algorithms.' },
      { name: 'Rohan Iyer', role: 'student', bg: 'Engineering', degree: 'B.Tech / B.E.', dept: 'Computer Science & Engineering', year: 3, sem: 5, sid: 'MIT23CS042', bio: 'Peer tutor for Data Structures and Engineering Maths.' },
      { name: 'Dr. Meera Nair', role: 'teacher', bg: 'Engineering', dept: 'Computer Science & Engineering', desig: 'Associate Professor', fid: 'FAC-MIT-108', cabin: 'Block B, Room 204', bio: 'Faculty advisor for Theory of Computation and Formal Languages.' },
      { name: 'Karthik Menon', role: 'student', bg: 'Engineering', degree: 'B.Tech / B.E.', dept: 'Electronics & Communication', year: 4, sem: 8, sid: 'MIT22EC019', bio: 'DSP and Embedded Systems peer mentor.' },
      { name: 'Dr. Kavya Sharma', role: 'teacher', bg: 'Medical', dept: 'Medical Sciences', desig: 'Professor', fid: 'FAC-MIT-215', cabin: 'Med Block, Room 112', bio: 'Teaching Human Anatomy and Clinical Physiology.' },
      { name: 'Aarav Deshmukh', role: 'student', bg: 'Medical', degree: 'B.Sc', dept: 'Medical Sciences', year: 3, sem: 6, sid: 'MIT23MD007', bio: 'Medical peer tutor covering Brachial Plexus, ECG and Pharmacology.' },
      { name: 'Neha Verma', role: 'student', bg: 'Law', degree: 'Other', dept: 'School of Law', year: 4, sem: 7, sid: 'MIT22LW011', bio: 'Moot court finalist tutoring Constitutional Law and Contracts.' },
      { name: 'Vikram Aditya', role: 'student', bg: 'Finance', degree: 'BBA', dept: 'Finance & Accounting', year: 3, sem: 5, sid: 'MIT23FN031', bio: 'Corporate Finance, Valuation and Derivatives peer mentor.' },
      { name: 'Divya Shetty', role: 'student', bg: 'Science', degree: 'B.Sc', dept: 'Physics', year: 3, sem: 5, sid: 'MIT23SC022', bio: 'Quantum mechanics and problem-solving study partner.' },
      { name: 'Farhan Qureshi', role: 'student', bg: 'Engineering', degree: 'B.Tech / B.E.', dept: 'Computer Science & Engineering', year: 3, sem: 5, sid: 'MIT23CS055', bio: 'Working through Operating Systems and Databases.' },
      { name: 'Lakshmi Pillai', role: 'student', bg: 'Management', degree: 'MBA', dept: 'Business Management', year: 2, sem: 3, sid: 'MIT24MB018', bio: 'Strategy and Operations case prep.' },
      { name: 'Sanjay Kulkarni', role: 'student', bg: 'Engineering', degree: 'B.Tech / B.E.', dept: 'Computer Science & Engineering', year: 3, sem: 5, sid: 'MIT23CS061', bio: '' },
      { name: 'Tanvi Joshi', role: 'student', bg: 'Arts & Humanities', degree: 'Other', dept: 'Humanities', year: 2, sem: 4, sid: 'MIT24HM009', bio: 'Logic, critical reasoning and ethics peer tutor.' },
    ],
    offers: [
      { who: 0, code: 'CS301', headline: 'NFA to DFA, pumping lemma and Turing machines, taught by solving past papers', description: 'Weekly problem sets, exam question patterns, and a short check at the end of each session.', topics: 'Finite Automata, Regular Languages, Turing Machines', subtopics: 'DFA tracing, NFA to DFA subset construction, Epsilon closure, Pumping lemma proofs, Decidability', price: 150, mode: 'online', mastery: 'complete', availability: 'Weekday evenings after 6 pm' },
      { who: 1, code: 'CS201', headline: 'Trees, graphs and complexity with worked examples', description: 'Bring any practice sheet. We solve it together on a shared screen.', topics: 'Linear Structures, Trees & Graphs, Algorithm Design', subtopics: 'Linked lists, Stacks & queues, BFS & DFS, Binary search trees, Dynamic programming', price: 100, mode: 'online', mastery: 'complete', availability: 'Tuesday and Thursday evenings' },
      { who: 2, code: 'CS301', headline: 'One on one doubt sessions for Theory of Computation', description: 'Small group or single learner. Bring the unit you find hardest.', topics: 'Automata Theory, Context-Free Grammars, Computability', subtopics: 'DFA minimization, CFG derivations, Pushdown automata, Halting problem', price: 350, mode: 'in_person', mastery: 'complete', availability: 'Office hours, by appointment' },
      { who: 3, code: 'EC305', headline: 'Signals, Z transforms and filters without the panic', description: 'Step by step derivations and solved numericals from the last five years of papers.', topics: 'Discrete Signals, Spectral Analysis', subtopics: 'Z-transforms, Region of convergence, Pole-zero stability, Radix-2 FFT', price: 120, mode: 'chat', mastery: 'strong', availability: 'Any evening, replies within a day' },
      { who: 1, code: 'MA201', headline: 'Laplace and Fourier transforms, solved in the exam format', description: 'Practice first, theory only when you need it.', topics: 'Transforms, Fourier Series', subtopics: 'Laplace inverse transforms, Differential equations, Half-range Fourier expansions', price: 0, mode: 'online', mastery: 'strong', availability: 'Sunday mornings, free for juniors' },
      { who: 5, code: 'MED101', headline: 'Human Anatomy diagrams, Brachial Plexus & Neuroanatomy', description: 'Visual memory tricks and clinical lesion cases for anatomy exams.', topics: 'Musculoskeletal, Thorax, Neuroanatomy', subtopics: 'Brachial plexus roots and cords, Heart valves & coronary supply, Cranial nerve pathways', price: 0, mode: 'online', mastery: 'complete', availability: 'Mon, Wed, Fri evenings' },
      { who: 4, code: 'MED102', headline: 'Cardiovascular & Renal Physiology concept clinic', description: 'Clear walkthrough of pressure-volume loops, ECG and acid-base balance.', topics: 'Cardiovascular Physiology, Renal Physiology', subtopics: 'Cardiac cycle, ECG waves, GFR calculation, Metabolic vs respiratory acidosis', price: 0, mode: 'in_person', mastery: 'complete', availability: 'Faculty office hours' },
      { who: 6, code: 'LAW101', headline: 'Constitutional Law & Landmark Case Briefs', description: 'Learn how to structure IRAC answers for fundamental rights and writs.', topics: 'Rights & Writs, Federalism', subtopics: 'Article 14 equality test, Article 21 due process, Writ petitions, Basic structure doctrine', price: 0, mode: 'online', mastery: 'complete', availability: 'Weekends and Thursday evenings' },
      { who: 6, code: 'LAW105', headline: 'Law of Contracts: Offer, Acceptance & Remedies', description: 'Case-driven prep with contract drafting and breach damages examples.', topics: 'Contract Formation, Remedies', subtopics: 'Invitation to treat, Consideration, Hadley v Baxendale damages, Specific relief', price: 0, mode: 'chat', mastery: 'strong', availability: 'Evenings' },
      { who: 7, code: 'FIN201', headline: 'Corporate Finance: NPV, IRR, WACC and CAPM', description: 'Spreadsheet-based walkthroughs of valuation and capital budgeting.', topics: 'Valuation, Capital Structure', subtopics: 'Time value of money, Discounted cash flow, WACC calculation, CAPM beta', price: 0, mode: 'online', mastery: 'complete', availability: 'Saturday & Sunday afternoons' },
      { who: 7, code: 'FIN101', headline: 'Financial Accounting three-statement modeling & ratios', description: 'Reconcile balance sheets, income statements and cash flows cleanly.', topics: 'Financial Statements, Ratio Analysis', subtopics: 'Accrual vs cash flow, Working capital, Liquidity & ROE ratios', price: 0, mode: 'online', mastery: 'strong', availability: 'Weekday evenings' },
    ],
    posts: [
      ['hackathon', 'Inter-department hackathon planning meeting (sample post)', 'Sample content. Teams of up to four, 24 hours, problem statements from campus clubs.', 12],
      ['discussion', 'Best way to revise Theory of Computation in one week? (sample post)', 'Sample content. Share what worked for you.', null],
      ['event', 'Seniors to juniors handover talk for all streams (sample post)', 'Sample content. Seniors across Engineering, Medical, Law and Finance share notes and lessons.', 20],
    ],
  },
  {
    slug: 'cauvery-state-university',
    name: 'Cauvery State University',
    city: 'Mysuru',
    domain: 'cauvery.example',
    demo: 1,
    people: [
      { name: 'Sneha Gowda', role: 'student', bg: 'Engineering', degree: 'B.Tech / B.E.', dept: 'Mechanical Engineering', year: 3, sem: 6, sid: 'CSU23ME012', bio: 'Thermodynamics and CAD peer mentor.' },
      { name: 'Imran Pasha', role: 'student', bg: 'Finance', degree: 'B.Com', dept: 'Economics & Finance', year: 4, sem: 7, sid: 'CSU22EC008', bio: 'Microeconomics and Corporate Finance tutor.' },
    ],
    offers: [
      { who: 0, code: 'CS201', headline: 'Data Structures & Problem Solving fundamentals', description: 'Step by step coding and dry runs.', topics: 'Linear Structures, Trees & Graphs', subtopics: 'Arrays, Linked lists, Stacks, BFS and DFS', price: 0, mode: 'online', mastery: 'strong', availability: 'Weekday evenings' },
      { who: 1, code: 'FIN101', headline: 'Accounting statements and financial ratios', description: 'Graph drawing practice and numericals.', topics: 'Statements, Analysis', subtopics: 'Balance sheet, Cash flow statement, Working capital ratios', price: 0, mode: 'in_person', mastery: 'strong', availability: 'Library discussion room, afternoons' },
    ],
    posts: [
      ['opportunity', 'Peer mentor applications open this semester (sample post)', 'Sample content. Apply through your department office.', null],
    ],
  },
  { slug: 'rv-university', name: 'RV University', city: 'Bengaluru', domain: null, demo: 0, people: [], offers: [], posts: [] },
];

const QUIZ = {
  'NFA to DFA conversion': [
    ['Subset construction', 'In the subset construction, what does each state of the resulting DFA represent?', ['One state of the NFA', 'A set of NFA states', 'An input symbol', 'A transition label'], 1, 'Each DFA state stands for the set of NFA states the NFA could be in at that point.'],
    ['Subset construction', 'An NFA has n states. What is the largest number of states the equivalent DFA can need?', ['n', '2n', '2 to the power n', 'n squared'], 2, 'There are 2 to the power n subsets of n states, so the DFA may need that many.'],
    ['Epsilon closure', 'What does the epsilon closure of an NFA state contain?', ['Only the state itself', 'Every state reachable using only epsilon moves, including itself', 'All accepting states', 'Every state in the NFA'], 1, 'The closure is the state plus everything reachable by epsilon transitions alone.'],
    ['Epsilon closure', 'When is a DFA state accepting after the subset construction?', ['When it contains the NFA start state', 'When it contains at least one NFA accepting state', 'When it contains every NFA state', 'When it has no outgoing transitions'], 1, 'A DFA state accepts if its set contains any accepting NFA state.'],
  ],
  'Nondeterministic finite automata (NFA)': [
    ['NFA behaviour', 'How does an NFA differ from a DFA?', ['It has no start state', 'It may have several transitions on the same symbol from one state', 'It cannot accept any strings', 'It always has fewer states'], 1, 'An NFA can branch: several moves, or none, on the same symbol.'],
    ['NFA behaviour', 'When does an NFA accept a string?', ['If every path ends in an accepting state', 'If at least one path ends in an accepting state', 'If it uses epsilon moves', 'If it ends in the start state'], 1, 'One accepting path is enough.'],
  ],
  'Upper Limb & Brachial Plexus': [
    ['Roots & Trunks', 'Which spinal nerve roots form the brachial plexus?', ['C1 to C4', 'C5 to T1', 'T1 to T5', 'L1 to L4'], 1, 'The brachial plexus arises from the anterior rami of C5, C6, C7, C8 and T1.'],
    ['Nerve Lesions', 'Injury to the long thoracic nerve causes paralysis of which muscle?', ['Deltoid', 'Serratus anterior', 'Biceps brachii', 'Triceps brachii'], 1, 'Long thoracic nerve supplies serratus anterior; injury causes winged scapula.'],
  ],
  'Offer, Acceptance & Consideration': [
    ['Contract Formation', 'A price tag on an item in a shop window is generally treated as:', ['A binding offer', 'An invitation to treat', 'An executed contract', 'A counter-offer'], 1, 'Display of goods with prices is normally an invitation to treat, not a firm offer.'],
    ['Consideration', 'Which statement best describes consideration in contract law?', ['It must always equal market value', 'Something of legal value exchanged between parties', 'Only written promises need it', 'It applies only to employment contracts'], 1, 'Consideration must be sufficient (have legal value), though courts do not judge adequacy.'],
  ],
  'Time Value of Money, NPV & IRR': [
    ['Discounted Cash Flow', 'A project should generally be accepted under the NPV rule when:', ['NPV is negative', 'NPV is greater than zero', 'IRR is zero', 'Payback exceeds 10 years'], 1, 'Positive NPV means expected discounted cash inflows exceed the initial investment.'],
    ['Discount Rate', 'Holding cash flows constant, if the discount rate increases, the NPV will:', ['Increase', 'Decrease', 'Stay unchanged', 'Double'], 1, 'Higher discount rates reduce the present value of future cash flows.'],
  ],
};

const unusable = await hashPassword(crypto.randomBytes(32).toString('hex'));
let created = 0;

for (const c of CAMPUSES) {
  let uni = get('SELECT id FROM universities WHERE slug = ?', c.slug);
  if (!uni) {
    run("INSERT INTO universities (slug, name, city, email_domain, status, is_demo) VALUES (?, ?, ?, ?, 'approved', ?)", c.slug, c.name, c.city, c.domain, c.demo);
    uni = get('SELECT id FROM universities WHERE slug = ?', c.slug);
    created++;
  }

  ensureAllBackgroundsForUniversity(uni.id);

  const courseRows = {};
  for (const row of ['CS201', 'CS301', 'CS304', 'MA201', 'EC305', 'MED101', 'MED102', 'MED201', 'LAW101', 'LAW105', 'LAW202', 'FIN101', 'FIN201', 'FIN302']) {
    const found = get('SELECT id FROM courses WHERE university_id = ? AND code = ?', uni.id, row);
    if (found) courseRows[row] = found.id;
  }

  const userIds = [];
  c.people.forEach((p, i) => {
    const email = `sample${i + 1}@${c.domain}`;
    let existing = get('SELECT id FROM users WHERE email = ?', email);
    if (!existing) {
      run(
        `INSERT INTO users (
           email, name, pw_hash, role, university_id, department, degree, year_of_study, semester,
           student_id, designation, faculty_id, cabin, academic_background, bio, verified, domain_match
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        email, p.name, unusable, p.role, uni.id, p.dept || '', p.degree || '', p.year ?? null, p.sem ?? null,
        p.sid || '', p.desig || '', p.fid || '', p.cabin || '', p.bg || '', p.bio || ''
      );
      existing = get('SELECT id FROM users WHERE email = ?', email);
    } else {
      run(
        `UPDATE users SET academic_background = COALESCE(NULLIF(academic_background, ''), ?),
         degree = COALESCE(NULLIF(degree, ''), ?),
         semester = COALESCE(semester, ?),
         student_id = COALESCE(NULLIF(student_id, ''), ?),
         designation = COALESCE(NULLIF(designation, ''), ?),
         faculty_id = COALESCE(NULLIF(faculty_id, ''), ?),
         cabin = COALESCE(NULLIF(cabin, ''), ?),
         bio = COALESCE(NULLIF(bio, ''), ?)
         WHERE id = ?`,
        p.bg || '', p.degree || '', p.sem ?? null, p.sid || '', p.desig || '', p.fid || '', p.cabin || '', p.bio || '', existing.id
      );
    }
    userIds.push(existing.id);
  });

  for (const o of c.offers) {
    const uid = userIds[o.who];
    const cid = courseRows[o.code];
    if (!uid || !cid) continue;
    const existingOffer = get('SELECT id FROM offers WHERE user_id = ? AND course_id = ?', uid, cid);
    if (!existingOffer) {
      run(
        `INSERT INTO offers (user_id, university_id, course_id, headline, description, syllabus_topics, syllabus_subtopics, price_per_hour, mode, availability, mastery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uid, uni.id, cid, o.headline, o.description, o.topics || '', o.subtopics || '', o.price, o.mode, o.availability, o.mastery
      );
    } else {
      run(
        `UPDATE offers SET syllabus_topics = COALESCE(NULLIF(syllabus_topics, ''), ?),
         syllabus_subtopics = COALESCE(NULLIF(syllabus_subtopics, ''), ?) WHERE id = ?`,
        o.topics || '', o.subtopics || '', existingOffer.id
      );
    }
  }

  for (const [topicName, qs] of Object.entries(QUIZ)) {
    const t = get(
      `SELECT t.id FROM topics t JOIN courses c ON c.id = t.course_id WHERE c.university_id = ? AND t.name = ? LIMIT 1`,
      uni.id, topicName
    );
    if (!t) continue;
    const existingQ = get('SELECT COUNT(*) AS n FROM quiz_questions WHERE topic_id = ?', t.id).n;
    if (existingQ === 0) {
      for (const [concept, prompt, options, correct, explanation] of qs) {
        run('INSERT INTO quiz_questions (topic_id, concept, prompt, options, correct_index, explanation) VALUES (?, ?, ?, ?, ?, ?)', t.id, concept, prompt, JSON.stringify(options), correct, explanation);
      }
    }
  }

  if (c.slug === 'meridian-institute' && userIds.length >= 9) {
    const teacherId = userIds[2];
    const medTeacherId = userIds[4];
    if (courseRows.CS301) run('INSERT OR IGNORE INTO course_teachers (course_id, user_id) VALUES (?, ?)', courseRows.CS301, teacherId);
    if (courseRows.MED101) run('INSERT OR IGNORE INTO course_teachers (course_id, user_id) VALUES (?, ?)', courseRows.MED101, medTeacherId);

    const nfaTopic = get('SELECT id FROM topics WHERE course_id = ? AND name = ?', courseRows.CS301, 'NFA to DFA conversion');
    const dfaTopic = get('SELECT id FROM topics WHERE course_id = ? AND name = ?', courseRows.CS301, 'Deterministic finite automata (DFA)');
    const anatTopic = get('SELECT id FROM topics WHERE course_id = ? AND name = ?', courseRows.MED101, 'Upper Limb & Brachial Plexus');
    const conTopic = get('SELECT id FROM topics WHERE course_id = ? AND name = ?', courseRows.LAW105, 'Offer, Acceptance & Consideration');
    const finTopic = get('SELECT id FROM topics WHERE course_id = ? AND name = ?', courseRows.FIN201, 'Time Value of Money, NPV & IRR');

    const resCount = get('SELECT COUNT(*) AS n FROM resources WHERE university_id = ?', uni.id).n;
    if (resCount === 0 && nfaTopic && dfaTopic) {
      const resList = [
        [courseRows.CS301, nfaTopic.id, 'Subset construction explained step by step', 'explanation', 'Start with the NFA start state and take its epsilon closure. That set is the start state of the DFA.\n\nFor each new set and each input symbol, collect every NFA state reachable on that symbol, then take the epsilon closure of the result. If the set is new, add it as a DFA state.\n\nRepeat until no new sets appear. Any set that contains an accepting NFA state is an accepting DFA state.', 'official', teacherId],
        [courseRows.CS301, nfaTopic.id, 'Worked example: NFA over {a, b} ending in ab', 'worked_example', 'NFA states q0, q1, q2. q0 loops on a and b, q0 goes to q1 on a, q1 goes to q2 on b, q2 accepts.\n\nStart {q0}. On a: {q0, q1}. On b: {q0}. From {q0, q1}: on a gives {q0, q1}; on b gives {q0, q2}. From {q0, q2}: on a gives {q0, q1}; on b gives {q0}.\n\nAccepting DFA state: {q0, q2}.', 'faculty_verified', userIds[1]],
        [courseRows.CS301, nfaTopic.id, 'My revision checklist for NFA to DFA', 'revision', 'Draw the NFA. Write the epsilon closure of each state. Build the transition table row by row. Mark accepting sets. Redraw the DFA neatly. Check three strings by hand.', 'community', userIds[0]],
        [courseRows.CS301, nfaTopic.id, 'Quick tips from my notebook', 'notes', 'Most mistakes come from forgetting the epsilon closure after a move. Always close, then move, then close again.', 'pending', userIds[3]],
        [courseRows.CS301, dfaTopic.id, 'DFA definition and tracing practice', 'practice', 'Define the five parts of a DFA. Trace the strings 0110, 1011 and 0000 on the machine in your lecture notes and say whether each is accepted.', 'official', teacherId],
        [courseRows.MED101, anatTopic?.id || null, 'Brachial Plexus Mnemonic & Clinical Lesions', 'notes', 'Roots, Trunks, Divisions, Cords, Branches (Remember To Drink Cold Beer). Erb-Duchenne palsy affects C5-C6 (waiter tip deformity); Klumpke palsy affects C8-T1 (claw hand).', 'official', medTeacherId],
        [courseRows.LAW105, conTopic?.id || null, 'Contract Formation IRAC Cheat Sheet', 'revision', 'Issue -> Rule (Offer vs Invitation to Treat, Carlill v Carbolic Smoke Ball) -> Application -> Conclusion.', 'community', userIds[6]],
        [courseRows.FIN201, finTopic?.id || null, 'NPV vs IRR Decision Rules Summary', 'worked_example', 'Use NPV when comparing mutually exclusive projects of different scale. Reinvestment assumption: NPV assumes reinvestment at WACC; IRR assumes reinvestment at IRR.', 'community', userIds[7]],
      ];
      for (const [cid, tid, title, kind, body, status, uploader] of resList) {
        if (!cid) continue;
        const rr = run(
          `INSERT INTO resources (university_id, course_id, topic_id, uploader_id, title, kind, body, source, status, reviewed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Sample content for the demo', ?, ?)`,
          uni.id, cid, tid, uploader, title, kind, body, status, status === 'pending' || status === 'community' ? null : teacherId
        );
        run('INSERT INTO resource_versions (resource_id, version, title, body) VALUES (?, 1, ?, ?)', Number(rr.lastInsertRowid), title, body);
      }
    }

    if (nfaTopic && get('SELECT COUNT(*) AS n FROM difficulty_reports WHERE topic_id = ?', nfaTopic.id).n === 0) {
      const mix = ['needs_help', 'needs_help', 'needs_practice', 'needs_help', 'understood', 'needs_practice', 'needs_help', 'understood', 'needs_practice'];
      userIds.forEach((uid, i) => {
        if (i === 2 || i === 4) return;
        run('INSERT OR IGNORE INTO difficulty_reports (user_id, topic_id, status) VALUES (?, ?, ?)', uid, nfaTopic.id, mix[i % mix.length]);
      });
    }

    if (get('SELECT COUNT(*) AS n FROM handovers WHERE university_id = ?', uni.id).n === 0 && courseRows.CS301) {
      run(
        "INSERT INTO handovers (university_id, course_id, author_id, title, body, show_author, status, reviewed_by) VALUES (?, ?, ?, ?, ?, 1, 'approved', ?)",
        uni.id, courseRows.CS301, userIds[0], 'Theory of Computation: how I revised in the last two weeks',
        'Week one: finite automata and regular languages, solving two past papers questions per day without notes. Week two: the pumping lemma, then Turing machines. Do the pumping lemma proofs aloud as if teaching a friend; if you get stuck, that is the part to revisit.', teacherId
      );
      if (courseRows.MED101) {
        run(
          "INSERT INTO handovers (university_id, course_id, author_id, title, body, show_author, status, reviewed_by) VALUES (?, ?, ?, ?, ?, 1, 'approved', ?)",
          uni.id, courseRows.MED101, userIds[5], 'Human Anatomy dissection & viva survival guide',
          'Draw nerve and blood supply diagrams from memory before every lab. Group muscles by compartment and shared innervation instead of memorizing isolated origins.', medTeacherId
        );
      }
    }
  }

  if (get('SELECT COUNT(*) AS n FROM posts WHERE university_id = ?', uni.id).n === 0 && userIds.length > 0) {
    for (const [kind, title, body, days] of c.posts) {
      const eventAt = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
      run('INSERT INTO posts (university_id, user_id, kind, title, body, event_at) VALUES (?, ?, ?, ?, ?, ?)', uni.id, userIds[0], kind, title, body, eventAt);
    }
  }
}

console.log(created ? `Seeded ${created} campus(es) and updated background catalogs.` : 'Updated sample campuses and background catalogs.');

if (config.adminEmail && config.adminPassword) {
  const r = await createAdmin(config.adminEmail, config.adminPassword);
  console.log(r.created ? 'Administrator account created. Remove ADMIN_PASSWORD from your environment now.' : 'Administrator account already exists.');
} else {
  console.log('No ADMIN_EMAIL and ADMIN_PASSWORD set, so no administrator was created.');
}
