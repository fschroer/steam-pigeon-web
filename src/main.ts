import './style.css';
import type { User } from 'firebase/auth';
import { configured } from './firebase';
import { watchUser, signInGoogle, signInEmail, resetPassword, signOut, authMessage } from './auth';
import { listFlights, loadInfo, fetchCsvText, fetchBlob, shareLink, type RecordInfo } from './store';
import { formatRecordTime, recordId, csvFileName } from './records';
import { parseFlightCsv, type FlightTable } from './csv';
import { h, type Child } from './dom';
import { renderCharts, disposeCharts } from './flight';

const root = document.getElementById('app')!;
const who = document.getElementById('who')!;

function show(...nodes: Child[]) {
  disposeCharts();
  root.replaceChildren(...nodes.filter((n): n is Node | string => Boolean(n)));
}

function errorBox(msg: string): HTMLElement {
  return h('p', { class: 'error', role: 'alert' }, msg);
}

// ---- state ------------------------------------------------------------------------

let user: User | null = null;
let flights: Map<string, RecordInfo[]> | null = null;
const tableCache = new Map<string, FlightTable>();


// ---- views --------------------------------------------------------------------------

function notConfiguredView() {
  who.replaceChildren();
  show(h('section', { class: 'card' },
    h('h1', {}, 'Not configured'),
    h('p', {}, 'This build has no Firebase web config. Copy .env.example to .env.local, fill it in from the Firebase console, and build again.'),
  ));
}

function signInView() {
  who.replaceChildren();
  const status = h('p', { class: 'status', 'aria-live': 'polite' });
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const busy = (b: boolean) => root.querySelectorAll('button').forEach((x) => { x.disabled = b; });

  const form = h('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault();
      busy(true); status.textContent = 'Signing in…';
      try { await signInEmail(email.value.trim(), password.value); }
      catch (err) { status.textContent = authMessage(err); }
      finally { busy(false); }
    },
  },
    h('label', {}, 'Email', email),
    h('label', {}, 'Password', password),
    h('button', { type: 'submit', class: 'primary' }, 'Sign in'),
  );

  show(h('section', { class: 'card narrow' },
    h('h1', {}, 'Sign in'),
    h('p', { class: 'muted' }, 'Use the account you signed in with in the Steam Pigeon app. You see the flights that app uploaded.'),
    h('button', {
      type: 'button', class: 'google',
      onclick: async () => {
        busy(true); status.textContent = '';
        try { await signInGoogle(); } catch (err) { status.textContent = authMessage(err); } finally { busy(false); }
      },
    }, 'Sign in with Google'),
    h('div', { class: 'or' }, 'or'),
    form,
    h('button', {
      type: 'button', class: 'link',
      onclick: async () => {
        const addr = email.value.trim();
        if (!addr) { status.textContent = 'Enter your email first.'; return; }
        try { await resetPassword(addr); status.textContent = `A reset link was sent to ${addr}.`; }
        catch (err) { status.textContent = authMessage(err); }
      },
    }, 'Forgot password?'),
    status,
  ));
}

function header() {
  if (!user) return;
  who.replaceChildren(
    h('span', { class: 'muted' }, user.email ?? user.displayName ?? ''),
    h('button', { type: 'button', class: 'link', onclick: () => { void signOut(); } }, 'Sign out'),
  );
}

async function listView() {
  header();
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading flights…'));
  show(h('h1', {}, 'Flights'), body);
  try {
    flights ??= await listFlights(user!.uid);
  } catch (err) {
    body.replaceChildren(errorBox(`Could not list flights: ${(err as Error).message}`));
    return;
  }
  if (flights.size === 0) {
    body.replaceChildren(h('p', {}, 'No flights yet. Records appear here after the app downloads them from a locator and uploads them while you are signed in.'));
    return;
  }
  body.replaceChildren();
  for (const [locatorId, recs] of flights) {
    const rows = recs.map((r) => {
      const samples = h('td', { class: 'num' }, r.samples !== undefined ? r.samples.toLocaleString() : '…');
      if (r.samples === undefined) {
        loadInfo(r).then((info) => {
          Object.assign(r, info);
          samples.textContent = info.samples !== undefined ? info.samples.toLocaleString() : '–';
        }).catch(() => { samples.textContent = '–'; });
      }
      const files = [r.csvPath && 'CSV', r.binPath && 'raw'].filter(Boolean).join(' + ');
      return h('tr', {},
        h('td', {}, h('a', { href: `#/flight/${locatorId}/${recordId(r)}` }, formatRecordTime(r.recordTs))),
        samples,
        h('td', { class: 'muted' }, files),
      );
    });
    body.append(h('section', { class: 'locator' },
      h('h2', {}, `Locator ${locatorId}`),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Flight'), h('th', { class: 'num' }, 'Samples'), h('th', {}, 'Files'))),
        h('tbody', {}, ...rows),
      ),
    ));
  }
}

async function download(path: string, name: string, btn: HTMLButtonElement) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Downloading…';
  try {
    const blob = await fetchBlob(path);
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    alert(`Download failed: ${(err as Error).message}`);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}

async function flightView(locatorId: string, id: string) {
  header();
  const back = h('a', { href: '#/' }, '← All flights');
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  show(back, body);

  try { flights ??= await listFlights(user!.uid); }
  catch (err) { body.replaceChildren(errorBox(`Could not list flights: ${(err as Error).message}`)); return; }
  const rec = flights.get(locatorId)?.find((r) => recordId(r) === id);
  if (!rec) { body.replaceChildren(errorBox('That flight is not in your store.')); return; }

  const title = h('h1', {}, formatRecordTime(rec.recordTs));
  const sub = h('p', { class: 'muted' }, `Locator ${locatorId} · record ${rec.crc}`);
  const actions = h('div', { class: 'actions' });
  if (rec.csvPath) {
    const b = h('button', { type: 'button', class: 'primary' }, 'Download CSV');
    b.addEventListener('click', () => download(rec.csvPath!, csvFileName(rec), b));
    actions.append(b);
  }
  if (rec.binPath) {
    const b = h('button', { type: 'button' }, 'Download raw (.bin)');
    b.addEventListener('click', () => download(rec.binPath!, csvFileName(rec).replace(/\.csv$/, '.bin'), b));
    actions.append(b);
  }
  if (rec.csvPath) {
    const b = h('button', { type: 'button' }, 'Copy share link');
    b.title = 'Anyone with this link can download this flight’s CSV, without signing in.';
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(await shareLink(rec.csvPath!));
        b.textContent = 'Link copied';
        setTimeout(() => { b.textContent = 'Copy share link'; }, 2000);
      } catch (err) { alert(`Could not get the link: ${(err as Error).message}`); }
    });
    actions.append(b);
  }
  body.replaceChildren(title, sub, actions);

  if (!rec.csvPath) {
    body.append(errorBox('This flight has no CSV in the store, so it cannot be charted here. The raw file can still be downloaded.'));
    return;
  }

  const loading = h('p', { class: 'muted' }, 'Loading flight data…');
  body.append(loading);
  let table = tableCache.get(rec.csvPath);
  try {
    if (!table) {
      table = parseFlightCsv(await fetchCsvText(rec.csvPath));
      tableCache.set(rec.csvPath, table);
    }
  } catch (err) {
    loading.replaceWith(errorBox(`Could not load the CSV: ${(err as Error).message}`));
    return;
  }
  loading.remove();
  renderCharts(body, table);
}

// ---- routing ----------------------------------------------------------------------------

function route() {
  if (!configured) { notConfiguredView(); return; }
  if (!user) { signInView(); return; }
  const m = /^#\/flight\/(\d+)\/(\d+_[0-9a-f]{8})$/.exec(location.hash);
  if (m) void flightView(m[1], m[2]);
  else void listView();
}

window.addEventListener('hashchange', route);

if (configured) {
  watchUser((u) => {
    if (u?.uid !== user?.uid) { flights = null; tableCache.clear(); }
    user = u;
    route();
  });
} else {
  route();
}
