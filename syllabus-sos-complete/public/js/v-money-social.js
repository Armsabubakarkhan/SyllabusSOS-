import { h, clear, get, post, patch, del, api, toast, fail, field, showFieldErrors, skeletonRows, fmtDate, fmtDateTime, credits, modeLabel, rating } from './common.js';
import { empty, errorNotice, offerItem, personLink, personTags, reportControl } from './app-ui.js';

/* ---------- home ---------- */

export async function home(root, _arg, ctx) {
  const u = ctx.state.user;
  const sub = [
    `${u.university.name}, ${u.university.city}`,
    u.academic_background ? `${u.academic_background} stream` : '',
  ].filter(Boolean).join(' • ');
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, `Hello, ${u.name.split(' ')[0]}`), h('p', { class: 'muted' }, sub)),
    h('div', { class: 'row' },
      h('a', { class: 'btn btn-sm', href: '#/me' }, 'Edit my profile'),
      h('a', { class: 'btn btn-sm', href: `#/user/${u.id}` }, 'View public profile'))));
  const d = await get('/api/dashboard');
  if (!ctx.alive()) return;
  const todo = [];
  if (d.requests_waiting) todo.push(h('li', {}, h('a', { href: '#/sessions' }, `${d.requests_waiting} session request${d.requests_waiting === 1 ? '' : 's'} waiting for your answer`)));
  if (d.to_confirm) todo.push(h('li', {}, h('a', { href: '#/sessions' }, `${d.to_confirm} session${d.to_confirm === 1 ? '' : 's'} to confirm so the tutor gets paid`)));
  if (d.unread_messages) todo.push(h('li', {}, h('a', { href: '#/messages' }, `${d.unread_messages} unread message${d.unread_messages === 1 ? '' : 's'}`)));
  if (d.friend_requests) todo.push(h('li', {}, h('a', { href: '#/friends' }, `${d.friend_requests} friend request${d.friend_requests === 1 ? '' : 's'}`)));

  const menuCards = [
    { href: '#/missions', icon: '🎯', title: 'My Missions', desc: 'Milestones, study calendar & planner' },
    { href: '#/find', icon: '🔍', title: 'Find a Mentor / Tutor', desc: 'Connect with campus peer tutors' },
    { href: '#/new-offer', icon: '🎓', title: 'Offer a Course', desc: 'Teach peers & earn credits' },
    { href: '#/syllabus', icon: '📚', title: 'Syllabus & Units', desc: 'Courses, topics & learning outcomes' },
    { href: '#/resources', icon: '📁', title: 'Resources & Folders', desc: 'Download notes, papers & files' },
    { href: '#/quiz', icon: '📝', title: 'Practice Checks', desc: 'Concept checks & practice quizzes' },
    { href: '#/sessions', icon: '⏱️', title: 'Sessions', desc: 'Upcoming & completed sessions' },
    { href: '#/messages', icon: '💬', title: 'Messages & Friends', desc: 'Direct chat with study peers' },
    { href: '#/feed', icon: '📢', title: 'Campus Feed', desc: 'Campus announcements & events' },
    { href: '#/wallet', icon: '💳', title: 'Wallet & Credits', desc: 'Credits balance, top-up & ledger' },
  ];

  root.append(h('div', { class: 'home-quick-menu' },
    h('h2', { class: 'quick-menu-title' }, 'Main Menu Navigation'),
    h('div', { class: 'home-menu-grid' },
      menuCards.map((c) =>
        h('a', { class: 'menu-card', href: c.href },
          h('span', { class: 'menu-card-icon' }, c.icon),
          h('span', { class: 'menu-card-title' }, c.title),
          h('span', { class: 'menu-card-desc' }, c.desc)
        )
      )
    )
  ));

  root.append(h('div', { class: 'home-grid' },
    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Needs you'),
        todo.length ? h('ul', { class: 'ruled' }, todo) : h('p', { class: 'muted flush' }, 'Nothing is waiting. Find a tutor, explore your syllabus, or share a resource to get started.')),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-primary btn-sm', href: '#/find' }, 'Find a tutor'),
        h('a', { class: 'btn btn-sm', href: '#/syllabus' }, 'Syllabus'),
        h('a', { class: 'btn btn-sm', href: '#/new-offer' }, 'Offer a course'))),

    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Your learning hub'),
        h('dl', { class: 'facts' },
          h('div', {}, h('dt', {}, 'Academic stream'), h('dd', {}, u.academic_background || 'Not set')),
          h('div', {}, h('dt', {}, 'Wallet balance'), h('dd', {}, credits(d.balance))),
          h('div', {}, h('dt', {}, 'Department'), h('dd', {}, u.department || 'Not set')))),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/resources' }, 'Resources & folders'),
        h('a', { class: 'btn btn-sm', href: '#/quiz' }, 'Practice & tasks'),
        h('a', { class: 'btn btn-sm', href: '#/missions' }, 'Missions & calendar'))),

    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Coming up'),
        d.upcoming.length
          ? h('ul', { class: 'ruled' }, d.upcoming.map((s) => h('li', {}, h('strong', {}, `${s.course_code}`), ` with ${s.other}`, h('div', { class: 'small muted' }, `${fmtDateTime(s.start_at)}, ${modeLabel(s.mode)}`))))
          : h('p', { class: 'muted flush' }, 'No accepted sessions yet.')),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/sessions' }, 'Open sessions'),
        h('a', { class: 'btn btn-sm', href: '#/wallet' }, 'Open wallet'))),

    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Campus events'),
        d.events.length
          ? h('ul', { class: 'ruled' }, d.events.map((e) => h('li', {}, h('strong', {}, e.title), h('div', { class: 'small muted' }, `${e.kind === 'hackathon' ? 'Hackathon' : 'Event'}, ${fmtDateTime(e.event_at)}${e.venue ? `, ${e.venue}` : ''}`))))
          : h('p', { class: 'muted flush' }, 'No upcoming events. Post one for your campus.')),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/post' }, 'Post an event'),
        h('a', { class: 'btn btn-sm', href: '#/feed' }, 'Campus feed')))
  ));
}

/* ---------- wallet ---------- */

export async function wallet(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Wallet'), h('p', { class: 'muted' }, 'Credits you can spend on sessions, and credits you have earned.'))));
  const w = await get('/api/wallet');
  if (!ctx.alive()) return;
  const demo = w.payments_mode === 'test';
  if (demo) root.append(h('div', { class: 'notice' }, h('strong', {}, 'Demo credits.'), 'Credits here are for demonstration. They have no cash value.'));
  const kindLabel = { topup: 'Test credits added', hold: 'Held for a session', refund: 'Refund', earning: 'Session earnings', fee: 'Platform fee', withdrawal: 'Withdrawal requested', withdrawal_refund: 'Withdrawal returned' };

  const actions = h('div', { class: 'stack' });
  if (demo) {
    const amt = h('input', { id: 'tu-amt', name: 'amount', type: 'number', min: 50, max: 2000, step: 50, value: 500 });
    const f = h('form', { class: 'panel stack', novalidate: true }, h('h2', {}, 'Add test credits'), field('Amount', amt, '50 to 2000'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add credits'));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await post('/api/wallet/topup', { amount: Number(amt.value) }); toast('Test credits added.'); ctx.refresh(); } catch (err) { showFieldErrors(f, err.fields); fail(err); }
    });
    actions.append(f);
  }
  const wamt = h('input', { id: 'wd-amt', name: 'amount', type: 'number', min: 100, step: 10 });
  const wf = h('form', { class: 'panel stack', novalidate: true },
    h('h2', {}, 'Withdraw earnings'),
    h('p', { class: 'small muted' }, demo ? 'Withdrawals are recorded and reviewed by an administrator. In this demo no real money moves.' : 'An administrator reviews each request before it is paid out.'),
    field('Amount in credits', wamt, 'At least 100'),
    field('Payout note', h('input', { id: 'wd-note', name: 'note', maxlength: 200 }), '(optional)'),
    h('button', { class: 'btn', type: 'submit' }, 'Request withdrawal'));
  wf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { amount: Number(wamt.value) };
    if (wf.note.value.trim()) body.note = wf.note.value;
    try { await post('/api/wallet/withdraw', body); toast('Withdrawal requested.'); ctx.refresh(); } catch (err) { showFieldErrors(wf, err.fields); fail(err); }
  });
  actions.append(wf);

  root.append(h('div', { class: 'grid2' },
    h('div', { class: 'stack' },
      h('section', { class: 'panel' }, h('h2', {}, 'Balance'),
        h('dl', { class: 'facts' },
          h('div', {}, h('dt', {}, 'Available'), h('dd', {}, credits(w.balance))),
          h('div', {}, h('dt', {}, 'Held for your sessions'), h('dd', {}, credits(w.held))),
          h('div', {}, h('dt', {}, 'Earnings waiting to be released'), h('dd', {}, credits(w.pending_earnings))))),
      actions),
    h('section', { class: 'panel' }, h('h2', {}, 'History'),
      w.entries.length
        ? h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'What'), h('th', { scope: 'col' }, 'Credits'))),
            h('tbody', {}, w.entries.map((e) => h('tr', {}, h('td', {}, fmtDate(e.created_at)), h('td', {}, kindLabel[e.kind] || e.kind), h('td', {}, `${e.amount > 0 ? '+' : ''}${e.amount}`))))))
        : empty('No activity yet', demo ? 'Add test credits to book your first session.' : 'Credits you earn or spend show up here.'),
      w.withdrawals.length ? h('div', {}, h('h3', {}, 'Withdrawal requests'), h('ul', { class: 'ruled' }, w.withdrawals.map((x) => h('li', {}, `${credits(x.amount)}, ${fmtDate(x.created_at)}: `, h('strong', {}, x.status))))) : null)));
}

/* ---------- messages ---------- */

export async function messages(root, arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Messages'), h('p', { class: 'muted' }, 'Private conversations with people at your university.'))));
  const threadsBox = h('section', { class: 'panel', 'aria-label': 'Conversations' });
  const convo = h('section', { class: 'panel', 'aria-label': 'Conversation' });
  root.append(h('div', { class: 'chat' }, threadsBox, convo));
  let current = arg ? Number(arg) : null;
  let lastId = 0;
  let poll;

  async function drawThreads() {
    const { threads } = await get('/api/messages/threads');
    if (!ctx.alive()) return;
    clear(threadsBox).append(h('h2', {}, 'Conversations'));
    if (!threads.length) threadsBox.append(h('p', { class: 'muted' }, 'No conversations yet. Open a profile and choose Send a message.'));
    for (const t of threads) {
      threadsBox.append(h('button', { class: 'thread', type: 'button', 'aria-current': String(t.user.id === current), onclick: () => open(t.user.id) },
        h('strong', {}, t.user.name), t.unread ? h('span', { class: 'count' }, String(t.unread)) : null,
        h('div', { class: 'small' }, `${t.last.mine ? 'You: ' : ''}${t.last.body}`)));
    }
  }

  async function open(id) {
    current = id;
    lastId = 0;
    clearInterval(poll);
    location.hash = `#/messages/${id}`;
  }

  const bubble = (m) => h('div', { class: `bubble${m.mine ? ' mine' : ''}` }, m.body, h('time', { datetime: m.created_at }, fmtDateTime(m.created_at)));

  async function drawConvo() {
    if (!current) {
      clear(convo).append(empty('Pick a conversation', 'Choose someone on the left, or open a profile to start one.'));
      return;
    }
    clear(convo).append(skeletonRows(2));
    let data;
    try { data = await get(`/api/messages/with/${current}`); } catch (e) { clear(convo).append(errorNotice(e)); return; }
    if (!ctx.alive()) return;
    const box = h('div', { class: 'bubbles', role: 'log', 'aria-live': 'polite', tabindex: '0', 'aria-label': `Messages with ${data.user.name}` });
    data.messages.forEach((m) => { box.append(bubble(m)); lastId = Math.max(lastId, m.id); });
    const input = h('textarea', { id: 'msg-body', name: 'body', maxlength: 2000, 'aria-label': 'Message', placeholder: 'Write a message' });
    const form = h('form', { class: 'stack', novalidate: true }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Send'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      try {
        const { message } = await post('/api/messages', { to: current, body: input.value });
        box.append(bubble(message));
        lastId = Math.max(lastId, message.id);
        input.value = '';
        box.scrollTop = box.scrollHeight;
      } catch (err) { fail(err); }
    });
    clear(convo).append(h('h2', {}, h('a', { href: `#/user/${data.user.id}` }, data.user.name)), box, form);
    box.scrollTop = box.scrollHeight;
    poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await get(`/api/messages/with/${current}?after=${lastId}`);
        for (const m of r.messages) {
          if (!m.mine) { box.append(bubble(m)); box.scrollTop = box.scrollHeight; }
          lastId = Math.max(lastId, m.id);
        }
      } catch { /* try again on next tick */ }
    }, 8000);
  }

  ctx.onCleanup(() => clearInterval(poll));
  try {
    await drawThreads();
    await drawConvo();
  } catch (e) { clear(threadsBox).append(errorNotice(e)); }
}

/* ---------- friends ---------- */

export async function friends(root, _arg, ctx) {
  root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Friends'), h('p', { class: 'muted' }, 'Classmates and seniors at your university.'))));
  const data = await get('/api/friends');
  if (!ctx.alive()) return;
  const row = (f, buttons) => h('li', { class: 'row between' }, h('span', {}, personLink(f.user), ' ', personTags(f.user)), h('span', { class: 'row' }, buttons));
  const sections = [];
  if (data.incoming.length) {
    sections.push(h('section', { class: 'panel' }, h('h2', {}, 'Requests for you'), h('ul', { class: 'ruled' }, data.incoming.map((f) => row(f, [
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: async () => { try { await post(`/api/friends/${f.friendship_id}/accept`); toast('Friend added.'); ctx.refresh(); } catch (e) { fail(e); } } }, 'Accept'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await del(`/api/friends/${f.friendship_id}`); ctx.refresh(); } catch (e) { fail(e); } } }, 'Decline')])))));
  }
  sections.push(h('section', { class: 'panel' }, h('h2', {}, 'Your friends'),
    data.friends.length
      ? h('ul', { class: 'ruled' }, data.friends.map((f) => row(f, [
          h('a', { class: 'btn btn-sm', href: `#/messages/${f.user.id}` }, 'Message'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await del(`/api/friends/${f.friendship_id}`); toast('Friend removed.'); ctx.refresh(); } catch (e) { fail(e); } } }, 'Remove')])))
      : empty('No friends yet', 'Search for people at your university and send a request.')));
  if (data.outgoing.length) sections.push(h('section', { class: 'panel' }, h('h2', {}, 'Waiting for a reply'), h('ul', { class: 'ruled' }, data.outgoing.map((f) => row(f, [h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await del(`/api/friends/${f.friendship_id}`); ctx.refresh(); } catch (e) { fail(e); } } }, 'Withdraw')])))));

  const q = h('input', { id: 'ppl-q', type: 'search', placeholder: 'Search by name', maxlength: 60, 'aria-label': 'Search people at your university' });
  const results = h('div', { 'aria-live': 'polite' });
  let timer;
  const search = async () => {
    clear(results);
    const { people } = await get(`/api/people?q=${encodeURIComponent(q.value.trim())}`);
    if (!people.length) { results.append(h('p', { class: 'muted' }, 'No one found.')); return; }
    results.append(h('ul', { class: 'ruled' }, people.map((p) => h('li', { class: 'row between' },
      h('span', {}, personLink(p), ' ', personTags(p), h('span', { class: 'small muted' }, ` ${[p.department, p.year_of_study ? `Year ${p.year_of_study}` : ''].filter(Boolean).join(', ')}`)),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => { try { await post('/api/friends', { user_id: p.id }); e.target.disabled = true; e.target.textContent = 'Request sent'; } catch (err) { fail(err); } } }, 'Add friend')))));
  };
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search().catch(fail), 300); });
  ctx.onCleanup(() => clearTimeout(timer));
  root.append(h('div', { class: 'grid2' }, h('div', { class: 'stack' }, sections), h('section', { class: 'panel' }, h('h2', {}, 'Find people'), q, results)));
  search().catch(fail);
}

/* ---------- campus feed ---------- */

const KINDS = { event: 'Event', hackathon: 'Hackathon', discussion: 'Discussion', opportunity: 'Opportunity', announcement: 'Announcement' };

export async function feed(root, _arg, ctx) {
  const u = ctx.state.user;
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Campus feed'), h('p', { class: 'muted' }, `Events, hackathons and discussions at ${u.university.name}. Students and teachers can both post.`)),
    h('a', { class: 'btn btn-primary', href: '#/post' }, 'Post an event')));
  let kind = '';
  const list = h('div', { 'aria-live': 'polite' });
  const tabs = h('div', { class: 'tabrow', role: 'group', 'aria-label': 'Filter posts' });

  function postCard(p) {
    const commentsBox = h('div', {});
    const btn = h('button', { class: 'btn btn-sm', type: 'button', 'aria-expanded': 'false' }, `Comments (${p.comment_count})`);
    btn.addEventListener('click', async () => {
      if (btn.getAttribute('aria-expanded') === 'true') { clear(commentsBox); btn.setAttribute('aria-expanded', 'false'); return; }
      btn.setAttribute('aria-expanded', 'true');
      clear(commentsBox).append(skeletonRows(1));
      try {
        const { comments } = await get(`/api/posts/${p.id}/comments`);
        const f = h('form', { class: 'row', novalidate: true }, h('input', { id: `c-${p.id}`, name: 'body', maxlength: 1000, 'aria-label': 'Write a comment', placeholder: 'Write a comment' }), h('button', { class: 'btn btn-sm', type: 'submit' }, 'Reply'));
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!f.body.value.trim()) return;
          try { await post(`/api/posts/${p.id}/comments`, { body: f.body.value }); p.comment_count += 1; btn.textContent = `Comments (${p.comment_count})`; btn.setAttribute('aria-expanded', 'false'); btn.click(); } catch (err) { fail(err); }
        });
        clear(commentsBox).append(comments.length ? h('ul', { class: 'ruled' }, comments.map((c) => h('li', {}, personLink(c.author), h('div', { class: 'preline' }, c.body), h('div', { class: 'small muted' }, fmtDateTime(c.created_at))))) : h('p', { class: 'muted' }, 'No comments yet.'), f);
      } catch (e) { clear(commentsBox).append(errorNotice(e)); }
    });
    return h('article', { class: 'item' },
      h('div', { class: 'meta' }, h('span', { class: 'tag solid' }, KINDS[p.kind]), p.event_at ? h('span', { class: 'tag' }, fmtDateTime(p.event_at)) : null, p.venue ? h('span', { class: 'tag' }, p.venue) : null),
      h('h3', {}, p.title),
      p.body ? h('p', { class: 'preline' }, p.body) : null,
      h('div', { class: 'small muted' }, 'Posted by ', personLink(p.author), ' ', personTags(p.author), `, ${fmtDate(p.created_at)}`),
      h('div', { class: 'actions' }, btn,
        p.mine || u.role === 'admin' ? h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => { try { await del(`/api/posts/${p.id}`); toast('Post removed.'); load(); } catch (e) { fail(e); } } }, 'Delete') : reportControl('post', p.id)),
      commentsBox);
  }

  async function load() {
    clear(tabs);
    for (const [k, label] of [['', 'All'], ...Object.entries(KINDS)]) {
      tabs.append(h('button', { type: 'button', 'aria-pressed': String(kind === k), onclick: () => { kind = k; load(); } }, label));
    }
    clear(list).append(skeletonRows(3));
    try {
      const { posts } = await get(`/api/posts${kind ? `?kind=${kind}` : ''}`);
      if (!ctx.alive()) return;
      clear(list);
      if (!posts.length) list.append(empty('Nothing posted yet', 'Share an event, a hackathon team search or a question with your campus.'));
      else list.append(...posts.map(postCard));
    } catch (e) { clear(list).append(errorNotice(e)); }
  }
  root.append(tabs, list);
  load();
}

/* Its own page: any student or teacher can post an event, hackathon, discussion or opportunity. */
export async function postEvent(root, _arg, ctx) {
  const u = ctx.state.user;
  const canAnnounce = u.role === 'admin' || (u.role === 'teacher' && u.verified);
  root.append(h('p', {}, h('a', { href: '#/feed' }, 'Back to the campus feed')),
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Post to your campus'), h('p', { class: 'muted' }, `Everyone at ${u.university.name} can see this. Students and teachers can both post events.`))));
  const kindSel = h('select', { id: 'post-kind', name: 'kind' }, Object.entries(KINDS).filter(([k]) => k !== 'announcement' || canAnnounce).map(([k, v]) => h('option', { value: k }, v)));
  const when = h('input', { id: 'post-when', name: 'event_at', type: 'datetime-local' });
  const whenField = field('Date and time', when);
  const venue = h('input', { id: 'post-venue', name: 'venue', maxlength: 140, placeholder: 'Room, building or link' });
  const venueField = field('Where', venue, '(optional)');
  const sync = () => { const ev = ['event', 'hackathon'].includes(kindSel.value); whenField.hidden = !ev; venueField.hidden = !ev; };
  kindSel.addEventListener('change', sync);
  sync();
  const form = h('form', { class: 'panel stack narrow', novalidate: true },
    field('What are you posting?', kindSel),
    field('Title', h('input', { id: 'post-title', name: 'title', maxlength: 140 })),
    whenField,
    venueField,
    field('Details', h('textarea', { id: 'post-body', name: 'body', maxlength: 3000 }), '(optional)'),
    h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Publish'), h('a', { class: 'btn', href: '#/feed' }, 'Cancel')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { kind: kindSel.value, title: form.title.value };
    if (form.body.value.trim()) body.body = form.body.value;
    if (!whenField.hidden && when.value) body.event_at = new Date(when.value).toISOString();
    if (!venueField.hidden && venue.value.trim()) body.venue = venue.value;
    try { await post('/api/posts', body); toast('Posted to your campus.'); location.hash = '#/feed'; } catch (err) { showFieldErrors(form, err.fields); fail(err); }
  });
  root.append(form);
}

/* ---------- profiles ---------- */

const BACKGROUNDS = ['Engineering', 'Medical', 'Law', 'Finance', 'Science', 'Arts & Humanities', 'Management', 'Other'];

export async function profile(root, id, ctx) {
  const d = await get(`/api/users/${id}`);
  if (!ctx.alive()) return;
  const p = d.user;
  const infoRows = [
    ['Academic background', p.academic_background],
    ['Role', p.tutor_type === 'peer_tutor' ? 'Student Peer Tutor' : p.role === 'teacher' ? 'Faculty / Teacher' : 'Student'],
    ['Degree / Program', p.degree],
    ['Department / Branch', p.department],
    ['Year of study', p.year_of_study ? `Year ${p.year_of_study}` : ''],
    ['Semester', p.semester ? `Semester ${p.semester}` : ''],
    ['Student / Roll ID', p.student_id],
    ['Designation', p.designation],
    ['Faculty ID', p.faculty_id],
    ['Cabin / Office', p.cabin],
    ['College / Campus', p.college_name],
    ['Campus location', p.college_place],
  ].filter(([, v]) => v);

  root.append(h('p', {}, ctx.state.user.role === 'student' ? h('a', { href: '#/find' }, 'Back to tutors') : h('a', { href: '#/home' }, 'Back to my desk')),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, p.name),
        h('div', { class: 'meta row small' }, personTags(p),
          p.role === 'student' ? h('span', { class: 'tag' }, 'Student') : null,
          p.tutor_type === 'peer_tutor' ? h('span', { class: 'tag solid' }, 'Peer Tutor') : null,
          p.academic_background ? h('span', { class: 'tag' }, p.academic_background) : null)),
      d.is_me ? h('a', { class: 'btn btn-primary btn-sm', href: '#/me' }, 'Edit my profile') : null),
    h('section', { class: 'panel stack' },
      h('h2', {}, 'Profile details'),
      p.bio ? h('p', { class: 'preline' }, p.bio) : h('p', { class: 'muted' }, 'No bio yet.'),
      infoRows.length ? h('dl', { class: 'defs' }, infoRows.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))) : null,
      h('p', { class: 'muted small flush' }, `${rating(p.rating, p.rating_count)}. ${p.sessions_done} session${p.sessions_done === 1 ? '' : 's'} taught.`)));

  if (!d.is_me) {
    const fr = d.friendship;
    const friendBtn = fr?.status === 'accepted'
      ? h('span', { class: 'tag solid' }, 'Friends')
      : fr?.status === 'pending' && !fr.incoming ? h('span', { class: 'tag' }, 'Friend request sent')
      : h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => { try { await post('/api/friends', { user_id: p.id }); e.target.disabled = true; e.target.textContent = fr?.incoming ? 'Friends' : 'Request sent'; } catch (err) { fail(err); } } }, fr?.incoming ? 'Accept friend request' : 'Add friend');
    root.append(h('div', { class: 'row', style: null }, h('a', { class: 'btn btn-primary btn-sm', href: `#/messages/${p.id}` }, 'Send a message'), friendBtn, reportControl('user', p.id)));
  }
  root.append(h('h2', {}, 'Courses offered'),
    d.offers.length ? h('div', {}, d.offers.map((o) => offerItem(o, { showTutor: false, showPrice: false }))) : empty('No active listings', d.is_me ? 'Offer a course so others can book you.' : 'This person is not offering any courses right now.', d.is_me ? h('a', { class: 'btn', href: '#/new-offer' }, 'Offer a course') : null));
}

export async function me(root, _arg, ctx) {
  const u = ctx.state.user;
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Your profile'), h('p', { class: 'muted' }, `${u.email}. Your email and phone are never shown publicly to other members.`)),
    h('a', { class: 'btn', href: `#/user/${u.id}` }, 'View how others see my profile')));

  const bgSel = h('select', { id: 'me-bg', name: 'academic_background' },
    h('option', { value: '' }, 'Select academic background'),
    BACKGROUNDS.map((b) => h('option', { value: b, selected: u.academic_background === b }, b)));
  const degSel = h('select', { id: 'me-deg', name: 'degree' },
    h('option', { value: '' }, 'Not set'),
    ['B.Tech / B.E.', 'MBBS / MD', 'LLB / BA LLB', 'B.Com / B.Fin', 'BCA', 'B.Sc', 'BBA', 'M.Tech / M.E.', 'MCA', 'M.Sc', 'MBA', 'Ph.D / Research', 'Other'].map((d) => h('option', { value: d, selected: u.degree === d }, d)));
  const yearSel = h('select', { id: 'me-year', name: 'year_of_study' },
    h('option', { value: '' }, 'Not set'),
    [1, 2, 3, 4, 5, 6, 7, 8].map((y) => h('option', { value: y, selected: u.year_of_study === y }, `Year ${y}`)));
  const semSel = h('select', { id: 'me-sem', name: 'semester' },
    h('option', { value: '' }, 'Not set'),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => h('option', { value: s, selected: u.semester === s }, `Semester ${s}`)));

  const f = h('form', { class: 'panel stack single-col-form', novalidate: true },
    h('h2', {}, 'Editable profile details'),
    field('Full name', h('input', { id: 'me-name', name: 'name', maxlength: 80, value: u.name })),
    field('Phone / WhatsApp number', h('input', { id: 'me-phone', name: 'phone', type: 'tel', maxlength: 20, value: u.phone || '' }), '(kept private)'),
    field('Academic background', bgSel),
    field('Degree / Program', degSel),
    field('Department / Branch', h('input', { id: 'me-dept', name: 'department', maxlength: 100, value: u.department || '' })),
    field('Year of study', yearSel),
    field('Current semester', semSel),
    field('Student ID / USN / Roll No.', h('input', { id: 'me-sid', name: 'student_id', maxlength: 40, value: u.student_id || '' })),
    u.role === 'teacher' ? field('Designation', h('input', { id: 'me-desig', name: 'designation', maxlength: 80, value: u.designation || '' })) : null,
    u.role === 'teacher' ? field('Faculty ID', h('input', { id: 'me-fid', name: 'faculty_id', maxlength: 40, value: u.faculty_id || '' })) : null,
    u.role === 'teacher' ? field('Cabin / Office', h('input', { id: 'me-cabin', name: 'cabin', maxlength: 60, value: u.cabin || '' })) : null,
    field('College / Campus name', h('input', { id: 'me-cname', name: 'college_name', maxlength: 120, value: u.college_name || '' })),
    field('Campus location / Place', h('input', { id: 'me-cplace', name: 'college_place', maxlength: 80, value: u.college_place || '' })),
    field('Short bio', h('textarea', { id: 'me-bio', name: 'bio', maxlength: 500 }, u.bio || ''), 'What you study and what you are good at.'),
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: f.name.value };
    if (f.phone.value.trim()) body.phone = f.phone.value.trim();
    if (bgSel.value) body.academic_background = bgSel.value;
    if (degSel.value) body.degree = degSel.value;
    if (f.department.value.trim()) body.department = f.department.value.trim();
    if (yearSel.value) body.year_of_study = Number(yearSel.value);
    if (semSel.value) body.semester = Number(semSel.value);
    if (f.student_id?.value?.trim()) body.student_id = f.student_id.value.trim();
    if (f.designation?.value?.trim()) body.designation = f.designation.value.trim();
    if (f.faculty_id?.value?.trim()) body.faculty_id = f.faculty_id.value.trim();
    if (f.cabin?.value?.trim()) body.cabin = f.cabin.value.trim();
    if (f.college_name.value.trim()) body.college_name = f.college_name.value.trim();
    if (f.college_place.value.trim()) body.college_place = f.college_place.value.trim();
    if (f.bio.value.trim()) body.bio = f.bio.value.trim();
    try { const { user } = await patch('/api/me', body); ctx.state.user = user; toast('Profile saved.'); ctx.refreshChrome(); } catch (err) { showFieldErrors(f, err.fields); fail(err); }
  });

  const pw = h('form', { class: 'panel stack', novalidate: true },
    h('h2', {}, 'Change password'),
    h('input', { type: 'text', name: 'username', value: u.email, autocomplete: 'username', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }),
    field('Current password', h('input', { id: 'pw-cur', name: 'current', type: 'password', autocomplete: 'current-password', maxlength: 128 })),
    field('New password', h('input', { id: 'pw-new', name: 'next', type: 'password', autocomplete: 'new-password', maxlength: 128 }), 'At least 10 characters. Other devices are signed out.'),
    h('button', { class: 'btn', type: 'submit' }, 'Change password'));
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/api/auth/password', { current: pw.current.value, next: pw.next.value }); pw.reset(); toast('Password changed. Other devices were signed out.'); } catch (err) { showFieldErrors(pw, err.fields); fail(err); }
  });

  const del2 = h('form', { class: 'panel stack', novalidate: true },
    h('h2', {}, 'Delete your account'),
    h('p', { class: 'small' }, 'This removes your messages, comments and listings, and anonymises your profile. Finish open sessions and use or withdraw your credits first. This cannot be undone.'),
    field('Your password', h('input', { id: 'del-pw', name: 'password', type: 'password', autocomplete: 'current-password', maxlength: 128 })),
    h('button', { class: 'btn btn-danger', type: 'submit' }, 'Delete my account'));
  del2.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Delete your account for good?')) return;
    try { await post('/api/me/delete', { password: del2.password.value }); location.href = '/'; } catch (err) { showFieldErrors(del2, err.fields); fail(err); }
  });
  root.append(h('div', { class: 'grid2' }, h('div', { class: 'stack' }, f, pw), del2));
}
