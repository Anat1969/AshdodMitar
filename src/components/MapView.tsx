import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { fmt, PLAN_STATUS_LABEL } from '../lib/data';
import { CertaintyChip, GATE_LABEL, StatusChip } from './ui';
import type { Status } from '../lib/rules';
import { BASEMAPS, EMPTY_STYLE, ensureRtlPlugin, loadBaseStyle, PLAIN_STYLE, type BaseKey } from '../lib/basemaps';
import { plannedFor, TOPICS, type TopicKey } from '../lib/topics';
import { toInput } from '../lib/data';
import { bboxOf } from '../lib/gis';
import { yeudColor, type Lot } from '../lib/mavat';
import { planBoq, type Domain, type Ledger, type Quantity } from '../lib/ledger';

export type LayerKey = 'city' | 'districts' | 'labels' | 'quarters' | 'existing' | 'plans' | 'extrude' | 'transit' | 'official';
interface LayerDef { key: LayerKey; title: string; certainty: string; source: string; available: boolean; note?: string; membersOnly?: boolean }

export const LAYERS: LayerDef[] = [
  { key: 'city', title: 'גבול השיפוט', certainty: 'osm', source: 'OpenStreetMap, relation 1380013', available: true },
  { key: 'quarters', title: 'רובעים', certainty: 'municipal', source: 'גבולות רובעים מה-GIS העירוני של אשדוד (רובע ז׳ מ-OpenStreetMap). השמות מוצגים בזום קרוב', available: true },
  { key: 'districts', title: 'מתחמי התכנית', certainty: 'assumption', source: 'איחוד רובעים רשמיים לפי שיוך שנבדק מול שטחי המתחמים בתכנית. לא מנספח המתחמים', available: true },
  { key: 'labels', title: 'שמות ומצב המתחמים', certainty: 'plan-draft', source: 'הוראות תכנית 603-0528026, פרק 4.3', available: true },
  { key: 'existing', title: 'קיים: לפי הנושא שנבחר', certainty: 'municipal', source: 'חינוך: GIS עירוני. גנים, מבנים, מסחר, מבני ציבור וכבישים: OpenStreetMap דרך OpenFreeMap', available: true },
  { key: 'plans', title: 'מתוכנן: תכניות בתאום', certainty: 'assumption', source: 'גודל העיגול לפי מה שהתכנית מוסיפה בנושא שנבחר. תכניות הדוגמה בדויות', available: true, membersOnly: true },
  { key: 'extrude', title: 'עמודות יעד אוכלוסייה', certainty: 'plan-draft', source: 'יעד אוכלוסייה למתחם, תכנית 603-0528026', available: true },
  { key: 'transit', title: 'ציר מתע"ן ואזורי חניה', certainty: 'missing', source: 'חסר: תוואי מתע"ן עדכני', available: false, note: 'כשיוזן תוואי, יוצגו אזורי חניה א ו-ב (300 ו-600 מ\')' },
  { key: 'official', title: 'גבולות מתחמים רשמיים', certainty: 'missing', source: 'חסר: נספח מתחמים כ-GeoJSON', available: false, note: 'יחליף את הגבול הסכמטי כשיסופק' },
];
const DEFAULT_LAYERS: LayerKey[] = ['city', 'quarters', 'districts', 'labels', 'existing', 'plans'];

export type Theme = 'progress' | 'gate' | 'target';
const THEMES: { key: Theme; title: string }[] = [
  { key: 'progress', title: 'התקדמות ליעד' }, { key: 'gate', title: 'סף 6.3' }, { key: 'target', title: 'יעד אוכלוסייה' },
];
const PROGRESS_STEPS: { max: number; color: string; label: string }[] = [
  { max: 0.25, color: '#efe6e4', label: 'עד 25%' }, { max: 0.5, color: '#dcc3bd', label: '25% עד 50%' },
  { max: 0.75, color: '#c9a99f', label: '50% עד 75%' }, { max: 1, color: '#a98a7f', label: '75% עד 100%' }, { max: Infinity, color: '#4f7a63', label: 'יעד הושג' },
];
const progressColor = (p: number | null) => (p == null ? '#c4c8ce' : PROGRESS_STEPS.find((s) => p < s.max)!.color);
const pct = (p: number | null) => (p == null ? 'חסר' : `${Math.round(p * 100)}%`);
export const GATE_COLOR: Record<Status, string> = { pass: '#4f7a63', warn: '#b7832a', fail: '#a43c39', info: '#7d8590', missing: '#8e959e' };
const RAMP = ['#e9ebee', '#c9cdd3', '#9ea4ad', '#6e7581', '#3f4550'];

function rampColor(v: number | null, max: number) {
  if (v == null || !max) return '#d9dce0';
  return RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 0.001)))];
}

function hatch(): ImageData {
  const s = 12; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const g = c.getContext('2d')!; g.fillStyle = 'rgba(142,149,158,0.22)'; g.fillRect(0, 0, s, s);
  g.strokeStyle = 'rgba(70,76,86,0.55)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, -s / 2); g.moveTo(s / 2, s * 1.5); g.lineTo(s * 1.5, s / 2); g.stroke();
  return g.getImageData(0, 0, s, s);
}

export default function MapView({ full = false, focus }: { full?: boolean; focus?: number }) {
  const { districts, features, plans, gates, existing, matrix, quantities, domains, ledger } = useStore();
  const { isMember } = useAuth();
  const [params, setParams] = useSearchParams();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const flown = useRef<number | null>(null);
  const styleOk = useRef(false);
  const [styleRev, setStyleRev] = useState(0);
  const loaded = styleRev > 0;
  const [baseNote, setBaseNote] = useState<string | null>(null);
  const debug = params.get('debug') === '1';
  const [mapErrors, setMapErrors] = useState<string[]>([]);
  const [panel, setPanel] = useState(() => full && window.innerWidth > 720);

  const active = useMemo(() => new Set((params.get('layers')?.split(',').filter(Boolean) as LayerKey[]) ?? DEFAULT_LAYERS), [params]);
  const theme = (params.get('theme') as Theme) || 'progress';
  const topic = ((params.get('topic') as TopicKey) || 'education') as TopicKey;
  const topicList = domains.length ? domains.map((d) => ({ key: d.key, title: d.title, unit: d.unit, targetRule: d.target_rule ?? '' })) : TOPICS;
  const topicDef = topicList.find((t) => t.key === topic) ?? topicList[1] ?? TOPICS[1];
  const [zoomLow, setZoomLow] = useState(true);
  const base = ((params.get('base') as BaseKey) || 'streets') as BaseKey;
  const sat = base === 'sat';
  const selected = focus ?? (params.get('d') ? Number(params.get('d')) : null);

  // selected plan lives in the address (?plan=), so "העתקת קישור" shares it
  const planSel = params.get('plan');
  const setPlanSel = (id: string | null) => { setLotSel(null); update('plan', id); };
  const [lotSel, setLotSel] = useState<Lot | null>(null);
  const update = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v == null) n.delete(k); else n.set(k, v);
    setParams(n, { replace: true });
  };
  const toggle = (k: LayerKey) => {
    const s = new Set(active); if (s.has(k)) s.delete(k); else s.add(k);
    update('layers', [...s].join(','));
  };

  const districtFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const maxT = Math.max(...districts.map((d) => d.target_pop ?? 0), 1);
    return {
      type: 'FeatureCollection',
      features: districts.filter((d) => d.geom).map((d) => {
        const st = gates[d.id]?.status ?? 'missing';
        const cell = matrix[d.id]?.[topic];
        const color = theme === 'gate' ? GATE_COLOR[st] : theme === 'target' ? rampColor(d.target_pop, maxT) : progressColor(cell?.progress ?? null);
        const missing = (theme === 'gate' && st === 'missing') || (theme === 'progress' && cell?.progress == null) ? 1 : 0;
        return { type: 'Feature', id: d.id, geometry: d.geom!, properties: { id: d.id, name: d.name, color, missing, h: (d.target_pop ?? 0) / 45 } };
      }),
    };
  }, [districts, gates, theme, matrix, topic]);

  const fc = (layer: string): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: features.filter((f) => f.layer === layer).map((f) => ({ type: 'Feature', geometry: f.geom, properties: { id: f.id, name: f.name } })),
  });

  // what each plan adds in the chosen topic: approved quantities first, drafts when nothing is approved yet
  const planQty = useCallback((pid: string) => {
    const mine = quantities.filter((q) => q.plan_id === pid && q.domain_key === topic && q.value != null);
    const ok = mine.filter((q) => q.status === 'approved');
    return (ok.length ? ok : mine).reduce((a, q) => a + (q.value ?? 0), 0);
  }, [quantities, topic]);
  const planFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const max = Math.max(1, ...plans.map((x) => planQty(x.id) || plannedFor(topic, toInput(x))));
    return {
      type: 'FeatureCollection',
      features: plans.filter((p) => p.location || p.boundary).map((p) => {
        const q = planQty(p.id) || plannedFor(topic, toInput(p));
        const at: GeoJSON.Point = p.location ?? (() => { const b = bboxOf(p.boundary!); return { type: 'Point', coordinates: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] } as GeoJSON.Point; })();
        return { type: 'Feature', geometry: at, properties: { id: p.id, name: p.name, approved: p.status === 'approved' ? 1 : 0, r: q > 0 ? 7 + 15 * Math.sqrt(q / max) : 5 } };
      }),
    };
  }, [plans, topic, planQty]);
  const planAreaFC = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: plans.filter((p) => p.boundary).map((p) => ({ type: 'Feature', geometry: p.boundary!, properties: { id: p.id, approved: p.status === 'approved' ? 1 : 0, sel: p.id === planSel ? 1 : 0 } })),
  }), [plans, planSel]);
  const lotsFC = useMemo<GeoJSON.FeatureCollection>(() => {
    const p = plans.find((x) => x.id === planSel);
    const feats = (p?.lots?.features ?? []).map((f) => ({ ...f, properties: { ...f.properties, color: yeudColor(String(f.properties?.yeud ?? '')), sel: lotSel && f.properties?.lot === lotSel.lot ? 1 : 0 } }));
    return { type: 'FeatureCollection', features: feats };
  }, [plans, planSel, lotSel]);
  const existingFC = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: existing.map((e) => ({ type: 'Feature', geometry: e.geom, properties: { id: e.id, name: e.name, sub: e.subtype, school: e.subtype === 'בית ספר' ? 1 : 0, kinder: (e.subtype ?? '').startsWith('גן') ? 1 : 0, classes: e.qty?.classes ?? 1 } })),
  }), [existing]);

  // create map once; the overlay is re-added after every style change (background switch)
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current, style: EMPTY_STYLE,
      center: [34.655, 31.795], zoom: 11.6, pitch: 0, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const addOverlay = () => {
      if (!map.hasImage('hatch')) map.addImage('hatch', hatch());
      if (!map.getSource('districts')) {
        const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
        for (const s of ['city', 'districts', 'quarters', 'existing', 'plans', 'plan-areas', 'plan-lots']) map.addSource(s, { type: 'geojson', data: empty });
        map.addSource('ofm', { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: 'OpenFreeMap © OpenMapTiles © OpenStreetMap contributors' });
        // existing, by topic, from OpenStreetMap vector tiles (real geometry, aligned with the map by definition)
        map.addLayer({ id: 'ex-parks', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['match', ['get', 'subclass'], ['park', 'garden', 'recreation_ground', 'playground', 'village_green', 'grass'], true, false], paint: { 'fill-color': '#5f9b6e', 'fill-opacity': 0.55 }, layout: { visibility: 'none' } });
        map.addLayer({ id: 'ex-buildings', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 12, paint: { 'fill-color': '#6e7581', 'fill-opacity': 0.55 }, layout: { visibility: 'none' } });
        map.addLayer({ id: 'ex-roads', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false], paint: { 'line-color': '#b7832a', 'line-width': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 3, ['secondary', 'tertiary'], 2, 1] }, layout: { visibility: 'none' } });
        map.addLayer({ id: 'ex-shops', type: 'circle', source: 'ofm', 'source-layer': 'poi', filter: ['match', ['get', 'class'], ['shop', 'grocery', 'clothing_store', 'bakery', 'alcohol_shop', 'butcher', 'car', 'furniture', 'hardware', 'jewelry', 'mobile_phone', 'optician', 'pet', 'sports', 'stationery', 'toys', 'ice_cream', 'cafe', 'restaurant', 'fast_food', 'bar', 'convenience', 'department_store', 'shoes', 'books', 'florist', 'gift', 'laundry', 'hairdresser'], true, false], paint: { 'circle-radius': 3.2, 'circle-color': '#8a5f12', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }, layout: { visibility: 'none' } });
        map.addLayer({ id: 'ex-public', type: 'circle', source: 'ofm', 'source-layer': 'poi', filter: ['match', ['get', 'class'], ['town_hall', 'police', 'fire_station', 'library', 'place_of_worship', 'hospital', 'doctors', 'post', 'community', 'theatre', 'museum', 'courthouse', 'embassy', 'pharmacy', 'swimming', 'stadium', 'sports_centre'], true, false], paint: { 'circle-radius': 4.5, 'circle-color': '#3f4550', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 }, layout: { visibility: 'none' } });
        map.addLayer({ id: 'districts-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.3 } });
        map.addLayer({ id: 'districts-hatch', type: 'fill', source: 'districts', filter: ['==', ['get', 'missing'], 1], paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.55 } });
        map.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': '#2b3038', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3.4, 1.6] } });
        map.addLayer({ id: 'extrude', type: 'fill-extrusion', source: 'districts', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.78 } });
        map.addLayer({ id: 'quarters-line', type: 'line', source: 'quarters', paint: { 'line-color': '#5d646f', 'line-width': 1, 'line-dasharray': [3, 2] } });
        map.addLayer({ id: 'ex-edu', type: 'circle', source: 'existing', paint: { 'circle-radius': ['case', ['==', ['get', 'school'], 1], ['interpolate', ['linear'], ['get', 'classes'], 1, 4, 40, 11], 3], 'circle-color': ['case', ['==', ['get', 'school'], 1], '#2b3038', '#ffffff'], 'circle-stroke-color': '#2b3038', 'circle-stroke-width': 1.3 }, layout: { visibility: 'none' } });
        map.addLayer({ id: 'city-line', type: 'line', source: 'city', paint: { 'line-color': '#15181d', 'line-width': 2.6 } });
        map.addLayer({ id: 'plan-areas-fill', type: 'fill', source: 'plan-areas', paint: { 'fill-color': ['case', ['==', ['get', 'approved'], 1], '#4f7a63', '#b7832a'], 'fill-opacity': 0.32 } });
        map.addLayer({ id: 'plan-areas-line', type: 'line', source: 'plan-areas', paint: { 'line-color': ['case', ['==', ['get', 'approved'], 1], '#1f3b2c', '#8a5f12'], 'line-width': 2 } });
        map.addLayer({ id: 'plan-lots-fill', type: 'fill', source: 'plan-lots', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.72 } });
        map.addLayer({ id: 'plan-lots-line', type: 'line', source: 'plan-lots', paint: { 'line-color': '#15181d', 'line-width': ['case', ['==', ['get', 'sel'], 1], 3, 0.8] } });
        map.addLayer({ id: 'plan-sel-line', type: 'line', source: 'plan-areas', filter: ['==', ['get', 'sel'], 1], paint: { 'line-color': '#15181d', 'line-width': 3.4 } });
        map.addLayer({ id: 'plans', type: 'circle', source: 'plans', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['case', ['==', ['get', 'approved'], 1], 'rgba(79,122,99,0.75)', 'rgba(183,131,42,0.55)'], 'circle-stroke-color': '#15181d', 'circle-stroke-width': 2 } });
      }
      styleOk.current = true;
      setStyleRev((r) => r + 1);
    };
    map.on('click', 'districts-fill', (e) => { const id = e.features?.[0]?.properties?.id; if (id) clickDistrict.current(Number(id)); });
    map.on('click', 'plans', (e) => { const id = e.features?.[0]?.properties?.id; if (id) clickPlan.current(String(id)); });
    map.on('click', 'plan-areas-fill', (e) => { const id = e.features?.[0]?.properties?.id; if (id) clickPlan.current(String(id)); });
    map.on('click', 'plan-lots-fill', (e) => { const p = e.features?.[0]?.properties; if (p) clickLot.current({ lot: String(p.lot), yeud: String(p.yeud), areaM2: p.areaM2 == null ? null : Number(p.areaM2), rights: typeof p.rights === 'string' ? JSON.parse(p.rights) : (p.rights ?? []) }); });
    for (const l of ['districts-fill', 'plans', 'plan-areas-fill', 'plan-lots-fill']) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
    }
    map.on('zoom', () => setZoomLow(map.getZoom() < 13.2));
    map.on('error', (e) => setMapErrors((x) => (x.length > 12 ? x : [...x, String((e as { error?: { message?: string } }).error?.message ?? e)])));
    map.on('style.load', addOverlay);
    if (map.isStyleLoaded()) addOverlay();
    mapRef.current = map;
    (window as unknown as { __map: MLMap }).__map = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // background map
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    let live = true;
    loadBaseStyle(base).then(({ style, fellBack }) => {
      if (!live || mapRef.current !== map) return;
      setBaseNote(fellBack ? 'מפת הרחובות לא זמינה כרגע. מוצג רקע שקט.' : null);
      styleOk.current = false;
      const errs: string[] = [];
      const onErr = (e: { error?: { message?: string } }) => { if (errs.length < 3) errs.push(e.error?.message ?? 'שגיאה'); };
      map.on('error', onErr);
      map.setStyle(style, { diff: false });
      // safety net: if the chosen background does not load, fall back to the quiet background and say why
      const t = window.setTimeout(() => {
        map.off('error', onErr);
        if (!live || mapRef.current !== map || styleOk.current || style === PLAIN_STYLE) return;
        setBaseNote(`הרקע "${BASEMAPS.find((b) => b.key === base)?.title}" לא נטען${errs.length ? ` (${errs[0]})` : ''}. מוצג רקע שקט.`);
        styleOk.current = false;
        map.setStyle(PLAIN_STYLE, { diff: false });
      }, 9000);
      // Hebrew shaping plugin only after the style has loaded, so it can never hold the map back
      map.once('style.load', () => { window.clearTimeout(t); map.off('error', onErr); if (base === 'streets') map.once('idle', () => ensureRtlPlugin()); });
    });
    return () => { live = false; };
  }, [base]);

  const clickDistrict = useRef<(id: number) => void>(() => {});
  const clickPlan = useRef<(id: string) => void>(() => {});
  const clickLot = useRef<(l: Lot) => void>(() => {});
  clickLot.current = (l) => setLotSel(l);
  clickDistrict.current = (id) => { if (focus == null) update('d', String(id)); };
  clickPlan.current = (id) => setPlanSel(id);

  // data
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded || !styleOk.current) return;
    (map.getSource('districts') as GeoJSONSource).setData(districtFC);
    (map.getSource('city') as GeoJSONSource).setData(fc('city'));
    (map.getSource('quarters') as GeoJSONSource).setData(fc('quarters_official'));
    (map.getSource('existing') as GeoJSONSource).setData(existingFC);
    (map.getSource('plans') as GeoJSONSource).setData(planFC);
    (map.getSource('plan-areas') as GeoJSONSource | undefined)?.setData(planAreaFC);
    (map.getSource('plan-lots') as GeoJSONSource | undefined)?.setData(lotsFC);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleRev, districtFC, planFC, features, existingFC, planAreaFC, lotsFC]);

  // fly to the selected plan once per selection
  const flownPlan = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded) return;
    const p = plans.find((x) => x.id === planSel);
    if (!p?.boundary || flownPlan.current === p.id) return;
    flownPlan.current = p.id;
    const b = bboxOf(p.boundary);
    // the plan card sits on the left of a wide map: keep the plan in the free part
    const wide = (box.current?.clientWidth ?? 0) > 900;
    if (wide) setPanel(false);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: wide ? { top: 90, bottom: 40, left: 450, right: 60 } : 50, maxZoom: 17, duration: 900 });
  }, [planSel, plans, loaded]);

  // visibility
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded || !styleOk.current) return;
    const vis = (on: boolean) => (on ? 'visible' : 'none');
    map.setLayoutProperty('city-line', 'visibility', vis(active.has('city')));
    for (const l of ['districts-fill', 'districts-hatch', 'districts-line']) map.setLayoutProperty(l, 'visibility', vis(active.has('districts')));
    map.setLayoutProperty('quarters-line', 'visibility', vis(active.has('quarters')));
    const ex = active.has('existing');
    map.setLayoutProperty('ex-edu', 'visibility', vis(ex && (topic === 'education' || topic === 'kinder')));
    if (ex && topic === 'kinder') map.setFilter('ex-edu', ['==', ['get', 'kinder'], 1]);
    else if (ex && topic === 'education') map.setFilter('ex-edu', ['==', ['get', 'school'], 1]);
    map.setLayoutProperty('ex-parks', 'visibility', vis(ex && topic === 'openspace'));
    map.setLayoutProperty('ex-buildings', 'visibility', vis(ex && topic === 'housing'));
    map.setLayoutProperty('ex-roads', 'visibility', vis(ex && topic === 'roads'));
    map.setLayoutProperty('ex-shops', 'visibility', vis(ex && topic === 'commerce'));
    map.setLayoutProperty('ex-public', 'visibility', vis(ex && topic === 'public'));
    map.setLayoutProperty('plans', 'visibility', vis(active.has('plans') && isMember));
    for (const l of ['plan-areas-fill', 'plan-areas-line', 'plan-sel-line', 'plan-lots-fill', 'plan-lots-line']) map.setLayoutProperty(l, 'visibility', vis(active.has('plans') && isMember));
    map.setLayoutProperty('extrude', 'visibility', vis(active.has('extrude')));
    map.setPaintProperty('districts-line', 'line-color', sat ? '#ffffff' : '#2b3038');
    map.setPaintProperty('city-line', 'line-color', sat ? '#ffe9a8' : '#15181d');
    map.setPaintProperty('quarters-line', 'line-color', sat ? '#e6e9ec' : '#5d646f');
    map.setPaintProperty('districts-fill', 'fill-opacity', sat ? 0.22 : 0.3);
    if (active.has('extrude') && map.getPitch() < 30) map.easeTo({ pitch: 55, bearing: -18, duration: 900 });
    if (!active.has('extrude') && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }, [active, styleRev, isMember, sat, topic]);

  // selection highlight + fly
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded || !styleOk.current) return;
    for (const d of districts) if (d.geom) map.setFeatureState({ source: 'districts', id: d.id }, { sel: d.id === selected });
    const d = districts.find((x) => x.id === selected);
    if (d?.geom && flown.current !== selected) {
      flown.current = selected;
      const b = new maplibregl.LngLatBounds();
      const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') b.extend(c as [number, number]); else (c as unknown[]).forEach(walk); };
      walk((d.geom as GeoJSON.Polygon).coordinates);
      map.fitBounds(b, { padding: full ? 120 : 50, duration: 900, maxZoom: 14 });
    }
  }, [selected, styleRev, districts, full]);

  // HTML labels (no glyph server needed)
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded || !styleOk.current) return;
    markers.current.forEach((m) => m.remove()); markers.current = [];
    if (!active.has('labels')) return;
    for (const d of districts) {
      if (!d.geom) continue;
      const b = new maplibregl.LngLatBounds();
      const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') b.extend(c as [number, number]); else (c as unknown[]).forEach(walk); };
      walk((d.geom as GeoJSON.Polygon).coordinates);
      const st = gates[d.id]?.status ?? 'missing';
      const cell = matrix[d.id]?.[topic];
      const at = (d.label_pt?.coordinates as [number, number] | undefined) ?? b.getCenter().toArray() as [number, number];
      const el = document.createElement('button');
      el.className = `map-label st-${theme === 'progress' ? (cell?.progress == null ? 'missing' : cell.progress >= 1 ? 'pass' : 'info') : st}`; el.type = 'button';
      el.setAttribute('data-district', String(d.id));
      const status = theme === 'progress' ? `${topicDef.title}: ${pct(cell?.progress ?? null)}` : GATE_LABEL[st];
      el.innerHTML = `<span class="n mono">${d.id}</span><span class="t">${d.name}</span><span class="s">${status}</span>`;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); clickDistrict.current(d.id); });
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map));
    }
  }, [districts, gates, active, loaded, matrix, topic, theme, topicDef.title]);

  // quarter names at close zoom
  const qMarkers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded) return;
    qMarkers.current.forEach((m) => m.remove()); qMarkers.current = [];
    if (!active.has('quarters') || zoomLow) return;
    for (const f of features.filter((x) => x.layer === 'quarters_official' && x.name)) {
      const b = new maplibregl.LngLatBounds();
      const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') b.extend(c as [number, number]); else (c as unknown[]).forEach(walk); };
      walk((f.geom as GeoJSON.Polygon).coordinates);
      const el = document.createElement('span'); el.className = 'q-label'; el.textContent = f.name;
      const at = ((f.props as { label?: [number, number] }).label) ?? b.getCenter().toArray() as [number, number];
      qMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map));
    }
  }, [features, active, loaded, zoomLow]);

  const sel = districts.find((d) => d.id === selected) ?? null;
  const selPlan = plans.find((p) => p.id === planSel) ?? null;
  const missingGeom = districts.filter((d) => !d.geom);

  return (
    <div className={`mapwrap ${full ? 'full' : ''} ${zoomLow ? 'z-low' : 'z-high'}`}>
      <div ref={box} className="map" data-testid="map" />
      {debug && <div className="map-debug mono" data-testid="map-debug">{`styleOk=${styleOk.current} rev=${styleRev} base=${base} errors=${mapErrors.length}`}{mapErrors.map((m, i) => <div key={i}>{m}</div>)}</div>}
      <div className="map-side">
        <div className="map-tools">
          <button type="button" className={`btn small ${panel ? 'on' : ''}`} onClick={() => setPanel(!panel)} aria-expanded={panel}>שכבות</button>
          <div className="seg" role="tablist" aria-label="מפת רקע">
            {BASEMAPS.map((b) => (
              <button key={b.key} type="button" role="tab" aria-selected={base === b.key} className={base === b.key ? 'on' : ''} data-base={b.key} onClick={() => update('base', b.key)}>{b.title}</button>
            ))}
          </div>
          {isMember && plans.length > 0 && (
            <label className="topic-pick">
              <span>תכנית</span>
              <select className="input" aria-label="בחירת תכנית" value={planSel ?? ''} onChange={(e) => setPlanSel(e.target.value || null)}>
                <option value="">ללא</option>
                {plans.filter((p) => p.status !== 'rejected').map((p) => <option key={p.id} value={p.id}>{p.plan_number ? `${p.plan_number}: ` : ''}{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="topic-pick">
            <span>נושא</span>
            <select className="input" aria-label="נושא" value={topic} onChange={(e) => update('topic', e.target.value)}>
              {topicList.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
            </select>
          </label>
          <div className="seg" role="tablist" aria-label="צביעת המתחמים">
            {THEMES.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={theme === t.key} className={theme === t.key ? 'on' : ''} onClick={() => update('theme', t.key)}>{t.title}</button>
            ))}
          </div>
        </div>
        <AnimatePresence>
          {panel && (
            <motion.aside className="layer-panel" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <h3>שכבות</h3>
              <div className="ls">רקע: {BASEMAPS.find((b) => b.key === base)?.source}. ללא מפתח API.</div>
              {baseNote && <div className="notice">{baseNote}</div>}
              <ul>
                {LAYERS.map((l) => {
                  const locked = l.membersOnly && !isMember;
                  return (
                    <li key={l.key} className={!l.available || locked ? 'off' : ''}>
                      <label>
                        <input type="checkbox" data-layer={l.key} disabled={!l.available || locked} checked={l.available && !locked && active.has(l.key)} onChange={() => toggle(l.key)} />
                        <span className="lt">{l.title}</span>
                        <CertaintyChip certainty={l.certainty} />
                      </label>
                      <div className="ls">{locked ? 'לחברי הצוות בלבד, אחרי כניסה' : l.source}</div>
                      {l.note && <div className="ls">{l.note}</div>}
                    </li>
                  );
                })}
              </ul>
              <Legend theme={theme} topicTitle={topicDef.title} />
              <div className="ls">{theme === 'progress' && `יעד ${topicDef.title}: ${topicDef.targetRule}.`} קיים ועוד תכניות מאושרות, חלקי היעד. כל נתון שמאושר בתיק תכנית מעדכן את הצביעה.</div>
              {missingGeom.length > 0 && <div className="ls">בלי גבול על המפה: {missingGeom.map((d) => `${d.id} ${d.name}`).join(', ')} (חסר)</div>}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {sel && focus == null && (
          <motion.div className="map-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} key={sel.id}>
            <div className="mc-head"><span className="mono">מתחם {sel.id}</span><button type="button" className="btn ghost small" onClick={() => update('d', null)}>סגירה</button></div>
            <h3>{sel.name}</h3>
            <dl className="kv">
              <dt>יעד אוכלוסייה</dt><dd className="mono">{fmt(sel.target_pop)}</dd>
              <dt>אוכלוסייה קיימת</dt><dd className="mono">{fmt(sel.existing_pop)}</dd>
              <dt>תוספת יח"ד</dt><dd className="mono">{fmt(sel.units_added)}</dd>
              <dt>סף 6.3</dt><dd><StatusChip status={gates[sel.id]?.status ?? 'missing'} gate /></dd>
            </dl>
            {matrix[sel.id]?.[topic] && (
              <dl className="kv topic-kv" data-testid="topic-cell">
                <dt><b>{topicDef.title}</b></dt><dd className="ls">{topicDef.unit}</dd>
                <dt>קיים</dt><dd className="mono">{fmt(matrix[sel.id][topic].existing)}</dd>
                <dt>תכניות מאושרות</dt><dd className="mono">{isMember ? fmt(matrix[sel.id][topic].approved) : 'לצוות'}</dd>
                <dt>בהליך, תרחיש</dt><dd className="mono">{isMember ? fmt(matrix[sel.id][topic].planned - matrix[sel.id][topic].approved) : 'לצוות'}</dd>
                <dt>יעד</dt><dd className="mono">{fmt(matrix[sel.id][topic].target)}</dd>
                <dt>יתרה</dt><dd className="mono">{fmt(matrix[sel.id][topic].gap)}</dd>
                <dt>התקדמות</dt><dd className="mono">{pct(matrix[sel.id][topic].progress)}</dd>
              </dl>
            )}
            <Link className="btn primary" to={`/district/${sel.id}`}>לדף המתחם</Link>
          </motion.div>
        )}
        {selPlan && (
          <motion.div className="map-card plan-card" data-testid="map-plan-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} key={selPlan.id}>
            <div className="mc-head"><span className="mono">{selPlan.plan_number ?? 'תכנית'}</span><button type="button" className="btn ghost small" onClick={() => setPlanSel(null)}>סגירה</button></div>
            <h3>{selPlan.name}</h3>
            <dl className="kv"><dt>סטטוס</dt><dd>{PLAN_STATUS_LABEL[selPlan.status]}</dd><dt>תאריך אישור</dt><dd className="mono">{selPlan.approval_date ? selPlan.approval_date.split('-').reverse().join('.') : 'חסר'}</dd></dl>
            <PlanBoqCard planId={selPlan.id} quantities={quantities} ledger={ledger} domains={domains} />
            {selPlan.lots?.features?.length ? (
              <div className="lot-legend">
                <h4 className="sub">תאי שטח במפה</h4>
                <div className="yeud-legend">{Array.from(new Set(selPlan.lots.features.map((f) => String(f.properties?.yeud ?? '')))).map((y) => <span key={y} className="lg-item"><span className="sw" style={{ background: yeudColor(y) }} />{y}</span>)}</div>
                {lotSel ? (
                  <div className="lot-info" data-testid="lot-info">
                    <b>תא שטח {lotSel.lot}</b> <span className="ls">{lotSel.yeud}, {fmt(lotSel.areaM2)} מ"ר</span>
                    {lotSel.rights.length ? <table className="table mini"><thead><tr><th>שימוש</th><th>שטח בנוי</th><th>יח"ד</th><th>קומות</th></tr></thead>
                      <tbody>{lotSel.rights.map((r, i) => <tr key={i}><td>{r.use || lotSel.yeud}</td><td className="mono">{fmt(r.builtM2)}</td><td className="mono">{r.units ? fmt(r.units) : ''}</td><td className="mono">{r.floors ?? ''}</td></tr>)}</tbody></table>
                      : <div className="ls">אין זכויות בנייה לתא הזה בטבלה 5.</div>}
                  </div>
                ) : <div className="ls">לחיצה על תא שטח מציגה את הזכויות שלו.</div>}
              </div>
            ) : null}
            {selPlan.is_example && <div className="ls">תכנית דוגמה בדויה. המיקום הוא מרכז המתחם, לא מיקום אמיתי.</div>}
            <Link className="btn primary" to={`/plans/${selPlan.id}`}>לתיק התכנית</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Legend({ theme, topicTitle }: { theme: Theme; topicTitle: string }) {
  if (theme === 'progress') return (
    <div className="legend">
      <div className="lg-title">התקדמות ליעד: {topicTitle}</div>
      {PROGRESS_STEPS.map((s) => <div key={s.label} className="lg-row"><span className="sw" style={{ background: s.color }} /><span>{s.label}</span><span /></div>)}
      <div className="lg-row"><span className="sw sw-missing" style={{ background: '#c4c8ce' }} /><span>חסר</span><span className="mono">אין יעד או נתון</span></div>
    </div>
  );
  if (theme !== 'gate') return (
    <div className="legend">
      <div className="lg-title">יעד אוכלוסייה: בהיר נמוך, כהה גבוה</div>
      <div className="ramp">{RAMP.map((c) => <span key={c} style={{ background: c }} />)}</div>
    </div>
  );
  return (
    <div className="legend">
      <div className="lg-title">סף 6.3: צפי חלקי יעד</div>
      {(['pass', 'warn', 'fail', 'missing'] as Status[]).map((s) => (
        <div key={s} className="lg-row"><span className={`sw sw-${s}`} style={{ background: GATE_COLOR[s] }} /><span>{GATE_LABEL[s]}</span><span className="mono">{s === 'pass' ? 'עד 90%' : s === 'warn' ? '90% עד 100%' : s === 'fail' ? 'מעל 100%' : 'אין אוכלוסייה קיימת'}</span></div>
      ))}
    </div>
  );
}

// Bill of quantities of the selected plan, in text, against the target of each district.
export function PlanBoqCard({ planId, quantities, ledger, domains }: { planId: string; quantities: Quantity[]; ledger: Ledger; domains: Domain[] }) {
  const rows = planBoq(planId, quantities, ledger);
  if (!rows.length) return <div className="ls">אין עדיין כמויות לתכנית.</div>;
  const pctT = (p: number | null) => (p == null ? 'חסר' : `${Math.round(p * 1000) / 10}%`);
  return (
    <div className="table-wrap">
      <table className="table mini" data-testid="map-plan-boq">
        <thead><tr><th>תחום</th><th>כמות</th><th>מיעד המתחם</th><th>נתון</th></tr></thead>
        <tbody>{rows.map((r) => {
          const dm = domains.find((d) => d.key === r.domain_key);
          return (
            <tr key={r.q.id} className={r.status === 'draft' ? 'draft' : ''}>
              <td>{dm?.title ?? r.domain_key}{r.district_id ? <span className="ls">, מתחם {r.district_id}</span> : null}</td>
              <td className="mono">{fmt(r.value)} <span className="ls">{dm?.unit}</span></td>
              <td className="mono">{pctT(r.shareOfTarget)}</td>
              <td>{r.status === 'approved' ? 'מאושר' : 'טיוטה'}{r.split === 'area' ? ', הערכה' : ''}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}
