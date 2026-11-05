import { getStorage, ref, listAll, getMetadata, getBlob, getDownloadURL, deleteObject } from 'firebase/storage';
import { app } from './firebase';
import { groupRecords, recordsPrefix, type RecordRef } from './records';

export interface RecordInfo extends RecordRef {
  samples?: number;
  slot?: number;
  /** The locator's own name at upload time; absent on uploads before 2026-11-05. */
  locatorName?: string;
  sizeBytes?: number;
}

function storage() {
  if (!app) throw new Error('Firebase is not configured');
  return getStorage(app);
}

/** Every locator the user has uploaded from, with its records, newest first. */
export async function listFlights(uid: string): Promise<Map<string, RecordInfo[]>> {
  const root = await listAll(ref(storage(), recordsPrefix(uid)));
  const out = new Map<string, RecordInfo[]>();
  await Promise.all(root.prefixes.map(async (dir) => {
    const files = await listAll(dir);
    out.set(dir.name, groupRecords(dir.name, files.items));
  }));
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** The custom metadata the app sets on upload (FirebaseCloud.meta). */
export async function loadInfo(r: RecordRef): Promise<RecordInfo> {
  const path = r.csvPath ?? r.binPath;
  if (!path) return r;
  if ('sizeBytes' in r) return r as RecordInfo;   // already loaded
  const m = await getMetadata(ref(storage(), path));
  const c = m.customMetadata ?? {};
  const num = (s?: string) => (s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);
  return { ...r, samples: num(c.samples), slot: num(c.slot), sizeBytes: m.size, locatorName: c.locator_name?.trim() || undefined };
}

export async function fetchCsvText(path: string): Promise<string> {
  const blob = await getBlob(ref(storage(), path));
  return blob.text();
}

export async function fetchBlob(path: string): Promise<Blob> {
  return getBlob(ref(storage(), path));
}

/**
 * The file's Firebase download URL. Its token lets anyone with the link read
 * that one file (locator ADR-0040 decision 9); revoking the token in the
 * console kills the link.
 */
export async function shareLink(path: string): Promise<string> {
  return getDownloadURL(ref(storage(), path));
}

/**
 * Removes the record's .csv and .bin from the web store. The phone keeps its
 * own copy and marks it uploaded, so the app does not put it back; the locator
 * keeps its copy in flash (ADR-0042 amendment, 2026-11-05).
 */
export async function deleteRecord(r: RecordRef): Promise<void> {
  for (const path of [r.csvPath, r.binPath]) {
    if (!path) continue;
    try {
      await deleteObject(ref(storage(), path));
    } catch (e) {
      // Already gone (deleted from another tab) is the outcome we wanted.
      if ((e as { code?: string })?.code !== 'storage/object-not-found') throw e;
    }
  }
}
