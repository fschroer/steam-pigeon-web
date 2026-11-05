import './style.css';
import type { User } from 'firebase/auth';
import { configured } from './firebase';
import { watchUser, signInGoogle, signInEmail, resetPassword, signOut, authMessage } from './auth';
import { listFlights, loadInfo, fetchCsvText, fetchBlob, shareLink, deleteRecord, type RecordInfo } from './store';
import { formatRecordTime, recordId, csvFileName, locatorLabel } from './records';
import { parseFlightCsv, column, stateChanges, type FlightTable } from './csv';
import { flightPath, buildKml } from './kml';
import { h, type Child } from './dom';
import { renderCharts, disposeCharts } from './flight';

const root = document.getElementById('app')!;
const who = document.getElementById('who')!;

// ---- theme: dark by default, then light, then follow the system ----------------------

const THEMES = ['dark', 'light', 'system'] as const;
type Theme = typeof THEMES[number];
const themeButton = document.getElementById('theme') as HTMLButtonElement;

function currentTheme(): Theme {
  try {
    const t = localStorage.getItem('sp.theme');
    if (t === 'light' || t === 'system') return t;
  } catch { /* storage blocked */ }
  return 'dark';
}

function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const label = { dark: 'Dark', light: 'Light', system: 'System' }[t];
  themeButton.textContent = `Theme: ${label}`;
  themeButton.title = 'Switch between dark, light and your system setting';
}

themeButton.addEventListener('click', () => {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  try { localStorage.setItem('sp.theme', next); } catch { /* the choice lasts this page only */ }
  applyTheme(next);
  route();   // the charts take their colors when drawn
});
applyTheme(currentTheme());

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
    // The heading takes the name from the newest upload that carries one, so a
    // renamed locator shows its current name.
    const heading = h('h2', {}, locatorLabel(locatorId));
    let namedTs = -1;
    const noteName = (r: RecordInfo) => {
      if (r.locatorName && r.recordTs > namedTs) {
        namedTs = r.recordTs;
        heading.textContent = locatorLabel(locatorId, r.locatorName);
      }
    };
    const rows = recs.map((r) => {
      const samples = h('td', { class: 'num' }, r.samples !== undefined ? r.samples.toLocaleString() : '…');
      noteName(r);
      if (!('sizeBytes' in r)) {
        loadInfo(r).then((info) => {
          Object.assign(r, info);
          samples.textContent = info.samples !== undefined ? info.samples.toLocaleString() : '–';
          noteName(r);
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
      heading,
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
  const sub = h('p', { class: 'muted' }, `${locatorLabel(locatorId, rec.locatorName)} · record ${rec.crc}`);
  if (!('sizeBytes' in rec)) {
    loadInfo(rec).then((info) => {
      Object.assign(rec, info);
      sub.textContent = `${locatorLabel(locatorId, rec.locatorName)} · record ${rec.crc}`;
    }).catch(() => { /* the id alone is still correct */ });
  }
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
  const kmlButton = h('button', { type: 'button', disabled: true }, 'Google Earth (.kml)');
  kmlButton.title = 'The flight path in 3D, for Google Earth: open the file, or File → Import in earth.google.com';
  if (rec.csvPath) actions.append(kmlButton);

  const del = h('button', { type: 'button', class: 'danger' }, 'Delete flight');
  del.addEventListener('click', async () => {
    const ok = confirm(
      `Delete the ${formatRecordTime(rec.recordTs)} flight from locator ${locatorId} from the web store?\n\n` +
      'This removes its CSV and raw file here and breaks any share link to it. ' +
      'The copy on your phone and the one in the locator are not touched. This cannot be undone.');
    if (!ok) return;
    del.disabled = true; del.textContent = 'Deleting…';
    try {
      await deleteRecord(rec);
      flights = null;
      if (rec.csvPath) tableCache.delete(rec.csvPath);
      location.hash = '#/';
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
      del.disabled = false; del.textContent = 'Delete flight';
    }
  });
  actions.append(del);
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
  const t = table;
  const path = flightPath(t);
  if (path.length >= 2) {
    kmlButton.disabled = false;
    kmlButton.addEventListener('click', () => {
      const time = column(t, 'time_ms')!.map((v) => (v === null ? null : v / 1000));
      const state = column(t, 'flight_state');
      const name = `${locatorLabel(locatorId, rec.locatorName)}, ${formatRecordTime(rec.recordTs)}`;
      const kml = buildKml(name, path, state ? stateChanges(time, state) : []);
      const url = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
      const a = h('a', { href: url, download: csvFileName(rec).replace(/\.csv$/, '.kml') });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  } else {
    kmlButton.title = 'This flight has no GPS fixes, so there is no path to show.';
  }
  renderCharts(body, t);
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
