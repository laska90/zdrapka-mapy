// Light vibrations on the phone (navigator.vibrate; the Android app has the VIBRATE permission);
// where there is no vibration (most desktops) nothing happens.
// tick: a light tap (a sheet snaps, the profile cursor passes a place); bump: a firmer one;
// reward: a new peak or a threshold passed.

let last = 0;
const go = (pattern) => {
  const t = performance.now();
  if (t - last < 40) return; // not a buzz of taps
  last = t;
  try { navigator.vibrate?.(pattern); } catch { /* no vibration here */ }
};

export const tick = () => go(8);
export const bump = () => go(20);
export const reward = () => go([14, 50, 14]);
