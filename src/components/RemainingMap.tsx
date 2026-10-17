// What is left after the approved plans, on the map. Two wholes: the district (מתחם, where the master plan sets
// its targets) and the city. Quarters (רובעים) are shown inside their district with the plans they hold; the plan sets
// no target per quarter, so a quarter's "remaining" is its district's. Colour = how much of the target is met.
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../lib/store';
import { fmt } from '../lib/data';
import { cityCell } from '../lib/ledger';
import { EMPTY_STYLE, loadBaseStyle } from '../lib/basemaps';
import { bboxOfFC, fact, planKey, statusGroup } from '../lib/plansapi';
import { shareText, usePeek } from '../lib/peek';
import { inPolygon } from '../lib/planlayers';

export const ramp = (p: number | null) => (p == null ? '#d9dce0' : p >= 1 ? '#3f6b53' : p >= 0.75 ? '#7aa58a' : p >= 0.5 ? '#c9b26a' : p >= 0.25 ? '#d99a5b' : '#c4685a');
const BLUE = '#1d4ed8';

export default function RemainingMap({ domainKey, onDomain }: { domainKey: string; onDomain: (k: string) => void }) {
  const { districts, domains, ledger, plans, features, quantities } = useStore();
  const { open } = usePeek();
  const [unit, setUnit] = useState<'district' | 'quarter'>('district');
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(0);
  const dm = domains.find((d) => d.key === domainKey) ?? domains[0];
  const city = dm ? cityCell(ledger, dm.key) : null;
  const real = useMemo(() => plans.filter((p) => !p.is_example && p.boundary), [plans]);
  const quarters = useMemo(() => features.filter((f) => f.layer === 'quarters_official'), [features]);

  // plans per quarter, by the centre of the plan's blue line
  const planQuarter = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of real) {
      const b = bboxOfFC(p.boundary); if (!b) continue;
      const c: [number, number] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      const q = quarters.find((x) => inPolygon(c, x.geom)); if (q) m.set(p.id, q.id);
    }
    return m;
  }, [real, quarters]);

  const dFC = useMemo<GeoJSON.FeatureCollection>(() => ({ type: 'FeatureCollection', features: districts.filter((d) => d.geom).map((d) => ({ type: 'Feature', geometry: d.geom!, properties: { id: d.id, color: ramp(dm ? ledger[d.id]?.[dm.key]?.progress ?? null : null) } })) }), [districts, ledger, dm]);
  const qFC = useMemo<GeoJSON.FeatureCollection>(() => ({ type: 'FeatureCollection', features: quarters.map((q) => ({ type: 'Feature', geometry: q.geom, properties: { id: q.id } })) }), [quarters]);
  const pFC = useMemo<GeoJSON.FeatureCollection>(() => ({ type: 'FeatureCollection', features: real.map((p) => ({ type: 'Feature', geometry: p.boundary!, properties: { key: planKey(p), approved: statusGroup(p.status) === 'approved' ? 1 : 0 } })) }), [real]);

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: EMPTY_STYLE, center: [34.655, 31.795], zoom: 11.3, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.on('style.load', () => {
      if (!map.getSource('d')) {
        for (const s of ['d', 'q', 'p']) map.addSource(s, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'd-fill', type: 'fill', source: 'd', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.5 } });
        map.addLayer({ id: 'q-line', type: 'line', source: 'q', paint: { 'line-color': '#4a515c', 'line-width': 0.8, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: 'd-line', type: 'line', source: 'd', paint: { 'line-color': '#15181d', 'line-width': 1.4 } });
        map.addLayer({ id: 'p-fill', type: 'fill', source: 'p', paint: { 'fill-color': BLUE, 'fill-opacity': 0.08 } });
        // line-dasharray cannot vary per feature in MapLibre 4: one layer per line style
        map.addLayer({ id: 'p-line', type: 'line', source: 'p', filter: ['==', ['get', 'approved'], 1], paint: { 'line-color': BLUE, 'line-width': 2.4 } });
        map.addLayer({ id: 'p-line-other', type: 'line', source: 'p', filter: ['!=', ['get', 'approved'], 1], paint: { 'line-color': BLUE, 'line-width': 2.4, 'line-dasharray': [2, 1.5] } });
      }
      setReady((n) => n + 1);
    });
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['p-fill', 'd-fill'] });
      const pl = hit.find((h) => h.layer.id === 'p-fill'); if (pl) { open('plan', String(pl.properties?.key)); return; }
      const d = hit.find((h) => h.layer.id === 'd-fill'); if (d) open('district', Number(d.properties?.id));
    });
    loadBaseStyle('plain').then(({ style }) => map.setStyle(style, { diff: false }));
    mapRef.current = map;
    (window as unknown as { __remmap: MLMap }).__remmap = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !map.getSource('d')) return;
    (map.getSource('d') as GeoJSONSource).setData(dFC);
    (map.getSource('q') as GeoJSONSource).setData(unit === 'quarter' ? qFC : { type: 'FeatureCollection', features: [] });
    (map.getSource('p') as GeoJSONSource).setData(pFC);
  }, [dFC, qFC, pFC, unit, ready]);

  // HTML labels (no glyph server): per district "נשאר X מתוך Y", or per quarter the plans it holds
  useEffect(() => {
    const map = mapRef.current; if (!map || !ready || !dm) return;
    markers.current.forEach((m) => m.remove()); markers.current = [];
    const put = (at: [number, number], html: string, onClick: () => void, cls: string) => {
      const el = document.createElement('button'); el.type = 'button'; el.className = `rm-label ${cls}`; el.innerHTML = html; el.onclick = (e) => { e.stopPropagation(); onClick(); };
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map));
    };
    if (unit === 'district') {
      for (const d of districts) {
        const c = ledger[d.id]?.[dm.key]; const at = d.label_pt?.coordinates as [number, number] | undefined; if (!at || !c) continue;
        const need = c.target != null ? c.target - (c.existing ?? 0) : null;
        const left = c.remaining != null ? Math.max(0, c.remaining) : null;
        const line = c.target == null ? 'יעד חסר' : left != null && need != null ? `נשאר ${fmt(left)} מתוך ${fmt(need)}` : `אושר ${fmt(c.approved)} מתוך יעד ${fmt(c.target)}`;
        put(at, `<b>${d.id}</b> <span>${line}</span>`, () => open('district', d.id), 'rm-d');
      }
    } else {
      for (const q of quarters) {
        const at = (q.props?.label as [number, number] | undefined); if (!at) continue;
        const ps = real.filter((p) => planQuarter.get(p.id) === q.id);
        const sum = ps.reduce((a, p) => a + (fact(quantities, p.id, dm.key, true).value ?? 0), 0);
        const d = districts.find((x) => x.quarters?.includes(q.id));
        if (!ps.length) continue; // only quarters that hold a plan get a label; the rest are outlines
        put(at, `<b>${q.name}</b>${ps.length ? ` <span>${ps.length} תכניות, +${fmt(sum)}</span>` : ''}`, () => (d ? open('district', d.id) : undefined), 'rm-q has');
      }
    }
  }, [unit, ready, districts, ledger, dm, quarters, real, planQuarter, quantities, open]);

  if (!dm) return null;
  const cityNeed = city?.target != null && city.existing != null ? city.target - city.existing : null;
  return (
    <section className="card rm-card" data-testid="remaining-map">
      <div className="card-head">
        <h2>מה נשאר אחרי התכניות המאושרות</h2>
        <div className="row-actions">
          <label className="topic-pick">תחום<select className="input" aria-label="תחום במפה" value={dm.key} onChange={(e) => onDomain(e.target.value)}>{domains.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}</select></label>
          <div className="seg" role="tablist" aria-label="יחידה">
            <button type="button" role="tab" aria-selected={unit === 'district'} className={unit === 'district' ? 'on' : ''} onClick={() => setUnit('district')}>מתחמים</button>
            <button type="button" role="tab" aria-selected={unit === 'quarter'} className={unit === 'quarter' ? 'on' : ''} onClick={() => setUnit('quarter')}>רובעים</button>
          </div>
        </div>
      </div>
      <div className="rm-wholes" data-testid="city-whole">
        <div><span className="ls">השלם העירוני: יעד</span><b className="mono">{fmt(city?.target)}</b></div>
        <div><span className="ls">אושר בתכניות</span><b className="mono">{fmt(city?.approved)}</b><span className="ls">{shareText(city?.approved ?? 0, cityNeed ?? city?.target) ? ` ${shareText(city?.approved ?? 0, cityNeed ?? city?.target)} מהשלם` : ''}</span></div>
        <div><span className="ls">נשאר בעיר</span><b className="mono">{city?.remaining != null ? fmt(Math.max(0, city.remaining)) : 'חסר קיים'}</b></div>
      </div>
      <div ref={box} className="pmap rm-map" />
      <div className="cmp-legend ls">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => <span key={v}><span className="sw" style={{ background: ramp(v) }} />{v === 1 ? 'עומד ביעד' : `${v * 100}% ומעלה`}</span>)}
        <span><span className="sw" style={{ background: ramp(null) }} />חסר</span>
        <span><span className="sw-line" style={{ background: BLUE }} />קו כחול של תכנית</span>
      </div>
      <div className="ls">{unit === 'district' ? 'השלם המתחמי: יעד המתחם פחות הקיים. "נשאר" = אחרי הפחתת התכניות המאושרות. לחיצה על מתחם או תכנית פותחת אותם כאן.' : 'תכנית המתאר אינה קובעת יעד לרובע. כל רובע מראה את התכניות שבו ואת תרומתן; היתרה נספרת במתחם שהרובע שייך אליו.'}</div>
    </section>
  );
}
