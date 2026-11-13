// the active route after its end: "Trasa zakończona" with Cofnij for a few seconds (the route's figures
// are on its card, at the bottom; the top of the map stays clear)
// (moved out of app.js: what it needs of the app comes in C, see createX in app.js)
import { routeKeep } from "./native.js";

export function createPill(C) {
  let wasEnded = false, tick = 0;
  function routePill() {
    const q = C.planner.pill(), ended = !!q?.ended;
    if (ended && !wasEnded) C.undoToast("Trasa zakończona", () => C.planner.undoEnd(), 6000);
    wasEnded = ended;
    keep();
  }
  /** While a route is active: its notification (in the app; it keeps Android from killing the app in the
   * pocket), what is left to the finish, every minute; gone when the route ends. */
  function keep() {
    const q = C.planner.isActive?.() ? C.planner.pill() : null;
    if (!q || q.ended || q.plan || !q.name) { routeKeep(null); clearInterval(tick); tick = 0; return; }
    const left = q.off ? "poza trasą" : [q.km != null ? `${C.nf(q.km)} km` : "", q.ms != null ? C.hm(q.ms) : ""].filter(Boolean).join(" · ") + " do mety";
    routeKeep({ title: q.name, text: left });
    if (!tick) tick = setInterval(keep, 60000);
  }
  return { routePill };
}
