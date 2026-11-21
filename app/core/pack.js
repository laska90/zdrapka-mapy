// Region pack: lon/lat <-> pack metres (the pack itself: src/scratchcard/web/pack.py).

/** Projection lon/lat -> pack metres (x east, y south). */
export function projector(meta) {
  const { lon0, lat0, kx, ky } = meta.proj;
  return (lon, lat) => [(lon - lon0) * kx, -(lat - lat0) * ky];
}

export function unprojector(meta) {
  const { lon0, lat0, kx, ky } = meta.proj;
  return (x, y) => [lon0 + x / kx, lat0 - y / ky];
}
