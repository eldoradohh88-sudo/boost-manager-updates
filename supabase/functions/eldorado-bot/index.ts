// =====================================================================
//  BOT ELDORADO — tourne sur Supabase (Edge Function), 24h/24, même PC éteint.
//  Utilise uniquement l'API officielle « Seller API » d'Eldorado.
//
//  Actions (POST, corps JSON { "action": ... }) :
//   - sync      : nouvelles commandes + demandes de boosting + offres automatiques (toutes les 2 min)
//   - deliver   : marque une commande livrée sur Eldorado        { orderId }
//   - offer     : envoie / modifie une offre sur une demande      { requestId, price, delivery, message }
//   - withdraw  : retire l'offre envoyée sur une demande          { requestId }
//   - assistant : propose une table de prix à partir d'un texte   { text, profile? }
//   - online / offline : passe le compte vendeur en ligne / hors ligne
//   - test      : vérifie que la connexion à Eldorado marche
//
//  Secrets à mettre dans Supabase (Edge Functions → Secrets) :
//   ELDORADO_CLIENT_ID, ELDORADO_CLIENT_SECRET, CRON_SECRET,
//   (optionnel) DISCORD_WEBHOOK_URL, ANTHROPIC_API_KEY (assistant), ANTHROPIC_MODEL
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

const DELIVERIES = ['Hour1', 'Hour2', 'Hour3', 'Hour5', 'Hour8', 'Hour12', 'Day1', 'Day2', 'Day3', 'Day5', 'Day7', 'Day10', 'Day14', 'Day28'];

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
  if (!r.ok) throw new Error(`Eldorado ${method} ${path.split('?')[0]} → ${r.status} ${txt.slice(0, 300)}`);
  try { return txt ? JSON.parse(txt) : null; } catch (_) { return null; }
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
const r2 = (x: number) => Math.round(x * 100) / 100;

// =====================================================================
//  TABLES DE PRIX — même calcul que dans l'app (src/app.js : botPrice)
// =====================================================================
const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };
function norm(s: unknown) {
  return ' ' + String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+]+/g, ' ').replace(/\b(iv|v|iii|ii|i)\b/g, (m) => ROMAN[m]).replace(/\s+/g, ' ').trim() + ' ';
}
function flatten(x: unknown, out: string[] = []): string[] {
  if (x == null) return out;
  if (typeof x === 'object') { for (const [k, v] of Object.entries(x as Record<string, unknown>)) { if (!/id$|date$|username|buyer|muted/i.test(k)) flatten(v, out); } }
  else out.push(String(x));
  return out;
}
// cherche les rangs et le mode (solo / duo) dans les infos de la demande
function detect(profile: any, raw: unknown) {
  const text = norm(flatten(raw).join(' | '));
  const ranks: any[] = Array.isArray(profile.ranks) ? profile.ranks : [];
  const order = ranks.map((r, i) => ({ i, n: norm(r.name) })).filter((x) => x.n.trim()).sort((a, b) => b.n.length - a.n.length);
  let t = text; const found: number[] = [];
  for (const { i, n } of order) { if (t.includes(n)) { found.push(i); t = t.split(n).join(' # '); } }
  const duo = / duo /.test(text); const solo = / solo | piloted | account sharing /.test(text);
  const queue = duo && !solo ? 'duo' : solo && !duo ? 'solo' : null;
  if (found.length < 2) return { from: null, to: null, queue };
  return { from: Math.min(...found), to: Math.max(...found), queue };
}
function priceFor(profile: any, from: number, to: number, queue: string | null) {
  const ranks: any[] = profile.ranks || [];
  let p = 0;
  for (let i = from + 1; i <= to; i++) p += Number(ranks[i]?.price) || 0;
  if (queue === 'duo') p *= Number(profile.duo_mult) || 1;
  if (Number(profile.min_price) > 0) p = Math.max(p, Number(profile.min_price));
  return r2(p);
}
function fillMessage(profile: any, v: { from?: string; to?: string; price: number; queue: string | null; buyer?: string; delivery: string }) {
  const tpl = String(profile.message || '').trim();
  if (!tpl) return null;
  const del = v.delivery.replace(/^Hour(\d+)$/, (_, h) => `${h} hour${h === '1' ? '' : 's'}`).replace(/^Day(\d+)$/, (_, d) => `${d} day${d === '1' ? '' : 's'}`);
  let msg = tpl
    .replaceAll('{current}', v.from || 'your current rank').replaceAll('{target}', v.to || 'your target rank')
    .replaceAll('{price}', v.price.toFixed(2)).replaceAll('{queue}', v.queue || (profile.solo_only ? 'solo' : 'solo/duo'))
    .replaceAll('{buyer}', v.buyer || '').replaceAll('{delivery}', del);
  if (profile.solo_only && !/solo/i.test(msg)) msg += ' (Solo queue only.)';
  return msg.slice(0, 1000);
}
function pickProfile(profiles: any[], r: any) {
  const cat = String(r.boostingCategoryTitle ?? '').toLowerCase();
  return profiles
    .filter((p) => p.active && (!p.game_id || String(p.game_id) === String(r.gameId ?? '')) && (!p.category_match || cat.includes(String(p.category_match).toLowerCase())))
    .sort((a, b) => (b.game_id ? 2 : 0) + (b.category_match ? 1 : 0) - ((a.game_id ? 2 : 0) + (a.category_match ? 1 : 0)))[0] ?? null;
}
// décide si le bot peut répondre tout seul, et à quel prix
function decide(profile: any, r: any) {
  const d = detect(profile, r);
  const ranks: any[] = profile.ranks || [];
  const detected = { from: d.from != null ? ranks[d.from]?.name : null, to: d.to != null ? ranks[d.to]?.name : null, queue: d.queue };
  if (profile.solo_only && d.queue === 'duo') return { ok: false, detected, reason: 'Le client veut du duo (ta table est en solo only)' };
  let price = 0;
  if (d.from != null && d.to != null) {
    price = priceFor(profile, d.from, d.to, d.queue);
    if (Number(profile.max_price) > 0 && price > Number(profile.max_price)) return { ok: false, detected, price, reason: `Prix calculé $${price} au-dessus de ton maximum` };
  } else if (profile.auto_when_unknown && Number(profile.base_price) > 0) {
    price = r2(Number(profile.base_price));
  } else {
    return { ok: false, detected, reason: 'Eldorado ne donne pas les rangs : offre à faire à la main' };
  }
  if (!(price > 0)) return { ok: false, detected, reason: 'Prix à 0 : complète ta table de prix' };
  return { ok: true, detected, price };
}

async function postOffer(requestId: string, price: number, delivery: string, message: string | null, existingOfferId?: string | null) {
  const dl = DELIVERIES.includes(delivery) ? delivery : 'Day2';
  const pricing = { quantity: 1, minQuantity: 1, pricePerUnit: { amount: r2(price), currency: 'USD' } };
  if (existingOfferId) {
    await api('PUT', `/api/boostingOffers/${existingOfferId}/update`, { boostingRequestId: requestId, guaranteedDeliveryTime: dl, pricing, message: message || null });
    return existingOfferId;
  }
  const res = await api('POST', '/api/boostingOffers', { details: { boostingRequestId: requestId, guaranteedDeliveryTime: dl, pricing, message: message || null } });
  return res?.id ?? null;
}

// =====================================================================
//  SYNCHRONISATION
// =====================================================================
async function listRequests(filter: string) {
  try { const r = await api('GET', `/api/boostingOffers/me/boostingRequests/received?filter=${filter}&pageSize=50`); return (r?.results ?? []) as any[]; } catch (_) { return null; }
}

async function sync() {
  const out = { newOrders: 0, updated: 0, newRequests: 0, autoOffers: 0 };

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

  // 2) demandes de boosting reçues — enregistrées sans aucune notification
  const reqs = (await listRequests('ActiveRequests')) ?? [];
  if (reqs.length) {
    const { data: seen } = await sb.from('eldorado_requests').select('id').in('id', reqs.map((r) => r.id));
    const seenIds = new Set((seen ?? []).map((s: any) => s.id));
    for (const r of reqs) {
      if (seenIds.has(r.id)) { await sb.from('eldorado_requests').update({ active: true, raw: r }).eq('id', r.id); continue; }
      await sb.from('eldorado_requests').insert({
        id: r.id, game_id: r.gameId ?? null, category: r.boostingCategoryTitle ?? r.boostingCategoryId ?? null, category_id: r.boostingCategoryId ?? null,
        buyer: r.buyerUsername ?? null, created_date: r.createdDate ?? null, raw: r,
      });
      out.newRequests++;
    }
  }
  // demandes qui ne sont plus actives
  await sb.from('eldorado_requests').update({ active: false }).eq('active', true).not('id', 'in', `(${reqs.map((r) => r.id).join(',') || '00000000-0000-0000-0000-000000000000'})`);

  // 3) suivi des offres : envoyées depuis le site, gagnées, perdues
  for (const [filter, state] of [['OfferSubmitted', 'Envoyée'], ['OfferWon', 'Gagnée'], ['OfferLost', 'Perdue']] as const) {
    const l = await listRequests(filter);
    if (!l || !l.length) continue;
    const ids = l.map((r) => r.id);
    const { data: rows } = await sb.from('eldorado_requests').select('id, offer_state').in('id', ids);
    const have = new Map((rows ?? []).map((x: any) => [x.id, x.offer_state]));
    for (const r of l) {
      const cur = have.get(r.id);
      if (cur === undefined) {
        await sb.from('eldorado_requests').insert({ id: r.id, game_id: r.gameId ?? null, category: r.boostingCategoryTitle ?? null, category_id: r.boostingCategoryId ?? null,
          buyer: r.buyerUsername ?? null, created_date: r.createdDate ?? null, raw: r, active: filter === 'OfferSubmitted', offer_state: state });
      } else if (cur !== state && !(state === 'Envoyée' && (cur === 'Gagnée' || cur === 'Perdue'))) {
        await sb.from('eldorado_requests').update({ offer_state: state, offer_error: null }).eq('id', r.id);
      }
    }
  }

  // 4) offres automatiques
  const { data: st } = await sb.from('app_settings').select('bot_auto_offers, bot_auto_since').eq('id', 1).maybeSingle();
  if (st?.bot_auto_offers) {
    const { data: profiles } = await sb.from('bot_price_profiles').select('*').eq('active', true);
    let q = sb.from('eldorado_requests').select('*').eq('active', true).is('offer_state', null).is('skip_reason', null);
    if (st.bot_auto_since) q = q.gte('seen_at', st.bot_auto_since);
    const { data: todo } = await q.limit(20);
    for (const row of todo ?? []) {
      const r = row.raw ?? { id: row.id, gameId: row.game_id, boostingCategoryTitle: row.category, buyerUsername: row.buyer };
      if (r.isBuyerMuted) { await sb.from('eldorado_requests').update({ skip_reason: 'Client masqué (mute)' }).eq('id', row.id); continue; }
      const p = pickProfile(profiles ?? [], r);
      if (!p) { await sb.from('eldorado_requests').update({ skip_reason: 'Aucune table de prix pour ce jeu / cette catégorie' }).eq('id', row.id); continue; }
      if (!p.auto_send) { await sb.from('eldorado_requests').update({ skip_reason: 'Envoi auto désactivé pour la table « ' + p.name + ' »', profile_id: p.id }).eq('id', row.id); continue; }
      const d = decide(p, r);
      if (!d.ok) { await sb.from('eldorado_requests').update({ skip_reason: d.reason, detected: d.detected, profile_id: p.id }).eq('id', row.id); continue; }
      const message = fillMessage(p, { from: d.detected.from ?? undefined, to: d.detected.to ?? undefined, price: d.price!, queue: d.detected.queue, buyer: r.buyerUsername, delivery: p.delivery });
      try {
        const offerId = await postOffer(row.id, d.price!, p.delivery, message);
        await sb.from('eldorado_requests').update({ offer_id: offerId, offer_price: d.price, offer_delivery: p.delivery, offer_message: message, offer_state: 'Envoyée',
          offer_auto: true, offer_at: new Date().toISOString(), offer_error: null, detected: d.detected, profile_id: p.id }).eq('id', row.id);
        out.autoOffers++;
      } catch (e) {
        await sb.from('eldorado_requests').update({ offer_state: 'Erreur', offer_error: (e instanceof Error ? e.message : String(e)).slice(0, 500), detected: d.detected, profile_id: p.id }).eq('id', row.id);
      }
    }
  }
  return out;
}

// =====================================================================
//  ASSISTANT : « explique avec tes mots » → table de prix
// =====================================================================
const ASSISTANT_SYSTEM = `Tu aides Flowey, vendeur de boosting de jeux vidéo sur Eldorado.gg, à créer une "table de prix" pour son bot qui envoie des offres automatiquement aux demandes de boosting.
Il t'explique en français, avec ses mots, ce qu'il veut. Tu réponds UNIQUEMENT avec un objet JSON valide (pas de texte autour, pas de \`\`\`), de cette forme :
{
  "summary": "2 à 4 phrases en français qui expliquent la table proposée et les choix faits",
  "profile": {
    "name": "nom court, ex. Rocket League 2v2",
    "category_match": "mot que doit contenir la catégorie Eldorado (ex. 'Rank'), ou chaîne vide pour toutes",
    "ranks": [ { "name": "Bronze 1", "price": 0 }, { "name": "Bronze 2", "price": 1.5 } ],
    "solo_only": false,
    "duo_mult": 1.5,
    "min_price": 5,
    "max_price": 0,
    "base_price": 0,
    "auto_when_unknown": false,
    "delivery": "Day2",
    "message": "message en ANGLAIS envoyé au client avec l'offre"
  }
}
Règles :
- "ranks" = TOUS les rangs du jeu dans l'ordre, du plus bas au plus haut, avec les divisions (ex. "Diamond 1", "Diamond 2"...). Utilise des chiffres arabes pour les divisions.
- "price" de chaque rang = prix en dollars US pour monter À ce rang depuis le rang juste avant. Le premier rang a price 0. Les prix augmentent normalement avec le niveau.
- Si Flowey donne des prix par palier/tier, répartis-les sur les divisions. S'il ne donne pas de prix, propose des prix réalistes et dis-le dans summary.
- "solo_only": true s'il ne veut pas de duo queue. "duo_mult" = multiplicateur du prix en duo (1.3 à 2 en général).
- "min_price" = prix minimum d'une offre. "max_price" = au-delà, le bot n'envoie pas d'offre tout seul (0 = pas de limite).
- "base_price"/"auto_when_unknown" : prix envoyé quand Eldorado n'indique pas les rangs du client. Laisse auto_when_unknown à false sauf s'il le demande explicitement.
- "delivery" parmi : ${DELIVERIES.join(', ')}.
- "message" : court, poli, en anglais, peut utiliser {current}, {target}, {price}, {queue}, {delivery}, {buyer}. Mentionne "solo queue only" si solo_only.
- Si on te donne une table existante, modifie-la selon la demande au lieu de tout refaire.`;

async function assistant(text: string, profile?: unknown) {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error("L'assistant n'est pas activé : ajoute le secret ANTHROPIC_API_KEY dans Supabase (Edge Functions → Secrets). En attendant, utilise un modèle de table.");
  const model = Deno.env.get('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001';
  const user = (profile ? `Table actuelle :\n${JSON.stringify(profile)}\n\n` : '') + `Demande de Flowey :\n${String(text).slice(0, 4000)}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4000, system: ASSISTANT_SYSTEM, messages: [{ role: 'user', content: user }] }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Assistant indisponible (${r.status}) : ${txt.slice(0, 300)}`);
  const j = JSON.parse(txt);
  const out = (j.content ?? []).map((c: any) => c.text ?? '').join('');
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("L'assistant n'a pas renvoyé de table. Reformule ta demande.");
  const parsed = JSON.parse(m[0]);
  const p = parsed.profile ?? parsed;
  p.ranks = (Array.isArray(p.ranks) ? p.ranks : []).filter((x: any) => x && x.name).map((x: any, i: number) => ({ name: String(x.name).slice(0, 60), price: i === 0 ? 0 : r2(Number(x.price) || 0) }));
  if (!DELIVERIES.includes(p.delivery)) p.delivery = 'Day2';
  return { summary: String(parsed.summary ?? ''), profile: p };
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
    if (action === 'offer') {
      const price = r2(Number(body.price));
      if (!(price > 0)) return reply({ error: 'Prix invalide.' }, 400);
      const { data: row } = await sb.from('eldorado_requests').select('id, offer_id, offer_state').eq('id', body.requestId).maybeSingle();
      if (!row) return reply({ error: 'Demande introuvable.' }, 404);
      const keep = row.offer_state === 'Envoyée' ? row.offer_id : null;
      const delivery = DELIVERIES.includes(body.delivery) ? body.delivery : 'Day2';
      const message = body.message ? String(body.message).slice(0, 1000) : null;
      const offerId = await postOffer(row.id, price, delivery, message, keep);
      await sb.from('eldorado_requests').update({ offer_id: offerId, offer_price: price, offer_delivery: delivery, offer_message: message, offer_state: 'Envoyée',
        offer_auto: false, offer_at: new Date().toISOString(), offer_error: null, skip_reason: null, profile_id: body.profileId || null }).eq('id', row.id);
      return reply({ ok: true, offerId, updated: !!keep });
    }
    if (action === 'withdraw') {
      const { data: row } = await sb.from('eldorado_requests').select('id, offer_id').eq('id', body.requestId).maybeSingle();
      if (!row?.offer_id) return reply({ error: 'Aucune offre envoyée par l\'app sur cette demande.' }, 400);
      await api('DELETE', `/api/boostingOffers/${row.offer_id}/delete`);
      await sb.from('eldorado_requests').update({ offer_state: 'Retirée', skip_reason: 'Offre retirée' }).eq('id', row.id);
      return reply({ ok: true });
    }
    if (action === 'assistant') {
      if (!body.text || !String(body.text).trim()) return reply({ error: 'Écris ce que tu veux.' }, 400);
      return reply({ ok: true, ...(await assistant(String(body.text), body.profile)) });
    }
    if (action === 'online' || action === 'offline') {
      await api('PUT', `/api/offerUser/me/${action === 'online' ? 'switchOnline' : 'switchOffline'}`);
      await status({ eldorado_online: action === 'online' });
      return reply({ ok: true });
    }
    return reply({ error: 'Action inconnue' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (action === 'sync' || action === 'test') await status({ eldorado_bot_error: msg.slice(0, 500), eldorado_bot_last_sync: new Date().toISOString() });
    return reply({ error: msg }, 500);
  }
});
