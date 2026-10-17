// Plan boundary map: shows the plan boundary over the districts, and lets an editor draw it by hand.
// Drawing: click to add a vertex, "סיום" closes the polygon. The map container is ltr (MapLibre in an RTL page).
import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { EMPTY_STYLE, loadBaseStyle } from '../lib/basemaps';
import { bboxOf } from '../lib/gis';
import type { District } from '../lib/data';
import { yeudColor } from '../lib/mavat';

type Boundary = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export default function BoundaryMap({ boundary, lots = null, districts, canDraw, onDrawn }: { boundary: Boundary | null; lots?: GeoJSON.FeatureCollection | null; districts: District[]; canDraw: boolean; onDrawn: (b: Boundary) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ok, setOk] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [pts, setPts] = useState<number[][]>([]);
  const drawingRef = useRef(false);
  drawingRef.current = drawing;

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: EMPTY_STYLE, center: [34.655, 31.795], zoom: 11.6, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    const add = () => {
      if (map.getSource('districts')) return;
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      for (const s of ['districts', 'lots', 'plan', 'draft']) map.addSource(s, { type: 'geojson', data: empty });
      map.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': '#2b3038', 'line-width': 1.4, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'lots-fill', type: 'fill', source: 'lots', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.75 } });
      map.addLayer({ id: 'lots-line', type: 'line', source: 'lots', paint: { 'line-color': '#15181d', 'line-width': 0.7 } });
      map.addLayer({ id: 'plan-fill', type: 'fill', source: 'plan', paint: { 'fill-color': '#4f7a63', 'fill-opacity': ['case', ['==', ['get', 'hasLots'], 1], 0, 0.35] } });
      map.addLayer({ id: 'plan-line', type: 'line', source: 'plan', paint: { 'line-color': '#1f3b2c', 'line-width': 2.6 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#b7832a', 'line-width': 2.4 } });
      map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#b7832a', 'circle-stroke-width': 2 } });
      setOk((n) => n + 1);
    };
    map.on('style.load', add);
    map.on('click', (e) => { if (drawingRef.current) setPts((p) => [...p, [+e.lngLat.lng.toFixed(7), +e.lngLat.lat.toFixed(7)]]); });
    loadBaseStyle('streets').then(({ style }) => map.setStyle(style, { diff: false }));
    mapRef.current = map;
    (window as unknown as { __bmap: MLMap }).__bmap = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !map.getSource('districts')) return;
    (map.getSource('districts') as GeoJSONSource).setData({ type: 'FeatureCollection', features: districts.filter((d) => d.geom).map((d) => ({ type: 'Feature', geometry: d.geom!, properties: { id: d.id } })) });
    (map.getSource('plan') as GeoJSONSource).setData(boundary ? { type: 'Feature', geometry: boundary, properties: { hasLots: lots?.features.length ? 1 : 0 } } : { type: 'FeatureCollection', features: [] });
    (map.getSource('lots') as GeoJSONSource).setData({ type: 'FeatureCollection', features: (lots?.features ?? []).map((f) => ({ ...f, properties: { ...f.properties, color: yeudColor(String(f.properties?.yeud ?? '')) } })) });
    if (boundary) { const b = bboxOf(boundary); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 50, maxZoom: 16, duration: 0 }); }
  }, [ok, boundary, districts, lots]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !map.getSource('draft')) return;
    const feats: GeoJSON.Feature[] = pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
    if (pts.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: drawing && pts.length > 2 ? [...pts, pts[0]] : pts }, properties: {} });
    (map.getSource('draft') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
  }, [pts, drawing, ok]);

  const finish = () => {
    if (pts.length < 3) return;
    onDrawn({ type: 'Polygon', coordinates: [[...pts, pts[0]]] });
    setDrawing(false); setPts([]);
  };

  return (
    <div className="bmap">
      <div ref={box} className="bmap-canvas" data-testid="boundary-map" />
      {canDraw && (
        <div className="row-actions">
          {!drawing
            ? <button type="button" className="btn" onClick={() => { setDrawing(true); setPts([]); }}>שרטוט גבול ידני</button>
            : <>
              <span className="ls">לחיצה על המפה מוסיפה נקודה. {pts.length} נקודות.</span>
              <button type="button" className="btn primary" disabled={pts.length < 3} onClick={finish}>סיום שרטוט</button>
              <button type="button" className="btn" disabled={!pts.length} onClick={() => setPts((p) => p.slice(0, -1))}>ביטול נקודה אחרונה</button>
              <button type="button" className="btn ghost" onClick={() => { setDrawing(false); setPts([]); }}>ביטול</button>
            </>}
        </div>
      )}
    </div>
  );
}
