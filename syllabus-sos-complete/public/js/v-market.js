import { h, clear, get, post, patch, toast, fail, field, showFieldErrors, skeletonRows, fmtDate, credits, modeLabel, rating } from './common.js';
import { empty, errorNotice, offerItem, offerForm, personLink, personTags, reportControl, priceText } from './app-ui.js';

export async function find(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Find a tutor'), h('p', { class: 'muted' }, `Search by course, subject code, or the syllabus topic you want to study at ${ctx.state.user.university.name}.`)),
    h('a', { class: 'btn', href: '#/new-offer' }, 'Offer a course')));
  const { courses } = await get('/api/courses');
  if (!ctx.alive()) return;
  /* Price filter removed; added Subject Code and Topic/Syllabus search. */
  const q = h('input', { id: 'f-q', type: 'search', list: 'f-course-options', placeholder: 'Course name or tutor name', maxlength: 60, autocomplete: 'off', 'aria-label': 'Course name or tutor' });
  const options = h('datalist', { id: 'f-course-options' }, courses.map((c) => h('option', { value: c.name }, c.code)));
  const code = h('input', { id: 'f-code', type: 'search', list: 'f-code-options', placeholder: 'Subject code (e.g. CS301)', maxlength: 20, autocomplete: 'off', 'aria-label': 'Subject code' });
  const codeOptions = h('datalist', { id: 'f-code-options' }, courses.map((c) => h('option', { value: c.code }, c.name)));
  const topic = h('input', { id: 'f-topic', type: 'search', placeholder: 'Topic to study (e.g. NFA to DFA, NPV)', maxlength: 80, autocomplete: 'off', 'aria-label': 'Topic or syllabus subtopic you want to study' });
  const mode = h('select', { id: 'f-mode', 'aria-label': 'Format' }, h('option', { value: '' }, 'Any format'), ['online', 'in_person', 'chat'].map((m) => h('option', { value: m }, modeLabel(m))));
  const list = h('div', { 'aria-live': 'polite' });
  root.append(h('div', { class: 'filters four' }, q, code, topic, mode), options, codeOptions, list);
  let timer;
  let seq = 0;
  async function load() {
    const mine = ++seq;
    clear(list).append(skeletonRows(4));
    const p = new URLSearchParams();
    if (q.value.trim()) p.set('q', q.value.trim());
    if (code.value.trim()) p.set('code', code.value.trim());
    if (topic.value.trim()) p.set('topic', topic.value.trim());
    if (mode.value) p.set('mode', mode.value);
    try {
      const { offers } = await get(`/api/offers?${p}`);
      if (mine !== seq || !ctx.alive()) return;
      clear(list);
      if (!offers.length) {
        list.append(empty('No tutors match yet', 'Try another subject code or topic, or offer this course yourself so others can find you.', h('a', { class: 'btn btn-primary', href: '#/new-offer' }, 'Offer a course')));
      } else {
        list.append(...offers.map((o) => offerItem(o, { showPrice: false })));
      }
    } catch (e) {
      if (mine === seq) clear(list).append(errorNotice(e));
    }
  }
  mode.addEventListener('change', load);
  for (const el of [q, code, topic]) el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 300); });
  ctx.onCleanup(() => clearTimeout(timer));
  load();
}

export async function offer(root, id, ctx) {
  const [{ offer: o, reviews, fee_percent: fee }, wallet] = await Promise.all([get(`/api/offers/${id}`), get('/api/wallet')]);
  if (!ctx.alive()) return;
  root.append(h('p', {}, ctx.state.user.role === 'student' ? h('a', { href: '#/find' }, 'Back to tutors') : h('a', { href: '#/teach' }, 'Back to my listings')),
    h('h1', {}, o.headline),
    h('div', { class: 'meta row small' }, h('strong', {}, o.course.code), o.course.name, h('span', { class: 'tag' }, modeLabel(o.mode)),
      o.mastery === 'complete' ? h('span', { class: 'tag solid' }, 'Knows the whole course') : null));

  const left = h('div', { class: 'stack' });
  left.append(h('section', { class: 'panel stack' },
    h('h2', {}, 'About this listing'),
    o.description ? h('p', { class: 'preline' }, o.description) : h('p', { class: 'muted' }, 'The tutor has not added more details.'),
    (o.syllabus_topics || o.syllabus_subtopics)
      ? h('div', { class: 'syllabus-box' },
          o.syllabus_topics ? h('p', { class: 'flush' }, h('strong', {}, 'Topics covered: '), o.syllabus_topics) : null,
          o.syllabus_subtopics ? h('p', { class: 'small muted flush' }, h('strong', {}, 'Subtopics: '), o.syllabus_subtopics) : null)
      : null,
    o.availability ? h('p', { class: 'flush' }, h('strong', {}, 'Free times: '), o.availability) : null),
  h('section', { class: 'panel' },
    h('h2', {}, 'Tutor'),
    h('p', {}, personLink(o.tutor), ' ', personTags(o.tutor)),
    h('p', { class: 'muted' }, `${rating(o.tutor.rating, o.tutor.rating_count)}. ${o.tutor.sessions_done} session${o.tutor.sessions_done === 1 ? '' : 's'} taught.`),
    h('div', { class: 'row' }, o.mine ? null : h('a', { class: 'btn btn-sm', href: `#/messages/${o.tutor.id}` }, 'Send a message'), h('a', { class: 'btn btn-sm', href: `#/user/${o.tutor.id}` }, 'View profile'), o.mine ? null : reportControl('offer', o.id)),
    h('h3', {}, 'Reviews'),
    reviews.length
      ? h('ul', { class: 'ruled' }, reviews.map((r) => h('li', {}, h('strong', { class: 'stars' }, `${r.rating} out of 5`), ` by ${r.reviewer}, ${fmtDate(r.created_at)}`, r.comment ? h('div', { class: 'preline' }, r.comment) : null)))
      : h('p', { class: 'muted' }, 'No reviews yet.')));

  const right = h('div', {});
  if (o.mine) {
    right.append(h('section', { class: 'panel' }, h('h2', {}, 'This is your listing'), h('p', {}, 'Other students at your university can see it and request sessions.'), h('a', { class: 'btn', href: '#/teach' }, 'Manage your listings')));
  } else {
    const when = h('input', { id: 'b-when', name: 'start_at', type: 'datetime-local', required: true });
    const soon = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000);
    when.min = soon.toISOString().slice(0, 16);
    const durLabel = (m) => {
      if (m < 60) return `${m} minutes`;
      const hrs = Math.floor(m / 60);
      const rest = m % 60;
      return `${hrs} hour${hrs === 1 ? '' : 's'}${rest ? ` ${rest} minutes` : ''}`;
    };
    const dur = h('select', { id: 'b-dur', name: 'duration_min' }, [30, 45, 60, 90, 120, 180].map((m) => h('option', { value: m, selected: m === 60 }, durLabel(m))));
    const summary = h('div', { class: 'notice', 'aria-live': 'polite' });
    const msg = h('textarea', { id: 'b-msg', name: 'message', maxlength: 500 });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Request session');
    const form = h('form', { class: 'panel stack', novalidate: true },
      h('h2', {}, 'Request a session'),
      field('Start time', when),
      field('Length', dur),
      field('Message to the tutor', msg, '(optional)'),
      summary,
      submit);
    const update = () => {
      const mins = Number(dur.value);
      const total = Math.ceil((o.price_per_hour * mins) / 60);
      const cut = Math.floor((total * fee) / 100);
      clear(summary).append(
        h('strong', {}, `You pay ${credits(total)}.`),
        h('div', { class: 'small' }, total === 0 ? 'This session is free.' : `The platform holds it until you confirm the session. Of this, ${credits(cut)} is the ${fee} percent platform fee and ${credits(total - cut)} goes to the tutor.`),
        h('div', { class: 'small' }, `Your balance: ${credits(wallet.balance)}.`),
        total > wallet.balance ? h('div', { class: 'small' }, h('strong', {}, 'Not enough credits. '), h('a', { href: '#/wallet' }, 'Open your wallet')) : null);
      submit.disabled = total > wallet.balance;
    };
    dur.addEventListener('change', update);
    update();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!when.value) { showFieldErrors(form, { start_at: 'Pick a date and time' }); return; }
      submit.disabled = true;
      try {
        const body = { offer_id: o.id, start_at: new Date(when.value).toISOString(), duration_min: Number(dur.value) };
        if (msg.value.trim()) body.message = msg.value;
        await post('/api/bookings', body);
        toast('Session requested. Your credits are held until it is done.');
        location.hash = '#/sessions';
      } catch (err) {
        showFieldErrors(form, err.fields);
        fail(err);
        update();
      }
    });
    right.append(form);
  }
  root.append(h('div', { class: 'grid2' }, left, right));
}

/* The page that lists what you already offer. Creating a listing is a separate page: newOffer. */
export async function teach(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'My listings'), h('p', { class: 'muted' }, 'Students at your university can find these listings and request sessions.')),
    h('a', { class: 'btn btn-primary', href: '#/new-offer' }, 'Offer a course')));
  const { offers } = await get('/api/offers?mine=1');
  if (!ctx.alive()) return;

  const mineList = h('div', {});
  const renderMine = (items) => {
    clear(mineList);
    if (!items.length) {
      mineList.append(empty('You have no listings yet', 'Offer the first course you could teach.', h('a', { class: 'btn btn-primary', href: '#/new-offer' }, 'Offer a course')));
      return;
    }
    for (const o of items) {
      const card = h('div', {});
      const view = () => {
        clear(card).append(offerItem(o, { showTutor: false }), h('div', { class: 'actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: edit }, 'Edit'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: toggle }, o.status === 'active' ? 'Pause' : 'Resume'),
          h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: remove }, 'Remove')));
      };
      const edit = () => {
        const { form } = offerForm({
          courses: [], initial: { ...o, course_id: o.course.id }, lockCourse: true, submitLabel: 'Save changes', onCancel: view,
          onSubmit: async (body) => {
            const { offer: updated } = await patch(`/api/offers/${o.id}`, body);
            Object.assign(o, updated);
            toast('Saved.');
            view();
          },
        });
        clear(card).append(h('div', { class: 'panel' }, h('h3', {}, `Edit ${o.course.code}`), form));
      };
      const toggle = async () => {
        try {
          const { offer: updated } = await patch(`/api/offers/${o.id}`, { status: o.status === 'active' ? 'paused' : 'active' });
          Object.assign(o, updated);
          toast(o.status === 'active' ? 'Listing is live again.' : 'Listing paused.');
          view();
        } catch (e) { fail(e); }
      };
      const remove = async () => {
        try {
          await patch(`/api/offers/${o.id}`, { status: 'removed' });
          card.remove();
          toast('Listing removed.');
        } catch (e) { fail(e); }
      };
      view();
      mineList.append(card);
    }
  };
  root.append(mineList);
  renderMine(offers);
}

/* "Offer a course" opens this page on its own. The course name is typed. */
export async function newOffer(root, _arg, ctx) {
  root.append(h('p', {}, h('a', { href: '#/teach' }, 'Back to my listings')),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Offer a course'), h('p', { class: 'muted' }, `Students at ${ctx.state.user.university.name} will see this listing and can request a session.`))));
  const { courses } = await get('/api/courses');
  if (!ctx.alive()) return;
  const { form } = offerForm({
    courses, submitLabel: 'Publish listing',
    onSubmit: async (body) => {
      await post('/api/offers', body);
      toast('Listing published.');
      location.hash = '#/teach';
    },
  });
  root.append(h('section', { class: 'panel narrow' }, form));
}
