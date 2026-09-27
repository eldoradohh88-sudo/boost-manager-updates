-- =====================================================================
--  BOOST MANAGER v2 — base de données Supabase
--  À coller EN ENTIER dans Supabase > SQL Editor > New query > Run.
--  Peut être relancé sans risque : ne supprime aucune donnée,
--  et met à jour une base v1 existante.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PARAMÈTRES
-- ---------------------------------------------------------------------
create table if not exists public.fee_rates (
  id             bigserial primary key,
  effective_from date not null unique,
  rate           numeric not null check (rate >= 0 and rate < 1),
  note           text
);
insert into public.fee_rates (effective_from, rate, note)
values ('2020-01-01', 0.10, 'Taux par défaut Eldorado')
on conflict (effective_from) do nothing;

create table if not exists public.split_rules (
  type            text primary key,
  label           text not null,
  flowey_share    numeric not null check (flowey_share >= 0 and flowey_share <= 1),
  boosters_needed int not null check (boosters_needed between 0 and 2),
  source          text not null check (source in ('Solo','Management','Collaboration')),
  sort            int not null default 0
);
insert into public.split_rules (type, label, flowey_share, boosters_needed, source, sort) values
  ('SOLO',              'Je fais le boosting seul',          1,            0, 'Solo',          1),
  ('BOOSTER SEUL',      'Un booster seul, sans moi',         0.3,          1, 'Management',    2),
  ('BOOSTERS SANS MOI', 'Deux boosters, sans moi',           0.3,          2, 'Management',    3),
  ('DUO AVEC MOI',      'Moi + 1 booster (parts égales)',    0.5,          1, 'Collaboration', 4),
  ('TRIO AVEC MOI',     'Moi + 2 boosters (parts égales)',   1::numeric/3, 2, 'Collaboration', 5)
on conflict (type) do nothing;

create table if not exists public.app_settings (
  id               int primary key default 1 check (id = 1),
  default_split_b1 numeric not null default 0.5 check (default_split_b1 between 0 and 1)
);
alter table public.app_settings add column if not exists month_goal numeric not null default 0;
alter table public.app_settings add column if not exists wallet_show_amounts boolean not null default false;
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. ÉQUIPE, COMPTES, LICENCES
-- ---------------------------------------------------------------------
create table if not exists public.boosters (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0 and lower(name) <> 'flowey'),
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now()
);
alter table public.boosters add column if not exists availability text not null default 'Disponible';
do $$ begin
  alter table public.boosters add constraint boosters_availability_chk
    check (availability in ('Disponible','Occupé','Absent'));
exception when duplicate_object then null; end $$;
-- équipe de départ : seulement sur une base vide (sinon un booster renommé ou supprimé reviendrait)
insert into public.boosters (name)
select n from (values ('Jewex'), ('Dorsal'), ('Flare'), ('Naxio'), ('Vulcaano')) v(n)
where not exists (select 1 from public.boosters);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'booster' check (role in ('admin','booster')),
  booster_id uuid references public.boosters(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.licenses (
  key           text primary key,
  booster_id    uuid not null references public.boosters(id) on delete cascade,
  duration_days int  not null check (duration_days > 0),
  note          text,
  created_at    timestamptz not null default now(),
  activated_by  uuid references public.profiles(id) on delete set null,
  activated_at  timestamptz,
  expires_at    timestamptz,
  revoked       boolean not null default false
);

-- ---------------------------------------------------------------------
-- 3. COMMANDES
--    stage  = avancement du boost  (À attribuer → Attribuée → En cours → Livrée → Validée)
--    status = comptabilité         (En attente / Terminée / Annulée)
--    « Validée » passe automatiquement la commande en « Terminée ».
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique check (length(trim(ref)) > 0),
  order_date    date not null default current_date,
  client        text,
  game          text,
  gross         numeric(12,2) not null check (gross > 0),
  split_type    text references public.split_rules(type),
  booster1_id   uuid references public.boosters(id),
  booster2_id   uuid references public.boosters(id),
  split_b1      numeric check (split_b1 between 0 and 1),
  status        text not null default 'En attente' check (status in ('En attente','Terminée','Annulée')),
  boosters_paid text check (boosters_paid in ('Oui','Partiel','Non')),
  paid_date     date,
  notes         text,
  fee_rate      numeric,
  fee           numeric(12,2),
  net           numeric(12,2),
  flowey_part   numeric(12,2),
  b1_part       numeric(12,2),
  b2_part       numeric(12,2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.orders alter column split_type drop not null;
alter table public.orders add column if not exists stage        text not null default 'À attribuer';
alter table public.orders add column if not exists service      text;
alter table public.orders add column if not exists current_rank text;
alter table public.orders add column if not exists target_rank  text;
alter table public.orders add column if not exists server       text;
alter table public.orders add column if not exists deadline     timestamptz;
alter table public.orders add column if not exists instructions text;
alter table public.orders add column if not exists started_at   timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists validated_at timestamptz;
alter table public.orders add column if not exists eldorado_url text;
do $$ begin
  alter table public.orders add constraint orders_stage_chk
    check (stage in ('À attribuer','Attribuée','En cours','Livrée','Validée'));
exception when duplicate_object then null; end $$;
-- commandes v1 déjà terminées → « Validée »
update public.orders set stage = 'Validée' where status = 'Terminée' and stage = 'À attribuer';
create index if not exists orders_date_idx   on public.orders(order_date);
create index if not exists orders_status_idx on public.orders(status);
create index if not exists orders_stage_idx  on public.orders(stage);
create index if not exists orders_b1_idx     on public.orders(booster1_id);
create index if not exists orders_b2_idx     on public.orders(booster2_id);

-- Identifiants du compte client : visibles uniquement par le booster attribué,
-- pendant la commande, puis effacés automatiquement à la livraison.
create table if not exists public.order_secrets (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  login      text,
  password   text,
  extra      text,
  updated_at timestamptz not null default now()
);

-- Chat par commande
create table if not exists public.messages (
  id          bigserial primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text,
  body        text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_order_idx on public.messages(order_id, created_at);

-- Annonces (toute l'équipe) et notes privées (un booster)
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  booster_id uuid references public.boosters(id) on delete cascade,
  title      text not null check (length(trim(title)) > 0),
  body       text,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);

-- Notifications (affichées dans l'app + notification Windows)
create table if not exists public.notifications (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  for_admin  boolean not null default false,
  booster_id uuid references public.boosters(id) on delete cascade,
  title      text not null,
  body       text,
  order_id   uuid references public.orders(id) on delete cascade
);
create index if not exists notifications_created_idx on public.notifications(created_at desc);

-- ---------------------------------------------------------------------
-- 4. PAIEMENTS, RETRAITS
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  pay_date   date not null default current_date,
  booster_id uuid not null references public.boosters(id),
  amount     numeric(12,2) not null check (amount > 0),
  method     text,
  reference  text,
  order_refs text,
  created_at timestamptz not null default now()
);
create index if not exists payments_booster_idx on public.payments(booster_id);

create table if not exists public.withdrawals (
  id         uuid primary key default gen_random_uuid(),
  w_date     date not null default current_date,
  amount_usd numeric(12,2) not null check (amount_usd > 0),
  fee_usd    numeric(12,2) not null default 0 check (fee_usd >= 0),
  fx_rate    numeric,
  amount_eur numeric(12,2),
  method     text,
  notes      text,
  created_at timestamptz not null default now()
);

-- Gains hors commandes : historique reporté (ex. Discord), bonus, corrections.
-- booster_id vide = part de Flowey. Compte comme de l'argent entré dans le wallet Eldorado.
create table if not exists public.adjustments (
  id         uuid primary key default gen_random_uuid(),
  adj_date   date not null default current_date,
  booster_id uuid references public.boosters(id) on delete cascade,
  amount     numeric(12,2) not null check (amount <> 0),
  label      text not null,
  created_at timestamptz not null default now()
);

-- Coordonnées de paiement des boosters (renseignées par eux dans l'app)
alter table public.boosters add column if not exists payout_method  text;
alter table public.boosters add column if not exists payout_details text;
-- Dernier solde réel relevé sur Eldorado (pour comparer avec le solde calculé)
alter table public.app_settings add column if not exists eldorado_balance    numeric(12,2);
alter table public.app_settings add column if not exists eldorado_balance_at timestamptz;

-- ---------------------------------------------------------------------
-- 5. FONCTIONS D'ACCÈS
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from licenses
    where activated_by = auth.uid() and not revoked and expires_at > now());
$$;

create or replace function public.my_booster_id() returns uuid
language sql stable security definer set search_path = public as $$
  select booster_id from profiles where id = auth.uid();
$$;

create or replace function public.is_assigned(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_booster_id() is not null and exists (
    select 1 from orders o where o.id = p_order
      and public.my_booster_id() in (o.booster1_id, o.booster2_id));
$$;

create or replace function public.can_see_secrets(p_order uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_access() and public.is_assigned(p_order) and exists (
    select 1 from orders o where o.id = p_order
      and o.stage in ('Attribuée','En cours') and o.status <> 'Annulée');
$$;

create or replace function public.current_fee_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select rate from fee_rates where effective_from <= current_date
  order by effective_from desc limit 1;
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 6. CALCULS AUTOMATIQUES DES COMMANDES
--    Parts boosters arrondies au centime ; Flowey = Net − parts boosters
--    => la somme des parts est TOUJOURS exactement égale au Net.
-- ---------------------------------------------------------------------
create or replace function public.compute_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r      split_rules%rowtype;
  rate   numeric;
  pool   numeric;
  split  numeric;
begin
  new.updated_at := now();

  -- synchronisation avancement ↔ comptabilité
  if new.status = 'Terminée' then
    new.stage := 'Validée';
  elsif new.stage = 'Validée' then
    if tg_op = 'INSERT' or old.stage is distinct from 'Validée' then
      new.status := 'Terminée';
    else
      new.stage := 'Livrée';          -- la compta a été ré-ouverte
    end if;
  end if;
  if new.stage = 'À attribuer' and (new.booster1_id is not null or new.split_type = 'SOLO') then
    new.stage := 'Attribuée';
  end if;
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if new.stage = 'En cours' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.stage = 'Livrée'   then new.delivered_at := coalesce(new.delivered_at, now()); end if;
    if new.stage = 'Validée'  then new.validated_at := coalesce(new.validated_at, now()); end if;
  end if;

  if new.split_type is null then
    if new.status = 'Terminée' then
      raise exception 'Choisis le type de répartition (attribue la commande) avant de la valider.';
    end if;
    if new.booster1_id is not null or new.booster2_id is not null then
      raise exception 'Choisis le type de répartition avant d''indiquer des boosters.';
    end if;
  end if;

  -- sur une modification, on ne recalcule que si une donnée de calcul a changé
  if tg_op = 'UPDATE'
     and new.gross is not distinct from old.gross
     and new.split_type is not distinct from old.split_type
     and new.booster1_id is not distinct from old.booster1_id
     and new.booster2_id is not distinct from old.booster2_id
     and new.split_b1 is not distinct from old.split_b1
     and new.order_date is not distinct from old.order_date then
    new.fee_rate := old.fee_rate; new.fee := old.fee; new.net := old.net;
    new.flowey_part := old.flowey_part; new.b1_part := old.b1_part; new.b2_part := old.b2_part;
    return new;
  end if;

  -- frais Eldorado : taux en vigueur à la date de la commande
  select fr.rate into rate from fee_rates fr where fr.effective_from <= new.order_date
    order by fr.effective_from desc limit 1;
  if rate is null then
    select fr.rate into rate from fee_rates fr order by fr.effective_from asc limit 1;
  end if;
  new.fee_rate := coalesce(rate, 0);
  new.fee      := round(new.gross * new.fee_rate, 2);
  new.net      := new.gross - new.fee;

  if new.split_type is null then
    new.flowey_part := null; new.b1_part := null; new.b2_part := null;
    new.split_b1 := null;
    return new;
  end if;

  select * into r from split_rules where type = new.split_type;
  if not found then raise exception 'Type de répartition inconnu : %', new.split_type; end if;

  if r.boosters_needed = 0 and (new.booster1_id is not null or new.booster2_id is not null) then
    raise exception 'SOLO : aucun booster ne doit être indiqué.';
  end if;
  if r.boosters_needed >= 1 and new.booster1_id is null then
    raise exception 'Booster 1 obligatoire pour le type %.', new.split_type;
  end if;
  if r.boosters_needed = 1 and new.booster2_id is not null then
    raise exception 'Booster 2 doit rester vide pour le type %.', new.split_type;
  end if;
  if r.boosters_needed = 2 and new.booster2_id is null then
    raise exception 'Booster 2 obligatoire pour le type %.', new.split_type;
  end if;
  if new.booster1_id is not null and new.booster1_id = new.booster2_id then
    raise exception 'Booster 1 et Booster 2 doivent être différents.';
  end if;
  if new.split_type <> 'BOOSTERS SANS MOI' then new.split_b1 := null; end if;

  pool := 1 - r.flowey_share;
  if r.boosters_needed = 2 then
    if new.split_type = 'BOOSTERS SANS MOI' then
      split := coalesce(new.split_b1, (select default_split_b1 from app_settings where id = 1), 0.5);
    else
      split := 0.5;
    end if;
    new.b1_part := round(new.net * pool * split, 2);
    new.b2_part := round(new.net * pool * (1 - split), 2);
  elsif r.boosters_needed = 1 then
    new.b1_part := round(new.net * pool, 2);
    new.b2_part := 0;
  else
    new.b1_part := 0;
    new.b2_part := 0;
  end if;
  new.flowey_part := new.net - new.b1_part - new.b2_part;
  return new;
end $$;
drop trigger if exists orders_compute on public.orders;
create trigger orders_compute before insert or update on public.orders
  for each row execute function public.compute_order();

-- Après chaque changement : notifications + effacement des identifiants
create or replace function public.orders_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare lbl text := new.ref || coalesce(' · ' || new.game, '');
begin
  if new.booster1_id is not null and (tg_op = 'INSERT' or new.booster1_id is distinct from old.booster1_id) then
    insert into notifications (booster_id, title, body, order_id)
    values (new.booster1_id, 'Nouvelle commande attribuée', lbl, new.id);
  end if;
  if new.booster2_id is not null and (tg_op = 'INSERT' or new.booster2_id is distinct from old.booster2_id) then
    insert into notifications (booster_id, title, body, order_id)
    values (new.booster2_id, 'Nouvelle commande attribuée', lbl, new.id);
  end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    if new.stage in ('En cours','Livrée') and not is_admin() then
      insert into notifications (for_admin, title, body, order_id)
      values (true, case when new.stage = 'En cours' then 'Commande démarrée' else 'Commande livrée — à valider' end,
              lbl || coalesce(' · ' || (select name from boosters where id = my_booster_id()), ''), new.id);
    end if;
    if new.stage = 'Validée' then
      if new.booster1_id is not null then
        insert into notifications (booster_id, title, body, order_id)
        values (new.booster1_id, 'Commande validée', lbl || ' · +$' || new.b1_part, new.id);
      end if;
      if new.booster2_id is not null then
        insert into notifications (booster_id, title, body, order_id)
        values (new.booster2_id, 'Commande validée', lbl || ' · +$' || new.b2_part, new.id);
      end if;
    end if;
  end if;
  if new.stage in ('Livrée','Validée') or new.status = 'Annulée' then
    delete from order_secrets where order_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists orders_after on public.orders;
create trigger orders_after after insert or update on public.orders
  for each row execute function public.orders_after();

-- Messages : auteur renseigné automatiquement + notification
create or replace function public.messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id := auth.uid();
  new.created_at := now();
  new.author_name := case when is_admin() then 'Flowey'
                          else coalesce((select name from boosters where id = my_booster_id()), 'Booster') end;
  return new;
end $$;
drop trigger if exists messages_before on public.messages;
create trigger messages_before before insert on public.messages
  for each row execute function public.messages_before();

create or replace function public.messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; me uuid := my_booster_id(); snippet text := left(new.body, 120);
begin
  select * into o from orders where id = new.order_id;
  if not is_admin() then
    insert into notifications (for_admin, title, body, order_id)
    values (true, 'Message de ' || new.author_name || ' · ' || o.ref, snippet, o.id);
  end if;
  if o.booster1_id is not null and o.booster1_id is distinct from me then
    insert into notifications (booster_id, title, body, order_id)
    values (o.booster1_id, 'Message de ' || new.author_name || ' · ' || o.ref, snippet, o.id);
  end if;
  if o.booster2_id is not null and o.booster2_id is distinct from me then
    insert into notifications (booster_id, title, body, order_id)
    values (o.booster2_id, 'Message de ' || new.author_name || ' · ' || o.ref, snippet, o.id);
  end if;
  return null;
end $$;
drop trigger if exists messages_after on public.messages;
create trigger messages_after after insert on public.messages
  for each row execute function public.messages_after();

create or replace function public.announcements_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (booster_id, title, body)
  values (new.booster_id, case when new.booster_id is null then 'Annonce : ' else 'Note de Flowey : ' end || new.title,
          left(coalesce(new.body, ''), 160));
  return null;
end $$;
drop trigger if exists announcements_after on public.announcements;
create trigger announcements_after after insert on public.announcements
  for each row execute function public.announcements_after();

create or replace function public.payments_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (booster_id, title, body)
  values (new.booster_id, 'Paiement reçu 💸', '+$' || new.amount || coalesce(' via ' || new.method, '')
          || coalesce(' · ' || new.reference, ''));
  return null;
end $$;
drop trigger if exists payments_after on public.payments;
create trigger payments_after after insert on public.payments
  for each row execute function public.payments_after();

-- ---------------------------------------------------------------------
-- 7. SÉCURITÉ (Row Level Security)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fee_rates','split_rules','app_settings','boosters','profiles','licenses','orders',
                           'order_secrets','messages','announcements','notifications','payments','withdrawals','adjustments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists read_rules on public.split_rules;
create policy read_rules on public.split_rules for select to authenticated using (public.has_access());
drop policy if exists read_fees on public.fee_rates;
create policy read_fees on public.fee_rates for select to authenticated using (public.has_access());
drop policy if exists read_boosters on public.boosters;
create policy read_boosters on public.boosters for select to authenticated using (public.has_access());
drop policy if exists read_own_profile on public.profiles;
create policy read_own_profile on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists read_own_license on public.licenses;
create policy read_own_license on public.licenses for select to authenticated using (activated_by = auth.uid());

drop policy if exists booster_secrets on public.order_secrets;
create policy booster_secrets on public.order_secrets for select to authenticated
  using (public.can_see_secrets(order_id));

drop policy if exists booster_read_messages on public.messages;
create policy booster_read_messages on public.messages for select to authenticated
  using (public.has_access() and public.is_assigned(order_id));
drop policy if exists booster_write_messages on public.messages;
create policy booster_write_messages on public.messages for insert to authenticated
  with check (public.has_access() and public.is_assigned(order_id));

drop policy if exists booster_announcements on public.announcements;
create policy booster_announcements on public.announcements for select to authenticated
  using (public.has_access() and (booster_id is null or booster_id = public.my_booster_id()));

drop policy if exists booster_notifications on public.notifications;
create policy booster_notifications on public.notifications for select to authenticated
  using (not for_admin and public.has_access() and (booster_id is null or booster_id = public.my_booster_id()));

drop policy if exists booster_adjustments on public.adjustments;
create policy booster_adjustments on public.adjustments for select to authenticated
  using (public.has_access() and booster_id = public.my_booster_id());

-- Temps réel (chat + notifications)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages','notifications'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. FONCTIONS APPELÉES PAR L'APPLICATION
-- ---------------------------------------------------------------------
drop function if exists public.my_orders();

create or replace function public.my_access() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles%rowtype; l licenses%rowtype;
        admin_exists boolean := exists (select 1 from profiles where role = 'admin');
begin
  select * into p from profiles where id = auth.uid();
  if not found then return jsonb_build_object('status','none','admin_exists',admin_exists); end if;
  if p.role = 'admin' then
    return jsonb_build_object('status','admin','role','admin','email',p.email);
  end if;
  select * into l from licenses where activated_by = auth.uid()
    order by revoked asc, expires_at desc nulls last limit 1;
  return jsonb_build_object(
    'role','booster','email',p.email,'admin_exists',admin_exists,
    'booster_id', p.booster_id,
    'booster', (select name from boosters where id = p.booster_id),
    'expires_at', l.expires_at,
    'status', case when l.key is null then 'none'
                   when l.revoked then 'revoked'
                   when l.expires_at <= now() then 'expired'
                   else 'active' end);
end $$;

-- Le tout premier compte peut devenir admin en un clic (ensuite, plus personne)
create or replace function public.claim_admin() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from profiles where role = 'admin') then
    raise exception 'Un admin existe déjà.';
  end if;
  update profiles set role = 'admin', booster_id = null where id = auth.uid();
  return public.my_access();
end $$;

create or replace function public.activate_license(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l licenses%rowtype; cur timestamptz; k text := upper(trim(p_key));
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord.'; end if;
  select * into l from licenses where key = k for update;
  if not found then raise exception 'Clé de licence invalide.'; end if;
  if l.revoked then raise exception 'Cette clé a été révoquée.'; end if;
  if l.activated_by is not null then
    if l.activated_by = auth.uid() then raise exception 'Tu as déjà activé cette clé.'; end if;
    raise exception 'Cette clé est déjà utilisée par un autre compte.';
  end if;
  if exists (select 1 from profiles where id = auth.uid() and booster_id is not null and booster_id <> l.booster_id) then
    raise exception 'Cette clé est destinée à un autre booster.';
  end if;
  select max(expires_at) into cur from licenses
    where activated_by = auth.uid() and not revoked and expires_at > now();
  update licenses set activated_by = auth.uid(), activated_at = now(),
         expires_at = greatest(coalesce(cur, now()), now()) + make_interval(days => l.duration_days)
   where key = k;
  update profiles set booster_id = l.booster_id where id = auth.uid();
  return public.my_access();
end $$;

create or replace function public.admin_create_license(p_booster uuid, p_days int, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare k text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not is_admin() then raise exception 'Accès réservé à l''admin.'; end if;
  loop
    k := 'BOOST';
    for i in 1..16 loop
      if (i - 1) % 4 = 0 then k := k || '-'; end if;
      k := k || substr(alphabet, 1 + (get_byte(uuid_send(gen_random_uuid()), 0) % 32), 1);
    end loop;
    exit when not exists (select 1 from licenses where key = k);
  end loop;
  insert into licenses (key, booster_id, duration_days, note) values (k, p_booster, p_days, p_note);
  return k;
end $$;

create or replace function public.admin_extend_license(p_key text, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Accès réservé à l''admin.'; end if;
  update licenses set
    duration_days = case when activated_by is null then duration_days + p_days else duration_days end,
    expires_at    = case when activated_by is null then null
                         else greatest(coalesce(expires_at, now()), now()) + make_interval(days => p_days) end
  where key = p_key;
end $$;

-- Booster : changer sa disponibilité
create or replace function public.set_my_availability(p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_access() or my_booster_id() is null then raise exception 'Licence inactive.'; end if;
  update boosters set availability = p_value where id = my_booster_id();
end $$;

-- Booster : ses coordonnées de paiement (PayPal, Skrill, IBAN…)
create or replace function public.set_my_payout(p_method text, p_details text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_access() or my_booster_id() is null then raise exception 'Licence inactive.'; end if;
  update boosters set payout_method = nullif(trim(p_method), ''), payout_details = nullif(trim(p_details), '')
   where id = my_booster_id();
end $$;

-- Booster : faire avancer SA commande (Attribuée → En cours → Livrée)
create or replace function public.booster_set_stage(p_order uuid, p_stage text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  if not has_access() or not is_assigned(p_order) then raise exception 'Commande non attribuée à toi.'; end if;
  select * into o from orders where id = p_order;
  if o.status = 'Annulée' then raise exception 'Cette commande est annulée.'; end if;
  if not ((o.stage = 'Attribuée' and p_stage = 'En cours') or (o.stage = 'En cours' and p_stage = 'Livrée')) then
    raise exception 'Étape impossible : % → %.', o.stage, p_stage;
  end if;
  update orders set stage = p_stage where id = p_order;
end $$;

-- Booster : ses commandes (sans client ni part de Flowey)
create or replace function public.my_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := my_booster_id();
begin
  if not has_access() or b is null then raise exception 'Licence inactive.'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'order_date') desc, x->>'ref' desc) from (
    select jsonb_build_object('id', o.id, 'ref', o.ref, 'order_date', o.order_date, 'game', o.game,
      'service', o.service, 'current_rank', o.current_rank, 'target_rank', o.target_rank,
      'deadline', o.deadline, 'stage', o.stage, 'status', o.status, 'split_type', o.split_type,
      'my_part', (case when o.booster1_id = b then o.b1_part else 0 end
                + case when o.booster2_id = b then o.b2_part else 0 end)) as x
    from orders o where o.booster1_id = b or o.booster2_id = b
    order by o.order_date desc limit 500) s), '[]'::jsonb);
end $$;

create or replace function public.my_order(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := my_booster_id(); o orders%rowtype; r split_rules%rowtype; mates text[] := '{}';
begin
  if not has_access() or not is_assigned(p_order) then raise exception 'Commande non attribuée à toi.'; end if;
  select * into o from orders where id = p_order;
  select * into r from split_rules where type = o.split_type;
  if r.source = 'Collaboration' then mates := mates || 'Flowey'::text; end if;
  if o.booster1_id is distinct from b and o.booster1_id is not null then
    mates := mates || (select name from boosters where id = o.booster1_id); end if;
  if o.booster2_id is distinct from b and o.booster2_id is not null then
    mates := mates || (select name from boosters where id = o.booster2_id); end if;
  return jsonb_build_object('id', o.id, 'ref', o.ref, 'order_date', o.order_date, 'game', o.game,
    'service', o.service, 'current_rank', o.current_rank, 'target_rank', o.target_rank, 'server', o.server,
    'deadline', o.deadline, 'instructions', o.instructions, 'stage', o.stage, 'status', o.status,
    'split_type', o.split_type, 'teammates', to_jsonb(mates),
    'my_part', (case when o.booster1_id = b then o.b1_part else 0 end
              + case when o.booster2_id = b then o.b2_part else 0 end));
end $$;

create or replace function public.my_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := my_booster_id(); adj numeric;
begin
  if not has_access() or b is null then raise exception 'Licence inactive.'; end if;
  select coalesce(sum(amount),0) into adj from adjustments where booster_id = b;
  return jsonb_build_object(
    'earned',  adj + (select coalesce(sum(case when booster1_id = b then b1_part else 0 end
                                  + case when booster2_id = b then b2_part else 0 end),0)
                from orders where status = 'Terminée' and (booster1_id = b or booster2_id = b)),
    'adjusted', adj,
    'pending', (select coalesce(sum(case when booster1_id = b then coalesce(b1_part,0) else 0 end
                                  + case when booster2_id = b then coalesce(b2_part,0) else 0 end),0)
                from orders where status = 'En attente' and (booster1_id = b or booster2_id = b)),
    'count',   (select count(*) from orders where status = 'Terminée' and (booster1_id = b or booster2_id = b)),
    'active',  (select count(*) from orders where status <> 'Annulée' and stage in ('Attribuée','En cours')
                  and (booster1_id = b or booster2_id = b)),
    'paid',    (select coalesce(sum(amount),0) from payments where booster_id = b),
    'availability', (select availability from boosters where id = b),
    'payout_method', (select payout_method from boosters where id = b),
    'payout_details', (select payout_details from boosters where id = b),
    'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('date',adj_date,'amount',amount,'label',label)
                 order by adj_date desc, created_at desc), '[]'::jsonb) from adjustments where booster_id = b),
    'payments',(select coalesce(jsonb_agg(jsonb_build_object('date',pay_date,'amount',amount,'method',method)
                 order by pay_date desc), '[]'::jsonb) from payments where booster_id = b));
end $$;

-- Wallet d'équipe (visible par tous) — la part de Flowey n'y figure jamais
create or replace function public.team_wallet() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date := date_trunc('month', current_date)::date; show boolean; me uuid := my_booster_id();
begin
  if not has_access() then raise exception 'Licence inactive.'; end if;
  select wallet_show_amounts into show from app_settings where id = 1;
  return jsonb_build_object(
    'month', m0,
    'show_amounts', show or is_admin(),
    'goal', (select month_goal from app_settings where id = 1),
    'month_net', (select coalesce(sum(net),0) from orders where status = 'Terminée' and order_date >= m0),
    'month_count', (select count(*) from orders where status = 'Terminée' and order_date >= m0),
    'total_net', (select coalesce(sum(net),0) from orders where status = 'Terminée'),
    'total_count', (select count(*) from orders where status = 'Terminée'),
    'my_month', case when me is null then null else (select coalesce(sum(case when booster1_id = me then b1_part else 0 end
                     + case when booster2_id = me then b2_part else 0 end),0)
                     from orders where status = 'Terminée' and order_date >= m0) end,
    'board', (select coalesce(jsonb_agg(x order by (x->>'month_count')::int desc, (x->>'total_count')::int desc, x->>'name'), '[]'::jsonb) from (
      select jsonb_build_object('name', b.name, 'availability', b.availability, 'me', b.id = me,
        'month_count', (select count(*) from orders o where o.status = 'Terminée' and o.order_date >= m0
                          and b.id in (o.booster1_id, o.booster2_id)),
        'total_count', (select count(*) from orders o where o.status = 'Terminée' and b.id in (o.booster1_id, o.booster2_id)),
        'month_earned', case when show or is_admin() or b.id = me then
            (select coalesce(sum(case when o.booster1_id = b.id then o.b1_part else 0 end
                               + case when o.booster2_id = b.id then o.b2_part else 0 end),0)
             from orders o where o.status = 'Terminée' and o.order_date >= m0) end) as x
      from boosters b where b.active
      union all
      select jsonb_build_object('name', 'Flowey', 'availability', null, 'me', false,
        'month_count', (select count(*) from orders o join split_rules r on r.type = o.split_type
                          where o.status = 'Terminée' and o.order_date >= m0 and r.source <> 'Management'),
        'total_count', (select count(*) from orders o join split_rules r on r.type = o.split_type
                          where o.status = 'Terminée' and r.source <> 'Management'),
        'month_earned', null)) s));
end $$;

-- Admin : toutes les statistiques du tableau de bord en un appel
create or replace function public.admin_dashboard(p_year int, p_month int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 date := make_date(p_year, p_month, 1);
begin
  if not is_admin() then raise exception 'Accès réservé à l''admin.'; end if;
  return jsonb_build_object(
    'rate', current_fee_rate(),
    'global', (select jsonb_build_object(
        'gross', coalesce(sum(gross),0), 'fee', coalesce(sum(fee),0), 'net', coalesce(sum(net),0),
        'flowey', coalesce(sum(flowey_part),0), 'boosters', coalesce(sum(b1_part + b2_part),0),
        'gap', coalesce(sum(net - flowey_part - b1_part - b2_part),0))
      from orders where status = 'Terminée'),
    'paid', (select coalesce(sum(amount),0) from payments),
    'adj', (select jsonb_build_object(
        'flowey', coalesce(sum(amount) filter (where booster_id is null),0),
        'boosters', coalesce(sum(amount) filter (where booster_id is not null),0),
        'total', coalesce(sum(amount),0)) from adjustments),
    'eldorado', (select jsonb_build_object(
        'net_orders', (select coalesce(sum(net),0) from orders where status = 'Terminée'),
        'adj', (select coalesce(sum(amount),0) from adjustments),
        'withdrawn', (select coalesce(sum(amount_usd),0) from withdrawals),
        'balance', (select coalesce(sum(net),0) from orders where status = 'Terminée')
                 + (select coalesce(sum(amount),0) from adjustments)
                 - (select coalesce(sum(amount_usd),0) from withdrawals),
        'real', st.eldorado_balance, 'real_at', st.eldorado_balance_at) from app_settings st where st.id = 1),
    'counts', (select jsonb_build_object(
        'done', count(*) filter (where status = 'Terminée'),
        'pending', count(*) filter (where status = 'En attente'),
        'cancelled', count(*) filter (where status = 'Annulée')) from orders),
    'stages', (select jsonb_build_object(
        'todo', count(*) filter (where stage = 'À attribuer'),
        'assigned', count(*) filter (where stage = 'Attribuée'),
        'doing', count(*) filter (where stage = 'En cours'),
        'delivered', count(*) filter (where stage = 'Livrée'),
        'late', count(*) filter (where deadline < now() and stage not in ('Livrée','Validée')),
        'soon', count(*) filter (where deadline >= now() and deadline < now() + interval '24 hours' and stage not in ('Livrée','Validée')))
      from orders where status <> 'Annulée'),
    'pending', (select jsonb_build_object('count', count(*), 'gross', coalesce(sum(gross),0),
        'net', coalesce(sum(net),0), 'flowey', coalesce(sum(flowey_part),0),
        'boosters', coalesce(sum(b1_part + b2_part),0))
      from orders where status = 'En attente'),
    'sources', (select jsonb_build_object(
        'Solo', coalesce(sum(o.flowey_part) filter (where sr.source = 'Solo'),0),
        'Management', coalesce(sum(o.flowey_part) filter (where sr.source = 'Management'),0),
        'Collaboration', coalesce(sum(o.flowey_part) filter (where sr.source = 'Collaboration'),0))
      from orders o join split_rules sr on sr.type = o.split_type where o.status = 'Terminée'),
    'month', (select jsonb_build_object('count', count(*), 'gross', coalesce(sum(gross),0),
        'fee', coalesce(sum(fee),0), 'net', coalesce(sum(net),0), 'flowey', coalesce(sum(flowey_part),0),
        'boosters', coalesce(sum(b1_part + b2_part),0),
        'paid', (select coalesce(sum(amount),0) from payments
                  where pay_date >= m0 and pay_date < m0 + interval '1 month'),
        'pending', (select count(*) from orders where status = 'En attente'
                  and order_date >= m0 and order_date < m0 + interval '1 month'))
      from orders where status = 'Terminée' and order_date >= m0 and order_date < m0 + interval '1 month'),
    'year', (select jsonb_agg(jsonb_build_object('m', g.m,
        'net', coalesce((select sum(net) from orders where status = 'Terminée'
                  and extract(year from order_date) = p_year and extract(month from order_date) = g.m),0),
        'flowey', coalesce((select sum(flowey_part) from orders where status = 'Terminée'
                  and extract(year from order_date) = p_year and extract(month from order_date) = g.m),0))
        order by g.m) from generate_series(1,12) as g(m)),
    'boosters', (select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
      select jsonb_build_object('id', b.id, 'name', b.name, 'active', b.active, 'availability', b.availability,
        'notes', b.notes, 'payout_method', b.payout_method, 'payout_details', b.payout_details,
        'adjusted', (select coalesce(sum(a.amount),0) from adjustments a where a.booster_id = b.id),
        'email', (select string_agg(p.email, ', ') from profiles p where p.booster_id = b.id),
        'expires_at', (select max(l.expires_at) from licenses l where l.booster_id = b.id and not l.revoked),
        'avg_hours', (select round((avg(extract(epoch from (o.delivered_at - o.started_at))) / 3600)::numeric, 1)
                   from orders o where o.delivered_at is not null and o.started_at is not null
                   and b.id in (o.booster1_id, o.booster2_id)),
        'active_orders', (select count(*) from orders o where o.status <> 'Annulée'
                   and o.stage in ('Attribuée','En cours') and b.id in (o.booster1_id, o.booster2_id)),
        'count', (select count(*) from orders o where o.status = 'Terminée'
                   and b.id in (o.booster1_id, o.booster2_id)),
        'net', (select coalesce(sum(o.net),0) from orders o where o.status = 'Terminée'
                   and b.id in (o.booster1_id, o.booster2_id)),
        'earned', (select coalesce(sum(case when o.booster1_id = b.id then o.b1_part else 0 end
                                     + case when o.booster2_id = b.id then o.b2_part else 0 end),0)
                   from orders o where o.status = 'Terminée')
                 + (select coalesce(sum(a.amount),0) from adjustments a where a.booster_id = b.id),
        'paid', (select coalesce(sum(p.amount),0) from payments p where p.booster_id = b.id),
        'pending', (select coalesce(sum(case when o.booster1_id = b.id then coalesce(o.b1_part,0) else 0 end
                                     + case when o.booster2_id = b.id then coalesce(o.b2_part,0) else 0 end),0)
                   from orders o where o.status = 'En attente')) as x
      from boosters b) s),
    'withdrawals', (select jsonb_build_object('usd', coalesce(sum(amount_usd),0),
        'fee', coalesce(sum(fee_usd),0), 'eur', coalesce(sum(amount_eur),0)) from withdrawals));
end $$;

-- ---------------------------------------------------------------------
-- PHOTOS DE PROFIL (v2.5)
-- ---------------------------------------------------------------------
alter table public.boosters add column if not exists avatar_url text;
alter table public.app_settings add column if not exists owner_avatar_url text;

-- dossier de stockage « avatars » (public en lecture, 8 Mo max, images et GIF animés)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 8388608, array['image/jpeg','image/png','image/webp','image/gif'])
    on conflict (id) do update set public = true, file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];
    execute 'drop policy if exists avatars_insert_own on storage.objects';
    execute $p$create policy avatars_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access())$p$;
    execute 'drop policy if exists avatars_delete_own on storage.objects';
    execute $p$create policy avatars_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
exception when insufficient_privilege then
  raise notice 'Stockage : droits insuffisants, crée le bucket « avatars » à la main (voir TUTO).';
end $$;

-- enregistre (ou retire avec null) ma photo de profil
create or replace function public.set_my_avatar(p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare bid uuid;
begin
  if not public.has_access() then raise exception 'Accès refusé'; end if;
  if p_url is not null and (length(p_url) > 500 or p_url !~ '^https://'
      or position('/storage/v1/object/public/avatars/' || auth.uid()::text || '/' in p_url) = 0) then
    raise exception 'Lien de photo invalide';
  end if;
  if public.is_admin() then
    update app_settings set owner_avatar_url = p_url where id = 1;
  else
    bid := public.my_booster_id();
    if bid is null then raise exception 'Compte non relié à un booster'; end if;
    update boosters set avatar_url = p_url where id = bid;
  end if;
end $$;

-- nom → photo, pour toute l'équipe (Flowey inclus)
create or replace function public.team_avatars() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_access() then
    coalesce((select jsonb_object_agg(name, avatar_url) from boosters where avatar_url is not null), '{}'::jsonb)
    || coalesce((select jsonb_build_object('Flowey', owner_avatar_url) from app_settings where id = 1 and owner_avatar_url is not null), '{}'::jsonb)
  else '{}'::jsonb end;
$$;

-- ---------------------------------------------------------------------
-- PROFILS D'ÉQUIPE (v2.9) : bio, titre, jeux, Discord, couleur, bannière
-- ---------------------------------------------------------------------
-- une ligne par membre : 'owner' pour Flowey, sinon l'id du booster
create table if not exists public.profile_cards (
  key        text primary key,
  tagline    text check (length(tagline) <= 60),
  bio        text check (length(bio) <= 600),
  games      text check (length(games) <= 200),
  discord    text check (length(discord) <= 50),
  color      text check (color ~ '^#[0-9a-fA-F]{6}$'),
  banner_url text check (length(banner_url) <= 500),
  updated_at timestamptz not null default now()
);
alter table public.profile_cards enable row level security;
drop policy if exists admin_all on public.profile_cards;
create policy admin_all on public.profile_cards for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.set_my_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v_banner text := nullif(trim(coalesce(p->>'banner_url', '')), ''); v_color text := nullif(trim(coalesce(p->>'color', '')), '');
begin
  if not public.has_access() then raise exception 'Accès refusé'; end if;
  if public.is_admin() then k := 'owner';
  else
    k := public.my_booster_id()::text;
    if k is null then raise exception 'Compte non relié à un booster'; end if;
  end if;
  if v_banner is not null and (v_banner !~ '^https://'
      or position('/storage/v1/object/public/avatars/' || auth.uid()::text || '/' in v_banner) = 0) then
    raise exception 'Lien de bannière invalide';
  end if;
  if v_color is not null and v_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Couleur invalide'; end if;
  insert into profile_cards (key, tagline, bio, games, discord, color, banner_url, updated_at)
  values (k, left(nullif(trim(coalesce(p->>'tagline', '')), ''), 60), left(nullif(trim(coalesce(p->>'bio', '')), ''), 600),
          left(nullif(trim(coalesce(p->>'games', '')), ''), 200), left(nullif(trim(coalesce(p->>'discord', '')), ''), 50),
          v_color, v_banner, now())
  on conflict (key) do update set tagline = excluded.tagline, bio = excluded.bio, games = excluded.games,
    discord = excluded.discord, color = excluded.color, banner_url = excluded.banner_url, updated_at = now();
end $$;

-- tous les profils de l'équipe (visibles par toute l'équipe)
create or replace function public.team_profiles() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_access() then '[]'::jsonb else
    (select jsonb_build_array(jsonb_build_object('key', 'owner', 'name', 'Flowey', 'role', 'Fondateur', 'me', public.is_admin(),
        'avatar', (select owner_avatar_url from app_settings where id = 1), 'availability', null, 'since', null,
        'orders', (select count(*) from orders where status = 'Terminée'),
        'tagline', c.tagline, 'bio', c.bio, 'games', c.games, 'discord', c.discord, 'color', c.color, 'banner', c.banner_url))
     from (select 1) x left join profile_cards c on c.key = 'owner')
    || coalesce((select jsonb_agg(jsonb_build_object('key', b.id::text, 'name', b.name, 'role', 'Booster',
        'me', b.id = public.my_booster_id(), 'avatar', b.avatar_url, 'availability', b.availability, 'since', b.created_at,
        'orders', (select count(*) from orders o where o.status = 'Terminée' and b.id in (o.booster1_id, o.booster2_id)),
        'tagline', c.tagline, 'bio', c.bio, 'games', c.games, 'discord', c.discord, 'color', c.color, 'banner', c.banner_url)
        order by b.name)
      from boosters b left join profile_cards c on c.key = b.id::text where b.active), '[]'::jsonb)
  end;
$$;

-- ---------------------------------------------------------------------
-- RENOMMER / SUPPRIMER UN BOOSTER (v2.6)
-- ---------------------------------------------------------------------
create or replace function public.admin_rename_booster(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if v_new = '' then raise exception 'Le nom ne peut pas être vide'; end if;
  if lower(v_new) = 'flowey' then raise exception 'Ce nom est réservé'; end if;
  select name into v_old from boosters where id = p_id;
  if v_old is null then raise exception 'Booster introuvable'; end if;
  if exists (select 1 from boosters where lower(name) = lower(v_new) and id <> p_id) then
    raise exception 'Un booster s''appelle déjà %', v_new;
  end if;
  update boosters set name = v_new where id = p_id;
  -- ses anciens messages de chat prennent aussi le nouveau nom
  update messages set author_name = v_new
  where author_name = v_old and author_id in (select id from profiles where booster_id = p_id);
end $$;

-- suppression définitive, seulement si le booster n'a encore rien fait
create or replace function public.admin_delete_booster(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Réservé à l''admin'; end if;
  if not exists (select 1 from boosters where id = p_id) then raise exception 'Booster introuvable'; end if;
  if exists (select 1 from orders where p_id in (booster1_id, booster2_id))
     or exists (select 1 from payments where booster_id = p_id)
     or exists (select 1 from adjustments where booster_id = p_id) then
    raise exception 'Ce booster a déjà des commandes, des paiements ou des gains : on ne peut pas le supprimer sans fausser les comptes. Clique plutôt sur « Actif » pour le passer en Inactif.';
  end if;
  update profiles set booster_id = null where booster_id = p_id;
  delete from boosters where id = p_id;  -- ses clés de licence, notes et notifications partent avec
end $$;

-- Droits d'exécution : jamais pour les visiteurs non connectés
do $$
declare f text;
begin
  foreach f in array array['my_access()','claim_admin()','activate_license(text)',
      'admin_create_license(uuid,int,text)','admin_extend_license(text,int)','set_my_availability(text)','set_my_payout(text,text)',
      'booster_set_stage(uuid,text)','my_orders()','my_order(uuid)','my_summary()','team_wallet()',
      'admin_dashboard(int,int)','set_my_avatar(text)','team_avatars()','admin_rename_booster(uuid,text)','admin_delete_booster(uuid)','set_my_profile(jsonb)','team_profiles()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
