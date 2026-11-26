import { h, clear, get, post, toast, fail, field, showFieldErrors, skeletonRows, fmtDateTime, credits, modeLabel, safeHttps } from './common.js';
import { empty, errorNotice, statusTag } from './app-ui.js';

function classify(b) {
  const started = Date.parse(b.start_at) <= Date.now();
  if (b.as === 'tutor' && b.status === 'requested') return 'action';
  if (b.as === 'learner' && b.status === 'accepted' && started) return 'action';
  if (b.as === 'learner' && ['completed', 'resolved_release'].includes(b.status) && !b.reviewed) return 'action';
  if (['requested', 'accepted', 'disputed'].includes(b.status)) return 'upcoming';
  return 'past';
}

function bookingCard(b, ctx, reload) {
  const other = b.as === 'learner' ? b.tutor : b.learner;
  const actions = h('div', { class: 'actions' });
  const extra = h('div', {});
  const run = async (path, body, okMsg) => {
    try {
      await post(`/api/bookings/${b.id}/${path}`, body);
      toast(okMsg);
      await reload();
    } catch (e) { fail(e); }
  };
  const started = Date.parse(b.start_at) <= Date.now();

  if (b.status === 'requested') {
    if (b.as === 'tutor') {
      actions.append(
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => acceptForm() }, 'Accept'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run('decline', {}, 'Request declined. The learner was refunded.') }, 'Decline'));
    } else {
      actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run('cancel', {}, 'Request cancelled. Your credits are back in your wallet.') }, 'Cancel request'));
    }
  }
  if (b.status === 'accepted') {
    if (b.as === 'learner' && started) actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => run('complete', {}, 'Session confirmed. The tutor has been paid.') }, 'Confirm the session happened'));
    if (started) actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => problemForm() }, 'Raise a problem'));
    actions.append(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run('cancel', {}, 'Session cancelled. The learner was refunded.') }, 'Cancel session'));
  }
  if (b.as === 'learner' && ['completed', 'resolved_release'].includes(b.status) && !b.reviewed) {
    actions.append(h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => reviewForm() }, 'Leave a review'));
  }
  if (b.as === 'learner' && ['completed', 'resolved_release'].includes(b.status)) {
    actions.append(h('a', { class: 'btn btn-sm', href: `#/syllabus/${b.course.id}` }, 'Take a follow-up check'));
  }

  function acceptForm() {
    const url = h('input', { id: `acc-url-${b.id}`, name: 'meeting_url', placeholder: 'https://zoom.us/j/... (optional)', maxlength: 300 });
    const loc = h('input', { id: `acc-loc-${b.id}`, name: 'location', maxlength: 150 });
    const form = h('form', { class: 'panel stack', novalidate: true },
      b.mode === 'online' ? field('Meeting link', url, 'Leave empty and we make a private Jitsi room for you.') : null,
      b.mode === 'in_person' ? field('Where will you meet?', loc, 'A public place on campus is best.') : null,
      b.mode === 'chat' ? h('p', {}, 'You will teach by message. Use the Messages page to talk.') : null,
      h('p', { class: 'small muted' }, `You receive ${credits(b.price_total - b.fee)} after the learner confirms. The platform fee is ${credits(b.fee)}.`),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Accept request'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => clear(extra) }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      if (b.mode === 'online' && url.value.trim()) body.meeting_url = url.value;
      if (b.mode === 'in_person') body.location = loc.value;
      try {
        await post(`/api/bookings/${b.id}/accept`, body);
        toast('Accepted. The learner can see the details now.');
        await reload();
      } catch (err) { showFieldErrors(form, err.fields); fail(err); }
    });
    clear(extra).append(form);
  }

  function problemForm() {
    const form = h('form', { class: 'panel stack', novalidate: true },
      field('What went wrong?', h('textarea', { id: `prob-${b.id}`, name: 'reason', maxlength: 500 }), 'An administrator reads this and decides on a refund or release.'),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-danger btn-sm', type: 'submit' }, 'Raise problem'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => clear(extra) }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await post(`/api/bookings/${b.id}/dispute`, { reason: form.reason.value });
        toast('Problem raised. The credits stay held until an administrator decides.');
        await reload();
      } catch (err) { showFieldErrors(form, err.fields); fail(err); }
    });
    clear(extra).append(form);
  }

  function reviewForm() {
    const rate = h('select', { id: `rv-${b.id}`, name: 'rating' }, [5, 4, 3, 2, 1].map((n) => h('option', { value: n }, `${n} out of 5`)));
    const form = h('form', { class: 'panel stack', novalidate: true },
      field('Rating', rate),
      field('Comment', h('textarea', { id: `rvc-${b.id}`, name: 'comment', maxlength: 500 }), '(optional)'),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Post review'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => clear(extra) }, 'Cancel')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { rating: Number(rate.value) };
      if (form.comment.value.trim()) body.comment = form.comment.value;
      try {
        await post(`/api/bookings/${b.id}/review`, body);
        toast('Review posted. Thank you.');
        await reload();
      } catch (err) { showFieldErrors(form, err.fields); fail(err); }
    });
    clear(extra).append(form);
  }

  const meeting = b.status === 'accepted' && b.meeting_url ? safeHttps(b.meeting_url) : null;
  return h('article', { class: 'item' },
    h('h3', {}, `${b.course.code} with `, h('a', { href: `#/user/${other.id}` }, other.name)),
    h('div', { class: 'meta' }, statusTag(b.status), h('span', { class: 'tag' }, modeLabel(b.mode)), h('span', { class: 'tag' }, b.as === 'learner' ? 'You are learning' : 'You are teaching')),
    h('p', { class: 'flush' }, `${fmtDateTime(b.start_at)}, ${b.duration_min} minutes`),
    h('p', { class: 'small muted flush' }, b.as === 'learner' ? `You paid ${credits(b.price_total)}.` : `You earn ${credits(b.price_total - b.fee)} after the platform fee of ${credits(b.fee)}.`),
    b.message ? h('p', { class: 'preline flush' }, h('strong', {}, 'Message: '), b.message) : null,
    meeting ? h('p', { class: 'flush' }, h('a', { href: meeting, target: '_blank', rel: 'noopener noreferrer' }, 'Open the meeting link')) : null,
    b.status === 'accepted' && b.mode === 'in_person' && b.location ? h('p', { class: 'flush' }, h('strong', {}, 'Meet at: '), b.location) : null,
    b.status === 'accepted' && b.mode === 'chat' ? h('p', { class: 'flush' }, h('a', { href: `#/messages/${other.id}` }, 'Open your conversation')) : null,
    b.status === 'disputed' ? h('p', { class: 'flush' }, h('strong', {}, 'An administrator is reviewing this. '), b.dispute_reason) : null,
    actions, extra);
}

export async function sessions(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Sessions'), h('p', { class: 'muted' }, 'Requests, upcoming sessions and your history.'))));
  const tabs = h('div', { class: 'tabrow', role: 'group', 'aria-label': 'Filter sessions' });
  const list = h('div', { 'aria-live': 'polite' });
  root.append(tabs, list);
  let tab = 'action';
  let all = [];

  const draw = () => {
    clear(tabs);
    for (const [key, label] of [['action', 'Needs you'], ['upcoming', 'In progress'], ['past', 'Past']]) {
      const n = all.filter((b) => classify(b) === key).length;
      tabs.append(h('button', { type: 'button', 'aria-pressed': String(tab === key), onclick: () => { tab = key; draw(); } }, `${label} (${n})`));
    }
    clear(list);
    const items = all.filter((b) => classify(b) === tab);
    if (!items.length) {
      list.append(tab === 'action'
        ? empty('Nothing needs you right now', 'New requests and sessions waiting for your confirmation show up here.', h('a', { class: 'btn', href: '#/find' }, 'Find a tutor'))
        : empty('Nothing here yet', tab === 'upcoming' ? 'Sessions you have requested or booked appear here.' : 'Finished and cancelled sessions appear here.'));
      return;
    }
    list.append(...items.map((b) => bookingCard(b, ctx, reload)));
  };
  const reload = async () => {
    const data = await get('/api/bookings');
    all = data.bookings;
    if (ctx.alive()) { draw(); ctx.refreshChrome(); }
  };

  list.append(skeletonRows(3));
  try {
    const data = await get('/api/bookings');
    if (!ctx.alive()) return;
    all = data.bookings;
    if (!all.some((b) => classify(b) === 'action') && all.some((b) => classify(b) === 'upcoming')) tab = 'upcoming';
    draw();
  } catch (e) { clear(list).append(errorNotice(e)); }
}
