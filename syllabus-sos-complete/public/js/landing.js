import { h, clear, get, skeletonRows, modeLabel, rating, footer } from './common.js';

document.getElementById('foot').replaceWith(footer());

const results = document.getElementById('demo-results');
const campusSel = document.getElementById('demo-campus');
const q = document.getElementById('demo-q');
let timer;
let seq = 0;

function offerRow(o) {
  return h('div', { class: 'offer-row' },
    h('div', {},
      h('div', {}, h('span', { class: 'code' }, o.code), ` ${o.course}`),
      h('div', {}, o.headline),
      h('div', { class: 'meta small' },
        h('span', { class: 'tag' }, modeLabel(o.mode)),
        o.mastery === 'complete' ? h('span', { class: 'tag solid' }, 'Knows the whole course') : null,
        h('span', {}, `${o.tutor}`),
        h('span', { class: 'muted' }, rating(o.rating, o.rating_count)))),
    h('div', { class: 'price' }, o.price_per_hour === 0 ? 'Free' : `${o.price_per_hour} credits`, h('div', { class: 'small muted' }, o.price_per_hour === 0 ? '' : 'per hour'),
      h('a', { class: 'small', href: '/login?as=student&tab=register' }, 'Join to book')));
}

async function load(first = false) {
  const mine = ++seq;
  clear(results).append(skeletonRows(3));
  try {
    const params = new URLSearchParams();
    if (campusSel.value) params.set('university', campusSel.value);
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await get(`/api/public/demo?${params}`);
    if (mine !== seq) return;
    if (first && data.campuses.length) {
      clear(campusSel).append(...data.campuses.map((c) => h('option', { value: c.slug }, `${c.name}, ${c.city}`)));
      if (data.campus) campusSel.value = data.campus.slug;
    }
    clear(results);
    if (!data.offers.length) {
      results.append(h('div', { class: 'empty' }, h('h3', {}, 'No tutors match that search'), h('p', { class: 'flush' }, 'Try a course code such as CS301, or clear the search box.')));
    } else {
      results.append(...data.offers.map(offerRow));
    }
  } catch (e) {
    if (mine === seq) clear(results).append(h('div', { class: 'notice bad', role: 'alert' }, h('strong', {}, 'Could not load tutors.'), e.message));
  }
}

campusSel.addEventListener('change', () => load());
q.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => load(), 300);
});

load(true);
