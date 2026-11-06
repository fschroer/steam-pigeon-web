// Sharing a flight with named people (locator ADR-0042 amendment, 2026-11-06).
//
// A share is a Firestore document: the owner lets one email address read one
// record's CSV. Its id is {ownerUid}_{locatorId}_{recordKey}_{recipientEmail},
// which storage.rules rebuilds from the file path and the reader's verified
// email. So the share itself is the permission, and removing it revokes it.
// No email is sent: there is no server to send one. The owner tells the person,
// and the flight shows under "Shared with you" once they sign in with that address.

import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDocs, query, where, serverTimestamp,
} from 'firebase/firestore/lite';
import { app } from './firebase';

export interface Share {
  id: string;
  ownerUid: string;
  ownerEmail?: string;
  locatorId: string;
  locatorName?: string;
  /** {record_ts}_{crc}, as in the page URL. */
  recordKey: string;
  recipientEmail: string;
}

const EMAIL = /^[^@/\s]+@[^@/\s]+\.[^@/\s]+$/;

/** The address as the rules compare it, or null if it is not one. */
export function normalizeEmail(s: string): string | null {
  const e = s.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

export function shareId(ownerUid: string, locatorId: string, recordKey: string, recipientEmail: string): string {
  return `${ownerUid}_${locatorId}_${recordKey}_${recipientEmail}`;
}

/** Where a shared record's CSV lives in Storage. */
export function sharedCsvPath(s: Pick<Share, 'ownerUid' | 'locatorId' | 'recordKey'>): string {
  return `users/${s.ownerUid}/locators/${s.locatorId}/${s.recordKey}.csv`;
}

function db() {
  if (!app) throw new Error('Firebase is not configured');
  return getFirestore(app);
}

const shares = () => collection(db(), 'shares');

function fromDoc(id: string, d: Record<string, unknown>): Share {
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  return {
    id,
    ownerUid: String(d.ownerUid ?? ''),
    ownerEmail: str(d.ownerEmail),
    locatorId: String(d.locatorId ?? ''),
    locatorName: str(d.locatorName),
    recordKey: String(d.recordKey ?? ''),
    recipientEmail: String(d.recipientEmail ?? ''),
  };
}

export async function addShare(s: Omit<Share, 'id'>): Promise<Share> {
  const id = shareId(s.ownerUid, s.locatorId, s.recordKey, s.recipientEmail);
  const data: Record<string, unknown> = {
    ownerUid: s.ownerUid,
    locatorId: s.locatorId,
    recordKey: s.recordKey,
    recipientEmail: s.recipientEmail,
    createdAt: serverTimestamp(),
  };
  if (s.ownerEmail) data.ownerEmail = s.ownerEmail.toLowerCase();
  if (s.locatorName) data.locatorName = s.locatorName.slice(0, 64);
  await setDoc(doc(shares(), id), data);
  return { id, ...s };
}

export async function removeShare(id: string): Promise<void> {
  await deleteDoc(doc(shares(), id));
}

/** The people one of the owner's records is shared with. */
export async function sharesOfRecord(ownerUid: string, locatorId: string, recordKey: string): Promise<Share[]> {
  const q = query(shares(), where('ownerUid', '==', ownerUid),
    where('locatorId', '==', locatorId), where('recordKey', '==', recordKey));
  const snap = await getDocs(q);
  return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => a.recipientEmail.localeCompare(b.recipientEmail));
}

/** Records other people shared with this address, newest flight first. */
export async function sharedWithMe(email: string): Promise<Share[]> {
  const snap = await getDocs(query(shares(), where('recipientEmail', '==', email.toLowerCase())));
  const ts = (s: Share) => Number(s.recordKey.split('_')[0]) || 0;
  return snap.docs.map((d) => fromDoc(d.id, d.data())).sort((a, b) => ts(b) - ts(a));
}

/**
 * A mailto: link that opens the owner's own email app with a note to the
 * recipient: what was shared and where to open it. The site sends no email
 * (no server), so this is how the person hears of it.
 */
export function shareMailto(recipient: string, flight: string, link: string, from?: string): string {
  const subject = `Steam Pigeon flight shared with you: ${flight}`;
  const body = [
    `${from ? `${from} has` : 'I have'} shared a Steam Pigeon flight with you: ${flight}.`,
    '',
    `Open it here, signed in as ${recipient}:`,
    link,
    '',
    'It is also listed under "Shared with you" on the site. A Google account with this',
    'address works, or an email/password account once the address is verified.',
  ].join('\n');
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
