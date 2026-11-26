/* Shared helpers. Everything is rendered with textContent and DOM nodes, never innerHTML. */

/* Native append() turns null into the text "null". Skip empty values and flatten arrays instead. */
const flatKids = (list) => list.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
for (const name of ['append', 'prepend']) {
  const native = Element.prototype[name];
  Element.prototype[name] = function patched(...kids) {
    return native.apply(this, flatKids(kids));
  };
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'required'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
};

export const safeHttps = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' ? x.toString() : null;
  } catch {
    return null;
  }
};

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

export async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'sos' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError(res.status, data?.error || 'Something went wrong. Try again.', data?.fields);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b) => api('POST', p, b ?? {});
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

export function formatBytes(n) {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function uploadLocalFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new ApiError(400, 'Choose a file first.'));
    if (file.size > 4 * 1024 * 1024) return reject(new ApiError(413, 'Files must be 4 MB or smaller.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new ApiError(400, 'Could not read that file from your drive.'));
    reader.onload = async () => {
      try {
        const res = await post('/api/files', {
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          data_base64: String(reader.result || ''),
        });
        resolve(res.file);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsDataURL(file);
  });
}

let toastTimer;
export function toast(message, kind = 'ok') {
  let box = document.getElementById('toast');
  if (!box) {
    box = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  clear(box).append(h('div', { class: `notice ${kind}` }, h('strong', {}, kind === 'ok' ? 'Done.' : 'Problem.'), message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => clear(box), 5000);
}

export const fail = (err) => toast(err?.message || 'Something went wrong.', 'bad');

export function skeletonRows(n = 3) {
  return h('div', { 'aria-hidden': 'true' }, Array.from({ length: n }, () =>
    h('div', { class: 'skel-row' }, h('div', { class: 'skel line mid' }), h('div', { class: 'skel line short' }))));
}

const DT = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const D = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso) => DT.format(new Date(iso));
export const fmtDate = (iso) => D.format(new Date(iso));
export const credits = (n) => `${n} credit${n === 1 ? '' : 's'}`;
export const modeLabel = (m) => ({ online: 'Online', in_person: 'In person', chat: 'By message' }[m] || m);
export const rating = (r, n) => (n ? `${r} out of 5 (${n})` : 'No reviews yet');

/** Shows server field errors under their inputs. */
export function showFieldErrors(form, fields) {
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
  form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  let first = null;
  for (const [name, msg] of Object.entries(fields || {})) {
    const input = form.elements[name];
    if (!input) continue;
    input.classList.add('invalid');
    input.setAttribute('aria-invalid', 'true');
    input.closest('.field')?.append(h('div', { class: 'field-error', role: 'alert' }, msg));
    first ??= input;
  }
  first?.focus();
}

export function field(label, control, hint) {
  return h('div', { class: 'field' }, h('label', { for: control.id }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), control);
}

export function footer() {
  return h('footer', { class: 'site-foot' }, h('div', { class: 'wrap' },
    h('div', {}, h('a', { class: 'mark', href: '/' }, 'SyllabusSOS++'),
      h('p', { class: 'small muted' }, 'Peer tutoring and campus community, one university at a time.')),
    h('ul', {}, h('li', {}, h('a', { href: '/terms' }, 'Terms of service')), h('li', {}, h('a', { href: '/privacy' }, 'Privacy policy')),
      h('li', {}, h('a', { href: '/login' }, 'Sign in')))));
}
