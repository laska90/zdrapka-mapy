// Summits with no way to them (see tools/access.mjs): reached from an access point on a
// trail or a path nearby. Generic points come from the pack's access.json; badge peaks
// that cannot be climbed at all have their own point in core/badges.js (access).

/** free: a way this close to the summit means walk to it; the access point is at most maxDist
 * away and maxDrop lower; a track within reach of it counts. v: bump when the rule changes. */
export const ACCESS_RULE = { v: 2, free: 100, maxDist: 250, maxDrop: 30, reach: 60 };

/**
 * The access point of a peak: {x, y, d (m from the summit), drop (m lower), own (a badge peak's
 * own point), note} or null. acc: access.json; badgeOwn: the badge points matched to it.
 */
export function accessOf(p, acc, badgeOwn = []) {
  const own = badgeOwn.find((k) => k.ax != null);
  if (own) return { x: own.ax, y: own.ay, d: Math.round(Math.hypot(own.ax - p.x, own.ay - p.y)), drop: null, own: true, note: own.access?.note || null };
  const a = acc?.peaks?.[p.id] || acc?.badges?.[p.id];
  return a ? { x: a[0], y: a[1], d: a[2], drop: a[3], own: false, note: null } : null;
}

/** A poi with its access point attached for discover() (ax, ay, ar). */
export function withAccess(p, a) {
  return a ? { ...p, ax: a.x, ay: a.y, ar: ACCESS_RULE.reach } : p;
}
