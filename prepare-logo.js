// Utilise par GitHub (publication automatique).
// Accepte un logo dans n'importe quel format (PNG, JPG, WEBP, GIF, AVIF...) meme s'il s'appelle logo.png :
//  - le reconvertit en vrai PNG (pour les couleurs de l'app)
//  - cree build/icon.png, 512 x 512, en gardant le centre de l'image (icone de l'exe)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

(async () => {
  const f = path.join(__dirname, 'src', 'logo.png');
  const buf = fs.readFileSync(f);
  const meta = await sharp(buf).metadata();
  console.log(`Logo recu : format ${meta.format}, ${meta.width} x ${meta.height} pixels`);
  if (meta.format !== 'png') {
    const png = await sharp(buf).png().toBuffer();
    fs.writeFileSync(f, png);
    console.log('Converti en vrai PNG');
  }
  fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
  await sharp(buf).resize(512, 512, { fit: 'cover', position: 'centre' }).png().toFile(path.join(__dirname, 'build', 'icon.png'));
  console.log('Icone creee : build/icon.png (512 x 512, centre du logo)');
})().catch((e) => { console.error('PROBLEME DE LOGO :', e.message); process.exit(1); });
