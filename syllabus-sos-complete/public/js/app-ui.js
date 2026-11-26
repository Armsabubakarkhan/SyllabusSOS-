import { h, clear, post, toast, fail, field, showFieldErrors, modeLabel } from './common.js';

export const link = (href, text, attrs = {}) => h('a', { href, ...attrs }, text);

export const personLink = (u) => h('a', { href: `#/user/${u.id}` }, u.name);

export function personTags(u) {
  return [
    u.role === 'teacher' ? h('span', { class: 'tag' }, 'Teacher') : null,
    u.tutor_type === 'peer_tutor' ? h('span', { class: 'tag' }, 'Peer Tutor') : null,
    u.academic_background ? h('span', { class: 'tag' }, u.academic_background) : null,
    u.verified ? h('span', { class: 'tag solid' }, 'Verified') : null,
  ];
}

export function empty(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('h3', {}, title), text ? h('p', {}, text) : null, actions.length ? h('div', { class: 'row' }, actions) : null);
}

export function errorNotice(err) {
  return h('div', { class: 'notice bad', role: 'alert' }, h('strong', {}, 'Could not load this page.'), err.message || 'Try again.');
}

export function statusTag(status) {
  const labels = {
    requested: 'Waiting for tutor', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled', completed: 'Completed',
    disputed: 'Problem raised', resolved_refund: 'Refunded after review', resolved_release: 'Paid after review',
  };
  const warn = ['disputed', 'declined', 'cancelled'].includes(status);
  return h('span', { class: `tag${warn ? ' warn' : ''}` }, labels[status] || status);
}

/** A small "Report" control that expands into a form. */
export function reportControl(type, id) {
  const wrap = h('span', {});
  const open = h('button', { class: 'linklike small', type: 'button' }, 'Report');
  open.addEventListener('click', () => {
    const form = h('form', { class: 'panel stack', novalidate: true },
      h('h3', {}, 'Report this'),
      field('What is wrong?', h('textarea', { id: `rep-${type}-${id}`, name: 'reason', maxlength: 500, required: true }), 'At least 10 characters.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Send report'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => form.replaceWith(wrap) }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await post('/api/reports', { target_type: type, target_id: id, reason: form.reason.value });
        toast('Report sent. An administrator will review it.');
        form.replaceWith(wrap);
      } catch (err) {
        showFieldErrors(form, err.fields);
        fail(err);
      }
    });
    wrap.replaceWith(form);
    form.reason.focus();
  });
  wrap.append(open);
  return wrap;
}

export const priceText = (n) => (n === 0 ? 'Free' : `${n} credits per hour`);

export function offerItem(o, { showTutor = true, showPrice = true } = {}) {
  return h('article', { class: 'item' },
    h('h3', {}, h('a', { href: `#/offer/${o.id}` }, o.headline)),
    h('div', { class: 'meta' },
      h('span', { class: 'code' }, h('strong', {}, o.course.code), ` ${o.course.name}`),
      o.course.background ? h('span', { class: 'tag' }, o.course.background) : null,
      h('span', { class: 'tag' }, modeLabel(o.mode)),
      o.mastery === 'complete' ? h('span', { class: 'tag solid' }, 'Knows the whole course') : null,
      o.status === 'paused' ? h('span', { class: 'tag warn' }, 'Paused') : null),
    showTutor
      ? h('div', { class: 'meta small' }, personLink(o.tutor), personTags(o.tutor),
          h('span', { class: 'muted' }, o.tutor.rating_count ? `${o.tutor.rating} out of 5 from ${o.tutor.rating_count} review${o.tutor.rating_count === 1 ? '' : 's'}` : 'No reviews yet'),
          h('span', { class: 'muted' }, `${o.tutor.sessions_done} session${o.tutor.sessions_done === 1 ? '' : 's'} taught`))
      : null,
    (o.syllabus_topics || o.syllabus_subtopics)
      ? h('div', { class: 'syllabus-box' },
          o.syllabus_topics ? h('div', {}, h('strong', {}, 'Topics: '), o.syllabus_topics) : null,
          o.syllabus_subtopics ? h('div', { class: 'small muted' }, h('strong', {}, 'Subtopics: '), o.syllabus_subtopics) : null)
      : null,
    showPrice ? h('div', { class: 'price-line' }, priceText(o.price_per_hour)) : null,
    o.availability ? h('div', { class: 'small muted' }, `Available: ${o.availability}`) : null);
}

/** Form used both for creating and editing a listing. The course is typed, not picked from a list. */
export function offerForm({ courses, initial = {}, submitLabel, onSubmit, onCancel, lockCourse = false }) {
  const courseInput = lockCourse
    ? h('input', { id: 'of-course', value: `${initial.course?.code || ''} ${initial.course?.name || ''}`.trim(), disabled: true })
    : h('input', { id: 'of-course', name: 'course_name', list: 'of-course-options', maxlength: 120, autocomplete: 'off', placeholder: 'Type the course name, for example Machine Learning' });
  const form = h('form', { class: 'stack', novalidate: true },
    field('Course', courseInput, lockCourse ? '' : 'Type any course. Suggestions show courses already at your university. A new course is added for you.'),
    lockCourse ? null : h('datalist', { id: 'of-course-options' }, courses.map((c) => h('option', { value: c.name }, c.code))),
    lockCourse ? null : field('Subject / Course code', h('input', { id: 'of-code', name: 'course_code', maxlength: 20, placeholder: 'For example CS401, MED101, LAW101' }), '(optional, only used if the course is new)'),
    field('Headline', h('input', { id: 'of-head', name: 'headline', maxlength: 120, value: initial.headline || '', placeholder: 'What will you teach, in one line?' })),
    field('Syllabus: Topics you will teach', h('textarea', { id: 'of-topics', name: 'syllabus_topics', maxlength: 1500, placeholder: 'e.g. Finite Automata, Regular Languages, Turing Machines' }, initial.syllabus_topics || ''), 'Learners can search for you by typing these topics.'),
    field('Syllabus: Subtopics breakdown', h('textarea', { id: 'of-subtopics', name: 'syllabus_subtopics', maxlength: 2000, placeholder: 'e.g. DFA minimization, NFA to DFA subset construction, Epsilon closure, Pumping lemma proofs' }, initial.syllabus_subtopics || ''), 'List specific subtopics you cover so learners find exact matches.'),
    field('Details', h('textarea', { id: 'of-desc', name: 'description', maxlength: 1000, placeholder: 'Teaching style, past papers, or study materials included' }, initial.description || ''), '(optional)'),
    field('Format', h('select', { id: 'of-mode', name: 'mode' },
      ['online', 'in_person', 'chat'].map((m) => h('option', { value: m, selected: m === (initial.mode || 'online') }, modeLabel(m))))),
    field('How well do you know it?', h('select', { id: 'of-mastery', name: 'mastery' },
      h('option', { value: 'complete', selected: initial.mastery === 'complete' }, 'I know the whole course'),
      h('option', { value: 'strong', selected: initial.mastery !== 'complete' }, 'I know most of it well'))),
    field('When are you free?', h('input', { id: 'of-avail', name: 'availability', maxlength: 200, value: initial.availability || '', placeholder: 'e.g. Weekday evenings after 6 pm' }), '(optional)'),
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel),
      onCancel ? h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancel') : null));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    const body = {
      headline: form.headline.value,
      price_per_hour: initial.price_per_hour ?? 0,
      mode: form.mode.value,
      mastery: form.mastery.value,
    };
    if (!lockCourse) {
      body.course_name = form.course_name.value.trim();
      if (form.course_code.value.trim()) body.course_code = form.course_code.value;
    }
    if (form.syllabus_topics.value.trim()) body.syllabus_topics = form.syllabus_topics.value.trim();
    if (form.syllabus_subtopics.value.trim()) body.syllabus_subtopics = form.syllabus_subtopics.value.trim();
    if (form.description.value.trim()) body.description = form.description.value;
    if (form.availability.value.trim()) body.availability = form.availability.value;
    try {
      await onSubmit(body);
    } catch (err) {
      showFieldErrors(form, err.fields);
      fail(err);
      btn.disabled = false;
    }
  });
  return { form };
}

export { clear };
