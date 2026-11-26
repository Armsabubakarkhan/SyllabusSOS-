import { get, run } from './db.js';

export const BACKGROUNDS = [
  'Engineering',
  'Medical',
  'Law',
  'Finance',
  'Science',
  'Arts & Humanities',
  'Management',
  'Other',
];

export const BACKGROUND_CATALOG = {
  Engineering: [
    {
      code: 'CS201',
      name: 'Data Structures & Algorithms',
      department: 'Computer Science & Engineering',
      topics: [
        [1, 'Linear Structures', 'Arrays, Linked Lists & Stacks', 'Compare memory layout and time complexity of arrays, linked lists, stacks and queues.'],
        [2, 'Trees & Graphs', 'Binary Search Trees & Traversals', 'Implement BFS, DFS, and balanced binary search tree operations.'],
        [3, 'Algorithm Design', 'Dynamic Programming & Greedy Methods', 'Identify optimal substructure and overlapping subproblems.'],
      ],
    },
    {
      code: 'CS301',
      name: 'Theory of Computation',
      department: 'Computer Science & Engineering',
      topics: [
        [1, 'Finite automata', 'Deterministic finite automata (DFA)', 'Define a DFA and trace its behaviour on an input string.'],
        [1, 'Finite automata', 'Nondeterministic finite automata (NFA)', 'Explain how an NFA differs from a DFA and trace its possible paths.'],
        [1, 'Finite automata', 'NFA to DFA conversion', 'Convert an NFA to an equivalent DFA using the subset construction.'],
        [2, 'Regular languages', 'Pumping lemma for regular languages', 'Use the pumping lemma to show a language is not regular.'],
        [3, 'Computability', 'Turing machines', 'Describe a Turing machine and design one for a simple language.'],
      ],
    },
    {
      code: 'CS304',
      name: 'Operating Systems',
      department: 'Computer Science & Engineering',
      topics: [
        [1, 'Processes & Threads', 'CPU Scheduling & Context Switching', 'Compare FCFS, SJF, Round Robin and Priority scheduling algorithms.'],
        [2, 'Concurrency', 'Semaphores, Mutexes & Deadlocks', 'Prevent, avoid and detect deadlocks using resource allocation graphs.'],
        [3, 'Memory', 'Paging, Segmentation & Virtual Memory', 'Analyze page replacement strategies including LRU and Clock.'],
      ],
    },
    {
      code: 'MA201',
      name: 'Engineering Mathematics III',
      department: 'Applied Mathematics',
      topics: [
        [1, 'Transforms', 'Laplace Transforms & Inverse Transforms', 'Solve linear differential equations using Laplace transforms.'],
        [2, 'Series', 'Fourier Series & Harmonic Analysis', 'Expand periodic functions into Fourier series.'],
      ],
    },
    {
      code: 'EC305',
      name: 'Digital Signal Processing',
      department: 'Electronics & Communication',
      topics: [
        [1, 'Discrete Signals', 'Z-Transforms & Region of Convergence', 'Evaluate system stability and causality from pole-zero plots.'],
        [2, 'Spectral Analysis', 'Discrete Fourier Transform (DFT & FFT)', 'Compute radix-2 FFT butterflies for N-point sequences.'],
      ],
    },
  ],
  Medical: [
    {
      code: 'MED101',
      name: 'Human Anatomy',
      department: 'Medical Sciences',
      topics: [
        [1, 'Musculoskeletal', 'Upper Limb & Brachial Plexus', 'Trace roots, trunks, divisions, cords and terminal branches of the brachial plexus.'],
        [2, 'Thorax', 'Heart Chambers, Valves & Coronary Supply', 'Identify surface anatomy and coronary arterial territories.'],
        [3, 'Neuroanatomy', 'Cranial Nerves & Brainstem Nuclei', 'Correlate cranial nerve lesions with clinical signs.'],
      ],
    },
    {
      code: 'MED102',
      name: 'Medical Physiology',
      department: 'Medical Sciences',
      topics: [
        [1, 'Cardiovascular', 'Cardiac Cycle & ECG Interpretation', 'Relate pressure-volume loops to heart sounds and ECG waves.'],
        [2, 'Renal', 'Glomerular Filtration & Acid-Base Balance', 'Calculate clearance and interpret metabolic vs respiratory acidosis.'],
      ],
    },
    {
      code: 'MED201',
      name: 'Clinical Pharmacology',
      department: 'Pharmacology',
      topics: [
        [1, 'Autonomic', 'Cholinergic & Adrenergic Agonists/Antagonists', 'Predict receptor-mediated cardiovascular and respiratory effects.'],
        [2, 'Chemotherapy', 'Antimicrobial Mechanisms & Resistance', 'Match beta-lactams, macrolides and fluoroquinolones to target organisms.'],
      ],
    },
  ],
  Law: [
    {
      code: 'LAW101',
      name: 'Constitutional Law',
      department: 'School of Law',
      topics: [
        [1, 'Rights & Writs', 'Fundamental Rights & Constitutional Remedies', 'Analyze Articles 14, 19 and 21 along with writ jurisdiction.'],
        [2, 'Federalism', 'Center-State Relations & Judicial Review', 'Examine separation of powers and basic structure doctrine.'],
      ],
    },
    {
      code: 'LAW105',
      name: 'Law of Contracts',
      department: 'School of Law',
      topics: [
        [1, 'Formation', 'Offer, Acceptance & Consideration', 'Distinguish valid contracts, void agreements and invitations to treat.'],
        [2, 'Remedies', 'Breach of Contract & Specific Relief', 'Calculate damages and apply Hadley v Baxendale remoteness rules.'],
      ],
    },
    {
      code: 'LAW202',
      name: 'Criminal Law & Procedure',
      department: 'School of Law',
      topics: [
        [1, 'Elements of Crime', 'Actus Reus, Mens Rea & Strict Liability', 'Evaluate criminal intent, negligence and general exceptions.'],
        [2, 'Procedure', 'FIR, Bail & Trial Stages', 'Outline pre-trial investigation, framing of charges and appeals.'],
      ],
    },
  ],
  Finance: [
    {
      code: 'FIN101',
      name: 'Financial Accounting',
      department: 'Finance & Accounting',
      topics: [
        [1, 'Statements', 'Balance Sheet, Income & Cash Flow Statements', 'Prepare and reconcile three-statement financial models.'],
        [2, 'Analysis', 'Financial Ratios & Working Capital', 'Interpret liquidity, solvency and profitability ratios.'],
      ],
    },
    {
      code: 'FIN201',
      name: 'Corporate Finance',
      department: 'Finance & Accounting',
      topics: [
        [1, 'Valuation', 'Time Value of Money, NPV & IRR', 'Evaluate capital budgeting projects using discounted cash flows.'],
        [2, 'Capital Structure', 'WACC, CAPM & Dividend Policy', 'Compute cost of equity and weighted average cost of capital.'],
      ],
    },
    {
      code: 'FIN302',
      name: 'Derivatives & Risk Management',
      department: 'Quantitative Finance',
      topics: [
        [1, 'Forwards & Futures', 'Hedging Basis Risk & Cost of Carry', 'Design minimum-variance hedge ratios using index futures.'],
        [2, 'Options', 'Put-Call Parity & Black-Scholes Greeks', 'Analyze delta, gamma, theta and vega exposures.'],
      ],
    },
  ],
  Science: [
    {
      code: 'PHY101',
      name: 'Classical & Quantum Mechanics',
      department: 'Physics',
      topics: [
        [1, 'Mechanics', 'Lagrangian & Hamiltonian Formalism', 'Derive equations of motion from generalized coordinates.'],
        [2, 'Quantum', 'Wavefunctions & Schrodinger Equation', 'Solve particle-in-a-box and harmonic oscillator eigenstates.'],
      ],
    },
    {
      code: 'CHM201',
      name: 'Organic Chemistry Mechanisms',
      department: 'Chemistry',
      topics: [
        [1, 'Substitution & Elimination', 'SN1, SN2, E1 and E2 Pathways', 'Predict stereochemical outcomes from substrate and solvent conditions.'],
      ],
    },
  ],
  'Arts & Humanities': [
    {
      code: 'HUM101',
      name: 'Ethics, Logic & Critical Thinking',
      department: 'Humanities',
      topics: [
        [1, 'Argumentation', 'Formal Fallacies & Deductive Validity', 'Evaluate arguments using truth tables and syllogistic rules.'],
        [2, 'Moral Philosophy', 'Utilitarianism, Deontology & Virtue Ethics', 'Compare normative ethical frameworks on applied case studies.'],
      ],
    },
  ],
  Management: [
    {
      code: 'MGT101',
      name: 'Principles of Management & Strategy',
      department: 'Business Management',
      topics: [
        [1, 'Strategy', 'Competitive Advantage & Five Forces', 'Analyze industry structure and value chain positioning.'],
        [2, 'Operations', 'Supply Chain & Lean Process Design', 'Reduce bottlenecks and measure cycle time efficiency.'],
      ],
    },
  ],
};

export function seedBackgroundForUniversity(universityId, background) {
  const catalog = BACKGROUND_CATALOG[background];
  if (!catalog || !universityId) return;
  for (const item of catalog) {
    let course = get('SELECT id, background FROM courses WHERE university_id = ? AND code = ?', universityId, item.code);
    if (!course) {
      const res = run(
        'INSERT INTO courses (university_id, code, name, department, background) VALUES (?, ?, ?, ?, ?)',
        universityId, item.code, item.name, item.department, background
      );
      course = { id: Number(res.lastInsertRowid) };
    } else if (!course.background) {
      run('UPDATE courses SET background = ? WHERE id = ?', background, course.id);
    }
    for (const [unitNo, unitName, name, objective] of item.topics) {
      if (!get('SELECT 1 FROM topics WHERE course_id = ? AND unit_no = ? AND name = ?', course.id, unitNo, name)) {
        run(
          'INSERT INTO topics (course_id, unit_no, unit_name, name, objective) VALUES (?, ?, ?, ?, ?)',
          course.id, unitNo, unitName, name, objective
        );
      }
    }
  }
}

export function ensureAllBackgroundsForUniversity(universityId) {
  for (const bg of Object.keys(BACKGROUND_CATALOG)) {
    seedBackgroundForUniversity(universityId, bg);
  }
}
