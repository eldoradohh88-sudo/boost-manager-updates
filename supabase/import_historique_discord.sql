-- =====================================================================
--  IMPORT DE L'HISTORIQUE DISCORD (à lancer UNE SEULE FOIS, après schema.sql)
--  Reprend les gains notés dans les salons #Flowey, #Flare et #Dorsal
--  du 23/09/2026. Jewex, Vulcaano et Noxio : rien à reporter.
--  Si tu le relances par erreur, il ne fait rien (protection anti-doublon).
-- =====================================================================
do $$
declare flare uuid; dorsal uuid;
begin
  if exists (select 1 from public.adjustments where label like '[Discord]%') then
    raise notice 'Historique Discord déjà importé : rien à faire.';
    return;
  end if;
  select id into flare  from public.boosters where name = 'Flare';
  select id into dorsal from public.boosters where name = 'Dorsal';

  insert into public.adjustments (adj_date, booster_id, amount, label) values
    -- Flowey (booster_id vide = toi)
    ('2026-09-23', null,  2.70, '[Discord] boosting 2s → game placement (30 % du boosting de Jewex)'),
    ('2026-09-23', null, 18.00, '[Discord] boosting 2s d1 → gc1'),
    ('2026-09-23', null,  8.10, '[Discord] boosting 2s reward gc'),
    ('2026-09-23', null,  2.70, '[Discord] boosting 2s c3 → gc1'),
    ('2026-09-23', null,  4.50, '[Discord] boosting 2s c1 → c3'),
    ('2026-09-23', null,  5.45, '[Discord] boosting gc2 → gc3 (30 % du boosting de Jewex)'),
    -- Flare
    ('2026-09-23', flare,  0.90, '[Discord] derank 2s c3 → d2 (avec Dorsal, 50 %)'),
    ('2026-09-23', flare,  1.80, '[Discord] 2s s3 → g3'),
    ('2026-09-23', flare,  0.90, '[Discord] 2s d2 → c1'),
    ('2026-09-23', flare, 11.43, '[Discord] boosting bot'),
    ('2026-09-23', flare,  4.50, '[Discord] boosting net win d2 → c1'),
    ('2026-09-23', flare,  0.90, '[Discord] silver 3 → gold 3'),
    -- Dorsal
    ('2026-09-23', dorsal, 0.90, '[Discord] derank 2s c3 → d2 (avec Flare, 50 %)');
  raise notice 'Historique importé : Flowey 41,45 $ · Flare 20,43 $ · Dorsal 0,90 $';
end $$;
