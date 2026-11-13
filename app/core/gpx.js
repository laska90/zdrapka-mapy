// GPX reader without DOM (works in workers and Node). Handles the subset
// Garmin and most apps write: <trk><name/><type/><trkseg><trkpt lat lon><ele/><time/>.

const TYPE_MAP = { hiking: "hiking", walking: "walking", mountaineering: "mountaineering", trail_running: "trail_running", running: "running", cycling: "cycling", snowshoeing: "snowshoeing" };

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`));
  return m ? m[1] : null;
};
const inner = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? m[1].trim() : null;
};

export function readGpx(input, id) {
  const xml = typeof input === "string" ? input : new TextDecoder().decode(input);
  const trk = xml.match(/<(?:\w+:)?trk\b[\s\S]*?<\/(?:\w+:)?trk>/)?.[0] ?? xml;
  const head = trk.split(/<(?:\w+:)?trkseg\b/)[0];
  const name = inner(head, "name");
  const type = inner(head, "type");
  const points = [];
  const re = /<(?:\w+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?trkpt>)/g;
  let m;
  while ((m = re.exec(trk))) {
    const lat = parseFloat(attr(m[1], "lat")), lon = parseFloat(attr(m[1], "lon"));
    const body = m[2] || "";
    const time = inner(body, "time");
    if (!time || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(time) ? time : time + "Z");
    if (Number.isNaN(t)) continue;
    const e = inner(body, "ele");
    points.push({ t, lat, lon, ele: e === null ? null : parseFloat(e) });
  }
  points.sort((a, b) => a.t - b.t);
  const sport = type ? TYPE_MAP[type.toLowerCase()] || type.toLowerCase() : "unknown";
  return { id, sport, subSport: null, name, start: points.length ? points[0].t : null, points };
}

/** A .tcx file (Strava's archive has them): the same shape as readGpx. */
export function readTcx(input, id) {
  const xml = typeof input === "string" ? input : new TextDecoder().decode(input);
  const act = xml.match(/<(?:\w+:)?Activity\b([^>]*)>/);
  const sp = act ? attr(act[1], "Sport") : null;
  const name = inner(xml, "Notes") || null;
  const points = [];
  const re = /<(?:\w+:)?Trackpoint\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Trackpoint>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1], time = inner(b, "Time"), lat = parseFloat(inner(b, "LatitudeDegrees")), lon = parseFloat(inner(b, "LongitudeDegrees"));
    if (!time || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(time) ? time : time + "Z");
    if (Number.isNaN(t)) continue;
    const e = inner(b, "AltitudeMeters");
    points.push({ t, lat, lon, ele: e === null ? null : parseFloat(e) });
  }
  points.sort((a, b) => a.t - b.t);
  const sport = sp ? ({ running: "running", biking: "cycling" })[sp.toLowerCase()] || sp.toLowerCase() : "unknown";
  return { id, sport, subSport: null, name, start: points.length ? points[0].t : null, points };
}
