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
