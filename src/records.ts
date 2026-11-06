// Naming of the files the app uploads (locator ADR-0040 decision 8):
//   users/{uid}/locators/{locator_id}/{record_ts}_{crc}.{bin,csv}
// {locator_id} is decimal, {record_ts} is the flight's timestamp from
// FlightMetadata (Unix seconds), {crc} is 8 lowercase hex digits.

export interface RecordRef {
  locatorId: string;
  recordTs: number;
  crc: string;
  /** Full storage path of the CSV, when it was uploaded. */
  csvPath?: string;
  /** Full storage path of the raw v8 bytes, when it was uploaded. */
  binPath?: string;
}

const NAME = /^(\d+)_([0-9a-f]{8})\.(bin|csv)$/;

export function parseObjectName(name: string): { recordTs: number; crc: string; ext: 'bin' | 'csv' } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  return { recordTs: Number(m[1]), crc: m[2], ext: m[3] as 'bin' | 'csv' };
}

export function recordsPrefix(uid: string): string {
  return `users/${uid}/locators`;
}

/** Pairs a locator folder's .bin and .csv files into records, newest first. */
export function groupRecords(locatorId: string, items: { name: string; fullPath: string }[]): RecordRef[] {
  const byKey = new Map<string, RecordRef>();
  for (const it of items) {
    const p = parseObjectName(it.name);
    if (!p) continue;
    const key = `${p.recordTs}_${p.crc}`;
    let r = byKey.get(key);
    if (!r) {
      r = { locatorId, recordTs: p.recordTs, crc: p.crc };
      byKey.set(key, r);
    }
    if (p.ext === 'csv') r.csvPath = it.fullPath;
    else r.binPath = it.fullPath;
  }
  return [...byKey.values()].sort((a, b) => b.recordTs - a.recordTs || a.crc.localeCompare(b.crc));
}

/** The id used in the page URL for one record. */
export function recordId(r: Pick<RecordRef, 'recordTs' | 'crc'>): string {
  return `${r.recordTs}_${r.crc}`;
}

/** A readable flight time; timestamps before 2001 are not wall-clock, so they print raw. */
export function formatRecordTime(ts: number): string {
  if (ts < 1_000_000_000) return `#${ts}`;
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** File name offered when the CSV is downloaded. */
export function csvFileName(r: Pick<RecordRef, 'locatorId' | 'recordTs' | 'crc'>): string {
  return `steam-pigeon_${r.locatorId}_${r.recordTs}_${r.crc}.csv`;
}

/**
 * The folder for CSVs saved from the viewer's own computer. A file carries no
 * locator id, and no real locator has id 0. The app lists only the folders of
 * locators it knows, so it never sees this one.
 */
export const COMPUTER_LOCATOR_ID = '0';

/** How a locator is titled: its own name when an upload carried one, else its id. */
export function locatorLabel(locatorId: string, name?: string): string {
  if (locatorId === COMPUTER_LOCATOR_ID) return 'Saved from your computer';
  const n = name?.trim();
  return n ? `${n} (${locatorId})` : `Locator ${locatorId}`;
}

/**
 * The flight's time from a USB export's "Flight time: 2026-09-26 16:07:35" line
 * (UTC, from the locator's GPS clock), as Unix seconds, or undefined.
 */
export function flightTimeFromCsv(text: string): number | undefined {
  const m = /^Flight time:\s*(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)/m.exec(text.slice(0, 4000));
  if (!m) return undefined;
  const [y, mo, d, hh, mi, ss] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, hh, mi, ss) / 1000;
  return Number.isFinite(t) && t > 1_000_000_000 ? t : undefined;
}

/** CRC-32 (IEEE) of the text's UTF-8 bytes, as 8 lowercase hex digits. */
export function crc32Hex(text: string): string {
  let c = ~0;
  for (const b of new TextEncoder().encode(text)) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ((~c) >>> 0).toString(16).padStart(8, '0');
}
