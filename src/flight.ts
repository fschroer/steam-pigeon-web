import type uPlot from 'uplot';
import { h } from './dom';
import { column, stateChanges, type FlightTable } from './csv';
import { PANELS, DEFAULT_SELECTION, flightStateName, flightStateAbbr } from './channels';
import { panelChart, destroyChart, seriesColor } from './chart';
import { currentUnits, panelUnits } from './units';

let charts: uPlot[] = [];

export function disposeCharts(): void {
  for (const c of charts) destroyChart(c);
  charts = [];
}

function errorBox(msg: string): HTMLElement {
  return h('p', { class: 'error', role: 'alert' }, msg);
}

// ---- preferences (per viewer, optional) -----------------------------------------

const SEL_KEY = 'sp.selection';
function loadSelection(): Set<string> {
  try {
    const s = localStorage.getItem(SEL_KEY);
    if (s) return new Set(JSON.parse(s) as string[]);
  } catch { /* storage blocked: fall through to the default */ }
  return new Set(DEFAULT_SELECTION);
}
function saveSelection(sel: Set<string>) {
  try { localStorage.setItem(SEL_KEY, JSON.stringify([...sel])); } catch { /* ignore */ }
}


/** The series picker, one chart per unit, and the flight-event table, appended to [body]. */
export function renderCharts(body: HTMLElement, table: FlightTable) {
  const timeMs = column(table, 'time_ms');
  if (!timeMs) { body.append(errorBox('The CSV has no time_ms column.')); return; }
  const x = timeMs.map((v) => (v === null ? NaN : v / 1000));
  const state = column(table, 'flight_state');
  const markers = state ? stateChanges(x, state) : [];

  const selection = loadSelection();
  const units = currentUnits();
  const available = PANELS
    .map((p) => ({ panel: p, slots: p.columns.map((c, i) => (table.columns.includes(c) ? i : -1)).filter((i) => i >= 0) }))
    .filter((p) => p.slots.length > 0);

  // Series picker, grouped by panel.
  const picker = h('details', { class: 'picker', open: window.matchMedia('(min-width: 700px)').matches }, h('summary', {}, 'Series'));
  const grid = h('div', { class: 'picker-grid' });
  for (const { panel, slots } of available) {
    const shownUnit = panelUnits(panel, units).unit;
    const group = h('fieldset', {}, h('legend', {}, shownUnit ? `${panel.title} (${shownUnit})` : panel.title));
    for (const slot of slots) {
      const col = panel.columns[slot];
      const cb = h('input', { type: 'checkbox', checked: selection.has(col) });
      cb.addEventListener('change', () => {
        if (cb.checked) selection.add(col); else selection.delete(col);
        saveSelection(selection);
        draw();
      });
      const swatch = h('span', { class: 'swatch' });
      swatch.style.background = seriesColor(slot);
      group.append(h('label', { class: 'check' }, cb, swatch, panel.labels[slot]));
    }
    grid.append(group);
  }
  picker.append(grid);

  const chartsHost = h('div', { class: 'charts' });
  const events = h('section', { class: 'events' });
  if (markers.length) {
    events.append(h('h2', {}, 'Flight events'), h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Tag'), h('th', {}, 'Event'), h('th', { class: 'num' }, 'Time (s)'))),
      h('tbody', {}, ...markers.map((m) => h('tr', {}, h('td', {}, flightStateAbbr(m.state)), h('td', {}, flightStateName(m.state)), h('td', { class: 'num' }, m.t.toFixed(2))))),
    ));
  }
  body.append(h('p', { class: 'muted small' },
    `${table.rows.toLocaleString()} samples. Drag across a chart to zoom; double-click to reset.`), picker, chartsHost, events);

  let syncing = false;
  function draw() {
    disposeCharts();
    chartsHost.replaceChildren();
    for (const { panel, slots } of available) {
      const chosen = slots.filter((s) => selection.has(panel.columns[s]));
      if (!chosen.length) continue;
      const host = h('div', { class: 'chart' });
      // Charted in the viewer's units; the CSV itself is SI and stays so.
      const { unit, convert } = panelUnits(panel, units);
      const shown = { ...panel, unit };
      chartsHost.append(h('figure', {}, h('figcaption', {}, unit ? `${panel.title} (${unit})` : panel.title), host));
      const u = panelChart(host, {
        panel: shown, x,
        series: chosen.map((slot) => ({
          slot, data: column(table, panel.columns[slot])!.map((v) => (v === null ? null : convert(v))),
        })),
        markers,
        onZoom: (min, max) => {
          if (syncing) return;
          syncing = true;
          for (const other of charts) if (other !== u) other.setScale('x', { min, max });
          syncing = false;
        },
      });
      charts.push(u);
    }
    if (!charts.length) chartsHost.append(h('p', { class: 'muted' }, 'Pick a series above to chart it.'));
  }
  draw();

  // Redraw in the other palette when the system theme flips.
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => { if (chartsHost.isConnected) draw(); }, { once: true });
}

