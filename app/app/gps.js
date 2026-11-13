// Where the phone is and which way it points: the browser's geolocation (in the
// Android app the WebView asks for the location permission) and the compass
// (absolute device orientation; the GPS course when walking, if there is no compass).

/** Rough EGM2008 geoid height over the Sudetes (m): phones report GPS height
 * above the WGS84 ellipsoid, the map gives heights above sea level. */
export const GEOID_SUDETY = 42;

const RAD = Math.PI / 180;

/** Compass heading (deg, clockwise from north) of the top of the screen, from
 * W3C device orientation angles. Uses the screen's top edge when the phone lies
 * flat and its back when it stands upright, blending in between. */
export function headingOf(alpha, beta, gamma, screenAngle = 0) {
  const cZ = Math.cos(alpha * RAD), sZ = Math.sin(alpha * RAD), cX = Math.cos(beta * RAD), sX = Math.sin(beta * RAD), cY = Math.cos(gamma * RAD), sY = Math.sin(gamma * RAD);
  // device axes in earth coordinates (x east, y north, z up); R = Rz(a) Rx(b) Ry(g)
  const X = [cZ * cY - sZ * sX * sY, sZ * cY + cZ * sX * sY, -cX * sY];
  const Y = [-sZ * cX, cZ * cX, sX];
  const Z = [cZ * sY + sZ * sX * cY, sZ * sY - cZ * sX * cY, cX * cY];
  const t = screenAngle * RAD, st = Math.sin(t), ct = Math.cos(t);
  // the screen's up direction, and the phone's back (-Z)
  const ux = st * X[0] + ct * Y[0], uy = st * X[1] + ct * Y[1];
  const vx = ux - Z[0], vy = uy - Z[1];
  if (Math.hypot(vx, vy) < 1e-6) return null;
  return (Math.atan2(vx, vy) / RAD + 360) % 360;
}

export class Gps {
  /** onFix(state) on every position or (throttled) heading change; onError(message). */
  constructor({ onFix, onError }) {
    this.onFix = onFix; this.onError = onError;
    this.on = false; this.fix = null; this.heading = null; this.compass = false;
    this.vec = null; this.lastEmit = 0;
    this.orient = this.orient.bind(this);
  }

  start({ quick = false } = {}) {
    if (this.on) return;
    if (!navigator.geolocation) { this.onError?.("Ten telefon nie udostępnia lokalizacji."); return; }
    this.on = true; this.denied = false;
    const take = (p) => {
      const c = p.coords;
      if (this.fix && p.timestamp < this.fix.t) return; // an older one (the quick fix after the watch's)
      this.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, altAcc: c.altitudeAccuracy, speed: c.speed, course: c.heading, t: p.timestamp };
      if (!this.compass && c.heading != null && !Number.isNaN(c.heading) && (c.speed ?? 0) > 0.6) this.heading = c.heading;
      this.emit(true);
    };
    // back from the pocket: at once the phone's latest position (cell, wifi, the last GPS fix),
    // while the GPS warms up for an exact one
    if (quick) navigator.geolocation.getCurrentPosition(take, () => {}, { enableHighAccuracy: false, maximumAge: 120000, timeout: 4000 });
    this.watch = navigator.geolocation.watchPosition(take, (e) => {
      if (e.code === 1) this.denied = true;
      this.onError?.(e.code === 1 ? "Brak zgody na lokalizację. Włącz ją w ustawieniach telefonu (Aplikacje → Zdrapka → Uprawnienia)." : e.code === 3 ? "Szukam sygnału GPS…" : "Lokalizacja niedostępna. Czy GPS jest włączony?");
      if (e.code === 1) { this.denied = true; this.stop(); }
    }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    this.evName = "ondeviceorientationabsolute" in globalThis ? "deviceorientationabsolute" : "deviceorientation";
    addEventListener(this.evName, this.orient);
    clearInterval(this.staleT);
    this.staleT = setInterval(() => this.emit(true), 10000); // the dot greys out without fresh fixes
  }

  /** keep: the last fix stays (greyed as it ages): the screen off, not the GPS switched off. */
  stop({ keep = false } = {}) {
    if (!this.on) return;
    this.on = false;
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    removeEventListener(this.evName, this.orient);
    clearInterval(this.staleT);
    if (!keep) this.fix = null;
    this.heading = null; this.vec = null; this.compass = false;
    if (!keep) this.emit(true);
  }

  orient(e) {
    let h = null;
    if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
    else if ((e.absolute || e.type === "deviceorientationabsolute") && e.alpha != null) h = headingOf(e.alpha, e.beta ?? 0, e.gamma ?? 0, screen.orientation?.angle ?? 0);
    if (h == null) return;
    this.compass = true;
    // smooth on the circle
    const v = [Math.sin(h * RAD), Math.cos(h * RAD)];
    this.vec = this.vec ? [this.vec[0] * 0.75 + v[0] * 0.25, this.vec[1] * 0.75 + v[1] * 0.25] : v;
    const nh = (Math.atan2(this.vec[0], this.vec[1]) / RAD + 360) % 360;
    const moved = this.heading == null || Math.abs(((nh - this.heading + 540) % 360) - 180) > 1.5;
    this.heading = nh;
    if (moved) this.emit(false);
  }

  get stale() { return !this.fix || Date.now() - this.fix.t > 30000; }

  emit(force) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 66) return; // ~15 per second for the compass
    this.lastEmit = now;
    this.onFix?.(this);
  }
}
