// Parser for the flight CSV the locator's USB export prints and the app uploads
// (rocket-flight-manager FullRecordCsv; locator ADR-0040 decision 8). The web
// reads this, never the .bin, so it carries no copy of the wire format
// (ADR-0042 decision 4). The parser keys on the header, not on column order.

export interface FlightTable {
  columns: string[];
  /** One array per column; a blank field is null. */
  data: (number | null)[][];
  rows: number;
}

/**
 * Finds the header: the first line whose fields include time_ms. Older USB exports
 * open with metadata lines (locator name, settings and the like) before it, so
 * every line above the header is skipped. Without a time_ms line, the first
 * non-blank line is taken as the header, and a caller that needs time_ms says so.
 */
function headerIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].split(',').some((f) => f.trim().replace(/^"|"$/g, '') === 'time_ms')) return i;
  }
  return lines.findIndex((l) => l.trim() !== '');
}

export function parseFlightCsv(text: string): FlightTable {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const h = headerIndex(lines);
  const header = h < 0 ? '' : lines[h].trim();
  if (!header) throw new Error('empty CSV');
  const columns = header.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const data: (number | null)[][] = columns.map(() => []);
  let rows = 0;
  for (let i = h + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const f = line.split(',');
    for (let c = 0; c < columns.length; c++) {
      const s = f[c]?.trim();
      if (s === undefined || s === '') { data[c].push(null); continue; }
      const v = Number(s);
      data[c].push(Number.isFinite(v) ? v : null);
    }
    rows++;
  }
  return { columns, data, rows };
}

export function column(t: FlightTable, name: string): (number | null)[] | undefined {
  const i = t.columns.indexOf(name);
  return i < 0 ? undefined : t.data[i];
}

export interface StateChange {
  /** Seconds, on the same axis as the charts. */
  t: number;
  state: number;
}

/** Each point where flight_state changes, after the first sample. */
export function stateChanges(time: (number | null)[], state: (number | null)[]): StateChange[] {
  const out: StateChange[] = [];
  let prev: number | null = null;
  for (let i = 0; i < state.length; i++) {
    const s = state[i];
    const t = time[i];
    if (s === null || t === null) continue;
    if (prev !== null && s !== prev) out.push({ t, state: s });
    prev = s;
  }
  return out;
}
