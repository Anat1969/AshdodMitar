import maplibregl, { type StyleSpecification } from 'maplibre-gl';

// Free background maps, no API key.
// streets: OpenFreeMap (OpenMapTiles vector, OSM data), labels switched to Hebrew names.
// sat: Esri World Imagery raster (free display use with attribution).
// Hebrew shaping: @mapbox/mapbox-gl-rtl-text 0.2.3 (the MapLibre-compatible build), self-hosted in public/vendor.
// Do not use 0.3.0: it is built for mapbox-gl v3 and blocks MapLibre from finishing the style load (blank map).
// plain: CARTO light raster (also the fallback when OpenFreeMap is unreachable).
export type BaseKey = 'streets' | 'sat' | 'plain';
export const BASEMAPS: { key: BaseKey; title: string; source: string }[] = [
  { key: 'streets', title: 'רחובות ומבנים', source: 'OpenFreeMap, OpenMapTiles, נתוני OpenStreetMap' },
  { key: 'sat', title: 'תצלום אוויר', source: 'Esri World Imagery' },
  { key: 'plain', title: 'רקע שקט', source: 'CARTO, נתוני OpenStreetMap' },
];

let rtlRequested = false;
export function ensureRtlPlugin() {
  if (rtlRequested) return;
  if (new URLSearchParams(window.location.search).get('rtl') === '0') return;
  rtlRequested = true;
  try {
    if (maplibregl.getRTLTextPluginStatus() === 'unavailable') void maplibregl.setRTLTextPlugin(new URL('/vendor/mapbox-gl-rtl-text-0.2.3.min.js', window.location.origin).href, true);
  } catch { /* labels fall back to unshaped text */ }
}

export const EMPTY_STYLE: StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } }],
};

function raster(id: string, tiles: string[], attribution: string, paint: Record<string, number> = {}, maxzoom = 19): StyleSpecification {
  return {
    version: 8,
    sources: { [id]: { type: 'raster', tiles, tileSize: 256, attribution, maxzoom } },
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } }, { id, type: 'raster', source: id, paint }],
  };
}

export const PLAIN_STYLE = raster('carto', ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', 'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
  '© OpenStreetMap contributors © CARTO', { 'raster-saturation': -0.6 });
export const SAT_STYLE = raster('esri', ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  'Imagery © Esri, Maxar, Earthstar Geographics', { 'raster-saturation': -0.15 }, 19);

const HE_NAME = ['coalesce', ['get', 'name:he'], ['get', 'name'], ['get', 'name_en']];
const cache = new Map<BaseKey, StyleSpecification>();

async function fetchJson(url: string, ms: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function loadBaseStyle(key: BaseKey): Promise<{ style: StyleSpecification; fellBack: boolean }> {
  if (key === 'sat') return { style: SAT_STYLE, fellBack: false };
  if (key === 'plain') return { style: PLAIN_STYLE, fellBack: false };
  const hit = cache.get(key);
  if (hit) return { style: hit, fellBack: false };
  try {
    const s = (await fetchJson('https://tiles.openfreemap.org/styles/positron', 7000)) as StyleSpecification;
    for (const l of s.layers) {
      const layout = (l as { layout?: Record<string, unknown> }).layout;
      if (layout && 'text-field' in layout && JSON.stringify(layout['text-field']).includes('name')) layout['text-field'] = HE_NAME;
    }
    for (const src of Object.values(s.sources)) {
      const v = src as { type: string; attribution?: string };
      if (v.type === 'vector' && !v.attribution) v.attribution = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap contributors';
    }
    cache.set(key, s);
    return { style: s, fellBack: false };
  } catch {
    return { style: PLAIN_STYLE, fellBack: true };
  }
}
