import { h, clear, get, post, patch, del, toast, fail, field, showFieldErrors, skeletonRows, fmtDate, fmtDateTime, safeHttps, formatBytes, uploadLocalFile } from './common.js';
import { empty, errorNotice, personLink, reportControl } from './app-ui.js';

const STATUS_LABEL = {
  official: 'Official teacher resource', faculty_verified: 'Teacher verified', community: 'Community contribution',
  pending: 'Pending review', rejected: 'Rejected', removed: 'Removed',
};
const KIND_LABEL = { notes: 'Notes', worked_example: 'Worked example', practice: 'Practice questions', past_paper: 'Past paper', revision: 'Revision guide', link: 'External link', explanation: 'Explanation' };
const MY_STATUS = { understood: 'I understand this', needs_practice: 'I need practice', needs_help: 'I need help', not_studied: 'Not studied yet' };

export const statusBadge = (s) => h('span', { class: `tag${s === 'official' || s === 'faculty_verified' ? ' solid' : s === 'rejected' ? ' warn' : ''}` }, STATUS_LABEL[s] || s);

async function coursePicker(ctx, current, onChange, label = 'Course') {
  const { courses } = await get('/api/courses');
  const sel = h('select', { id: 'course-pick', 'aria-label': label },
    h('option', { value: '' }, 'Choose a course'),
    courses.map((c) => h('option', { value: c.id, selected: String(c.id) === String(current) }, `${c.code} ${c.name}`)));
  sel.addEventListener('change', () => onChange(sel.value));
  return { sel, courses };
}

function fileDownloadLink(file) {
  if (!file) return null;
  return h('a', { class: 'btn btn-sm', href: `/api/files/${file.id}`, download: file.name }, `Download: ${file.name} (${formatBytes(file.size_bytes)})`);
}

function resourceCard(r, { onChange } = {}) {
  const box = h('article', { class: 'item' });
  const render = () => {
    clear(box).append(
      h('h3', {}, h('a', { href: `#/resource/${r.id}` }, r.title)),
      h('div', { class: 'meta' }, statusBadge(r.status), h('span', { class: 'tag' }, KIND_LABEL[r.kind] || r.kind), h('strong', {}, r.course.code), r.topic ? h('span', {}, r.topic.name) : null, r.version > 1 ? h('span', { class: 'tag' }, `Version ${r.version}`) : null),
      r.excerpt ? h('p', { class: 'preline small' }, `${r.excerpt}${r.excerpt.length >= 160 ? '...' : ''}`) : null,
      r.file ? h('div', { class: 'small' }, fileDownloadLink(r.file)) : null,
      h('div', { class: 'small muted' }, 'By ', personLink(r.uploader), r.uploader.role === 'teacher' ? ' (teacher)' : ''),
      r.review_note ? h('div', { class: 'notice' }, h('strong', {}, 'Reviewer note.'), r.review_note) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-sm', type: 'button', 'aria-pressed': String(r.saved), onclick: async () => { try { const x = await post(`/api/resources/${r.id}/bookmark`); r.saved = x.saved; render(); } catch (e) { fail(e); } } }, r.saved ? 'Saved' : 'Save'),
        r.status === 'pending' && r.can_review ? reviewControls(r, () => { onChange?.(); }) : null));
  };
  render();
  return box;
}

function reviewControls(r, done) {
  const wrap = h('span', { class: 'row' });
  const act = (decision, ask) => async () => {
    let note = '';
    if (ask) {
      note = prompt('Say why, so the contributor can fix it (at least 5 characters):') || '';
      if (note.length < 5) return;
    }
    try { await post(`/api/resources/${r.id}/review`, { decision, note }); toast('Review saved.'); done(); } catch (e) { fail(e); }
  };
  wrap.append(
    h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: act('verified') }, 'Approve as teacher verified'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: act('community') }, 'Approve as community'),
    h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: act('reject', true) }, 'Reject'));
  return wrap;
}

/* ---------- syllabus ---------- */

export async function syllabus(root, arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Syllabus'), h('p', { class: 'muted' }, 'Units and topics for the courses at your university across Engineering, Medical, Law, Finance, and more.'))));
  const holder = h('div', {});
  const { courses } = await get('/api/courses');
  if (!ctx.alive()) return;
  const bgs = [...new Set(courses.map((c) => c.background).filter(Boolean))];
  const bgSel = h('select', { id: 'sy-bg', 'aria-label': 'Academic stream' },
    h('option', { value: '' }, 'All streams / backgrounds'),
    bgs.map((b) => h('option', { value: b }, b)));
  const sel = h('select', { id: 'course-pick', 'aria-label': 'Course' });
  const fillCourses = () => {
    const filtered = bgSel.value ? courses.filter((c) => c.background === bgSel.value) : courses;
    clear(sel).append(
      h('option', { value: '' }, 'Choose a course'),
      filtered.map((c) => h('option', { value: c.id, selected: String(c.id) === String(arg) }, `${c.code} ${c.name}${c.background ? ` (${c.background})` : ''}`))
    );
  };
  fillCourses();
  bgSel.addEventListener('change', fillCourses);
  sel.addEventListener('change', () => { location.hash = sel.value ? `#/syllabus/${sel.value}` : '#/syllabus'; });
  root.append(h('div', { class: 'filters three' }, bgSel, sel), holder);
  if (!ctx.alive()) return;
  if (!arg) {
    holder.append(courses.length
      ? empty('Choose a course', 'Pick a stream or course above to see its units, topics, resources and practice checks.')
      : empty('No courses yet', 'Offer a course and it is added to your university.', h('a', { class: 'btn', href: '#/new-offer' }, 'Offer a course')));
    return;
  }
  holder.append(skeletonRows(4));
  const d = await get(`/api/syllabus?course_id=${encodeURIComponent(arg)}`);
  if (!ctx.alive()) return;
  const teacherList = d.teacher_profiles?.length
    ? h('p', { class: 'muted small' }, 'Teachers assigned: ', d.teacher_profiles.map((tp, idx) => [idx > 0 ? ', ' : null, personLink(tp)]))
    : (d.teachers.length ? h('p', { class: 'muted small' }, `Teachers assigned: ${d.teachers.join(', ')}`) : h('p', { class: 'muted small' }, 'No teacher is assigned to this course yet, so nothing here is teacher verified.'));
  clear(holder).append(
    h('h2', {}, `${d.course.code} ${d.course.name}`, d.course.background ? h('span', { class: 'tag' }, ` ${d.course.background}`) : null),
    teacherList);
  if (!d.units.length) holder.append(empty('No topics yet', d.can_edit ? 'Add the first topic below.' : 'An assigned teacher can add the syllabus.'));
  for (const u of d.units) {
    holder.append(h('section', { class: 'stack' }, h('h3', {}, `Unit ${u.unit_no}: ${u.unit_name}`),
      h('ul', { class: 'ruled' }, u.topics.map((t) => h('li', {},
        h('div', { class: 'row between' },
          h('a', { href: `#/topic/${t.id}` }, h('strong', {}, t.name)),
          t.my_status ? h('span', { class: 'tag' }, MY_STATUS[t.my_status]) : null),
        h('div', { class: 'small muted' }, `${t.objective || 'No objective written yet.'} ${t.resources} resource${t.resources === 1 ? '' : 's'}, ${t.questions} practice question${t.questions === 1 ? '' : 's'}.`))))));
  }
  if (d.can_edit) {
    const f = h('form', { class: 'panel stack', novalidate: true },
      h('h3', {}, 'Add a topic'),
      h('div', { class: 'grid2' }, field('Unit number', h('input', { id: 'tp-unit', name: 'unit_no', type: 'number', min: 1, max: 20 })), field('Unit name', h('input', { id: 'tp-unitname', name: 'unit_name', maxlength: 120 }))),
      field('Topic name', h('input', { id: 'tp-name', name: 'name', maxlength: 120 })),
      field('Learning objective', h('input', { id: 'tp-obj', name: 'objective', maxlength: 300 }), '(optional)'),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add topic'));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { course_id: d.course.id, unit_no: Number(f.unit_no.value), unit_name: f.unit_name.value, name: f.name.value };
      if (f.objective.value.trim()) body.objective = f.objective.value;
      try { await post('/api/topics', body); toast('Topic added.'); ctx.refresh(); } catch (err) { showFieldErrors(f, err.fields); fail(err); }
    });
    holder.append(f);
  }
}

/* ---------- topic page ---------- */

export async function topic(root, id, ctx) {
  const d = await get(`/api/topics/${id}`);
  if (!ctx.alive()) return;
  const t = d.topic;
  root.append(h('p', {}, h('a', { href: `#/syllabus/${t.course.id}` }, `Back to ${t.course.code}`)),
    h('h1', {}, t.name),
    h('p', { class: 'muted' }, `${t.course.code} ${t.course.name}, unit ${t.unit_no}: ${t.unit_name}`),
    t.objective ? h('p', {}, h('strong', {}, 'Objective: '), t.objective) : null);

  const learner = ctx.state.user.role === 'student';
  const statusBox = h('section', { class: 'panel stack' }, h('h2', {}, 'How are you finding this topic?'), h('p', { class: 'small muted' }, 'Only you see your answer. Teachers see combined counts, and only when enough students have answered.'));
  const row = h('div', { class: 'tabrow', role: 'group', 'aria-label': 'Your difficulty status' });
  const drawStatus = () => {
    clear(row);
    for (const [k, label] of Object.entries(MY_STATUS)) {
      row.append(h('button', { type: 'button', 'aria-pressed': String(d.my_status === k), onclick: async () => { try { await post(`/api/topics/${t.id}/difficulty`, { status: k }); d.my_status = k; drawStatus(); toast('Saved.'); } catch (e) { fail(e); } } }, label));
    }
  };
  drawStatus();
  statusBox.append(row);

  const actions = h('section', { class: 'panel stack' }, h('h2', {}, 'Next steps'),
    d.questions
      ? h('div', {}, h('a', { class: 'btn btn-primary', href: `#/quiz/${t.id}` }, `Take the practice check (${d.questions} questions)`), d.last_attempt ? h('p', { class: 'small muted' }, `Last attempt: ${d.last_attempt.score} of ${d.last_attempt.total} on ${fmtDate(d.last_attempt.created_at)}.`) : null)
      : h('p', { class: 'muted' }, 'No practice check for this topic yet.'),
    h('a', { class: 'btn', href: `#/missions/new/${t.id}` }, 'Plan a learning mission'));

  const tutors = h('section', { class: 'panel' }, h('h2', {}, 'Tutors for this course'),
    d.tutors.length
      ? h('ul', { class: 'ruled' }, d.tutors.map((x) => h('li', {}, h('a', { href: `#/offer/${x.offer_id}` }, h('strong', {}, x.name)), ` ${x.headline}`,
          h('div', { class: 'small muted' }, `${x.price_per_hour === 0 ? 'Free' : `${x.price_per_hour} credits per hour`}, ${x.rating_count ? `${x.rating} out of 5 from ${x.rating_count} reviews` : 'No reviews yet'}. Tutors are matched by course; they may not have taught this exact topic.`))))
      : empty('No tutor yet', 'Nobody offers this course yet.', h('a', { class: 'btn btn-sm', href: '#/new-offer' }, 'Offer to teach it')));

  const res = h('section', {}, h('h2', {}, 'Resources'),
    d.resources.length ? h('div', {}, d.resources.map((r) => resourceCard(r, { onChange: () => ctx.refresh() }))) : empty('No resources yet', 'Share notes or a worked example for this topic.', h('a', { class: 'btn btn-sm', href: `#/resources?topic=${t.id}` }, 'Add a resource')));
  root.append(h('div', { class: 'grid2' }, h('div', { class: 'stack' }, learner ? statusBox : null, learner ? actions : null, tutors), res));
}

/* ---------- resource library & shared subject folders ---------- */

export async function resources(root, arg, ctx) {
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Resources & Subject Folders'), h('p', { class: 'muted' }, 'Open a subject folder to browse or upload files from your local drive, or browse reviewed notes below.')),
    h('a', { class: 'btn', href: '#/resources/saved' }, 'Saved')));

  const savedOnly = arg === 'saved';
  const folderSection = h('section', { class: 'stack' });
  if (!savedOnly) {
    root.append(folderSection);
    drawSubjectFolders(folderSection, ctx);
  }

  const { courses } = await get('/api/courses');
  if (!ctx.alive()) return;
  root.append(h('h2', {}, savedOnly ? 'Saved resources' : 'Reviewed resource library'));
  const course = h('select', { id: 'rs-course', 'aria-label': 'Course' }, h('option', { value: '' }, 'All courses'), courses.map((c) => h('option', { value: c.id }, `${c.code} ${c.name}`)));
  const q = h('input', { id: 'rs-q', type: 'search', placeholder: 'Search title or text', maxlength: 60, 'aria-label': 'Search' });
  const kind = h('select', { id: 'rs-kind', 'aria-label': 'Type' }, h('option', { value: '' }, 'Any type'), Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const status = h('select', { id: 'rs-status', 'aria-label': 'Review status' }, h('option', { value: '' }, 'Any status'), ['official', 'faculty_verified', 'community', 'pending'].map((s) => h('option', { value: s }, STATUS_LABEL[s])));
  const list = h('div', { 'aria-live': 'polite' });
  root.append(h('div', { class: 'filters' }, course, q, kind, status), list);
  let seq = 0;
  let timer;
  async function load() {
    const mine = ++seq;
    clear(list).append(skeletonRows(4));
    const p = new URLSearchParams();
    if (savedOnly) p.set('saved', '1');
    if (course.value) p.set('course_id', course.value);
    if (q.value.trim()) p.set('q', q.value.trim());
    if (kind.value) p.set('kind', kind.value);
    if (status.value) p.set('status', status.value);
    try {
      const { resources: rs } = await get(`/api/resources?${p}`);
      if (mine !== seq || !ctx.alive()) return;
      clear(list);
      list.append(rs.length ? h('div', {}, rs.map((r) => resourceCard(r, { onChange: load }))) : empty(savedOnly ? 'Nothing saved yet' : 'No resources match', savedOnly ? 'Use Save on any resource to find it here later.' : 'Change the filters or add one yourself below.'));
    } catch (e) { if (mine === seq) clear(list).append(errorNotice(e)); }
  }
  for (const el of [course, kind, status]) el.addEventListener('change', load);
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  ctx.onCleanup(() => clearTimeout(timer));
  load();

  if (!savedOnly) root.append(await submitForm(courses, ctx));
}

async function drawSubjectFolders(container, ctx) {
  clear(container).append(h('h2', {}, 'Subject folders (Shared campus drive)'), skeletonRows(2));
  let selectedId = null;
  const grid = h('div', { class: 'folder-grid' });
  const detail = h('div', { class: 'stack' });

  async function loadFolder(cid) {
    selectedId = cid;
    grid.querySelectorAll('.folder-card').forEach((btn) => btn.setAttribute('aria-pressed', String(Number(btn.dataset.cid) === cid)));
    clear(detail).append(skeletonRows(2));
    try {
      const d = await get(`/api/folders?course_id=${cid}`);
      if (!ctx.alive()) return;
      const c = d.course;
      const fileInput = h('input', { id: `fld-file-${c.id}`, name: 'file', type: 'file', accept: '.pdf,.txt,.md,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.zip', required: true });
      const titleInput = h('input', { id: `fld-title-${c.id}`, name: 'title', maxlength: 140, placeholder: 'e.g. Unit 1 Lecture Notes PDF' });
      const notesInput = h('input', { id: `fld-notes-${c.id}`, name: 'notes', maxlength: 300, placeholder: 'Short description (optional)' });
      const uploadForm = h('form', { class: 'panel stack', novalidate: true },
        h('h3', {}, `Upload a file to ${c.code} ${c.name}`),
        h('p', { class: 'small muted flush' }, 'Select any study file from your computer (local drive) up to 4 MB. Everyone at your university in this subject folder can view and download it.'),
        field('Choose file from local drive', fileInput),
        field('File title', titleInput),
        field('Notes', notesInput, '(optional)'),
        h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Upload to folder'));
      uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const file = fileInput.files?.[0];
        if (!file) { toast('Choose a file from your drive first.', 'bad'); return; }
        const btn = uploadForm.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const uploaded = await uploadLocalFile(file);
          const title = titleInput.value.trim() || file.name;
          const payload = { file_id: uploaded.id, title };
          if (notesInput.value.trim()) payload.notes = notesInput.value.trim();
          await post(`/api/folders/${c.id}/files`, payload);
          toast('File uploaded to subject folder!');
          await drawSubjectFolders(container, ctx);
        } catch (err) {
          fail(err);
          btn.disabled = false;
        }
      });

      clear(detail).append(
        h('div', { class: 'panel stack' },
          h('div', { class: 'row between' },
            h('h3', { class: 'flush' }, `Folder: ${c.code} — ${c.name}`),
            h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { selectedId = null; clear(detail); grid.querySelectorAll('.folder-card').forEach((b) => b.setAttribute('aria-pressed', 'false')); } }, 'Close folder')),
          d.files.length
            ? h('ul', { class: 'ruled' }, d.files.map((x) => h('li', {},
                h('div', { class: 'row between' },
                  h('div', {}, h('strong', {}, x.title), x.notes ? h('div', { class: 'small muted' }, x.notes) : null,
                    h('div', { class: 'small muted' }, 'Uploaded by ', personLink(x.uploader), ` • ${fmtDate(x.created_at)}`)),
                  h('div', { class: 'row' },
                    fileDownloadLink(x.file),
                    x.mine ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => { try { await del(`/api/folders/files/${x.id}`); toast('File removed.'); loadFolder(c.id); } catch (err) { fail(err); } } }, 'Remove') : null)))))
            : h('p', { class: 'muted flush' }, 'No files uploaded to this subject folder yet. Be the first to contribute below!')),
        uploadForm);
    } catch (err) {
      clear(detail).append(errorNotice(err));
    }
  }

  try {
    const { folders } = await get('/api/folders');
    if (!ctx.alive()) return;
    clear(container).append(h('h2', {}, 'Subject folders (Shared campus drive)'), h('p', { class: 'small muted' }, 'Click any subject folder to view shared files or upload notes from your local drive.'));
    if (!folders.length) {
      container.append(empty('No subject folders yet', 'Courses added at your university appear here as shared folders.'));
      return;
    }
    for (const f of folders) {
      const total = (f.folder_count || 0) + (f.resource_count || 0);
      const card = h('button', { type: 'button', class: 'folder-card', 'data-cid': f.id, 'aria-pressed': String(selectedId === f.id), onclick: () => loadFolder(f.id) },
        h('div', {}, h('div', { class: 'folder-code' }, f.code), h('div', {}, f.name)),
        h('div', { class: 'row between small muted' },
          h('span', {}, f.background || f.department || 'Subject'),
          h('span', {}, `${total} item${total === 1 ? '' : 's'}`)));
      grid.append(card);
    }
    container.append(grid, detail);
  } catch (err) {
    clear(container).append(errorNotice(err));
  }
}

async function submitForm(courses, ctx) {
  const course = h('select', { id: 'up-course', name: 'course_id' }, h('option', { value: '' }, 'Choose a course'), courses.map((c) => h('option', { value: c.id }, `${c.code} ${c.name}`)));
  const topicSel = h('select', { id: 'up-topic', name: 'topic_id' }, h('option', { value: '' }, 'No specific topic'));
  course.addEventListener('change', async () => {
    clear(topicSel).append(h('option', { value: '' }, 'No specific topic'));
    if (!course.value) return;
    try {
      const d = await get(`/api/syllabus?course_id=${course.value}`);
      for (const u of d.units) for (const t of u.topics) topicSel.append(h('option', { value: t.id }, `Unit ${u.unit_no}: ${t.name}`));
    } catch { /* leave the default option */ }
  });
  const fileInput = h('input', { id: 'up-file', name: 'file', type: 'file', accept: '.pdf,.txt,.md,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.zip' });
  const perm = h('input', { id: 'up-perm', name: 'permission', type: 'checkbox' });
  const f = h('form', { class: 'panel stack', novalidate: true },
    h('h2', {}, 'Submit a formal resource for teacher review'),
    h('p', { class: 'small muted' }, 'Upload a file from your local drive, paste notes, or share an https link. A teacher reviews it before marking it verified.'),
    h('div', { class: 'grid2' }, field('Course', course), field('Topic', topicSel)),
    field('Title', h('input', { id: 'up-title', name: 'title', maxlength: 140 })),
    field('Type', h('select', { id: 'up-kind', name: 'kind' }, Object.entries(KIND_LABEL).map(([k, v]) => h('option', { value: k }, v)))),
    field('Upload file from local drive', fileInput, '(optional, PDF/DOC/PPT/IMG/TXT/ZIP up to 4 MB)'),
    field('Text', h('textarea', { id: 'up-body', name: 'body', maxlength: 8000 }), '(optional if uploading a file or link)'),
    field('Link', h('input', { id: 'up-url', name: 'url', type: 'url', maxlength: 300, placeholder: 'https://' }), '(optional, https only)'),
    field('Source', h('input', { id: 'up-source', name: 'source', maxlength: 200 }), 'Where did it come from? (optional)'),
    h('div', { class: 'field' }, h('label', { class: 'check', for: 'up-perm' }, perm, h('span', {}, 'I wrote this or have permission to share it, and it follows the terms of service.'))),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Submit for review'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!perm.checked) { toast('Confirm that you have the right to share this.', 'bad'); perm.focus(); return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = { course_id: Number(course.value) || 0, title: f.title.value, kind: f.kind.value, permission: 1 };
      if (topicSel.value) body.topic_id = Number(topicSel.value);
      if (fileInput.files?.[0]) {
        const uploaded = await uploadLocalFile(fileInput.files[0]);
        body.file_id = uploaded.id;
      }
      if (f.body.value.trim()) body.body = f.body.value;
      if (f.url.value.trim()) body.url = f.url.value;
      if (f.source.value.trim()) body.source = f.source.value;
      const r = await post('/api/resources', body);
      toast(r.status === 'official' ? 'Published as an official teacher resource.' : 'Submitted. A teacher will review it.');
      ctx.refresh();
    } catch (err) {
      showFieldErrors(f, err.fields);
      fail(err);
      btn.disabled = false;
    }
  });
  return f;
}

export async function resource(root, id, ctx) {
  const d = await get(`/api/resources/${id}`);
  if (!ctx.alive()) return;
  const r = d.resource;
  const link = r.url ? safeHttps(r.url) : null;
  root.append(h('p', {}, h('a', { href: '#/resources' }, 'Back to resources')),
    h('h1', {}, r.title),
    h('div', { class: 'meta row' }, statusBadge(r.status), h('span', { class: 'tag' }, KIND_LABEL[r.kind]), h('strong', {}, r.course.code), r.topic ? h('a', { href: `#/topic/${r.topic.id}` }, r.topic.name) : null, h('span', { class: 'tag' }, `Version ${r.version}`)),
    r.review_note ? h('div', { class: 'notice' }, h('strong', {}, 'Reviewer note.'), r.review_note) : null,
    r.body ? h('div', { class: 'panel' }, h('p', { class: 'preline flush' }, r.body)) : null,
    r.file ? h('div', { class: 'panel' }, fileDownloadLink(r.file)) : null,
    link ? h('p', {}, h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Open the linked resource'), h('span', { class: 'small muted' }, ' (external site, not checked by us)')) : null,
    h('p', { class: 'small muted' }, 'Shared by ', personLink(r.uploader), r.source ? `. Source: ${r.source}` : '', `. Updated ${fmtDate(r.updated_at)}.`),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await post(`/api/resources/${r.id}/bookmark`); ctx.refresh(); } catch (e) { fail(e); } } }, r.saved ? 'Remove from saved' : 'Save'),
      r.mine ? null : reportControl('resource', r.id)),
    r.status === 'pending' && r.can_review ? h('div', { class: 'panel' }, h('h2', {}, 'Review this resource'), reviewControls(r, () => ctx.refresh())) : null);
  if (r.mine) {
    const f = h('form', { class: 'panel stack', novalidate: true }, h('h2', {}, 'Update this resource'), h('p', { class: 'small muted' }, 'Saving creates a new version. A teacher reviews it again unless you are the assigned teacher.'),
      field('Title', h('input', { id: 'ed-title', name: 'title', maxlength: 140, value: r.title })), field('Text', h('textarea', { id: 'ed-body', name: 'body', maxlength: 8000 }, r.body || '')),
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save new version'));
    f.addEventListener('submit', async (e) => { e.preventDefault(); try { await patch(`/api/resources/${r.id}`, { title: f.title.value, body: f.body.value }); toast('New version saved.'); ctx.refresh(); } catch (err) { showFieldErrors(f, err.fields); fail(err); } });
    root.append(f);
  }
  root.append(h('section', {}, h('h2', {}, 'Version history'), h('ul', { class: 'ruled' }, d.versions.map((v) => h('li', {}, `Version ${v.version}: ${v.title}`, h('span', { class: 'small muted' }, `, ${fmtDateTime(v.created_at)}`))))));
}

/* ---------- practice checks & task manager ---------- */

export async function quiz(root, arg, ctx) {
  if (!arg) {
    root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Practice checks & Task Manager'), h('p', { class: 'muted' }, 'Short concept checks plus your personal study to-do list.'))));
    const taskBox = h('section', { class: 'panel stack' });
    const quizBox = h('section', { class: 'stack' });
    root.append(h('div', { class: 'grid2' }, quizBox, taskBox));

    drawTaskManager(taskBox, ctx);

    quizBox.append(h('h2', {}, 'Topic practice checks'), skeletonRows(3));
    const { courses } = await get('/api/courses');
    if (!ctx.alive()) return;
    clear(quizBox).append(h('h2', {}, 'Topic practice checks'));
    let any = false;
    for (const c of courses) {
      const d = await get(`/api/syllabus?course_id=${c.id}`);
      const withQ = d.units.flatMap((u) => u.topics.filter((t) => t.questions > 0));
      if (!withQ.length) continue;
      any = true;
      quizBox.append(h('section', { class: 'panel stack' }, h('h3', {}, `${c.code} ${c.name}`), h('ul', { class: 'ruled' }, withQ.map((t) => h('li', { class: 'row between' }, h('span', {}, h('strong', {}, t.name), h('span', { class: 'small muted' }, ` ${t.questions} questions`)), h('a', { class: 'btn btn-sm btn-primary', href: `#/quiz/${t.id}` }, 'Start'))))));
    }
    if (!any) quizBox.append(empty('No practice checks yet', 'Teachers can add questions to topics. Check back soon.'));
    return;
  }
  const topicParts = arg.split('?')[0];
  const mode = null;
  const d = await get(`/api/quiz/${topicParts}`);
  if (!ctx.alive()) return;
  const bookingId = new URLSearchParams(location.hash.split('?')[1] || '').get('booking');
  root.append(h('p', {}, h('a', { href: `#/topic/${d.topic.id}` }, `Back to ${d.topic.name}`)), h('h1', {}, `Practice check: ${d.topic.name}`), h('p', { class: 'muted' }, d.note));
  const answers = new Map();
  const f = h('form', { class: 'stack', novalidate: true });
  d.questions.forEach((q, i) => {
    f.append(h('fieldset', { class: 'panel' }, h('legend', {}, h('strong', {}, `Question ${i + 1} of ${d.questions.length}`)), h('p', {}, q.prompt),
      q.options.map((o, j) => h('label', { class: 'check', for: `q${q.id}-${j}` }, h('input', { type: 'radio', name: `q${q.id}`, id: `q${q.id}-${j}`, value: j, onchange: () => answers.set(q.id, j) }), h('span', {}, o)))));
  });
  const kind = h('select', { id: 'quiz-kind', name: 'kind' }, h('option', { value: 'practice' }, 'Practice'), h('option', { value: 'baseline' }, 'Baseline before studying'), h('option', { value: 'followup', selected: !!bookingId }, 'Follow-up after studying or a session'));
  f.append(field('This attempt is', kind), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Submit answers'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (answers.size < d.questions.length) { toast('Answer every question first.', 'bad'); return; }
    const body = { kind: kind.value, answers: [...answers].map(([question_id, chosen]) => ({ question_id, chosen })) };
    if (bookingId) body.booking_id = Number(bookingId);
    try { const res = await post(`/api/quiz/${topicParts}/attempt`, body); renderResult(root, d, res, ctx); } catch (err) { fail(err); }
  });
  root.append(f);
  void mode;
}

function renderResult(root, d, res, ctx) {
  clear(root).append(
    h('p', {}, h('a', { href: `#/topic/${d.topic.id}` }, `Back to ${d.topic.name}`)),
    h('h1', {}, `You answered ${res.score} of ${res.total} correctly`),
    h('p', { class: 'muted' }, res.note),
    h('div', { class: res.comparison.available ? 'notice ok' : 'notice' }, h('strong', {}, res.comparison.available ? `Previous attempt ${res.comparison.previous.score} of ${res.comparison.previous.total}.` : 'Comparison.'), res.comparison.note),
    h('h2', {}, 'Concept by concept'),
    h('ul', { class: 'ruled' }, res.concepts.map((c) => h('li', {}, h('strong', {}, c.concept), ` ${c.correct} of ${c.total}`, h('div', { class: 'small' }, c.text)))),
    h('h2', {}, 'Review your answers'),
    h('div', {}, res.review.map((q, i) => h('article', { class: 'item' }, h('h3', {}, `${i + 1}. ${q.prompt}`),
      h('p', { class: 'small flush' }, h('strong', {}, 'You chose: '), q.options[q.chosen], q.correct ? ' (correct)' : ' (not correct)'),
      q.correct ? null : h('p', { class: 'small flush' }, h('strong', {}, 'Correct answer: '), q.options[q.correct_index]),
      h('p', { class: 'small muted' }, q.explanation)))),
    h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: `#/missions/new/${d.topic.id}` }, 'Plan a mission from these results'), h('a', { class: 'btn', href: `#/topic/${d.topic.id}` }, 'See resources and tutors'), h('a', { class: 'btn', href: '#/progress' }, 'Open my progress')));
  window.scrollTo(0, 0);
  void ctx;
}

async function drawTaskManager(container, ctx) {
  let filter = 'all';
  const listEl = h('div', { class: 'stack' });
  const tabs = h('div', { class: 'tabrow', role: 'group', 'aria-label': 'Filter tasks' });

  const form = h('form', { class: 'stack', novalidate: true },
    h('h2', {}, 'Study Task Manager (To-Do List)'),
    field('Task to complete', h('input', { id: 'tk-title', name: 'title', maxlength: 160, placeholder: 'e.g. Solve 5 NFA to DFA problems' })),
    h('div', { class: 'grid2' },
      field('Subject code', h('input', { id: 'tk-code', name: 'course_code', maxlength: 20, placeholder: 'e.g. CS301' }), '(optional)'),
      field('Due date', h('input', { id: 'tk-due', name: 'due_date', type: 'date' }), '(optional)')),
    field('Priority', h('select', { id: 'tk-prio', name: 'priority' },
      h('option', { value: 'medium' }, 'Medium priority'),
      h('option', { value: 'high' }, 'High priority'),
      h('option', { value: 'low' }, 'Low priority'))),
    h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Add task'));

  let tasks = [];
  const drawList = () => {
    clear(tabs);
    for (const [k, lbl] of [['all', 'All'], ['open', 'To do'], ['done', 'Completed']]) {
      tabs.append(h('button', { type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; drawList(); } }, lbl));
    }
    clear(listEl);
    const visible = tasks.filter((t) => (filter === 'open' ? !t.done : filter === 'done' ? t.done : true));
    if (!visible.length) {
      listEl.append(h('p', { class: 'small muted flush' }, filter === 'done' ? 'No completed tasks yet.' : 'No tasks yet. Add a study task above.'));
      return;
    }
    for (const t of visible) {
      const row = h('div', { class: `task-row${t.done ? ' done' : ''}` },
        h('label', { class: 'check', for: `tk-${t.id}` },
          h('input', {
            id: `tk-${t.id}`, type: 'checkbox', checked: t.done,
            onchange: async () => {
              try { const r = await post(`/api/tasks/${t.id}/toggle`); t.done = r.done; drawList(); } catch (err) { fail(err); }
            },
          }),
          h('span', { class: 'task-title' },
            h('strong', {}, t.title),
            ' ',
            t.course_code ? h('span', { class: 'tag' }, t.course_code) : null,
            ' ',
            h('span', { class: `tag${t.priority === 'high' ? ' warn' : ''}` }, t.priority),
            t.due_date ? h('span', { class: 'small muted' }, ` Due ${t.due_date}`) : null)),
        h('button', {
          class: 'btn btn-sm btn-danger', type: 'button',
          onclick: async () => { try { await del(`/api/tasks/${t.id}`); tasks = tasks.filter((x) => x.id !== t.id); drawList(); } catch (err) { fail(err); } },
        }, 'Delete'));
      listEl.append(row);
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { title: form.title.value, priority: form.priority.value };
    if (form.course_code.value.trim()) payload.course_code = form.course_code.value.trim();
    if (form.due_date.value) payload.due_date = form.due_date.value;
    try {
      await post('/api/tasks', payload);
      form.reset();
      const d = await get('/api/tasks');
      tasks = d.tasks;
      drawList();
      toast('Task added.');
    } catch (err) {
      showFieldErrors(form, err.fields);
      fail(err);
    }
  });

  clear(container).append(form, tabs, listEl);
  try {
    const d = await get('/api/tasks');
    if (!ctx.alive()) return;
    tasks = d.tasks;
    drawList();
  } catch (err) {
    clear(listEl).append(errorNotice(err));
  }
}

/* ---------- missions & personal calendar ---------- */

export async function missions(root, arg, ctx) {
  const [mode, topicId] = (arg || '').split('/');
  void mode;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  if (parts[1] === 'new' && parts[2]) return newMission(root, parts[2], ctx);
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'My missions & Calendar'), h('p', { class: 'muted' }, 'Track your study plans and note important dates like exams, events, and deadlines.'))));

  const calSection = h('section', { class: 'panel stack' });
  const missionsSection = h('section', { class: 'stack' });
  root.append(calSection, missionsSection);

  drawCalendar(calSection, ctx);

  missionsSection.append(h('h2', {}, 'Learning missions'), skeletonRows(2));
  const { missions: ms } = await get('/api/missions');
  if (!ctx.alive()) return;
  clear(missionsSection).append(h('h2', {}, 'Learning missions'));
  if (!ms.length) {
    missionsSection.append(empty('No missions yet', 'Open a topic and choose Plan a learning mission.', h('a', { class: 'btn btn-primary', href: '#/syllabus' }, 'Open the syllabus')));
    return;
  }
  void topicId;
  for (const m of ms) {
    const box = h('section', { class: 'panel stack' });
    const draw = () => {
      const done = m.steps.filter((s) => s.done).length;
      clear(box).append(h('h3', {}, `${m.course_code}: ${m.topic}`), h('p', { class: 'small muted' }, `${done} of ${m.steps.length} steps done. ${m.basis}`),
        m.goal ? h('p', { class: 'preline' }, h('strong', {}, 'Goal: '), m.goal) : null,
        h('ul', { class: 'ruled' }, m.steps.map((s) => h('li', {}, h('label', { class: 'check', for: `st-${s.id}` },
          h('input', { type: 'checkbox', id: `st-${s.id}`, checked: s.done, onchange: async () => { try { const r = await post(`/api/missions/${m.id}/steps/${s.id}/toggle`); s.done = r.done; m.status = r.mission_done ? 'done' : 'active'; draw(); } catch (e) { fail(e); } } }),
          h('span', {}, s.title, ' ', stepLink(s, m))))) ),
        h('div', { class: 'row' }, h('span', { class: 'tag' }, m.status === 'done' ? 'Finished' : 'In progress'), h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await post(`/api/missions/${m.id}/drop`); box.remove(); toast('Mission dropped.'); } catch (e) { fail(e); } } }, 'Drop this mission')));
    };
    draw();
    missionsSection.append(box);
  }
}

async function drawCalendar(container, ctx) {
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let selectedDate = todayStr;
  let events = [];

  const monthLabel = h('h2', { class: 'flush' });
  const grid = h('div', { class: 'cal-grid' });
  const dayList = h('div', { class: 'stack' });

  const dateInput = h('input', { id: 'cal-date', name: 'event_date', type: 'date', value: selectedDate, required: true });
  const titleInput = h('input', { id: 'cal-title', name: 'title', maxlength: 140, placeholder: 'e.g. CS301 Mid-sem Exam' });
  const catSel = h('select', { id: 'cal-cat', name: 'category' },
    h('option', { value: 'exam' }, 'Exam'),
    h('option', { value: 'event' }, 'Campus / Personal Event'),
    h('option', { value: 'assignment' }, 'Assignment / Deadline'),
    h('option', { value: 'study' }, 'Study Milestone'),
    h('option', { value: 'personal' }, 'Personal Note'));
  const notesInput = h('input', { id: 'cal-notes', name: 'notes', maxlength: 300, placeholder: 'Room, syllabus units, or reminder (optional)' });

  const addForm = h('form', { class: 'stack', novalidate: true },
    h('h3', {}, 'Add important date'),
    field('Title', titleInput),
    h('div', { class: 'grid2' }, field('Date', dateInput), field('Category', catSel)),
    field('Notes', notesInput, '(optional)'),
    h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Save to calendar'));

  const renderCal = () => {
    const first = new Date(viewYear, viewMonth, 1);
    monthLabel.textContent = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    clear(grid);
    for (const d of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      grid.append(h('div', { class: 'cal-dow' }, d));
    }
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevDays = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = 0; i < 42; i++) {
      let y = viewYear;
      let m = viewMonth;
      let dayNum;
      let other = false;
      if (i < startOffset) {
        dayNum = prevDays - startOffset + 1 + i;
        m -= 1;
        if (m < 0) { m = 11; y -= 1; }
        other = true;
      } else if (i >= startOffset + daysInMonth) {
        dayNum = i - startOffset - daysInMonth + 1;
        m += 1;
        if (m > 11) { m = 0; y += 1; }
        other = true;
      } else {
        dayNum = i - startOffset + 1;
      }
      const iso = `${y}-${pad(m + 1)}-${pad(dayNum)}`;
      const dayEvents = events.filter((ev) => ev.event_date === iso);
      const cls = ['cal-cell', other ? 'other' : '', iso === todayStr ? 'today' : '', iso === selectedDate ? 'selected' : ''].filter(Boolean).join(' ');
      grid.append(h('button', {
        type: 'button',
        class: cls,
        onclick: () => {
          selectedDate = iso;
          dateInput.value = iso;
          renderCal();
        },
      },
      h('span', {}, String(dayNum)),
      dayEvents.length ? h('div', { class: 'cal-dots' }, dayEvents.slice(0, 4).map(() => h('span', { class: 'cal-dot' }))) : null));
    }

    const onDay = events.filter((ev) => ev.event_date === selectedDate);
    const upcoming = events.filter((ev) => ev.event_date >= todayStr).slice(0, 8);
    clear(dayList).append(
      h('h3', {}, `Dates on ${selectedDate}`),
      onDay.length
        ? h('ul', { class: 'ruled' }, onDay.map((ev) => h('li', { class: 'row between' },
            h('div', {}, h('strong', {}, ev.title), ' ', h('span', { class: 'tag' }, ev.category), ev.notes ? h('div', { class: 'small muted' }, ev.notes) : null),
            ev.readonly ? null : h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => { try { await del(`/api/calendar/${ev.id}`); events = events.filter((x) => x.id !== ev.id); renderCal(); toast('Removed.'); } catch (err) { fail(err); } } }, 'Remove'))))
        : h('p', { class: 'small muted flush' }, 'Nothing noted on this date yet.'),
      h('h3', {}, 'Upcoming important dates'),
      upcoming.length
        ? h('ul', { class: 'ruled' }, upcoming.map((ev) => h('li', { class: 'row between' },
            h('div', {}, h('strong', {}, ev.event_date), ` — ${ev.title} `, h('span', { class: 'tag' }, ev.category)),
            ev.readonly ? null : h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { selectedDate = ev.event_date; dateInput.value = ev.event_date; renderCal(); } }, 'View'))))
        : h('p', { class: 'small muted flush' }, 'No upcoming dates noted yet.'));
  };

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { title: titleInput.value, event_date: dateInput.value, category: catSel.value };
    if (notesInput.value.trim()) payload.notes = notesInput.value.trim();
    try {
      await post('/api/calendar', payload);
      titleInput.value = '';
      notesInput.value = '';
      selectedDate = dateInput.value;
      const d = await get('/api/calendar');
      events = d.events;
      renderCal();
      toast('Saved to your personal calendar.');
    } catch (err) {
      showFieldErrors(addForm, err.fields);
      fail(err);
    }
  });

  const nav = h('div', { class: 'row between' },
    monthLabel,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { viewMonth -= 1; if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; } renderCal(); } }, 'Prev'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { viewYear = now.getFullYear(); viewMonth = now.getMonth(); selectedDate = todayStr; dateInput.value = todayStr; renderCal(); } }, 'Today'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { viewMonth += 1; if (viewMonth > 11) { viewMonth = 0; viewYear += 1; } renderCal(); } }, 'Next')));

  clear(container).append(
    h('div', { class: 'cal-wrap' },
      h('div', { class: 'stack' }, nav, grid),
      h('div', { class: 'stack' }, addForm, dayList)));

  try {
    const d = await get('/api/calendar');
    if (!ctx.alive()) return;
    events = d.events;
    renderCal();
  } catch (err) {
    clear(dayList).append(errorNotice(err));
  }
}

function stepLink(s, m) {
  if (s.kind === 'read' || (s.kind === 'example' && s.ref_id)) return h('a', { class: 'small', href: `#/resource/${s.ref_id}` }, 'Open');
  if (s.kind === 'quiz' || s.kind === 'followup') return h('a', { class: 'small', href: `#/quiz/${m.topic_id}` }, 'Start check');
  if (s.kind === 'tutor' && s.ref_id) return h('a', { class: 'small', href: `#/offer/${s.ref_id}` }, 'See the tutor');
  if (s.kind === 'review') return h('a', { class: 'small', href: `#/topic/${m.topic_id}` }, 'Open topic');
  return null;
}

async function newMission(root, topicId, ctx) {
  root.append(h('h1', {}, 'Plan a learning mission'));
  const goal = h('textarea', { id: 'ms-goal', name: 'goal', maxlength: 300, placeholder: 'For example: I understand NFA but get stuck converting to DFA before my exam.' });
  const exam = h('input', { id: 'ms-exam', name: 'exam_date', type: 'date' });
  const out = h('div', {});
  const f = h('form', { class: 'panel stack', novalidate: true }, field('Your goal', goal, '(optional)'), field('Exam date', exam, '(optional)'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Build my plan'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { topic_id: Number(topicId) };
    if (goal.value.trim()) body.goal = goal.value;
    if (exam.value) body.exam_date = new Date(`${exam.value}T09:00:00`).toISOString();
    clear(out).append(skeletonRows(3));
    try {
      const plan = await post('/api/missions/preview', body);
      const skip = new Set();
      clear(out).append(h('section', { class: 'panel stack' },
        h('h2', {}, `${plan.topic.course_code}: ${plan.topic.name}`),
        h('p', {}, plan.basis), h('p', { class: 'small muted' }, plan.engine),
        h('p', { class: 'small' }, 'Untick any step you do not want. Nothing is booked or paid for you.'),
        h('ul', { class: 'ruled' }, plan.steps.map((s) => h('li', {}, h('label', { class: 'check', for: `ps-${s.position}` }, h('input', { type: 'checkbox', id: `ps-${s.position}`, checked: true, onchange: (ev) => { ev.target.checked ? skip.delete(s.position) : skip.add(s.position); } }), h('span', {}, s.title))))),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { try { await post('/api/missions', { ...body, skip: [...skip] }); toast('Mission saved.'); location.hash = '#/missions'; } catch (err) { fail(err); } } }, 'Accept this plan'),
          h('a', { class: 'btn', href: `#/topic/${topicId}` }, 'Discard'))));
    } catch (err) { clear(out).append(errorNotice(err)); }
  });
  root.append(f, out);
  void ctx;
}

/* ---------- progress ---------- */

export async function progress(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'My progress'), h('p', { class: 'muted' }, 'Your practice check history. Scores are indicators, not proof of what caused a change.'))));
  const d = await get('/api/progress');
  if (!ctx.alive()) return;
  if (!d.topics.length && !d.statuses.length) { root.append(empty('Nothing to show yet', 'Take a practice check or mark a topic to start your record.', h('a', { class: 'btn btn-primary', href: '#/quiz' }, 'Open practice checks'))); return; }
  for (const t of d.topics) {
    root.append(h('section', { class: 'panel stack' }, h('h2', {}, `${t.course_code}: ${t.topic}`),
      h('div', { class: t.comparison.available ? 'notice ok' : 'notice' }, h('strong', {}, 'First and latest attempt.'), t.comparison.available ? `${t.comparison.first.score} of ${t.comparison.first.total}, then ${t.comparison.latest.score} of ${t.comparison.latest.total}. ` : '', t.comparison.note),
      h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Kind'), h('th', { scope: 'col' }, 'Score'))),
        h('tbody', {}, t.attempts.map((a) => h('tr', {}, h('td', {}, fmtDateTime(a.created_at)), h('td', {}, { baseline: 'Baseline', followup: 'Follow-up', practice: 'Practice' }[a.kind]), h('td', {}, `${a.score} of ${a.total}`)))))),
      h('a', { class: 'btn btn-sm', href: `#/quiz/${t.topic_id}` }, 'Try again')));
  }
  if (d.statuses.length) root.append(h('section', { class: 'panel' }, h('h2', {}, 'Your topic statuses'), h('ul', { class: 'ruled' }, d.statuses.map((s) => h('li', {}, `${s.course_code}: ${s.topic}`, h('span', { class: 'tag' }, MY_STATUS[s.status]))))));
}

/* ---------- difficulty radar (teachers) ---------- */

export async function radar(root, arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Difficulty radar'), h('p', { class: 'muted' }, 'Combined student responses by topic, for teachers of the course.'))));
  if (!['teacher', 'admin'].includes(ctx.state.user.role)) { root.append(empty('For teachers', 'Students can mark topics on the syllabus. Teachers of the course see the combined result here.', h('a', { class: 'btn', href: '#/syllabus' }, 'Open the syllabus'))); return; }
  const { sel } = await coursePicker(ctx, arg, (v) => { location.hash = v ? `#/radar/${v}` : '#/radar'; });
  root.append(h('div', { class: 'filters' }, sel));
  if (!arg) { root.append(empty('Choose a course', 'Pick one of your assigned courses.')); return; }
  const d = await get(`/api/radar?course_id=${encodeURIComponent(arg)}`);
  if (!ctx.alive()) return;
  root.append(h('div', { class: 'notice' }, h('strong', {}, 'Read with care.'), d.note));
  root.append(h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, ['Unit', 'Topic', 'Responses', 'Understood', 'Need practice', 'Need help', 'Not studied', 'Approved resources'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, d.topics.map((t) => t.hidden
      ? h('tr', {}, h('td', {}, String(t.unit_no)), h('td', {}, t.name), h('td', { colspan: 5 }, `Fewer than ${d.minimum_responses} responses, hidden to protect students`), h('td', {}, String(t.resources)))
      : h('tr', {}, h('td', {}, String(t.unit_no)), h('td', {}, h('strong', {}, t.name), t.suggestion ? h('div', { class: 'small muted' }, t.suggestion) : null), h('td', {}, String(t.responses)), h('td', {}, String(t.understood)), h('td', {}, String(t.needs_practice)), h('td', {}, String(t.needs_help)), h('td', {}, String(t.not_studied)), h('td', {}, String(t.resources))))))));
}

/* ---------- handover ---------- */

export async function handover(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Senior handover'), h('p', { class: 'muted' }, 'Study advice, organised notes and uploaded files from seniors, reviewed by teachers before recommendation.'))));
  const [{ handovers }, { courses }] = await Promise.all([get('/api/handovers'), get('/api/courses')]);
  if (!ctx.alive()) return;
  root.append(handovers.length
    ? h('div', {}, handovers.map((x) => h('article', { class: 'item' }, h('h3', {}, x.title),
        h('div', { class: 'meta' }, h('strong', {}, x.course.code), h('span', { class: 'tag' }, x.status === 'approved' ? 'Approved by a teacher' : x.status === 'pending' ? 'Pending review' : 'Rejected')),
        h('p', { class: 'preline' }, x.body),
        x.file ? h('div', { class: 'small' }, fileDownloadLink(x.file)) : null,
        h('p', { class: 'small muted' }, 'By ', x.author_id ? personLink({ id: x.author_id, name: x.author }) : x.author, `, ${fmtDate(x.created_at)}`),
        x.review_note ? h('div', { class: 'notice' }, h('strong', {}, 'Reviewer note.'), x.review_note) : null,
        h('div', { class: 'actions' }, x.mine ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => { try { await del(`/api/handovers/${x.id}`); toast('Removed.'); ctx.refresh(); } catch (e) { fail(e); } } }, 'Delete') : reportControl('handover', x.id)))))
    : empty('No handovers yet', 'Seniors who finished a course can share what helped them.'));
  const fileInput = h('input', { id: 'ho-file', name: 'file', type: 'file', accept: '.pdf,.txt,.md,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.zip' });
  const perm = h('input', { id: 'ho-perm', name: 'permission', type: 'checkbox' });
  const show = h('input', { id: 'ho-show', name: 'show_author', type: 'checkbox' });
  const f = h('form', { class: 'panel stack', novalidate: true },
    h('h2', {}, 'Write a handover'),
    h('p', { class: 'small muted' }, 'Share explanations, study order, revision checklists, and upload study files from your local drive. Do not include leaked exams or copyrighted material.'),
    field('Course', h('select', { id: 'ho-course', name: 'course_id' }, h('option', { value: '' }, 'Choose a course'), courses.map((c) => h('option', { value: c.id }, `${c.code} ${c.name}`)))),
    field('Title', h('input', { id: 'ho-title', name: 'title', maxlength: 140 })),
    field('Upload handover file from local drive', fileInput, '(optional, PDF/DOC/PPT/IMG/TXT/ZIP up to 4 MB)'),
    field('What should the next batch know?', h('textarea', { id: 'ho-body', name: 'body', maxlength: 8000 }), 'At least 40 characters (or 10 characters when attaching a file).'),
    h('div', { class: 'field' }, h('label', { class: 'check', for: 'ho-show' }, show, h('span', {}, 'Show my name on this handover.'))),
    h('div', { class: 'field' }, h('label', { class: 'check', for: 'ho-perm' }, perm, h('span', {}, 'I wrote this or have permission to share it.'))),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Submit for review'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!perm.checked) { toast('Confirm that you have the right to share this.', 'bad'); return; }
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = { course_id: Number(f.course_id.value) || 0, title: f.title.value, body: f.body.value, show_author: show.checked ? 1 : 0, permission: 1 };
      if (fileInput.files?.[0]) {
        const uploaded = await uploadLocalFile(fileInput.files[0]);
        body.file_id = uploaded.id;
      }
      await post('/api/handovers', body);
      toast('Submitted. A teacher will review it.');
      ctx.refresh();
    } catch (err) {
      showFieldErrors(f, err.fields);
      fail(err);
      btn.disabled = false;
    }
  });
  root.append(f);
}

/* ---------- review queue (teachers) ---------- */

export async function review(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Review queue'), h('p', { class: 'muted' }, 'Resources and handovers waiting for a teacher of the course.'))));
  const q = await get('/api/review-queue');
  if (!ctx.alive()) return;
  if (!q.resources.length && !q.handovers.length) { root.append(empty('Nothing waiting', 'New submissions for your courses will show up here.')); return; }
  if (q.resources.length) root.append(h('h2', {}, 'Resources'), h('div', {}, q.resources.map((r) => h('article', { class: 'item' }, h('h3', {}, r.title), h('div', { class: 'meta' }, h('strong', {}, r.course.code), h('span', { class: 'tag' }, KIND_LABEL[r.kind])), h('p', { class: 'preline' }, r.body || ''), r.file ? h('div', { class: 'small' }, fileDownloadLink(r.file)) : null, r.url ? h('p', { class: 'small' }, `Link: ${r.url}`) : null, h('p', { class: 'small muted' }, `From ${r.uploader.name}. Source: ${r.source || 'not given'}`), reviewControls(r, () => ctx.refresh())))));
  if (q.handovers.length) root.append(h('h2', {}, 'Handovers'), h('div', {}, q.handovers.map((x) => h('article', { class: 'item' }, h('h3', {}, x.title), h('p', { class: 'preline' }, x.body), x.file ? h('div', { class: 'small' }, fileDownloadLink(x.file)) : null, h('p', { class: 'small muted' }, `${x.course_code}, from ${x.author}`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { try { await post(`/api/handovers/${x.id}/review`, { decision: 'approve' }); toast('Approved.'); ctx.refresh(); } catch (e) { fail(e); } } }, 'Approve'),
      h('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: async () => { const note = prompt('Say why (at least 5 characters):') || ''; if (note.length < 5) return; try { await post(`/api/handovers/${x.id}/review`, { decision: 'reject', note }); toast('Rejected.'); ctx.refresh(); } catch (e) { fail(e); } } }, 'Reject'))))));
}
