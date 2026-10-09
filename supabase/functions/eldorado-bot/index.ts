// =====================================================================
//  BOT ELDORADO — tourne sur Supabase (Edge Function), 24h/24, même PC éteint.
//  Utilise uniquement l'API officielle « Seller API » d'Eldorado.
//
//  Actions (POST, corps JSON { "action": ... }) :
//   - sync     : récupère les nouvelles commandes et demandes de boosting (appelé toutes les 2 min)
//   - deliver  : marque une commande livrée sur Eldorado     { orderId: "<id de la commande dans l'app>" }
//   - online / offline : passe le compte vendeur en ligne / hors ligne
//   - test     : vérifie que la connexion à Eldorado marche
//
//  Secrets à mettre dans Supabase (Edge Functions → Secrets) :
//   ELDORADO_CLIENT_ID, ELDORADO_CLIENT_SECRET, CRON_SECRET, (optionnel) DISCORD_WEBHOOK_URL
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE = 'https://www.eldorado.gg';
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

// ---------- connexion à Eldorado (jeton valable 15 min, gardé en base) ----------
async function token(): Promise<string> {
  const { data } = await sb.from('bot_secrets').select('token, token_expires').eq('id', 1).maybeSingle();
  if (data?.token && data.token_expires && new Date(data.token_expires).getTime() > Date.now() + 60_000) return data.token;
  const id = Deno.env.get('ELDORADO_CLIENT_ID'); const secret = Deno.env.get('ELDORADO_CLIENT_SECRET');
  if (!id || !secret) throw new Error('Identifiants Eldorado manquants : ajoute ELDORADO_CLIENT_ID et ELDORADO_CLIENT_SECRET dans les secrets Supabase.');
  const r = await fetch(`${BASE}/api/authentication/seller/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ clientId: id, clientSecret: secret }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Eldorado refuse la connexion (${r.status}) : ${txt.slice(0, 200)}`);
  const j = JSON.parse(txt);
  const expires = new Date(Date.now() + (Number(j.expiresIn) || 900) * 1000).toISOString();
  await sb.from('bot_secrets').upsert({ id: 1, token: j.accessToken, token_expires: expires });
  return j.accessToken;
}
async function api(method: string, path: string, body?: unknown) {
  const t = await token();
  const r = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${t}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  if (r.status === 401) await sb.from('bot_secrets').upsert({ id: 1, token: null, token_expires: null }); // jeton périmé : on en redemandera un
  if (!r.ok) throw new Error(`Eldorado ${method} ${path.split('?')[0]} → ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

// ---------- outils ----------
async function discord(content: string) {
  const url = Deno.env.get('DISCORD_WEBHOOK_URL');
  if (!url) return;
  try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900) }) }); } catch (_) { /* Discord indisponible */ }
}
async function notifyAdmin(title: string, body: string, orderId?: string) {
  await sb.from('notifications').insert({ for_admin: true, title, body, order_id: orderId ?? null });
}
async function status(patch: Record<string, unknown>) {
  await sb.from('app_settings').update(patch).eq('id', 1);
}
// « 1.02:30:00 » ou « 02:30:00 » → millisecondes
function spanMs(s?: string | null) {
  if (!s) return 0;
  const m = s.match(/^(?:(\d+)\.)?(\d+):(\d+):(\d+)/);
  if (!m) return 0;
  return ((+(m[1] || 0) * 24 + +m[2]) * 60 + +m[3]) * 60_000 + +m[4] * 1000;
}
const money = (x: any) => (x && typeof x.amount === 'number' ? Math.round(x.amount * 100) / 100 : 0);

// ---------- synchronisation ----------
async function sync() {
  const out = { newOrders: 0, updated: 0, newRequests: 0 };

  // 1) commandes vendues (les 50 plus récentes)
  const res = await api('GET', '/api/v1/orders/me/seller/orders?displayFilter=DisplaySellingOrders&isAscendingDateOrder=false&pageSize=50');
  const list: any[] = res?.results ?? [];
  if (list.length) {
    const ids = list.map((o) => o.id);
    const { data: known } = await sb.from('orders').select('id, ref, status, stage, eldorado_order_id, eldorado_state').in('eldorado_order_id', ids);
    const byId = new Map((known ?? []).map((k: any) => [k.eldorado_order_id, k]));
    for (const o of list) {
      const st: string = o.state?.state ?? '';
      const ex: any = byId.get(o.id);
      if (ex) {
        if (ex.eldorado_state !== st) {
          const patch: Record<string, unknown> = { eldorado_state: st };
          if (st === 'Canceled' && ex.status !== 'Terminée' && ex.status !== 'Annulée') {
            patch.status = 'Annulée';
            await notifyAdmin('Commande annulée sur Eldorado', `${ex.ref}`, ex.id);
          }
          await sb.from('orders').update(patch).eq('id', ex.id);
          out.updated++;
        }
        continue;
      }
      // nouvelle commande : on importe seulement celles à livrer (pas l'historique déjà saisi à la main)
      if (st !== 'Paid') continue;
      const od = o.orderOfferDetails ?? {};
      const short = String(o.id).slice(0, 8).toUpperCase();
      // une commande déjà créée à la main avec cet ID ? on la relie au lieu de la doubler
      const { data: manual } = await sb.from('orders').select('id').or(`ref.eq.${o.id},ref.eq.${short},ref.ilike.${short}%`).is('eldorado_order_id', null).limit(1);
      if (manual && manual.length) {
        await sb.from('orders').update({ eldorado_order_id: o.id, eldorado_state: st }).eq('id', manual[0].id);
        out.updated++;
        continue;
      }
      const props = [...(od.tradeEnvironmentProperties ?? []).map((p: any) => `${p.name} : ${p.value}`),
        ...(od.offerAttributesProperties ?? []).map((p: any) => `${p.name} : ${(p.values ?? []).join(', ')}`)];
      const gross = money(o.totalPrice);
      const cur = o.totalPrice?.currency;
      const deadline = spanMs(o.deliveryTime) ? new Date(new Date(o.createdDate).getTime() + spanMs(o.deliveryTime)).toISOString() : null;
      const row = {
        ref: short,
        order_date: String(o.createdDate).slice(0, 10),
        client: o.buyerUsername ?? null,
        game: od.offerTitle || od.gameCategoryTitle || od.gameId || null,
        service: od.boostingCategoryId || od.category || null,
        gross: gross > 0 ? gross : 0.01,
        status: 'En attente',
        deadline,
        notes: [cur && cur !== 'USD' ? `⚠ Prix en ${cur} (à vérifier)` : '', ...props].filter(Boolean).join('\n') || null,
        eldorado_order_id: o.id,
        eldorado_state: st,
      };
      const { data: ins, error } = await sb.from('orders').insert(row).select('id').single();
      if (error) { // ID court déjà pris : on prend l'ID complet
        const { data: ins2, error: e2 } = await sb.from('orders').insert({ ...row, ref: String(o.id) }).select('id').single();
        if (e2) throw new Error('Import commande impossible : ' + e2.message);
        await notifyAdmin('Nouvelle commande Eldorado', `${o.id} · ${row.game ?? ''} · $${gross}`, ins2.id);
      } else {
        await notifyAdmin('Nouvelle commande Eldorado', `${short} · ${row.game ?? ''} · $${gross}`, ins.id);
      }
      await discord(`🟢 **Nouvelle commande Eldorado** — \`${short}\`\n🎮 ${row.game ?? '?'}\n💵 $${gross}${row.client ? `\n👤 ${row.client}` : ''}${deadline ? `\n⏰ à livrer avant le ${new Date(deadline).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}`);
      out.newOrders++;
    }
  }

  // 2) demandes de boosting reçues (clients qui demandent un boost)
  const rq = await api('GET', '/api/boostingOffers/me/boostingRequests/received?filter=ActiveRequests&pageSize=50');
  const reqs: any[] = rq?.results ?? [];
  if (reqs.length) {
    const { data: seen } = await sb.from('eldorado_requests').select('id').in('id', reqs.map((r) => r.id));
    const seenIds = new Set((seen ?? []).map((s: any) => s.id));
    for (const r of reqs) {
      if (seenIds.has(r.id)) continue;
      await sb.from('eldorado_requests').insert({
        id: r.id, game_id: r.gameId ?? null, category: r.boostingCategoryTitle ?? r.boostingCategoryId ?? null,
        buyer: r.buyerUsername ?? null, created_date: r.createdDate ?? null,
      });
      await notifyAdmin('Demande de boosting Eldorado', `${r.boostingCategoryTitle ?? 'Boost'}${r.gameId ? ' · ' + r.gameId : ''}${r.buyerUsername ? ' · ' + r.buyerUsername : ''}`);
      await discord(`🔔 **Nouvelle demande de boosting** — ${r.boostingCategoryTitle ?? 'Boost'}${r.gameId ? ` (${r.gameId})` : ''}${r.buyerUsername ? `\n👤 ${r.buyerUsername}` : ''}\n➡ Réponds vite sur Eldorado !`);
      out.newRequests++;
    }
  }
  // demandes qui ne sont plus actives
  await sb.from('eldorado_requests').update({ active: false }).eq('active', true).not('id', 'in', `(${reqs.map((r) => r.id).join(',') || '00000000-0000-0000-0000-000000000000'})`);
  return out;
}

// ---------- qui appelle ? (la tâche planifiée, ou Flowey depuis l'app) ----------
async function isAdminCall(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data } = await sb.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: p } = await sb.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (p?.role !== 'admin') return false;
  // A2F activée : la session doit avoir été ouverte avec le code
  const { data: s } = await sb.from('app_settings').select('require_2fa').eq('id', 1).maybeSingle();
  if (s?.require_2fa) {
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!(payload.amr ?? []).some((a: any) => ['otp', 'magiclink'].includes(a.method))) return false;
    } catch (_) { return false; }
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const action = body.action ?? 'sync';
  const cron = !!Deno.env.get('CRON_SECRET') && req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET');
  if (!cron && !(await isAdminCall(req))) return reply({ error: 'Accès refusé' }, 401);
  if (cron && action !== 'sync') return reply({ error: 'Action non autorisée' }, 403);

  try {
    if (action === 'sync') {
      const r = await sync();
      await status({ eldorado_bot_last_sync: new Date().toISOString(), eldorado_bot_error: null });
      return reply({ ok: true, ...r });
    }
    if (action === 'test') {
      await token();
      const r = await api('GET', '/api/v1/orders/me/seller-api-eligibility');
      await status({ eldorado_bot_error: null });
      return reply({ ok: true, eligibility: r });
    }
    if (action === 'deliver') {
      const { data: o } = await sb.from('orders').select('id, ref, eldorado_order_id').eq('id', body.orderId).maybeSingle();
      if (!o?.eldorado_order_id) return reply({ error: 'Cette commande ne vient pas d\'Eldorado.' }, 400);
      await api('PUT', `/api/v1/orders/me/${o.eldorado_order_id}/deliver`);
      await sb.from('orders').update({ eldorado_state: 'Delivered' }).eq('id', o.id);
      return reply({ ok: true });
    }
    if (action === 'online' || action === 'offline') {
      await api('PUT', `/api/offerUser/me/${action === 'online' ? 'switchOnline' : 'switchOffline'}`);
      await status({ eldorado_online: action === 'online' });
      return reply({ ok: true });
    }
    return reply({ error: 'Action inconnue' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await status({ eldorado_bot_error: msg.slice(0, 500), eldorado_bot_last_sync: new Date().toISOString() });
    return reply({ error: msg }, 500);
  }
});
