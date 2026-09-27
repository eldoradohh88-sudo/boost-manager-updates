/* =====================================================================
   BOOST MANAGER v2 — application
   - Côté admin (Flowey) : commandes, attribution, compta, équipe, annonces, licences
   - Côté booster : accueil, ses commandes + chat, wallet d'équipe, ses gains
   Tous les montants et toutes les règles sont calculés/contrôlés par la base.
   ===================================================================== */
'use strict';

const CFG = window.APP_CONFIG || {};
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août',
  'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const STATUSES = ['En attente', 'Terminée', 'Annulée'];
const STAGES = ['À attribuer', 'Attribuée', 'En cours', 'Livrée', 'Validée'];
const AVAIL = ['Disponible', 'Occupé', 'Absent'];
const PAY_METHODS = ['PayPal', 'Skrill', 'Revolut', 'Virement', 'Crypto', 'Autre'];
const WD_METHODS = ['Skrill', 'PayPal', 'Virement bancaire', 'Crypto', 'Autre'];
const PAGE = 50;

let sb = null;
const now = new Date();
const S = {
  access: null, view: null, orderId: null,
  year: now.getFullYear(), month: now.getMonth() + 1,
  boosters: [], rules: [], fees: [], settings: { default_split_b1: 0.5 },
  dash: null,
  orders: { page: 0, stage: '', month: '', q: '', editing: null, open: false },
  myFilter: 'active',
  payPreset: null, annPreset: null, licPreset: null, lastKey: null,
  unread: 0, chat: null, notifChannel: null, current: null, messages: [],
};

/* ---------------- utilitaires ---------------- */
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v || 0);
const money = (v) => (n(v) < 0 ? '-$' : '$') + Math.abs(n(v)).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v, d = 1) => (n(v) * 100).toLocaleString('fr-FR', { maximumFractionDigits: d }) + ' %';
const fdate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR') : '—');
const fdt = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const opt = (val, label, sel) => `<option value="${esc(val)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
const r2 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
const boosterName = (id) => (S.boosters.find((b) => b.id === id) || {}).name || '—';
const isAdmin = () => S.access && S.access.status === 'admin';
const isLate = (o) => o.deadline && new Date(o.deadline) < new Date() && !['Livrée', 'Validée'].includes(o.stage) && o.status !== 'Annulée';

function stageBadge(o) {
  if (o.status === 'Annulée') return '<span class="badge b-grey">Annulée</span>';
  const cls = { 'À attribuer': 'b-orange', 'Attribuée': 'b-blue', 'En cours': 'b-purple', 'Livrée': 'b-orange', 'Validée': 'b-green' }[o.stage] || 'b-grey';
  const label = o.stage === 'Livrée' && isAdmin() ? 'Livrée · à valider' : o.stage;
  return `<span class="badge ${cls}">${esc(label)}</span>${isLate(o) ? ' <span class="badge b-red">En retard</span>' : ''}`;
}
function availBadge(a) {
  if (!a) return '';
  const cls = { Disponible: 'b-green', 'Occupé': 'b-orange', Absent: 'b-grey' }[a] || 'b-grey';
  return `<span class="badge avail ${cls}">${esc(a)}</span>`;
}
function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 6000 : 3500);
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/duplicate key.*orders_ref_key/.test(m)) return 'Cet ID de commande existe déjà.';
  if (/duplicate key.*boosters_name_key/.test(m)) return 'Ce booster existe déjà.';
  if (/duplicate key.*fee_rates/.test(m)) return 'Un taux existe déjà à cette date.';
  if (/Invalid login credentials/i.test(m)) return 'Email ou mot de passe incorrect.';
  if (/User already registered/i.test(m)) return 'Un compte existe déjà avec cet email : clique sur « Se connecter ».';
  if (/Password should be/i.test(m)) return 'Mot de passe trop court (6 caractères minimum).';
  if (/Error sending (magic link|confirmation|recovery)? ?email|smtp|535|authentication failed/i.test(m)) return "Supabase n'arrive pas à envoyer l'email : vérifie les réglages SMTP (Brevo) dans Supabase. Détail : " + m;
  if (/rate limit/i.test(m)) return "Trop d'emails envoyés : attends un peu, ou augmente la limite dans Supabase → Authentication → Rate Limits. Détail : " + m;
  if (/Signups not allowed for otp|otp_disabled/i.test(m)) return "La connexion par code est désactivée dans Supabase (Sign In / Providers → Email). Détail : " + m;
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion à la base. Vérifie Internet et src/config.js.';
  return m;
}
async function run(promise) {
  const { data, error, count } = await promise;
  if (error) throw error;
  return count !== undefined && count !== null ? { data, count } : data;
}
function field(label, inner, extra = '') {
  // extra peut contenir class="field span-2" : on fusionne au lieu de doubler l'attribut class
  const m = extra.match(/class="([^"]*)"/);
  const cls = m ? m[1] : 'field';
  const rest = m ? extra.replace(m[0], '') : extra;
  return `<div class="${cls}" ${rest}><label>${esc(label)}</label>${inner}</div>`;
}
function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  return o;
}
function kpi(label, value, cls = '') {
  return `<div class="kpi ${cls}"><div class="label">${esc(label)}</div><div class="value">${value}</div></div>`;
}
function modal(html, cls = '') {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.id = 'modal';
  bg.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  document.body.appendChild(bg);
}
function closeModal() { const m = $('#modal'); if (m) m.remove(); }

/* ---------------- icônes & éléments d'interface ---------------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/>',
  megaphone: '<path d="M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8.5a5 5 0 0 1 0 7"/><path d="M18 5.5a9 9 0 0 1 0 13"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  clip: '<path d="m21 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.8-8.8"/><path d="m16 7 3 3"/><path d="m18.5 4.5 2 2"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  play: '<path d="m6 4 14 8-14 8z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
};
const ic = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
/* ---------------- thème (couleurs tirées de logo.png) ---------------- */
let themeKeys = [];
function applyTheme(vars) {
  const root = document.documentElement;
  themeKeys.forEach((k) => root.style.removeProperty(k)); // on repart du thème par défaut
  themeKeys = [];
  S.currentTheme = vars || null;
  if (vars && typeof vars === 'object') {
    Object.keys(vars).forEach((k) => { if (/^--[a-z0-9-]+$/.test(k)) { root.style.setProperty(k, String(vars[k])); themeKeys.push(k); } });
  }
  applyAccentOverride();
}
const logoSrc = () => S.logoUrl || 'logo.png';
async function initTheme() {
  try { applyTheme(JSON.parse(localStorage.getItem('bm_theme') || 'null')); } catch (_) { /* rien */ }
  if (!window.desktop || !window.desktop.theme) return;
  try { const l = await window.desktop.logo(); S.logoUrl = l.url; S.customLogo = l.custom; } catch (_) { /* logo par défaut */ }
  try {
    const vars = await window.desktop.theme();
    S.baseTheme = vars;
    if (vars) { applyTheme(vars); try { localStorage.setItem('bm_theme', JSON.stringify(vars)); } catch (_) { /* rien */ } }
    else { try { localStorage.removeItem('bm_theme'); } catch (_) { /* rien */ } }
  } catch (_) { /* thème par défaut */ }
}

/* ---------------- préférences personnelles (propres à chaque PC) ---------------- */
const LOW_END = (navigator.hardwareConcurrency || 8) <= 4;
const PREF_DEFAULTS = {
  accent: '', zoom: '1', corners: 'round', anim: true, effects: !LOW_END, bannerColors: true,
  sound: true, volume: 0.6, soundKind: 'chime', sOrder: true, sAnnounce: true, sMessage: true, sPayment: true, winNotif: true,
};
function prefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('bm_prefs') || '{}') || {}; } catch (_) { p = {}; }
  return { ...PREF_DEFAULTS, ...p };
}
function setPref(k, v) {
  const p = prefs(); p[k] = v;
  try { localStorage.setItem('bm_prefs', JSON.stringify(p)); } catch (_) { /* rien */ }
  applyPrefs();
}
function applyPrefs() {
  const p = prefs(); const cl = document.body.classList;
  cl.toggle('no-anim', !p.anim);
  cl.toggle('no-effects', !p.effects);
  cl.toggle('square', p.corners === 'square');
  cl.toggle('extra-round', p.corners === 'extra');
  if (window.desktop && window.desktop.setZoom) window.desktop.setZoom(Number(p.zoom) || 1).catch(() => {});
}
function hexHsl(hex) {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16 & 255) / 255; const g = (v >> 8 & 255) / 255; const b = (v & 255) / 255;
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const l = (mx + mn) / 2;
  let h = 0; let s = 0;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
// couleur principale choisie à la main (sinon : automatique, d'après le logo ou la bannière)
function applyAccentOverride() {
  const p = prefs();
  if (!/^#[0-9a-f]{6}$/i.test(p.accent || '')) return;
  const [h, s0, l0] = hexHsl(p.accent);
  const s = Math.max(45, s0); const l = Math.min(70, Math.max(52, l0));
  const root = document.documentElement;
  const set = (k, v) => { root.style.setProperty(k, v); if (!themeKeys.includes(k)) themeKeys.push(k); };
  set('--accent', `hsl(${h} ${s}% ${l}%)`);
  set('--accent-2', `hsl(${h} ${s}% ${Math.min(88, l + 14)}%)`);
  set('--accent-soft', `hsl(${h} ${s}% ${l}% / .14)`);
  set('--accent-line', `hsl(${h} ${s}% ${l}% / .45)`);
  set('--accent-glow', `hsl(${h} ${s}% ${l}% / .32)`);
  set('--accent-ink', l > 60 ? `hsl(${h} 45% 12%)` : '#ffffff');
}

/* ---------------- sons de notification (créés par l'app, aucun fichier) ---------------- */
let audioCtx = null;
const SOUNDS = [['chime', 'Carillon'], ['pop', 'Pop'], ['bell', 'Cloche'], ['soft', 'Doux'], ['arcade', 'Arcade']];
function playSound(kind, force) {
  const p = prefs();
  if (!force && !p.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx; const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain(); master.gain.value = Math.max(0, Math.min(1, Number(p.volume))) * 0.5; master.connect(ctx.destination);
    const note = (freq, start, dur, type = 'sine', g = 1) => {
      const o = ctx.createOscillator(); const e = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      e.gain.setValueAtTime(0.0001, t0 + start);
      e.gain.exponentialRampToValueAtTime(g, t0 + start + 0.015);
      e.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(e); e.connect(master); o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    };
    const k = kind || p.soundKind;
    if (k === 'pop') { note(660, 0, 0.12, 'triangle'); note(990, 0.07, 0.14, 'triangle', 0.7); }
    else if (k === 'bell') { [523, 1046, 1568].forEach((f, i) => note(f, 0, 1.2 - i * 0.25, 'sine', 1 / (i + 1))); }
    else if (k === 'soft') { note(440, 0, 0.5, 'sine', 0.8); note(660, 0.12, 0.6, 'sine', 0.6); }
    else if (k === 'arcade') { [523, 659, 784, 1046].forEach((f, i) => note(f, i * 0.07, 0.1, 'square', 0.3)); }
    else { note(880, 0, 0.35); note(1320, 0.12, 0.5, 'sine', 0.8); }
  } catch (_) { /* pas de sortie audio */ }
}
function notifKind(title) {
  if (/^Message/.test(title)) return 'sMessage';
  if (/^(Annonce|Note de)/.test(title)) return 'sAnnounce';
  if (/^Paiement/.test(title)) return 'sPayment';
  return 'sOrder';
}

/* ---------------- réglages personnels (Paramètres, pour tout le monde) ---------------- */
function onOff(key, label, help = '') {
  const v = prefs()[key];
  return field(label, `<select data-change="pref" data-key="${key}" data-type="bool">${opt('1', 'Activé', !!v)}${opt('0', 'Désactivé', !v)}</select>${help ? `<div class="muted small" style="margin-top:4px">${help}</div>` : ''}`);
}
function personalSettingsHtml() {
  const p = prefs();
  const accent = /^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : '';
  return `<h2 class="section-title">${ic('sparkles')} Mes réglages <span class="muted small">— seulement sur ce PC</span></h2>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h2>Apparence</h2></div>
      <div class="form-grid">
        ${field('Couleur principale', `<div style="display:flex;gap:8px;align-items:center"><input type="color" data-change="pref" data-key="accent" value="${accent || '#5b8def'}" style="width:70px">
          <button type="button" class="sm ${accent ? '' : 'primary'}" data-action="pref-accent-auto">Automatique</button></div>
          <div class="muted small" style="margin-top:4px">${accent ? 'Couleur choisie à la main.' : 'Automatique : suit ton logo ou ta bannière.'}</div>`)}
        ${field('Taille de l\'interface', `<select data-change="pref" data-key="zoom">${[['0.85', 'Petite'], ['1', 'Normale'], ['1.1', 'Grande'], ['1.25', 'Très grande']].map(([v, l]) => opt(v, l, String(p.zoom) === v)).join('')}</select>`)}
        ${field('Coins', `<select data-change="pref" data-key="corners">${opt('square', 'Carrés', p.corners === 'square')}${opt('round', 'Arrondis', p.corners === 'round')}${opt('extra', 'Très arrondis', p.corners === 'extra')}</select>`)}
        ${onOff('anim', 'Animations')}
        ${onOff('effects', 'Effets visuels (halos, flous)', 'Désactive si ton PC rame.')}
        ${onOff('bannerColors', 'Couleurs qui suivent la bannière')}
        ${window.desktop && window.desktop.setGpu ? field('Accélération graphique', `<select data-change="gpu"><option value="1" ${S.gpu !== false ? 'selected' : ''}>Activée</option><option value="0" ${S.gpu === false ? 'selected' : ''}>Désactivée</option></select>
          <div class="muted small" style="margin-top:4px">Si l'app fait bugger ton PC : désactive (l'app redémarre).</div>`) : ''}
      </div></div>
    <div class="card"><div class="card-head"><h2>Sons et notifications</h2></div>
      <div class="form-grid">
        ${onOff('sound', 'Son des notifications')}
        ${field('Son', `<div style="display:flex;gap:8px"><select data-change="pref" data-key="soundKind">${SOUNDS.map(([v, l]) => opt(v, l, p.soundKind === v)).join('')}</select>
          <button type="button" class="sm" data-action="sound-test">▶ Tester</button></div>`)}
        ${field('Volume', `<input type="range" min="0" max="1" step="0.05" value="${Number(p.volume)}" data-change="pref" data-key="volume" data-type="num">`)}
        ${onOff('sOrder', 'Son : commandes')}
        ${onOff('sAnnounce', 'Son : annonces et notes')}
        ${onOff('sMessage', 'Son : messages du chat')}
        ${onOff('sPayment', 'Son : paiements')}
        ${onOff('winNotif', 'Notifications Windows', 'Petite fenêtre en bas à droite quand l\'app est en arrière-plan.')}
      </div></div>
  </div>
  ${logoCard()}
  ${bannerCard()}
  <div class="card"><div class="card-head"><h2>${ic('users')} Mon profil</h2></div>
    <p class="muted small">Photo (GIF accepté), bannière de profil, titre, bio, jeux, Discord, couleur : ce que l'équipe voit dans l'onglet Profils.</p>
    <div class="form-actions"><button class="primary" data-action="my-profile">${ic('users')} Modifier mon profil</button></div></div>
  ${securityCard()}`;
}
function securityCard() {
  if (!isAdmin()) {
    return `<div class="card"><div class="card-head"><h2>${ic('key')} Sécurité</h2></div>
      <p class="muted small">Si Flowey active la double authentification, tu recevras à chaque connexion un code à 6 chiffres par email (valable 10 minutes).</p></div>`;
  }
  const on = !!(S.settings && S.settings.require_2fa);
  return `<div class="card"><div class="card-head"><h2>${ic('key')} Double authentification (A2F)</h2>
      <span class="badge ${on ? 'b-green' : 'b-grey'}">${on ? 'Activée' : 'Désactivée'}</span></div>
    <p class="muted small">Quand elle est activée, chaque connexion demande un <b>code à 6 chiffres envoyé par email</b>, valable 10 minutes. Sans ce code, impossible de voir la moindre donnée, même avec le bon mot de passe.</p>
    ${on ? '<div class="form-actions"><button class="danger" data-action="2fa-off">Désactiver l\'A2F</button></div>'
    : `<ol class="muted small"><li>Configure l'envoi d'emails dans Supabase (voir le message de Claude).</li>
        <li>Clique sur <b>Tester</b> : tu reçois un code, tape-le.</li><li>Si le test marche, le bouton <b>Activer</b> se débloque.</li></ol>
      <div class="form-actions"><button data-action="2fa-test">${ic('send')} Tester l'envoi du code</button>
        <button class="primary" data-action="2fa-on" ${S.otpTested ? '' : 'disabled'}>Activer l'A2F pour toute l'équipe</button></div>`}</div>`;
}
async function viewMySettings(main) {
  if (window.desktop && window.desktop.gpu) { try { S.gpu = await window.desktop.gpu(); } catch (_) { /* rien */ } }
  main.innerHTML = `${head('Paramètres', 'Personnalise ton app : couleurs, logo, bannière, sons, profil')}${personalSettingsHtml()}`;
}

/* ---------------- A2F : code à 6 chiffres par email ---------------- */
// selon la version de Supabase, le code s'appelle « email » ou « magiclink »
async function verifyCode(token) {
  let r = await sb.auth.verifyOtp({ email: S.access.email, token, type: 'email' });
  if (r.error) {
    const r2 = await sb.auth.verifyOtp({ email: S.access.email, token, type: 'magiclink' });
    if (!r2.error) return r2;
  }
  return r;
}
let otpTimer = null;
async function sendOtp() {
  const email = S.access && S.access.email;
  if (!email) throw new Error('Adresse email inconnue.');
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
  S.otpSentAt = Date.now();
}
function otpBoxes() {
  return `<div class="otp-boxes">${[0, 1, 2, 3, 4, 5].map((i) => `<input class="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" data-i="${i}">`).join('')}</div>`;
}
function otpValue(root) { return [...root.querySelectorAll('input.otp')].map((x) => x.value).join(''); }
function tickOtp() {
  const el = $('#otp-timer'); const btn = $('#otp-resend');
  if (!el) { clearInterval(otpTimer); otpTimer = null; return; }
  const left = Math.max(0, (S.otpSentAt || 0) + 600000 - Date.now());
  el.textContent = left ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}` : 'expiré';
  el.classList.toggle('red', !left);
  if (btn) btn.disabled = Date.now() - (S.otpSentAt || 0) < 60000;
}
function render2FA(error = '') {
  const email = (S.access && S.access.email) || '';
  $('#app').innerHTML = `<div class="center-screen"><form class="auth-card" data-form="otp">
    <div class="brand"><img class="logo" src="${logoSrc()}" alt=""><h1>Vérification</h1></div>
    <p class="muted">Un code à <b>6 chiffres</b> a été envoyé à <b>${esc(email)}</b>.<br>Il expire dans <b id="otp-timer">10:00</b>.</p>
    ${otpBoxes()}
    <div class="form-actions"><button class="primary" type="submit">Valider</button>
      <button type="button" id="otp-resend" data-action="otp-resend">Renvoyer un code</button>
      <button type="button" data-action="logout">Se déconnecter</button></div>
    ${error ? `<div class="error-box">${esc(error)}</div>` : ''}
    <p class="muted small">Pas reçu ? Regarde dans les spams. Tu peux redemander un code au bout d'une minute.</p></form></div>`;
  const first = document.querySelector('input.otp'); if (first) first.focus();
  if (otpTimer) clearInterval(otpTimer);
  otpTimer = setInterval(tickOtp, 1000); tickOtp();
}
async function start2FA() {
  let err = '';
  if (!S.otpSentAt || Date.now() - S.otpSentAt > 600000) {
    try { await sendOtp(); } catch (e) { err = 'Envoi du code impossible : ' + errMsg(e); }
  }
  render2FA(err);
}

/* ---------------- logo personnel (propre à chaque PC) ---------------- */
function logoCard() {
  if (!window.desktop || !window.desktop.setLogo) return '';
  return `<div class="card"><div class="card-head"><h2>${ic('sparkles')} Logo de mon app</h2></div>
    <div class="avatar-edit"><img class="logo" style="width:96px;height:96px" src="${logoSrc()}" alt="">
      <div><p class="muted small">Choisis n'importe quelle image : elle devient l'icône de ton app <b>dans la barre des tâches, sur le bureau et dans le menu Démarrer</b>, et l'app prend ses couleurs. Ça ne change que chez toi, pas chez le reste de l'équipe.</p>
      <label class="btn primary">${ic('download')} Choisir un logo<input type="file" accept="image/*" data-change="logo-file" hidden></label>
      ${S.customLogo ? '<button class="ghost" data-action="logo-reset">Revenir au logo de base</button>' : ''}</div></div></div>`;
}
function logoToPng(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Ce fichier n\'est pas une image.'));
    if (file.size > 25 * 1024 * 1024) return reject(new Error('Image trop lourde (25 Mo max).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 512; const c = document.createElement('canvas'); c.width = size; c.height = size;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}
function logoApplied(r) {
  S.logoUrl = r.url; S.customLogo = r.custom;
  S.baseTheme = r.theme;
  if (!S.bannerUrl) applyTheme(r.theme);
  try { if (r.theme) localStorage.setItem('bm_theme', JSON.stringify(r.theme)); else localStorage.removeItem('bm_theme'); } catch (_) { /* rien */ }
  document.querySelectorAll('img.logo').forEach((el) => { el.src = logoSrc(); });
}

/* ---------------- bannière de fond (image ou GIF) + couleurs qui la suivent ---------------- */
let bannerTimer = null;
let lastBannerPalette = '';
function bannerOpacity() { try { return localStorage.getItem('bm_banner_op') || '.4'; } catch (_) { return '.4'; } }
function stopBannerColors() { if (bannerTimer) clearInterval(bannerTimer); bannerTimer = null; lastBannerPalette = ''; }
let lastBannerApply = 0;
function applyBannerPalette(pal, force) {
  if (!pal) return; // image en noir et blanc à cet instant : on garde les couleurs actuelles
  const key = JSON.stringify(pal);
  if (key === lastBannerPalette) return;
  if (!force && Date.now() - lastBannerApply < 1800) return; // pas plus d'un changement de couleurs toutes les ~2 s
  lastBannerPalette = key; lastBannerApply = Date.now();
  applyTheme(pal);
}
function paletteOf(source, ctx) {
  ctx.clearRect(0, 0, 48, 48);
  ctx.drawImage(source, 0, 0, 48, 48);
  return window.BMTheme.paletteFromBitmap(ctx.getImageData(0, 0, 48, 48).data, 48, 48, true);
}
// lit chaque image du GIF et calcule ses couleurs, avec le moment où elle apparaît
async function bannerTimeline(url, ctx) {
  if (typeof ImageDecoder === 'undefined') return null;
  const m = url.match(/^data:([^;]+);base64,/);
  if (!m) return null;
  const bin = atob(url.slice(m[0].length));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > 12 * 1024 * 1024) return null; // GIF très lourd : on garde une couleur fixe
  const dec = new ImageDecoder({ data: bytes, type: m[1] });
  try {
    await dec.tracks.ready;
    if (dec.tracks.selectedTrack && dec.tracks.selectedTrack.frameCount > 300) return null;
    const count = Math.min(dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1, 240);
    const every = Math.max(1, Math.ceil(count / 24)); // au plus ~24 relevés de couleur (léger pour le processeur)
    const steps = []; let t = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const d = image.duration ? image.duration / 1000 : 100; // en ms
      if (i % every === 0) steps.push({ at: t, pal: paletteOf(image, ctx) });
      image.close();
      t += Math.max(d, 20);
    }
    return { steps, total: t };
  } finally { dec.close(); }
}
async function initBanner() {
  stopBannerColors();
  const box = document.getElementById('banner-bg');
  if (!box || !window.desktop || !window.desktop.banner) return;
  let url = null;
  try { url = await window.desktop.banner(); } catch (_) { /* pas de bannière */ }
  S.bannerUrl = url;
  document.documentElement.style.setProperty('--banner-opacity', bannerOpacity());
  const img = box.querySelector('img');
  if (!url) { img.removeAttribute('src'); document.body.classList.remove('has-banner'); applyTheme(S.baseTheme); return; }
  document.body.classList.add('has-banner');
  const c = document.createElement('canvas'); c.width = 48; c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  await new Promise((res) => { img.onload = res; img.onerror = res; img.src = url; });
  const pf = prefs();
  if (!pf.bannerColors) { applyTheme(S.baseTheme); return; } // l'utilisateur garde les couleurs du logo
  const start = performance.now();
  let tl = null;
  if (pf.effects) {
    await new Promise((r) => setTimeout(r, 800)); // on laisse l'app s'afficher d'abord
    try { tl = await bannerTimeline(url, ctx); } catch (_) { tl = null; }
  }
  if (!tl || tl.steps.length <= 1) { // image fixe (ou décodeur absent) : une seule couleur
    try { applyBannerPalette(tl && tl.steps[0] ? tl.steps[0].pal : paletteOf(img, ctx), true); } catch (_) { /* rien */ }
    return;
  }
  // GIF animé : les couleurs de l'app suivent l'animation
  const tick = () => {
    if (document.hidden) return;
    const t = (performance.now() - start) % tl.total;
    let cur = tl.steps[0];
    for (const st of tl.steps) { if (st.at <= t) cur = st; else break; }
    applyBannerPalette(cur.pal);
  };
  tick();
  bannerTimer = setInterval(tick, 500);
}
function bannerCard() {
  if (!window.desktop || !window.desktop.setBanner) return '';
  const op = bannerOpacity();
  return `<div class="card"><div class="card-head"><h2>${ic('sparkles')} Bannière de fond</h2></div>
    <div class="avatar-edit">${S.bannerUrl ? `<img class="banner-preview" src="${S.bannerUrl}" alt="">` : '<div class="banner-preview"></div>'}
      <div><p class="muted small">Une image ou un <b>GIF animé</b> en fond de l'app. Les couleurs de l'app suivent la bannière et changent en même temps qu'elle. Seulement chez toi.</p>
      <label class="btn primary">${ic('download')} Choisir une bannière<input type="file" accept="image/gif,image/png,image/jpeg,image/webp" data-change="banner-file" hidden></label>
      ${S.bannerUrl ? '<button class="ghost" data-action="banner-reset">Retirer la bannière</button>' : ''}
      ${S.bannerUrl ? `<div class="form-grid" style="margin-top:10px">${field('Visibilité', `<select data-change="banner-op">${opt('.25', 'Discrète', op === '.25')}${opt('.4', 'Normale', op === '.4')}${opt('.6', 'Forte', op === '.6')}${opt('.85', 'Maximum', op === '.85')}</select>`)}</div>` : ''}</div></div></div>`;
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Fichier illisible.'));
    r.readAsDataURL(file);
  });
}

/* =====================================================================
   PROFILS D'ÉQUIPE : bio, titre, jeux, Discord, couleur, bannière
   ===================================================================== */
async function loadProfiles(force = false) {
  if (!force && S.profiles && S.profilesAt && Date.now() - S.profilesAt < 60000) return S.profiles;
  S.profiles = (await run(sb.rpc('team_profiles'))) || [];
  S.profilesAt = Date.now();
  return S.profiles;
}
const myProfile = () => (S.profiles || []).find((p) => p.name === myName()) || { name: myName() };
const pColor = (p) => (p && /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '');
function sinceText(d) {
  if (!d) return '';
  return 'Dans l\'équipe depuis ' + new Date(d).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
function gameChips(games) {
  const list = String(games || '').split(/[,;\n]+/).map((g) => g.trim()).filter(Boolean).slice(0, 12);
  return list.length ? `<div class="chips">${list.map((g) => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : '';
}
function profileBanner(p, cls = 'pbanner') {
  return p.banner ? `<div class="${cls}"><img src="${esc(p.banner)}" alt=""></div>` : `<div class="${cls} empty"></div>`;
}
function profileCardHtml(p) {
  const c = pColor(p);
  return `<button class="pcard" data-action="profile" data-name="${esc(p.name)}" ${c ? `style="--pc:${c}"` : ''}>
    ${profileBanner(p)}
    <div class="pbody">${avatarHtml(p.name, 'lg pav')}
      <div class="pname">${esc(p.name)}${p.me ? ' <span class="muted small">(toi)</span>' : ''}</div>
      <div class="ptag">${esc(p.tagline || p.role || '')}</div>
      <div class="pmeta">${p.availability ? availBadge(p.availability) : `<span class="badge b-purple">${esc(p.role || '')}</span>`}
        <span class="muted small">${n(p.orders)} commande${n(p.orders) > 1 ? 's' : ''}</span></div></div></button>`;
}
async function viewProfiles(main) {
  const list = await loadProfiles(true);
  main.innerHTML = `${head('Profils', 'Toute l\'équipe : clique sur quelqu\'un pour voir son profil', `<button class="primary" data-action="my-profile">${ic('users')} Modifier mon profil</button>`)}
    <div class="profiles-grid">${list.map(profileCardHtml).join('')}</div>`;
}
async function openProfile(name) {
  if (!S.profiles || !S.profiles.some((p) => p.name === name)) { try { await loadProfiles(); } catch (_) { /* hors ligne */ } }
  const p = (S.profiles || []).find((x) => x.name === name);
  if (!p) return toast('Profil introuvable', 'error');
  const c = pColor(p);
  modal(`<div class="pmodal" ${c ? `style="--pc:${c}"` : ''}>
    ${profileBanner(p, 'pbanner big')}
    <button type="button" class="sm ghost pclose" data-action="close-modal">${ic('x')}</button>
    <div class="pbody">${avatarHtml(p.name, 'lg pav')}
      <div class="pname big">${esc(p.name)}</div>
      <div class="ptag">${esc(p.tagline || p.role || '')}</div>
      <div class="pmeta">${p.availability ? availBadge(p.availability) : `<span class="badge b-purple">${esc(p.role || '')}</span>`}
        <span class="muted small">${n(p.orders)} commande${n(p.orders) > 1 ? 's' : ''} ${p.key === 'owner' ? 'gérées' : 'terminées'}</span>
        ${p.since ? `<span class="muted small">${esc(sinceText(p.since))}</span>` : ''}</div>
      ${p.bio ? `<div class="psection"><h3>Bio</h3><div class="pbio">${esc(p.bio)}</div></div>` : ''}
      ${p.games ? `<div class="psection"><h3>Jeux</h3>${gameChips(p.games)}</div>` : ''}
      ${p.discord ? `<div class="psection"><h3>Discord</h3><div class="secret-row"><code>${esc(p.discord)}</code>
        <button class="sm" data-action="copy" data-text="${esc(p.discord)}">Copier</button></div></div>` : ''}
      ${!p.bio && !p.games && !p.discord ? `<p class="muted small">${p.me ? 'Ton profil est encore vide.' : esc(p.name) + ' n\'a pas encore rempli son profil.'}</p>` : ''}
      ${p.me ? `<div class="form-actions"><button class="primary" data-action="my-profile">${ic('users')} Modifier mon profil</button></div>`
    : `<div class="form-actions"><button class="primary" data-action="chat-with" data-key="${esc(p.key)}">${ic('send')} Envoyer un message</button></div>`}
    </div></div>`, 'small profile');
}
async function openMyProfile() {
  try { await loadProfiles(true); } catch (e) { return toast(errMsg(e), 'error'); }
  const p = myProfile();
  S.editBanner = p.banner || null;
  const c = pColor(p) || '#5b8def';
  modal(`<form data-form="profile" class="pedit">
    <div class="card-head"><h2>${ic('users')} Mon profil</h2><button type="button" class="sm ghost" data-action="close-modal">${ic('x')}</button></div>
    <p class="muted small">Visible par toute l'équipe dans l'onglet <b>Profils</b>.</p>
    <div class="pedit-media">
      <div id="pedit-banner">${profileBanner({ banner: S.editBanner }, 'pbanner')}</div>
      <div class="form-actions" style="margin-top:8px">
        <label class="btn">${ic('download')} Bannière (image ou GIF, 8 Mo max)<input type="file" accept="image/gif,image/png,image/jpeg,image/webp" data-change="profile-banner" hidden></label>
        <button type="button" class="ghost" data-action="profile-banner-clear">Sans bannière</button>
        <button type="button" data-action="avatar">${ic('users')} Changer ma photo</button>
      </div>
    </div>
    <div class="form-grid">
      ${field('Titre (sous ton nom)', `<input name="tagline" maxlength="60" value="${esc(p.tagline || '')}" placeholder="ex. Main Jett · Radiant">`, 'class="field span-2"')}
      ${field('Couleur du profil', `<input name="color" type="color" value="${esc(c)}">`)}
      ${field('Bio', `<textarea name="bio" maxlength="600" placeholder="Présente-toi en quelques lignes">${esc(p.bio || '')}</textarea>`, 'class="field span-all"')}
      ${field('Jeux (séparés par des virgules)', `<input name="games" maxlength="200" value="${esc(p.games || '')}" placeholder="Valorant, Rocket League, LoL">`, 'class="field span-2"')}
      ${field('Discord', `<input name="discord" maxlength="50" value="${esc(p.discord || '')}" placeholder="pseudo">`)}
    </div>
    <div class="form-actions"><button class="primary" type="submit">${ic('check')} Enregistrer</button>
      <button type="button" data-action="profile" data-name="${esc(myName())}">Voir mon profil</button></div></form>`, 'small');
}
async function uploadProfileBanner(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Ce fichier n\'est pas une image.');
  const gif = file.type === 'image/gif';
  let blob = file; let type = file.type; let ext = { 'image/gif': 'gif', 'image/png': 'png', 'image/webp': 'webp' }[file.type] || 'jpg';
  if (!gif) { // image fixe : réduite à 1500 px de large en JPG
    blob = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const w = Math.min(1500, img.naturalWidth); const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible.'))), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
      img.src = url;
    });
    type = 'image/jpeg'; ext = 'jpg';
  }
  if (blob.size > 8 * 1024 * 1024) throw new Error('Bannière trop lourde (8 Mo max). Réduis ton GIF sur ezgif.com par exemple.');
  if (!S.uid) { const { data } = await sb.auth.getUser(); S.uid = data && data.user && data.user.id; }
  const path = `${S.uid}/banner-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw error;
  return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

/* =====================================================================
   MESSAGERIE D'ÉQUIPE : groupe général + messages privés (temps réel)
   ===================================================================== */
const myKey = () => (isAdmin() ? 'owner' : (S.access && S.access.booster_id) || '');
const dmChannel = (a, b) => 'dm:' + [a, b].sort().join(':');
function chanOther(ch) {
  if (!ch || ch === 'general') return null;
  const [a, b] = ch.slice(3).split(':');
  return a === myKey() ? b : a;
}
function memberByKey(k) { return (S.profiles || []).find((p) => p.key === k) || null; }
function chanTitle(ch) {
  if (ch === 'general') return 'Général';
  const m = memberByKey(chanOther(ch));
  return m ? m.name : 'Conversation';
}
const readKey = () => 'bm_chat_read_' + ((S.access && S.access.email) || '');
function chatRead() { try { return JSON.parse(localStorage.getItem(readKey()) || '{}') || {}; } catch (_) { return {}; } }
function markChatRead(ch, at) {
  const r = chatRead(); r[ch] = at || new Date().toISOString();
  try { localStorage.setItem(readKey(), JSON.stringify(r)); } catch (_) { /* rien */ }
}
function chatUnreadTotal() { return Object.values(S.chatUnread || {}).reduce((a, b) => a + b, 0); }
function updateChatBadge() {
  const btn = document.querySelector('.nav-item[data-view="chat"]');
  if (!btn || !btn.querySelector) return;
  let b = btn.querySelector('.nav-badge');
  const n0 = chatUnreadTotal();
  if (!n0) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; btn.appendChild(b); }
  b.textContent = n0 > 99 ? '99+' : n0;
}
// compte les messages non lus (au démarrage et à l'ouverture de Messages)
async function loadChatSummary() {
  const rows = await run(sb.from('team_messages').select('id, channel, author_key, author_name, body, file_name, created_at').order('created_at', { ascending: false }).limit(400));
  const read = chatRead(); const unread = {}; const last = {};
  for (const m of rows) {
    if (!last[m.channel]) last[m.channel] = m;
    if (m.author_key !== myKey() && m.created_at > (read[m.channel] || '1970')) unread[m.channel] = (unread[m.channel] || 0) + 1;
  }
  S.chatUnread = unread; S.chatLast = last;
  updateChatBadge();
}
function startTeamChat() {
  if (S.teamChannel || !sb) return;
  S.teamChannel = sb.channel('team-chat').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_messages' }, (payload) => {
    const m = payload.new;
    S.chatLast = S.chatLast || {}; S.chatLast[m.channel] = m;
    const open = S.view === 'chat' && S.chatChannel === m.channel && document.hasFocus();
    if (S.view === 'chat' && S.chatChannel === m.channel) {
      if (!(S.chatMsgs || []).some((x) => x.id === m.id)) { S.chatMsgs.push(m); renderTeamLog(); }
      if (open) markChatRead(m.channel, m.created_at);
    }
    if (m.author_key !== myKey() && !open) {
      S.chatUnread = S.chatUnread || {};
      S.chatUnread[m.channel] = (S.chatUnread[m.channel] || 0) + 1;
      updateChatBadge();
      const pf = prefs();
      if (pf.sMessage) playSound();
      const where = m.channel === 'general' ? ' · Général' : ' · privé';
      const txt = m.body || '📎 ' + (m.file_name || 'Pièce jointe');
      toast(`${m.author_name}${where} : ${txt.slice(0, 80)}`);
      try {
        if (pf.winNotif && !document.hasFocus() && window.Notification) {
          const w = new Notification(m.author_name + where, { body: txt.slice(0, 140) });
          w.onclick = () => { window.focus(); S.chatChannel = m.channel; go('chat'); };
        }
      } catch (_) { /* rien */ }
    }
    if (S.view === 'chat') renderChatList();
  }).subscribe();
}
function stopTeamChat() { if (S.teamChannel && sb) { sb.removeChannel(S.teamChannel); S.teamChannel = null; } }

/* ---------------- émojis ---------------- */
const EMOJIS = {
  'Smileys': '😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 😏 😅 😇 🙃 😉 😋 😜 🤪 🤔 🤨 😐 😴 😮 😱 😭 😤 😡 🥶 🥵 🤯 😬 🙄 😈 💀 🤡 👻 🤖',
  'Gestes': '👍 👎 👌 ✌️ 🤞 🤙 👊 ✊ 👏 🙌 🙏 💪 🫡 🤝 👀 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 💔 💯 🔥 ✨ ⭐ 🎉 🎊',
  'Gaming': '🎮 🕹️ 🏆 🥇 🥈 🥉 🎯 ⚔️ 🛡️ 🏹 💣 🧨 👑 💎 🚀 ⚡ 🔝 📈 📉 🆙 ✅ ❌ ⏳ ⏰ 💰 💸 💵 🪙 🎁',
  'Divers': '☕ 🍕 🍔 🍟 🌮 🍺 🍿 🌙 ☀️ 🌈 🌊 🐐 🦊 🐉 🦅 🐺 🐍 📌 📎 📝 🔔 🔕 💬 🗨️ ⚠️ ❓ ❗',
};
function renderEmojiPanel() {
  const box = $('#emoji-panel');
  if (!box) return;
  box.innerHTML = Object.entries(EMOJIS).map(([cat, list]) => `<div class="emoji-cat">${esc(cat)}</div>
    <div class="emoji-grid">${list.split(' ').map((e) => `<button type="button" data-action="emoji" data-e="${e}">${e}</button>`).join('')}</div>`).join('');
}
function insertAtCursor(ta, text) {
  const st = ta.selectionStart ?? ta.value.length; const en = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, st) + text + ta.value.slice(en);
  ta.selectionStart = ta.selectionEnd = st + text.length;
  ta.focus({ preventScroll: true });
}

/* ---------------- messages vocaux ---------------- */
function recTime(ms) { const s0 = Math.floor(ms / 1000); return `${Math.floor(s0 / 60)}:${String(s0 % 60).padStart(2, '0')}`; }
async function toggleRecording() {
  const btn = $('#rec-btn');
  if (S.rec) { S.rec.recorder.stop(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) { return toast('Micro inaccessible : vérifie qu\'un micro est branché et autorisé dans Windows.', 'error'); }
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  const recorder = new MediaRecorder(stream, { mimeType: type });
  const chunks = [];
  S.rec = { recorder, start: Date.now() };
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const dur = Date.now() - S.rec.start;
    clearInterval(S.rec.timer); S.rec = null;
    const b = $('#rec-btn'); if (b) { b.classList.remove('recording'); b.innerHTML = ic('mic'); }
    if (dur < 700 || !chunks.length) return;
    const file = new File(chunks, `vocal-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`, { type: 'audio/webm' });
    file.vocal = recTime(dur);
    setChatFile(file);
  };
  recorder.start(250);
  if (btn) { btn.classList.add('recording'); btn.innerHTML = `${ic('stop')}<span id="rec-time">0:00</span>`; }
  S.rec.timer = setInterval(() => {
    const el = $('#rec-time'); if (el) el.textContent = recTime(Date.now() - S.rec.start);
    if (Date.now() - S.rec.start > 120000) S.rec.recorder.stop(); // 2 minutes max
  }, 250);
  toast('Enregistrement… reclique sur le bouton pour arrêter (2 min max)');
}

/* ---------------- lecture à voix haute ---------------- */
function speak(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return toast('La synthèse vocale n\'est pas disponible sur ce PC.', 'error');
    if (synth.speaking) { synth.cancel(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    const v = synth.getVoices().find((x) => /^fr/i.test(x.lang));
    if (v) u.voice = v;
    u.volume = Math.max(0.1, Number(prefs().volume) || 0.6);
    synth.speak(u);
  } catch (_) { toast('Lecture impossible.', 'error'); }
}

/* ---------------- pièces jointes de la messagerie ---------------- */
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|ps1|vbs|js|jar|lnk|reg|hta)$/i;
const fileSize = (b) => { const v = Number(b) || 0; return v < 1024 ? v + ' o' : v < 1048576 ? (v / 1024).toFixed(0) + ' Ko' : (v / 1048576).toFixed(1) + ' Mo'; };
const isImg = (m) => /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(m.file_type || '');
const isAudio = (m) => /^audio\//i.test(m.file_type || '') || /\.(webm|ogg|mp3|m4a|wav)$/i.test(m.file_name || '') && /^vocal/i.test(m.file_name || '');
S.fileUrls = S.fileUrls || {};
function setChatFile(file) {
  if (!file) return;
  if (BLOCKED_EXT.test(file.name)) return toast('Ce type de fichier est bloqué pour la sécurité de l\'équipe.', 'error');
  if (file.size > 25 * 1024 * 1024) return toast('Fichier trop lourd (25 Mo max).', 'error');
  S.chatFile = file;
  renderChatFileChip();
}
function renderChatFileChip() {
  const box = $('#tchat-file');
  if (!box) return;
  const f = S.chatFile;
  box.innerHTML = f ? `<div class="att-chip">${ic(f.vocal ? 'mic' : 'clip')}<span><b>${esc(f.vocal ? 'Message vocal · ' + f.vocal : f.name)}</b> <span class="muted small">${fileSize(f.size)}</span></span>
    <button type="button" class="sm ghost" data-action="chat-file-clear" title="Retirer">${ic('x')}</button></div>` : '';
}
function attachmentHtml(m) {
  if (!m.file_path) return '';
  const url = S.fileUrls[m.file_path];
  if (isImg(m)) {
    return `<button type="button" class="att-img" data-action="att-open" data-path="${esc(m.file_path)}" data-name="${esc(m.file_name || '')}">
      ${url ? `<img src="${esc(url)}" alt="${esc(m.file_name || '')}" loading="lazy">` : '<span class="muted small">Chargement de l\'image…</span>'}</button>`;
  }
  if (isAudio(m)) {
    return `<div class="att-audio">${ic('mic')}${url ? `<audio controls preload="metadata" src="${esc(url)}"></audio>` : '<span class="muted small">Chargement du vocal…</span>'}</div>`;
  }
  return `<div class="att-file">${ic('file')}<span class="att-meta"><b>${esc(m.file_name || 'Fichier')}</b><span class="muted small">${fileSize(m.file_size)}</span></span>
    <button type="button" class="sm" data-action="att-dl" data-path="${esc(m.file_path)}" data-name="${esc(m.file_name || 'fichier')}">Télécharger</button></div>`;
}
// liens temporaires (1 h) pour afficher les images du salon ouvert
async function resolveAttachments() {
  const need = [...new Set((S.chatMsgs || []).filter((m) => m.file_path && (isImg(m) || isAudio(m)) && !S.fileUrls[m.file_path]).map((m) => m.file_path))];
  if (!need.length) return;
  try {
    const { data } = await sb.storage.from('attachments').createSignedUrls(need, 3600);
    (data || []).forEach((d) => { if (d.signedUrl) S.fileUrls[d.path] = d.signedUrl; });
    setTimeout(() => { need.forEach((p) => { delete S.fileUrls[p]; }); }, 55 * 60 * 1000);
    renderTeamLog(true);
  } catch (_) { /* image indisponible */ }
}
async function downloadAttachment(path, name) {
  const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 600, { download: name || true });
  if (error) throw error;
  if (window.desktop && window.desktop.download) await window.desktop.download(data.signedUrl);
  else window.open(data.signedUrl);
}
async function uploadChatFile(file) {
  if (!S.uid) { const { data } = await sb.auth.getSession(); S.uid = data && data.session && data.session.user.id; }
  const safe = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${S.uid}/${Date.now()}-${safe}`;
  const { error } = await sb.storage.from('attachments').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw error;
  return { path, name: file.name, type: file.type || '', size: String(file.size) };
}

async function viewChat(main) {
  await Promise.all([loadProfiles(), loadChatSummary()]);
  if (main.isConnected === false) return;
  S.chatChannel = S.chatChannel || 'general';
  main.innerHTML = `${head('Messages', 'Le groupe général et tes conversations privées')}
    <div class="tchat card">
      <aside class="tchat-list" id="tchat-list"></aside>
      <section class="tchat-main">
        <div class="tchat-head" id="tchat-head"></div>
        <div class="tchat-log" id="tchat-log"><div class="muted">Chargement…</div></div>
        <div id="tchat-file"></div>
        <form class="tchat-form" data-form="team-msg">
          <div class="tchat-tools">
            <label class="btn icon-btn" title="Joindre un fichier (25 Mo max)">${ic('clip')}<input type="file" data-change="chat-file" hidden></label>
            <button type="button" class="icon-btn" data-action="emoji-toggle" title="Émojis">${ic('smile')}</button>
            <button type="button" class="icon-btn" id="rec-btn" data-action="rec-toggle" title="Message vocal">${ic('mic')}</button>
          </div>
          <div class="emoji-panel hidden" id="emoji-panel"></div>
          <textarea name="body" rows="1" maxlength="2000" placeholder="Écris un message…"></textarea>
          <button class="primary" type="submit">${ic('send')}</button>
        </form>
      </section>
    </div>`;
  renderChatList();
  renderChatFileChip();
  await openChannel(S.chatChannel);
}
function renderChatList() {
  const box = $('#tchat-list');
  if (!box) return;
  const me = myKey();
  const item = (ch, avatar, name, sub) => {
    const un = (S.chatUnread || {})[ch] || 0;
    const last = (S.chatLast || {})[ch];
    return `<button class="tchat-item ${S.chatChannel === ch ? 'active' : ''}" data-action="chat-open" data-ch="${esc(ch)}">
      ${avatar}<span class="tchat-who"><b>${esc(name)}</b><span class="muted small">${last ? esc((last.author_key === me ? 'Toi : ' : '') + (last.body || '📎 ' + (last.file_name || 'Pièce jointe')).slice(0, 40)) : esc(sub)}</span></span>
      ${un ? `<span class="nav-badge">${un}</span>` : ''}</button>`;
  };
  const members = (S.profiles || []).filter((p) => p.key !== me);
  box.innerHTML = `<div class="nav-group">Groupe</div>
    ${item('general', `<span class="avatar general">#</span>`, 'Général', 'Toute l\'équipe')}
    <div class="nav-group">Messages privés</div>
    ${members.map((p) => item(dmChannel(me, p.key), avatarHtml(p.name), p.name, p.tagline || p.role || '')).join('') || '<div class="muted small" style="padding:8px">Personne d\'autre pour l\'instant.</div>'}`;
}
async function openChannel(ch) {
  S.chatChannel = ch;
  const other = chanOther(ch); const m = other ? memberByKey(other) : null;
  const headEl = $('#tchat-head');
  if (headEl) {
    headEl.innerHTML = ch === 'general'
      ? `<span class="avatar general">#</span><div><b>Général</b><div class="muted small">Toute l'équipe voit ces messages</div></div>`
      : `${m ? avatarHtml(m.name) : ''}<div><b>${esc(chanTitle(ch))}</b><div class="muted small">Conversation privée : vous deux seulement</div></div>
         ${m ? `<button class="sm ghost" style="margin-left:auto" data-action="profile" data-name="${esc(m.name)}">Voir le profil</button>` : ''}`;
  }
  const rows = await run(sb.from('team_messages').select('*').eq('channel', ch).order('created_at', { ascending: false }).limit(150));
  S.chatMsgs = rows.reverse();
  renderTeamLog();
  const lastAt = S.chatMsgs.length ? S.chatMsgs[S.chatMsgs.length - 1].created_at : new Date().toISOString();
  markChatRead(ch, lastAt);
  if (S.chatUnread) delete S.chatUnread[ch];
  updateChatBadge(); renderChatList();
  const ta = document.querySelector('.tchat-form textarea'); if (ta && ta.focus) ta.focus({ preventScroll: true });
}
function renderTeamLog(keepScroll) {
  const log = $('#tchat-log');
  if (!log) return;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const me = myKey();
  let prevDay = '';
  log.innerHTML = (S.chatMsgs || []).length ? S.chatMsgs.map((m) => {
    const day = new Date(m.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const sep = day !== prevDay ? `<div class="tchat-day"><span>${esc(day)}</span></div>` : '';
    prevDay = day;
    const mine = m.author_key === me;
    return `${sep}<div class="msg-line ${mine ? 'mine' : ''}">${avatarHtml(m.author_name, 'sm')}<div class="msg">
      <div class="who">${esc(m.author_name)} · ${new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      ${m.body ? `<div class="txt">${esc(m.body)}</div>` : ''}${attachmentHtml(m)}
      ${m.body ? `<button type="button" class="tts-btn" data-action="tts" data-text="${esc(m.body)}" title="Lire à voix haute">${ic('volume')}</button>` : ''}</div></div>`;
  }).join('') : emptyBox(S.chatChannel === 'general' ? 'Aucun message. Dis bonjour à l\'équipe !' : 'Aucun message. Lance la conversation !', 'send');
  if (!keepScroll || atBottom) log.scrollTop = log.scrollHeight;
  if (!keepScroll) resolveAttachments();
}

/* ---------------- photos de profil ---------------- */
function avatarUrl(name) { return (S.avatars && name && S.avatars[name]) || ''; }
function avatarHtml(name, cls = '') {
  const url = avatarUrl(name);
  const letter = esc(String(name || '?').slice(0, 1).toUpperCase());
  // les petites photos (listes, chat) ouvrent le profil de la personne
  const click = /\bsm\b/.test(cls) && name ? ` data-action="profile" data-name="${esc(name)}" title="Voir le profil de ${esc(name)}"` : '';
  return url ? `<span class="avatar ${cls}"${click}><img src="${esc(url)}" alt=""></span>` : `<span class="avatar ${cls}"${click}>${letter}</span>`;
}
const whoCell = (name) => `<span class="who-cell">${avatarHtml(name, 'sm')}<span>${esc(name)}</span></span>`;
const myName = () => (isAdmin() ? 'Flowey' : (S.access && S.access.booster) || 'Booster');
async function loadAvatars() {
  try { S.avatars = (await run(sb.rpc('team_avatars'))) || {}; } catch (_) { S.avatars = S.avatars || {}; }
}
function openAvatar() {
  modal(`<div class="card-head"><h2>${ic('users')} Ma photo de profil</h2></div>
    <div class="avatar-edit">${avatarHtml(myName(), 'lg')}
      <div><p class="muted small">Choisis une image (JPG, PNG, WEBP) ou un <b>GIF animé</b> (8 Mo max). Elle est recadrée en carré automatiquement. Toute l'équipe la verra.</p>
      <label class="btn primary">${ic('download')} Choisir une image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-change="avatar-file" hidden></label>
      ${avatarUrl(myName()) ? '<button class="ghost" data-action="avatar-remove">Retirer ma photo</button>' : ''}</div></div>
    <div class="form-actions"><button data-action="close-modal">Fermer</button></div>`, 'small');
}
function cropToJpeg(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Ce fichier n\'est pas une image.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('Image trop lourde (15 Mo max).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256; const c = document.createElement('canvas'); c.width = size; c.height = size;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2; const sy = (img.naturalHeight - side) / 2;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion impossible.'))), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}
async function uploadAvatar(file) {
  // GIF animé : envoyé tel quel pour garder l'animation (recadré à l'affichage). Sinon : carré 256 px en JPG.
  const gif = file && file.type === 'image/gif';
  if (gif && file.size > 8 * 1024 * 1024) throw new Error('GIF trop lourd (8 Mo max). Réduis-le sur ezgif.com par exemple.');
  const blob = gif ? file : await cropToJpeg(file);
  if (!S.uid) { const { data } = await sb.auth.getUser(); S.uid = data && data.user && data.user.id; }
  const path = `${S.uid}/${Date.now()}.${gif ? 'gif' : 'jpg'}`;
  const { error } = await sb.storage.from('avatars').upload(path, blob, { contentType: gif ? 'image/gif' : 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  await run(sb.rpc('set_my_avatar', { p_url: data.publicUrl }));
  await loadAvatars();
}
function refreshMyAvatar() {
  const slot = $('#my-avatar');
  if (slot) slot.innerHTML = avatarHtml(myName());
}
function head(title, sub, tools = '') {
  return `<div class="page-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${tools ? `<div class="tools">${tools}</div>` : ''}</div>`;
}
function emptyBox(text, icon = 'inbox', btn = '') {
  return `<div class="empty">${ic(icon)}<div>${text}</div>${btn}</div>`;
}
// les chiffres clés « défilent » jusqu'à leur valeur
function animateCounts(root) {
  if (typeof requestAnimationFrame === 'undefined' || !root || !root.querySelectorAll) return;
  try { if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (_) { /* rien */ }
  root.querySelectorAll('.kpi .value, .todo .v').forEach((el) => {
    const t = el.textContent.trim();
    let m = t.match(/^(-?)\$([\d,]+\.\d{2})$/);
    if (m) { tween(el, parseFloat(m[2].replace(/,/g, '')) * (m[1] ? -1 : 1), (v) => money(v)); return; }
    if (/^\d+$/.test(t) && Number(t) > 0) tween(el, Number(t), (v) => String(Math.round(v)));
  });
}
function tween(el, target, fmt) {
  const d = 800; const s = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - s) / d); const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(target * e);
    if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
  };
  requestAnimationFrame(step);
}

/* ---------------- mises à jour automatiques ---------------- */
function updateBar(html) {
  let bar = document.getElementById('update-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'update-bar'; bar.className = 'update-bar'; document.body.appendChild(bar); }
  bar.innerHTML = html;
}
function initUpdater() {
  if (!window.desktop || !window.desktop.onUpdate) return;
  window.desktop.onUpdate((u) => {
    if (u.state === 'downloading') {
      updateBar(`${ic('download')}<span>Mise à jour ${u.version ? 'v' + esc(u.version) + ' ' : ''}en téléchargement… <b>${n(u.percent)} %</b></span>
        <div class="goal" style="width:120px;margin:0"><span style="width:${n(u.percent)}%;animation:none"></span></div>`);
    }
    if (u.state === 'installing') {
      updateBar(`${ic('rocket')}<span>Mise à jour vers <b>v${esc(u.version)}</b> : l'app redémarre dans quelques secondes…</span>`);
      toast('Mise à jour vers v' + u.version + ' : redémarrage automatique…');
    }
    if (u.state === 'ready') {
      S.updateReady = u.version;
      updateBar(`${ic('sparkles')}<span>Version <b>${esc(u.version)}</b> prête</span><button class="sm primary" data-action="install-update">Redémarrer</button>`);
      modal(`<div class="card-head"><h2>${ic('sparkles')} Nouvelle version disponible</h2></div>
        <p>La version <b>${esc(u.version)}</b> de Flowey's Software Manager est prête.</p>
        <p class="muted small">L'app se ferme quelques secondes puis se rouvre. Tes données ne bougent pas.</p>
        <div class="form-actions"><button class="primary" data-action="install-update">${ic('rocket')} Mettre à jour maintenant</button>
        <button data-action="close-modal">Plus tard</button></div>
        <p class="muted small">« Plus tard » : elle s'installera automatiquement à la prochaine fermeture de l'app.</p>`, 'small');
    }
  });
}

/* ---------------- rapport de plantage ---------------- */
let lastErrAt = 0;
function reportError(kind, message) {
  if (!sb || Date.now() - lastErrAt < 5000) return;
  lastErrAt = Date.now();
  let v = ''; try { v = S.appVersion || ''; } catch (_) { /* rien */ }
  sb.rpc('report_error', { p_kind: kind, p_message: String(message).slice(0, 1500), p_version: v }).then(() => {}, () => {});
}
window.addEventListener('error', (e) => reportError('js', (e.error && e.error.stack) || e.message));
window.addEventListener('unhandledrejection', (e) => reportError('js-promise', (e.reason && (e.reason.stack || e.reason.message)) || e.reason));
async function checkLastCrash() {
  if (!window.desktop || !window.desktop.crashLog) return;
  try {
    const lines = await window.desktop.crashLog();
    if (!lines || !lines.length) return;
    lines.forEach((l) => reportError('plantage', l));
    toast('L\'app a rencontré un problème la dernière fois : il a été signalé à Flowey.', 'error');
  } catch (_) { /* rien */ }
}

/* ---------------- démarrage ---------------- */
async function boot() {
  initUpdater();
  applyPrefs();
  await initTheme();
  await initBanner();
  if (!window.supabase || !CFG.SUPABASE_URL || /COLLE/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY)) {
    $('#app').innerHTML = `<div class="center-screen"><div class="auth-card">
      <div class="brand"><img class="logo" src="${logoSrc()}" alt="Flowey's Software Manager"><h1>Configuration requise</h1></div>
      <p class="muted">${window.supabase ? 'Ouvre le fichier <b>src/config.js</b> avec le Bloc-notes, colle l\'URL et la clé de ton projet Supabase (GUIDE, étape 4), enregistre, puis relance.'
    : 'Il manque des fichiers : double-clique sur <b>1-INSTALLER.bat</b> dans le dossier du projet, puis relance.'}</p>
      </div></div>`;
    return;
  }
  // on ne garde que « https://xxxx.supabase.co » même si un chemin a été collé en trop (ex. /rest/v1/)
  let url = CFG.SUPABASE_URL.trim();
  try { url = new URL(url).origin; } catch (_) { /* on garde tel quel */ }
  sb = window.supabase.createClient(url, CFG.SUPABASE_ANON_KEY.trim());
  const { data } = await sb.auth.getSession();
  if (!data.session) return renderAuth();
  await loadAccess();
}

async function loadAccess() {
  try {
    S.access = await run(sb.rpc('my_access'));
  } catch (e) {
    return renderAuth(errMsg(e));
  }
  const st = S.access.status;
  if (st === 'need_2fa') return start2FA();
  if (st === 'admin') { await loadRefs(); return renderShell('dashboard'); }
  if (st === 'active') { await loadRefs(); return renderShell('home'); }
  renderGate();
}

// données de base (boosters, règles, taux, photos, réglages) : tout part en même temps,
// et on ne redemande pas si c'est déjà frais (moins de 30 s), sauf après une modification
async function loadRefs(force = true) {
  if (!force && S.refsAt && Date.now() - S.refsAt < 30000) return;
  if (!S.uid) { try { const { data } = await sb.auth.getSession(); S.uid = data && data.session && data.session.user.id; } catch (_) { /* rien */ } }
  const [boosters, rules, fees, , st] = await Promise.all([
    run(sb.from('boosters').select('*').order('name')),
    run(sb.from('split_rules').select('*').order('sort')),
    run(sb.from('fee_rates').select('*').order('effective_from')),
    loadAvatars(),
    isAdmin() ? run(sb.from('app_settings').select('*').eq('id', 1).maybeSingle()) : Promise.resolve(null),
  ]);
  S.boosters = boosters; S.rules = rules; S.fees = fees;
  if (st) S.settings = st;
  S.refsAt = Date.now();
}

// revérifie la licence toutes les 10 minutes
setInterval(async () => {
  if (!sb || !S.access || isAdmin()) return;
  try {
    const a = await run(sb.rpc('my_access'));
    if (a.status !== 'active') { S.access = a; stopRealtime(); renderGate(); }
  } catch (_) { /* hors ligne : on réessaiera */ }
}, 10 * 60 * 1000);

/* ---------------- connexion ---------------- */
function renderAuth(error = '') {
  $('#app').innerHTML = `<div class="center-screen"><form class="auth-card" data-form="login">
    <div class="brand"><img class="logo" src="${logoSrc()}" alt="Flowey's Software Manager"><div><h1>Flowey's Software Manager</h1>
    <div class="muted small">Commandes · Équipe · Wallet</div></div></div>
    ${field('Email', '<input name="email" type="email" required autofocus>')}
    ${field('Mot de passe', '<input name="password" type="password" required minlength="6">')}
    <div class="form-actions">
      <button class="primary" type="submit" name="mode" value="login">Se connecter</button>
      <button type="submit" name="mode" value="signup">Créer un compte</button>
    </div>
    ${error ? `<div class="error-box">${esc(error)}</div>` : ''}
    <p class="muted small">Première fois ? Clique sur « Créer un compte ».</p>
  </form></div>`;
}

async function onLogin(form, submitter) {
  const { email, password } = formData(form);
  const mode = submitter && submitter.value;
  try {
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) return renderAuth('Compte créé, mais la confirmation par email est activée dans Supabase. Désactive-la (GUIDE, étape 3) ou clique sur le lien reçu par email, puis connecte-toi.');
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    await loadAccess();
  } catch (e) { renderAuth(errMsg(e)); }
}

async function logout() {
  stopRealtime();
  await sb.auth.signOut();
  S.access = null;
  renderAuth();
}

/* ---------------- écran licence / premier admin ---------------- */
function renderGate(error = '') {
  const a = S.access || {};
  if (a.admin_exists === false) {
    $('#app').innerHTML = `<div class="center-screen"><div class="auth-card">
      <div class="brand"><img class="logo" src="${logoSrc()}" alt="Flowey's Software Manager"><h1>Bienvenue !</h1></div>
      <p class="muted">Aucun admin n'existe encore. Si tu es <b>Flowey</b> (le propriétaire), clique ci-dessous pour devenir admin.
      Ce bouton ne fonctionne qu'une seule fois : ensuite, plus personne ne peut devenir admin.</p>
      <div class="form-actions"><button class="primary" data-action="claim-admin">Je suis Flowey : devenir admin</button>
      <button data-action="logout">Se déconnecter</button></div>
      ${error ? `<div class="error-box">${esc(error)}</div>` : ''}
      <p class="muted small">Connecté : ${esc(a.email)}</p></div></div>`;
    return;
  }
  const msg = {
    none: 'Ton compte n\'a pas encore de licence. Entre la clé que Flowey t\'a envoyée.',
    expired: 'Ta licence a expiré. Demande une nouvelle clé à Flowey pour continuer.',
    revoked: 'Ta licence a été désactivée. Contacte Flowey.',
  }[a.status] || 'Licence requise.';
  $('#app').innerHTML = `<div class="center-screen"><form class="auth-card" data-form="activate">
    <div class="brand"><img class="logo" src="${logoSrc()}" alt="Flowey's Software Manager"><h1>Licence</h1></div>
    <p class="muted">${esc(msg)}</p>
    ${field('Clé de licence', '<input name="key" class="key-input" placeholder="BOOST-XXXX-XXXX-XXXX-XXXX" required autofocus>')}
    <div class="form-actions">
      <button class="primary" type="submit">Activer</button>
      <button type="button" data-action="logout">Se déconnecter</button>
    </div>
    ${error ? `<div class="error-box">${esc(error)}</div>` : ''}
    <p class="muted small">Connecté : ${esc(a.email)}</p>
  </form></div>`;
}

async function onActivate(form, inShell) {
  const { key } = formData(form);
  try {
    S.access = await run(sb.rpc('activate_license', { p_key: key }));
    toast('Licence activée jusqu\'au ' + fdate(S.access.expires_at));
    await loadRefs();
    renderShell(inShell ? 'license' : 'home');
  } catch (e) {
    if (inShell) toast(errMsg(e), 'error'); else renderGate(errMsg(e));
  }
}

/* ---------------- structure ---------------- */
const NAV_ADMIN = [
  ['Principal', [['dashboard', 'home', 'Tableau de bord'], ['orders', 'list', 'Commandes'], ['boosters', 'users', 'Équipe']]],
  ['Communication', [['chat', 'send', 'Messages'], ['announcements', 'megaphone', 'Annonces'], ['profiles', 'users', 'Profils'], ['wallet', 'trophy', 'Wallet équipe']]],
  ['Argent', [['eldorado', 'globe', 'Eldorado'], ['withdrawals', 'wallet', 'Wallet Eldorado'], ['payments', 'send', 'Paiements']]],
  ['Outils', [['calc', 'chart', 'Calculateur'], ['licenses', 'key', 'Licences'], ['settings', 'settings', 'Paramètres']]],
];
const NAV_BOOSTER = [
  ['Mon espace', [['home', 'home', 'Accueil'], ['myorders', 'list', 'Mes commandes'], ['earnings', 'dollar', 'Mes gains']]],
  ['Équipe', [['chat', 'send', 'Messages'], ['profiles', 'users', 'Profils'], ['wallet', 'trophy', 'Wallet équipe']]],
  ['Compte', [['mysettings', 'settings', 'Paramètres'], ['license', 'key', 'Ma licence']]],
];

function renderShell(view) {
  const nav = isAdmin() ? NAV_ADMIN : NAV_BOOSTER;
  const name = isAdmin() ? 'Flowey' : (S.access.booster || 'Booster');
  const sub = isAdmin() ? 'Admin' : `Licence jusqu'au ${fdate(S.access.expires_at)}`;
  $('#app').innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><div style="display:flex;align-items:center;gap:12px"><img class="logo" src="${logoSrc()}" alt="Flowey's Software Manager">
        <div><b>Flowey's Software Manager</b><div class="muted small">${isAdmin() ? 'Espace admin' : 'Espace booster'} <span id="app-version"></span></div></div></div>
        <button class="ghost bell" id="bell" data-action="nav" data-view="notifs" title="Notifications">${ic('bell')}<span class="dot hidden" id="notif-dot"></span></button></div>
      ${nav.map(([group, items]) => `<div class="nav-group">${group}</div>
        ${items.map(([id, icon, label]) => `<button class="nav-item" data-action="nav" data-view="${id}">${ic(icon)}<span>${label}</span></button>`).join('')}`).join('')}
      <div class="spacer"></div>
      <div class="userbox"><button class="avatar-btn" id="my-avatar" data-action="my-profile" title="Mon profil">${avatarHtml(name)}</button>
        <div class="who"><div class="email">${esc(name)}</div><div class="muted">${esc(sub)}</div></div>
        <button class="sm ghost" data-action="logout" title="Se déconnecter">${ic('logout')}</button></div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  startNotifications();
  startTeamChat();
  if (!S.crashChecked) { S.crashChecked = true; setTimeout(checkLastCrash, 3000); }
  loadChatSummary().catch(() => { /* messagerie pas encore installée dans Supabase */ });
  setTimeout(prefetchViews, 2500);
  if (window.desktop && window.desktop.version) {
    window.desktop.version().then((v) => { S.appVersion = v; const el = $('#app-version'); if (el) el.textContent = 'v' + v; }).catch(() => {});
  }
  go(view);
}

async function go(view, keepChat) {
  if (!keepChat) stopChat();
  closeModal();
  S.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active',
    b.dataset.view === view || (view === 'order' && b.dataset.view === (isAdmin() ? 'orders' : 'myorders'))));
  const main = $('#main');
  // chaque page s'affiche dans son propre bloc : si on change de page avant la fin du chargement,
  // l'ancienne page ne vient plus écraser la nouvelle
  const box = document.createElement('div');
  box.className = 'view';
  const key = view === 'order' ? 'order:' + S.orderId : view;
  S.viewCache = S.viewCache || {};
  const cached = S.viewCache[key];
  box.innerHTML = cached || '<div class="skeleton"><div></div><div></div><div></div></div>';
  if (cached) box.classList.add('stale');
  main.replaceChildren(box);
  main.classList.toggle('chat-mode', view === 'chat');
  if (!keepChat) main.scrollTop = 0;
  try {
    await VIEWS[view](box);
    box.classList.remove('stale');
    if (!cached) animateCounts(box);
    if (box.isConnected && !['chat', 'order'].includes(view)) S.viewCache[key] = box.innerHTML;
  } catch (e) {
    box.classList.remove('stale');
    box.innerHTML = `<div class="error-box">${esc(errMsg(e))}</div>`;
  }
}
// prépare en arrière-plan les pages les plus utilisées : elles s'afficheront tout de suite au clic
async function prefetchViews() {
  const list = isAdmin() ? ['orders', 'boosters', 'wallet', 'payments', 'profiles', 'licenses'] : ['myorders', 'earnings', 'wallet', 'profiles'];
  for (const v of list) {
    if (!S.access || (S.viewCache && S.viewCache[v]) || S.view === v) continue;
    const box = document.createElement('div');
    try { await VIEWS[v](box); S.viewCache = S.viewCache || {}; S.viewCache[v] = box.innerHTML; } catch (_) { /* tant pis, elle se chargera au clic */ }
    await new Promise((r) => setTimeout(r, 300));
  }
}
const refresh = () => { if (S.viewCache) delete S.viewCache[S.view === 'order' ? 'order:' + S.orderId : S.view]; return go(S.view); };
function openOrder(id) { S.orderId = id; go('order'); }

/* =====================================================================
   NOTIFICATIONS (temps réel + notification Windows)
   ===================================================================== */
const seenKey = () => 'bm_seen_' + (S.access && S.access.email);
const lastSeen = () => { try { return localStorage.getItem(seenKey()) || '1970-01-01T00:00:00Z'; } catch (_) { return '1970-01-01T00:00:00Z'; } };
function markSeen() { try { localStorage.setItem(seenKey(), new Date().toISOString()); } catch (_) { /* rien */ } S.unread = 0; updateDot(); }
function updateDot() {
  const d = $('#notif-dot');
  if (!d) return;
  d.textContent = S.unread > 99 ? '99+' : S.unread;
  d.classList.toggle('hidden', !S.unread);
}
function ringBell() {
  const b = $('#bell');
  if (!b || !b.classList) return;
  b.classList.remove('ringing'); void b.offsetWidth; b.classList.add('ringing');
}
function notifQuery() {
  let q = sb.from('notifications').select('*').order('created_at', { ascending: false });
  if (isAdmin()) q = q.eq('for_admin', true);
  return q;
}

async function startNotifications() {
  try {
    let q = sb.from('notifications').select('id', { count: 'exact', head: true }).gt('created_at', lastSeen());
    if (isAdmin()) q = q.eq('for_admin', true);
    const r = await run(q);
    S.unread = (r && r.count) || 0;
    updateDot();
  } catch (_) { /* pas bloquant */ }
  if (S.notifChannel) return;
  const opts = { event: 'INSERT', schema: 'public', table: 'notifications' };
  if (isAdmin()) opts.filter = 'for_admin=eq.true';
  S.notifChannel = sb.channel('notifs').on('postgres_changes', opts, (payload) => {
    const nt = payload.new;
    if (!isAdmin() && nt.for_admin) return;
    S.unread += 1; updateDot(); ringBell();
    toast(nt.title + (nt.body ? ' — ' + nt.body : ''));
    const pf = prefs();
    if (pf[notifKind(nt.title)]) playSound();
    try {
      if (pf.winNotif && !document.hasFocus() && window.Notification) {
        const w = new Notification(nt.title, { body: nt.body || '' });
        w.onclick = () => { window.focus(); if (nt.order_id) openOrder(nt.order_id); };
      }
    } catch (_) { /* notifications Windows désactivées */ }
    if (S.view === 'order' && S.orderId === nt.order_id && !/^Message/.test(nt.title)) refreshOrderSoft();
    if (['home', 'myorders', 'dashboard', 'notifs'].includes(S.view) && !$('#modal')) refresh();
  }).subscribe();
}
function stopChat() { if (S.chat) { sb.removeChannel(S.chat); S.chat = null; } }
function stopRealtime() {
  stopChat();
  stopTeamChat();
  if (S.notifChannel && sb) { sb.removeChannel(S.notifChannel); S.notifChannel = null; }
}

async function viewNotifs(main) {
  const rows = await run(notifQuery().limit(80));
  const seen = lastSeen();
  main.innerHTML = `${head('Notifications', 'Ce qui s\'est passé récemment · clique pour ouvrir la commande')}
  <div class="card" style="padding:0">${rows.length ? rows.map((x) => `<div class="notif ${x.created_at > seen ? 'new' : ''}"
      ${x.order_id ? `data-action="open-order" data-id="${x.order_id}"` : ''}>
      <div><div class="t">${esc(x.title)}</div><div class="muted small">${esc(x.body)}</div></div>
      <div class="d">${fdt(x.created_at)}</div></div>`).join('')
    : emptyBox('Aucune notification.')}</div>`;
  markSeen();
}

/* =====================================================================
   ADMIN — TABLEAU DE BORD
   ===================================================================== */
function periodPicker() {
  const years = [];
  for (let y = 2024; y <= now.getFullYear() + 1; y++) years.push(y);
  return `<select data-change="month" style="width:auto">${MONTHS.map((m, i) => opt(i + 1, m, i + 1 === S.month)).join('')}</select>
    <select data-change="year" style="width:auto">${years.map((y) => opt(y, y, y === S.year)).join('')}</select>`;
}

async function viewDashboard(main) {
  const d = await run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month }));
  S.dash = d;
  const g = d.global; const m = d.month; const st = d.stages;
  const owed = r2(n(g.boosters) + n(d.adj.boosters) - n(d.paid));
  const myTotal = r2(n(g.flowey) + n(d.adj.flowey));
  const wdFee = n(d.withdrawals.fee);
  const maxBar = Math.max(1, ...d.year.map((y) => n(y.net)));
  const srcTotal = n(g.flowey) || 1;
  const totalOrders = n(d.counts.done) + n(d.counts.pending) + n(d.counts.cancelled);
  const hasAccounts = d.boosters.some((b) => b.email);
  const onboarding = totalOrders === 0 ? `<div class="card onboard">
    <div class="card-head"><h2>${ic('rocket')} Par où commencer</h2><span class="muted small">Ce guide disparaît dès ta première commande</span></div>
    <div class="onboard-steps">
      <div class="ostep ${d.boosters.length ? 'done' : ''}"><div class="n">${d.boosters.length ? '✓' : '1'}</div><b>Ton équipe</b>
        <span class="muted small">${d.boosters.length} booster(s) enregistré(s). Ajoute les nouveaux dans « Équipe ».</span>
        <button class="sm" data-action="nav" data-view="boosters">${ic('users')} Voir l'équipe</button></div>
      <div class="ostep ${hasAccounts ? 'done' : ''}"><div class="n">${hasAccounts ? '✓' : '2'}</div><b>Leurs accès</b>
        <span class="muted small">Génère une clé pour chaque booster et envoie-la avec l'installateur.</span>
        <button class="sm" data-action="nav" data-view="licenses">${ic('key')} Créer une clé</button></div>
      <div class="ostep"><div class="n">3</div><b>Ta première commande</b>
        <span class="muted small">Enregistre-la, puis attribue-la à un booster en un clic.</span>
        <button class="sm primary" data-action="new-order">${ic('plus')} Nouvelle commande</button></div>
    </div></div>` : '';
  const todo = (stage, icon, label, value, cls) => `<button data-action="orders-stage" data-stage="${stage}" class="${value ? cls : ''}">
      <span class="lbl">${ic(icon)} ${label}</span><span class="v">${value}</span></button>`;
  main.innerHTML = `
  ${head('Bon retour, Flowey', `Voici où en est ton activité · ${n(st.doing) + n(st.assigned)} commande(s) en cours`, `<button class="primary" data-action="new-order">${ic('plus')} Nouvelle commande</button>`)}
  ${onboarding}
  ${!d.eldorado.real_at || (Date.now() - new Date(d.eldorado.real_at)) > 3 * 86400000 ? `<div class="notice">${ic('wallet')}
    <div class="txt"><b>Relève ton solde Eldorado</b><div class="muted small">${d.eldorado.real_at ? 'Dernier relevé il y a plus de 3 jours.' : 'Aucun relevé pour l\'instant.'} Ça prend 5 secondes et ça garde la répartition juste.</div></div>
    <button class="sm primary" data-action="nav" data-view="eldorado">Relever</button></div>` : ''}
  <div class="todo">
    ${todo('À attribuer', 'inbox', 'À attribuer', st.todo, 'hot')}
    ${todo('Livrée', 'check', 'Livrées · à valider', st.delivered, 'hot')}
    ${todo('', 'clock', 'À livrer sous 24 h', st.soon, 'hot')}
    ${todo('', 'alert', 'En retard', st.late, 'bad')}
  </div>
  <div class="kpis">
    ${kpi('Ma part (total gagné)', money(myTotal), 'accent')}
    ${kpi('Solde Eldorado (calculé)', money(d.eldorado.balance))}
    ${kpi('À payer aux boosters', money(owed), owed > 0.004 ? 'warn' : 'good')}
    ${kpi('Commandes validées', d.counts.done)}
  </div>
  <div class="grid-3">
    <div class="card"><div class="card-head"><h2>${ic('chart')} ${MONTHS[S.month - 1]} ${S.year}</h2><div style="display:flex;gap:8px">${periodPicker()}</div></div>
      <div class="chain">
        <div class="row"><span>Chiffre d'affaires brut</span><b>${money(m.gross)}</b></div>
        <div class="row"><span>Frais Eldorado</span><b class="minus">−${money(m.fee)}</b></div>
        <div class="row total"><span>Net reçu</span><b>${money(m.net)}</b></div>
        <div class="row"><span>Part des boosters</span><b class="minus">−${money(m.boosters)}</b></div>
        <div class="row total"><span>Ma part du mois</span><b>${money(m.flowey)}</b></div>
        <div class="row"><span>Payé aux boosters ce mois</span><b>${money(m.paid)}</b></div>
        <div class="row"><span>Commandes validées / en attente</span><b>${m.count} / ${m.pending}</b></div>
      </div></div>
    <div class="card"><div class="card-head"><h2>${ic('users')} Équipe</h2><button class="sm" data-action="nav" data-view="boosters">Tout voir</button></div>
      ${teamMini(d.boosters)}</div>
  </div>
  <details class="card"><summary>${ic('dollar')} Détails financiers <span class="muted small" style="font-weight:400">graphique de l'année · origine de ta part · bénéfice final</span></summary>
    <div class="grid-2">
      <div><div class="card-head"><h2>Année ${S.year}</h2>
          <div class="legend"><span><i style="background:#6366f1"></i>Net</span><span><i style="background:#c084fc"></i>Ma part</span></div></div>
        <div class="bars">${d.year.map((y) => `<div class="bar-col ${y.m === S.month ? 'sel' : ''}" title="${MONTHS[y.m - 1]} : net ${money(y.net)} · ma part ${money(y.flowey)}">
          <div class="bar-pair"><div class="bar net" style="height:${(n(y.net) / maxBar) * 100}%"></div>
          <div class="bar me" style="height:${(n(y.flowey) / maxBar) * 100}%"></div></div>
          <div class="m">${MONTHS[y.m - 1].slice(0, 3)}</div></div>`).join('')}</div></div>
      <div><div class="card-head"><h2>D'où vient ma part</h2></div>
        ${[['Boostings solo', 'Solo'], ['Management (boosters sans moi)', 'Management'], ['Avec mes boosters', 'Collaboration']]
    .map(([l, k]) => `<div class="source-row"><span>${l}</span><b>${money(d.sources[k])}</b>
          <div class="meter"><span style="width:${(n(d.sources[k]) / srcTotal) * 100}%"></span></div></div>`).join('')}</div>
    </div>
    <div class="grid-2">
      <div><div class="card-head"><h2>Du brut au bénéfice final</h2></div>
        <div class="chain">
          <div class="row"><span>1. CA brut des commandes</span><b>${money(g.gross)}</b></div>
          <div class="row"><span>2. Frais Eldorado</span><b class="minus">−${money(g.fee)}</b></div>
          <div class="row total"><span>3. Net reçu dans le wallet</span><b>${money(g.net)}</b></div>
          <div class="row"><span>4. Part des boosters</span><b class="minus">−${money(g.boosters)}</b></div>
          <div class="row total"><span>5. Ma part sur les commandes</span><b>${money(g.flowey)}</b></div>
          <div class="row"><span>6. + Gains reportés (historique…)</span><b>${money(d.adj.flowey)}</b></div>
          <div class="row"><span>7. Frais de retrait / conversion</span><b class="minus">−${money(wdFee)}</b></div>
          <div class="row total"><span>8. Mon bénéfice final</span><b>${money(r2(myTotal - wdFee))}</b></div>
        </div></div>
      <div><div class="card-head"><h2>Autres chiffres</h2></div>
        <div class="chain">
          <div class="row"><span>Déjà payé aux boosters (total)</span><b>${money(d.paid)}</b></div>
          <div class="row"><span>Commandes en attente</span><b>${d.pending.count} · ${money(d.pending.net)} net</b></div>
          <div class="row"><span>Commandes annulées</span><b>${d.counts.cancelled}</b></div>
          <div class="row"><span>Taux Eldorado actuel</span><b>${pct(d.rate, 2)}</b></div>
          <div class="row"><span>Contrôle d'équilibre</span><b class="${Math.abs(n(g.gap)) < 0.005 ? 'green' : 'red'}">${Math.abs(n(g.gap)) < 0.005 ? '✔ Aucun centime perdu' : '⚠ ' + money(g.gap)}</b></div>
        </div></div>
    </div>
  </details>`;
}

function teamMini(list) {
  if (!list.length) return emptyBox('Aucun booster pour l\'instant.', 'users');
  return `<div class="chain">${list.filter((b) => b.active).map((b) => {
    const rest = r2(n(b.earned) - n(b.paid));
    return `<div class="row"><span style="display:flex;gap:8px;align-items:center">${avatarHtml(b.name, 'sm')}<b>${esc(b.name)}</b>${availBadge(b.availability)}
      ${b.active_orders ? `<span class="muted small">${b.active_orders} en cours</span>` : ''}</span>
      <span style="display:flex;gap:8px;align-items:center">${rest > 0.004 ? `<b class="red">${money(rest)}</b>
      <button class="sm" data-action="pay" data-id="${b.id}" data-amount="${rest}">Payer</button>` : '<span class="green small">à jour</span>'}</span></div>`;
  }).join('')}</div>`;
}

function fmtHours(h) {
  const v = n(h);
  if (v < 1) return Math.max(1, Math.round(v * 60)) + ' min';
  if (v < 48) return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' h';
  return (v / 24).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' j';
}
function teamTable(list, compact) {
  if (!list.length) return emptyBox('Aucun booster. Ajoute-les dans l\'onglet Équipe.');
  return `<div class="table-wrap"><table><thead><tr>
    <th>Booster</th><th>Dispo</th>${compact ? '' : '<th>Compte</th><th>Licence</th>'}<th class="num">En cours</th><th class="num">Validées</th>${compact ? '' : '<th class="num">Délai moyen</th>'}
    ${compact ? '' : '<th class="num">Net généré</th>'}<th class="num">Gagné</th><th class="num">Payé</th><th class="num">Reste à payer</th>
    ${compact ? '' : '<th class="num">En attente</th><th>Statut</th>'}<th></th></tr></thead><tbody>
    ${list.map((b) => {
    const rest = r2(n(b.earned) - n(b.paid));
    const lic = b.expires_at ? (new Date(b.expires_at) > new Date() ? `jusqu'au ${fdate(b.expires_at)}` : '<span class="red">expirée</span>') : '<span class="muted">aucune</span>';
    return `<tr><td class="strong">${whoCell(b.name)}</td><td>${availBadge(b.availability)}</td>
      ${compact ? '' : `<td>${esc(b.email || '—')}</td><td>${lic}</td>`}
      <td class="num">${b.active_orders}</td><td class="num">${b.count}</td>${compact ? '' : `<td class="num">${b.avg_hours != null ? fmtHours(b.avg_hours) : '—'}</td>`}
      ${compact ? '' : `<td class="num">${money(b.net)}</td>`}
      <td class="num">${money(b.earned)}</td><td class="num">${money(b.paid)}</td>
      <td class="num ${Math.abs(rest) > 0.004 ? 'red' : 'green'}">${rest < -0.004 ? 'trop payé ' + money(-rest) : money(rest)}</td>
      ${compact ? '' : `<td class="num">${money(b.pending)}</td>
      <td><button class="sm ghost" data-action="toggle-booster" data-id="${b.id}" data-active="${b.active}">
        ${b.active ? '<span class="badge b-green">Actif</span>' : '<span class="badge b-grey">Inactif</span>'}</button></td>`}
      <td class="actions">${rest > 0.004 ? `<button class="sm" data-action="pay" data-id="${b.id}" data-amount="${rest}">Payer</button>` : ''}
        ${compact ? '' : `<button class="sm" data-action="note-to" data-id="${b.id}">Note</button>
        <button class="sm" data-action="key-for" data-id="${b.id}">Clé</button>
        <button class="sm" data-action="rename-booster" data-id="${b.id}" data-name="${esc(b.name)}">Renommer</button>
        <button class="sm danger" data-action="del-booster" data-id="${b.id}" data-name="${esc(b.name)}">Supprimer</button>`}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

/* =====================================================================
   ADMIN — COMMANDES
   ===================================================================== */
function feeRateFor(date) {
  let rate = S.fees.length ? n(S.fees[0].rate) : 0.1;
  for (const f of S.fees) if (f.effective_from <= date) rate = n(f.rate);
  return rate;
}
function previewSplit(o) {
  const gross = n(o.gross);
  if (!(gross > 0)) return null;
  const rate = feeRateFor(o.order_date || today());
  const fee = r2(gross * rate);
  const net = r2(gross - fee);
  const rule = S.rules.find((r) => r.type === o.split_type);
  if (!rule) return { rate, fee, net, none: true };
  const pool = 1 - n(rule.flowey_share);
  let b1 = 0; let b2 = 0;
  if (rule.boosters_needed === 2) {
    const split = o.split_type === 'BOOSTERS SANS MOI'
      ? (o.split_b1 !== '' && o.split_b1 != null ? n(o.split_b1) / 100 : n(S.settings.default_split_b1)) : 0.5;
    b1 = r2(net * pool * split); b2 = r2(net * pool * (1 - split));
  } else if (rule.boosters_needed === 1) b1 = r2(net * pool);
  return { rate, fee, net, b1, b2, flowey: r2(net - b1 - b2), need: rule.boosters_needed };
}

function boosterOptions(sel, extraIds = []) {
  const list = S.boosters.filter((b) => b.active || b.id === sel || extraIds.includes(b.id));
  return opt('', '—', !sel) + list.map((b) => opt(b.id, `${b.name} · ${b.availability || ''}`, b.id === sel)).join('');
}
function typeOptions(sel, allowNone) {
  return (allowNone ? opt('', 'À décider (attribuer plus tard)', !sel) : '')
    + S.rules.map((r) => opt(r.type, `${r.type} — ${r.label}`, r.type === sel)).join('');
}
function splitFields(e) {
  return `${field('Type de répartition', `<select name="split_type" data-change="split-type">${typeOptions(e.split_type, true)}</select>`, 'class="field span-2"')}
    ${field('Booster 1', `<select name="booster1_id">${boosterOptions(e.booster1_id)}</select>`)}
    ${field('Booster 2', `<select name="booster2_id">${boosterOptions(e.booster2_id)}</select>`)}
    ${field('Part Booster 1 sur les 70 % (%)', `<input name="split_b1" type="number" step="1" min="0" max="100" placeholder="${Math.round(n(S.settings.default_split_b1) * 100)}" value="${e.split_b1 != null ? Math.round(n(e.split_b1) * 100) : ''}">`, 'data-split')}`;
}

function orderForm(o) {
  const e = o || {};
  const games = [...new Set((S.orderRows || []).map((r) => r.game).filter(Boolean))];
  return `<form data-form="order">
    <div class="card-head"><h2>${ic(o ? 'edit' : 'plus')} ${o ? 'Modifier la commande ' + esc(e.ref) : 'Nouvelle commande'}</h2>
      <button type="button" class="sm ghost" data-action="close-modal">${ic('x')}</button></div>
    <datalist id="games">${games.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
    <div class="section-title">L'essentiel</div>
    <div class="form-grid">
      ${field('Lien de la commande Eldorado', `<div style="display:flex;gap:6px"><input name="eldorado_url" value="${esc(e.eldorado_url)}" placeholder="https://www.eldorado.gg/…" data-change="eldo-url">
        <button type="button" class="sm" data-action="paste-url" title="Coller depuis le presse-papiers">${ic('copy')}</button></div>`, 'class="field span-2"')}
      ${field('ID de la commande Eldorado *', `<input name="ref" required value="${esc(e.ref)}" autofocus>`)}
      ${field('Prix payé par le client ($) *', `<input name="gross" type="number" step="0.01" min="0.01" required value="${esc(e.gross)}">`)}
      ${field('Jeu', `<input name="game" value="${esc(e.game)}" list="games" placeholder="Valorant, LoL…">`)}
      ${field('Service', `<input name="service" value="${esc(e.service)}" placeholder="Rank boost, placements…">`)}
      ${field('Rang actuel', `<input name="current_rank" value="${esc(e.current_rank)}">`)}
      ${field('Rang visé', `<input name="target_rank" value="${esc(e.target_rank)}">`)}
      ${field('À livrer avant le', `<input name="deadline" type="datetime-local" value="${esc(toLocalInput(e.deadline))}">`)}
      ${field('Consignes pour le booster', `<textarea name="instructions" placeholder="Ex. : pas de chat vocal, jouer le soir…">${esc(e.instructions)}</textarea>`, 'class="field span-all"')}
    </div>
    <div class="section-title">Qui s'en occupe ? <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">(tu peux décider plus tard)</span></div>
    <div class="form-grid">${splitFields(e)}</div>
    ${o ? '' : `<details><summary>Accès au compte du client (optionnel)</summary>
      <div class="form-grid">
        ${field('Identifiant', '<input name="s_login" autocomplete="off">')}
        ${field('Mot de passe', '<input name="s_password" autocomplete="off">')}
        ${field('Infos en plus (2FA…)', '<input name="s_extra" autocomplete="off">', 'class="field span-2"')}
      </div><div class="warn-box">Visible uniquement par le booster attribué, et effacé automatiquement à la livraison.</div></details>`}
    <details ${o ? 'open' : ''}><summary>Plus d'options</summary>
      <div class="form-grid">
        ${field('Date de la commande', `<input name="order_date" type="date" required value="${esc(e.order_date || today())}">`)}
        ${field('Client (pseudo Eldorado)', `<input name="client" value="${esc(e.client)}">`)}
        ${field('Serveur / région', `<input name="server" value="${esc(e.server)}">`)}
        ${field('Statut compta', `<select name="status">${STATUSES.map((s) => opt(s, s, s === (e.status || 'En attente'))).join('')}</select>`)}
        ${field('Notes internes (toi seul)', `<input name="notes" value="${esc(e.notes)}">`, 'class="field span-2"')}
      </div></details>
    <div class="preview" id="preview"></div>
    <div class="form-actions"><button class="primary" type="submit">${ic('check')} ${o ? 'Enregistrer' : 'Créer la commande'}</button>
      <button type="button" data-action="close-modal">Annuler</button>
      <span class="muted small">Frais, net et parts sont calculés automatiquement.</span></div>
  </form>`;
}
function openOrderForm(o) {
  S.orders.editing = o || null;
  modal(orderForm(o));
  updateSplitForm(document.querySelector('form[data-form="order"]'), $('#preview'));
}

function updateSplitForm(form, previewBox) {
  if (!form) return;
  const o = formData(form);
  const rule = S.rules.find((r) => r.type === o.split_type) || { boosters_needed: 0 };
  const b1 = form.elements.booster1_id; const b2 = form.elements.booster2_id;
  b1.disabled = rule.boosters_needed < 1; if (b1.disabled) b1.value = '';
  b2.disabled = rule.boosters_needed < 2; if (b2.disabled) b2.value = '';
  const sp = form.querySelector('[data-split]');
  if (sp) sp.classList.toggle('hidden', o.split_type !== 'BOOSTERS SANS MOI');
  const box = previewBox;
  if (!box) return;
  const gross = form.elements.gross ? o.gross : (S.current && S.current.gross);
  const p = previewSplit({ ...o, gross, order_date: o.order_date || (S.current && S.current.order_date) });
  if (!p) { box.innerHTML = '<span class="muted">Entre un prix brut pour voir la répartition.</span>'; return; }
  const nm1 = b1.value ? boosterName(b1.value) : 'Booster 1';
  const nm2 = b2.value ? boosterName(b2.value) : 'Booster 2';
  box.innerHTML = `<span>Frais Eldorado (${pct(p.rate, 2)}) : <b>${money(p.fee)}</b></span>
    <span>Net : <b>${money(p.net)}</b></span>
    ${p.none ? '<span class="muted">Répartition calculée à l\'attribution</span>' : `
    <span>Flowey : <b style="color:var(--accent-2)">${money(p.flowey)}</b></span>
    ${p.need >= 1 ? `<span>${esc(nm1)} : <b>${money(p.b1)}</b></span>` : ''}
    ${p.need >= 2 ? `<span>${esc(nm2)} : <b>${money(p.b2)}</b></span>` : ''}`}`;
}

async function viewOrders(main) {
  const f = S.orders;
  let q = sb.from('orders').select('*', { count: 'exact' })
    .order('order_date', { ascending: false }).order('created_at', { ascending: false })
    .range(f.page * PAGE, f.page * PAGE + PAGE - 1);
  if (f.stage === 'Annulée') q = q.eq('status', 'Annulée');
  else if (f.stage) q = q.eq('stage', f.stage).neq('status', 'Annulée');
  if (f.month) {
    const [y, m] = f.month.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    q = q.gte('order_date', `${f.month}-01`).lt('order_date', end);
  }
  if (f.q) {
    const s = f.q.replace(/[,()%]/g, ' ');
    q = q.or(`ref.ilike.%${s}%,client.ilike.%${s}%,game.ilike.%${s}%,service.ilike.%${s}%`);
  }
  const [{ data: rows, count }, dash] = await Promise.all([run(q), run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month }))]);
  S.dash = dash;
  const st = dash.stages;
  const chips = [['', 'Toutes', null], ['À attribuer', 'À attribuer', st.todo], ['Attribuée', 'Attribuées', st.assigned],
    ['En cours', 'En cours', st.doing], ['Livrée', 'Livrées · à valider', st.delivered], ['Validée', 'Validées', null], ['Annulée', 'Annulées', null]];
  main.innerHTML = `
  ${head('Commandes', 'Toutes tes commandes Eldorado : crée, attribue, suis et valide', `<input placeholder="Rechercher ID, client, jeu…" data-change="o-q" value="${esc(f.q)}" style="width:220px">
      <input type="month" data-change="o-month" value="${esc(f.month)}" style="width:160px">
      <button data-action="export-orders" title="Exporter en CSV (Excel)">${ic('download')} Export</button>
      <button class="primary" data-action="new-order">${ic('plus')} Nouvelle commande</button>`)}
  <div class="chips">${chips.map(([v, l, c]) => `<button class="chip ${f.stage === v ? 'active' : ''}" data-action="orders-stage" data-stage="${esc(v)}">${l}${c ? `<span class="count">${c}</span>` : ''}</button>`).join('')}</div>
  <div class="card">
    ${rows.length ? `<div class="table-wrap"><table><thead><tr>
      <th>ID</th><th>Date</th><th>Jeu · service</th><th>Rang</th><th class="num">Brut</th><th class="num">Net</th><th>Étape</th>
      <th>Boosters</th><th>À livrer avant</th><th class="num">Flowey</th><th></th></tr></thead><tbody>
      ${rows.map((o) => `<tr class="${o.status === 'Annulée' ? 'cancelled' : ''}">
        <td class="strong"><a href="#" data-action="open-order" data-id="${o.id}">${esc(o.ref)}</a></td><td>${fdate(o.order_date)}</td>
        <td>${esc([o.game, o.service].filter(Boolean).join(' · ') || '—')}</td>
        <td>${o.current_rank || o.target_rank ? esc(`${o.current_rank || '?'} → ${o.target_rank || '?'}`) : '—'}</td>
        <td class="num">${money(o.gross)}</td><td class="num">${money(o.net)}</td><td class="actions" style="text-align:left">${stageBadge(o)}</td>
        <td>${o.split_type === 'SOLO' ? 'Moi (solo)' : [o.booster1_id, o.booster2_id].filter(Boolean).map(boosterName).map(esc).join(' + ') || '—'}</td>
        <td class="${isLate(o) ? 'late' : ''}">${o.deadline ? fdt(o.deadline) : '—'}</td>
        <td class="num strong">${o.flowey_part != null ? money(o.flowey_part) : '—'}</td>
        <td class="actions">${!o.split_type && o.status !== 'Annulée' ? `<button class="sm primary" data-action="assign" data-id="${o.id}">Attribuer</button>` : ''}
          ${o.stage === 'Livrée' && o.status !== 'Annulée' ? `<button class="sm primary" data-action="validate" data-id="${o.id}">Valider</button>` : ''}
          <button class="sm" data-action="open-order" data-id="${o.id}">Ouvrir</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="pager"><span>${count} commande${count > 1 ? 's' : ''} · page ${f.page + 1} / ${Math.max(1, Math.ceil(count / PAGE))}</span><span>
        <button class="sm" data-action="o-page" data-d="-1" ${f.page === 0 ? 'disabled' : ''}>◀</button>
        <button class="sm" data-action="o-page" data-d="1" ${(f.page + 1) * PAGE >= count ? 'disabled' : ''}>▶</button></span></div>`
    : emptyBox('Aucune commande ici.')}
  </div>`;
  S.orderRows = rows;
}

function orderPayload(form) {
  const o = formData(form);
  return {
    ref: o.ref, order_date: o.order_date, client: o.client || null, game: o.game || null,
    service: o.service || null, current_rank: o.current_rank || null, target_rank: o.target_rank || null,
    server: o.server || null, deadline: o.deadline ? new Date(o.deadline).toISOString() : null,
    instructions: o.instructions || null, notes: o.notes || null,
    eldorado_url: o.eldorado_url || null,
    gross: n(o.gross), status: o.status,
    split_type: o.split_type || null,
    booster1_id: form.elements.booster1_id.disabled ? null : (o.booster1_id || null),
    booster2_id: form.elements.booster2_id.disabled ? null : (o.booster2_id || null),
    split_b1: o.split_type === 'BOOSTERS SANS MOI' && o.split_b1 !== '' ? n(o.split_b1) / 100 : null,
  };
}

async function onOrderSubmit(form) {
  const o = formData(form);
  const payload = orderPayload(form);
  try {
    if (S.orders.editing) {
      await run(sb.from('orders').update(payload).eq('id', S.orders.editing.id));
      toast('Commande modifiée');
      const id = S.orders.editing.id;
      S.orders.editing = null;
      return openOrder(id);
    }
    const created = await run(sb.from('orders').insert(payload).select('id').single());
    if (o.s_login || o.s_password || o.s_extra) {
      await run(sb.from('order_secrets').insert({ order_id: created.id, login: o.s_login || null, password: o.s_password || null, extra: o.s_extra || null }));
    }
    toast(payload.booster1_id ? 'Commande créée et attribuée — le booster est notifié' : 'Commande créée');
    openOrder(created.id);
  } catch (e) { toast(errMsg(e), 'error'); }
}

/* ---------- fenêtre « Attribuer » ---------- */
async function openAssign(id) {
  const o = await run(sb.from('orders').select('*').eq('id', id).single());
  S.current = o;
  modal(`<form data-form="assign" data-id="${o.id}">
    <div class="card-head"><h2>${ic('users')} Attribuer ${esc(o.ref)}</h2><button type="button" class="sm ghost" data-action="close-modal">${ic('x')}</button></div>
    <p class="muted small">${esc([o.game, o.service].filter(Boolean).join(' · '))} · ${money(o.gross)} brut</p>
    <div class="form-grid">${splitFields(o)}</div>
    <div class="preview" id="assign-preview"></div>
    <div class="form-actions"><button class="primary" type="submit">Attribuer</button>
      <button type="button" data-action="close-modal">Annuler</button>
      <span class="muted small">Le booster reçoit une notification.</span></div>
  </form>`, 'small');
  const f = document.querySelector('form[data-form="assign"]');
  updateSplitForm(f, $('#assign-preview'));
}
async function onAssign(form) {
  const o = formData(form);
  try {
    await run(sb.from('orders').update({
      split_type: o.split_type || null,
      booster1_id: form.elements.booster1_id.disabled ? null : (o.booster1_id || null),
      booster2_id: form.elements.booster2_id.disabled ? null : (o.booster2_id || null),
      split_b1: o.split_type === 'BOOSTERS SANS MOI' && o.split_b1 !== '' ? n(o.split_b1) / 100 : null,
    }).eq('id', form.dataset.id));
    closeModal();
    toast('Commande attribuée');
    if (S.view === 'order') refreshOrderSoft(); else refresh();
  } catch (e) { toast(errMsg(e), 'error'); }
}

async function setStage(id, patch, msg) {
  try {
    await run(sb.from('orders').update(patch).eq('id', id));
    toast(msg);
    if (S.view === 'order') refreshOrderSoft(); else refresh();
  } catch (e) { toast(errMsg(e), 'error'); }
}

/* =====================================================================
   DÉTAIL D'UNE COMMANDE (admin et booster) + CHAT
   ===================================================================== */
function stepsBar(o) {
  const i = STAGES.indexOf(o.stage);
  return `<div class="steps">${STAGES.map((s, k) => `<span class="${k < i ? 'done' : k === i ? 'now' : ''}">${esc(s)}</span>`).join('')}</div>`;
}

async function viewOrder(main) {
  const id = S.orderId;
  const admin = isAdmin();
  const [o, secret, msgs] = await Promise.all([
    admin ? run(sb.from('orders').select('*').eq('id', id).single()) : run(sb.rpc('my_order', { p_order: id })),
    run(sb.from('order_secrets').select('*').eq('order_id', id).maybeSingle()),
    run(sb.from('messages').select('*').eq('order_id', id).order('created_at').limit(500)),
  ]);
  S.current = o; S.messages = msgs;
  const cancelled = o.status === 'Annulée';
  const secretsAllowed = !cancelled && ['À attribuer', 'Attribuée', 'En cours'].includes(o.stage);

  let actions = '';
  if (admin) {
    if (!cancelled) {
      actions += `<button class="${o.split_type ? '' : 'primary'}" data-action="assign" data-id="${o.id}">${o.split_type ? 'Changer l\'attribution' : 'Attribuer'}</button>`;
      if (o.stage === 'Attribuée') actions += `<button data-action="stage" data-id="${o.id}" data-stage="En cours">Marquer en cours</button>`;
      if (o.stage === 'En cours') actions += `<button data-action="stage" data-id="${o.id}" data-stage="Livrée">Marquer livrée</button>`;
      if (o.stage !== 'Validée' && o.split_type) actions += `<button class="primary" data-action="validate" data-id="${o.id}">${ic('check')} Valider la commande</button>`;
      if (o.stage === 'Validée') actions += `<button data-action="reopen" data-id="${o.id}">Rouvrir</button>`;
      actions += `<button data-action="edit-order" data-id="${o.id}">${ic('edit')} Modifier</button>`;
      actions += `<button data-action="dup-order" data-id="${o.id}">${ic('copy')} Dupliquer</button>`;
      if (o.eldorado_url) actions += `<button data-action="open-eldo" data-url="${esc(o.eldorado_url)}">${ic('external')} Voir sur Eldorado</button>`;
      actions += `<button class="danger" data-action="cancel-order" data-id="${o.id}">Annuler la commande</button>`;
      actions += `<button class="danger" data-action="del-order" data-id="${o.id}" data-ref="${esc(o.ref)}">${ic('x')} Supprimer</button>`;
    } else {
      actions += `<button data-action="restore-order" data-id="${o.id}">Rétablir</button>`;
      actions += `<button class="danger" data-action="del-order" data-id="${o.id}" data-ref="${esc(o.ref)}">Supprimer définitivement</button>`;
    }
  } else if (!cancelled) {
    if (o.stage === 'Attribuée') actions = `<button class="primary" data-action="bstage" data-id="${o.id}" data-stage="En cours">${ic('play')} Je commence</button>`;
    if (o.stage === 'En cours') actions = `<button class="primary" data-action="bstage" data-id="${o.id}" data-stage="Livrée">${ic('check')} J'ai terminé</button>`;
    if (o.stage === 'Livrée') actions = '<span class="muted">En attente de validation par Flowey.</span>';
    if (o.stage === 'Validée') actions = '<span class="green">Validée : ta part est comptée dans tes gains.</span>';
  }

  const infos = `<div class="kv">
    <div class="k">Jeu</div><div>${esc(o.game || '—')}</div>
    <div class="k">Service</div><div>${esc(o.service || '—')}</div>
    <div class="k">Rang</div><div><b>${esc(o.current_rank || '?')}</b> → <b>${esc(o.target_rank || '?')}</b></div>
    <div class="k">Serveur / région</div><div>${esc(o.server || '—')}</div>
    <div class="k">À livrer avant</div><div class="${isLate(o) ? 'late' : ''}">${o.deadline ? fdt(o.deadline) : '—'}${isLate(o) ? ' · en retard' : ''}</div>
    <div class="k">Date commande</div><div>${fdate(o.order_date)}</div>
    ${admin ? `<div class="k">Client</div><div>${esc(o.client || '—')}</div>` : ''}
    <div class="k">Consignes</div><div class="pre">${esc(o.instructions || '—')}</div>
    ${admin && o.notes ? `<div class="k">Notes internes</div><div class="pre">${esc(o.notes)}</div>` : ''}
  </div>`;

  const split = admin
    ? `<div class="kv">
        <div class="k">Type</div><div>${esc(o.split_type || 'À décider')}</div>
        <div class="k">Brut / frais</div><div>${money(o.gross)} − ${money(o.fee)} (${pct(o.fee_rate, 2)})</div>
        <div class="k">Net</div><div><b>${money(o.net)}</b></div>
        ${o.split_type ? `<div class="k">Flowey</div><div><b style="color:var(--accent-2)">${money(o.flowey_part)}</b></div>
        ${o.booster1_id ? `<div class="k">${esc(boosterName(o.booster1_id))}</div><div>${money(o.b1_part)}</div>` : ''}
        ${o.booster2_id ? `<div class="k">${esc(boosterName(o.booster2_id))}</div><div>${money(o.b2_part)}</div>` : ''}` : ''}
        <div class="k">Compta</div><div>${esc(o.status)}</div></div>`
    : `<div class="kv"><div class="k">Ma part</div><div><b style="font-size:18px;color:var(--accent-2)">${money(o.my_part)}</b></div>
        <div class="k">Avec</div><div>${o.teammates && o.teammates.length ? o.teammates.map(esc).join(', ') : 'Seul'}</div>
        <div class="k">Type</div><div>${esc(o.split_type)}</div></div>`;

  let secretBox = '';
  if (admin) {
    secretBox = secretsAllowed ? `<form data-form="secret" data-id="${o.id}"><div class="form-grid">
        ${field('Identifiant', `<input name="login" autocomplete="off" value="${esc(secret && secret.login)}">`)}
        ${field('Mot de passe', `<input name="password" autocomplete="off" value="${esc(secret && secret.password)}">`)}
        ${field('Infos en plus', `<input name="extra" autocomplete="off" value="${esc(secret && secret.extra)}">`, 'class="field span-2"')}
      </div><div class="form-actions"><button type="submit">Enregistrer les accès</button>
      ${secret ? `<button type="button" class="danger" data-action="del-secret" data-id="${o.id}">Effacer</button>` : ''}</div></form>
      <div class="warn-box">Visible uniquement par le booster attribué, et effacé automatiquement quand la commande est livrée ou annulée.</div>`
      : '<p class="muted small">Les accès au compte ont été effacés (commande livrée, validée ou annulée).</p>';
  } else if (secret) {
    secretBox = ['login', 'password', 'extra'].filter((k) => secret[k]).map((k) => `<div class="secret-row">
        <span class="muted small" style="width:90px">${{ login: 'Identifiant', password: 'Mot de passe', extra: 'Infos' }[k]}</span>
        <code>${esc(secret[k])}</code><button class="sm" data-action="copy" data-text="${esc(secret[k])}">Copier</button></div>`).join('')
      + '<div class="warn-box">Ne partage jamais ces accès. Ils seront effacés automatiquement à la livraison.</div>';
  } else {
    secretBox = '<p class="muted small">Aucun accès fourni (ou déjà effacé après livraison).</p>';
  }

  main.innerHTML = `
  <div class="page-head"><div style="display:flex;align-items:center;gap:12px">
      <button class="sm" data-action="nav" data-view="${admin ? 'orders' : 'myorders'}">${ic('back')} Retour</button>
      <h1>Commande ${esc(o.ref)}</h1>${stageBadge(o)}</div></div>
  ${cancelled ? '' : stepsBar(o)}
  <div class="detail">
    <div>
      <div class="card"><div class="card-head"><h2>${ic('sparkles')} Actions</h2></div><div class="actions-row">${actions || '<span class="muted">—</span>'}</div></div>
      <div class="card"><div class="card-head"><h2>${ic('rocket')} Infos du boost</h2></div>${infos}</div>
      <div class="card"><div class="card-head"><h2>${admin ? 'Répartition' : 'Ma rémunération'}</h2></div>${split}</div>
      <div class="card"><div class="card-head"><h2>${ic('lock')} Accès au compte</h2></div>${secretBox}</div>
    </div>
    <div class="card chat"><div class="card-head"><h2>${ic('chat')} Chat de la commande</h2>
      <span class="muted small">${admin ? 'Toi + booster(s) attribué(s)' : 'Toi, Flowey et tes coéquipiers'}</span></div>
      <div class="chat-log" id="chat-log"></div>
      <form class="chat-form" data-form="chat" data-id="${o.id}">
        <textarea name="body" placeholder="Écris un message… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)" required></textarea>
        <button class="primary" type="submit">Envoyer</button></form>
    </div>
  </div>`;
  renderChat();
  startChat(id);
}
async function refreshOrderSoft() {
  const scroll = $('#main').scrollTop;
  await go('order', true);
  $('#main').scrollTop = scroll;
}

function renderChat() {
  const log = $('#chat-log');
  if (!log) return;
  const mine = (m) => (isAdmin() ? m.author_name === 'Flowey' : m.author_name === S.access.booster);
  log.innerHTML = S.messages.length ? S.messages.map((m) => `<div class="msg-line ${mine(m) ? 'mine' : ''}">${avatarHtml(m.author_name, 'sm')}<div class="msg">
      <div class="who">${esc(m.author_name)} · ${fdt(m.created_at)}</div><div class="txt">${esc(m.body)}</div></div></div>`).join('')
    : emptyBox('Aucun message. Utilise le chat pour tout ce qui concerne cette commande.');
  log.scrollTop = log.scrollHeight;
}
function addMessage(m) {
  if (S.messages.some((x) => x.id === m.id)) return;
  S.messages.push(m);
  renderChat();
}
function startChat(id) {
  stopChat();
  S.chat = sb.channel('chat-' + id).on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages', filter: 'order_id=eq.' + id },
    (payload) => addMessage(payload.new)).subscribe();
}
async function onChat(form) {
  const body = form.elements.body.value.trim();
  if (!body) return;
  form.elements.body.value = '';
  try {
    const m = await run(sb.from('messages').insert({ order_id: form.dataset.id, body }).select().single());
    addMessage(m);
  } catch (e) { form.elements.body.value = body; toast(errMsg(e), 'error'); }
}

/* =====================================================================
   ADMIN — ÉQUIPE, ANNONCES
   ===================================================================== */
async function viewBoosters(main) {
  const d = await run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month }));
  S.dash = d;
  main.innerHTML = `${head('Équipe', 'Tes boosters, leur dispo, leurs accès et ce que tu leur dois')}
  <div class="card"><div class="card-head"><h2>Boosters</h2><span class="muted small">Validées = commandes terminées · clic sur Actif/Inactif pour changer · Renommer corrige un pseudo sans rien perdre</span></div>
    ${teamTable(d.boosters, false)}</div>
  <form class="card" data-form="booster"><div class="card-head"><h2>Ajouter un booster</h2></div>
    <div class="form-grid">${field('Nom', '<input name="name" required>')}${field('Notes / contact (Discord…)', '<input name="notes">')}</div>
    <div class="form-actions"><button class="primary" type="submit">Ajouter</button>
    <span class="muted small">Puis clique sur « Clé » pour lui créer sa licence.</span></div></form>`;
}

async function viewAnnouncements(main) {
  const rows = await run(sb.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100));
  const pre = S.annPreset;
  main.innerHTML = `${head('Annonces', 'Écris à toute l\'équipe ou à un seul booster : ils le voient sur leur accueil')}
  <form class="card" data-form="announcement"><div class="card-head"><h2>Écrire</h2></div>
    <div class="form-grid">
      ${field('Pour', `<select name="booster_id">${opt('', 'Toute l\'équipe (annonce)', !pre)}${S.boosters.filter((b) => b.active).map((b) => opt(b.id, 'Seulement ' + b.name + ' (note privée)', b.id === pre)).join('')}</select>`)}
      ${field('Titre', '<input name="title" required>', 'class="field span-2"')}
      ${field('Épingler en haut', '<select name="pinned"><option value="">Non</option><option value="1">Oui</option></select>')}
      ${field('Message', '<textarea name="body"></textarea>', 'class="field span-all"')}
    </div>
    <div class="form-actions"><button class="primary" type="submit">Publier</button>
      <span class="muted small">Apparaît sur l'accueil du ou des boosters, avec une notification.</span></div></form>
  <div class="card"><div class="card-head"><h2>Publiées</h2></div>
    ${rows.length ? rows.map((a) => `<div class="ann ${a.pinned ? 'pinned' : ''}"><div class="h"><span>${a.pinned ? '<span class="badge b-purple" style="margin-right:6px">Épinglé</span>' : ''}${esc(a.title)}
        <span class="badge ${a.booster_id ? 'b-purple' : 'b-blue'}" style="margin-left:6px">${a.booster_id ? 'Pour ' + esc(boosterName(a.booster_id)) : 'Équipe'}</span></span>
        <span><span class="d">${fdt(a.created_at)}</span>
        <button class="sm" data-action="pin" data-id="${a.id}" data-pinned="${a.pinned}">${a.pinned ? 'Désépingler' : 'Épingler'}</button>
        <button class="sm danger" data-action="del-ann" data-id="${a.id}">✕</button></span></div>
        ${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}</div>`).join('') : emptyBox('Rien pour l\'instant.')}</div>`;
  S.annPreset = null;
}
function annList(rows) {
  if (!rows.length) return emptyBox('Aucune annonce.');
  return rows.map((a) => `<div class="ann ${a.pinned ? 'pinned' : ''}"><div class="h"><span>${a.pinned ? '<span class="badge b-purple" style="margin-right:6px">Épinglé</span>' : ''}${esc(a.title)}
    ${a.booster_id ? '<span class="badge b-purple" style="margin-left:6px">Pour toi</span>' : ''}</span><span class="d">${fdt(a.created_at)}</span></div>
    ${a.body ? `<div class="b">${esc(a.body)}</div>` : ''}</div>`).join('');
}

/* =====================================================================
   WALLET D'ÉQUIPE (tout le monde)
   ===================================================================== */
async function viewWallet(main) {
  const w = await run(sb.rpc('team_wallet'));
  const m0 = new Date(w.month + 'T12:00:00');
  const goal = n(w.goal);
  const prog = goal > 0 ? Math.min(1, n(w.month_net) / goal) : 0;
  main.innerHTML = `${head('Wallet équipe', `Ce que l'équipe a généré en ${MONTHS[m0.getMonth()].toLowerCase()} ${m0.getFullYear()}`)}
  <div class="kpis">
    ${kpi('Généré par l\'équipe ce mois (net)', money(w.month_net), 'accent')}
    ${kpi('Commandes validées ce mois', w.month_count)}
    ${kpi('Généré depuis le début (net)', money(w.total_net))}
    ${w.my_month != null ? kpi('Mes gains ce mois', money(w.my_month), 'good') : kpi('Commandes depuis le début', w.total_count)}
  </div>
  ${goal > 0 ? `<div class="card"><div class="card-head"><h2>${ic('sparkles')} Objectif du mois</h2><b>${money(w.month_net)} / ${money(goal)}</b></div>
    <div class="goal"><span style="width:${prog * 100}%"></span></div>
    <div class="muted small">${prog >= 1 ? 'Objectif atteint, bravo à toute l\'équipe !' : `Encore ${money(goal - n(w.month_net))} pour l'atteindre.`}</div></div>` : ''}
  <div class="card"><div class="card-head"><h2>${ic('trophy')} Classement du mois</h2><span class="muted small">Commandes validées</span></div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Nom</th><th>Dispo</th><th class="num">Ce mois</th><th class="num">Depuis le début</th>
      ${w.show_amounts ? '<th class="num">Gagné ce mois</th>' : ''}</tr></thead><tbody>
      ${w.board.map((b, i) => `<tr class="${b.me ? 'me' : ''}"><td class="rank-n">${i + 1}</td><td class="strong"><span class="who-cell">${avatarHtml(b.name, 'sm')}<span>${esc(b.name)}${b.me ? ' (toi)' : ''}</span></span></td>
        <td>${availBadge(b.availability)}</td><td class="num">${b.month_count}</td><td class="num">${b.total_count}</td>
        ${w.show_amounts ? `<td class="num">${b.month_earned != null ? money(b.month_earned) : '—'}</td>` : ''}</tr>`).join('')}
    </tbody></table></div></div>
  ${isAdmin() ? `<form class="card" data-form="wallet-settings"><div class="card-head"><h2>Réglages du wallet (admin)</h2></div>
    <div class="form-grid">
      ${field('Objectif du mois (net, $)', `<input name="goal" type="number" step="1" min="0" value="${goal || ''}" placeholder="0 = pas d'objectif">`)}
      ${field('Les boosters voient les gains des autres ?', `<select name="show">${opt('', 'Non (seulement le nombre de commandes)', !S.settings.wallet_show_amounts)}${opt('1', 'Oui', S.settings.wallet_show_amounts)}</select>`, 'class="field span-2"')}
    </div>
    <div class="form-actions"><button class="primary" type="submit">Enregistrer</button>
    <span class="muted small">Ta part (Flowey) n'est jamais affichée aux boosters. Chaque booster voit toujours ses propres gains.</span></div></form>` : ''}`;
}

/* =====================================================================
   ADMIN — PAIEMENTS, RETRAITS, LICENCES, PARAMÈTRES
   ===================================================================== */
/* =====================================================================
   ADMIN — ELDORADO DANS L'APP (toi seul : les boosters n'ont pas cet onglet)
   ===================================================================== */
function parseAmount(raw) {
  let t = String(raw).replace(/USD|US|\$|\s|\u00a0/g, '');
  const lc = t.lastIndexOf(','); const ld = t.lastIndexOf('.');
  const sep = Math.max(lc, ld);
  if (sep === -1) return Number(t);
  const decimals = t.length - sep - 1;
  const other = sep === lc ? '.' : ',';
  if (decimals === 3 && !t.includes(other)) return Number(t.replace(/[.,]/g, '')); // 1,234 = mille
  const int = t.slice(0, sep).replace(/[.,]/g, '');
  return Number(int + '.' + t.slice(sep + 1));
}

async function viewEldorado(main) {
  const d = await run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month }));
  S.dash = d;
  const el = d.eldorado;
  const owed = r2(n(d.global.boosters) + n(d.adj.boosters) - n(d.paid));
  const base = el.real != null ? n(el.real) : n(el.balance);
  const mine = r2(base - owed);
  const hasDesktop = !!(window.desktop && window.desktop.eldoradoOpen);
  const debts = d.boosters.map((b) => ({ ...b, rest: r2(n(b.earned) - n(b.paid)) })).filter((b) => b.rest > 0.004);
  main.innerHTML = `${head('Eldorado', 'Ton compte Eldorado et la répartition de ton solde · toi seul as cet onglet')}
  <div class="grid-2">
    <div class="card onboard"><div class="card-head"><h2>${ic('globe')} Ton compte Eldorado</h2></div>
      <p>Ouvre Eldorado dans ton navigateur habituel (connexion et vérification normales).</p>
      <div class="form-actions">
        <button class="primary" data-action="eldorado-open" ${hasDesktop ? '' : 'disabled'}>${ic('external')} Ouvrir Eldorado</button></div>
      <p class="muted small">Bientôt : tes commandes Eldorado importées automatiquement via l'API officielle.</p></div>
    <form class="card" data-form="real-balance"><div class="card-head"><h2>${ic('refresh')} Relever mon solde</h2></div>
      <p class="muted small">Tape le solde affiché sur Eldorado : l'app répartit tout de suite ce qui revient à chacun.</p>
      <div class="form-grid">
        ${field('Solde Eldorado ($)', `<input name="real" type="number" step="0.01" min="0" required value="${el.real != null ? el.real : ''}" placeholder="ex. 62.78">`)}
        <div class="field" style="align-self:end"><button class="primary" type="submit">${ic('check')} Répartir</button></div>
      </div>
      ${el.real != null ? `<p class="muted small">Dernier relevé : <b>${money(el.real)}</b> le ${fdt(el.real_at)}</p>` : ''}</form>
  </div>
  <div class="kpis">
    ${kpi(el.real != null ? 'Solde Eldorado (relevé)' : 'Solde Eldorado (calculé)', money(base), 'accent')}
    ${kpi('À verser aux boosters', money(owed), owed > 0.004 ? 'warn' : 'good')}
    ${kpi('À toi dans ce solde', money(mine), mine < -0.004 ? 'bad' : 'good')}
    ${kpi('Écart relevé / calculé', el.real != null ? money(r2(n(el.real) - n(el.balance))) : '—', el.real != null && Math.abs(n(el.real) - n(el.balance)) >= 0.005 ? 'warn' : '')}
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h2>${ic('users')} Qui attend son argent</h2></div>
      ${debts.length ? `<div class="chain">${debts.map((b) => `<div class="row"><span style="display:flex;gap:8px;align-items:center">${avatarHtml(b.name, 'sm')}<b>${esc(b.name)}</b>
        <span class="muted small">${b.payout_details ? esc(b.payout_method || '') : 'coordonnées non renseignées'}</span></span>
        <span style="display:flex;gap:8px;align-items:center"><b class="red">${money(b.rest)}</b>
        <button class="sm primary" data-action="pay" data-id="${b.id}" data-amount="${b.rest}">${ic('send')} Payer</button></span></div>`).join('')}</div>`
    : emptyBox('Tout le monde est payé.', 'check')}</div>
    <div class="card"><div class="card-head"><h2>${ic('download')} Tu as fait un retrait ?</h2></div>
      <p class="muted">Après un retrait sur Eldorado, note-le pour que le solde et ta part restent justes.</p>
      <div class="form-actions"><button data-action="nav" data-view="withdrawals">${ic('wallet')} Noter un retrait</button></div>
      <p class="muted small">Pour payer un booster : retire l'argent sur ton PayPal/Skrill, envoie-lui sa part, puis clique « Payer » ici.</p></div>
  </div>`;
}

/* =====================================================================
   OUTILS — CALCULATEUR DE PRIX, EXPORT CSV
   ===================================================================== */
function viewCalc(main) {
  const rate = feeRateFor(today());
  main.innerHTML = `${head('Calculateur', 'Ce que touche chacun pour un prix donné, et quel prix afficher sur Eldorado')}
  <div class="grid-2">
    <form class="card" data-form="calc-a"><div class="card-head"><h2>${ic('dollar')} Pour un prix client</h2></div>
      <div class="form-grid">${field('Prix payé par le client ($)', '<input name="gross" type="number" step="0.01" min="0" value="20">')}</div>
      <div id="calc-a" style="margin-top:16px"></div></form>
    <form class="card" data-form="calc-b"><div class="card-head"><h2>${ic('sparkles')} Quel prix afficher ?</h2></div>
      <div class="form-grid">
        ${field('Type', `<select name="type">${S.rules.map((r) => opt(r.type, r.type, r.type === 'BOOSTER SEUL')).join('')}</select>`)}
        ${field('Pour que…', '<select name="who"><option value="b">chaque booster touche</option><option value="f">je touche (Flowey)</option></select>')}
        ${field('…au moins ($)', '<input name="want" type="number" step="0.01" min="0" value="10">')}
      </div>
      <div id="calc-b" style="margin-top:16px"></div></form>
  </div>
  <p class="muted small">Taux Eldorado utilisé : ${pct(rate, 2)} (modifiable dans Paramètres). Calcul identique à celui des commandes, au centime près.</p>`;
  updateCalc();
}
function updateCalc() {
  const fa = document.querySelector('form[data-form="calc-a"]');
  const boxA = $('#calc-a');
  if (fa && boxA) {
    const gross = n(fa.elements.gross.value);
    boxA.innerHTML = gross > 0 ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th class="num">Net</th><th class="num">Flowey</th><th class="num">Booster 1</th><th class="num">Booster 2</th></tr></thead><tbody>
      ${S.rules.map((r) => { const p = previewSplit({ split_type: r.type, gross, order_date: today() });
    return `<tr><td class="strong">${esc(r.type)}</td><td class="num">${money(p.net)}</td><td class="num">${money(p.flowey)}</td>
          <td class="num">${p.need >= 1 ? money(p.b1) : '—'}</td><td class="num">${p.need >= 2 ? money(p.b2) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<span class="muted">Entre un prix.</span>';
  }
  const fb = document.querySelector('form[data-form="calc-b"]');
  const boxB = $('#calc-b');
  if (fb && boxB) {
    const type = fb.elements.type.value; const who = fb.elements.who.value; const want = n(fb.elements.want.value);
    const rule = S.rules.find((r) => r.type === type);
    if (!rule || !(want > 0)) { boxB.innerHTML = '<span class="muted">Entre un montant.</span>'; return; }
    if (who === 'b' && rule.boosters_needed === 0) { boxB.innerHTML = '<span class="muted">En SOLO, il n\'y a pas de booster : choisis « je touche ».</span>'; return; }
    const share = (p) => (who === 'f' ? p.flowey : Math.min(p.b1, rule.boosters_needed === 2 ? p.b2 : p.b1));
    const rate = feeRateFor(today());
    const frac = who === 'f' ? n(rule.flowey_share) : (1 - n(rule.flowey_share)) / Math.max(1, rule.boosters_needed);
    let gross = Math.ceil((want / Math.max(0.0001, (1 - rate) * frac)) * 100) / 100;
    let p = previewSplit({ split_type: type, gross, order_date: today() });
    for (let i = 0; i < 500 && share(p) < want - 1e-9; i++) { gross = r2(gross + 0.01); p = previewSplit({ split_type: type, gross, order_date: today() }); }
    for (let i = 0; i < 50 && gross > 0.01; i++) { // on redescend au centime près tant que ça suffit
      const q = previewSplit({ split_type: type, gross: r2(gross - 0.01), order_date: today() });
      if (share(q) < want - 1e-9) break;
      gross = r2(gross - 0.01); p = q;
    }
    boxB.innerHTML = `<div class="muted small">Prix minimum à afficher sur Eldorado</div><div class="calc-big">${money(gross)}</div>
      <div class="chain" style="margin-top:10px"><div class="row"><span>Frais Eldorado</span><b class="minus">−${money(p.fee)}</b></div>
      <div class="row"><span>Net</span><b>${money(p.net)}</b></div><div class="row"><span>Flowey</span><b>${money(p.flowey)}</b></div>
      ${p.need >= 1 ? `<div class="row"><span>Booster 1</span><b>${money(p.b1)}</b></div>` : ''}${p.need >= 2 ? `<div class="row"><span>Booster 2</span><b>${money(p.b2)}</b></div>` : ''}</div>`;
  }
}
function downloadCsv(name, rows) {
  const cell = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}
const num = (v) => (v == null ? '' : n(v).toFixed(2).replace('.', ','));
async function exportOrders() {
  const rows = await run(sb.from('orders').select('*').order('order_date', { ascending: false }).limit(10000));
  downloadCsv(`commandes-${today()}.csv`, [
    ['ID', 'Date', 'Client', 'Jeu', 'Service', 'Rang actuel', 'Rang visé', 'Prix brut $', 'Frais $', 'Net $', 'Type', 'Booster 1', 'Booster 2',
      'Part Flowey $', 'Part B1 $', 'Part B2 $', 'Étape', 'Statut', 'Lien Eldorado', 'Notes'],
    ...rows.map((o) => [o.ref, o.order_date, o.client, o.game, o.service, o.current_rank, o.target_rank, num(o.gross), num(o.fee), num(o.net),
      o.split_type, o.booster1_id ? boosterName(o.booster1_id) : '', o.booster2_id ? boosterName(o.booster2_id) : '',
      num(o.flowey_part), num(o.b1_part), num(o.b2_part), o.stage, o.status, o.eldorado_url, o.notes]),
  ]);
  toast(`${rows.length} commande(s) exportée(s)`);
}
async function exportPayments() {
  const rows = await run(sb.from('payments').select('*').order('pay_date', { ascending: false }).limit(10000));
  downloadCsv(`paiements-${today()}.csv`, [['Date', 'Booster', 'Montant $', 'Méthode', 'Référence', 'Commandes'],
    ...rows.map((p) => [p.pay_date, boosterName(p.booster_id), num(p.amount), p.method, p.reference, p.order_refs])]);
  toast(`${rows.length} paiement(s) exporté(s)`);
}

async function openPay(id, amount) {
  try {
    S.dash = await run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month }));
  } catch (e) { return toast(errMsg(e), 'error'); }
  const b = S.dash.boosters.find((x) => x.id === id) || { name: boosterName(id) };
  const rest = r2(n(b.earned) - n(b.paid));
  const method = PAY_METHODS.includes(b.payout_method) ? b.payout_method : 'PayPal';
  modal(`<form data-form="pay-modal" data-id="${esc(id)}">
    <div class="card-head"><h2>${ic('send')} Payer ${esc(b.name)}</h2><button type="button" class="sm ghost" data-action="close-modal">${ic('x')}</button></div>
    <div class="chain">
      <div class="row"><span>Gagné au total</span><b>${money(b.earned)}</b></div>
      <div class="row"><span>Déjà payé</span><b>${money(b.paid)}</b></div>
      <div class="row total"><span>Reste à payer</span><b>${money(rest)}</b></div>
    </div>
    <div class="section-title">Où lui envoyer l'argent</div>
    ${b.payout_details ? `<div class="secret-row"><span class="muted small" style="width:90px">${esc(b.payout_method || '')}</span>
        <code>${esc(b.payout_details)}</code><button type="button" class="sm" data-action="copy" data-text="${esc(b.payout_details)}">${ic('copy')} Copier</button></div>`
    : `<div class="warn-box">${esc(b.name)} n'a pas encore indiqué où recevoir ses paiements. Il peut le faire dans « Mes gains » de son app.</div>`}
    <div class="section-title">Le paiement</div>
    <div class="form-grid">
      ${field('Montant envoyé ($)', `<input name="amount" type="number" step="0.01" min="0.01" required value="${n(amount) > 0 ? amount : (rest > 0 ? rest : '')}">`)}
      ${field('Méthode', `<select name="method">${PAY_METHODS.map((m) => opt(m, m, m === method)).join('')}</select>`)}
      ${field('Référence (optionnel)', '<input name="reference" placeholder="ID de transaction…">')}
      ${field('Date', `<input name="pay_date" type="date" required value="${today()}">`)}
    </div>
    <div class="form-actions"><button class="primary" type="submit">${ic('check')} J'ai envoyé le paiement</button>
      <button type="button" data-action="close-modal">Annuler</button></div>
    <p class="muted small">Envoie d'abord l'argent (PayPal, Skrill…), puis clique : ${esc(b.name)} est notifié et son solde se met à jour.</p>
  </form>`, 'small');
}

async function viewPayments(main) {
  S.dash = await run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month }));
  const [rows, adjs] = await Promise.all([
    run(sb.from('payments').select('*').order('pay_date', { ascending: false }).limit(300)),
    run(sb.from('adjustments').select('*').order('adj_date', { ascending: false }).order('created_at', { ascending: false }).limit(300)),
  ]);
  const pre = S.payPreset || {};
  main.innerHTML = `${head('Paiements', 'Note chaque versement à un booster : son « reste à payer » se met à jour tout seul')}
  <form class="card" data-form="payment"><div class="card-head"><h2>Enregistrer un paiement</h2></div>
    <div class="form-grid">
      ${field('Date', `<input name="pay_date" type="date" required value="${today()}">`)}
      ${field('Booster', `<select name="booster_id" required data-change="pay-booster">${opt('', '—', !pre.id)}${S.boosters.map((b) => opt(b.id, b.name, b.id === pre.id)).join('')}</select>`)}
      ${field('Montant payé ($)', `<input name="amount" type="number" step="0.01" min="0.01" required value="${pre.amount || ''}">`)}
      ${field('Méthode', `<select name="method">${PAY_METHODS.map((m) => opt(m, m)).join('')}</select>`)}
      ${field('Référence / note', '<input name="reference">')}
      ${field('Commandes concernées', '<input name="order_refs" placeholder="ex. 1234, 1240">')}
    </div>
    <div class="preview" id="pay-info"></div>
    <div class="form-actions"><button class="primary" type="submit">Enregistrer le paiement</button></div></form>
  <div class="card"><div class="card-head"><h2>Historique</h2><button class="sm" data-action="export-payments">${ic('download')} Exporter (CSV)</button></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Booster</th><th class="num">Montant</th>
      <th>Méthode</th><th>Référence</th><th>Commandes</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td>${fdate(p.pay_date)}</td><td class="strong">${esc(boosterName(p.booster_id))}</td>
        <td class="num">${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.reference)}</td><td>${esc(p.order_refs)}</td>
        <td class="actions"><button class="sm danger" data-action="del-payment" data-id="${p.id}">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : emptyBox('Aucun paiement enregistré.')}</div>
  <div class="card"><div class="card-head"><h2>${ic('sparkles')} Gains hors commandes</h2>
    <span class="muted small">Historique reporté (Discord), bonus, corrections · comptés dans les gains et dans le solde Eldorado</span></div>
    <form data-form="adjustment" class="form-grid">
      ${field('Pour', `<select name="booster_id">${opt('', 'Flowey (moi)', true)}${S.boosters.map((b) => opt(b.id, b.name)).join('')}</select>`)}
      ${field('Montant ($)', '<input name="amount" type="number" step="0.01" required placeholder="ex. 4.50 (ou -2 pour corriger)">')}
      ${field('Libellé', '<input name="label" required placeholder="ex. bonus, boosting avant l\'app…">', 'class="field span-2"')}
      ${field('Date', `<input name="adj_date" type="date" required value="${today()}">`)}
      <div class="field" style="align-self:end"><button class="primary" type="submit">${ic('plus')} Ajouter</button></div>
    </form>
    ${adjs.length ? `<div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Date</th><th>Pour</th><th>Libellé</th><th class="num">Montant</th><th></th></tr></thead><tbody>
      ${adjs.map((a) => `<tr><td>${fdate(a.adj_date)}</td><td class="strong">${a.booster_id ? esc(boosterName(a.booster_id)) : 'Flowey'}</td>
        <td>${esc(a.label)}</td><td class="num">${money(a.amount)}</td>
        <td class="actions"><button class="sm danger" data-action="del-adj" data-id="${a.id}">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}</div>`;
  S.payPreset = null;
  updatePayInfo();
}
function updatePayInfo() {
  const sel = document.querySelector('[name="booster_id"]');
  const box = $('#pay-info');
  if (!sel || !box) return;
  const b = ((S.dash && S.dash.boosters) || []).find((x) => x.id === sel.value);
  if (!b) { box.innerHTML = '<span class="muted">Choisis un booster pour voir ce qui lui reste dû.</span>'; return; }
  const rest = r2(n(b.earned) - n(b.paid));
  box.innerHTML = `<span>Gagné : <b>${money(b.earned)}</b></span><span>Déjà payé : <b>${money(b.paid)}</b></span>
    <span>Reste à payer : <b class="${rest > 0.004 ? 'red' : 'green'}">${money(rest)}</b></span>
    ${rest > 0.004 ? `<button type="button" class="sm" data-action="fill-amount" data-amount="${rest}">Tout solder</button>` : ''}`;
}

async function viewWithdrawals(main) {
  const [d, rows] = await Promise.all([
    run(sb.rpc('admin_dashboard', { p_year: S.year, p_month: S.month })),
    run(sb.from('withdrawals').select('*').order('w_date', { ascending: false }).limit(300)),
  ]);
  S.dash = d;
  const el = d.eldorado;
  const owed = r2(n(d.global.boosters) + n(d.adj.boosters) - n(d.paid));
  const mine = r2(n(el.balance) - owed);
  const gap = el.real != null ? r2(n(el.real) - n(el.balance)) : null;
  const t = rows.reduce((a, w) => ({ fee: a.fee + n(w.fee_usd), eur: a.eur + n(w.amount_eur) }), { fee: 0, eur: 0 });
  main.innerHTML = `${head('Wallet Eldorado', 'Ce qu\'il y a sur ton compte Eldorado, et à qui cet argent revient')}
  <div class="kpis">
    ${kpi('Solde Eldorado (calculé)', money(el.balance), 'accent')}
    ${kpi('Dont à verser aux boosters', money(owed), owed > 0.004 ? 'warn' : 'good')}
    ${kpi('Dont à toi', money(mine), mine < -0.004 ? 'bad' : 'good')}
    ${kpi('Retiré au total', money(el.withdrawn))}
  </div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h2>${ic('wallet')} Comment c'est calculé</h2></div>
      <div class="chain">
        <div class="row"><span>Gains reportés (historique Discord…)</span><b>${money(el.adj)}</b></div>
        <div class="row"><span>+ Commandes validées (net après frais Eldorado)</span><b>${money(el.net_orders)}</b></div>
        <div class="row"><span>− Retraits du wallet</span><b class="minus">−${money(el.withdrawn)}</b></div>
        <div class="row total"><span>= Solde Eldorado calculé</span><b>${money(el.balance)}</b></div>
        <div class="row"><span>− Reste à verser aux boosters</span><b class="minus">−${money(owed)}</b></div>
        <div class="row total"><span>= Ta part dans le solde</span><b>${money(mine)}</b></div>
      </div>
      <p class="muted small">Les commandes en attente ne sont pas comptées : Eldorado ne les a pas encore versées.
      Les boosters voient leur part directement dans leur app.</p></div>
    <div class="card"><div class="card-head"><h2>${ic('refresh')} Comparer avec ton vrai solde</h2></div>
      <p class="muted small">Regarde ton solde sur Eldorado et note-le ici : l'app te dit s'il y a un écart (commande oubliée, retrait non noté…).</p>
      <form data-form="real-balance" class="form-grid">
        ${field('Solde affiché sur Eldorado ($)', `<input name="real" type="number" step="0.01" min="0" required value="${el.real != null ? el.real : ''}">`)}
        <div class="field" style="align-self:end"><button class="primary" type="submit">${ic('check')} Comparer</button></div>
      </form>
      ${gap != null ? `<div class="chain" style="margin-top:14px">
        <div class="row"><span>Relevé le</span><b>${fdt(el.real_at)}</b></div>
        <div class="row total"><span>Écart</span><b class="${Math.abs(gap) < 0.005 ? 'green' : 'red'}">${Math.abs(gap) < 0.005 ? '✔ Tout correspond' : (gap > 0 ? '+' : '') + money(gap)}</b></div></div>
        ${Math.abs(gap) >= 0.005 ? `<div class="warn-box">${gap > 0 ? 'Il y a plus d\'argent sur Eldorado que prévu : une commande terminée n\'est peut-être pas validée dans l\'app, ou un gain n\'a pas été reporté.'
    : 'Il y a moins d\'argent sur Eldorado que prévu : un retrait n\'est peut-être pas noté, ou une commande est encore en attente de versement chez Eldorado.'}</div>` : ''}` : ''}
    </div>
  </div>
  <form class="card" data-form="withdrawal"><div class="card-head"><h2>${ic('download')} Enregistrer un retrait</h2>
    <span class="muted small">Quand tu sors de l'argent du wallet · frais séparés des frais Eldorado des commandes</span></div>
    <div class="form-grid">
      ${field('Date', `<input name="w_date" type="date" required value="${today()}">`)}
      ${field('Montant retiré ($)', '<input name="amount_usd" type="number" step="0.01" min="0.01" required>')}
      ${field('Frais de retrait ($)', '<input name="fee_usd" type="number" step="0.01" min="0" value="0">')}
      ${field('Taux de conversion (€ pour 1 $)', '<input name="fx_rate" type="number" step="0.0001" min="0">')}
      ${field('Montant reçu (€)', '<input name="amount_eur" type="number" step="0.01" min="0">')}
      ${field('Méthode', `<select name="method">${WD_METHODS.map((m) => opt(m, m)).join('')}</select>`)}
      ${field('Notes', '<input name="notes">')}
    </div><div class="form-actions"><button class="primary" type="submit">Enregistrer</button>
      <span class="muted small">Frais de retrait au total : ${money(t.fee)} · reçu : ${t.eur.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span></div></form>
  <div class="card"><div class="card-head"><h2>Historique des retraits</h2></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Retiré</th><th class="num">Frais</th>
      <th class="num">Net après frais</th><th class="num">Taux</th><th class="num">Reçu (€)</th><th>Méthode</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rows.map((w) => `<tr><td>${fdate(w.w_date)}</td><td class="num">${money(w.amount_usd)}</td><td class="num">${money(w.fee_usd)}</td>
        <td class="num">${money(r2(n(w.amount_usd) - n(w.fee_usd)))}</td><td class="num">${w.fx_rate ?? '—'}</td>
        <td class="num">${w.amount_eur != null ? n(w.amount_eur).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' €' : '—'}</td>
        <td>${esc(w.method)}</td><td>${esc(w.notes)}</td>
        <td class="actions"><button class="sm danger" data-action="del-withdrawal" data-id="${w.id}">✕</button></td></tr>`).join('')}
      </tbody></table></div>` : emptyBox('Aucun retrait enregistré.', 'download')}</div>`;
}

function licenseStatus(l) {
  if (l.revoked) return '<span class="badge b-red">Révoquée</span>';
  if (!l.activated_by) return '<span class="badge b-blue">Non activée</span>';
  if (new Date(l.expires_at) <= new Date()) return '<span class="badge b-grey">Expirée</span>';
  const days = Math.ceil((new Date(l.expires_at) - new Date()) / 86400000);
  return `<span class="badge ${days <= 5 ? 'b-orange' : 'b-green'}">Active · ${days} j</span>`;
}

async function viewLicenses(main) {
  await loadRefs(false);
  const rows = await run(sb.from('licenses').select('*, profiles(email)').order('created_at', { ascending: false }));
  const pre = S.licPreset;
  const pick = [...S.boosters].sort((x, y) => (y.active === false ? 0 : 1) - (x.active === false ? 0 : 1) || String(x.name).localeCompare(String(y.name)));
  main.innerHTML = `${head('Licences', 'Les clés d\'accès de tes boosters : crée, prolonge ou coupe un accès')}
  <form class="card" data-form="license"><div class="card-head"><h2>Générer une clé</h2></div>
    ${S.boosters.length ? `<div class="form-grid">
      ${field('Booster', `<select name="booster_id" required>${pick.map((b) => opt(b.id, b.name + (b.active === false ? ' (inactif)' : ''), b.id === pre)).join('')}</select>`)}
      ${field('Durée', `<select name="days">${[[7, '7 jours'], [30, '30 jours'], [90, '3 mois'], [180, '6 mois'], [365, '1 an']].map(([v, l]) => opt(v, l, v === 30)).join('')}</select>`)}
      ${field('Note', '<input name="note" placeholder="ex. octobre">')}
    </div>
    <div class="form-actions"><button class="primary" type="submit">Générer</button>
      <span class="muted small">Envoie la clé au booster : il crée son compte dans l'app puis la colle. Une nouvelle clé s'ajoute au temps restant.</span></div>`
    : emptyBox('Ajoute d\'abord un booster.')}
    ${S.lastKey ? `<div class="keybox"><code>${esc(S.lastKey)}</code><button type="button" class="sm" data-action="copy" data-text="${esc(S.lastKey)}">Copier</button></div>` : ''}
  </form>
  <div class="card"><div class="card-head"><h2>Toutes les clés</h2></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Clé</th><th>Booster</th><th>Statut</th><th>Compte</th>
      <th>Durée</th><th>Activée le</th><th>Expire le</th><th>Note</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr><td style="font-family:Consolas,monospace">${esc(l.key)}</td><td class="strong">${esc(boosterName(l.booster_id))}</td>
        <td>${licenseStatus(l)}</td><td>${esc(l.profiles ? l.profiles.email : '—')}</td><td>${l.duration_days} j</td>
        <td>${fdate(l.activated_at)}</td><td>${fdate(l.expires_at)}</td><td>${esc(l.note)}</td>
        <td class="actions"><button class="sm" data-action="copy" data-text="${esc(l.key)}">Copier</button>
          <button class="sm" data-action="extend" data-key="${esc(l.key)}">+30 j</button>
          <button class="sm ${l.revoked ? '' : 'danger'}" data-action="revoke" data-key="${esc(l.key)}" data-revoked="${l.revoked}">${l.revoked ? 'Réactiver' : 'Révoquer'}</button>
          ${!l.activated_by ? `<button class="sm danger" data-action="del-license" data-key="${esc(l.key)}">✕</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : emptyBox('Aucune clé générée.')}</div>`;
  S.licPreset = null;
}

async function viewSettings(main) {
  let errs = [];
  await Promise.all([loadRefs(false), window.desktop && window.desktop.gpu ? window.desktop.gpu().then((g) => { S.gpu = g; }).catch(() => {}) : null,
    sb.from('app_errors').select('*').order('created_at', { ascending: false }).limit(30).then((r) => { errs = r.data || []; }, () => {})]);
  main.innerHTML = `${head('Paramètres', 'Taux Eldorado, règles de partage, photo et logo')}
  ${personalSettingsHtml()}
  <h2 class="section-title">${ic('settings')} Réglages de l'équipe</h2>
  <div class="card"><div class="card-head"><h2>${ic('bell')} Journal des erreurs</h2><span class="muted small">plantages et bugs remontés par les apps de l'équipe (30 jours)</span></div>
    ${errs && errs.length ? `<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Qui</th><th>Version</th><th>Type</th><th>Détail</th></tr></thead><tbody>
      ${errs.map((x) => `<tr><td>${fdt(x.created_at)}</td><td class="strong">${esc(x.who || '—')}</td><td>${esc(x.version || '')}</td><td>${esc(x.kind || '')}</td>
        <td class="small" style="max-width:520px;word-break:break-word">${esc((x.message || '').slice(0, 300))}</td></tr>`).join('')}</tbody></table></div>`
    : emptyBox('Aucune erreur remontée. Tout va bien !', 'check')}</div>
  <div class="grid-2">
    <div class="card"><div class="card-head"><h2>Frais Eldorado</h2></div>
      <p class="muted small">Chaque commande prend le taux en vigueur à sa date. Pour un nouveau taux, ajoute une date d'effet : les anciennes commandes ne changent pas.</p>
      <div class="table-wrap"><table><thead><tr><th>À partir du</th><th class="num">Taux</th><th>Note</th><th></th></tr></thead><tbody>
        ${S.fees.map((f) => `<tr><td>${fdate(f.effective_from)}</td><td class="num">${pct(f.rate, 2)}</td><td>${esc(f.note)}</td>
          <td class="actions">${S.fees.length > 1 ? `<button class="sm danger" data-action="del-fee" data-id="${f.id}">✕</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <form data-form="fee" class="form-grid" style="margin-top:12px">
        ${field('Date d\'effet', `<input name="effective_from" type="date" required value="${today()}">`)}
        ${field('Taux (%)', '<input name="rate" type="number" step="0.01" min="0" max="99" required>')}
        ${field('Note', '<input name="note">')}
        <div class="field" style="align-self:end"><button class="primary" type="submit">Ajouter</button></div>
      </form></div>
    <div class="card"><div class="card-head"><h2>Règles de répartition</h2></div>
      <p class="muted small">Part de Flowey sur le NET ; le reste va aux boosters, à parts égales (sauf réglage ci-dessous). S'applique aux nouvelles attributions.</p>
      <form data-form="rules"><div class="table-wrap"><table><thead><tr><th>Type</th><th class="num">Boosters</th><th class="num">Part Flowey (%)</th><th>Source</th></tr></thead><tbody>
        ${S.rules.map((r) => `<tr><td class="strong">${esc(r.type)}</td><td class="num">${r.boosters_needed}</td>
          <td class="num"><input name="${esc(r.type)}" type="number" step="0.0001" min="0" max="100" style="width:110px;text-align:right"
            value="${+(n(r.flowey_share) * 100).toFixed(4)}"></td><td>${esc(r.source)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="form-grid" style="margin-top:12px">${field('BOOSTERS SANS MOI : part Booster 1 par défaut (%)',
    `<input name="__split" type="number" step="1" min="0" max="100" value="${Math.round(n(S.settings.default_split_b1) * 100)}">`)}</div>
      <div class="form-actions"><button class="primary" type="submit">Enregistrer les règles</button></div></form>
    </div>
  </div>`;
}

/* =====================================================================
   BOOSTER — ACCUEIL, MES COMMANDES, MES GAINS, MA LICENCE
   ===================================================================== */
function orderCards(list) {
  if (!list.length) return emptyBox('Aucune commande ici.');
  return `<div class="order-cards">${list.map((o) => `<div class="order-card" data-action="open-order" data-id="${o.id}">
    <div class="top"><b>${esc(o.ref)}</b>${stageBadge(o)}</div>
    <div class="muted small">${esc([o.game, o.service].filter(Boolean).join(' · ') || '—')}</div>
    <div class="rank">${esc(o.current_rank || '?')} → ${esc(o.target_rank || '?')}</div>
    <div class="meta"><span class="${isLate(o) ? 'late' : ''}">${o.deadline ? 'À livrer avant le ' + fdt(o.deadline) : ''}</span><b>${money(o.my_part)}</b></div>
  </div>`).join('')}</div>`;
}

async function viewHome(main) {
  const [s, orders, anns] = await Promise.all([
    run(sb.rpc('my_summary')), run(sb.rpc('my_orders')),
    run(sb.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(20)),
  ]);
  const active = orders.filter((o) => ['Attribuée', 'En cours'].includes(o.stage) && o.status !== 'Annulée');
  const rest = r2(n(s.earned) - n(s.paid));
  main.innerHTML = `${head(`Bon retour, ${esc(S.access.booster || '')}`, 'Tes commandes, tes gains et les nouvelles de l\'équipe',
    `<span class="muted small">Ma dispo :</span><select data-change="availability" style="width:auto">${AVAIL.map((a) => opt(a, a, a === s.availability)).join('')}</select>`)}
  <div class="kpis">${kpi('Commandes en cours', s.active, s.active ? 'warn' : '')}${kpi('Total gagné', money(s.earned), 'accent')}
    ${kpi('Déjà reçu', money(s.paid), 'good')}${kpi('Reste à recevoir', money(rest), rest > 0.004 ? 'warn' : 'good')}</div>
  <div class="grid-3">
    <div class="card"><div class="card-head"><h2>${ic('rocket')} Mes commandes en cours</h2><button class="sm" data-action="nav" data-view="myorders">Tout voir</button></div>
      ${orderCards(active)}</div>
    <div class="card"><div class="card-head"><h2>${ic('megaphone')} Annonces</h2></div>${annList(anns)}</div>
  </div>`;
}

async function viewMyOrders(main) {
  const orders = await run(sb.rpc('my_orders'));
  const f = S.myFilter;
  const groups = {
    active: ['En cours', (o) => ['Attribuée', 'En cours'].includes(o.stage) && o.status !== 'Annulée'],
    delivered: ['Livrées', (o) => o.stage === 'Livrée' && o.status !== 'Annulée'],
    done: ['Validées', (o) => o.stage === 'Validée'],
    all: ['Toutes', () => true],
  };
  main.innerHTML = `${head('Mes commandes', 'Clique sur une commande pour voir les infos, les accès et le chat')}
  <div class="chips">${Object.entries(groups).map(([k, [l, fn]]) => `<button class="chip ${k === f ? 'active' : ''}" data-action="my-filter" data-f="${k}">${l}<span class="count">${orders.filter(fn).length}</span></button>`).join('')}</div>
  ${orderCards(orders.filter(groups[f][1]))}`;
}

async function viewEarnings(main) {
  const [s, orders] = await Promise.all([run(sb.rpc('my_summary')), run(sb.rpc('my_orders'))]);
  const rest = r2(n(s.earned) - n(s.paid));
  const done = orders.filter((o) => o.status === 'Terminée');
  main.innerHTML = `${head('Mes gains', 'Ce que tu as gagné, reçu, et ce qu\'il te reste à recevoir')}
  <div class="kpis">${kpi('Total gagné', money(s.earned), 'accent')}${kpi('Déjà reçu', money(s.paid), 'good')}
    ${kpi('Reste à recevoir', money(rest), rest > 0.004 ? 'warn' : 'good')}${kpi('En attente (non validé)', money(s.pending))}</div>
  <div class="grid-2">
    <form class="card" data-form="payout"><div class="card-head"><h2>${ic('send')} Où recevoir tes paiements</h2></div>
      <div class="form-grid">
        ${field('Méthode', `<select name="method">${PAY_METHODS.map((m) => opt(m, m, m === s.payout_method)).join('')}</select>`)}
        ${field('Adresse / identifiant', `<input name="details" value="${esc(s.payout_details)}" placeholder="email PayPal, @revolut, IBAN…">`, 'class="field span-2"')}
      </div>
      <div class="form-actions"><button class="primary" type="submit">${ic('check')} Enregistrer</button>
        <span class="muted small">Seul Flowey le voit, au moment de te payer.</span></div></form>
    <div class="card"><div class="card-head"><h2>${ic('sparkles')} Gains reportés</h2><span class="muted small">avant l'app, bonus…</span></div>
      ${s.adjustments.length ? `<div class="chain">${s.adjustments.map((a) => `<div class="row"><span>${fdate(a.date)} · ${esc(a.label.replace(/^\[Discord\]\s*/, ''))}</span><b>${money(a.amount)}</b></div>`).join('')}
        <div class="row total"><span>Total reporté</span><b>${money(s.adjusted)}</b></div></div>` : emptyBox('Rien de reporté.', 'sparkles')}</div>
  </div>
  <div class="grid-3">
    <div class="card"><div class="card-head"><h2>Commandes validées</h2><span class="muted small">${s.count}</span></div>
      ${done.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Date</th><th>Jeu</th><th>Type</th><th class="num">Ma part</th></tr></thead><tbody>
        ${done.map((o) => `<tr><td><a href="#" data-action="open-order" data-id="${o.id}">${esc(o.ref)}</a></td><td>${fdate(o.order_date)}</td><td>${esc(o.game)}</td>
          <td>${esc(o.split_type)}</td><td class="num strong">${money(o.my_part)}</td></tr>`).join('')}
      </tbody></table></div>` : emptyBox('Aucune commande validée pour l\'instant.')}</div>
    <div class="card"><div class="card-head"><h2>${ic('dollar')} Paiements reçus</h2></div>
      ${s.payments.length ? `<div class="chain">${s.payments.map((p) => `<div class="row"><span>${fdate(p.date)} · ${esc(p.method || '')}</span><b>${money(p.amount)}</b></div>`).join('')}</div>`
    : emptyBox('Aucun paiement.')}</div>
  </div>`;
}

async function viewLicense(main) {
  S.access = await run(sb.rpc('my_access'));
  const days = Math.max(0, Math.ceil((new Date(S.access.expires_at) - new Date()) / 86400000));
  main.innerHTML = `${head('Ma licence', 'Ton accès à l\'application')}
  <div class="kpis">${kpi('Statut', S.access.status === 'active' ? 'Active' : 'Inactive', S.access.status === 'active' ? 'good' : 'bad')}
    ${kpi('Expire le', fdate(S.access.expires_at))}${kpi('Jours restants', days, days <= 5 ? 'warn' : '')}</div>
  <form class="card" data-form="renew"><div class="card-head"><h2>Ajouter une clé de renouvellement</h2></div>
    <div class="form-grid">${field('Clé', '<input name="key" class="key-input" required placeholder="BOOST-XXXX-XXXX-XXXX-XXXX">', 'class="field span-2"')}</div>
    <div class="form-actions"><button class="primary" type="submit">Activer</button>
    <span class="muted small">Le temps s'ajoute à ta licence actuelle.</span></div></form>
  <div class="card"><div class="card-head"><h2>${ic('settings')} Personnaliser l'app</h2></div>
    <p class="muted small">Logo, bannière de fond, couleurs, sons, profil : tout est dans <b>Paramètres</b>.</p>
    <div class="form-actions"><button class="primary" data-action="nav" data-view="mysettings">Ouvrir les paramètres</button></div></div>`;
}

const VIEWS = {
  dashboard: viewDashboard, orders: viewOrders, order: viewOrder, boosters: viewBoosters,
  announcements: viewAnnouncements, wallet: viewWallet, notifs: viewNotifs, payments: viewPayments,
  withdrawals: viewWithdrawals, eldorado: viewEldorado, calc: viewCalc, licenses: viewLicenses, settings: viewSettings,
  home: viewHome, myorders: viewMyOrders, earnings: viewEarnings, license: viewLicense, profiles: viewProfiles, mysettings: viewMySettings, chat: viewChat,
};

/* =====================================================================
   ÉVÉNEMENTS (délégués — aucun script en ligne dans le HTML)
   ===================================================================== */
async function act(promise, msg) {
  try { await promise; if (msg) toast(msg); refresh(); } catch (e) { toast(errMsg(e), 'error'); }
}
const ACTIONS = {
  nav: (el) => go(el.dataset.view),
  logout: () => logout(),
  avatar: () => openAvatar(),
  'chat-open': (el) => openChannel(el.dataset.ch),
  'chat-file-clear': () => { S.chatFile = null; renderChatFileChip(); },
  'emoji-toggle': () => { const p0 = $('#emoji-panel'); if (!p0) return; if (!p0.innerHTML) renderEmojiPanel(); p0.classList.toggle('hidden'); },
  emoji: (el) => { const ta = document.querySelector('.tchat-form textarea'); if (ta) insertAtCursor(ta, el.dataset.e); },
  'rec-toggle': () => toggleRecording(),
  tts: (el) => speak(el.dataset.text),
  'att-dl': async (el) => { try { await downloadAttachment(el.dataset.path, el.dataset.name); } catch (e) { toast(errMsg(e), 'error'); } },
  'att-open': (el) => {
    const url = S.fileUrls[el.dataset.path];
    if (!url) return;
    modal(`<div class="att-view"><img src="${esc(url)}" alt=""><div class="form-actions">
      <button class="primary" data-action="att-dl" data-path="${esc(el.dataset.path)}" data-name="${esc(el.dataset.name)}">${ic('download')} Télécharger</button>
      <button data-action="close-modal">Fermer</button></div></div>`);
  },
  'chat-with': (el) => { S.chatChannel = dmChannel(myKey(), el.dataset.key); go('chat'); },
  'pref-accent-auto': () => { setPref('accent', ''); applyTheme(S.currentTheme); refresh(); },
  'sound-test': () => playSound(null, true),
  'otp-resend': async (el) => {
    el.disabled = true;
    try { await sendOtp(); toast('Nouveau code envoyé'); render2FA(); } catch (e) { toast(errMsg(e), 'error'); el.disabled = false; }
  },
  '2fa-test': async () => {
    try { await sendOtp(); } catch (e) { return toast('Envoi impossible : ' + errMsg(e) + ' — vérifie la configuration des emails dans Supabase.', 'error'); }
    modal(`<form data-form="otp-test"><div class="card-head"><h2>Test de l'A2F</h2><button type="button" class="sm ghost" data-action="close-modal">${ic('x')}</button></div>
      <p class="muted">Tape le code à 6 chiffres reçu à <b>${esc(S.access.email)}</b>.</p>${otpBoxes()}
      <div class="form-actions"><button class="primary" type="submit">Vérifier</button></div></form>`, 'small');
    const first = document.querySelector('#modal input.otp'); if (first) first.focus();
  },
  '2fa-on': async () => {
    if (!S.otpTested) return toast('Fais d\'abord le test.', 'error');
    if (!confirm('Activer l\'A2F ? À leur prochaine connexion, toi et tes boosters devrez entrer un code reçu par email.')) return;
    act(run(sb.from('app_settings').update({ require_2fa: true }).eq('id', 1)).then(loadRefs), 'A2F activée');
  },
  '2fa-off': async () => {
    if (!confirm('Désactiver l\'A2F pour toute l\'équipe ?')) return;
    act(run(sb.from('app_settings').update({ require_2fa: false }).eq('id', 1)).then(loadRefs), 'A2F désactivée');
  },

  profile: (el) => openProfile(el.dataset.name),
  'my-profile': () => openMyProfile(),
  'profile-banner-clear': () => { S.editBanner = null; const b = $('#pedit-banner'); if (b) b.innerHTML = profileBanner({}, 'pbanner'); },
  'banner-reset': async () => { try { await window.desktop.resetBanner(); await initBanner(); toast('Bannière retirée'); refresh(); } catch (e) { toast(errMsg(e), 'error'); } },
  'logo-reset': async () => { try { logoApplied(await window.desktop.resetLogo()); toast('Logo de base remis'); refresh(); } catch (e) { toast(errMsg(e), 'error'); } },
  'avatar-remove': async () => {
    try { await run(sb.rpc('set_my_avatar', { p_url: null })); await loadAvatars(); refreshMyAvatar(); closeModal(); toast('Photo retirée'); if (S.view === 'settings' || S.view === 'license') refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  },
  'claim-admin': async () => {
    try { S.access = await run(sb.rpc('claim_admin')); toast('Tu es admin !'); await loadRefs(); renderShell('dashboard'); } catch (e) { renderGate(errMsg(e)); }
  },
  'close-modal': () => { S.orders.editing = null; closeModal(); },
  'open-order': (el) => openOrder(el.dataset.id),
  'new-order': () => openOrderForm(null),
  'orders-stage': (el) => { S.orders.stage = el.dataset.stage; S.orders.page = 0; go('orders'); },
  'cancel-edit': () => { S.orders.editing = null; closeModal(); },
  'edit-order': async (el) => {
    try { openOrderForm(await run(sb.from('orders').select('*').eq('id', el.dataset.id).single())); } catch (e) { toast(errMsg(e), 'error'); }
  },
  assign: (el) => openAssign(el.dataset.id).catch((e) => toast(errMsg(e), 'error')),
  stage: (el) => setStage(el.dataset.id, { stage: el.dataset.stage }, 'Étape : ' + el.dataset.stage),
  validate: (el) => setStage(el.dataset.id, { stage: 'Validée' }, 'Commande validée — comptée dans les revenus'),
  reopen: (el) => setStage(el.dataset.id, { status: 'En attente' }, 'Commande rouverte'),
  'cancel-order': (el) => { if (confirm('Annuler cette commande ? Elle restera dans l\'historique sans être comptée.')) setStage(el.dataset.id, { status: 'Annulée' }, 'Commande annulée'); },
  'restore-order': (el) => setStage(el.dataset.id, { status: 'En attente' }, 'Commande rétablie'),
  'dup-order': async (el) => {
    try {
      const o = await run(sb.from('orders').select('*').eq('id', el.dataset.id).single());
      const copy = { ...o, id: undefined, ref: '', eldorado_url: '', order_date: today(), status: 'En attente', deadline: null, notes: o.notes };
      openOrderForm(null);
      const f = document.querySelector('form[data-form="order"]');
      if (f) {
        ['game', 'service', 'current_rank', 'target_rank', 'server', 'instructions', 'gross', 'client'].forEach((k) => { if (f.elements[k] && copy[k] != null) f.elements[k].value = copy[k]; });
        updateSplitForm(f, $('#preview'));
      }
      toast('Commande dupliquée : il reste à mettre l\'ID Eldorado');
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  'open-eldo': (el) => { if (window.desktop && window.desktop.openUrl) window.desktop.openUrl(el.dataset.url); },
  'paste-url': async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      const f = document.querySelector('form[data-form="order"]');
      if (f && t) { f.elements.eldorado_url.value = t; CHANGES['eldo-url'](f.elements.eldorado_url); }
    } catch (_) { toast('Impossible de lire le presse-papiers : colle le lien avec Ctrl+V.', 'error'); }
  },
  'export-orders': () => exportOrders().catch((e) => toast(errMsg(e), 'error')),
  'export-payments': () => exportPayments().catch((e) => toast(errMsg(e), 'error')),
  'del-order': async (el) => {
    if (!confirm(`Supprimer définitivement la commande ${el.dataset.ref} (et son chat) ?`)) return;
    try { await run(sb.from('orders').delete().eq('id', el.dataset.id)); toast('Commande supprimée'); go('orders'); } catch (e) { toast(errMsg(e), 'error'); }
  },
  bstage: async (el) => {
    try {
      await run(sb.rpc('booster_set_stage', { p_order: el.dataset.id, p_stage: el.dataset.stage }));
      toast(el.dataset.stage === 'Livrée' ? 'Livrée ! Flowey est notifié pour valider.' : 'C\'est parti !');
      refreshOrderSoft();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  'del-secret': async (el) => {
    if (!confirm('Effacer les accès du compte ?')) return;
    try { await run(sb.from('order_secrets').delete().eq('order_id', el.dataset.id)); toast('Accès effacés'); refreshOrderSoft(); } catch (e) { toast(errMsg(e), 'error'); }
  },
  'my-filter': (el) => { S.myFilter = el.dataset.f; refresh(); },
  'o-page': (el) => { S.orders.page = Math.max(0, S.orders.page + Number(el.dataset.d)); refresh(); },
  'toggle-booster': (el) => act(sb.from('boosters').update({ active: el.dataset.active !== 'true' }).eq('id', el.dataset.id).then(async (r) => { if (r.error) throw r.error; await loadRefs(); })),
  pay: (el) => openPay(el.dataset.id, el.dataset.amount),
  'install-update': () => { if (window.desktop) window.desktop.installUpdate(); },
  'eldorado-open': () => { if (window.desktop) window.desktop.eldoradoOpen(); },
  'rename-booster': (el) => modal(`<form data-form="rename-booster"><input type="hidden" name="id" value="${esc(el.dataset.id)}">
    <div class="card-head"><h2>Renommer ${esc(el.dataset.name)}</h2><button type="button" class="sm ghost" data-action="close-modal">${ic('x')}</button></div>
    ${field('Nouveau nom', `<input name="name" required value="${esc(el.dataset.name)}" autofocus>`)}
    <p class="muted small">Ses commandes, gains, paiements, licence et messages restent les mêmes : seul le nom change, partout.</p>
    <div class="form-actions"><button class="primary" type="submit">${ic('check')} Renommer</button><button type="button" data-action="close-modal">Annuler</button></div></form>`, 'small'),
  'del-booster': async (el) => {
    if (!confirm(`Supprimer définitivement ${el.dataset.name} de l'équipe ?\n\nSes clés de licence seront supprimées aussi. Si tu as juste fait une faute dans son nom, utilise plutôt « Renommer ».`)) return;
    try { await run(sb.rpc('admin_delete_booster', { p_id: el.dataset.id })); await loadRefs(); toast(el.dataset.name + ' supprimé de l\'équipe'); refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  },
  'del-adj': (el) => { if (confirm('Supprimer cette ligne ?')) act(run(sb.from('adjustments').delete().eq('id', el.dataset.id)), 'Supprimé'); },
  'note-to': (el) => { S.annPreset = el.dataset.id; go('announcements'); },
  'key-for': (el) => { S.licPreset = el.dataset.id; go('licenses'); },
  'fill-amount': (el) => { document.querySelector('[name="amount"]').value = el.dataset.amount; },
  'del-payment': (el) => { if (confirm('Supprimer ce paiement ?')) act(run(sb.from('payments').delete().eq('id', el.dataset.id)), 'Paiement supprimé'); },
  'del-withdrawal': (el) => { if (confirm('Supprimer ce retrait ?')) act(run(sb.from('withdrawals').delete().eq('id', el.dataset.id))); },
  'del-ann': (el) => { if (confirm('Supprimer cette annonce ?')) act(run(sb.from('announcements').delete().eq('id', el.dataset.id))); },
  pin: (el) => act(run(sb.from('announcements').update({ pinned: el.dataset.pinned !== 'true' }).eq('id', el.dataset.id))),
  copy: async (el) => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copié'); } catch (_) { toast('Copie impossible', 'error'); } },
  extend: (el) => act(run(sb.rpc('admin_extend_license', { p_key: el.dataset.key, p_days: 30 })), '+30 jours ajoutés'),
  revoke: (el) => {
    const revoked = el.dataset.revoked === 'true';
    if (!revoked && !confirm('Révoquer cette clé ? Le booster perd l\'accès immédiatement.')) return;
    act(run(sb.from('licenses').update({ revoked: !revoked }).eq('key', el.dataset.key)));
  },
  'del-license': (el) => { if (confirm('Supprimer cette clé non activée ?')) act(run(sb.from('licenses').delete().eq('key', el.dataset.key))); },
  'del-fee': (el) => { if (confirm('Supprimer ce taux ?')) act(run(sb.from('fee_rates').delete().eq('id', el.dataset.id))); },
};

const FORMS = {
  'calc-a': () => updateCalc(),
  'calc-b': () => updateCalc(),
  login: (f, sub) => onLogin(f, sub),
  activate: (f) => onActivate(f, false),
  renew: (f) => onActivate(f, true),
  order: (f) => onOrderSubmit(f),
  assign: (f) => onAssign(f),
  chat: (f) => onChat(f),
  secret: async (f) => {
    const o = formData(f);
    try {
      await run(sb.from('order_secrets').upsert({ order_id: f.dataset.id, login: o.login || null, password: o.password || null,
        extra: o.extra || null, updated_at: new Date().toISOString() }));
      toast('Accès enregistrés');
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  'pay-modal': async (f) => {
    const o = formData(f);
    try {
      await run(sb.from('payments').insert({ pay_date: o.pay_date, booster_id: f.dataset.id, amount: n(o.amount),
        method: o.method, reference: o.reference || null }));
      closeModal(); toast('Paiement enregistré — le booster est notifié'); S.dash = null; refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  adjustment: (f) => {
    const o = formData(f);
    act(run(sb.from('adjustments').insert({ booster_id: o.booster_id || null, amount: n(o.amount), label: o.label, adj_date: o.adj_date })), 'Ajouté');
  },
  'use-balance': async (f) => {
    const v = f.querySelector('input[name="v"]:checked');
    if (!v) return;
    try {
      await run(sb.from('app_settings').update({ eldorado_balance: r2(n(v.value)), eldorado_balance_at: new Date().toISOString() }).eq('id', 1));
      closeModal(); toast('Solde relevé : ' + money(v.value)); refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  'real-balance': (f) => {
    const o = formData(f);
    act(run(sb.from('app_settings').update({ eldorado_balance: n(o.real), eldorado_balance_at: new Date().toISOString() }).eq('id', 1)), 'Solde noté');
  },
  payout: async (f) => {
    const o = formData(f);
    try { await run(sb.rpc('set_my_payout', { p_method: o.method, p_details: o.details })); toast('Coordonnées enregistrées'); } catch (e) { toast(errMsg(e), 'error'); }
  },
  otp: async (f) => {
    const token = otpValue(f);
    if (!/^\d{6}$/.test(token)) return render2FA('Entre les 6 chiffres du code.');
    const { error } = await verifyCode(token);
    if (error) return render2FA(/expired|invalid/i.test(error.message || '') ? 'Code incorrect ou expiré. Redemande un code si besoin.' : errMsg(error));
    S.otpSentAt = null; if (otpTimer) { clearInterval(otpTimer); otpTimer = null; }
    await loadAccess();
  },
  'otp-test': async (f) => {
    const token = otpValue(f);
    const { error } = await verifyCode(token);
    if (error) return toast('Code refusé : ' + errMsg(error), 'error');
    S.otpTested = true; S.otpSentAt = null; closeModal(); toast('Test réussi : tu peux activer l\'A2F');
    await loadRefs(); refresh();
  },
  'team-msg': async (f) => {
    const ta = f.elements.body; const body = ta.value.trim(); const file = S.chatFile;
    if (!body && !file) return;
    if (S.chatSending) return;
    S.chatSending = true;
    const btn = f.querySelector('button[type="submit"]'); if (btn) btn.disabled = true;
    ta.value = '';
    try {
      let meta = null;
      if (file) { toast('Envoi de ' + file.name + '…'); meta = await uploadChatFile(file); }
      await run(sb.rpc('send_team_message', { p_channel: S.chatChannel || 'general', p_body: body, p_file: meta }));
      S.chatFile = null; renderChatFileChip();
      const ep = $('#emoji-panel'); if (ep) ep.classList.add('hidden');
    } catch (e) { ta.value = body; toast(errMsg(e), 'error'); }
    S.chatSending = false; if (btn) btn.disabled = false;
    if (ta.focus) ta.focus({ preventScroll: true });
  },
  profile: async (f) => {
    const o = formData(f);
    try {
      await run(sb.rpc('set_my_profile', { p: { tagline: o.tagline, bio: o.bio, games: o.games, discord: o.discord, color: o.color, banner_url: S.editBanner || '' } }));
      await loadProfiles(true);
      closeModal(); toast('Profil enregistré');
      if (S.view === 'profiles') refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  'rename-booster': async (f) => {
    const o = formData(f);
    try { await run(sb.rpc('admin_rename_booster', { p_id: o.id, p_name: o.name })); await loadRefs(); closeModal(); toast('Nom changé : ' + o.name.trim()); refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  },
  booster: async (f) => {
    const o = formData(f);
    try { await run(sb.from('boosters').insert({ name: o.name, notes: o.notes || null })); await loadRefs(); toast('Booster ajouté'); refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  },
  announcement: (f) => {
    const o = formData(f);
    act(run(sb.from('announcements').insert({ booster_id: o.booster_id || null, title: o.title, body: o.body || null, pinned: !!o.pinned })), 'Publié — les boosters sont notifiés');
  },
  'wallet-settings': async (f) => {
    const o = formData(f);
    try {
      await run(sb.from('app_settings').update({ month_goal: n(o.goal), wallet_show_amounts: !!o.show }).eq('id', 1));
      await loadRefs(); toast('Réglages enregistrés'); refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  payment: (f) => {
    const o = formData(f);
    act(run(sb.from('payments').insert({ pay_date: o.pay_date, booster_id: o.booster_id, amount: n(o.amount),
      method: o.method, reference: o.reference || null, order_refs: o.order_refs || null })), 'Paiement enregistré');
  },
  withdrawal: (f) => {
    const o = formData(f);
    act(run(sb.from('withdrawals').insert({ w_date: o.w_date, amount_usd: n(o.amount_usd), fee_usd: n(o.fee_usd),
      fx_rate: o.fx_rate ? n(o.fx_rate) : null, amount_eur: o.amount_eur ? n(o.amount_eur) : null,
      method: o.method, notes: o.notes || null })), 'Retrait enregistré');
  },
  license: async (f) => {
    const o = formData(f);
    try {
      S.lastKey = await run(sb.rpc('admin_create_license', { p_booster: o.booster_id, p_days: Number(o.days), p_note: o.note || null }));
      toast('Clé générée'); refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
  fee: (f) => {
    const o = formData(f);
    act(run(sb.from('fee_rates').insert({ effective_from: o.effective_from, rate: n(o.rate) / 100, note: o.note || null })), 'Taux ajouté');
  },
  rules: async (f) => {
    const o = formData(f);
    try {
      for (const r of S.rules) {
        const v = n(o[r.type]) / 100;
        if (Math.abs(v - n(r.flowey_share)) > 1e-7) {
          const share = Math.abs(v - 1 / 3) < 5e-5 ? 1 / 3 : v; // 33,3333 % → exactement 1/3
          await run(sb.from('split_rules').update({ flowey_share: share }).eq('type', r.type));
        }
      }
      await run(sb.from('app_settings').update({ default_split_b1: n(o.__split) / 100 }).eq('id', 1));
      toast('Règles enregistrées'); refresh();
    } catch (e) { toast(errMsg(e), 'error'); }
  },
};

const CHANGES = {
  month: (el) => { S.month = Number(el.value); refresh(); },
  year: (el) => { S.year = Number(el.value); refresh(); },
  'split-type': (el) => { const f = el.closest('form'); updateSplitForm(f, f.querySelector('.preview')); },
  'o-month': (el) => { S.orders.month = el.value; S.orders.page = 0; refresh(); },
  'o-q': (el) => { S.orders.q = el.value.trim(); S.orders.page = 0; refresh(); },
  'pay-booster': () => updatePayInfo(),
  'eldo-url': (el) => {
    // propose l'ID de commande à partir du lien collé (dernier morceau de l'adresse)
    const f = el.closest('form'); const url = el.value.trim();
    if (!f || !url || f.elements.ref.value) return;
    const m = url.replace(/[?#].*$/, '').match(/([A-Za-z0-9_-]{5,})\/?$/);
    if (m) f.elements.ref.value = m[1];
  },
  'profile-banner': async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    el.disabled = true;
    try {
      S.editBanner = await uploadProfileBanner(file);
      const b = $('#pedit-banner'); if (b) b.innerHTML = profileBanner({ banner: S.editBanner }, 'pbanner');
      toast('Bannière prête : clique sur Enregistrer');
    } catch (e) { toast(errMsg(e), 'error'); }
    el.disabled = false;
  },
  'banner-file': async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { toast('Bannière trop lourde (30 Mo max).', 'error'); return; }
    el.disabled = true;
    try { await window.desktop.setBanner(await fileToDataUrl(file)); await initBanner(); toast('Bannière appliquée'); refresh(); } catch (e) { toast(errMsg(e), 'error'); el.disabled = false; }
  },
  'chat-file': (el) => { setChatFile(el.files && el.files[0]); el.value = ''; },
  pref: (el) => {
    const k = el.dataset.key; const t = el.dataset.type;
    let v = el.value;
    if (t === 'bool') v = el.value === '1';
    if (t === 'num') v = Number(el.value);
    setPref(k, v);
    if (k === 'accent') applyTheme(S.currentTheme);
    if (k === 'bannerColors' || k === 'effects') initBanner();
    if (k === 'soundKind' || k === 'volume') playSound(null, true);
    if (['accent', 'bannerColors', 'effects'].includes(k)) refresh();
  },
  gpu: (el) => {
    if (!confirm('L\'app va redémarrer pour appliquer ce réglage. Continuer ?')) { el.value = S.gpu === false ? '0' : '1'; return; }
    window.desktop.setGpu(el.value === '1');
  },
  'banner-op': (el) => {
    try { localStorage.setItem('bm_banner_op', el.value); } catch (_) { /* rien */ }
    document.documentElement.style.setProperty('--banner-opacity', el.value);
  },
  'logo-file': async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    el.disabled = true;
    try { const r = await window.desktop.setLogo(await logoToPng(file)); logoApplied(r); toast(`Nouveau logo appliqué · ${n(r.shortcuts)} raccourci${n(r.shortcuts) > 1 ? 's' : ''} Windows mis à jour (barre des tâches, bureau, menu Démarrer)`); refresh(); } catch (e) { toast(errMsg(e), 'error'); el.disabled = false; }
  },
  'avatar-file': async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    el.disabled = true;
    try {
      await uploadAvatar(file);
      toast('Photo de profil mise à jour');
      refreshMyAvatar(); closeModal();
      if (['settings', 'license', 'boosters', 'wallet', 'dashboard'].includes(S.view)) refresh();
      if (S.view === 'order') renderChat();
    } catch (e) { toast(errMsg(e), 'error'); el.disabled = false; }
  },
  availability: (el) => { sb.rpc('set_my_availability', { p_value: el.value }).then(({ error }) => toast(error ? errMsg(error) : 'Dispo : ' + el.value, error ? 'error' : 'ok')); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) { e.preventDefault(); ACTIONS[el.dataset.action](el); return; }
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (f && FORMS[f.dataset.form]) { e.preventDefault(); FORMS[f.dataset.form](f, e.submitter); }
});
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('.tchat-main')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!e.target.closest || !e.target.closest('.tchat-main')) return;
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) setChatFile(f);
});
document.addEventListener('paste', (e) => {
  if (!e.target.closest || !e.target.closest('.tchat-form')) return;
  const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
  if (f) { e.preventDefault(); setChatFile(f); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.closest && e.target.closest('.tchat-form')) {
    e.preventDefault(); e.target.closest('form').requestSubmit(); return;
  }
  if (e.key === 'Backspace' && e.target.classList && e.target.classList.contains('otp') && !e.target.value) {
    const boxes = [...e.target.closest('form').querySelectorAll('input.otp')];
    const i = boxes.indexOf(e.target); if (boxes[i - 1]) { boxes[i - 1].focus(); boxes[i - 1].value = ''; }
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el);
});
document.addEventListener('input', (e) => {
  if (e.target.classList && e.target.classList.contains('otp')) {
    const form = e.target.closest('form');
    const boxes = [...form.querySelectorAll('input.otp')];
    const digits = e.target.value.replace(/\D/g, '');
    if (digits.length > 1 && (e.inputType === 'insertFromPaste' || digits.length >= 6)) { // code collé en entier
      boxes.forEach((b, i) => { b.value = digits[i] || ''; });
      boxes[Math.min(digits.length, 6) - 1].focus();
    } else {
      e.target.value = digits.slice(-1);
      const i = boxes.indexOf(e.target);
      if (e.target.value && boxes[i + 1]) boxes[i + 1].focus();
    }
    if (otpValue(form).length === 6) form.requestSubmit();
    return;
  }

  const f = e.target.closest('form[data-form="order"], form[data-form="assign"]');
  if (f) updateSplitForm(f, f.querySelector('.preview'));
  if (e.target.closest('form[data-form="calc-a"], form[data-form="calc-b"]')) updateCalc();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.chat-form textarea')) {
    e.preventDefault();
    e.target.closest('form').requestSubmit();
  }
  if (e.key === 'Escape') closeModal();
  if (e.ctrlKey && !e.shiftKey && (e.key === 'n' || e.key === 'N') && isAdmin() && $('#main')) { e.preventDefault(); openOrderForm(null); }
});

boot();
