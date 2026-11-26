import { h, clear, get, post, skeletonRows } from './common.js';
import { errorNotice } from './app-ui.js';

const state = { user: null, badges: {} };
const main = document.getElementById('main');
const side = document.getElementById('side');
const menuToggle = document.getElementById('menu-toggle');
const sideClose = document.getElementById('side-close');
const sideBackdrop = document.getElementById('side-backdrop');

const portal = document.body.dataset.portal === 'teacher' ? 'teacher' : 'student';

/* Each portal has its own menu. Teachers and students do not share a dashboard. */
const NAVS = {
  student: [
    ['home', 'Home'],
    ['missions', 'My missions'],
    ['find', 'Find a mentor / tutor'],
    ['new-offer', 'Offer a course'],
    ['teach', 'My listings'],
    ['syllabus', 'Syllabus'],
    ['resources', 'Resources & folders'],
    ['sessions', 'Sessions', 'sessions'],
    ['quiz', 'Practice checks'],
    ['progress', 'My progress'],
    ['messages', 'Messages', 'messages'],
    ['friends', 'Friends', 'friends'],
    ['feed', 'Campus feed'],
    ['post', 'Post an event'],
    ['handover', 'Senior handover'],
    ['wallet', 'Wallet'],
  ],
  teacher: [
    ['home', 'Teacher desk'],
    ['syllabus', 'My courses'],
    ['review', 'Review queue', 'review'],
    ['radar', 'Difficulty radar'],
    ['resources', 'Resources & folders'],
    ['new-offer', 'Offer a course'],
    ['teach', 'My listings'],
    ['sessions', 'Sessions', 'sessions'],
    ['messages', 'Messages', 'messages'],
    ['feed', 'Campus feed'],
    ['post', 'Post an event'],
    ['wallet', 'Earnings & wallet'],
  ],
};
const NAV = NAVS[portal];
const ALLOWED = new Set([...NAV.map(([k]) => k), 'offer', 'topic', 'resource', 'user', 'me']);

const VIEWS = {
  home: () => (portal === 'teacher' ? import('./v-teacher.js').then((m) => m.home) : import('./v-money-social.js').then((m) => m.home)),
  wallet: () => import('./v-money-social.js').then((m) => m.wallet),
  messages: () => import('./v-money-social.js').then((m) => m.messages),
  friends: () => import('./v-money-social.js').then((m) => m.friends),
  feed: () => import('./v-money-social.js').then((m) => m.feed),
  user: () => import('./v-money-social.js').then((m) => m.profile),
  me: () => import('./v-money-social.js').then((m) => m.me),
  find: () => import('./v-market.js').then((m) => m.find),
  offer: () => import('./v-market.js').then((m) => m.offer),
  'new-offer': () => import('./v-market.js').then((m) => m.newOffer),
  post: () => import('./v-money-social.js').then((m) => m.postEvent),
  teach: () => import('./v-market.js').then((m) => m.teach),
  sessions: () => import('./v-sessions.js').then((m) => m.sessions),
  syllabus: () => import('./v-academic.js').then((m) => m.syllabus),
  resources: () => import('./v-academic.js').then((m) => m.resources),
  radar: () => import('./v-academic.js').then((m) => m.radar),
  quiz: () => import('./v-academic.js').then((m) => m.quiz),
  handover: () => import('./v-academic.js').then((m) => m.handover),
  topic: () => import('./v-academic.js').then((m) => m.topic),
  resource: () => import('./v-academic.js').then((m) => m.resource),
  missions: () => import('./v-academic.js').then((m) => m.missions),
  progress: () => import('./v-academic.js').then((m) => m.progress),
  review: () => import('./v-academic.js').then((m) => m.review),
};

/* Sidebar Drawer Control Functions */
export function openSidebar() {
  document.body.classList.add('sidebar-open');
  if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
}

export function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
}

export function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);
if (sideClose) sideClose.addEventListener('click', closeSidebar);
if (sideBackdrop) sideBackdrop.addEventListener('click', closeSidebar);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  }
});

// Auto-close sidebar whenever any section link is clicked
if (side) {
  side.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) {
      closeSidebar();
    }
  });
}

function drawChrome() {
  const u = state.user;
  document.getElementById('campus-name').textContent = u.university.name;
  const me = document.getElementById('me-link');
  me.textContent = u.name;
  const route = currentRoute().name;
  clear(side);
  for (const [key, label, badge] of NAV) {
    const n = badge ? state.badges[badge] || 0 : 0;
    side.append(h('li', {}, h('a', { href: `#/${key}`, 'aria-current': route === key ? 'page' : null }, label, n ? h('span', { class: 'count', 'aria-label': `${n} waiting` }, String(n)) : null)));
  }
  if (u.role === 'admin') side.append(h('li', {}, h('a', { href: '/admin' }, 'Administration')));
}

async function refreshBadges() {
  try {
    const d = await get('/api/dashboard');
    state.badges = { sessions: d.requests_waiting + d.to_confirm, messages: d.unread_messages, friends: d.friend_requests };
    if (portal === 'teacher') {
      const q = await get('/api/review-queue');
      state.badges.review = q.resources.length + q.handovers.length;
    }
  } catch { /* badges are optional */ }
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'home', arg: parts[1] || null };
}

let cleanups = [];
let token = 0;

async function render() {
  if (!state.user) return;
  const mine = ++token;
  for (const fn of cleanups) { try { fn(); } catch { /* ignore */ } }
  cleanups = [];
  const { name, arg } = currentRoute();
  const loader = ALLOWED.has(name) ? VIEWS[name] : null;
  drawChrome();
  closeSidebar(); // Ensure sidebar collapses into drawer when a page is shown
  clear(main).append(skeletonRows(4));
  if (!loader) {
    clear(main).append(h('h1', {}, 'Page not found'), h('p', {}, `That page is not part of the ${portal} space.`), h('a', { class: 'btn', href: '#/home' }, 'Go home'));
    return;
  }
  const ctx = {
    state,
    alive: () => mine === token,
    onCleanup: (fn) => cleanups.push(fn),
    refresh: () => render(),
    refreshChrome: async () => { await refreshBadges(); if (mine === token) drawChrome(); },
  };
  const root = h('div', {});
  try {
    const view = await loader();
    await view(root, arg, ctx);
    if (mine !== token) return;
    clear(main).append(root);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    if (mine === token) clear(main).append(errorNotice(e));
  }
  refreshBadges().then(() => { if (mine === token) drawChrome(); });
}

document.getElementById('logout').addEventListener('click', async () => {
  try { await post('/api/auth/logout'); } finally { location.href = '/'; }
});

window.addEventListener('hashchange', render);

try {
  const { user } = await get('/api/auth/me');
  if (!user) {
    location.replace(`/login?as=${portal}`);
  } else if (user.role !== portal && !(portal === 'teacher' && user.role === 'admin')) {
    location.replace('/app');
  } else {
    state.user = user;
    try {
      const cfg = await get('/api/config');
      if (cfg.demo) document.getElementById('demo-flag').append(h('span', { class: 'tag warn' }, 'Demo mode'));
    } catch { /* optional */ }
    if (!location.hash) location.hash = '#/home';
    await render();
  }
} catch (e) {
  clear(main).append(errorNotice(e));
}
