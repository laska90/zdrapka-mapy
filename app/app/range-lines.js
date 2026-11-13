// The ranges' names on the far map: where each is written (the baseline of its letters, lon/lat, west to east),
// drawn by hand: beside the main ridge, off the border that runs along it and off the highest peak's own name.
// null: not named (a valley). A range not here gets a line worked out from its highest peaks (glmap rangeAxes).
export const RANGE_LINES = {
  "gory-luzyckie": [[14.52, 50.815], [14.64, 50.825], [14.76, 50.815], [14.87, 50.79]],
  "jested": [[14.95, 50.705], [15.03, 50.665], [15.12, 50.625], [15.22, 50.585]],
  "gory-izerskie": [[15.09, 50.835], [15.19, 50.828], [15.29, 50.815], [15.39, 50.795]],
  "karkonosze": [[15.48, 50.735], [15.6, 50.72], [15.72, 50.697], [15.84, 50.676], [15.94, 50.655]],
  "rudawy-janowickie": [[15.86, 50.85], [15.92, 50.82], [15.98, 50.785], [16.02, 50.76]],
  "gory-kaczawskie": [[15.66, 50.925], [15.8, 50.945], [15.94, 50.945], [16.08, 50.925]],
  "pogorze-kaczawskie": [[15.55, 51.08], [15.76, 51.11], [15.97, 51.115], [16.18, 51.095]],
  "gory-walbrzyskie": [[16.07, 50.815], [16.19, 50.81], [16.31, 50.79], [16.38, 50.77]],
  "gory-kamienne": [[16.02, 50.725], [16.14, 50.718], [16.26, 50.708], [16.37, 50.68]],
  "gory-sowie": [[16.47, 50.745], [16.55, 50.7], [16.63, 50.655], [16.71, 50.61]],
  "gory-bardzkie": [[16.63, 50.535], [16.73, 50.51], [16.83, 50.485], [16.9, 50.465]],
  "gory-stolowe": [[16.21, 50.455], [16.31, 50.445], [16.41, 50.425], [16.49, 50.4]],
  "gory-orlickie": [[16.19, 50.335], [16.27, 50.275], [16.35, 50.215], [16.45, 50.135]],
  "gory-bystrzyckie": [[16.46, 50.375], [16.52, 50.305], [16.575, 50.235], [16.63, 50.165]],
  "snieznik": [[16.7, 50.185], [16.79, 50.167], [16.88, 50.152], [16.95, 50.14]],
  "gory-zlote": [[16.93, 50.42], [17, 50.37], [17.07, 50.31], [17.13, 50.25]],
  "kralicka-brazda": null,
  "hruby-jesenik": [[17.03, 50.16], [17.12, 50.09], [17.21, 50.02], [17.3, 49.95]],
  "gory-opawskie": [[17.32, 50.3], [17.42, 50.295], [17.52, 50.275], [17.6, 50.25]],
  "masyw-slezy": [[16.62, 50.895], [16.71, 50.892], [16.8, 50.875]],
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
