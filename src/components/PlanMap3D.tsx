// Plan page map: blue line, land use, building lines, buildings to demolish, proposed and existing buildings,
// the proposed-state drawing (תשריט) as an image aligned to the blue line, and a 2D / 3D switch (fill-extrusion by height).
// 3D follows "מה נבנה סביבי": the allowed envelope as light glass, the example volume inside it as a white model cut into
// floors, directional light, building details on click, and an orbit around the plan.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { EMPTY_STYLE, loadBaseStyle } from '../lib/basemaps';
import { sliceFloors, type LayerKind } from '../lib/planlayers';
import { BLUE_LINE } from '../lib/plansapi';

export interface MapLayerData { kind: LayerKind; geojson: GeoJSON.FeatureCollection | null }
export interface Tashrit { url: string; bounds: [number, number, number, number]; opacity: number }
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const SOLID: LayerKind[] = ['demolish', 'proposed', 'existing'];
const KIND_TITLE: Record<string, string> = { envelope: 'מעטפת מותרת (קווי בניין כפול גובה מרבי)', podium: 'קומות בסיס', tower: 'מגדל' };
function infoHtml(layer: string, p: Record<string, unknown>) {
  const rows: string[] = [];
  const title = layer.startsWith('demolish') ? 'מבנה להריסה' : layer.startsWith('existing') ? 'מבנה קיים' : KIND_TITLE[String(p.kind ?? '')] ?? 'נפח מוצע';
  if (p.lot != null) rows.push(`תא שטח ${p.lot}`);
  if (p.floors != null) rows.push(`${p.floors} קומות`);
  const top = Number(p.top ?? p.height); if (top && !p.floor) rows.push(`גובה ${Math.round(top)} מ'`);
  if (p.floors_here != null) rows.push(`${p.floors_here} קומות בנפח`);
  if (p.units != null) rows.push(`${p.units} יח"ד`);
  if (p.yeud) rows.push(String(p.yeud));
  return `<div class="pm-pop"><b>${title}</b>${rows.map((r) => `<div>${r}</div>`).join('')}</div>`;
}

export default function PlanMap3D({ layers, visible, mode, tashrit, bbox, drawing, onDrawPoint, draft, show = { envelope: true, volume: true }, orbit = false }: {
  layers: MapLayerData[]; visible: Set<LayerKind>; mode: '2d' | '3d'; tashrit: Tashrit | null; bbox: [number, number, number, number] | null;
  drawing?: boolean; onDrawPoint?: (p: [number, number]) => void; draft?: number[][];
  show?: { envelope: boolean; volume: boolean }; orbit?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(0);
  const drawRef = useRef(onDrawPoint); drawRef.current = drawing ? onDrawPoint : undefined;

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: EMPTY_STYLE, center: [34.655, 31.795], zoom: 13, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    const add = () => {
      if (map.getSource('blue_line')) { setReady((n) => n + 1); return; }
      map.addSource('tashrit', { type: 'image', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', coordinates: [[0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]] });
      map.addLayer({ id: 'tashrit', type: 'raster', source: 'tashrit', paint: { 'raster-opacity': 0 } });
      for (const k of ['blue_line', 'land_use', 'building_lines', 'demolish', 'proposed', 'existing', 'draft']) map.addSource(k, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'land_use-fill', type: 'fill', source: 'land_use', paint: { 'fill-color': ['coalesce', ['get', 'color'], '#c9b98a'], 'fill-opacity': 0.55 } });
      map.addLayer({ id: 'land_use-line', type: 'line', source: 'land_use', paint: { 'line-color': '#3b3f46', 'line-width': 0.7 } });
      map.addLayer({ id: 'existing-fill', type: 'fill', source: 'existing', paint: { 'fill-color': '#9aa0a8', 'fill-opacity': 0.55 } });
      map.addLayer({ id: 'existing-3d', type: 'fill-extrusion', source: 'existing', paint: { 'fill-extrusion-color': '#c3c7cc', 'fill-extrusion-height': ['coalesce', ['get', 'height'], 9], 'fill-extrusion-base': ['coalesce', ['get', 'base'], 0], 'fill-extrusion-opacity': 0.75 } });
      map.addLayer({ id: 'demolish-fill', type: 'fill', source: 'demolish', paint: { 'fill-color': '#b23a32', 'fill-opacity': 0.45 } });
      map.addLayer({ id: 'demolish-line', type: 'line', source: 'demolish', paint: { 'line-color': '#7a1f1a', 'line-width': 1.4, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'demolish-3d', type: 'fill-extrusion', source: 'demolish', paint: { 'fill-extrusion-color': '#c2554d', 'fill-extrusion-height': ['coalesce', ['get', 'height'], 9], 'fill-extrusion-opacity': 0.55 } });
      // proposed: "envelope" = what may be built (building lines x max height), drawn as a light glass box;
      // "podium" / "tower" (or features without a kind) = the building volume, solid
      const ENV = ['==', ['get', 'kind'], 'envelope'];
      const SOLIDF = ['!=', ['coalesce', ['get', 'kind'], ''], 'envelope'];
      map.addSource('proposed-slabs', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'proposed-fill', type: 'fill', source: 'proposed', filter: SOLIDF as never, paint: { 'fill-color': ['match', ['get', 'kind'], 'podium', '#cfc9bf', '#ebe8e2'], 'fill-opacity': 0.9 } });
      // line-dasharray cannot vary per feature in MapLibre 4: separate layers for dashed and solid outlines
      map.addLayer({ id: 'proposed-line', type: 'line', source: 'proposed', filter: SOLIDF as never, paint: { 'line-color': '#3b3f46', 'line-width': 0.8 } });
      map.addLayer({ id: 'proposed-env-line', type: 'line', source: 'proposed', filter: ENV as never, paint: { 'line-color': '#6b7280', 'line-width': 1.4, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'proposed-env-3d', type: 'fill-extrusion', source: 'proposed', filter: ENV as never, paint: { 'fill-extrusion-color': '#dfe5ea', 'fill-extrusion-height': ['coalesce', ['get', 'height'], 30], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.2 } });
      // the volume as floors: a white model; the podium a shade warmer
      map.addLayer({ id: 'proposed-3d', type: 'fill-extrusion', source: 'proposed-slabs', filter: SOLIDF as never, paint: { 'fill-extrusion-color': ['match', ['get', 'kind'], 'podium', '#d9d3c8', '#f5f3ef'], 'fill-extrusion-height': ['coalesce', ['get', 'height'], 30], 'fill-extrusion-base': ['coalesce', ['get', 'base'], 0], 'fill-extrusion-opacity': 0.96, 'fill-extrusion-vertical-gradient': true } });
      map.setLight({ anchor: 'map', color: '#ffffff', intensity: 0.42, position: [1.4, 210, 35] });
      const BL_COLOR = ['case', ['==', ['get', 'active'], 1], '#7a3fb0', '#c2185b'] as never;
      map.addLayer({ id: 'building_lines', type: 'line', source: 'building_lines', filter: ['!=', ['get', 'under'], 1], paint: { 'line-color': BL_COLOR, 'line-width': 1.6, 'line-dasharray': [4, 2] } });
      map.addLayer({ id: 'building_lines-under', type: 'line', source: 'building_lines', filter: ['==', ['get', 'under'], 1], paint: { 'line-color': BL_COLOR, 'line-width': 1.6, 'line-dasharray': [1, 1.5] } });
      map.addLayer({ id: 'blue_line', type: 'line', source: 'blue_line', paint: { 'line-color': BLUE_LINE, 'line-width': 3.4 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#15181d', 'line-width': 2.2, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#15181d', 'circle-stroke-width': 2 } });
      setReady((n) => n + 1);
    };
    map.on('style.load', add);
    map.on('click', (e) => {
      if (drawRef.current) { drawRef.current([+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)]); return; }
      // building details, like the info card in "מה נבנה סביבי"
      const ids = ['proposed-3d', 'proposed-env-3d', 'demolish-3d', 'existing-3d', 'proposed-fill', 'demolish-fill', 'existing-fill'].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const f = map.queryRenderedFeatures(e.point, { layers: ids })[0];
      if (f) new maplibregl.Popup({ closeButton: false, maxWidth: '240px', className: 'pm-popup' }).setLngLat(e.lngLat).setHTML(infoHtml(f.layer.id, f.properties ?? {})).addTo(map);
    });
    loadBaseStyle('streets').then(({ style }) => map.setStyle(style, { diff: false }));
    mapRef.current = map;
    (window as unknown as { __pmap: MLMap }).__pmap = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // data
  const slabs = useMemo(() => sliceFloors(layers.find((l) => l.kind === 'proposed')?.geojson ?? null), [layers]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !map.getSource('blue_line')) return;
    for (const k of ['blue_line', 'land_use', 'building_lines', 'demolish', 'proposed', 'existing'] as LayerKind[]) {
      (map.getSource(k) as GeoJSONSource).setData(layers.find((l) => l.kind === k)?.geojson ?? EMPTY);
    }
    (map.getSource('proposed-slabs') as GeoJSONSource).setData(slabs);
  }, [layers, slabs, ready]);

  // fit once to the plan
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !bbox || fitted.current) return;
    fitted.current = true;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 0, maxZoom: 17.5 });
  }, [bbox, ready]);

  // visibility and 2D / 3D
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !map.getLayer('blue_line')) return;
    const vis = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('blue_line', visible.has('blue_line'));
    vis('land_use-fill', visible.has('land_use')); vis('land_use-line', visible.has('land_use'));
    vis('building_lines', visible.has('building_lines')); vis('building_lines-under', visible.has('building_lines'));
    for (const k of SOLID) {
      const on = visible.has(k);
      vis(`${k}-3d`, on && mode === '3d' && (k !== 'proposed' || show.volume));
      if (k === 'proposed') vis('proposed-env-3d', on && mode === '3d' && show.envelope);
      vis(`${k}-fill`, on && mode === '2d');
      if (map.getLayer(`${k}-line`)) vis(`${k}-line`, on && mode === '2d');
      if (k === 'proposed') vis('proposed-env-line', on && mode === '2d' && show.envelope);
    }
  }, [visible, mode, ready, show.envelope, show.volume]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready) return;
    map.easeTo({ pitch: mode === '3d' ? 60 : 0, bearing: mode === '3d' ? -20 : 0, duration: 700 });
  }, [mode, ready]);

  // orbit: a slow turn around the plan's centre (3D only)
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !orbit || mode !== '3d') return;
    let raf = 0, last = performance.now();
    const step = (t: number) => { map.setBearing(map.getBearing() + ((t - last) / 1000) * 8); last = t; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [orbit, mode, ready]);

  // the proposed-state drawing, stretched over the blue line's bounding box (approximation)
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !map.getSource('tashrit')) return;
    const on = !!tashrit && visible.has('tashrit');
    if (tashrit) {
      const [w, s, e, n] = tashrit.bounds;
      (map.getSource('tashrit') as ImageSource).updateImage({ url: tashrit.url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    }
    map.setPaintProperty('tashrit', 'raster-opacity', on ? tashrit!.opacity : 0);
  }, [tashrit, visible, ready]);

  // footprint being drawn
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !map.getSource('draft')) return;
    const pts = draft ?? [];
    const feats: GeoJSON.Feature[] = pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
    if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.length > 2 ? [...pts, pts[0]] : pts }, properties: {} });
    (map.getSource('draft') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  }, [draft, drawing, ready]);

  return <div ref={box} className="pmap" data-testid="plan-map" />;
}
