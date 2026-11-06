// Times are stored in UTC and shown with their offset (locator ADR "Times are
// stored in UTC and shown with their offset", 0043). Every time this page
// prints says which zone it is in.

/** The viewer's offset from UTC on that date, as "-08:00" (DST included). */
export function utcOffsetText(d: Date): string {
  const east = -d.getTimezoneOffset();
  const mag = Math.abs(east);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${east < 0 ? '-' : '+'}${p(Math.floor(mag / 60))}:${p(mag % 60)}`;
}
