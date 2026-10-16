import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { fmt, PLAN_STATUS_LABEL } from '../lib/data';
import { CertaintyChip, GATE_LABEL, StatusChip } from './ui';
import type { Status } from '../lib/rules';
import { BASEMAPS, EMPTY_STYLE, loadBaseStyle, type BaseKey } from '../lib/basemaps';

export type LayerKey = 'city' | 'districts' | 'labels' | 'cells' | 'qpoints' | 'plans' | 'extrude' | 'transit' | 'official';
interface LayerDef { key: LayerKey; title: string; certainty: string; source: string; available: boolean; note?: string; membersOnly?: boolean }

export const LAYERS: LayerDef[] = [
  { key: 'city', title: 'גבול השיפוט', certainty: 'osm', source: 'OpenStreetMap, relation 1380013', available: true },
  { key: 'districts', title: 'מתחמי התכנית', certainty: 'assumption', source: 'גבול סכמטי: איחוד תאי רבעים לפי שיוך משוער למתחם. לא מנספח המתחמים', available: true },
  { key: 'labels', title: 'שמות ומצב המתחמים', certainty: 'plan-draft', source: 'הוראות תכנית 603-0528026, פרק 4.3', available: true },
  { key: 'cells', title: 'תאי רבעים', certainty: 'assumption', source: 'תא וורונוי סביב מרכז הרובע, חתוך לגבול השיפוט', available: true },
  { key: 'qpoints', title: 'מרכזי רבעים', certainty: 'osm', source: 'OpenStreetMap', available: true },
  { key: 'plans', title: 'תכניות בתאום', certainty: 'assumption', source: 'טבלת mt_plans. תכניות הדוגמה בדויות ומוצבות במרכז המתחם', available: true, membersOnly: true },
  { key: 'extrude', title: 'עמודות יעד אוכלוסייה', certainty: 'plan-draft', source: 'יעד אוכלוסייה למתחם, תכנית 603-0528026', available: true },
  { key: 'transit', title: 'ציר מתע"ן ואזורי חניה', certainty: 'missing', source: 'חסר: תוואי מתע"ן עדכני', available: false, note: 'כשיוזן תוואי, יוצגו אזורי חניה א ו-ב (300 ו-600 מ\')' },
  { key: 'official', title: 'גבולות מתחמים רשמיים', certainty: 'missing', source: 'חסר: נספח מתחמים כ-GeoJSON', available: false, note: 'יחליף את הגבול הסכמטי כשיסופק' },
];
const DEFAULT_LAYERS: LayerKey[] = ['city', 'districts', 'labels', 'plans'];

export type Theme = 'gate' | 'target' | 'units';
const THEMES: { key: Theme; title: string }[] = [
  { key: 'gate', title: 'סף 6.3' }, { key: 'target', title: 'יעד אוכלוסייה' }, { key: 'units', title: 'תוספת יח"ד' },
];
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
  const { districts, features, plans, gates } = useStore();
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
  const [panel, setPanel] = useState(() => full && window.innerWidth > 720);

  const active = useMemo(() => new Set((params.get('layers')?.split(',').filter(Boolean) as LayerKey[]) ?? DEFAULT_LAYERS), [params]);
  const theme = (params.get('theme') as Theme) || 'gate';
  const base = ((params.get('base') as BaseKey) || 'streets') as BaseKey;
  const sat = base === 'sat';
  const selected = focus ?? (params.get('d') ? Number(params.get('d')) : null);

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
    const maxU = Math.max(...districts.map((d) => d.units_added ?? 0), 1);
    return {
      type: 'FeatureCollection',
      features: districts.filter((d) => d.geom).map((d) => {
        const st = gates[d.id]?.status ?? 'missing';
        const color = theme === 'gate' ? GATE_COLOR[st] : theme === 'target' ? rampColor(d.target_pop, maxT) : rampColor(d.units_added, maxU);
        return { type: 'Feature', id: d.id, geometry: d.geom!, properties: { id: d.id, name: d.name, color, missing: theme === 'gate' && st === 'missing' ? 1 : 0, h: (d.target_pop ?? 0) / 45 } };
      }),
    };
  }, [districts, gates, theme]);

  const fc = (layer: string): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: features.filter((f) => f.layer === layer).map((f) => ({ type: 'Feature', geometry: f.geom, properties: { id: f.id, name: f.name } })),
  });

  const planFC = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: plans.filter((p) => p.location).map((p) => ({ type: 'Feature', geometry: p.location!, properties: { id: p.id, name: p.name, approved: p.status === 'approved' ? 1 : 0 } })),
  }), [plans]);

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
        for (const s of ['city', 'districts', 'cells', 'qpoints', 'plans']) map.addSource(s, { type: 'geojson', data: empty });
        map.addLayer({ id: 'districts-fill', type: 'fill', source: 'districts', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.3 } });
        map.addLayer({ id: 'districts-hatch', type: 'fill', source: 'districts', filter: ['==', ['get', 'missing'], 1], paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.55 } });
        map.addLayer({ id: 'districts-line', type: 'line', source: 'districts', paint: { 'line-color': '#2b3038', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3.4, 1.6] } });
        map.addLayer({ id: 'extrude', type: 'fill-extrusion', source: 'districts', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.78 } });
        map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': '#5d646f', 'line-width': 0.9, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: 'city-line', type: 'line', source: 'city', paint: { 'line-color': '#15181d', 'line-width': 2.6 } });
        map.addLayer({ id: 'qpoints', type: 'circle', source: 'qpoints', paint: { 'circle-radius': 3.5, 'circle-color': '#fff', 'circle-stroke-color': '#2b3038', 'circle-stroke-width': 1.5 } });
        map.addLayer({ id: 'plans', type: 'circle', source: 'plans', paint: { 'circle-radius': 8, 'circle-color': ['case', ['==', ['get', 'approved'], 1], '#2b3038', '#ffffff'], 'circle-stroke-color': '#2b3038', 'circle-stroke-width': 2.5 } });
      }
      styleOk.current = true;
      setStyleRev((r) => r + 1);
    };
    map.on('click', 'districts-fill', (e) => { const id = e.features?.[0]?.properties?.id; if (id) clickDistrict.current(Number(id)); });
    map.on('click', 'plans', (e) => { const id = e.features?.[0]?.properties?.id; if (id) clickPlan.current(String(id)); });
    for (const l of ['districts-fill', 'plans']) {
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
    }
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
      map.setStyle(style, { diff: false });
    });
    return () => { live = false; };
  }, [base]);

  const clickDistrict = useRef<(id: number) => void>(() => {});
  const clickPlan = useRef<(id: string) => void>(() => {});
  const [planSel, setPlanSel] = useState<string | null>(null);
  clickDistrict.current = (id) => { if (focus == null) update('d', String(id)); setPlanSel(null); };
  clickPlan.current = (id) => setPlanSel(id);

  // data
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded || !styleOk.current) return;
    (map.getSource('districts') as GeoJSONSource).setData(districtFC);
    (map.getSource('city') as GeoJSONSource).setData(fc('city'));
    (map.getSource('cells') as GeoJSONSource).setData(fc('quarter_cells'));
    (map.getSource('qpoints') as GeoJSONSource).setData(fc('quarter_points'));
    (map.getSource('plans') as GeoJSONSource).setData(planFC);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleRev, districtFC, planFC, features]);

  // visibility
  useEffect(() => {
    const map = mapRef.current; if (!map || !loaded || !styleOk.current) return;
    const vis = (on: boolean) => (on ? 'visible' : 'none');
    map.setLayoutProperty('city-line', 'visibility', vis(active.has('city')));
    for (const l of ['districts-fill', 'districts-hatch', 'districts-line']) map.setLayoutProperty(l, 'visibility', vis(active.has('districts')));
    map.setLayoutProperty('cells-line', 'visibility', vis(active.has('cells')));
    map.setLayoutProperty('qpoints', 'visibility', vis(active.has('qpoints')));
    map.setLayoutProperty('plans', 'visibility', vis(active.has('plans') && isMember));
    map.setLayoutProperty('extrude', 'visibility', vis(active.has('extrude')));
    map.setPaintProperty('districts-line', 'line-color', sat ? '#ffffff' : '#2b3038');
    map.setPaintProperty('city-line', 'line-color', sat ? '#ffe9a8' : '#15181d');
    map.setPaintProperty('cells-line', 'line-color', sat ? '#e6e9ec' : '#5d646f');
    map.setPaintProperty('districts-fill', 'fill-opacity', sat ? 0.22 : 0.3);
    if (active.has('extrude') && map.getPitch() < 30) map.easeTo({ pitch: 55, bearing: -18, duration: 900 });
    if (!active.has('extrude') && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }, [active, styleRev, isMember, sat]);

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
      const el = document.createElement('button');
      el.className = `map-label st-${st}`; el.type = 'button';
      el.setAttribute('data-district', String(d.id));
      el.innerHTML = `<span class="n mono">${d.id}</span><span class="t">${d.name}</span><span class="s">${GATE_LABEL[st]}</span>`;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); clickDistrict.current(d.id); });
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(b.getCenter()).addTo(map));
    }
  }, [districts, gates, active, loaded]);

  const sel = districts.find((d) => d.id === selected) ?? null;
  const selPlan = plans.find((p) => p.id === planSel) ?? null;
  const missingGeom = districts.filter((d) => !d.geom);

  return (
    <div className={`mapwrap ${full ? 'full' : ''}`}>
      <div ref={box} className="map" data-testid="map" />
      <div className="map-side">
        <div className="map-tools">
          <button type="button" className={`btn small ${panel ? 'on' : ''}`} onClick={() => setPanel(!panel)} aria-expanded={panel}>שכבות</button>
          <div className="seg" role="tablist" aria-label="מפת רקע">
            {BASEMAPS.map((b) => (
              <button key={b.key} type="button" role="tab" aria-selected={base === b.key} className={base === b.key ? 'on' : ''} data-base={b.key} onClick={() => update('base', b.key)}>{b.title}</button>
            ))}
          </div>
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
              <Legend theme={theme} />
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
            <Link className="btn primary" to={`/district/${sel.id}`}>לדף המתחם</Link>
          </motion.div>
        )}
        {selPlan && (
          <motion.div className="map-card" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} key={selPlan.id}>
            <div className="mc-head"><span className="mono">{selPlan.plan_number ?? 'תכנית'}</span><button type="button" className="btn ghost small" onClick={() => setPlanSel(null)}>סגירה</button></div>
            <h3>{selPlan.name}</h3>
            <dl className="kv"><dt>סטטוס</dt><dd>{PLAN_STATUS_LABEL[selPlan.status]}</dd><dt>תוספת יח"ד</dt><dd className="mono">{fmt(selPlan.units_added)}</dd></dl>
            {selPlan.is_example && <div className="ls">תכנית דוגמה בדויה. המיקום הוא מרכז המתחם, לא מיקום אמיתי.</div>}
            <Link className="btn primary" to={`/plan/${selPlan.id}`}>לבדיקת התכנית</Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Legend({ theme }: { theme: Theme }) {
  if (theme !== 'gate') return (
    <div className="legend">
      <div className="lg-title">{theme === 'target' ? 'יעד אוכלוסייה' : 'תוספת יח"ד'}: בהיר נמוך, כהה גבוה</div>
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
