// Compare to target (simple flow, page 5): per district and per domain: target, each plan's contribution, total, gap.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../lib/store';
import { fmt } from '../lib/data';
import { cityCell } from '../lib/ledger';
import { EMPTY_STYLE, loadBaseStyle } from '../lib/basemaps';
import { planKey } from '../lib/plansapi';
import { Loading, NextStep, Page } from '../components/ui';
import { Progress, pctText } from '../components/ledger';

const ramp = (p: number | null) => (p == null ? '#d9dce0' : p >= 1 ? '#3f6b53' : p >= 0.75 ? '#7aa58a' : p >= 0.5 ? '#c9b26a' : p >= 0.25 ? '#d99a5b' : '#c4685a');

export default function ComparePage() {
  const { districts, domains, ledger, plans, loading, error } = useStore();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('by') === 'domain' ? 'domain' : 'district';
  const dom = sp.get('domain') ?? 'housing';
  const dm = domains.find((d) => d.key === dom) ?? domains[0];
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(0);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n, { replace: true }); };

  const rows = useMemo(() => districts.map((d) => ({ d, c: dm ? ledger[d.id]?.[dm.key] : undefined })).filter((r) => r.c), [districts, ledger, dm]);
  const fc = useMemo<GeoJSON.FeatureCollection>(() => ({ type: 'FeatureCollection', features: rows.filter((r) => r.d.geom).map((r) => ({ type: 'Feature', geometry: r.d.geom!, properties: { color: ramp(r.c!.progress), id: r.d.id } })) }), [rows]);

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: EMPTY_STYLE, center: [34.655, 31.795], zoom: 11.2, attributionControl: { compact: true } });
    map.on('style.load', () => {
      if (!map.getSource('d')) {
        map.addSource('d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'd-fill', type: 'fill', source: 'd', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.6 } });
        map.addLayer({ id: 'd-line', type: 'line', source: 'd', paint: { 'line-color': '#15181d', 'line-width': 1.2 } });
      }
      setReady((n) => n + 1);
    });
    loadBaseStyle('plain').then(({ style }) => map.setStyle(style, { diff: false }));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [view]);
  useEffect(() => { const m = mapRef.current; if (m && ready && m.getSource('d')) (m.getSource('d') as GeoJSONSource).setData(fc); }, [fc, ready]);

  if (loading) return <main className="page"><Loading error={error} /></main>;
  const planName = (id: string) => { const p = plans.find((x) => x.id === id); return p ? { label: p.plan_number ?? p.name, key: planKey(p) } : { label: id.slice(0, 6), key: id }; };

  return (
    <Page kicker="השוואה ליעד" title="מה הצטבר, ומה עוד חסר">
      <div className="row-actions tabs" role="tablist" aria-label="תצוגה">
        <button type="button" role="tab" aria-selected={view === 'district'} className={`btn small ${view === 'district' ? 'on' : ''}`} onClick={() => set('by', 'district')}>לפי מתחם</button>
        <button type="button" role="tab" aria-selected={view === 'domain'} className={`btn small ${view === 'domain' ? 'on' : ''}`} onClick={() => set('by', 'domain')}>לפי תחום</button>
      </div>
      <div className="ls">יעדי תכנית המתאר נקבעו ל-9 מתחמים, ולא לרובעים. כל תכנית משויכת למתחם שבו היא נמצאת, והרובע שלה מופיע בדף התכנית. נספר רק נתון מאושר.</div>

      {view === 'district' ? (
        <>
          <label className="topic-pick">תחום<select className="input" aria-label="תחום" value={dm?.key} onChange={(e) => set('domain', e.target.value)}>{domains.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}</select></label>
          <div className="two-col">
            <section className="card">
              <div className="table-wrap">
                <table className="table" data-testid="compare-table">
                  <thead><tr><th>מתחם</th><th>יעד</th><th>קיים</th><th>תרומת התכניות</th><th>סך הכול</th><th>פער</th><th>מימוש</th></tr></thead>
                  <tbody>{rows.map(({ d, c }) => (
                    <tr key={d.id}>
                      <td><Link to={`/district/${d.id}`}><span className="mono">{d.id}</span> {d.name}</Link></td>
                      <td className="mono">{fmt(c!.target)}</td>
                      <td className="mono">{fmt(c!.existing)}</td>
                      <td>{c!.contributions.filter((x) => x.bucket === 'approved').map((x, i) => { const p = planName(x.plan_id); return <div key={i}><Link to={`/plan/${p.key}`} className="mono">{p.label}</Link>: <span className="mono">{fmt(x.value)}</span></div>; })}{!c!.contributions.some((x) => x.bucket === 'approved') && <span className="ls">אין</span>}</td>
                      <td className="mono">{c!.existing == null ? `${fmt(c!.approved)} (בלי קיים)` : fmt(c!.existing + c!.approved)}</td>
                      <td className="mono">{c!.remaining != null ? fmt(c!.remaining) : c!.target == null ? 'חסר יעד' : `חסר קיים, ${fmt(c!.remainingBeforeExisting)} בלי הקיים`}</td>
                      <td><Progress p={c!.progress} scenario={c!.scenarioProgress} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><h2>מימוש {dm?.title}</h2></div>
              <div ref={box} className="pmap small" data-testid="compare-map" />
              <div className="cmp-legend ls">{[0, 0.25, 0.5, 0.75, 1].map((v) => <span key={v}><span className="sw" style={{ background: ramp(v) }} />{v === 1 ? 'הושג' : `${v * 100}%+`}</span>)}<span><span className="sw" style={{ background: ramp(null) }} />חסר</span></div>
            </section>
          </div>
        </>
      ) : (
        <section className="card">
          <div className="table-wrap">
            <table className="table" data-testid="compare-domains">
              <thead><tr><th>תחום</th><th>יעד</th><th>קיים</th><th>תכניות מאושרות</th><th>פער</th><th>מימוש</th></tr></thead>
              <tbody>{domains.map((d) => { const c = cityCell(ledger, d.key); return (
                <tr key={d.key}><td><b>{d.title}</b> <span className="ls">{d.unit}</span></td><td className="mono">{fmt(c.target)}</td><td className="mono">{fmt(c.existing)}</td><td className="mono">{fmt(c.approved)}</td>
                  <td className="mono">{c.remaining != null ? fmt(c.remaining) : c.target == null ? 'חסר יעד' : 'חסר קיים'}</td><td>{pctText(c.progress)}</td></tr>
              ); })}</tbody>
            </table>
          </div>
        </section>
      )}
      <NextStep to="/add" label="הוספת תכנית" why="כל תכנית שמתווספת ומאושרת מקטינה את הפער" />
    </Page>
  );
}
