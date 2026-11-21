// The ranges' names, laid by hand as on a paper map (fixed: nothing is worked out on the phone, so a name never
// moves with the map). Five bands of zoom, each with its own fixed set of town names (glmap: the cities from
// 6, towns of 15 000 from 7.6, of 4 000 from 8.5, all from 9.3): in each band a name sits where it is clear of
// the other ranges' names and of those towns' names (test/ui: "the ranges' names never overlap ...").
// [bands, lon, lat, name]: bands "01234" (0: 6–6.9, 1: 6.9–7.6, 2: 7.6–8.5, 3: 8.5–9.3, 4: 9.3–10.8); "\n" breaks the line.
// A range may have more than one entry (another place further in); null: not named (a valley). A range not
// here (another region) is named closer in, wherever its name fits.
export const RANGE_ZOOMS = [6, 6.9, 7.6, 8.5, 9.3, 10.8];
// [bands, lon, lat, name, shown with this range]
export const RANGE_EXTRA = [["0", 16.25, 50.55, "Sudety", "karkonosze"]];
export const RANGE_LABELS = {
  "gory-luzyckie": [["4", 14.678, 50.822, "Góry\nŁużyckie"]],
  "jested": [["34", 15.006, 50.634, "Grzbiet Jeszczedu"]],
  "gory-izerskie": [["1", 15.306, 50.842, "Góry Izerskie"], ["2", 15.306, 50.97, "Góry Izerskie"], ["34", 15.306, 50.81, "Góry Izerskie"]],
  "karkonosze": [["12", 15.622, 50.622, "Karkonosze"], ["34", 15.55, 50.662, "Karkonosze"]],
  "rudawy-janowickie": [["34", 15.908, 50.852, "Rudawy\nJanowickie"]],
  "gory-kaczawskie": [["234", 15.954, 50.992, "Góry Kaczawskie"]],
  "pogorze-kaczawskie": [["4", 15.8, 51.1, "Pogórze\nKaczawskie"]],
  "gory-walbrzyskie": [["34", 16.122, 50.846, "Góry\nWałbrzyskie"]],
  "gory-kamienne": [["34", 16.11, 50.638, "Góry\nKamienne"]],
  "gory-sowie": [["1234", 16.542, 50.63, "Góry Sowie"]],
  "gory-bardzkie": [["34", 16.762, 50.482, "Góry Bardzkie"]],
  "gory-stolowe": [["234", 16.418, 50.53, "Góry Stołowe"]],
  "gory-orlickie": [["2", 16.388, 50.184, "Góry\nOrlickie"], ["34", 16.3, 50.24, "Góry\nOrlickie"]],
  "gory-bystrzyckie": [["34", 16.578, 50.334, "Góry Bystrzyckie"]],
  "snieznik": [["1", 16.834, 50.238, "Masyw\nŚnieżnika"], ["2", 16.738, 50.142, "Masyw\nŚnieżnika"], ["34", 16.81, 50.15, "Masyw\nŚnieżnika"]],
  "gory-zlote": [["2", 17.028, 50.388, "Góry Złote"], ["34", 17.064, 50.34, "Góry Złote"]],
  "kralicka-brazda": null,
  "hruby-jesenik": [["12", 17.198, 50.134, "Wysoki Jesionik"], ["34", 17.198, 50.03, "Wysoki Jesionik"]],
  "gory-opawskie": [["34", 17.478, 50.208, "Góry\nOpawskie"]],
  "masyw-slezy": [["34", 16.714, 50.826, "Masyw Ślęży"]],
};

// The peaks named on the far map besides the Korona Gór Polski ones (core/badges.js KGP): the highest or best
// known of the ranges over the border. [name, lon, lat, m]
export const FAR_PEAKS = [
  ["Praděd", 17.231, 50.083, 1491],
  ["Smrk", 15.2731, 50.8891, 1124],
  ["Velká Deštná", 16.3975, 50.3012, 1116],
  ["Ještěd", 14.9847, 50.7327, 1012],
  ["Luž", 14.6469, 50.8489, 793],
];
