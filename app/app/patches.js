// The long trails' icons: embroidered patches (like the ones sewn on a rucksack): a coloured rim
// with a stitched line, the trail's letters on the top arc, its mountains on the bottom one, and its
// landscape inside, with the red trail through it. Data URLs (SVG), one per trail.

const INK = "#2e2419", SKY = "#f3ecd8", RED = "#d2342a", WHITE = "#fbf7ec";

// rim colour, letters (top), word (bottom), landscape (64x64, the field is the circle r 22 at 32,32)
const PATCH = {
  gss: {
    rim: "#a3262d", top: "GSS", bottom: "SUDETY",
    scene: `<path d="M4 50 L16 38 L22 42 L30 33 L36 36 L44 30 L60 46 L60 64 L4 64 Z" fill="#7d9a6f"/>
<path d="M18 50 L30 24 L35 28 L39 22 L52 50 Z" fill="#a9a395"/>
<path d="M33.5 21 L33.5 17.5 M36 22.4 L36 18.8" stroke="${INK}" stroke-width=".9"/>
<ellipse cx="34.8" cy="17.2" rx="3.4" ry="1.2" fill="${WHITE}" stroke="${INK}" stroke-width=".8"/><ellipse cx="34.8" cy="15.2" rx="2.6" ry=".95" fill="${WHITE}" stroke="${INK}" stroke-width=".8"/><ellipse cx="34.8" cy="13.4" rx="1.8" ry=".7" fill="${WHITE}" stroke="${INK}" stroke-width=".8"/>
<path d="M4 54 L60 54 L60 64 L4 64 Z" fill="#5f8455"/>
<path d="M10 58 Q20 52 26 47 Q31 42 33.5 30" fill="none" stroke="${RED}" stroke-width="1.6" stroke-dasharray="2.4 1.6"/>
<circle cx="47" cy="19" r="3.6" fill="#f2c14e" stroke="${INK}" stroke-width=".7"/>`,
  },
  gsb: {
    rim: "#2f6b3a", top: "GSB", bottom: "BESKIDY",
    scene: `<path d="M4 40 Q14 28 24 32 Q32 20 40 24 Q50 28 60 38 L60 64 L4 64 Z" fill="#9db98a"/>
<path d="M4 48 Q16 38 28 42 Q40 34 60 44 L60 64 L4 64 Z" fill="#6f9a5c"/>
<path d="M4 56 Q20 50 34 54 Q46 50 60 54 L60 64 L4 64 Z" fill="#4f7a43"/>
<path d="M12 50 L14.6 43 L17.2 50 Z M45 50 L47.6 42.5 L50.2 50 Z M50 52 L52.4 46 L54.8 52 Z M19 53 L21.4 47 L23.8 53 Z" fill="#2f5a2c" stroke="${INK}" stroke-width=".6"/>
<path d="M6 44 Q16 33 24 33 Q31 24 40 25.5 Q50 29 58 40" fill="none" stroke="${RED}" stroke-width="1.6" stroke-dasharray="2.4 1.6"/>
<path d="M44 16 l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z" fill="#f2c14e" stroke="${INK}" stroke-width=".5"/>`,
  },
  msb: {
    rim: "#c07a1c", top: "MSB", bottom: "BESKID MAŁY",
    scene: `<path d="M4 44 Q16 30 28 36 Q36 26 44 28 Q54 32 60 42 L60 64 L4 64 Z" fill="#a8c08a"/>
<path d="M4 52 Q18 44 30 48 Q44 42 60 50 L60 64 L4 64 Z" fill="#7aa264"/>
<path d="M40 27.5 L40 13 M37.8 16 L42.2 16 M38.4 19.5 L41.6 19.5 M40 13 L40 11" stroke="${INK}" stroke-width="1"/>
<circle cx="40" cy="12" r=".9" fill="${RED}"/>
<path d="M10 50 L12.4 44 L14.8 50 Z M50 48 L52.4 42 L54.8 48 Z" fill="#2f5a2c" stroke="${INK}" stroke-width=".6"/>
<path d="M8 56 Q18 48 26 44 Q34 38 39 29" fill="none" stroke="${RED}" stroke-width="1.6" stroke-dasharray="2.4 1.6"/>`,
  },
  snp: {
    rim: "#1f4e9c", top: "SNP", bottom: "SLOVENSKO",
    scene: `<path d="M4 46 L14 34 L22 38 L32 22 L38 28 L46 24 L60 40 L60 64 L4 64 Z" fill="#a39d92"/>
<path d="M28 27 L32 22 L35 25.5 L33 26 L31 25 Z M44 25.5 L46 24 L48 26.5 Z" fill="${WHITE}" stroke="${INK}" stroke-width=".6"/>
<path d="M4 50 Q18 42 30 46 Q44 40 60 48 L60 64 L4 64 Z" fill="#7d9a6f"/>
<path d="M4 57 Q20 52 34 55 Q48 52 60 56 L60 64 L4 64 Z" fill="#5f8455"/>
<path d="M6 54 Q16 46 22 40 Q28 34 32 24 Q38 30 46 26 Q52 30 58 38" fill="none" stroke="${RED}" stroke-width="1.6" stroke-dasharray="2.4 1.6"/>`,
  },
  mag: {
    rim: "#3a4458", top: "MAGISTRALA", bottom: "TATRY",
    scene: `<path d="M4 44 L12 30 L18 36 L26 18 L32 28 L38 14 L44 26 L50 20 L60 38 L60 64 L4 64 Z" fill="#8f98a4"/>
<path d="M24 22 L26 18 L28 21.5 Z M36.4 17.5 L38 14 L39.8 18 Z M49 22 L50 20 L51.4 22.6 Z" fill="${WHITE}" stroke="${INK}" stroke-width=".6"/>
<path d="M30 28 L27 38 M41 27 L37 39 M18 37 L16 44" fill="none" stroke="${INK}" stroke-width=".6"/>
<path d="M4 46 L60 46 L60 64 L4 64 Z" fill="#6f8f62"/>
<ellipse cx="32" cy="50" rx="14" ry="3.6" fill="#7db5dc" stroke="${INK}" stroke-width=".7"/>
<path d="M22 50 Q32 51.5 42 50" fill="none" stroke="${WHITE}" stroke-width=".7"/>
<path d="M6 42 Q14 36 20 38 Q28 40 34 36 Q44 33 58 36" fill="none" stroke="${RED}" stroke-width="1.6" stroke-dasharray="2.4 1.6"/>`,
  },
};

/** The patch of a long trail (an unknown one: its letters on a plain field). */
export function patchSVG(id, size = 128) {
  const P = PATCH[id] || { rim: "#7a6a58", top: id.toUpperCase(), bottom: "", scene: `<path d="M4 46 Q20 30 32 36 Q44 26 60 42 L60 64 L4 64 Z" fill="#9db98a"/>` };
  const fs = (t) => (t.length > 8 ? 5.2 : t.length > 6 ? 5.6 : 6.6);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
<defs><clipPath id="f-${id}"><circle cx="32" cy="32" r="21.6"/></clipPath>
<path id="t-${id}" d="M8.4 32 A23.6 23.6 0 0 1 55.6 32"/><path id="b-${id}" d="M3.8 32 A28.2 28.2 0 0 0 60.2 32"/></defs>
<circle cx="32" cy="32" r="31" fill="${INK}"/><circle cx="32" cy="32" r="30" fill="${P.rim}"/>
<circle cx="32" cy="32" r="29.3" fill="none" stroke="${WHITE}" stroke-width=".7" stroke-dasharray="1.6 1.2" opacity=".85"/>
<circle cx="32" cy="32" r="22.4" fill="${SKY}" stroke="${INK}" stroke-width="1.1"/>
<g clip-path="url(#f-${id})">${P.scene}</g>
<circle cx="32" cy="32" r="21.6" fill="none" stroke="${WHITE}" stroke-width=".6" stroke-dasharray="1.4 1.2" opacity=".7"/>
<text font-family="system-ui, sans-serif" font-weight="800" font-size="${fs(P.top)}" fill="${WHITE}" letter-spacing="1.2"><textPath href="#t-${id}" startOffset="50%" text-anchor="middle">${P.top}</textPath></text>
${P.bottom ? `<text font-family="system-ui, sans-serif" font-weight="700" font-size="${fs(P.bottom) - 0.6}" fill="${WHITE}" letter-spacing="1"><textPath href="#b-${id}" startOffset="50%" text-anchor="middle">${P.bottom}</textPath></text>` : ""}
<circle cx="8.8" cy="32" r="1.1" fill="${WHITE}"/><circle cx="55.2" cy="32" r="1.1" fill="${WHITE}"/></svg>`;
}

const cache = new Map();
export function patchURL(id) {
  if (!cache.has(id)) cache.set(id, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(patchSVG(id)));
  return cache.get(id);
}
