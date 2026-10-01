// Renderiza video/fluva-promo.html em MP4 (1920×1080, 30 fps, 45 s) com a
// trilha e os efeitos sonoros.
//
// Uso:
//   node video/render.mjs <pasta-dos-audios> <saida.mp4>
//   node video/render.mjs - <pasta> --frames-only 2,8.5,14   (só quadros soltos, em PNG)
// Precisa de: Google Chrome instalado e ffmpeg (no PATH ou em FFMPEG=caminho).
// Áudios esperados na pasta: musica-fluva.wav, 01-carimbo.mp3, 02-transicao.mp3,
// 03-impressora.mp3, 04-pilulas.mp3, 05-arquivo.mp3
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FPS = 30, DURATION = 45, W = 1920, H = 1080;
const here = dirname(fileURLToPath(import.meta.url));
const [audioDir, outFile, flag, flagValue] = process.argv.slice(2);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(join(tmpdir(), 'fluva-video-'));
const framesDir = join(work, 'frames');
mkdirSync(framesDir);

// ---- Chrome via DevTools Protocol
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, 'profile')}`, '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank']);
let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* ainda subindo */ }
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 700));
  return r.result?.result?.value;
};

await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(join(here, 'fluva-promo.html')).href });
for (let i = 0; i < 100; i++) { if (await evaluate('!!window.ready').catch(() => false)) break; await sleep(200); }
await evaluate('window.ready');
await sleep(500);

const shoot = async (t, file, format = 'jpeg') => {
  await evaluate(`seek(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`);
  const r = await send('Page.captureScreenshot', format === 'jpeg' ? { format, quality: 96 } : { format });
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
};

if (flag === '--frames-only') {
  for (const t of flagValue.split(',').map(Number)) {
    const f = resolve(outFile, `frame-${String(t).replace('.', '_')}.png`);
    await shoot(t, f, 'png');
    console.log(f);
  }
  ws.close(); chrome.kill();
  process.exit(0);
}

const total = FPS * DURATION;
for (let f = 0; f < total; f++) {
  await shoot(f / FPS, join(framesDir, `f${String(f).padStart(5, '0')}.jpg`));
  if (f % 150 === 0) console.log(`quadro ${f}/${total}`);
}
ws.close(); chrome.kill();

// ---- Áudio: trilha + efeitos, cada um no seu instante (em segundos)
const sfx = (file, at, volume) => ({ file: join(audioDir, file), at, volume });
const cues = [
  sfx('01-carimbo.mp3', 2.0, 1.0), // logo carimbada na intro
  sfx('03-impressora.mp3', 4.15, 1.0), // "Fluva" sendo impresso
  sfx('02-transicao.mp3', 8.0, 0.5),
  sfx('02-transicao.mp3', 12.0, 0.5),
  sfx('05-arquivo.mp3', 14.0, 1.0), // arquivo solto
  sfx('02-transicao.mp3', 16.0, 0.5),
  sfx('02-transicao.mp3', 24.0, 0.5),
  sfx('02-transicao.mp3', 32.0, 0.5),
  sfx('04-pilulas.mp3', 32.0, 0.9),
  sfx('04-pilulas.mp3', 33.0, 0.9),
  sfx('04-pilulas.mp3', 34.0, 0.9),
  sfx('02-transicao.mp3', 36.0, 0.5),
  sfx('01-carimbo.mp3', 40.0, 1.0), // batida final
];
const inputs = ['-framerate', String(FPS), '-i', join(framesDir, 'f%05d.jpg'), '-i', join(audioDir, 'musica-fluva.wav')];
cues.forEach((c) => inputs.push('-i', c.file));
// Cada efeito tem o silêncio inicial cortado, para o ataque cair exatamente no instante marcado.
const chains = cues.map((c, i) => `[${i + 2}:a]silenceremove=start_periods=1:start_threshold=-38dB:start_silence=0.01,volume=${c.volume},adelay=${Math.round(c.at * 1000)}:all=1[s${i}]`);
const mix = `[1:a]volume=0.9[m];${chains.join(';')};[m]${cues.map((_, i) => `[s${i}]`).join('')}amix=inputs=${cues.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`;
const args = ['-y', '-hide_banner', '-loglevel', 'warning', ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-t', String(DURATION), '-movflags', '+faststart', outFile];
const r = spawnSync(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
rmSync(work, { recursive: true, force: true });
console.log(r.status === 0 ? `pronto: ${outFile}` : 'ffmpeg falhou');
process.exit(r.status ?? 1);
