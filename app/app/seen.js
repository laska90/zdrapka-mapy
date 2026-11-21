// What the app has already shown or noticed on this device (not settings: nothing to choose, no backup):
// how many times the planning hint came up, the newest maps seen, the trail thresholds reached.

const KEY = "zdrapka.seen";
let all = null;
const load = () => { if (!all) { try { all = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { all = {}; } } return all; };

/** What was noted under k (undefined: never). */
export function seen(k) { return load()[k]; }
/** Note v under k. */
export function see(k, v) { load()[k] = v; try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* full or blocked */ } }
