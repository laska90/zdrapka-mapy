// The start screen: the app's medal over one line of a ridge (a paler one behind it), the name in the app's own
// letters. The time of day sets the light (morning and day bright, evening a warm violet, night dark violet with
// a few stars) and how high the medal stands; the season colours the ridge as its quarter of the ring (winter
// blue), that quarter stronger. The medal fades in where it stands; the ring turns at an even pace while the app
// loads (the sign does not). A plain script run right after #loading, before the app. ?splash=zima-noc
// (season-time) shows a chosen one; window.__splash(season, time) sets it again (previews, screenshots).
(function () {
  const SEASONS = ["wiosna", "lato", "jesien", "zima"];
  const seasonOf = (m) => (m >= 2 && m <= 4 ? 0 : m >= 5 && m <= 7 ? 1 : m >= 8 && m <= 10 ? 2 : 3); // (as app/marks.js)
  const timeOf = (h) => (h >= 5 && h < 10 ? "rano" : h >= 10 && h < 17 ? "dzien" : h >= 17 && h < 21 ? "wieczor" : "noc");
  const el = document.getElementById("loading");
  try { const a = JSON.parse(localStorage.getItem("scratchcard.settings") || "{}").accent; if (a && a !== "fiolet") document.documentElement.dataset.accent = a; } catch { /* private mode */ }
  function set(season, time) {
    if (!el) return;
    el.dataset.season = season; el.dataset.time = time;
    el.querySelectorAll(".splrot path").forEach((p, k) => p.setAttribute("opacity", k === SEASONS.indexOf(season) ? 1 : 0.62));
    // a few stars at night, the same every night
    let r = 7, s = "";
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    if (time === "noc") for (let i = 0; i < 30; i++) { const k = rnd(); s += `<circle cx="${(rnd() * 100).toFixed(1)}%" cy="${(4 + rnd() * 56).toFixed(1)}%" r="${(0.7 + k * 0.9).toFixed(2)}" fill="#fff" opacity="${(0.3 + k * 0.5).toFixed(2)}"/>`; }
    el.querySelector(".splsky").innerHTML = s;
  }
  const want = /[?&]splash=(\w+)-(\w+)/.exec(location.search), now = new Date();
  set(SEASONS.includes(want?.[1]) ? want[1] : SEASONS[seasonOf(now.getMonth())], ["rano", "dzien", "wieczor", "noc"].includes(want?.[2]) ? want[2] : timeOf(now.getHours()));
  window.__splash = set;
})();
