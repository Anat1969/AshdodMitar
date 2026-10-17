-- Ashdod Master Plan Twin: schema as applied to Supabase project ASHDODMAP (cbhexpybdggwzyakgagd).
-- Shared project: every object is prefixed mt_. Do not touch tables of other apps.
-- Access model (updated 2026-10-16):
--   public read (anon + authenticated): mt_city, mt_districts, mt_map_features, mt_rules, mt_policy_register
--     (published plan provisions, public map data, policy catalogue).
--   members only (rows in mt_members): mt_plans, mt_checks, mt_decisions, mt_snapshots, mt_members.
--   write: editor/admin. mt_members write: admin.
-- Run as separate small statements: one large DDL call timed out through the MCP tool.

create table mt_members (email text primary key, role text not null check (role in ('viewer','editor','admin')), created_at timestamptz default now());
create or replace function mt_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.mt_members where lower(email) = lower(auth.jwt()->>'email') $$;
create table mt_city (id int primary key default 1, data jsonb not null, updated_at timestamptz default now());
create table mt_districts (
  id int primary key, name text not null,
  target_pop int, existing_pop int, existing_pop_date date, existing_pop_source text,
  total_area_m2 bigint, res_area_m2 bigint, units_added int, units_total int,
  employment_m2 bigint, tourism_m2 bigint, rahak jsonb, notes text, source text, page int,
  quarters text[],                          -- quarter ids (public.quarters) assigned to the district: ASSUMPTION
  geom jsonb,                               -- schematic GeoJSON: union of quarter cells. Replace with נספח מתחמים when supplied
  geom_certainty text default 'assumption',
  updated_at timestamptz default now());
create table mt_plans (
  id uuid primary key default gen_random_uuid(),
  plan_number text, name text not null, district_id int references mt_districts(id),
  status text not null check (status in ('idea','pipeline','deposited','approved','rejected')),
  sector text check (sector in ('general','haredi')), fabric text check (fabric in ('existing','new')),
  is_renewal boolean default false, renewal_track text,
  units_existing int, units_added int not null default 0,
  mix jsonb, added_above_ground_m2 numeric, public_built_m2 numeric,
  intensive boolean default false, yard jsonb, distance_mass_transit_m numeric,
  lot_area_m2 numeric, percolation_m2 numeric, effective_green_m2 numeric, green_roof_m2 numeric,
  far numeric, rahak_row int, employment_m2 numeric,
  location jsonb, is_example boolean default false, note text,
  source text, data_certainty text default 'reported' check (data_certainty in ('verified','reported','estimate')),
  created_by text, updated_at timestamptz default now());
create table mt_rules (
  id text primary key, title text not null, formula text, params jsonb,
  source text, certainty text check (certainty in ('statutory','plan-draft','policy-draft','assumption','missing')),
  scope text default 'plan', version int default 1, active boolean default true, updated_at timestamptz default now());
create table mt_checks (
  id uuid primary key default gen_random_uuid(), plan_id uuid references mt_plans(id) on delete cascade,
  rule_id text references mt_rules(id), rule_version int, status text, values jsonb, message text,
  run_at timestamptz default now());
create table mt_decisions (
  id uuid primary key default gen_random_uuid(), plan_id uuid references mt_plans(id) on delete cascade,
  forum text, decision text not null, rationale text, deviations jsonb, decided_at date, created_by text,
  created_at timestamptz default now());
create table mt_policy_register (
  id serial primary key, name text, type text, owner text, plan_number text, status text,
  date text, certainty text, gap_note text, owner_contact text, updated_at timestamptz default now());
create table mt_snapshots (
  id uuid primary key default gen_random_uuid(), year int, payload jsonb, created_at timestamptz default now());
-- Map layers. layer: city (OSM boundary), quarter_points (OSM centres), quarter_cells (Voronoi, assumption)
create table mt_map_features (
  id text primary key, layer text not null, name text, props jsonb default '{}'::jsonb,
  geom jsonb not null, source text, certainty text check (certainty in ('statutory','plan-draft','policy-draft','assumption','missing','osm')),
  updated_at timestamptz default now());

do $$ declare t text; begin
  foreach t in array array['mt_city','mt_districts','mt_plans','mt_rules','mt_checks','mt_decisions','mt_policy_register','mt_snapshots','mt_map_features'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (mt_role() is not null)', t||'_read', t);
    execute format('create policy %I on %I for all to authenticated using (mt_role() in (''editor'',''admin'')) with check (mt_role() in (''editor'',''admin''))', t||'_write', t);
  end loop; end $$;
alter table mt_members enable row level security;
create policy mt_members_read on mt_members for select to authenticated using (mt_role() is not null or lower(email) = lower(auth.jwt()->>'email'));
create policy mt_members_write on mt_members for all to authenticated using (mt_role()='admin') with check (mt_role()='admin');
insert into mt_members(email, role) values ('shtanat5@gmail.com','admin');
revoke execute on function mt_role() from anon, public;
grant execute on function mt_role() to authenticated;

do $$ declare t text; begin
  foreach t in array array['mt_city','mt_districts','mt_map_features','mt_rules','mt_policy_register'] loop
    execute format('create policy %I on %I for select to anon, authenticated using (true)', t||'_public_read', t);
  end loop; end $$;
grant select on mt_city, mt_districts, mt_map_features, mt_rules, mt_policy_register to anon;
grant select, insert, update, delete on mt_city, mt_districts, mt_map_features, mt_rules, mt_policy_register, mt_plans, mt_checks, mt_decisions, mt_snapshots, mt_members to authenticated;
grant usage, select on sequence mt_policy_register_id_seq to authenticated;

-- Map geometry was built in SQL:
--   city boundary: Nominatim details for OSM relation 1380013 via the http extension, simplified 0.0002.
--   quarter_points: public.quarters.center (OSM).
--   quarter_cells: ST_VoronoiPolygons of quarter centres, clipped to the city boundary.
--   mt_districts.geom: ST_Union of the cells of mt_districts.quarters.

-- Documents library (added 2026-10-16)
create table mt_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null, doc_date date, file_path text not null, file_name text, mime text, size_bytes bigint,
  district_id int references mt_districts(id), plan_id uuid references mt_plans(id) on delete set null,
  note text, uploaded_by text, created_at timestamptz default now());
alter table mt_documents enable row level security;
create policy mt_documents_read on mt_documents for select to authenticated using (mt_role() is not null);
create policy mt_documents_write on mt_documents for all to authenticated using (mt_role() in ('editor','admin')) with check (mt_role() in ('editor','admin'));
grant select, insert, update, delete on mt_documents to authenticated;
insert into storage.buckets (id, name, public, file_size_limit) values ('mt-documents','mt-documents', false, 52428800) on conflict (id) do nothing;
create policy mt_documents_obj_read on storage.objects for select to authenticated using (bucket_id = 'mt-documents' and public.mt_role() is not null);
create policy mt_documents_obj_insert on storage.objects for insert to authenticated with check (bucket_id = 'mt-documents' and public.mt_role() in ('editor','admin'));
create policy mt_documents_obj_update on storage.objects for update to authenticated using (bucket_id = 'mt-documents' and public.mt_role() in ('editor','admin'));
create policy mt_documents_obj_remove on storage.objects for delete to authenticated using (bucket_id = 'mt-documents' and public.mt_role() in ('editor','admin'));

-- Real geography and topics (added 2026-10-16)
-- Certainty now also allows 'municipal' (Ashdod municipal GIS).
alter table mt_map_features drop constraint if exists mt_map_features_certainty_check;
alter table mt_map_features add constraint mt_map_features_certainty_check check (certainty in ('statutory','plan-draft','policy-draft','assumption','missing','osm','municipal'));
-- layer 'quarters_official': 35 quarter polygons from https://gis.ashdod.muni.il/arcgis/rest/services/Map/MapServer/0 (outSR=4326),
--   plus רובע ז from OSM way 898037027 (missing in the municipal layer). props.label = ST_MaximumInscribedCircle centre.
-- mt_districts.quarters now holds 'rova-<rova_code>' ids; geom = ST_Union of those quarters; label_pt = inscribed-circle centre.
alter table mt_districts add column if not exists mapped_area_m2 bigint;
alter table mt_districts add column if not exists label_pt jsonb;
-- Assignment (assumption, checked against the plan's district areas: 1,2,4,6 within 3%):
--   1: סיטי, מרינה, מע"ר דרום, מע"ר צפון | 2: רובעים א-ו | 3: קריית חלוצים, קריית פארק לכיש, קריית איתנים, בקמה
--   4: ז, ח, ט, אלתא | 5: עד הלום, משולש חקלאי | 6: י"א, י"ב, י"ג, ט"ו, ט"ז, י"ז | 7: י, שמעון פרס | 8: בית העלמין | 9: נמל, עורף הנמל, פארק עוגנים

-- What exists, by topic. Education: 876 institutions from the municipal GIS (planning fields only, no personal data).
create table if not exists mt_existing (
  id text primary key, topic text not null, subtype text, name text, qty jsonb default '{}'::jsonb,
  geom jsonb not null, district_id int, quarter_id text, source text, certainty text, updated_at timestamptz default now());
alter table mt_existing enable row level security;
create policy mt_existing_public_read on mt_existing for select to anon, authenticated using (true);
create policy mt_existing_write on mt_existing for all to authenticated using (mt_role() in ('editor','admin')) with check (mt_role() in ('editor','admin'));
grant select on mt_existing to anon; grant select, insert, update, delete on mt_existing to authenticated;

-- Plan program for the bill of quantities: classrooms, kindergartens, education_dunam, open_space_m2, commerce_m2, office_m2, roads_m
alter table mt_plans add column if not exists program jsonb default '{}'::jsonb;
-- staging for OSM lookups
create table if not exists mt_osm_raw (id text primary key, qname text, osm_type text, osm_id text, name text, category text, type text, geom jsonb, fetched_at timestamptz default now());
alter table mt_osm_raw enable row level security;

-- Realisation ledger (added 2026-10-17). remaining = target - existing - approved plans.
create table mt_domains (key text primary key, title text not null, unit text not null, sort int default 100, target_rule text, target_certainty text default 'missing', created_at timestamptz default now());
create table mt_targets (
  district_id int not null references mt_districts(id), domain_key text not null references mt_domains(key),
  target numeric, target_source text, target_page int, target_certainty text default 'missing',
  existing numeric, existing_date date, existing_source text, existing_certainty text default 'missing',  -- plans approved on/before existing_date are inside existing
  note text, updated_by text, updated_at timestamptz default now(), primary key (district_id, domain_key));
-- public read, write editor/admin (same policies as mt_existing)
alter table mt_plans add column approval_date date, add column boundary jsonb, add column boundary_source text, add column area_m2 numeric;
create table mt_plan_quantities (
  id uuid primary key default gen_random_uuid(), plan_id uuid not null references mt_plans(id) on delete cascade,
  district_id int references mt_districts(id), domain_key text not null references mt_domains(key),
  value numeric, doc_id uuid references mt_documents(id) on delete set null, page int, quote text,
  split text default 'single' check (split in ('single','table','area')), share numeric,
  status text not null default 'draft' check (status in ('draft','approved')),   -- only 'approved' counts
  origin text default 'manual' check (origin in ('ai','manual')), extraction_id uuid, note text,
  approved_by text, approved_at timestamptz, created_by text, created_at timestamptz default now(), updated_at timestamptz default now());
create table mt_extractions (
  id uuid primary key default gen_random_uuid(), plan_id uuid references mt_plans(id) on delete cascade,
  doc_id uuid references mt_documents(id) on delete cascade, status text not null default 'queued' check (status in ('queued','running','done','error')),
  model text, result jsonb, error text, created_by text, created_at timestamptz default now(), finished_at timestamptz);
-- members read, editor/admin write (mt_role()).
-- mt_area_split(boundary jsonb) -> {area_m2, parts:[{district_id, area_m2}]}: ST_Intersection with mt_districts.geom on geography. authenticated only.
-- Seed: mt_targets from mt_districts (plan tables, ch. 4.3): housing target=units_total, existing=units_total-units_added (derived);
--   education/kinder from target_pop (assumption) with existing from mt_existing; openspace 3 m2/person; employment=employment_m2.
-- Edge function mt-extract (supabase/functions/mt-extract): Claude API (claude-opus-5-5), needs secret ANTHROPIC_API_KEY.
