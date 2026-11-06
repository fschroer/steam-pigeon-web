import './style.css';
import type { User } from 'firebase/auth';
import { configured } from './firebase';
import { watchUser, signInGoogle, signInEmail, resetPassword, signOut, authMessage, sendVerification, refreshUser } from './auth';
import { addShare, removeShare, sharesOfRecord, sharedWithMe, normalizeEmail, sharedCsvPath, shareMailto, type Share } from './shares';
import { listFlights, loadInfo, fetchCsvText, fetchBlob, shareLink, deleteRecord, saveLocalCsv, readMeta, savePlace, saveSamples, type RecordInfo } from './store';
import { lookupPlace, PLACE_ATTRIBUTION } from './place';
import { detailsSection } from './detailsForm';
import { deleteDetails } from './details';
import type { PathPoint } from './kml';
import { formatRecordTime, recordId, csvFileName, locatorLabel } from './records';
import { parseFlightCsv, column, stateChanges, type FlightTable } from './csv';
import { flightPath, buildKml } from './kml';
import { MAPS_KEY, padElevationM, flightCamera, showFlight3D } from './map3d';
import { h, type Child } from './dom';
import { renderCharts, disposeCharts } from './flight';
import { currentUnits, saveUnits, type Units } from './units';

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

// ---- units: metric or English, for charts and readouts only (the CSV stays SI) ------

const unitsButton = document.getElementById('units') as HTMLButtonElement;
function applyUnits(u: Units) {
  unitsButton.textContent = `Units: ${u === 'english' ? 'English (ft)' : 'Metric (m)'}`;
  unitsButton.title = 'Switch charts and readouts between meters and feet. Downloads stay in meters.';
}
unitsButton.addEventListener('click', () => {
  const next: Units = currentUnits() === 'english' ? 'metric' : 'english';
  saveUnits(next);
  applyUnits(next);
  route();
});
applyUnits(currentUnits());

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
    body.replaceChildren(h('p', {}, 'No flights yet. Records appear here after the app downloads them from a locator and uploads them while you are signed in.'), sharedSection(), openLocalSection());
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
      const place = h('td', {}, r.place ?? '');
      const flight = flightCell(`#/flight/${locatorId}/${recordId(r)}`, r.recordTs, () => r.originalName);
      noteName(r);
      const needPlace = () => {
        if (r.csvPath && (!r.place || r.samples === undefined)) queueBackfill(r, place, samples);
      };
      if (!('sizeBytes' in r)) {
        loadInfo(r).then((info) => {
          Object.assign(r, info);
          samples.textContent = info.samples !== undefined ? info.samples.toLocaleString() : '–';
          place.textContent = info.place ?? '';
          flight.fill();
          noteName(r);
          needPlace();
        }).catch(() => { samples.textContent = '–'; });
      } else needPlace();
      const files = [r.csvPath && 'CSV', r.binPath && 'raw'].filter(Boolean).join(' + ');
      return h('tr', {},
        flight.cell,
        place,
        samples,
        h('td', { class: 'muted' }, files),
      );
    });
    body.append(h('section', { class: 'locator' },
      heading,
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, 'Flight'), h('th', { title: 'Named the first time the flight is opened' }, 'Place'),
          h('th', { class: 'num' }, 'Samples'), h('th', {}, 'Files'))),
        h('tbody', {}, ...rows),
      ),
    ));
  }
  body.append(sharedSection(), openLocalSection());
}

// ---- sharing with named people (ADR-0042 amendment, 2026-11-06) --------------------------

/** "Shared with you": records other people shared with this account's email. */
function sharedSection(): HTMLElement {
  const section = h('section', { class: 'locator' }, h('h2', {}, 'Shared with you'));
  const email = user?.email;
  if (!email) {
    section.append(h('p', { class: 'muted' }, 'This account has no email address, so nothing can be shared with it.'));
    return section;
  }
  if (!user!.emailVerified) {
    const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const send = h('button', { type: 'button' }, 'Send verification email');
    send.addEventListener('click', async () => {
      send.disabled = true;
      try { await sendVerification(); status.textContent = `A link was sent to ${email}. Open it, then press “I’ve verified”.`; }
      catch (err) { status.textContent = authMessage(err); send.disabled = false; }
    });
    const done = h('button', { type: 'button', class: 'link' }, 'I’ve verified');
    done.addEventListener('click', async () => {
      try { user = await refreshUser(); } catch { /* keep the old state */ }
      route();
    });
    section.append(
      h('p', { class: 'muted' }, `Flights others share with ${email} show here once that address is verified.`),
      h('div', { class: 'actions' }, send, done), status);
    return section;
  }
  const list = h('p', { class: 'muted' }, 'Loading…');
  section.append(list);
  sharedWithMe(email).then((items) => {
    if (!items.length) { list.textContent = `Nothing has been shared with ${email} yet.`; return; }
    const rows = items.map((s) => {
      const [ts, crc] = s.recordKey.split('_');
      const place = h('td', {});
      let original: string | undefined;
      const flight = flightCell(`#/shared/${s.ownerUid}/${s.locatorId}/${s.recordKey}`, Number(ts), () => original);
      void readMeta(sharedCsvPath(s)).then((m) => { place.textContent = m.place ?? ''; original = m.originalName; flight.fill(); });
      return h('tr', {},
        flight.cell,
        place,
        h('td', {}, locatorLabel(s.locatorId, s.locatorName)),
        h('td', { class: 'muted' }, s.ownerEmail ?? 'unknown owner'),
        h('td', { class: 'muted' }, crc),
      );
    });
    list.replaceWith(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Flight'), h('th', {}, 'Place'), h('th', {}, 'Locator'), h('th', {}, 'Shared by'), h('th', {}, 'Record'))),
      h('tbody', {}, ...rows)));
  }).catch((err) => { list.replaceWith(errorBox(`Could not list shared flights: ${(err as Error).message}`)); });
  return section;
}

/** On the owner's flight page: who can see this flight, and a field to add someone. */
function sharePanel(rec: RecordInfo, locatorId: string): HTMLElement {
  const recordKey = recordId(rec);
  const section = h('section', { class: 'share' }, h('h2', {}, 'Share with people'));
  const list = h('ul', { class: 'share-list' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const input = h('input', { type: 'email', placeholder: 'name@example.com', 'aria-label': 'Email address to share with' });
  const add = h('button', { type: 'submit', class: 'primary' }, 'Share');

  const flight = `${formatRecordTime(rec.recordTs)}, ${locatorLabel(locatorId, rec.locatorName)}`;
  const mailLink = (s: Share, text: string) => h('a', {
    href: shareMailto(s.recipientEmail, flight,
      `${location.origin}${location.pathname}#/shared/${s.ownerUid}/${s.locatorId}/${s.recordKey}`,
      user!.displayName || user!.email || undefined),
  }, text);
  const row = (s: Share) => {
    const remove = h('button', { type: 'button', class: 'link' }, 'Remove');
    const li = h('li', {}, h('span', {}, s.recipientEmail), h('span', { class: 'share-actions' }, mailLink(s, 'Email'), remove));
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try { await removeShare(s.id); li.remove(); status.textContent = `${s.recipientEmail} can no longer open this flight.`; }
      catch (err) { status.textContent = `Could not remove: ${(err as Error).message}`; remove.disabled = false; }
    });
    return li;
  };

  const form = h('form', {
    class: 'share-form',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      const email = normalizeEmail(input.value);
      if (!email) { status.textContent = 'Enter an email address.'; return; }
      if (email === user!.email?.toLowerCase()) { status.textContent = 'That is your own address.'; return; }
      add.disabled = true;
      try {
        const s = await addShare({
          ownerUid: user!.uid, ownerEmail: user!.email ?? undefined,
          locatorId, locatorName: rec.locatorName, recordKey, recipientEmail: email,
        });
        if (![...list.querySelectorAll('li span')].some((x) => x.textContent === email)) list.append(row(s));
        input.value = '';
        status.replaceChildren(
          `Shared with ${email}. They see it under “Shared with you” after signing in with that address. `,
          mailLink(s, 'Tell them by email'),
          ' (opens your email app with a note and the link).');
      } catch (err) {
        status.textContent = `Could not share: ${(err as Error).message}`;
      } finally { add.disabled = false; }
    },
  }, input, add);

  section.append(
    h('p', { class: 'muted small' }, 'They can view, chart and download the CSV, but not change or delete it. You can remove them at any time.'),
    form, list, status);
  sharesOfRecord(user!.uid, locatorId, recordKey)
    .then((items) => list.replaceChildren(...items.map(row)))
    .catch((err) => { status.textContent = `Could not load who this is shared with: ${(err as Error).message}`; });
  return section;
}

/** A flight someone else shared: read-only, from their store. */
async function sharedFlightView(ownerUid: string, locatorId: string, recordKey: string) {
  header();
  const back = h('a', { href: '#/' }, '← All flights');
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  show(back, body);
  let share: Share | undefined;
  try {
    share = (await sharedWithMe(user!.email ?? ''))
      .find((s) => s.ownerUid === ownerUid && s.locatorId === locatorId && s.recordKey === recordKey);
  } catch { /* the CSV read below gives the real answer */ }
  const [ts, crc] = recordKey.split('_');
  const csvPath = sharedCsvPath({ ownerUid, locatorId, recordKey });
  const name = locatorLabel(locatorId, share?.locatorName);
  const fileBase = `steam-pigeon_${locatorId}_${recordKey}`;
  const csvButton = h('button', { type: 'button', class: 'primary' }, 'Download CSV');
  csvButton.addEventListener('click', () => download(csvPath, `${fileBase}.csv`, csvButton));
  const kmlButton = h('button', { type: 'button', disabled: true }, 'Google Earth (.kml)');
  const remove = h('button', { type: 'button', class: 'link' }, 'Remove from my list');
  remove.addEventListener('click', async () => {
    if (!share) return;
    if (!confirm('Remove this flight from “Shared with you”? You will need the owner to share it again to see it.')) return;
    try { await removeShare(share.id); location.hash = '#/'; }
    catch (err) { alert(`Could not remove: ${(err as Error).message}`); }
  });
  const time = formatRecordTime(Number(ts));
  const title = h('h1', {});
  const heading = titleControl(title, time);
  const subText = (orig?: string) =>
    `${orig ? `${time} · ` : ''}${name} · record ${crc} · shared by ${share?.ownerEmail ?? 'another flyer'}`;
  const sub = h('p', { class: 'muted' }, subText());
  body.replaceChildren(title, sub, h('div', { class: 'actions' }, csvButton, kmlButton, share ? remove : null),
    detailsSection(ownerUid, locatorId, recordKey, false));
  const meta = readMeta(csvPath);
  void meta.then((m) => { if (m.originalName) { heading.setBase(m.originalName); sub.textContent = subText(m.originalName); } });
  // Only the owner can keep the place on the file, so a recipient just looks it up.
  await renderFlightData(body, csvPath, kmlButton, `${name}, ${time}`, `${fileBase}.kml`,
    'Could not open this flight. The owner may have stopped sharing it or deleted it',
    { known: async () => (await meta).place, show: placeShower(heading, sub) });
}

// What the list fills in by itself, for flights never opened: the place, and
// the sample count of a CSV saved from the computer (the app's uploads carry
// it). One flight at a time, at most one place lookup a second (Nominatim's
// limit), loading each CSV once. What is found is kept on the CSV, so each
// flight is done once.
const backfillQueue: { rec: RecordInfo; placeCell: HTMLElement; samplesCell: HTMLElement }[] = [];
let backfillWorker: Promise<void> | null = null;
const backfillTried = new Set<string>();

function queueBackfill(rec: RecordInfo, placeCell: HTMLElement, samplesCell: HTMLElement) {
  const key = rec.csvPath!;
  if (backfillTried.has(key)) return;
  backfillTried.add(key);
  if (!rec.place) placeCell.textContent = '…';
  if (rec.samples === undefined) samplesCell.textContent = '…';
  backfillQueue.push({ rec, placeCell, samplesCell });
  backfillWorker ??= (async () => {
    while (backfillQueue.length) {
      const { rec: r, placeCell: pc, samplesCell: sc } = backfillQueue.shift()!;
      const started = Date.now();
      let looked = false;
      try {
        let t = tableCache.get(r.csvPath!);
        t ??= parseFlightCsv(await fetchCsvText(r.csvPath!));   // not cached: only a little is needed
        if (r.samples === undefined) {
          r.samples = t.rows;
          sc.textContent = t.rows.toLocaleString();
          await saveSamples(r.csvPath!, t.rows).catch(() => { /* shown; counted again later */ });
        }
        if (!r.place) {
          const pad = flightPath(t)[0];
          looked = Boolean(pad);
          const p = pad ? await lookupPlace(pad.lat, pad.lon) : undefined;
          if (p) { r.place = p; await savePlace(r.csvPath!, p).catch(() => { /* shown; looked up again later */ }); }
          pc.textContent = p ?? '';
        }
      } catch {
        if (!r.place) pc.textContent = '';
        if (r.samples === undefined) sc.textContent = '–';
      }
      const wait = 1100 - (Date.now() - started);
      if (looked && wait > 0 && backfillQueue.length) await new Promise((res) => setTimeout(res, wait));
    }
    backfillWorker = null;
  })();
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

  const time = formatRecordTime(rec.recordTs);
  const title = h('h1', {});
  const heading = titleControl(title, rec.originalName ?? time);
  // A CSV saved from the computer is titled by its file name, with the time below.
  const subText = () =>
    `${rec.originalName ? `${time} · ` : ''}${locatorLabel(locatorId, rec.locatorName)} · record ${rec.crc}`;
  const sub = h('p', { class: 'muted' }, subText());
  if (!('sizeBytes' in rec)) {
    loadInfo(rec).then((info) => {
      Object.assign(rec, info);
      sub.textContent = subText();
      if (rec.originalName) heading.setBase(rec.originalName);
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
      // Its shares would point at nothing; remove them too (best effort).
      try { await Promise.all((await sharesOfRecord(user!.uid, locatorId, recordId(rec))).map((s) => removeShare(s.id))); }
      catch { /* the record is gone, which already closes them */ }
      await deleteDetails(user!.uid, locatorId, recordId(rec)).catch(() => { /* none, or left behind harmlessly */ });
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
  body.append(detailsSection(user!.uid, locatorId, recordId(rec), true), sharePanel(rec, locatorId));
  const csvPath = rec.csvPath;
  await renderFlightData(body, csvPath, kmlButton,
    `${locatorLabel(locatorId, rec.locatorName)}, ${formatRecordTime(rec.recordTs)}`,
    csvFileName(rec).replace(/\.csv$/, '.kml'), 'Could not load the CSV', {
      known: async () => (await loadInfo(rec).catch(() => rec as RecordInfo)).place,
      save: async (p) => { await savePlace(csvPath, p); rec.place = p; },
      onTable: (t) => {
        if (rec.samples !== undefined) return;
        rec.samples = t.rows;
        saveSamples(csvPath, t.rows).catch(() => { /* counted again next time */ });
      },
      show: placeShower(heading, sub),
    });
}

interface PlaceHooks {
  /** The name already kept for this flight, if any. */
  known?: () => Promise<string | undefined>;
  /** Keeps a looked-up name (the owner only). */
  save?: (place: string) => Promise<void>;
  /** Called with the loaded table, e.g. to keep its row count (the owner only). */
  onTable?: (t: FlightTable) => void;
  show: (place: string) => void;
}

/** Names the launch site from the pad's fix: the kept name, else one lookup (src/place.ts). */
async function resolvePlace(path: PathPoint[], hooks: PlaceHooks) {
  let place = await hooks.known?.().catch(() => undefined);
  if (!place && path.length) {
    place = await lookupPlace(path[0].lat, path[0].lon);
    if (place && hooks.save) hooks.save(place).catch(() => { /* shown anyway; looked up again next time */ });
  }
  if (place) hooks.show(place);
}

/** A page title made of a base (the flight time, or a saved file's name) and, once known, the place. */
function titleControl(el: HTMLElement, base: string) {
  let b = base;
  let p: string | undefined;
  const render = () => { el.textContent = p ? `${b} · ${p}` : b; };
  render();
  return {
    setBase(x: string) { b = x; render(); },
    setPlace(x: string) { p = x; render(); },
  };
}

/** Puts the place in the page title, with the attribution OpenStreetMap asks for. */
function placeShower(title: ReturnType<typeof titleControl>, after: HTMLElement): (place: string) => void {
  let credited = false;
  return (place) => {
    title.setPlace(place);
    if (!credited) { credited = true; after.after(h('p', { class: 'muted small attribution' }, PLACE_ATTRIBUTION)); }
  };
}

/**
 * The Flight cell of a list row: the time, or for a CSV saved from the computer
 * its file name with the time below. Call fill() again once the name may be known.
 */
function flightCell(href: string, recordTs: number, originalName: () => string | undefined):
  { cell: HTMLElement; fill: () => void } {
  const link = h('a', { href }, formatRecordTime(recordTs));
  const cell = h('td', {}, link);
  const fill = () => {
    const n = originalName();
    if (!n || cell.childNodes.length > 1) return;
    link.textContent = n;
    cell.append(h('div', { class: 'muted small' }, formatRecordTime(recordTs)));
  };
  fill();
  return { cell, fill };
}

/** Loads a stored CSV and adds the 3D view and charts below [body]. */
async function renderFlightData(body: HTMLElement, csvPath: string, kmlButton: HTMLButtonElement,
  kmlName: string, kmlFile: string, failText: string, place?: PlaceHooks) {
  const loading = h('p', { class: 'muted' }, 'Loading flight data…');
  body.append(loading);
  let table = tableCache.get(csvPath);
  try {
    if (!table) {
      table = parseFlightCsv(await fetchCsvText(csvPath));
      tableCache.set(csvPath, table);
    }
  } catch (err) {
    loading.replaceWith(errorBox(`${failText}: ${(err as Error).message}`));
    return;
  }
  loading.remove();
  const t = table;
  const path = flightPath(t);
  if (place) { place.onTable?.(t); void resolvePlace(path, place); }
  wireKml(kmlButton, t, path, kmlName, kmlFile);
  body.append(view3d(t, path));
  renderCharts(body, t);
}

/**
 * The in-page 3D view (ADR-0042 amendment). Each map load is billed, so the map
 * is built only when asked for, never on opening the page.
 */
function view3d(t: FlightTable, path: ReturnType<typeof flightPath>): HTMLElement {
  const section = h('section', { class: 'view3d' }, h('h2', {}, '3D view'));
  if (path.length < 2) {
    section.append(h('p', { class: 'muted' }, 'This flight has no GPS fixes, so there is no path to show.'));
    return section;
  }
  if (!MAPS_KEY) {
    section.append(h('p', { class: 'muted' },
      'Not available in this build: add VITE_GOOGLE_MAPS_API_KEY to .env.local (see the README).'));
    return section;
  }
  const pad = padElevationM(t);
  const time = column(t, 'time_ms')!.map((v) => (v === null ? null : v / 1000));
  const state = column(t, 'flight_state');
  const events = state ? stateChanges(time, state) : [];

  const host = h('div', { class: 'map3d' });
  const controls = h('div', { class: 'actions' });
  const show = h('button', { type: 'button', class: 'primary' }, 'Show 3D view');
  controls.append(show);
  section.append(controls);
  show.addEventListener('click', async () => {
    show.disabled = true; show.textContent = 'Loading 3D map…';
    section.append(host);
    try {
      const aspect = host.clientHeight / Math.max(1, host.clientWidth);
      const camera = flightCamera(path, pad, aspect)!;
      const v = await showFlight3D(host, path, events, camera);
      const fly = h('button', { type: 'button', class: 'primary' }, 'Fly around');
      fly.title = 'One slow circle around the flight. Click the map to stop.';
      fly.addEventListener('click', () => v.flyAround());
      const reset = h('button', { type: 'button' }, 'Reset view');
      reset.addEventListener('click', () => v.resetView());
      // Hiding keeps the loaded map, so showing it again is not another billed load.
      const toggle = h('button', { type: 'button' }, 'Hide 3D view');
      toggle.addEventListener('click', () => {
        const hide = !host.hidden;
        if (hide) v.stop();
        host.hidden = hide;
        fly.hidden = hide; reset.hidden = hide;
        toggle.textContent = hide ? 'Show 3D view' : 'Hide 3D view';
      });
      controls.replaceChildren(fly, reset, toggle);
    } catch (err) {
      host.remove();
      show.disabled = false; show.textContent = 'Show 3D view';
      section.append(errorBox(`The 3D map did not load: ${(err as Error).message}`));
    }
  });
  return section;
}

/** Enables [button] to save the flight as KML, or explains why it cannot. */
function wireKml(button: HTMLButtonElement, t: FlightTable, path: ReturnType<typeof flightPath>, name: string, file: string) {
  if (path.length < 2) {
    button.title = 'This flight has no GPS fixes, so there is no path to show.';
    return;
  }
  button.disabled = false;
  button.addEventListener('click', () => {
    const time = column(t, 'time_ms')!.map((v) => (v === null ? null : v / 1000));
    const state = column(t, 'flight_state');
    const kml = buildKml(name, path, state ? stateChanges(time, state) : []);
    const url = URL.createObjectURL(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }));
    const a = h('a', { href: url, download: file });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

// ---- a CSV from the viewer's own computer --------------------------------------------------
//
// Charts, 3D view and KML for an export already on disk (a USB export, or a CSV
// downloaded earlier), read in the browser. Nothing is uploaded; the file is gone
// when the page reloads.

let localFile: { name: string; table: FlightTable; text: string; lastModified: number } | null = null;

function openLocalSection(): HTMLElement {
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const input = h('input', { type: 'file', accept: '.csv,text/csv' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    status.textContent = `Reading ${f.name}…`;
    try {
      const text = await f.text();
      const table = parseFlightCsv(text);
      if (!table.columns.includes('time_ms')) throw new Error('it has no time_ms column, so it is not a Steam Pigeon flight export');
      localFile = { name: f.name, table, text, lastModified: f.lastModified };
      location.hash = '#/local';
    } catch (err) {
      status.textContent = `Could not open ${f.name}: ${(err as Error).message}`;
    }
    input.value = '';
  });
  return h('section', { class: 'locator' },
    h('h2', {}, 'Open a CSV from your computer'),
    h('p', { class: 'muted' }, 'A USB export or a downloaded flight CSV. It is charted here in your browser and not uploaded.'),
    h('label', { class: 'file' }, input),
    status,
  );
}

function localView() {
  header();
  if (!localFile) { location.hash = '#/'; return; }
  const { name, table: t, text, lastModified } = localFile;
  const back = h('a', { href: '#/' }, '← All flights');
  const kmlButton = h('button', { type: 'button', disabled: true }, 'Google Earth (.kml)');
  // Sharing needs the file in the store, where the rules can guard it.
  const save = h('button', { type: 'button', class: 'primary' }, 'Save to my flights');
  save.title = 'Copies this CSV into your web store, under “Saved from your computer”, so you can share it.';
  save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = 'Saving…';
    try {
      const { locatorId, recordKey } = await saveLocalCsv(user!.uid, text, name, lastModified, t.rows);
      flights = null;
      location.hash = `#/flight/${locatorId}/${recordKey}`;
    } catch (err) {
      alert(`Could not save: ${(err as Error).message}`);
      save.disabled = false; save.textContent = 'Save to my flights';
    }
  });
  const title = h('h1', {});
  const heading = titleControl(title, name.replace(/\.csv$/i, ''));
  const sub = h('p', { class: 'muted' }, 'From your computer, not the web store. Reloading the page closes it. Save it to your flights to share it.');
  const body = h('div', {}, title, sub, h('div', { class: 'actions' }, save, kmlButton));
  show(back, body);
  const path = flightPath(t);
  void resolvePlace(path, { show: placeShower(heading, sub) });
  wireKml(kmlButton, t, path, name.replace(/\.csv$/i, ''), name.replace(/\.csv$/i, '') + '.kml');
  body.append(view3d(t, path));
  renderCharts(body, t);
}

// ---- routing ----------------------------------------------------------------------------

function route() {
  if (!configured) { notConfiguredView(); return; }
  if (!user) { signInView(); return; }
  const m = /^#\/flight\/(\d+)\/(\d+_[0-9a-f]{8})$/.exec(location.hash);
  const sh = /^#\/shared\/([A-Za-z0-9]+)\/(\d+)\/(\d+_[0-9a-f]{8})$/.exec(location.hash);
  if (m) void flightView(m[1], m[2]);
  else if (sh) void sharedFlightView(sh[1], sh[2], sh[3]);
  else if (location.hash === '#/local') localView();
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
