import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Panel } from './channels';
import { flightStateName } from './channels';
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

export interface PanelChartInput {
  panel: Panel;
  x: number[];
  /** Selected columns of this panel: their slot in panel.columns and their data. */
  series: { slot: number; data: (number | null)[] }[];
  markers: StateChange[];
  /** Label the event markers on this panel (the top one only, to avoid clutter). */
  labelMarkers: boolean;
  /** Called when this chart's time range changes (drag to zoom, double-click to reset). */
  onZoom?: (min: number, max: number) => void;
}

export function panelChart(host: HTMLElement, input: PanelChartInput): uPlot {
  const { panel, x, series, markers, labelMarkers, onZoom } = input;
  const text = css('--text-secondary');
  const grid = css('--grid');
  const markerColor = css('--marker');

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
    height: 220,
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
          tip.style.top = `${Math.max(0, (u.cursor.top ?? 0) - 28)}px`;
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
          ctx.fillStyle = text;
          ctx.lineWidth = devicePixelRatio;
          ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
          ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`;
          ctx.textBaseline = 'top';
          let lastLabelEnd = -Infinity;
          for (const m of markers) {
            const px = u.valToPos(m.t, 'x', true);
            if (px < left || px > left + width) continue;
            ctx.beginPath();
            ctx.moveTo(px, top);
            ctx.lineTo(px, top + height);
            ctx.stroke();
            if (labelMarkers) {
              const label = flightStateName(m.state);
              const w = ctx.measureText(label).width;
              // Skip a label that would overlap the previous one; the line stays.
              if (px + 3 * devicePixelRatio > lastLabelEnd && px + w < left + width) {
                ctx.fillText(label, px + 3 * devicePixelRatio, top + 2 * devicePixelRatio);
                lastLabelEnd = px + w + 9 * devicePixelRatio;
              }
            }
          }
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
  const ro = new ResizeObserver(() => u.setSize({ width: Math.max(280, host.clientWidth), height: 220 }));
  ro.observe(host);
  (u as uPlot & { _ro?: ResizeObserver })._ro = ro;
  return u;
}

export function destroyChart(u: uPlot): void {
  (u as uPlot & { _ro?: ResizeObserver })._ro?.disconnect();
  u.destroy();
}
