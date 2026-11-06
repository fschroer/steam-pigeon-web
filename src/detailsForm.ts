// The "Flight details" section of a flight page (ADR-0042 amendment, 2026-11-06).
// Every choice list is a suggestion list on a text field, so anything can be
// typed instead: a kit maker not listed, an EX motor, a delay drilled to 9 s.

import { h } from './dom';
import {
  loadDetails, saveDetails, appendLog, emptyMotor, motorSummary, parseDelays,
  EX_MOTOR, RECOVERY_TYPES, ROCKET_MAKERS, type FlightDetails, type MotorEntry,
} from './details';
import { manufacturers, motors, IMPULSE_CLASSES, type TcMotor } from './thrustcurve';

let listSeq = 0;

/** A text field with a suggestion list. Returns the field and a way to change the suggestions. */
function combo(value: string, placeholder: string, label: string, options: string[] = []) {
  const id = `dl${++listSeq}`;
  const list = h('datalist', { id });
  const input = h('input', { type: 'text', list: id, value, placeholder, 'aria-label': label, autocomplete: 'off' });
  const setOptions = (opts: { value: string; label?: string }[]) =>
    list.replaceChildren(...opts.map((o) => h('option', { value: o.value }, o.label ?? '')));
  setOptions(options.map((v) => ({ value: v })));
  return { input, list, setOptions, wrap: h('label', { class: 'field' }, label, input, list) };
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
    ...row('Electronics', d.electronics),
  ];
  return h('div', {},
    items.length ? h('dl', { class: 'details-list' }, ...items) : h('p', { class: 'muted' }, 'No details were added.'),
    d.notes ? h('pre', { class: 'notes-log' }, d.notes) : null);
}

export function detailsSection(ownerUid: string, locatorId: string, recordKey: string, editable: boolean): HTMLElement {
  const section = h('section', { class: 'details' }, h('h2', {}, 'Flight details'));
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  section.append(body);

  loadDetails(ownerUid, locatorId, recordKey).then((d) => {
    if (!editable) { body.replaceChildren(detailsReadOnly(d)); return; }

    const maker = combo(d.rocketMaker, 'Estes, LOC Precision…', 'Rocket manufacturer', ROCKET_MAKERS);
    const name = h('input', { type: 'text', value: d.rocketName, placeholder: 'Red Ryder Revisited', 'aria-label': 'Rocket name' });
    const recovery = combo(d.recovery, 'Parachute', 'Recovery', [...RECOVERY_TYPES]);
    const electronics = h('input', { type: 'text', value: d.electronics, placeholder: 'Steam Pigeon locator, Eggtimer Quasar…', 'aria-label': 'Electronics' });

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
    const entry = h('textarea', { rows: '2', placeholder: 'What happened, what to change next time…', 'aria-label': 'Add a note' });
    const addNote = h('button', { type: 'button' }, 'Add to log');
    const log = h('textarea', { rows: '6', class: 'notes-log', 'aria-label': 'Notes log' });
    log.value = d.notes;
    const logWrap = h('label', { class: 'field wide' }, 'Log', log);
    logWrap.hidden = !d.notes;

    const status = h('span', { class: 'muted small', 'aria-live': 'polite' });
    const save = h('button', { type: 'button', class: 'primary' }, 'Save details');
    const read = (): FlightDetails => ({
      rocketMaker: maker.input.value, rocketName: name.value, recovery: recovery.input.value,
      electronics: electronics.value, notes: log.value, motors: rows.map((r) => r.read()),
    });
    const doSave = async () => {
      save.disabled = true; status.textContent = 'Saving…';
      try { await saveDetails(ownerUid, locatorId, recordKey, read()); status.textContent = 'Saved.'; }
      catch (err) { status.textContent = `Could not save: ${(err as Error).message}`; }
      finally { save.disabled = false; }
    };
    save.addEventListener('click', doSave);
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
        recovery.wrap,
        h('label', { class: 'field' }, 'Electronics', electronics)),
      h('h3', {}, 'Motors'),
      h('p', { class: 'muted small' }, 'Pick a manufacturer, then the impulse class, then the motor; the delay list follows the motor. Any field also takes typed text, and EX (experimental) is in the manufacturer list.'),
      motorList, h('div', { class: 'actions' }, more),
      h('h3', {}, 'Notes'),
      h('label', { class: 'field wide' }, 'Add a note', entry), h('div', { class: 'actions' }, addNote),
      logWrap,
      h('div', { class: 'actions' }, save, status),
    );
  }).catch((err) => {
    body.replaceChildren(h('p', { class: 'error' }, `Could not load the details: ${(err as Error).message}`));
  });
  return section;
}
