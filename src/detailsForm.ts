// The "Flight details" section of a flight page (ADR-0042 amendment, 2026-11-06).
// Every choice list is a dropdown on a text field, so anything can be typed
// instead: a kit maker not listed, an EX motor, a delay drilled to 9 s.

import { h } from './dom';
import {
  loadDetails, saveDetails, appendLog, cleanDetails, emptyMotor, motorSummary, parseDelays,
  EX_MOTOR, RECOVERY_TYPES, ROCKET_MAKERS, ELECTRONICS, splitElectronics, joinElectronics,
  type FlightDetails, type MotorEntry,
} from './details';
import { manufacturers, motors, IMPULSE_CLASSES, type TcMotor } from './thrustcurve';

let listSeq = 0;

/**
 * The suggestion Tab should take for typed text: unchanged on an exact match,
 * else the first option whose value or label contains it, ignoring case.
 */
export function firstMatch(typed: string, options: { value: string; label?: string }[]): string | undefined {
  const t = typed.trim().toLowerCase();
  if (!t) return undefined;
  if (options.some((o) => o.value.toLowerCase() === t)) return options.find((o) => o.value.toLowerCase() === t)!.value;
  return options.find((o) => o.value.toLowerCase().includes(t) || (o.label ?? '').toLowerCase().includes(t))?.value;
}

export interface ComboOption { value: string; label?: string }

/** The options the list shows: all of them, or those whose value or label contains [typed]. */
export function filterOptions(typed: string, options: ComboOption[], showAll: boolean): ComboOption[] {
  const t = typed.trim().toLowerCase();
  if (showAll || !t) return options;
  return options.filter((o) => o.value.toLowerCase().includes(t) || (o.label ?? '').toLowerCase().includes(t));
}

/**
 * A text field with a dropdown list (the ARIA "editable combobox" pattern),
 * used instead of the browser's datalist because a datalist only ever offers
 * what matches the text already in the field. Here:
 * - entering the field, or clicking its arrow, opens the whole list, with the
 *   current value marked, and selects the text so typing replaces it;
 * - typing narrows the list (value or label containing the text);
 * - Up/Down move, Enter picks, Escape closes; a click picks;
 * - Tab after typing takes the first match (an exact match, or no match, is
 *   left as typed);
 * - anything can still be typed, so a value not in the list is kept.
 * Picking fires "change" on the field, as typing does on leaving it.
 */
export function combo(value: string, placeholder: string, label: string, options: string[] = []) {
  const id = `cb${++listSeq}`;
  let opts: ComboOption[] = options.map((v) => ({ value: v }));
  let shown: ComboOption[] = [];
  let active = -1;
  let showAll = true;
  let typed = false;

  const input = h('input', {
    type: 'text', value, placeholder, 'aria-label': label, autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': id, 'aria-autocomplete': 'list',
  });
  const arrow = h('button', { type: 'button', class: 'combo-arrow', tabindex: '-1', 'aria-label': `Show all ${label} choices` }, '▾');
  const list = h('ul', { id, role: 'listbox', class: 'combo-list', 'aria-label': label });
  list.hidden = true;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const pick = (v: string) => {
    input.value = v;
    close();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const render = () => {
    shown = filterOptions(input.value, opts, showAll);
    if (!shown.length) { close(); return; }
    const cur = input.value.trim().toLowerCase();
    list.replaceChildren(...shown.map((o, i) => {
      const li = h('li', { id: `${id}-${i}`, role: 'option', class: 'combo-option',
        'aria-selected': o.value.toLowerCase() === cur ? 'true' : 'false' },
        h('span', {}, o.value), o.label && o.label !== o.value ? h('span', { class: 'muted small' }, o.label) : null);
      if (i === active) li.classList.add('active');
      // mousedown, not click, so the field keeps focus and does not close the list first.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(o.value); });
      return li;
    }));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    const target = active >= 0 ? active : shown.findIndex((o) => o.value.toLowerCase() === cur);
    if (target >= 0) list.children[target]?.scrollIntoView({ block: 'nearest' });
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const openAll = () => { showAll = true; typed = false; active = -1; render(); };

  input.addEventListener('focus', () => { openAll(); input.select(); });
  input.addEventListener('click', () => { if (list.hidden) openAll(); });
  input.addEventListener('blur', close);
  input.addEventListener('input', () => { showAll = false; typed = true; active = -1; render(); });
  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!list.hidden && showAll) { close(); return; }
    input.focus();
    openAll();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) { openAll(); return; }
      const n = shown.length;
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1);
      render();
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) { e.preventDefault(); pick(shown[active].value); }
    } else if (e.key === 'Escape') {
      if (!list.hidden) { e.preventDefault(); close(); }
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Tab after typing takes the first match, the way the list is ordered.
      if (!typed) { close(); return; }
      const m = firstMatch(input.value, opts);
      close();
      if (m !== undefined && m !== input.value) { input.value = m; input.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  });

  const setOptions = (next: ComboOption[]) => {
    opts = next;
    if (!list.hidden) render();
  };
  const wrap = h('div', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'combo' }, input, arrow, list));
  return { input, setOptions, wrap };
}

function motorRow(m: MotorEntry, onRemove: () => void): { el: HTMLElement; read: () => MotorEntry } {
  const maker = combo(m.maker, 'AeroTech, Cesaroni, EX…', 'Motor manufacturer');
  const impulse = combo(m.impulse, 'H', 'Impulse', IMPULSE_CLASSES);
  const motor = combo(m.motor, 'H128W', 'Motor');
  const delay = combo(m.delay, 'seconds', 'Delay');
  let motorId = m.motorId;
  let found: TcMotor[] = [];

  manufacturers()
    .then((ms) => maker.setOptions([{ value: EX_MOTOR }, ...ms.map((x) => ({ value: x.abbrev, label: x.name }))]))
    .catch(() => maker.setOptions([{ value: EX_MOTOR }]));

  const isEx = () => maker.input.value.trim() === EX_MOTOR;
  const showDelays = () => {
    const pick = found.find((x) => x.designation === motor.input.value.trim() || x.commonName === motor.input.value.trim());
    motorId = pick?.motorId;
    delay.setOptions(parseDelays(pick?.delays).map((d) => ({ value: d, label: d === 'P' ? 'plugged' : `${d} s` })));
  };
  const loadMotors = () => {
    found = [];
    motor.setOptions([]);
    const mk = maker.input.value.trim();
    const ic = impulse.input.value.trim().toUpperCase();
    if (!mk || !ic || isEx()) { showDelays(); return; }
    motors(mk, ic).then((list) => {
      if (maker.input.value.trim() !== mk) return;   // changed meanwhile
      found = list;
      motor.setOptions(list.map((x) => ({
        value: x.designation,
        label: [x.commonName, x.availability === 'OOP' ? 'out of production' : ''].filter(Boolean).join(' · '),
      })));
      showDelays();
    }).catch(() => { /* typed text still works */ });
  };
  maker.input.addEventListener('change', () => { motor.input.value = ''; loadMotors(); });
  impulse.input.addEventListener('change', () => { motor.input.value = ''; loadMotors(); });
  motor.input.addEventListener('change', showDelays);
  if (m.maker && m.impulse) loadMotors();

  const remove = h('button', { type: 'button', class: 'link' }, 'Remove');
  remove.addEventListener('click', onRemove);
  const el = h('div', { class: 'motor-row' }, maker.wrap, impulse.wrap, motor.wrap, delay.wrap, remove);
  return {
    el,
    read: () => ({
      maker: maker.input.value, impulse: impulse.input.value, motor: motor.input.value, delay: delay.input.value,
      ...(motorId ? { motorId } : {}),
    }),
  };
}

/** Read-only view, for a flight someone shared. */
function detailsReadOnly(d: FlightDetails): HTMLElement {
  const row = (k: string, v: string) => (v ? [h('dt', {}, k), h('dd', {}, v)] : []);
  const items = [
    ...row('Rocket', [d.rocketMaker, d.rocketName].filter(Boolean).join(' · ')),
    ...row('Motors', d.motors.map(motorSummary).join(', ')),
    ...row('Recovery', d.recovery),
    ...row('Electronics', splitElectronics(d.electronics).join(', ')),
  ];
  return h('div', {},
    items.length ? h('dl', { class: 'details-list' }, ...items) : h('p', { class: 'muted' }, 'No details were added.'),
    d.notes ? h('pre', { class: 'notes-log' }, d.notes) : null);
}

export function detailsSection(ownerUid: string, locatorId: string, recordKey: string, editable: boolean): HTMLElement {
  const status = h('span', { class: 'muted small save-status', 'aria-live': 'polite' });
  const section = h('section', { class: 'details' }, h('h2', {}, 'Flight details ', status));
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  section.append(body);

  loadDetails(ownerUid, locatorId, recordKey).then((d) => {
    if (!editable) { body.replaceChildren(detailsReadOnly(d)); return; }

    const maker = combo(d.rocketMaker, 'Estes, LOC Precision…', 'Rocket manufacturer', ROCKET_MAKERS);
    const name = h('input', { type: 'text', spellcheck: 'false', value: d.rocketName, placeholder: 'Red Ryder Revisited', 'aria-label': 'Rocket name' });
    const recovery = combo(d.recovery, 'Parachute', 'Recovery', [...RECOVERY_TYPES]);
    // Electronics: one dropdown per device, as many as were flown.
    const elecList = h('div', { class: 'elec-list' });
    const elecRows: { input: HTMLInputElement; el: HTMLElement }[] = [];
    const addElec = (v: string) => {
      const c = combo(v, 'Featherweight Raven…', 'Electronics', ELECTRONICS);
      const remove = h('button', { type: 'button', class: 'link' }, 'Remove');
      const el = h('div', { class: 'elec-row' }, c.wrap, remove);
      const row = { input: c.input, el };
      remove.addEventListener('click', () => { elecRows.splice(elecRows.indexOf(row), 1); el.remove(); });
      elecRows.push(row);
      elecList.append(el);
    };
    const elec0 = splitElectronics(d.electronics);
    (elec0.length ? elec0 : ['']).forEach(addElec);
    const moreElec = h('button', { type: 'button' }, 'Add another device');
    moreElec.addEventListener('click', () => addElec(''));

    const motorList = h('div', { class: 'motors' });
    const rows: ReturnType<typeof motorRow>[] = [];
    const addMotor = (m: MotorEntry) => {
      const r = motorRow(m, () => { rows.splice(rows.indexOf(r), 1); r.el.remove(); });
      rows.push(r);
      motorList.append(r.el);
    };
    (d.motors.length ? d.motors : [emptyMotor()]).forEach(addMotor);
    const more = h('button', { type: 'button' }, 'Add another motor');
    more.addEventListener('click', () => addMotor(emptyMotor()));

    // Notes: an entry is stamped and added to the log; the log is edited directly after that.
    const entry = h('textarea', { rows: '2', spellcheck: 'true', placeholder: 'What happened, what to change next time…', 'aria-label': 'Add a note' });
    const addNote = h('button', { type: 'button' }, 'Add to log');
    const log = h('textarea', { rows: '6', class: 'notes-log', spellcheck: 'true', 'aria-label': 'Notes log' });
    log.value = d.notes;
    const logWrap = h('label', { class: 'field wide' }, 'Log', log);
    logWrap.hidden = !d.notes;

    // Autosave: a change is saved about a second after the last keystroke or
    // pick. Saves run one at a time; what changed meanwhile is saved next.
    const read = (): FlightDetails => ({
      rocketMaker: maker.input.value, rocketName: name.value, recovery: recovery.input.value,
      electronics: joinElectronics(elecRows.map((r) => r.input.value)), notes: log.value, motors: rows.map((r) => r.read()),
    });
    let savedJson = JSON.stringify(cleanDetails(read()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saving: Promise<void> | null = null;
    const dirty = () => JSON.stringify(cleanDetails(read())) !== savedJson;
    const doSave = async (): Promise<void> => {
      if (timer) { clearTimeout(timer); timer = undefined; }
      if (saving) { await saving; return doSave(); }
      if (!dirty()) return;
      const d = read();
      const json = JSON.stringify(cleanDetails(d));
      status.textContent = 'Saving…';
      saving = saveDetails(ownerUid, locatorId, recordKey, d)
        .then(() => { savedJson = json; status.textContent = dirty() ? 'Saving…' : 'All changes saved'; })
        .catch((err) => { status.textContent = `Not saved: ${(err as Error).message}`; })
        .finally(() => { saving = null; });
      await saving;
      if (dirty()) schedule();
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (dirty()) status.textContent = 'Unsaved changes…';
      timer = setTimeout(() => { void doSave(); }, 1000);
    };
    body.addEventListener('input', schedule);
    body.addEventListener('change', schedule);
    body.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) schedule(); });
    // Leaving with a change not yet saved: save now and let the browser ask.
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirty()) return;
      void doSave();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    // This page is left by a hash change: save what is pending, then stop guarding it.
    window.addEventListener('hashchange', () => {
      void doSave().finally(() => window.removeEventListener('beforeunload', warn));
    }, { once: true });
    addNote.addEventListener('click', async () => {
      if (!entry.value.trim()) return;
      log.value = appendLog(log.value, entry.value, new Date());
      entry.value = '';
      logWrap.hidden = false;
      await doSave();
    });

    body.replaceChildren(
      h('div', { class: 'details-grid' },
        maker.wrap,
        h('label', { class: 'field' }, 'Rocket name', name),
        recovery.wrap),
      h('h3', {}, 'Motors'),
      h('p', { class: 'muted small' }, 'Pick a manufacturer, then the impulse class, then the motor; the delay list follows the motor. Any field also takes typed text, and EX (experimental) is in the manufacturer list.'),
      motorList, h('div', { class: 'actions' }, more),
      h('h3', {}, 'Electronics'),
      elecList, h('div', { class: 'actions' }, moreElec),
      h('h3', {}, 'Notes'),
      h('label', { class: 'field wide' }, 'Add a note', entry), h('div', { class: 'actions' }, addNote),
      logWrap,
    );
  }).catch((err) => {
    body.replaceChildren(h('p', { class: 'error' }, `Could not load the details: ${(err as Error).message}`));
  });
  return section;
}
