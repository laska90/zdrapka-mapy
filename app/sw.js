// Offline support: the app shell is precached; everything else from this
// origin (the region pack) is cached on first use and refreshed in the
// background. Activity files never pass through here - they are read locally.

const VERSION = "v250";
const CACHE = `zdrapka-${VERSION}`;
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "app/app.js", "app/glmap.js", "app/glstyle.js", "app/glfog.js", "app/overlay.js", "app/mapdata.js", "app/worker.js", "app/bdworker.js", "app/store.js", "app/labels.js", "app/vignettes.js", "app/native.js", "app/diag.js", "app/advanced.js", "app/garmin.js", "app/incoming.js", "app/pace.js", "app/play.js", "app/cards.js", "app/state.js", "app/seen.js", "app/settings.js", "app/pill.js", "app/layers.js", "app/outings.js", "app/goals.js", "app/progress.js", "app/friends.js", "app/account.js", "app/cloud.js", "app/cloudsync.js", "app/gpsui.js", "app/sheet.js", "app/drawer.js", "app/gestures.js", "app/gps.js", "app/haptics.js", "app/planner.js", "app/trip.js", "app/trips.js", "app/kpi.js", "app/growprof.js", "app/glyphs.js", "app/style.css",
  "app/sos.js", "app/spotname.js", "app/lifts.js", "app/slopeview.js", "app/search.js", "app/train.js", "app/backup.js", "app/weather.js", "app/postcard.js", "app/year.js", "app/walked.js", "app/maps-ui.js",
  "core/fit.js", "core/notices.js", "core/packs.js", "core/badge-lists-karpaty.js", "core/gpx.js", "core/zip.js", "core/clean.js", "core/geometry.js", "core/matcher.js", "core/stats.js", "core/pack.js", "core/pipeline.js", "core/intervals.js", "core/atlas.js", "core/badges.js", "core/badge-lists.js", "core/routes.js", "core/elev.js", "core/contour-elev.js", "core/slope.js", "core/hud.js", "core/year.js", "core/access.js", "core/pace.js", "core/route.js", "core/onroute.js", "core/planlink.js", "core/trackcode.js", "core/groupcode.js", "core/profile.js", "core/fresh.js", "core/builtup.js",
  "assets/fonts/IMFePIrm28P.woff", "assets/fonts/IMFePIit28P.woff", "assets/icon-192.png", "app/splash.js", "app/maps.js", "app/patches.js", "app/stamps.js", "app/stamps-data.json", "assets/icon-512.png",
  "vendor/maplibre-gl.js", "vendor/maplibre-gl.css", "vendor/pmtiles.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("zdrapka-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const u = new URL(req.url);
  // this origin, and the map packs from the maps site (not their lists: those are always asked fresh)
  const maps = /^https:\/\/(laska90\.github\.io\/zdrapka-mapy|raw\.githubusercontent\.com\/laska90\/zdrapka-mapy)\//.test(req.url) && !/(maps|files)\.json$/.test(u.pathname);
  if (req.method !== "GET" || (u.origin !== location.origin && !maps)) return;
  if (req.headers.has("range")) return; // parts of a file (the map's tiles): straight from the network
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => hit);
      if (hit) { e.waitUntil(fresh); return hit; }
      return fresh;
    }),
  );
});
