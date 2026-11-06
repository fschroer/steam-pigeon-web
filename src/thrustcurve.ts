// Motor lists from ThrustCurve.org (https://www.thrustcurve.org/info/api.html):
// manufacturers from metadata.json, then the motors of one manufacturer and
// impulse class from search.json. No key is needed. Answers are kept for the
// browser session, so each list is fetched once. If the site cannot be reached,
// every field still takes typed text.

export interface TcManufacturer { name: string; abbrev: string }
export interface TcMotor {
  motorId: string;
  designation: string;
  commonName?: string;
  delays?: string;
  availability?: string;
}

const API = 'https://www.thrustcurve.org/api/v1';
const memo = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = memo.get(key) as Promise<T> | undefined;
  if (p) return p;
  try {
    const s = sessionStorage.getItem(`tc:${key}`);
    if (s) { p = Promise.resolve(JSON.parse(s) as T); memo.set(key, p); return p; }
  } catch { /* storage blocked: fetch */ }
  p = load().then((v) => {
    try { sessionStorage.setItem(`tc:${key}`, JSON.stringify(v)); } catch { /* fine */ }
    return v;
  });
  p.catch(() => memo.delete(key));   // let a later try fetch again
  memo.set(key, p);
  return p;
}

export function manufacturers(): Promise<TcManufacturer[]> {
  return cached('mfr', async () => {
    const r = await fetch(`${API}/metadata.json`);
    if (!r.ok) throw new Error(`ThrustCurve ${r.status}`);
    const j = await r.json() as { manufacturers?: TcManufacturer[] };
    return (j.manufacturers ?? []).filter((m) => m.abbrev).sort((a, b) => a.abbrev.localeCompare(b.abbrev));
  });
}

/** Every motor ThrustCurve lists for a manufacturer and impulse class, out-of-production ones too. */
export function motors(manufacturer: string, impulseClass: string): Promise<TcMotor[]> {
  return cached(`m:${manufacturer}:${impulseClass}`, async () => {
    const r = await fetch(`${API}/search.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manufacturer, impulseClass, availability: 'all', maxResults: 500 }),
    });
    if (!r.ok) throw new Error(`ThrustCurve ${r.status}`);
    const j = await r.json() as { results?: TcMotor[] };
    return (j.results ?? []).sort((a, b) => a.designation.localeCompare(b.designation, undefined, { numeric: true }));
  });
}

export const IMPULSE_CLASSES = ['1/4A', '1/2A', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
