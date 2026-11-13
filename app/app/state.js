// The app's state: what more than one file reads or changes while the app runs, in one place. app.js
// and its parts read and set state.x directly; nothing listens (whoever changes something draws what
// it affects). What only one file uses stays in that file.

export const state = {
  settings: { mode: "fog", icu: null }, // this device's settings (saveSettings in app.js)
  careful: false, // the last start never calmed down (the WebView went down): lighter drawing, no backdrop
  result: null, // the worker's results: outings, coverage, places found, tallies
  regionBase: null, // where the map pack is (the app's files or the maps site)
  backdropBase: null, // where the backdrop map outside the region is, if any
  // the sheet and its cards
  cur: null, // the card open now: {key, label, reopen...}
  navStack: [], // the cards under the open one: Back returns to them
  dstack: [], // the side panel's pages under the open one
  openBadge: null, // the badge whose peaks the progress page shows
  summits: null, // the badge peaks with their lists (worked out once)
  selected: null, // the outing highlighted on the map
  curProf: null, // the profile on the card: {key, P, ui}
  paceJob: null, // the pace being worked out: {n, of} (pace.js), shown in the list
  fromNow: null, // the card's way from you: {key, q, at: [x, y]} (worked out again as you move)
  // your position
  follow: false, // the map follows your dot
  firstFix: true, // the next fix flies the map to you
  posElev: null, // the height under your dot: {x, y, r}
  homeWait: false, // (asked before the GPS had you: the trains come with the first fix)
  ptrs: new Map(), // the fingers on the map: pointerId -> {x, y}
  // the planner, once it exists (app.js sets these)
  planKeep: () => false, // the plan's card never goes away
  planWalk: () => false, // a route is being walked
  stampData: null, // the badge peaks' stamps (app/stamps-data.json), once loaded
};
