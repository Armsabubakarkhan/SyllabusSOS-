import { h, clear, get, post, patch, toast, fail, field, showFieldErrors, skeletonRows, fmtDateTime, credits } from './common.js';
import { empty, errorNotice } from './app-ui.js';

const main = document.getElementById('main');
const side = document.getElementById('side');
const menuToggle = document.getElementById('menu-toggle');
const sideClose = document.getElementById('side-close');
const sideBackdrop = document.getElementById('side-backdrop');

const TABS = [['overview', 'Overview'], ['universities', 'Universities'], ['users', 'Users'], ['teachers', 'Teacher access'], ['disputes', 'Disputes'], ['withdrawals', 'Withdrawals'], ['reports', 'Reports'], ['audit', 'Audit log']];
let tab = 'overview';

function openSidebar() {
  document.body.classList.add('sidebar-open');
  if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

if (menuToggle) menuToggle.addEventListener('click', toggleSidebar);
if (sideClose) sideClose.addEventListener('click', closeSidebar);
if (sideBackdrop) sideBackdrop.addEventListener('click', closeSidebar);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  }
});

if (side) {
  side.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a) closeSidebar();
  });
}

const table = (heads, rows) => h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, heads.map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows)));
const btn = (label, fn, cls = '') => h('button', { class: `btn btn-sm ${cls}`, type: 'button', onclick: fn }, label);
const act = (fn, ok) => async () => { try { await fn(); toast(ok); await show(); } catch (e) { fail(e); } };

const views = {
  async overview(root) {
    const s = await get('/api/admin/stats');
    root.append(h('h1', {}, 'Overview'),
      s.ledger_balanced ? h('div', { class: 'notice ok' }, h('strong', {}, 'Credits ledger balanced.'), 'Every credit movement adds up to zero.') : h('div', { class: 'notice bad', role: 'alert' }, h('strong', {}, 'Ledger does not balance.'), 'Investigate immediately.'),
      h('dl', { class: 'facts' },
        h('div', {}, h('dt', {}, 'Members'), h('dd', {}, String(s.users))),
        h('div', {}, h('dt', {}, 'Approved universities'), h('dd', {}, String(s.universities))),
        h('div', {}, h('dt', {}, 'Universities waiting for approval'), h('dd', {}, String(s.pending_universities))),
        h('div', {}, h('dt', {}, 'Active tutoring listings'), h('dd', {}, String(s.active_offers))),
        h('div', {}, h('dt', {}, 'Open disputes'), h('dd', {}, String(s.disputes))),
        h('div', {}, h('dt', {}, 'Open reports'), h('dd', {}, String(s.open_reports))),
        h('div', {}, h('dt', {}, 'Pending withdrawals'), h('dd', {}, String(s.pending_withdrawals))),
        h('div', {}, h('dt', {}, 'Credits in escrow'), h('dd', {}, credits(s.escrow))),
        h('div', {}, h('dt', {}, 'Platform fees earned'), h('dd', {}, credits(s.platform_earnings)))));
  },
  async universities(root) {
    const { universities } = await get('/api/admin/universities');
    const f = h('form', { class: 'panel stack', novalidate: true }, h('h2', {}, 'Add a university'),
      h('div', { class: 'grid2' }, field('Name', h('input', { id: 'u-name', name: 'name', maxlength: 120 })), field('City', h('input', { id: 'u-city', name: 'city', maxlength: 80 }))),
      field('Student email domain', h('input', { id: 'u-dom', name: 'email_domain', placeholder: 'example.edu' }), '(optional)'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Add university'));
    f.addEventListener('submit', async (e) => { e.preventDefault(); const b = { name: f.name.value, city: f.city.value }; if (f.email_domain.value.trim()) b.email_domain = f.email_domain.value; try { await post('/api/admin/universities', b); toast('Added.'); show(); } catch (err) { showFieldErrors(f, err.fields); fail(err); } });
    root.append(h('h1', {}, 'Universities'), table(['Name', 'City', 'Status', 'Members', ''], universities.map((u) => h('tr', {}, h('td', {}, u.name), h('td', {}, u.city), h('td', {}, u.status), h('td', {}, String(u.members)),
      h('td', { class: 'row' }, u.status !== 'approved' ? btn('Approve', act(() => patch(`/api/admin/universities/${u.id}`, { status: 'approved' }), 'Approved.')) : null, u.status !== 'rejected' ? btn('Reject', act(() => patch(`/api/admin/universities/${u.id}`, { status: 'rejected' }), 'Rejected.')) : null)))), f);
  },
  async users(root) {
    const q = h('input', { id: 'au-q', type: 'search', placeholder: 'Search name or email', 'aria-label': 'Search users', maxlength: 60 });
    const out = h('div', {});
    const search = async () => {
      const term = q.value.trim();
      const { users } = await get(`/api/admin/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
      clear(out).append(table(['Name', 'Email', 'Role', 'Status', 'University', 'Actions'], users.map((u) => h('tr', {},
        h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.role), h('td', {}, u.status), h('td', {}, u.uni_name || ''),
        h('td', { class: 'row' },
          u.status === 'active' ? btn('Suspend', act(() => patch(`/api/admin/users/${u.id}`, { status: 'suspended' }), 'Suspended.'), 'btn-danger') : null,
          u.status === 'suspended' ? btn('Reactivate', act(() => patch(`/api/admin/users/${u.id}`, { status: 'active' }), 'Reactivated.')) : null)))));
    };
    q.addEventListener('input', () => { clearTimeout(q._t); q._t = setTimeout(search, 300); });
    root.append(h('h1', {}, 'Users'), q, out);
    search();
  },
  async teachers(root) {
    const { teachers } = await get('/api/admin/teachers');
    root.append(h('h1', {}, 'Teacher access'), table(['Name', 'Email', 'University', 'Verified', 'Actions'], teachers.map((t) => h('tr', {},
      h('td', {}, t.name), h('td', {}, t.email), h('td', {}, t.uni_name || ''), h('td', {}, t.verified ? 'Yes' : 'No'),
      h('td', { class: 'row' },
        !t.verified ? btn('Verify', act(() => patch(`/api/admin/teachers/${t.id}`, { verified: true }), 'Verified.')) : btn('Unverify', act(() => patch(`/api/admin/teachers/${t.id}`, { verified: false }), 'Unverified.'), 'btn-danger'))))));
  },
  async disputes(root) {
    const { disputes } = await get('/api/admin/disputes');
    root.append(h('h1', {}, 'Disputes'), disputes.length ? table(['ID', 'Course', 'Learner', 'Tutor', 'Reason', 'Actions'], disputes.map((d) => h('tr', {},
      h('td', {}, String(d.id)), h('td', {}, d.course_code), h('td', {}, d.learner_name), h('td', {}, d.tutor_name), h('td', {}, d.dispute_reason),
      h('td', { class: 'row' },
        btn('Refund learner', act(() => post(`/api/admin/disputes/${d.id}/resolve`, { outcome: 'refund' }), 'Refunded.')),
        btn('Release to tutor', act(() => post(`/api/admin/disputes/${d.id}/resolve`, { outcome: 'release' }), 'Released.')))))) : empty('No disputes', 'No disputed sessions.'));
  },
  async withdrawals(root) {
    const { withdrawals } = await get('/api/admin/withdrawals');
    root.append(h('h1', {}, 'Withdrawals'), withdrawals.length ? table(['Person', 'Amount', 'Note', 'Status', 'Actions'], withdrawals.map((w) => h('tr', {}, h('td', {}, w.name), h('td', {}, credits(w.amount)), h('td', {}, w.note), h('td', {}, w.status), h('td', { class: 'row' }, w.status === 'pending' ? [btn('Mark paid', act(() => post(`/api/admin/withdrawals/${w.id}/resolve`, { outcome: 'paid' }), 'Marked paid.')), btn('Reject', act(() => post(`/api/admin/withdrawals/${w.id}/resolve`, { outcome: 'rejected' }), 'Rejected and returned.'), 'btn-danger')] : null)))) : empty('No withdrawals', 'Requests appear here.'));
  },
  async reports(root) {
    const { reports } = await get('/api/admin/reports');
    root.append(h('h1', {}, 'Reports'), reports.length ? h('div', {}, reports.map((r) => h('article', { class: 'item' }, h('h3', {}, `${r.target_type} ${r.target_id}`), h('p', { class: 'small muted' }, `${r.university}, from ${r.reporter}, ${fmtDateTime(r.created_at)}, ${r.status}`), h('p', { class: 'preline' }, r.reason),
      r.status === 'open' ? h('div', { class: 'actions' }, btn('Remove the content', act(() => post(`/api/admin/reports/${r.id}/resolve`, { action: 'remove_content' }), 'Removed.'), 'btn-danger'), btn('Dismiss', act(() => post(`/api/admin/reports/${r.id}/resolve`, { action: 'dismiss' }), 'Dismissed.'))) : null))) : empty('No reports', 'Reports from members appear here.'));
  },
  async audit(root) {
    const { entries } = await get('/api/admin/audit');
    root.append(h('h1', {}, 'Audit log'), table(['Time', 'Actor', 'Action', 'Detail', 'IP'], entries.map((e) => h('tr', {}, h('td', {}, fmtDateTime(e.created_at)), h('td', {}, e.actor_id ?? ''), h('td', {}, e.action), h('td', {}, e.detail), h('td', {}, e.ip ?? '')))));
  },
};

async function show() {
  clear(side).append(...TABS.map(([k, label]) => h('li', {}, h('a', { href: `#${k}`, 'aria-current': tab === k ? 'page' : null }, label))));
  closeSidebar();
  const root = h('div', {});
  clear(main).append(skeletonRows(3));
  try { await views[tab](root); clear(main).append(root); } catch (e) { clear(main).append(errorNotice(e)); }
}

window.addEventListener('hashchange', () => { const k = location.hash.slice(1); if (views[k]) { tab = k; show(); } });
document.getElementById('logout').addEventListener('click', async () => { try { await post('/api/auth/logout'); } finally { location.href = '/'; } });
{ const k = location.hash.slice(1); if (views[k]) tab = k; }
show();
