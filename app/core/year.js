// The year in the mountains: figures for one calendar year from the outings and the
// places reached (the same data the app already has; nothing extra is stored).

const yearOf = (t) => new Date(t).getFullYear();

/** Years that have outings (newest first). */
export function yearsOf(activities) {
  return [...new Set(activities.filter((a) => !a.outside && a.start != null).map((a) => yearOf(a.start)))].sort((a, b) => b - a);
}

/**
 * activities: [{id, name, start, end, km, asc, desc, outside}]
 * found: {id: {c, n, e, first, visits, outs: [[activityId, t], ...]}}
 * badges: {id: {first, visits, outs}}
 */
export function yearSummary(activities, found, badges, year) {
  const acts = activities.filter((a) => !a.outside && a.start != null && yearOf(a.start) === year);
  const ids = new Set(acts.map((a) => a.id));
  const sum = (f) => acts.reduce((s, a) => s + (f(a) || 0), 0);
  const months = Array(12).fill(0);
  for (const a of acts) months[new Date(a.start).getMonth()] += a.km || 0;
  const best = months.reduce((b, v, i) => (v > months[b] ? i : b), 0);
  const days = new Set(acts.map((a) => new Date(a.start).toDateString())).size;
  const longest = acts.reduce((b, a) => (!b || (a.km || 0) > (b.km || 0) ? a : b), null);
  const climbiest = acts.filter((a) => a.asc).reduce((b, a) => (!b || a.asc > b.asc ? a : b), null);
  // the calendar: km per day, a row per month
  const cal = Array.from({ length: 12 }, () => Array(31).fill(0));
  for (const a of acts) { const d = new Date(a.start); cal[d.getMonth()][d.getDate() - 1] += a.km || 0; }
  const entries = Object.values(found || {}).filter((f) => f.n);
  const reached = entries.filter((f) => (f.outs || []).some(([id]) => ids.has(id)));
  const inYear = (t) => t != null && yearOf(t) === year;
  const newPeaks = entries.filter((f) => f.c === "peak" && inYear(f.first)).sort((a, b) => (b.e || 0) - (a.e || 0));
  const newOther = entries.filter((f) => f.c !== "peak" && f.c !== "place" && inYear(f.first)).length;
  const highest = reached.filter((f) => f.c === "peak").reduce((b, f) => (!b || (f.e || 0) > (b.e || 0) ? f : b), null);
  const often = reached.map((f) => ({ f, n: f.outs.filter(([id]) => ids.has(id)).length })).sort((a, b) => b.n - a.n)[0] || null;
  const newBadges = Object.entries(badges || {}).filter(([, b]) => inYear(b.first)).map(([id]) => id);
  // when you go: the days of the week (Monday first), the usual start time (the median, minutes after midnight)
  const week = Array(7).fill(0);
  for (const a of acts) week[(new Date(a.start).getDay() + 6) % 7]++;
  const starts = acts.map((a) => { const d = new Date(a.start); return d.getHours() * 60 + d.getMinutes(); }).sort((a, b) => a - b);
  const startMed = starts.length ? starts[Math.floor(starts.length / 2)] : null;
  // the longest streak of weekends with an outing (Saturday or Sunday)
  const wk = new Set(acts.filter((a) => [0, 6].includes(new Date(a.start).getDay())).map((a) => { const d = new Date(a.start); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toDateString(); }));
  let streak = 0, run = 0;
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 7)) { const m = new Date(d); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); if (wk.has(m.toDateString())) { run++; streak = Math.max(streak, run); } else run = 0; }
  return {
    year,
    outings: acts.length,
    days,
    km: sum((a) => a.km),
    asc: sum((a) => a.asc),
    desc: sum((a) => a.desc),
    hours: sum((a) => (a.end != null ? (a.end - a.start) / 3.6e6 : 0)),
    longest,
    climbiest,
    cal,
    months,
    bestMonth: months[best] > 0 ? best : null,
    newPeaks,
    newOther,
    highest,
    often: often && often.n > 1 ? { n: often.f.n, c: often.f.c, count: often.n } : null,
    newBadges,
    week,
    startMed,
    weekendStreak: streak,
  };
}
