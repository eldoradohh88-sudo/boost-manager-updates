// Vérifie src/logo.png : une vraie image (PNG ou JPG) d'au moins 256 pixels de côté.
// Pas besoin qu'il soit carré : l'icône est recadrée automatiquement (make-icon.ps1).
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, 'src', 'logo.png');
function size(b) {
  if (b.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
let msg = '';
try {
  const s = size(fs.readFileSync(f));
  if (!s) msg = "src\\logo.png n'est ni un PNG ni un JPG. Ouvre-le dans Paint puis Fichier > Enregistrer sous > Image PNG.";
  else if (Math.min(s.w, s.h) < 256) msg = `src\\logo.png fait ${s.w} x ${s.h} pixels : il faut au moins 256 pixels de haut et de large.`;
  else console.log(`  Logo OK : ${s.w} x ${s.h} pixels${s.w !== s.h ? ' (pas carre : l\'icone gardera le centre de l\'image)' : ''}`);
} catch (_) { msg = 'Fichier src\\logo.png introuvable.'; }
if (msg) { console.log('\n  PROBLEME DE LOGO : ' + msg + '\n'); process.exit(1); }
