-- =====================================================================
--  SUPPRIMER LES COMMANDES DE TEST (ex. la fausse commande de Flare)
--  1) Lance d'abord UNIQUEMENT la partie « VOIR » pour vérifier la liste.
--  2) Puis lance la partie « SUPPRIMER » en mettant les bons ID.
--  Les gains reportés depuis Discord ne sont PAS touchés.
-- =====================================================================

-- 1) VOIR toutes les commandes (les plus récentes en premier)
select o.ref as id_commande, o.order_date as date, o.gross as prix, o.split_type as type,
       b1.name as booster1, b2.name as booster2, o.status as statut
from public.orders o
left join public.boosters b1 on b1.id = o.booster1_id
left join public.boosters b2 on b2.id = o.booster2_id
order by o.created_at desc;

-- 2) SUPPRIMER : remplace TEST1 par l'ID de la fausse commande (tu peux en mettre plusieurs : 'TEST1','TEST2')
-- delete from public.orders where ref in ('TEST1');
