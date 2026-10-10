-- =====================================================================
--  MISE À JOUR 3.9 — à coller en entier dans Supabase → SQL Editor → Run
--  (sans risque si tu l'as déjà lancée : rien n'est effacé)
-- =====================================================================
-- ---------------------------------------------------------------------
-- BOT ELDORADO v3.8 : offres automatiques, tables de prix
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists bot_auto_offers boolean not null default false;
alter table public.app_settings add column if not exists bot_auto_since timestamptz;
alter table public.eldorado_requests add column if not exists raw          jsonb;
alter table public.eldorado_requests add column if not exists category_id  text;
alter table public.eldorado_requests add column if not exists detected     jsonb;
alter table public.eldorado_requests add column if not exists profile_id   uuid;
alter table public.eldorado_requests add column if not exists offer_id     uuid;
alter table public.eldorado_requests add column if not exists offer_price  numeric(10,2);
alter table public.eldorado_requests add column if not exists offer_delivery text;
alter table public.eldorado_requests add column if not exists offer_message  text;
alter table public.eldorado_requests add column if not exists offer_state  text;
alter table public.eldorado_requests add column if not exists offer_auto   boolean;
alter table public.eldorado_requests add column if not exists offer_at     timestamptz;
alter table public.eldorado_requests add column if not exists offer_error  text;
alter table public.eldorado_requests add column if not exists skip_reason  text;

create table if not exists public.bot_price_profiles (
  id               uuid primary key default gen_random_uuid(),
  name             text not null default 'Ma table',
  game_id          text,                 -- vide = tous les jeux
  category_match   text,                 -- vide = toutes les catégories (sinon : le titre doit contenir ce texte)
  active           boolean not null default true,
  auto_send        boolean not null default true,
  ranks            jsonb not null default '[]'::jsonb,  -- [{ "name": "Gold 1", "price": 4 }] : prix pour monter AU rang depuis le précédent
  solo_only        boolean not null default false,
  duo_mult         numeric(6,2) not null default 1.5,
  min_price        numeric(10,2) not null default 0,
  max_price        numeric(10,2) not null default 0,     -- 0 = pas de plafond
  base_price       numeric(10,2) not null default 0,     -- prix si les rangs ne sont pas connus
  auto_when_unknown boolean not null default false,
  delivery         text not null default 'Day2',
  message          text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.bot_price_profiles enable row level security;
drop policy if exists admin_all on public.bot_price_profiles;
create policy admin_all on public.bot_price_profiles for all using (public.is_admin()) with check (public.is_admin());

-- plus aucune notification pour les demandes de boosting
delete from public.notifications where title = 'Demande de boosting Eldorado';

-- ---------------------------------------------------------------------
-- SOLDE & PARTS (v3.9) : Flowey écrit le solde et ce qu'il doit à chacun
-- ---------------------------------------------------------------------
-- une « correction » change ce qu'on doit à un booster sans changer le solde Eldorado calculé
alter table public.adjustments add column if not exists kind text;
create table if not exists public.balance_checks (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  balance    numeric(12,2) not null,
  flowey     numeric(12,2) not null,
  lines      jsonb not null default '[]'::jsonb,   -- [{ "booster_id", "name", "before", "owed" }]
  note       text
);
alter table public.balance_checks enable row level security;
drop policy if exists admin_all on public.balance_checks;
create policy admin_all on public.balance_checks for all using (public.is_admin()) with check (public.is_admin());

-- tableau de bord : les corrections ne changent pas le solde Eldorado calculé
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
        'adj', (select coalesce(sum(amount),0) from adjustments where kind is distinct from 'correction'),
        'withdrawn', (select coalesce(sum(amount_usd),0) from withdrawals),
        'balance', (select coalesce(sum(net),0) from orders where status = 'Terminée')
                 + (select coalesce(sum(amount),0) from adjustments where kind is distinct from 'correction')
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

grant execute on all functions in schema public to authenticated;
notify pgrst, 'reload schema';
