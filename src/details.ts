// Flight details (locator ADR-0042 amendment "Flight details", 2026-11-06):
// what the record itself cannot say. One Firestore document per record, id
// {ownerUid}_{locatorId}_{recordKey}. The owner edits it; people the record is
// shared with can read it (firestore.rules).

import { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore/lite';
import { app } from './firebase';

export interface MotorEntry {
  /** ThrustCurve manufacturer abbreviation, EX_MOTOR, or anything typed. */
  maker: string;
  /** Impulse class, A to O, or anything typed. */
  impulse: string;
  /** Designation such as H128W, or anything typed. */
  motor: string;
  /** ThrustCurve's id when the motor was picked from its list. */
  motorId?: string;
  /** Delay in seconds as typed, or a code such as "P" (plugged). */
  delay: string;
}

export interface FlightDetails {
  rocketMaker: string;
  rocketName: string;
  motors: MotorEntry[];
  recovery: string;
  /** The devices flown, joined by "; " (splitElectronics / joinElectronics). */
  electronics: string;
  /** The notes log: timestamped lines, also edited directly. */
  notes: string;
}

export const EX_MOTOR = 'EX (experimental)';

export const RECOVERY_TYPES = ['Parachute', 'Streamer', 'Tumble', 'Dual Deploy'] as const;

/** Kit makers offered in the rocket manufacturer list; anything else can be typed. */
export const ROCKET_MAKERS = [
  'Aerotech', 'Apogee Components', 'Bad to the Bone Rocketry', 'Binder Design', 'Estes',
  'Fliskits', 'Giant Leap Rocketry', 'LOC Precision', 'Madcow Rocketry', 'North Coast Rocketry',
  'Polecat Aerospace', 'Public Missiles (PML)', 'Quest Aerospace', 'Rocketarium', 'Semroc',
  'Sunward Aerospace', 'Wildman Rocketry', 'Scratch built',
];

/**
 * Common altimeters, flight computers and trackers, offered in the Electronics
 * list. No public database of these exists (unlike ThrustCurve for motors), so
 * this list is kept here; anything else can be typed.
 */
export const ELECTRONICS = [
  'Altus Metrum EasyMega', 'Altus Metrum EasyMini', 'Altus Metrum TeleMega', 'Altus Metrum TeleMetrum',
  'Big Red Bee GPS', 'Eggtimer Apogee', 'Eggtimer Eggfinder', 'Eggtimer Proton', 'Eggtimer Quantum', 'Eggtimer Quasar',
  'Entacore AIM', 'Featherweight Blue Raven', 'Featherweight GPS Tracker', 'Featherweight Raven',
  'Jolly Logic AltimeterThree', 'Jolly Logic Chute Release', 'Missile Works RRC2+', 'Missile Works RRC3',
  'PerfectFlite Firefly', 'PerfectFlite Pnut', 'PerfectFlite StratoLoggerCF', 'Steam Pigeon locator',
];

/** The electronics field as separate devices. */
export function splitElectronics(s: string): string[] {
  return s.split(';').map((x) => x.trim()).filter(Boolean);
}

export function joinElectronics(items: string[]): string {
  return items.map((x) => x.trim().replace(/;/g, ',')).filter(Boolean).join('; ');
}

export function emptyDetails(): FlightDetails {
  return { rocketMaker: '', rocketName: '', motors: [], recovery: '', electronics: '', notes: '' };
}

export function emptyMotor(): MotorEntry {
  return { maker: '', impulse: '', motor: '', delay: '' };
}

/** The log line's stamp: local date and time to the minute, e.g. 2026-11-06 21:30. */
export function logStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Adds one stamped entry at the end of the log. */
export function appendLog(notes: string, entry: string, when: Date): string {
  const text = entry.trim();
  if (!text) return notes;
  const line = `[${logStamp(when)}] ${text}`;
  const base = notes.replace(/\s+$/, '');
  return base ? `${base}\n${line}` : line;
}

/** ThrustCurve's "4,6,8,10,P" as a list, blanks dropped. */
export function parseDelays(s: string | undefined): string[] {
  return (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** A one-line summary, e.g. "AeroTech H128W-10", for lists and titles. */
export function motorSummary(m: MotorEntry): string {
  const name = [m.maker === EX_MOTOR ? 'EX' : m.maker, m.motor || m.impulse].filter(Boolean).join(' ');
  return m.delay ? `${name}-${m.delay}` : name;
}

/** Strings trimmed and capped as the rules allow; empty motors dropped. */
export function cleanDetails(d: FlightDetails): FlightDetails {
  const cap = (s: string, n: number) => s.trim().slice(0, n);
  return {
    rocketMaker: cap(d.rocketMaker, 100),
    rocketName: cap(d.rocketName, 100),
    recovery: cap(d.recovery, 40),
    electronics: cap(d.electronics, 500),
    notes: d.notes.slice(0, 50_000),
    motors: d.motors
      .map((m) => ({
        maker: cap(m.maker, 60), impulse: cap(m.impulse, 10), motor: cap(m.motor, 60), delay: cap(m.delay, 10),
        ...(m.motorId ? { motorId: m.motorId.slice(0, 40) } : {}),
      }))
      .filter((m) => m.maker || m.impulse || m.motor || m.delay)
      .slice(0, 8),
  };
}

export function detailsId(ownerUid: string, locatorId: string, recordKey: string): string {
  return `${ownerUid}_${locatorId}_${recordKey}`;
}

function db() {
  if (!app) throw new Error('Firebase is not configured');
  return getFirestore(app);
}

/** The record's details, or empty ones when none were saved. */
export async function loadDetails(ownerUid: string, locatorId: string, recordKey: string): Promise<FlightDetails> {
  const snap = await getDoc(doc(db(), 'flights', detailsId(ownerUid, locatorId, recordKey)));
  if (!snap.exists()) return emptyDetails();
  const d = snap.data() as Partial<FlightDetails>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    rocketMaker: str(d.rocketMaker), rocketName: str(d.rocketName), recovery: str(d.recovery),
    electronics: str(d.electronics), notes: str(d.notes),
    motors: Array.isArray(d.motors) ? d.motors.map((m) => ({ ...emptyMotor(), ...(m as MotorEntry) })) : [],
  };
}

export async function saveDetails(ownerUid: string, locatorId: string, recordKey: string, d: FlightDetails): Promise<void> {
  await setDoc(doc(db(), 'flights', detailsId(ownerUid, locatorId, recordKey)), {
    ownerUid, locatorId, recordKey, ...cleanDetails(d), updatedAt: serverTimestamp(),
  });
}

export async function deleteDetails(ownerUid: string, locatorId: string, recordKey: string): Promise<void> {
  await deleteDoc(doc(db(), 'flights', detailsId(ownerUid, locatorId, recordKey)));
}
