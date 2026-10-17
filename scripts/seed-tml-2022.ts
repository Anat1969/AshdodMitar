// Builds public/plans/tml-2022/seed.json from the plan's מבא"ת files (run: npx vite-node scripts/seed-tml-2022.ts).
// The database loads it with SQL http_get from the repository (see supabase/schema.sql). All quantities are drafts.
import fs from 'node:fs';
import shp from 'shpjs';
import { parseAreasTable, parseRightsTable, quantitiesFromAreas, quantitiesFromRights, lotsCollection } from '../src/lib/mavat';
import { pickLayers, polygonsOf, toBoundary } from '../src/lib/gis';

const dir = 'public/plans/tml-2022/';
const rightsHtml = fs.readFileSync(dir + 'rights-table-5.xls', 'utf8');
const areasHtml = fs.readFileSync(dir + 'areas-table.xls', 'utf8').replace(/^﻿/, '');
const rights = parseRightsTable(rightsHtml);
const picked = pickLayers(await (shp as unknown as (b: Buffer) => Promise<never>)(fs.readFileSync(dir + 'mavat-shp.zip')));
const round = (g: unknown): unknown => (Array.isArray(g) ? (typeof g[0] === 'number' ? g.slice(0, 2).map((x: number) => +x.toFixed(7)) : g.map(round)) : g);
const boundary = toBoundary(polygonsOf(picked.boundaryLayer));
const lots = lotsCollection(picked.lots!, rights);
for (const f of lots.features) (f.geometry as GeoJSON.Polygon).coordinates = round((f.geometry as GeoJSON.Polygon).coordinates) as GeoJSON.Position[][];
const q = [...quantitiesFromRights(rights).map((x) => ({ ...x, doc: 'rights-table-5.xls' })), ...quantitiesFromAreas(parseAreasTable(areasHtml)).map((x) => ({ ...x, doc: 'areas-table.xls' }))];
fs.writeFileSync(dir + 'seed.json', JSON.stringify({ boundary: round(boundary && { ...boundary, coordinates: boundary.coordinates }), lots, quantities: q }));
console.log('boundary', boundary?.type, 'lots', lots.features.length, 'quantities', q.map((x) => `${x.domain_key}=${x.value}`).join(' '));
