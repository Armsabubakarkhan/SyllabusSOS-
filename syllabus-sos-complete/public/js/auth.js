import { h, clear, get, post, field, showFieldErrors, footer, ApiError } from './common.js';

document.getElementById('foot').replaceWith(footer());

const params = new URLSearchParams(location.search);
const panel = document.getElementById('panel');
const tabs = { login: document.getElementById('tab-login'), register: document.getElementById('tab-register') };

let portal = params.get('as') === 'teacher' ? 'teacher' : 'student';
const picks = { student: document.getElementById('pick-student'), teacher: document.getElementById('pick-teacher') };
let tab = 'login';

/* Each role lands on its own pages. */
const homeFor = (role) => (role === 'admin' ? '/admin' : role === 'teacher' ? '/teacher' : '/student');

const BACKGROUNDS = [
  'Engineering',
  'Medical',
  'Law',
  'Finance',
  'Science',
  'Arts & Humanities',
  'Management',
  'Other',
];

function setPortal(name) {
  portal = name;
  for (const [k, el] of Object.entries(picks)) el.setAttribute('aria-pressed', String(k === name));
  document.title = `${name === 'teacher' ? 'Teacher' : 'Student'} ${tab === 'login' ? 'sign in' : 'sign up'}, SyllabusSOS++`;
  (tab === 'login' ? loginForm : registerForm)();
}
picks.student.addEventListener('click', () => setPortal('student'));
picks.teacher.addEventListener('click', () => setPortal('teacher'));

function setTab(name) {
  tab = name;
  for (const [k, el] of Object.entries(tabs)) el.setAttribute('aria-selected', String(k === name));
  panel.setAttribute('aria-labelledby', `tab-${name}`);
  setPortal(portal);
}
tabs.login.addEventListener('click', () => setTab('login'));
tabs.register.addEventListener('click', () => setTab('register'));

function errorBox(msg) {
  return h('div', { class: 'notice bad', role: 'alert', id: 'form-error' }, h('strong', {}, 'Could not continue.'), msg);
}

function loginForm() {
  const form = h('form', { novalidate: true, autocomplete: 'on', class: 'single-col-form' },
    h('h2', {}, portal === 'teacher' ? 'Teacher / Tutor sign in' : 'Student sign in'),
    portal === 'teacher' ? h('p', { class: 'small muted' }, 'Sign in for faculty teachers and student peer tutors.') : null,
    h('div', { id: 'err' }),
    field('Email', h('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: 254, placeholder: 'e.g. name@university.edu' })),
    field('Password', h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128, placeholder: 'Enter your password' })),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    clear(form.querySelector('#err'));
    try {
      const { user } = await post('/api/auth/login', { email: form.email.value, password: form.password.value, portal });
      location.href = homeFor(user.role);
    } catch (err) {
      form.querySelector('#err').append(errorBox(err.message));
      showFieldErrors(form, err.fields);
      btn.disabled = false;
    }
  });
  clear(panel).append(form);
  form.email.focus();
}

const makeDegreeSelect = (id, name = 'degree') => h('select', { id, name },
  h('option', { value: '' }, 'Select degree / program'),
  ['B.Tech / B.E.', 'MBBS / MD', 'LLB / BA LLB', 'B.Com / B.Fin', 'BCA', 'B.Sc', 'BBA', 'M.Tech / M.E.', 'MCA', 'M.Sc', 'MBA', 'Ph.D / Research', 'Other'].map((d) => h('option', { value: d }, d)));

const makeYearSelect = (id, name = 'year_of_study') => h('select', { id, name },
  h('option', { value: '' }, 'Select year of study'),
  [1, 2, 3, 4, 5, 6].map((y) => h('option', { value: y }, `Year ${y}`)));

const makeSemSelect = (id, name = 'semester') => h('select', { id, name },
  h('option', { value: '' }, 'Select current semester'),
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => h('option', { value: s }, `Semester ${s}`)));

async function registerForm() {
  clear(panel).append(h('h2', {}, portal === 'teacher' ? 'Join as a teacher' : 'Join as a student'), h('div', { class: 'skel line' }), h('div', { class: 'skel line mid' }));
  let universities = [];
  try {
    universities = (await get('/api/universities')).universities;
  } catch (e) {
    clear(panel).append(errorBox(e.message));
    return;
  }
  const uniSel = h('select', { id: 'university_id', name: 'university_id' },
    h('option', { value: '' }, 'Choose your university / college'),
    universities.map((u) => h('option', { value: u.id, 'data-slug': u.slug }, `${u.name}, ${u.city}`)),
    h('option', { value: 'new' }, '+ My university / college is not listed'));
  const preset = params.get('university');
  const match = universities.find((u) => u.slug === preset);
  if (match) uniSel.value = String(match.id);

  const bgSel = h('select', { id: 'academic_background', name: 'academic_background' },
    h('option', { value: '' }, 'Select your academic background'),
    BACKGROUNDS.map((b) => h('option', { value: b }, b)));

  /* Every field in Create Account is placed one by one vertically. */
  const newBox = h('div', { class: 'helper-box', hidden: true },
    h('div', { class: 'form-section-title' }, 'New College / University Details'),
    field('University / College full name', h('input', { id: 'new_university_name', name: 'new_university_name', placeholder: 'e.g. RV University', maxlength: 120 })),
    field('City / Place', h('input', { id: 'new_university_city', name: 'new_university_city', placeholder: 'e.g. Bengaluru', maxlength: 80 })),
    field('State', h('input', { id: 'new_university_state', name: 'new_university_state', placeholder: 'e.g. Karnataka', maxlength: 80 })),
    field('Campus address', h('input', { id: 'new_university_address', name: 'new_university_address', placeholder: 'e.g. Mysuru Road, RV Vidyaniketan Post', maxlength: 200 })),
    field('College / Institute code', h('input', { id: 'new_university_code', name: 'new_university_code', placeholder: 'e.g. RVU-01', maxlength: 30 })),
    field('Official student/faculty email domain', h('input', { id: 'new_university_domain', name: 'new_university_domain', placeholder: 'e.g. rvu.edu.in', maxlength: 100 }), '(optional, enables automatic domain verification)'),
    h('p', { class: 'small muted' }, 'An administrator verifies new institutions before they appear publicly. You can still use the site immediately.'));
  uniSel.addEventListener('change', () => { newBox.hidden = uniSel.value !== 'new'; });

  const designations = ['Assistant Professor', 'Associate Professor', 'Professor', 'Head of Department (HOD)', 'Dean / Director', 'Lecturer / Adjunct', 'Teaching Assistant'];
  const desigSel = h('select', { id: 'designation', name: 'designation' },
    h('option', { value: '' }, 'Select designation'),
    designations.map((d) => h('option', { value: d }, d)));

  const terms = h('input', { id: 'terms', name: 'terms', type: 'checkbox', required: true });

  const studentTutorCheck = h('input', { id: 'student_is_tutor', name: 'student_is_tutor', type: 'checkbox' });
  const studentFields = h('div', { class: 'role-specific student-fields' },
    h('div', { class: 'form-section-title' }, 'Academic Details (Student)'),
    field('Degree / Program', makeDegreeSelect('degree', 'degree')),
    field('Department / Branch', h('input', { id: 'department', name: 'department', placeholder: 'e.g. Computer Science and Engineering', maxlength: 100 })),
    field('Student ID / USN / Roll No.', h('input', { id: 'student_id', name: 'student_id', placeholder: 'e.g. 1RUA24CSE0010', maxlength: 40 })),
    field('Year of study', makeYearSelect('year_of_study', 'year_of_study')),
    field('Current semester', makeSemSelect('semester', 'semester'), 'Optional, helps match course tutors and peer groups.'),
    h('div', { class: 'field' },
      h('label', { class: 'check', for: 'student_is_tutor' },
        studentTutorCheck,
        h('span', {}, 'I want to be a Peer Tutor (offer tutoring sessions and teach other students on campus)'))));

  const tutorTypeSel = h('select', { id: 'tutor_type', name: 'tutor_type' },
    h('option', { value: 'faculty' }, 'College Faculty / Professor (Official Campus Teacher)'),
    h('option', { value: 'peer_tutor' }, 'Peer Tutor / Student Tutor (Student Teaching Peers)'));

  const facultyBox = h('div', { id: 'faculty-box' },
    field('Department / School', h('input', { id: 'faculty_department', name: 'faculty_department', placeholder: 'e.g. School of Computer Science', maxlength: 100 })),
    field('Designation / Title', desigSel),
    field('Faculty / Employee ID', h('input', { id: 'faculty_id', name: 'faculty_id', placeholder: 'e.g. FAC-2024-08', maxlength: 40 })),
    field('Cabin / Office location', h('input', { id: 'cabin', name: 'cabin', placeholder: 'e.g. Block C, Room 304', maxlength: 60 })),
    h('p', { class: 'small muted' }, 'An administrator verifies teachers. Until verified you can offer sessions and share course insights; course syllabus edits and official resource reviews unlock after approval.'));

  const peerTutorBox = h('div', { id: 'peer-tutor-box', hidden: true },
    field('Degree / Program', makeDegreeSelect('peer_degree', 'peer_degree')),
    field('Department / Branch', h('input', { id: 'peer_department', name: 'peer_department', placeholder: 'e.g. Computer Science and Engineering', maxlength: 100 })),
    field('Student ID / USN / Roll No.', h('input', { id: 'peer_student_id', name: 'peer_student_id', placeholder: 'e.g. 1RUA24CSE0010', maxlength: 40 })),
    field('Year of study', makeYearSelect('peer_year_of_study', 'peer_year_of_study')),
    field('Current semester', makeSemSelect('peer_semester', 'peer_semester'), 'Optional, helps match courses you teach or learn.'),
    h('p', { class: 'small muted' }, 'As a student peer tutor, you can offer tutoring sessions to peers, share syllabus notes, and assist campus learners.'));

  tutorTypeSel.addEventListener('change', () => {
    const isPeer = tutorTypeSel.value === 'peer_tutor';
    facultyBox.hidden = isPeer;
    peerTutorBox.hidden = !isPeer;
  });

  const teacherFields = h('div', { class: 'role-specific teacher-fields' },
    h('div', { class: 'form-section-title' }, 'Teaching & Role Category'),
    field('Teaching Role / Category', tutorTypeSel, 'Select whether you are a college faculty professor or a student peer tutor'),
    facultyBox,
    peerTutorBox);

  const form = h('form', { novalidate: true, autocomplete: 'on', class: 'single-col-form' },
    h('h2', {}, portal === 'teacher' ? 'Join as a Teacher or Tutor' : 'Join as a Student'),
    h('div', { id: 'err' }),

    h('div', { class: 'form-section-title' }, 'Personal & Contact Information'),
    field('Full name', h('input', { id: 'name', name: 'name', autocomplete: 'name', required: true, maxlength: 80, placeholder: 'e.g. Abu bakar Khan' })),
    field('Phone / WhatsApp number', h('input', { id: 'phone', name: 'phone', type: 'tel', autocomplete: 'tel', placeholder: 'e.g. +91 9876543210', maxlength: 20 }), 'Used for session coordination (kept private)'),
    field('Email address', h('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: 254, placeholder: 'e.g. student@rvu.edu.in' }), 'Use your university or college email if you have one.'),

    h('div', { class: 'form-section-title' }, 'Academic Background & Campus'),
    field('Academic background / Stream', bgSel, 'Loads sample subjects, syllabus topics, and tutors matching your field.'),
    field('University / College', uniSel),
    newBox,
    field('College / Campus name', h('input', { id: 'college_name', name: 'college_name', placeholder: 'e.g. Main Campus / Tech Park', maxlength: 120 }), '(optional)'),
    field('Campus location / Place', h('input', { id: 'college_place', name: 'college_place', placeholder: 'e.g. Mysuru Road, Bengaluru', maxlength: 80 }), '(optional)'),

    portal === 'student' ? studentFields : teacherFields,

    h('div', { class: 'form-section-title' }, 'Profile Bio & Security'),
    field('Short bio', h('textarea', { id: 'bio', name: 'bio', maxlength: 500, placeholder: 'Share your interests, strengths, or courses you want help with (optional)' })),
    field('Create password', h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'new-password', required: true, maxlength: 128, placeholder: 'At least 10 characters with letters and numbers' }), 'At least 10 characters, combining letters with numbers or symbols.'),

    h('div', { class: 'field' }, h('label', { class: 'check', for: 'terms' }, terms, h('span', {}, 'I agree to the ', h('a', { href: '/terms' }, 'Terms of service'), ' and have read the ', h('a', { href: '/privacy' }, 'Privacy policy'), '.'))),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create account'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    clear(form.querySelector('#err'));
    if (!terms.checked) {
      form.querySelector('#err').append(errorBox('Please accept the terms and privacy policy to continue.'));
      terms.focus();
      return;
    }
    const body = {
      name: form.name.value,
      email: form.email.value,
      password: form.password.value,
      role: portal,
    };

    if (bgSel.value) body.academic_background = bgSel.value;

    if (portal === 'teacher') {
      body.tutor_type = tutorTypeSel.value;
      if (tutorTypeSel.value === 'peer_tutor') {
        if (form.peer_department?.value?.trim()) body.department = form.peer_department.value.trim();
        if (form.peer_student_id?.value?.trim()) body.student_id = form.peer_student_id.value.trim();
        if (form.peer_degree?.value?.trim()) body.degree = form.peer_degree.value.trim();
        if (form.peer_semester?.value) body.semester = Number(form.peer_semester.value);
        if (form.peer_year_of_study?.value) body.year_of_study = Number(form.peer_year_of_study.value);
      } else {
        if (form.faculty_department?.value?.trim()) body.department = form.faculty_department.value.trim();
        if (form.designation?.value?.trim()) body.designation = form.designation.value.trim();
        if (form.faculty_id?.value?.trim()) body.faculty_id = form.faculty_id.value.trim();
        if (form.cabin?.value?.trim()) body.cabin = form.cabin.value.trim();
      }
    } else {
      if (studentTutorCheck.checked) body.tutor_type = 'peer_tutor';
      if (form.department?.value?.trim()) body.department = form.department.value.trim();
      if (form.student_id?.value?.trim()) body.student_id = form.student_id.value.trim();
      if (form.degree?.value?.trim()) body.degree = form.degree.value.trim();
      if (form.semester?.value) body.semester = Number(form.semester.value);
      if (form.year_of_study?.value) body.year_of_study = Number(form.year_of_study.value);
    }

    if (form.phone?.value?.trim()) body.phone = form.phone.value.trim();

    if (uniSel.value === 'new') {
      body.new_university_name = form.new_university_name.value;
      body.new_university_city = form.new_university_city.value;
      if (form.new_university_state?.value?.trim()) body.new_university_state = form.new_university_state.value.trim();
      if (form.new_university_address?.value?.trim()) body.new_university_address = form.new_university_address.value.trim();
      if (form.new_university_code?.value?.trim()) body.new_university_code = form.new_university_code.value.trim();
      if (form.new_university_domain?.value?.trim()) body.new_university_domain = form.new_university_domain.value.trim();
    } else if (uniSel.value) {
      body.university_id = Number(uniSel.value);
    }

    if (form.college_name?.value?.trim()) body.college_name = form.college_name.value.trim();
    if (form.college_place?.value?.trim()) body.college_place = form.college_place.value.trim();

    btn.disabled = true;
    try {
      await post('/api/auth/register', body);
      if (form.bio?.value?.trim()) {
        try { await fetch('/api/me', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sos' }, body: JSON.stringify({ bio: form.bio.value.trim() }) }); } catch { /* bio optional */ }
      }
      location.href = homeFor(portal);
    } catch (err) {
      form.querySelector('#err').append(errorBox(err instanceof ApiError ? err.message : 'Something went wrong.'));
      showFieldErrors(form, err.fields);
      btn.disabled = false;
    }
  });
  clear(panel).append(form);
  form.name.focus();
}

try {
  const { user } = await get('/api/auth/me');
  if (user) location.replace(homeFor(user.role));
} catch { /* show the form */ }

setTab(params.get('tab') === 'register' || params.get('university') ? 'register' : 'login');
