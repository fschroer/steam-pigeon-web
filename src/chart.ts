import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Panel } from './channels';
import { flightStateName, flightStateAbbr } from './channels';
import type { StateChange } from './csv';

// Categorical slots, fixed order (the dataviz reference palette, validated for
// color-vision deficiency on these surfaces). A series takes the slot of its
// column within its panel, so its color never depends on what else is shown.
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function seriesColor(slot: number): string {
  return (isDark() ? SERIES_DARK : SERIES_LIGHT)[slot % 8];
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fmt(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined) return '–';
  const a = Math.abs(v);
  const s = a >= 1000 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
  return unit ? `${s} ${unit}` : s;
}

/** Height of one row of event tags, in CSS pixels. */
const TAG_ROW = 13;
/** Rows of event tags that fit in the gutter above the plot, clear of the data. */
const GUTTER_ROWS = 3;
const GUTTER = GUTTER_ROWS * TAG_ROW + 4;
const HEIGHT = 220 + GUTTER;

export interface PanelChartInput {
  panel: Panel;
  x: number[];
  /** Selected columns of this panel: their slot in panel.columns and their data. */
  series: { slot: number; data: (number | null)[] }[];
  markers: StateChange[];
  /** Called when this chart's time range changes (drag to zoom, double-click to reset). */
  onZoom?: (min: number, max: number) => void;
}

export function panelChart(host: HTMLElement, input: PanelChartInput): uPlot {
  const { panel, x, series, markers, onZoom } = input;
  const text = css('--text-secondary');
  const grid = css('--grid');
  const markerColor = css('--marker');
  const surface = css('--surface-1');
  // Rows of event tags the last draw had to put on the plot; the tooltip sits below them.
  let overflowRows = 0;

  const axis = (label: string): uPlot.Axis => ({
    stroke: text,
    label,
    labelSize: 18,
    font: '12px system-ui, sans-serif',
    labelFont: '12px system-ui, sans-serif',
    grid: { stroke: grid, width: 1 },
    ticks: { stroke: grid, width: 1, size: 4 },
  });

  const opts: uPlot.Options = {
    width: Math.max(280, host.clientWidth),
    height: HEIGHT,
    // Room above the plot for the event tags, so they never sit on the data.
    padding: [GUTTER, null, null, null],
    // Vertical time line only: Frank asked for the horizontal crosshair to go (2026-11-05).
    cursor: { y: false, sync: { key: 'flight', setSeries: false }, drag: { x: true, y: false, setScale: true } },
    scales: { x: { time: false } },
    legend: { live: true },
    axes: [axis('Time (s)'), { ...axis(panel.unit || panel.title), size: 56 }],
    series: [
      { label: 'Time', value: (_u, v) => fmt(v, 's') },
      ...series.map((s) => ({
        label: panel.labels[s.slot],
        stroke: seriesColor(s.slot),
        width: 2,
        spanGaps: false,
        points: { show: false },
        value: (_u: uPlot, v: number | null) => fmt(v, panel.unit),
      })),
    ],
    hooks: {
      // Event names on hover: the dashed line under the cursor (within 6 px) is
      // named in a tooltip on every panel, including labels the top panel had
      // to skip because they would have overlapped.
      setCursor: [
        (u) => {
          const tip = (u as uPlot & { _tip?: HTMLElement })._tip;
          if (!tip) return;
          const left = u.cursor.left ?? -1;
          let hit: StateChange | undefined;
          let best = 7;
          if (left >= 0) {
            for (const m of markers) {
              const d = Math.abs(u.valToPos(m.t, 'x') - left);
              if (d < best) { best = d; hit = m; }
            }
          }
          if (!hit) { tip.style.display = 'none'; return; }
          tip.textContent = `${flightStateName(hit.state)} · ${hit.t.toFixed(2)} s`;
          tip.style.display = 'block';
          const x = u.valToPos(hit.t, 'x');
          const w = tip.offsetWidth;
          const room = u.over.clientWidth;
          tip.style.left = `${Math.min(Math.max(0, x + 8), Math.max(0, room - w))}px`;
          // A fixed height at the top of the plot, just under the event tags,
          // on every panel. It used to follow the pointer's height, which on the
          // panels synced to the one under the pointer is another chart's
          // height and landed anywhere.
          tip.style.top = `${overflowRows * TAG_ROW + 4}px`;
        },
      ],
      setScale: [
        (u, key) => {
          if (key !== 'x' || !onZoom) return;
          const { min, max } = u.scales.x;
          if (min != null && max != null) onZoom(min, max);
        },
      ],
      draw: [
        (u) => {
          if (!markers.length) return;
          const ctx = u.ctx;
          const { top, height, left, width } = u.bbox;
          ctx.save();
          ctx.strokeStyle = markerColor;
          ctx.lineWidth = devicePixelRatio;
          ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
          ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`;
          ctx.textBaseline = 'top';
          const shown = markers
            .map((m) => ({ m, px: u.valToPos(m.t, 'x', true) }))
            .filter(({ px }) => px >= left && px <= left + width);
          for (const { px } of shown) {
            ctx.beginPath();
            ctx.moveTo(px, top - (GUTTER - 2) * devicePixelRatio);
            ctx.lineTo(px, top + height);
            ctx.stroke();
          }
          // Every line gets its tag, in the gutter above the plot. A tag that
          // would run into one already drawn drops to the next row instead of
          // being left off. Past the gutter's rows (a crowded stretch, zoomed
          // out) a tag goes on the plot itself.
          const pad = 2 * devicePixelRatio;
          const rowEnds: number[] = [];
          for (const { m, px } of shown) {
            const label = flightStateAbbr(m.state);
            const w = ctx.measureText(label).width;
            const lx = Math.min(px + 3 * devicePixelRatio, left + width - w - pad);
            let row = rowEnds.findIndex((end) => lx - pad > end);
            if (row < 0) { row = rowEnds.length; rowEnds.push(-Infinity); }
            const ly = top + ((row - GUTTER_ROWS) * TAG_ROW) * devicePixelRatio;
            // A patch of background, so a neighboring event line (or, past the
            // gutter, the data) does not run through the text.
            ctx.fillStyle = surface;
            ctx.fillRect(lx - pad, ly, w + 2 * pad, (TAG_ROW - 1) * devicePixelRatio);
            ctx.fillStyle = text;
            ctx.fillText(label, lx, ly + devicePixelRatio);
            rowEnds[row] = lx + w + pad;
          }
          overflowRows = Math.max(0, rowEnds.length - GUTTER_ROWS);
          ctx.restore();
        },
      ],
    },
  };

  const data: uPlot.AlignedData = [x, ...series.map((s) => s.data)] as uPlot.AlignedData;
  const u = new uPlot(opts, data, host);
  const tip = document.createElement('div');
  tip.className = 'event-tip';
  tip.style.display = 'none';
  u.over.append(tip);
  (u as uPlot & { _tip?: HTMLElement })._tip = tip;
  attachTouch(u, x);
  const ro = new ResizeObserver(() => u.setSize({ width: Math.max(280, host.clientWidth), height: HEIGHT }));
  ro.observe(host);
  (u as uPlot & { _ro?: ResizeObserver })._ro = ro;
  return u;
}

/**
 * Touch on a phone or tablet (Frank, 2026-11-07), where drag-to-zoom and
 * double-click need a mouse:
 * - one finger moves the cursor line (and with it the readout and the synced
 *   panels); a mostly vertical swipe still scrolls the page;
 * - two fingers pinch the time axis in or out about the fingers, and pan it;
 *   the other panels follow through the setScale hook;
 * - a double tap goes back to the whole flight.
 */
function attachTouch(u: uPlot, x: number[]) {
  const over = u.over;
  // Vertical pans stay with the browser; horizontal moves and pinches come here.
  over.style.touchAction = 'pan-y';
  let lo = Infinity, hi = -Infinity;
  for (const v of x) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return;
  const full = () => u.setScale('x', { min: lo, max: hi });

  const localX = (t: Touch) => t.clientX - over.getBoundingClientRect().left;
  const localY = (t: Touch) => t.clientY - over.getBoundingClientRect().top;
  let pinch: { v1: number; v2: number } | null = null;
  let lastTap = 0;

  const moveCursor = (t: Touch) => {
    const left = Math.min(Math.max(0, localX(t)), over.clientWidth);
    // The third argument publishes to the synced panels, as a mouse move does
    // (uPlot takes it; its typings stop at two).
    (u.setCursor as (o: { left: number; top: number }, fire?: boolean, pub?: boolean) => void)(
      { left, top: Math.min(Math.max(0, localY(t)), over.clientHeight) }, true, true);
  };

  over.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      pinch = { v1: u.posToVal(localX(a), 'x'), v2: u.posToVal(localX(b), 'x') };
      if (Math.abs(pinch.v2 - pinch.v1) < 1e-9) pinch = null;
    } else if (e.touches.length === 1) {
      pinch = null;
      moveCursor(e.touches[0]);
    }
  }, { passive: false });

  over.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinch) {
      e.preventDefault();
      const p1 = localX(e.touches[0]), p2 = localX(e.touches[1]);
      if (Math.abs(p2 - p1) < 10) return;
      // Keep the times first touched under the two fingers.
      const perVal = (p2 - p1) / (pinch.v2 - pinch.v1);
      let min = pinch.v1 - p1 / perVal;
      let max = min + over.clientWidth / perVal;
      if (max - min >= hi - lo) { min = lo; max = hi; }
      else if (min < lo) { max += lo - min; min = lo; }
      else if (max > hi) { min -= max - hi; max = hi; }
      if (max - min > 1e-3) u.setScale('x', { min, max });
    } else if (e.touches.length === 1 && !pinch) {
      moveCursor(e.touches[0]);
    }
  }, { passive: false });

  over.addEventListener('touchend', (e) => {
    if (e.touches.length > 0) return;
    if (pinch) { pinch = null; return; }
    const now = Date.now();
    if (now - lastTap < 300) { full(); lastTap = 0; } else lastTap = now;
  });
}

export function destroyChart(u: uPlot): void {
  (u as uPlot & { _ro?: ResizeObserver })._ro?.disconnect();
  u.destroy();
}
