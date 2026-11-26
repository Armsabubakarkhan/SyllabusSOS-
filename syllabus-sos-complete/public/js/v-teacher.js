import { h, get, credits, fmtDateTime, modeLabel } from './common.js';
import { empty } from './app-ui.js';

/* The teacher desk. Students never see this page. */
export async function home(root, _arg, ctx) {
  const u = ctx.state.user;
  root.append(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, `Welcome, ${u.name.split(' ')[0]}`), h('p', { class: 'muted' }, `Teacher space at ${u.university.name}, ${u.university.city}`)),
    h('div', { class: 'row' }, h('a', { class: 'btn btn-primary', href: '#/new-offer' }, 'Offer a course'), h('a', { class: 'btn', href: '#/post' }, 'Post an event'))));

  const [d, queue, mine] = await Promise.all([get('/api/dashboard'), get('/api/review-queue'), get('/api/offers?mine=1')]);
  if (!ctx.alive()) return;

  if (u.role === 'teacher' && !u.verified) {
    root.append(h('div', { class: 'notice' }, h('strong', {}, 'Waiting for verification.'),
      'An administrator verifies teachers and assigns them to courses. Until then you can offer sessions and post events. Reviewing resources, the difficulty radar and announcements unlock after verification.'));
  }

  const waiting = queue.resources.length + queue.handovers.length;
  root.append(h('dl', { class: 'facts statrow' },
    h('div', {}, h('dt', {}, 'Waiting for your review'), h('dd', {}, String(waiting))),
    h('div', {}, h('dt', {}, 'Session requests'), h('dd', {}, String(d.requests_waiting))),
    h('div', {}, h('dt', {}, 'Active listings'), h('dd', {}, String(mine.offers.filter((o) => o.status === 'active').length))),
    h('div', {}, h('dt', {}, 'Wallet'), h('dd', {}, credits(d.balance)))));

  const todo = [];
  if (waiting) todo.push(h('li', {}, h('a', { href: '#/review' }, `${waiting} submission${waiting === 1 ? '' : 's'} to review`)));
  if (d.requests_waiting) todo.push(h('li', {}, h('a', { href: '#/sessions' }, `${d.requests_waiting} session request${d.requests_waiting === 1 ? '' : 's'} waiting for your answer`)));
  if (d.unread_messages) todo.push(h('li', {}, h('a', { href: '#/messages' }, `${d.unread_messages} unread message${d.unread_messages === 1 ? '' : 's'}`)));

  const teacherCards = [
    { href: '#/syllabus', icon: '📚', title: 'My Courses', desc: 'Syllabus, units & learning topics' },
    { href: '#/review', icon: '📋', title: 'Review Queue', desc: 'Submissions waiting for verification' },
    { href: '#/radar', icon: '📡', title: 'Difficulty Radar', desc: 'Identify where students need help' },
    { href: '#/resources', icon: '📁', title: 'Resources & Folders', desc: 'Course materials, notes & uploads' },
    { href: '#/new-offer', icon: '🎓', title: 'Offer a Course', desc: 'Open tutoring hours & doubt sessions' },
    { href: '#/sessions', icon: '⏱️', title: 'Sessions', desc: 'Manage requested and confirmed sessions' },
    { href: '#/messages', icon: '💬', title: 'Messages', desc: 'Direct communication with learners' },
    { href: '#/feed', icon: '📢', title: 'Campus Feed', desc: 'Campus announcements & discussions' },
    { href: '#/post', icon: '🗓️', title: 'Post an Event', desc: 'Schedule department talks or workshops' },
    { href: '#/wallet', icon: '💳', title: 'Earnings & Wallet', desc: 'Session earnings, balance & payouts' },
  ];

  root.append(h('div', { class: 'home-quick-menu' },
    h('h2', { class: 'quick-menu-title' }, 'Teacher Quick Navigation'),
    h('div', { class: 'home-menu-grid' },
      teacherCards.map((c) =>
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
        todo.length ? h('ul', { class: 'ruled' }, todo) : h('p', { class: 'muted flush' }, 'Nothing is waiting.')),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/review' }, 'Review queue'),
        h('a', { class: 'btn btn-sm', href: '#/radar' }, 'Difficulty radar'))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Your listings'),
        mine.offers.length
          ? h('ul', { class: 'ruled' }, mine.offers.slice(0, 5).map((o) => h('li', {}, h('strong', {}, o.course.code), ` ${o.course.name}`, h('div', { class: 'small muted' }, `${o.price_per_hour === 0 ? 'Free' : `${o.price_per_hour} credits per hour`}${o.status === 'paused' ? ', paused' : ''}`))))
          : empty('No listings yet', 'Offer a course so students at your university can book you.', h('a', { class: 'btn btn-primary btn-sm', href: '#/new-offer' }, 'Offer a course'))),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/teach' }, 'Manage listings'),
        h('a', { class: 'btn btn-sm', href: '#/me' }, 'Edit profile'))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Coming up'),
        d.upcoming.length
          ? h('ul', { class: 'ruled' }, d.upcoming.map((s) => h('li', {}, h('strong', {}, s.course_code), ` with ${s.other}`, h('div', { class: 'small muted' }, `${fmtDateTime(s.start_at)}, ${modeLabel(s.mode)}`))))
          : h('p', { class: 'muted flush' }, 'No accepted sessions yet.')),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/sessions' }, 'Open sessions'))),
    h('section', { class: 'panel' },
      h('div', { class: 'panel-body' },
        h('h2', {}, 'Campus events'),
        d.events.length
          ? h('ul', { class: 'ruled' }, d.events.map((e) => h('li', {}, h('strong', {}, e.title), h('div', { class: 'small muted' }, `${e.kind === 'hackathon' ? 'Hackathon' : 'Event'}, ${fmtDateTime(e.event_at)}${e.venue ? `, ${e.venue}` : ''}`))))
          : h('p', { class: 'muted flush' }, 'No upcoming events. Post the first one.')),
      h('div', { class: 'panel-foot row' },
        h('a', { class: 'btn btn-sm', href: '#/post' }, 'Post an event'),
        h('a', { class: 'btn btn-sm', href: '#/feed' }, 'Open campus feed')))));
}
