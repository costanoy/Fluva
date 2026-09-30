// Gera os ícones do site/PWA a partir dos SVGs em scripts/.
// Uso: node scripts/generate-icons.mjs
// (os ícones do app desktop/Android vêm de `npx tauri icon scripts/icon-source.png`)
import sharp from 'sharp';

const icon = 'scripts/icon-source.svg';
const favicon = 'scripts/favicon-source.svg';

await sharp(icon, { density: 300 }).resize(1024, 1024).png().toFile('scripts/icon-source.png');
await sharp(icon, { density: 300 }).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(icon, { density: 300 }).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(icon, { density: 300 }).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
await sharp(favicon, { density: 300 }).resize(64, 64).png().toFile('public/favicon.png');
console.log('ícones gerados');
