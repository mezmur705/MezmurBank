// The nearest Sunday (today, if it's Sunday) plus the following ones up to a month out -
// same 4 Sundays as the website's dropdown, all inside the server's 31-day window.
export function upcomingSundays(): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + (d.getUTCDay() === 0 ? 0 : 7 - d.getUTCDay()));
  for (let i = 0; i < 4; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return dates;
}

export function formatSundayDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
