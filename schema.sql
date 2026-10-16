-- Ashdod Master Plan Twin: schema. Prefix mt_ (shared Supabase project safe).
-- Access model: INTERNAL TOOL. Read = authenticated users listed in mt_members. Write = mt_admins.
-- (Deviation from the default "public read": pipeline plans and gate status are internal municipal data.)

create table mt_members (email text primary key, role text not null check (role in ('viewer','editor','admin')), created_at timestamptz default now());
create or replace function mt_role() returns text language sql stable security definer as $$
  select role from mt_members where email = auth.jwt()->>'email' $$;

create table mt_city (id int primary key default 1, data jsonb not null, updated_at timestamptz default now());

create table mt_districts (
  id int primary key, name text not null,
  target_pop int, existing_pop int, existing_pop_date date, existing_pop_source text,
  total_area_m2 bigint, res_area_m2 bigint, units_added int, units_total int,
  employment_m2 bigint, tourism_m2 bigint, rahak jsonb, notes text, source text,
  geom jsonb,                               -- GeoJSON polygon (from נספח מתחמים), nullable until supplied
  updated_at timestamptz default now());

create table mt_plans (
  id uuid primary key default gen_random_uuid(),
  plan_number text, name text not null, district_id int references mt_districts(id),
  status text not null check (status in ('idea','pipeline','deposited','approved','rejected')),
  sector text check (sector in ('general','haredi')), fabric text check (fabric in ('existing','new')),
  is_renewal boolean default false, renewal_track text,     -- e.g. 'pinui-binui','139-shaked','603-0972307'
  units_existing int, units_added int not null default 0,
  mix jsonb, added_above_ground_m2 numeric, public_built_m2 numeric,
  intensive boolean default false, yard jsonb, distance_mass_transit_m numeric,
  lot_area_m2 numeric, percolation_m2 numeric, effective_green_m2 numeric, green_roof_m2 numeric,
  far numeric, rahak_row int, employment_m2 numeric,
  location jsonb,                            -- GeoJSON point
  source text, data_certainty text default 'reported' check (data_certainty in ('verified','reported','estimate')),
  created_by text, updated_at timestamptz default now());

create table mt_rules (
  id text primary key, title text not null, formula text, params jsonb,
  source text, certainty text check (certainty in ('statutory','plan-draft','policy-draft','assumption','missing')),
  version int default 1, active boolean default true, updated_at timestamptz default now());

create table mt_checks (
  id uuid primary key default gen_random_uuid(), plan_id uuid references mt_plans(id) on delete cascade,
  rule_id text references mt_rules(id), rule_version int, status text, values jsonb, message text,
  run_at timestamptz default now());

create table mt_decisions (
  id uuid primary key default gen_random_uuid(), plan_id uuid references mt_plans(id),
  forum text, decision text not null, rationale text, deviations jsonb, decided_at date, created_by text,
  created_at timestamptz default now());

create table mt_policy_register (
  id serial primary key, name text, type text, owner text, plan_number text, status text,
  date text, certainty text, gap_note text, owner_contact text, updated_at timestamptz default now());

create table mt_snapshots (                  -- yearly clause 6.2 report snapshots
  id uuid primary key default gen_random_uuid(), year int, payload jsonb, created_at timestamptz default now());

do $$ declare t text; begin
  foreach t in array array['mt_city','mt_districts','mt_plans','mt_rules','mt_checks','mt_decisions','mt_policy_register','mt_snapshots','mt_members'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (mt_role() is not null)', t||'_read', t);
    execute format('create policy %I on %I for all using (mt_role() in (''editor'',''admin'')) with check (mt_role() in (''editor'',''admin''))', t||'_write', t);
  end loop; end $$;
-- mt_members writable by admin only
drop policy mt_members_write on mt_members;
create policy mt_members_write on mt_members for all using (mt_role()='admin') with check (mt_role()='admin');
insert into mt_members(email, role) values ('shtanat5@gmail.com','admin');
