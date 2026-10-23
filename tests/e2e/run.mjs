// Fluva's end-to-end tests: the real app, driven in a real browser.
//
//   npm run test:e2e                    every part, on the built site (npm run build first)
//   npm run test:e2e -- sign,password   only these parts
//   npm run test:e2e -- --app           in the desktop app (npx tauri build --debug --no-bundle first)
//   npm run test:e2e -- --list          the parts there are
//
// The site is served from dist/ with the headers public/.htaccess sets in
// production (CSP included) and opened in a headless Chrome or Edge. The test
// steps themselves run inside the page (page/scenario.js), talking to this
// script through a DevTools binding: for the test files, which are made on
// each run (fixtures.mjs), for what they save, and for checks only Node can
// make (verify.mjs). Everything written goes to the system's temp folder —
// never into the project.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CERT_PASSWORD, makeFixtures, PDF_PASSWORD } from './fixtures.mjs';
import { inspectPdf } from './verify.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const WORK = join(tmpdir(), 'fluva-e2e');
const FILES = join(WORK, 'files');
const OUT = join(WORK, 'out');

const args = process.argv.slice(2);
const inApp = args.includes('--app');
const listOnly = args.includes('--list');
const wanted = args.filter((a) => !a.startsWith('--')).flatMap((a) => a.split(',')).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- DevTools */

class Cdp {
  static async connect(port, pick = (t) => t.type === 'page') {
    let targets = [];
    for (let i = 0; i < 120; i++) {
      targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
      if (targets.some(pick)) break;
      await sleep(250);
    }
    const target = targets.find(pick);
    if (!target) throw new Error(`no page to drive on DevTools port ${port}`);
    const cdp = new Cdp(new WebSocket(target.webSocketDebuggerUrl));
    await new Promise((resolve, reject) => {
      cdp.ws.addEventListener('open', resolve, { once: true });
      cdp.ws.addEventListener('error', reject, { once: true });
    });
    return cdp;
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve) => {
      const i = ++this.id;
      this.pending.set(i, resolve);
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  }

  close() {
    this.ws.close();
  }
}

/* ---------------------------------------------------- the site, served */

/** dist/ with the production headers (HSTS and the https upgrade aside: this is plain http on localhost). */
function serveSite() {
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing — run `npm run build` first');
  const htaccess = readFileSync(join(ROOT, 'public', '.htaccess'), 'utf8');
  const headers = [...htaccess.matchAll(/Header always set (\S+) "([^"]*)"/g)].map((m) => [m[1], m[2]]);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain',
    '.xml': 'application/xml',
  };
  const server = createServer((req, res) => {
    for (const [k, v] of headers) if (k !== 'Strict-Transport-Security') res.setHeader(k, v.replace('; upgrade-insecure-requests', ''));
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    let file = join(dist, path);
    if (!file.startsWith(dist)) file = join(dist, 'index.html');
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) file = join(dist, 'index.html');
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('no Chrome or Edge found — set CHROME_PATH');
  return found;
}

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/* ---------------------------------------------------------------- bridge */

/** What the page can ask of this script (see page/setup.js). */
async function answer(cdp, cmd, payload) {
  switch (cmd) {
    case 'viewport':
      // A phone's or a laptop's screen; no size: back to the window's own.
      if (payload.width) await cdp.send('Emulation.setDeviceMetricsOverride', { width: payload.width, height: payload.height, deviceScaleFactor: 1, mobile: !!payload.mobile });
      else await cdp.send('Emulation.clearDeviceMetricsOverride');
      return { ok: true };
    case 'file': {
      const path = join(FILES, payload.name);
      if (!existsSync(path)) throw new Error(`no test file ${payload.name}`);
      return { b64: readFileSync(path).toString('base64') };
    }
    case 'save':
      writeFileSync(join(OUT, payload.name.replace(/[\\/]/g, '_')), Buffer.from(payload.b64, 'base64'));
      return { ok: true };
    case 'inspectPdf':
      return inspectPdf(Buffer.from(payload.b64, 'base64'));
    case 'screenshot': {
      // For a person to look at afterwards, in the output folder.
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${inApp ? 'app' : 'site'}-${payload.name.replace(/[\\/]/g, '_')}.png`), Buffer.from(shot.result.data, 'base64'));
      return { ok: true };
    }
    case 'secrets':
      return { certPassword: CERT_PASSWORD, pdfPassword: PDF_PASSWORD };
    default:
      throw new Error(`unknown request ${cmd}`);
  }
}

async function attachBridge(cdp) {
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.send('Runtime.addBinding', { name: '__qaCall' });
  cdp.on('Runtime.bindingCalled', async ({ name, payload }) => {
    if (name !== '__qaCall') return;
    const { id, cmd, data } = JSON.parse(payload);
    let reply;
    try {
      reply = { ok: true, value: await answer(cdp, cmd, data) };
    } catch (err) {
      reply = { ok: false, error: String(err?.message ?? err) };
    }
    await cdp.send('Runtime.evaluate', { expression: `window.__qaResolve(${id}, ${JSON.stringify(reply)})` });
  });
  const logs = [];
  cdp.on('Runtime.exceptionThrown', (p) => logs.push('[exception] ' + (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 300)));
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') logs.push('[console.error] ' + p.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  });
  return logs;
}

/* ------------------------------------------------------------------ run */

async function main() {
  mkdirSync(OUT, { recursive: true });
  const scenario = readFileSync(join(HERE, 'page', 'scenario.js'), 'utf8');
  const setup = readFileSync(join(HERE, 'page', 'setup.js'), 'utf8');

  if (listOnly) {
    const names = [...scenario.matchAll(/^\s*parts\.(\w+) = /gm)].map((m) => m[1]);
    console.log(names.join('\n'));
    return 0;
  }

  process.stdout.write('making the test files... ');
  await makeFixtures(FILES);
  console.log('ok');

  let cdp;
  let url = null;
  const cleanup = [];
  try {
    if (inApp) {
      const exe = join(ROOT, 'src-tauri', 'target', 'debug', process.platform === 'win32' ? 'app.exe' : 'app');
      if (!existsSync(exe)) throw new Error('no desktop app build — run `npx tauri build --debug --no-bundle` first');
      const port = await freePort();
      // WebView2 (Windows) opens its DevTools port when asked through this variable.
      const proc = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'ignore' });
      cleanup.push(() => proc.kill());
      cdp = await Cdp.connect(port);
    } else {
      const { server, port } = await serveSite();
      cleanup.push(() => server.close());
      url = `http://127.0.0.1:${port}/`;
      const cdpPort = await freePort();
      const profile = join(WORK, 'browser-profile');
      rmSync(profile, { recursive: true, force: true });
      const proc = spawn(findBrowser(), ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
      cleanup.push(() => proc.kill());
      cdp = await Cdp.connect(cdpPort);
    }
    cleanup.push(() => cdp.close());
    const logs = await attachBridge(cdp);

    // The parts the scenario defines, unless some were named.
    const all = [...scenario.matchAll(/^\s*parts\.(\w+) = /gm)].map((m) => m[1]);
    const parts = wanted.length ? wanted : all;
    const unknown = parts.filter((p) => !all.includes(p));
    if (unknown.length) throw new Error(`unknown part(s): ${unknown.join(', ')} — try --list`);

    const results = [];
    for (const part of parts) {
      logs.length = 0;
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      if (url) await cdp.send('Page.navigate', { url });
      else await cdp.send('Page.reload', { ignoreCache: true });
      for (let i = 0; i < 120; i++) {
        await sleep(250);
        if (await cdp.evaluate(`!!document.querySelector('.dropzone')`).catch(() => false)) break;
      }
      await cdp.evaluate(`${setup}\n${scenario}\ntrue`);
      const t0 = Date.now();
      const result = await cdp.evaluate(`window.__runPart(${JSON.stringify(part)})`);
      result.seconds = Math.round((Date.now() - t0) / 1000);
      result.logs = [...logs];
      results.push(result);
      const failed = result.checks.filter((c) => !c.pass);
      console.log(`== ${part}: ${result.checks.length - failed.length}/${result.checks.length} passed in ${result.seconds}s`);
      for (const c of result.checks) console.log(`  ${c.pass ? 'OK ' : 'XX '} ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
      if (result.errors.length || result.logs.length) console.log('  page errors', JSON.stringify({ errors: result.errors, logs: result.logs }));
    }
    writeFileSync(join(OUT, inApp ? 'results-app.json' : 'results-site.json'), JSON.stringify(results, null, 2));
    const total = results.reduce((n, r) => n + r.checks.length, 0);
    const failed = results.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0);
    console.log(`\n${total - failed}/${total} checks passed${failed ? ` — ${failed} failed` : ''} (${inApp ? 'desktop app' : 'site'}; files in ${OUT})`);
    return failed ? 1 : 0;
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        fn();
      } catch {
        /* already gone */
      }
    }
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message ?? err);
    process.exit(2);
  },
);
