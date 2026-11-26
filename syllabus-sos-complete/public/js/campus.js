import { h, clear, get, skeletonRows, footer } from './common.js';

document.getElementById('foot').replaceWith(footer());
const main = document.getElementById('main');
const slug = location.pathname.split('/').filter(Boolean)[1] || '';

main.append(h('div', { class: 'campus-head' }, h('div', { class: 'skel line mid' }), h('div', { class: 'skel line short' })), skeletonRows(4));

try {
  const { campus, courses } = await get(`/api/campus/${encodeURIComponent(slug)}`);
  document.title = `${campus.name}, SyllabusSOS++`;
  clear(main).append(
    h('div', { class: 'campus-head' },
      h('h1', {}, campus.name),
      h('p', { class: 'muted' }, campus.city),
      h('div', { class: 'stat-line' },
        h('div', {}, h('strong', {}, String(campus.members)), 'members'),
        h('div', {}, h('strong', {}, String(campus.courses)), 'courses'),
        h('div', {}, h('strong', {}, String(campus.tutors)), 'tutors')),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: `/login?tab=register&university=${encodeURIComponent(campus.slug)}` }, `Join ${campus.name}`),
        h('a', { class: 'btn', href: '/login' }, 'Sign in'))),
    h('h2', {}, 'Courses on this campus'),
    courses.length
      ? h('div', { class: 'table-scroll' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Code'), h('th', { scope: 'col' }, 'Course'), h('th', { scope: 'col' }, 'Tutors'))),
          h('tbody', {}, courses.map((c) => h('tr', {}, h('td', {}, c.code), h('td', {}, c.name), h('td', {}, String(c.tutors)))))))
      : h('div', { class: 'empty' }, h('h3', {}, 'No courses yet'), h('p', { class: 'flush' }, 'Join and add the first course for your department.')),
    h('p', { class: 'small muted' }, 'Tutor names and messages are only visible to signed-in members of this campus.'));
} catch (e) {
  clear(main).append(h('div', { class: 'campus-head' },
    h('h1', {}, 'We could not find that campus'),
    h('p', {}, e.message),
    h('a', { class: 'btn', href: '/#campuses' }, 'See all campuses')));
}
