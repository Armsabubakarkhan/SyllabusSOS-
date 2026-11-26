import { h, clear, get, skeletonRows, footer } from './common.js';

document.getElementById('foot').replaceWith(footer());

const box = document.getElementById('campus-list');
if (box) {
  box.append(skeletonRows(3));
  try {
    const { universities } = await get('/api/universities');
    clear(box);
    if (!universities.length) {
      box.append(h('div', { class: 'empty' }, h('h3', {}, 'No campuses yet'), h('p', { class: 'flush' }, 'Be the first from your university. Register and add it.')));
    }
    for (const u of universities) {
      box.append(h('div', { class: 'campus-row' },
        h('div', {}, h('div', { class: 'name' }, u.name), h('div', { class: 'muted small' }, u.city)),
        h('div', { class: 'small' }, `${u.members} members, ${u.courses} courses, ${u.tutors} tutors`),
        h('a', { href: `/u/${u.slug}` }, 'Open campus page')));
    }
  } catch (e) {
    clear(box).append(h('div', { class: 'notice bad', role: 'alert' }, h('strong', {}, 'Could not load campuses.'), e.message));
  }
}

const fee = document.getElementById('fee-line');
if (fee) {
  try {
    const cfg = await get('/api/config');
    fee.textContent = `${cfg.fee_percent} percent of each session is kept by the platform. The tutor sees this before accepting, and you see the total before booking.`;
    if (!cfg.demo) document.getElementById('demo-line').textContent = 'Credits are held and released by the platform. Withdrawals are reviewed by an administrator.';
  } catch { /* the static text stays */ }
}
