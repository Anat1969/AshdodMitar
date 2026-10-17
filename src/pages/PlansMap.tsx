// Map (simple flow, page 2): every plan as its blue line (status by line style, never by colour); a searchable list.
// A plan opens in the in-page panel.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../lib/store';
import { EMPTY_STYLE, loadBaseStyle } from '../lib/basemaps';
import { bboxOfFC, BLUE_LINE, planKey, STATUS_GROUP_LABEL, statusGroup, type StatusGroup } from '../lib/plansapi';
import { usePeek } from '../lib/peek';
import { Loading, Page } from '../components/ui';

const GROUPS: StatusGroup[] = ['approved', 'process', 'prep'];

export default function PlansMapPage() {
  const { plans, features, loading, error } = useStore();
  const { open, kind, key } = usePeek();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const openRef = useRef(open); openRef.current = open;
  const [ready, setReady] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const real = useMemo(() => plans.filter((p) => !p.is_example && p.boundary), [plans]);
  const shown = useMemo(() => {
    const s = q.trim();
    return real.filter((p) => !s || [p.plan_number, p.mavat_number, p.name, p.quarter].some((x) => (x ?? '').includes(s)));
  }, [real, q]);
  const noGeom = plans.filter((p) => !p.is_example && !p.boundary);

  const fc = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: shown.map((p) => ({ type: 'Feature', geometry: p.boundary!, properties: { key: planKey(p), group: statusGroup(p.status), hover: hover === p.id || (kind === 'plan' && key === planKey(p)) ? 1 : 0, id: p.id } })),
  }), [shown, hover, kind, key]);

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: EMPTY_STYLE, center: [34.655, 31.795], zoom: 11.8, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.on('style.load', () => {
      if (!map.getSource('plans')) {
        map.addSource('city', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('plans', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'city', type: 'line', source: 'city', paint: { 'line-color': '#15181d', 'line-width': 2 } });
        map.addLayer({ id: 'plans-fill', type: 'fill', source: 'plans', paint: { 'fill-color': BLUE_LINE, 'fill-opacity': ['case', ['==', ['get', 'hover'], 1], 0.22, 0.06] } });
        // line-dasharray cannot vary per feature in MapLibre 4: one layer per status, the same blue
        const width = ['case', ['==', ['get', 'hover'], 1], 4.5, 3] as never;
        map.addLayer({ id: 'plans-line', type: 'line', source: 'plans', filter: ['==', ['get', 'group'], 'approved'], paint: { 'line-color': BLUE_LINE, 'line-width': width } });
        map.addLayer({ id: 'plans-line-process', type: 'line', source: 'plans', filter: ['==', ['get', 'group'], 'process'], paint: { 'line-color': BLUE_LINE, 'line-width': width, 'line-dasharray': [3, 1.5] } });
        map.addLayer({ id: 'plans-line-prep', type: 'line', source: 'plans', filter: ['!', ['in', ['get', 'group'], ['literal', ['approved', 'process']]]], paint: { 'line-color': BLUE_LINE, 'line-width': width, 'line-dasharray': [1, 1.5] } });
      }
      setReady((n) => n + 1);
    });
    map.on('click', 'plans-fill', (e) => { const k = e.features?.[0]?.properties?.key; if (k) openRef.current('plan', k); });
    map.on('mouseenter', 'plans-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'plans-fill', () => (map.getCanvas().style.cursor = ''));
    loadBaseStyle('streets').then(({ style }) => map.setStyle(style, { diff: false }));
    mapRef.current = map;
    (window as unknown as { __plansmap: MLMap }).__plansmap = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !map.getSource('plans')) return;
    (map.getSource('plans') as GeoJSONSource).setData(fc);
    const city = features.find((f) => f.layer === 'city');
    if (city) (map.getSource('city') as GeoJSONSource).setData({ type: 'Feature', geometry: city.geom, properties: {} });
  }, [fc, features, ready]);

  // a search narrows the map to the plans found
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !q.trim() || !shown.length) return;
    const b = bboxOfFC({ type: 'FeatureCollection', features: shown.map((p) => ({ type: 'Feature', geometry: p.boundary!, properties: {} })) });
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 16, duration: 600 });
  }, [q, shown, ready]);

  if (loading) return <main className="page"><Loading error={error} /></main>;

  return (
    <Page kicker="מפה" title="כל התכניות על המפה">
      <div className="pm-wrap">
        <aside className="pm-list card">
          <label className="pm-search">חיפוש לפי מספר או שם<input className="input" value={q} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.value) n.set('q', e.target.value); else n.delete('q'); setSp(n, { replace: true }); }} placeholder="603-... או שם" aria-label="חיפוש תכנית" /></label>
          <div className="pm-legend">{GROUPS.map((g) => <span key={g} className="lg-item"><span className={`sw-line sw-${g}`} />{STATUS_GROUP_LABEL[g]}</span>)}</div>
          <ul data-testid="plans-list">
            {shown.map((p) => (
              <li key={p.id} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
                <button type="button" className={kind === 'plan' && key === planKey(p) ? 'on' : ''} onClick={() => open('plan', planKey(p))}>
                  <span className="mono">{p.plan_number}</span>
                  <span className="pm-name">{p.name}</span>
                  <span className={`chip status-${statusGroup(p.status)}`}>{STATUS_GROUP_LABEL[statusGroup(p.status)]}</span>
                </button>
              </li>
            ))}
          </ul>
          {!shown.length && <div className="notice">{q ? 'לא נמצאה תכנית.' : 'אין עדיין תכניות עם קו כחול.'}</div>}
          {noGeom.length > 0 && <div className="ls">{noGeom.length} תכניות בלי קו כחול לא מוצגות במפה.</div>}
        </aside>
        <div className="pm-map"><div ref={box} className="pmap" data-testid="plans-map" /></div>
      </div>
    </Page>
  );
}
