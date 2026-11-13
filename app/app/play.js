// playing a route: the point rides along it (the profile cursor and the map follow), tap to pause
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { state } from "./state.js";

export function createPlay(C) {
  let play = null;
  const PLAY_ICON = (on) => `<svg><use href="#i-${on ? "pause" : "play"}"/></svg>`;
  function stopPlay() {
    if (!play) return;
    cancelAnimationFrame(play.raf); play = null;
    const b = C.$("tip").querySelector(".play");
    if (b) { b.innerHTML = PLAY_ICON(false); b.setAttribute("aria-label", "Odtwórz trasę"); }
    C.view.draw();
  }
  function togglePlay() {
    if (play) return stopPlay();
    const pr = state.curProf;
    if (!pr || pr.key !== state.cur?.key) return;
    const n = pr.P.d.length, km = pr.P.d[n - 1] / 1000, dur = Math.min(26000, Math.max(8000, km * 1300));
    let from = pr.ui.at() ?? 0;
    if (from >= n - 2) from = 0;
    if (C.view.zl < 8) { const x = pr.P.x[from], y = pr.P.y[from]; C.view.stopFlight(); C.view.centerOn(x, y, 9); C.view.draw(); }
    const t0 = performance.now(), run = (play = { raf: 0 });
    const tick = (now) => {
      if (play !== run) return;
      const i = Math.min(n - 1, Math.round(from + ((now - t0) / dur) * (n - 1)));
      pr.ui.seek(i);
      if (i >= n - 1) { stopPlay(); C.haptic.bump(); return; }
      run.raf = requestAnimationFrame(tick);
    };
    const b = C.$("tip").querySelector(".play");
    if (b) { b.innerHTML = PLAY_ICON(true); b.setAttribute("aria-label", "Zatrzymaj"); }
    run.raf = requestAnimationFrame(tick);
  }
  /** While playing: the map eases toward the point once it leaves the middle of the free area. */
  function glide(x, y) {
    const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sheet-peek")) || 84;
    const top = 80, bottom = C.view.H - peek - 20, cx = C.view.W / 2, cy = (top + bottom) / 2;
    const [X, Y] = C.view.toScreen(x, y);
    const dx = Math.abs(X - cx) > C.view.W * 0.28 ? (cx - X) * 0.1 : 0, dy = Math.abs(Y - cy) > (bottom - top) * 0.28 ? (cy - Y) * 0.1 : 0;
    if (dx || dy) { C.view.pan(dx, dy); C.view.quick(); glide.t ||= setTimeout(() => { glide.t = 0; C.view.draw(); }, 350); } // the labels layer is redrawn now and then, not every frame
  }
  return { glide, playing: () => !!play, stopPlay, togglePlay };
}
