// Builds public/plans/tml-2022/layers.json (map layers of plan תמל/2022) from its מבא"ת SHP and rights table.
// Run: npx vite-node scripts/layers-tml-2022.ts. Loaded into mt_plan_layers with SQL http_get (see supabase/schema.sql).
import fs from 'node:fs';
import shp from 'shpjs';
import { parseRightsTable } from '../src/lib/mavat';
import { planLayersFromShp } from '../src/lib/planlayers';

const dir = 'public/plans/tml-2022/';
const all = await (shp as unknown as (b: Buffer) => Promise<never>)(fs.readFileSync(dir + 'mavat-shp.zip'));
const rights = parseRightsTable(fs.readFileSync(dir + 'rights-table-5.xls', 'utf8'));
const layers = planLayersFromShp(all, rights);
fs.writeFileSync(dir + 'layers.json', JSON.stringify(layers));
console.log(layers.map((l) => `${l.kind}:${l.geojson.features.length}:${l.accuracy}`).join(' '));
