-- תמל/2022: proposed buildings as in "מה נבנה סביבי": an envelope per lot (building lines x max height from table 5),
-- and inside it an illustrative volume from table 5 areas: a podium for commerce/public/employment and a residential tower.
-- Run in the ASHDODMAP database (PostGIS, ITM = EPSG:2039). Replaces mt_plan_layers kind 'proposed' of the plan.
with pr as (select f from mt_plan_layers l, jsonb_array_elements(l.geojson->'features') f where l.plan_id='a2022000-0000-4000-8000-000000002022' and l.kind='proposed' and (f->'properties'->>'kind') is null),
hts(lot, h) as (values ('101',115.8),('102',120.5),('103',115.8),('104',115.8),('105',115.8),('106',115.8),('107',115.8),('201',83.5),('203',36.0),('204',36.0)), -- טבלה 5: גובה מבנה
rights as (select f->'properties'->>'lot' lot, f->'properties'->'rights' r from mt_plans p, jsonb_array_elements(p.lots->'features') f where p.id='a2022000-0000-4000-8000-000000002022'),
lots as (select pr.f->'properties'->>'lot' lot, (pr.f->'properties'->>'floors')::int floors, (pr.f->'properties'->>'units')::int units, hts.h,
   ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON((pr.f->'geometry')::text),4326),2039) g,
   (select coalesce(sum((x->>'builtM2')::numeric),0) from rights, jsonb_array_elements(rights.r) x where rights.lot=pr.f->'properties'->>'lot' and (x->>'use') in ('מגורים','')) res_m2,
   (select coalesce(sum((x->>'builtM2')::numeric),0) from rights, jsonb_array_elements(rights.r) x where rights.lot=pr.f->'properties'->>'lot' and (x->>'use') not in ('מגורים','')) other_m2
   from pr join hts on hts.lot = pr.f->'properties'->>'lot'),
bl as (select ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON((f->'geometry')::text),4326),2039) g from mt_plan_layers l, jsonb_array_elements(l.geojson->'features') f where l.plan_id='a2022000-0000-4000-8000-000000002022' and l.kind='building_lines' and f->'properties'->>'name'='קו בנין'),
-- the lot split by its building lines; the envelope is the largest piece inside the lot (setback strips are the thin ones)
pieces as (select lots.lot, (ST_Dump(ST_Polygonize(ST_Node(ST_Collect(array_append(array(select ST_Intersection(bl.g, ST_Buffer(lots.g,0.5)) from bl where ST_Intersects(bl.g, lots.g)), ST_Boundary(lots.g))))))).geom p from lots group by lots.lot, lots.g),
env as (select distinct on (l.lot) l.*, pc.p env, ST_Area(pc.p) env_a from lots l join pieces pc on pc.lot=l.lot and ST_Within(ST_PointOnSurface(pc.p), l.g) order by l.lot, ST_Area(pc.p) desc),
m as (select *, h / floors fh, case when other_m2 > 0 then greatest(1, ceil(other_m2 / (env_a * 0.85)))::int else 0 end pod_floors from env),
m2 as (select *, least(1.0, sqrt((res_m2 / greatest(1, floors - pod_floors)) / env_a)) s, ST_X(ST_Centroid(env)) cx, ST_Y(ST_Centroid(env)) cy from m),
feats as (
 select jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(ST_Transform(env,4326),7)::jsonb,'properties',jsonb_build_object('lot',lot,'kind','envelope','base',0,'height',h,'top',h,'floors',floors,'units',units)) f from m2
 union all select jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(ST_Transform(ST_Buffer(env,-0.5),4326),7)::jsonb,'properties',jsonb_build_object('lot',lot,'kind','podium','base',0,'height',round((pod_floors*fh)::numeric,1),'floors',pod_floors,'m2',other_m2)) from m2 where pod_floors > 0
 union all select jsonb_build_object('type','Feature','geometry',ST_AsGeoJSON(ST_Transform(ST_Translate(ST_Scale(ST_Translate(env,-cx,-cy), s, s), cx, cy),4326),7)::jsonb,'properties',jsonb_build_object('lot',lot,'kind','tower','base',round((pod_floors*fh)::numeric,1),'height',h,'floors',floors - pod_floors,'m2',res_m2,'units',units,'plate',round(res_m2/greatest(1,floors-pod_floors)))) from m2)
update mt_plan_layers set geojson = jsonb_build_object('type','FeatureCollection','features',(select jsonb_agg(f) from feats)),
  accuracy='approx', source='מעטפת: קווי הבניין בשכבת SHP והגובה המרבי בטבלה 5. בתוכה נפח לדוגמה משטחי הבנייה בטבלה 5',
  note='המעטפת נגזרת מהתכנית. הנפח הפנימי (קומות מסחר וציבור, ומגדל מגורים) הוא המחשה, לא נספח בינוי'
where plan_id='a2022000-0000-4000-8000-000000002022' and kind='proposed';
