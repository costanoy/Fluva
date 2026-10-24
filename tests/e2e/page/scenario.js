// The end-to-end test steps, run inside the page — the same code on the
// website and in the desktop app (see ../run.mjs). Each `parts.x` is one
// independent run, from a freshly loaded page. Hooks from setup.js:
//   window.__file(name) -> Promise<File>     (a test file)
//   window.__sink(blob, name) -> Promise     (keeps an exported file)
//   window.__inspectPdf(blob) -> Promise     (verify.mjs's findings)
//   window.__qa('secrets')                   (the test passwords)
(() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el?.innerText || '').trim();
  const btn = (re) => [...document.querySelectorAll('button')].find((b) => re.test(text(b)));
  const panelBtn = (label) => [...document.querySelectorAll('.right-panel button')].find((b) => text(b) === label || text(b).startsWith(label));
  const chip = (label) => [...document.querySelectorAll('.chip')].find((c) => text(c) === label);
  const tile = (label) => [...document.querySelectorAll('.filter-tile')].find((c) => text(c) === label);

  // Downloads are caught, not saved: every exported blob lands in __dl.
  if (!window.__qaPatched) {
    window.__qaPatched = true;
    window.__blobsQ = new Map();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      const u = create(b);
      window.__blobsQ.set(u, b);
      return u;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        window.__dl.push({ name: this.download, blob: window.__blobsQ.get(this.href) });
        return;
      }
      return click.call(this);
    };
    // A file picker opened by the app gets `window.__nextFiles` instead of a dialog.
    const pick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && window.__nextFiles) {
        const dt = new DataTransfer();
        window.__nextFiles.forEach((f) => dt.items.add(f));
        window.__nextFiles = null;
        this.files = dt.files;
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      return pick.call(this);
    };
    window.__errorsQ = [];
    window.addEventListener('error', (e) => window.__errorsQ.push('error: ' + (e.message || e.type)));
    window.addEventListener('unhandledrejection', (e) => window.__errorsQ.push('rejection: ' + (e.reason?.message || e.reason)));
    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.appendChild(style);
  }
  window.__dl = window.__dl || [];

  const until = async (cond, ms = 15000, step = 100) => {
    for (let t = 0; t < ms; t += step) {
      const v = cond();
      if (v) return v;
      await wait(step);
    }
    return null;
  };

  const open = async (names, types) => {
    const files = await Promise.all(names.map((n, i) => window.__file(n, types?.[i])));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await wait(800);
    for (let k = 0; k < 20 && !document.querySelector('.toolbar'); k++) {
      [...document.querySelectorAll('button')].find((b) => text(b) === 'Editar' && !b.disabled)?.click();
      await wait(500);
    }
    await until(() => document.querySelector('.doc-page canvas')?.width > 1);
    await wait(900);
    return !!document.querySelector('.toolbar');
  };

  const slide = async (labelRe, value) => {
    const field = [...document.querySelectorAll('.range-field')].find((f) => labelRe.test(text(f.querySelector('label'))));
    if (!field) return null;
    const input = field.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(40);
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await wait(40);
    return text(field.querySelector('output'));
  };

  const pointer = (type, x, y, id = 5, kind = 'mouse') =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: kind, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true });
  const drag = async (el, x0, y0, dx, dy, steps = 8) => {
    el.dispatchEvent(pointer('pointerdown', x0, y0));
    for (let i = 1; i <= steps; i++) {
      el.dispatchEvent(pointer('pointermove', x0 + (dx * i) / steps, y0 + (dy * i) / steps));
      await wait(16);
    }
    el.dispatchEvent(pointer('pointerup', x0 + dx, y0 + dy));
    await wait(120);
  };
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };

  const exportAs = async (re) => {
    const before = window.__dl.length;
    btn(/^Exportar/)?.click();
    await wait(400);
    const row = [...document.querySelectorAll('[role=menuitem]')].find((b) => re.test(text(b)));
    if (!row) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return null;
    }
    row.click();
    const got = await until(() => window.__dl.length > before && window.__dl[before], 120000, 150);
    await until(() => !document.querySelector('.busy-overlay'), 30000);
    return got;
  };

  const decode = async (blob) => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    bmp.close();
    return { w: c.width, h: c.height, canvas: c, data: x.getImageData(0, 0, c.width, c.height).data };
  };
  const px = (img, fx, fy) => {
    const i = (Math.floor(fy * img.h) * img.w + Math.floor(fx * img.w)) * 4;
    return [...img.data.slice(i, i + 4)];
  };
  const variance = (img, fx0, fy0, fx1, fy1) => {
    let s = 0;
    let s2 = 0;
    let n = 0;
    for (let y = Math.floor(fy0 * img.h); y < Math.floor(fy1 * img.h); y++) {
      for (let x = Math.floor(fx0 * img.w); x < Math.floor(fx1 * img.w); x++) {
        const i = (y * img.w + x) * 4;
        const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
        s += v;
        s2 += v * v;
        n++;
      }
    }
    return Math.round(s2 / n - (s / n) ** 2);
  };
  const preview = () => {
    const c = document.querySelector('.doc-page canvas');
    return { w: c.width, h: c.height, canvas: c, data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  };
  const sample = (fx, fy) => px(preview(), fx, fy);
  const compare = (img, ref) => {
    const c = document.createElement('canvas');
    c.width = ref.w;
    c.height = ref.h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(img.canvas, 0, 0, ref.w, ref.h);
    const d = x.getImageData(0, 0, ref.w, ref.h).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++, n++) sum += Math.abs(d[i + k] - ref.data[i + k]);
    return +(sum / n).toFixed(2);
  };

  const parts = {};

  parts.photo = async (R) => {
    R.ok('opens a JPG photo in the editor', await open(['foto-teste.jpg']));
    const tools = [...document.querySelectorAll('.toolbar .toolbar-btn')].map(text);
    R.ok('photo toolbar has Cortar, Ajustar, Redimensionar', ['Cortar', 'Ajustar', 'Redimensionar'].every((t) => tools.includes(t)), tools.join(' · '));
    btn(/^Ajustar/).click();
    await wait(500);
    const thumbs = await until(() => {
      const tiles = [...document.querySelectorAll('.filter-tile .filter-thumb')];
      return tiles.length === 10 && tiles.every((t) => t.style.backgroundImage.startsWith('url(')) && tiles.length;
    }, 8000);
    R.ok('10 filter tiles with previews', thumbs === 10);
    const before = sample(0.1, 0.16);
    tile('P&B').click();
    await wait(900);
    const bw = sample(0.1, 0.16);
    R.ok('P&B turns the red square grey (R=G=B)', bw[0] === bw[1] && bw[1] === bw[2] && before[0] - before[1] > 100, `${before} -> ${bw}`);
    tile('Original').click();
    await wait(700);
    await slide(/Exposição/, 50);
    await wait(900);
    const exp = sample(0.47, 0.5);
    R.ok('exposure +50 brightens mid grey (119 -> ~164)', Math.abs(exp[0] - 164) <= 3, String(exp));
    document.querySelector('[aria-label^="Desfazer"]')?.click();
    await wait(900);
    const undone = sample(0.47, 0.5);
    R.ok('undo restores the photo', Math.abs(undone[0] - 119) <= 2, String(undone));
    document.querySelector('[aria-label^="Refazer"]')?.click();
    await wait(900);
    R.ok('redo applies it again', Math.abs(sample(0.47, 0.5)[0] - 164) <= 3);
    panelBtn('Restaurar')?.click();
    await wait(900);
    tile('Sépia').click();
    await wait(400);
    await slide(/Intensidade/, 80);
    await slide(/Exposição/, 20);
    await slide(/Vinheta/, 40);
    await slide(/Nitidez/, 50);
    await slide(/Desfoque/, 10);
    await wait(1800);
    const shown = preview();
    const compareBtn = panelBtn('Comparar');
    compareBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await wait(1000);
    const holding = sample(0.1, 0.16);
    compareBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await wait(1000);
    R.ok('holding Comparar shows the original', holding[0] === 220 && holding[1] === 30, String(holding));

    const t0 = performance.now();
    const png = await exportAs(/^PNG/);
    R.info.pngMs = Math.round(performance.now() - t0);
    const pngImg = await decode(png.blob);
    R.ok('PNG export: 1600×1000, matches the preview', pngImg.w === 1600 && pngImg.h === 1000 && compare(pngImg, shown) < 2.5, `${pngImg.w}×${pngImg.h}, mean diff ${compare(pngImg, shown)}`);
    await window.__sink(png.blob, 'ajuste.png');
    const jpg = await exportAs(/^JPG/);
    const jpgImg = await decode(jpg.blob);
    R.ok('JPG export matches the preview', jpg.blob.type === 'image/jpeg' && compare(jpgImg, shown) < 3, `diff ${compare(jpgImg, shown)}`);
    const webp = await exportAs(/^WEBP/);
    R.info.webpOffered = !!webp;
    if (webp) {
      const webpImg = await decode(webp.blob);
      R.ok('WebP export matches the preview', webp.blob.type === 'image/webp' && compare(webpImg, shown) < 3.5, `diff ${compare(webpImg, shown)}`);
    }
    const pdf = await exportAs(/^PDF/);
    R.ok('PDF export', pdf?.blob.size > 10000 && pdf.name.endsWith('.pdf'), `${pdf?.name} ${pdf?.blob.size} bytes`);
    await window.__sink(pdf.blob, 'ajuste.pdf');

    btn(/^Cortar/).click();
    await wait(700);
    chip('16:9').click();
    await wait(200);
    [...document.querySelectorAll('.tile-btn')].find((b) => text(b).includes('Direita')).click();
    await wait(200);
    [...document.querySelectorAll('.tile-btn')].find((b) => text(b).includes('Horizontal')).click();
    await wait(200);
    await slide(/Endireitar/, 8);
    await wait(900);
    const cropNote = text(document.querySelector('.panel-note-tight'));
    panelBtn('Aplicar').click();
    await wait(1200);
    const cropped = await exportAs(/^PNG/);
    const croppedImg = await decode(cropped.blob);
    R.ok('crop 16:9 + turn + flip + straighten exports 1000×562', croppedImg.w === 1000 && Math.abs(croppedImg.h - 562) <= 1, `${cropNote}; ${croppedImg.w}×${croppedImg.h}`);
    await window.__sink(cropped.blob, 'corte.png');
    const croppedPdf = await exportAs(/^PDF/);
    await window.__sink(croppedPdf.blob, 'corte.pdf');

    btn(/^Redimensionar/).click();
    await wait(500);
    chip('50%').click();
    await wait(500);
    const half = await exportAs(/^JPG/);
    const halfImg = await decode(half.blob);
    R.ok('resize 50% exports 500×281', halfImg.w === 500 && Math.abs(halfImg.h - 281) <= 1, `${halfImg.w}×${halfImg.h}`);
  };

  parts.annotate = async (R) => {
    R.ok('opens the photo', await open(['foto-teste.jpg']));
    btn(/^Desenhar/).click();
    await wait(400);
    let layer = document.querySelector('.draw-layer');
    let lr = layer.getBoundingClientRect();
    const x0 = lr.left + lr.width * 0.3;
    const y0 = lr.top + lr.height * 0.2;
    layer.dispatchEvent(pointer('pointerdown', x0, y0, 9));
    for (let i = 1; i <= 30; i++) {
      layer.dispatchEvent(pointer('pointermove', x0 + i * 8, y0 + (i % 2 ? 18 : -18) + i * 2, 9));
      await wait(8);
    }
    layer.dispatchEvent(pointer('pointerup', x0 + 240, y0 + 60, 9));
    await wait(300);
    [...document.querySelectorAll('.segmented-btn')].find((b) => text(b).includes('Marca-texto')).click();
    await wait(200);
    const hy = lr.top + lr.height * 0.88;
    layer.dispatchEvent(pointer('pointerdown', lr.left + lr.width * 0.3, hy, 10, 'touch'));
    for (let i = 1; i <= 20; i++) {
      layer.dispatchEvent(pointer('pointermove', lr.left + lr.width * 0.3 + i * 12, hy, 10, 'touch'));
      await wait(8);
    }
    layer.dispatchEvent(pointer('pointerup', lr.left + lr.width * 0.3 + 240, hy, 10, 'touch'));
    await wait(300);
    const strokes = document.querySelectorAll('.doc-page svg path[stroke-linejoin="round"]:not([stroke="transparent"])').length;
    R.ok('pen (mouse) and highlighter (touch) strokes drawn', strokes === 2, `${strokes} strokes`);
    [...document.querySelectorAll('.segmented-btn')].find((b) => text(b).includes('Borracha')).click();
    await wait(200);
    layer = document.querySelector('.draw-layer');
    lr = layer.getBoundingClientRect();
    const ex = lr.left + lr.width * 0.45;
    layer.dispatchEvent(pointer('pointerdown', ex, lr.top + lr.height * 0.84, 11));
    for (let i = 1; i <= 10; i++) {
      layer.dispatchEvent(pointer('pointermove', ex, lr.top + lr.height * 0.84 + i * 4, 11));
      await wait(8);
    }
    layer.dispatchEvent(pointer('pointerup', ex, lr.top + lr.height * 0.92, 11));
    await wait(300);
    const left = document.querySelectorAll('.doc-page svg path[stroke-linejoin="round"]:not([stroke="transparent"])').length;
    R.ok('eraser removes the highlight', left === 1, `${left} left`);
    document.querySelector('[aria-label^="Desfazer"]')?.click();
    await wait(400);
    R.ok('undo brings the erased stroke back', document.querySelectorAll('.doc-page svg path[stroke-linejoin="round"]:not([stroke="transparent"])').length === 2);
    panelBtn('Concluir').click();
    await wait(300);

    btn(/^Adicionar seta/).click();
    await wait(400);
    const end = document.querySelector('[aria-label="Ponta da seta"]');
    const [ex2, ey2] = center(end);
    await drag(end, ex2, ey2, 60, 80);
    [...document.querySelectorAll('.right-panel .segmented-btn')].find((b) => text(b) === 'Duas').click();
    await wait(200);
    document.querySelector('.right-panel .check-row input').click();
    await wait(200);
    R.ok('arrow with two heads, dashed', document.querySelectorAll('.doc-page svg path[fill]').length >= 2 && !!document.querySelector('.doc-page svg path[stroke-dasharray]'));

    document.querySelector('.canvas-area').click();
    await wait(300);
    btn(/^Desfocar área/).click();
    await wait(900);
    const area = document.querySelector('.redact-area');
    const canvas = document.querySelector('.doc-page canvas').getBoundingClientRect();
    const [ax, ay] = center(area);
    await drag(area, ax, ay, canvas.left + canvas.width * 0.46 - ax, canvas.top + canvas.height * 0.7 - ay);
    [...document.querySelectorAll('.right-panel .segmented-btn')].find((b) => text(b) === 'Pixelar').click();
    await wait(1200);

    document.querySelector('.canvas-area').click();
    await wait(300);
    btn(/^Adicionar forma/).click();
    await wait(400);
    [...document.querySelectorAll('.right-panel .segmented-btn')].find((b) => text(b) === 'Contorno').click();
    await wait(200);
    await slide(/Opacidade/, 60);
    await wait(400);

    const png = await exportAs(/^PNG/);
    const img = await decode(png.blob);
    await window.__sink(png.blob, 'anotado.png');
    const inside = variance(img, 0.39, 0.7, 0.53, 0.79);
    const textArea = variance(img, 0.27, 0.65, 0.36, 0.69);
    R.ok('pixelated area hides the text in the exported PNG', inside < 200 && textArea > 1000, `inside ${inside}, untouched text ${textArea}`);
    const pdf = await exportAs(/^PDF/);
    await window.__sink(pdf.blob, 'anotado.pdf');
    R.ok('annotated PDF export', pdf?.blob.size > 10000, `${pdf?.blob.size} bytes`);
  };

  parts.transparent = async (R) => {
    R.ok('opens a transparent PNG', await open(['logo-transparente.png']));
    const png = await decode((await exportAs(/^PNG/)).blob);
    R.ok('PNG keeps transparency (corner alpha 0, inner alpha 200)', px(png, 0.02, 0.02)[3] === 0 && px(png, 0.5, 0.5)[3] === 200, `${px(png, 0.02, 0.02)} / ${px(png, 0.5, 0.5)}`);
    const webp = await exportAs(/^WEBP/);
    if (webp) {
      const w = await decode(webp.blob);
      R.ok('WebP keeps transparency', px(w, 0.02, 0.02)[3] === 0, String(px(w, 0.02, 0.02)));
    }
    const jpg = await decode((await exportAs(/^JPG/)).blob);
    R.ok('JPG gets a white background', px(jpg, 0.02, 0.02).slice(0, 3).every((v) => v > 250), String(px(jpg, 0.02, 0.02)));
    btn(/^Ajustar/).click();
    await wait(500);
    tile('Frio').click();
    await wait(300);
    await slide(/Desfoque/, 40);
    await wait(1200);
    const blurred = await decode((await exportAs(/^PNG/)).blob);
    let edge = null;
    for (let x = 0; x < blurred.w / 2; x++) {
      const i = (Math.floor(blurred.h / 2) * blurred.w + x) * 4;
      if (blurred.data[i + 3] > 10) {
        edge = [...blurred.data.slice(i, i + 4)];
        break;
      }
    }
    R.ok('blurred transparent edge has no dark fringe', edge && edge[1] > 100 && px(blurred, 0.02, 0.02)[3] === 0, String(edge));
    btn(/^Comprimir/).click();
    await wait(400);
    panelBtn('Comprimir agora').click();
    await until(() => document.querySelector('.compress-result'), 30000);
    const before = window.__dl.length;
    [...document.querySelectorAll('.right-panel button')].find((b) => /Baixar/.test(text(b))).click();
    const got = await until(() => window.__dl[before], 10000);
    const c = await decode(got.blob);
    R.ok('compressing a transparent image gives a transparent WebP/PNG', /(webp|png)$/.test(got.name) && px(c, 0.02, 0.02)[3] === 0, `${got.name} ${got.blob.type}`);
  };

  parts.formats = async (R) => {
    R.ok('opens a WebP', await open(['foto.webp']));
    const jpg = await exportAs(/^JPG/);
    const img = await decode(jpg.blob);
    R.ok('WebP → JPG export', img.w === 1600 && jpg.name === 'foto.jpg', `${jpg.name} ${img.w}×${img.h}`);
    R.ok('no error banner', !document.querySelector('.error-banner'), text(document.querySelector('.error-banner')));
  };

  parts.mislabeled = async (R) => {
    // WebP bytes in a file called .jpg, typed image/jpeg — a common web download.
    R.ok('opens a WebP named .jpg', await open(['foto-webp-disfarcada.jpg'], ['image/jpeg']));
    const pdf = await exportAs(/^PDF/);
    R.ok('…and exports it to PDF', pdf?.blob.size > 10000 && !document.querySelector('.error-banner'), `${pdf?.blob.size} ${text(document.querySelector('.error-banner'))}`);
    await window.__sink(pdf.blob, 'disfarcada.pdf');
  };

  parts.compress = async (R) => {
    const original = (await window.__file('foto-teste.jpg')).size;
    R.ok('opens the photo', await open(['foto-teste.jpg']));
    btn(/^Comprimir/).click();
    await wait(400);
    panelBtn('Comprimir agora').click();
    await until(() => document.querySelector('.compress-result'), 30000);
    const before = window.__dl.length;
    [...document.querySelectorAll('.right-panel button')].find((b) => /Baixar/.test(text(b))).click();
    const got = await until(() => window.__dl[before], 10000);
    R.ok('compressing a photo gives a smaller JPG', got.name === 'foto-teste_comprimido.jpg' && got.blob.type === 'image/jpeg' && got.blob.size < original, `${got.name} ${got.blob.size} < ${original}`);
  };

  parts.pdf = async (R) => {
    R.ok('opens a rotated PDF', await open(['rotacionado.pdf']));
    const tools = [...document.querySelectorAll('.toolbar .toolbar-btn')].map(text);
    R.ok('PDF toolbar has Cortar (no photo tools)', tools.includes('Cortar') && !tools.includes('Redimensionar'), tools.join(' · '));
    btn(/^Cortar/).click();
    await wait(700);
    const h = document.querySelector('.crop-handle-nw');
    const [hx, hy] = center(h);
    await drag(h, hx, hy, 160, 120);
    panelBtn('Aplicar').click();
    await wait(1000);
    btn(/^Adicionar seta/).click();
    await wait(400);
    const pdf = await exportAs(/^PDF/);
    await window.__sink(pdf.blob, 'pdf-cortado.pdf');
    R.ok('cropped + annotated PDF export', pdf?.blob.size > 1000 && !document.querySelector('.error-banner'), `${pdf?.blob.size}`);
  };

  parts.big = async (R) => {
    R.ok('opens a 12-megapixel photo', await open(['foto-12mp.jpg']));
    btn(/^Ajustar/).click();
    await wait(600);
    let t0 = performance.now();
    const before = sample(0.5, 0.5).join();
    await slide(/Exposição/, 30);
    await until(() => sample(0.5, 0.5).join() !== before, 10000, 20);
    R.info.sliderToCanvasMs = Math.round(performance.now() - t0);
    await slide(/Nitidez/, 40);
    await slide(/Desfoque/, 20);
    await wait(2500);
    t0 = performance.now();
    const jpg = await exportAs(/^JPG/);
    R.info.bigJpgMs = Math.round(performance.now() - t0);
    const img = await decode(jpg.blob);
    R.ok('12 MP edited photo exports at full size', img.w === 4032 && img.h === 3024, `${img.w}×${img.h} in ${R.info.bigJpgMs} ms`);
  };

  parts.invert = async (R) => {
    R.ok('opens the photo', await open(['foto-teste.jpg']));
    const label = text([...document.querySelectorAll('.right-panel .panel-label')].find((l) => /Inverter/.test(text(l))));
    R.ok('Edit panel has "Inverter imagem"', label === 'Inverter imagem', label);
    const tileBtn = (t) => [...document.querySelectorAll('.right-panel .tile-btn')].find((b) => text(b) === t);
    tileBtn('Horizontal').click();
    await wait(900);
    const h = sample(0.1, 0.16);
    R.ok('Horizontal: top-left now shows the green square', h[1] > 150 && h[0] < 80, String(h));
    tileBtn('Vertical').click();
    await wait(900);
    const hv = sample(0.1, 0.16);
    R.ok('then Vertical: top-left shows the yellow square', hv[0] > 200 && hv[1] > 180 && hv[2] < 90, String(hv));
    document.querySelector('[aria-label^="Desfazer"]').click();
    await wait(300);
    document.querySelector('[aria-label^="Desfazer"]').click();
    await wait(900);
    R.ok('undo twice: back to the red square', sample(0.1, 0.16)[0] === 220, String(sample(0.1, 0.16)));
    tileBtn('Cores').click();
    await wait(900);
    const neg = sample(0.1, 0.16);
    R.ok('Cores: negative (220,30,40 -> 35,225,215)', Math.abs(neg[0] - 35) <= 2 && Math.abs(neg[1] - 225) <= 2 && Math.abs(neg[2] - 215) <= 2, String(neg));
    R.ok('Cores button shows as pressed', tileBtn('Cores').getAttribute('aria-pressed') === 'true');
    const png = await decode((await exportAs(/^PNG/)).blob);
    R.ok('negative exported', Math.abs(px(png, 0.1, 0.16)[0] - 35) <= 2, String(px(png, 0.1, 0.16)));
    tileBtn('Cores').click();
    await wait(700);
    btn(/^Ajustar/).click();
    await wait(600);
    R.ok('Ajustar keeps its 10 filters (the negative is the Cores button)', document.querySelectorAll('.filter-tile').length === 10 && !tile('Negativo'));
    // Cores over a filter: turned off again, the filter is still there.
    tile('Sépia').click();
    await wait(700);
    btn(/^Ajustar/).click();
    await wait(600);
    tileBtn('Cores').click();
    await wait(700);
    tileBtn('Cores').click();
    await wait(700);
    btn(/^Ajustar/).click();
    await wait(700);
    R.ok('Cores on and off keeps the Sépia filter', tile('Sépia')?.getAttribute('aria-checked') === 'true');
    btn(/^Ajustar/).click();
    await wait(400);
    btn(/^Cortar/).click();
    await wait(600);
    R.ok('Cortar calls it "Girar e inverter"', [...document.querySelectorAll('.right-panel .panel-label')].some((l) => text(l) === 'Girar e inverter'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(400);
  };

  parts.fixes = async (R) => {
    R.ok('opens the photo', await open(['foto-teste.jpg']));
    // A blurred area moves with the photo when it's flipped.
    btn(/^Desfocar área/).click();
    await wait(800);
    const area = document.querySelector('.redact-area');
    const canvas = document.querySelector('.doc-page canvas').getBoundingClientRect();
    const [ax, ay] = center(area);
    await drag(area, ax, ay, canvas.left + canvas.width * 0.16 - ax, canvas.top + canvas.height * 0.2 - ay);
    const before = document.querySelector('.redact-area').getBoundingClientRect();
    document.querySelector('.canvas-area').click();
    await wait(300);
    [...document.querySelectorAll('.right-panel .tile-btn')].find((b) => text(b) === 'Horizontal').click();
    await wait(1000);
    const after = document.querySelector('.redact-area').getBoundingClientRect();
    const mirrored = Math.abs(canvas.right - after.right - (before.left - canvas.left)) < 3;
    R.ok('blurred area moves with the flipped photo', mirrored, `left ${Math.round(before.left - canvas.left)} -> right gap ${Math.round(canvas.right - after.right)}`);
    const png = await decode((await exportAs(/^PNG/)).blob);
    const v = variance(png, 0.8, 0.07, 0.95, 0.26);
    R.ok('the red square (now top-right) is still blurred', v < 2500, `variance ${v}`);
    for (let k = 0; k < 3; k++) {
      document.querySelector('[aria-label^="Desfazer"]').click();
      await wait(300);
    }
    await wait(600);

    // The highlighter multiplies into the photo in image exports too.
    btn(/^Desenhar/).click();
    await wait(300);
    [...document.querySelectorAll('.segmented-btn')].find((b) => text(b).includes('Marca-texto')).click();
    await wait(200);
    const layer = document.querySelector('.draw-layer');
    const lr = layer.getBoundingClientRect();
    const hy = lr.top + lr.height * 0.5;
    layer.dispatchEvent(pointer('pointerdown', lr.left + lr.width * 0.255, hy, 21));
    for (let i = 1; i <= 10; i++) {
      layer.dispatchEvent(pointer('pointermove', lr.left + lr.width * (0.255 + i * 0.003), hy, 21));
      await wait(8);
    }
    layer.dispatchEvent(pointer('pointerup', lr.left + lr.width * 0.285, hy, 21));
    await wait(300);
    panelBtn('Concluir').click();
    await wait(300);
    const hl = await decode((await exportAs(/^PNG/)).blob);
    const onBlack = px(hl, 0.262, 0.5);
    R.ok('highlighter over black stays black in the PNG (multiplied)', onBlack[0] < 30 && onBlack[1] < 30, String(onBlack));
    document.querySelector('[aria-label^="Desfazer"]').click();
    await wait(400);

    // The crop size counts Redimensionar.
    btn(/^Redimensionar/).click();
    await wait(400);
    chip('50%').click();
    await wait(400);
    btn(/^Cortar/).click();
    await wait(600);
    const note = text(document.querySelector('.panel-note-tight'));
    R.ok('crop size shown after a 50% resize is 800 × 500', note.includes('800 × 500'), note);
    // Enter on a focused button is that button's, not "apply".
    chip('1:1').click();
    await wait(200);
    const cancel = panelBtn('Cancelar');
    cancel.focus();
    cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(300);
    R.ok('Enter on a focused button does not apply the crop', !!document.querySelector('.crop-frame') && text(document.querySelector('.right-panel .panel-title')) === 'Cortar');
    document.body.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(500);
    const page = document.querySelector('.doc-page').getBoundingClientRect();
    R.ok('Esc leaves the page uncropped', Math.abs(page.width / page.height - 1.6) < 0.02, (page.width / page.height).toFixed(3));
    // Switching tools while cropping keeps the crop.
    btn(/^Cortar/).click();
    await wait(600);
    chip('1:1').click();
    await wait(200);
    btn(/^Ajustar/).click();
    await wait(800);
    const kept = document.querySelector('.doc-page').getBoundingClientRect();
    R.ok('leaving Cortar through another tool keeps the crop', Math.abs(kept.width / kept.height - 1) < 0.02, (kept.width / kept.height).toFixed(3));
  };

  // The view, mirrored left to right, against another view: how far apart.
  const mirroredDiff = (before, after) => {
    const c = document.createElement('canvas');
    c.width = before.w;
    c.height = before.h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.translate(before.w, 0);
    x.scale(-1, 1);
    x.drawImage(before.canvas, 0, 0);
    const copy = (src) => {
      const k = document.createElement('canvas');
      k.width = src.w;
      k.height = src.h;
      k.getContext('2d').drawImage(src.canvas, 0, 0);
      return { w: src.w, h: src.h, canvas: k };
    };
    const ref = { w: before.w, h: before.h, data: x.getImageData(0, 0, before.w, before.h).data };
    return compare(copy(after), ref);
  };
  const snapshot = () => {
    const p = preview();
    const k = document.createElement('canvas');
    k.width = p.w;
    k.height = p.h;
    k.getContext('2d').drawImage(p.canvas, 0, 0);
    return { w: p.w, h: p.h, canvas: k };
  };
  const tileBtn = (t) => [...document.querySelectorAll('.right-panel .tile-btn')].find((b) => text(b) === t);
  const undoBtn = () => document.querySelector('[aria-label^="Desfazer"]');
  const ratio = () => {
    const r = document.querySelector('.doc-page').getBoundingClientRect();
    return r.width / r.height;
  };

  parts.mirror = async (R) => {
    R.ok('opens the photo', await open(['foto-teste.jpg']));
    // Cropped to its left square, then mirrored: what's shown comes out mirrored.
    btn(/^Cortar/).click();
    await wait(600);
    chip('1:1').click();
    await wait(300);
    const frame = document.querySelector('.crop-frame');
    const [fx, fy] = center(frame);
    await drag(frame, fx, fy, -2000, 0);
    panelBtn('Aplicar').click();
    await wait(1200);
    R.ok('cropped to a square', Math.abs(ratio() - 1) < 0.02, ratio().toFixed(3));
    const red = sample(0.16, 0.16);
    R.ok('the red square is at the top left of the crop', red[0] > 200 && red[1] < 60, String(red));
    const p1 = snapshot();
    tileBtn('Horizontal').click();
    await wait(1200);
    const mirrored = sample(0.84, 0.16);
    R.ok('Horizontal on a cropped photo: the red square is now top right', mirrored[0] > 200 && mirrored[1] < 60, String(mirrored));
    const d1 = mirroredDiff(p1, snapshot());
    R.ok('the cropped view is its own mirror image', d1 < 4, `mean diff ${d1}`);
    R.ok('still the same square crop', Math.abs(ratio() - 1) < 0.02, ratio().toFixed(3));
    const png = await decode((await exportAs(/^PNG/)).blob);
    R.ok('exported square, red at the top right', png.w === png.h && px(png, 0.84, 0.16)[0] > 200, `${png.w}x${png.h} ${px(png, 0.84, 0.16)}`);
    undoBtn().click();
    await wait(400);
    undoBtn().click();
    await wait(1200);
    R.ok('undo twice: whole photo again', Math.abs(ratio() - 1.6) < 0.02, ratio().toFixed(3));

    // Straightened, then mirrored: tilted the other way, not twice as much.
    btn(/^Cortar/).click();
    await wait(600);
    await slide(/^Endireitar/, 8);
    await wait(300);
    panelBtn('Aplicar').click();
    await wait(1400);
    const p2 = snapshot();
    tileBtn('Horizontal').click();
    await wait(1400);
    const d2 = mirroredDiff(p2, snapshot());
    R.ok('a straightened photo mirrors as seen', d2 < 4, `mean diff ${d2}`);
    undoBtn().click();
    await wait(400);
    undoBtn().click();
    await wait(1200);

    // In Cortar, the mirror turns the straightening the other way too.
    btn(/^Cortar/).click();
    await wait(600);
    await slide(/^Endireitar/, 6);
    await wait(300);
    [...document.querySelectorAll('.right-panel .tile-btn')].find((b) => b.title.startsWith('Inverter na horizontal')).click();
    await wait(500);
    const straight = text([...document.querySelectorAll('.range-field')].find((f) => /^Endireitar/.test(text(f.querySelector('label'))))?.querySelector('output'));
    R.ok('mirroring in Cortar turns +6° into −6°', /6/.test(straight) && /−/.test(straight), straight);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(600);

    // Exporting with Cortar still open exports what's on screen.
    btn(/^Cortar/).click();
    await wait(600);
    chip('1:1').click();
    await wait(300);
    const sq = await decode((await exportAs(/^PNG/)).blob);
    R.ok('export with Cortar open includes the crop', sq.w === sq.h, `${sq.w}x${sq.h}`);
    R.ok('and Cortar is closed, the crop kept', !document.querySelector('.crop-frame') && Math.abs(ratio() - 1) < 0.02, ratio().toFixed(3));
    undoBtn().click();
    await wait(1200);

    // A blurred area near a corner, straightened far and back, still covers it.
    btn(/^Desfocar área/).click();
    await wait(800);
    const area = document.querySelector('.redact-area');
    const canvas = document.querySelector('.doc-page canvas').getBoundingClientRect();
    const [ax, ay] = center(area);
    await drag(area, ax, ay, canvas.left + canvas.width * 0.16 - ax, canvas.top + canvas.height * 0.2 - ay);
    document.querySelector('.canvas-area').click();
    await wait(300);
    for (const angle of [20, 0]) {
      btn(/^Cortar/).click();
      await wait(600);
      await slide(/^Endireitar/, angle);
      await wait(300);
      panelBtn('Aplicar').click();
      await wait(1400);
    }
    const back = await decode((await exportAs(/^PNG/)).blob);
    const v = variance(back, 0.05, 0.07, 0.2, 0.26);
    R.ok('after straightening 20° and back, the red square is still blurred', v < 2500, `variance ${v}`);
  };

  parts.touch = async (R) => {
    R.ok('opens the photo', await open(['foto-teste.jpg']));
    btn(/^Ajustar/).click();
    await wait(800);
    const field = [...document.querySelectorAll('.range-field')].find((f) => /^Brilho/.test(text(f.querySelector('label'))));
    const input = field.querySelector('input');
    const setValue = (v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(v));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const r = input.getBoundingClientRect();
    // A swipe that lands on the slider and turns into a scroll.
    input.dispatchEvent(pointer('pointerdown', r.left + r.width * 0.8, r.top + 5, 31, 'touch'));
    setValue(60);
    await wait(60);
    input.dispatchEvent(pointer('pointercancel', r.left + r.width * 0.8, r.top + 40, 31, 'touch'));
    await wait(300);
    R.ok('a scroll over a slider changes nothing', text(field.querySelector('output')) === '0' && undoBtn().disabled, `${text(field.querySelector('output'))} undo disabled ${undoBtn().disabled}`);
    // A tap moves it.
    input.dispatchEvent(pointer('pointerdown', r.left + r.width * 0.8, r.top + 5, 32, 'touch'));
    setValue(60);
    await wait(60);
    input.dispatchEvent(pointer('pointerup', r.left + r.width * 0.8, r.top + 5, 32, 'touch'));
    await wait(400);
    R.ok('a tap on the slider moves it, one step to undo', text(field.querySelector('output')) === '+60' && !undoBtn().disabled, text(field.querySelector('output')));
    // A slide moves it live.
    input.dispatchEvent(pointer('pointerdown', r.left + r.width * 0.8, r.top + 5, 33, 'touch'));
    setValue(40);
    input.dispatchEvent(pointer('pointermove', r.left + r.width * 0.7, r.top + 5, 33, 'touch'));
    await wait(100);
    const liveValue = text(field.querySelector('output'));
    setValue(30);
    await wait(60);
    input.dispatchEvent(pointer('pointerup', r.left + r.width * 0.65, r.top + 5, 33, 'touch'));
    await wait(400);
    R.ok('a slide moves it as the finger goes', liveValue === '+40' && text(field.querySelector('output')) === '+30', `${liveValue} then ${text(field.querySelector('output'))}`);

    // Comparar: a scroll starting on it doesn't turn it on; a tap does.
    const cmp = panelBtn('Comparar');
    cmp.dispatchEvent(pointer('pointerdown', 10, 10, 34, 'touch'));
    cmp.dispatchEvent(pointer('pointercancel', 10, 60, 34, 'touch'));
    await wait(200);
    R.ok('a scroll from Comparar leaves it off', panelBtn('Comparar').getAttribute('aria-pressed') === 'false');
    panelBtn('Comparar').dispatchEvent(pointer('pointerdown', 10, 10, 35, 'touch'));
    panelBtn('Comparar').dispatchEvent(pointer('pointerup', 10, 10, 35, 'touch'));
    panelBtn('Comparar').click();
    await wait(300);
    R.ok('a tap turns Comparar on', panelBtn('Comparar').getAttribute('aria-pressed') === 'true');
    await slide(/^Contraste/, 20);
    await wait(300);
    R.ok('a new adjustment lets Comparar go', panelBtn('Comparar').getAttribute('aria-pressed') === 'false');
  };

  parts.queue = async (R) => {
    // Two files picked together wait in a list, what to do with them big at
    // the bottom of the screen, in the middle.
    const files = await Promise.all(['texto.pdf', 'foto-teste.jpg'].map((n) => window.__file(n)));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    const bar = await until(() => document.querySelector('.queue-choices'), 5000);
    R.ok('two files: the list and the choices show', !!bar && document.querySelectorAll('.queue-row').length === 2);
    const r = bar.getBoundingClientRect();
    R.ok('the choices sit at the bottom, in the middle', Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && innerHeight - r.bottom >= 0 && innerHeight - r.bottom < 40, `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} in ${innerWidth}×${innerHeight}`);
    const choices = [...bar.querySelectorAll('button')];
    R.ok('big "Alterar formato" and "Editar"', choices.map(text).join(' | ') === 'Alterar formato | Editar' && choices.every((b) => b.getBoundingClientRect().height >= 60), choices.map((b) => `${text(b)} ${Math.round(b.getBoundingClientRect().height)}px`).join(', '));
    choices[0].click();
    await wait(300);
    R.ok('"Alterar formato" opens the format choice, the bar steps aside', !!document.querySelector('.convert-box') && !document.querySelector('.queue-choices'));
    [...document.querySelectorAll('.convert-box button')].find((b) => text(b) === 'Cancelar').click();
    await wait(300);
    R.ok('"Cancelar" brings the choices back', !!document.querySelector('.queue-choices'));
    document.querySelector('.queue-choices .btn-primary').click();
    await until(() => document.querySelector('.toolbar') && document.querySelectorAll('.thumb-item').length, 30000);
    await wait(600);
    R.ok('"Editar" opens both files, joined', document.querySelectorAll('.thumb-item').length === 4, `${document.querySelectorAll('.thumb-item').length} pages`);
  };

  parts.beta = async (R) => {
    [...document.querySelectorAll('a, button')].find((b) => /Teste o nosso app/.test(text(b))).click();
    await until(() => document.querySelector('.beta-card'), 5000);
    const link = document.querySelector('.beta-card a');
    R.ok('"Teste o nosso app" leads to the portfolio, in a new tab', link?.href === 'https://portfolio.cyberhat.com.br/' && link.target === '_blank', `${link?.href} ${link?.target}`);
    R.ok('no e-mail address left on the page', !document.querySelector('a[href^="mailto:"]') && !/@outlook|@gmail/.test(document.body.innerText));
    const contact = [...document.querySelectorAll('.site-footer a')].find((a) => text(a) === 'Contato');
    R.ok('"Contato" in the footer leads there too', contact?.href === 'https://portfolio.cyberhat.com.br/' && contact.target === '_blank', contact?.href);
  };

  /** A tall photo (most documents are), dropped as if picked: opens in the reader. */
  const dropTallPhoto = async () => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 2000;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 1600, 2000);
    x.fillStyle = '#d33';
    x.fillRect(100, 100, 400, 300);
    x.fillStyle = '#333';
    x.font = '70px sans-serif';
    x.fillText('Página alta de teste', 100, 600);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'alta.jpg', { type: 'image/jpeg' }));
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return until(() => document.querySelector('.reader-choices .reader-choice:not(:disabled)'), 15000);
  };
  /** Where (x, y) falls on an element, as fractions of it — and its width. */
  const fractionAt = (el, x, y) => {
    const r = el.getBoundingClientRect();
    return [(x - r.left) / r.width, (y - r.top) / r.height, r.width];
  };
  const samePoint = (a, b, tol = 0.01) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
  const fmt = (a, b) => `${a.map((v) => v.toFixed(3))} -> ${b.map((v) => v.toFixed(3))}`;
  const wheel = (el, x, y, deltaY, ctrlKey = false) => {
    const e = new WheelEvent('wheel', { deltaY, ctrlKey, clientX: x, clientY: y, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  parts.zoom = async (R) => {
    R.ok('opens a tall photo in the reader', !!(await dropTallPhoto()));
    await wait(800);
    // Reader: Ctrl + wheel (a touchpad pinch) keeps the point under the pointer.
    const view = document.querySelector('.reader-viewport');
    const vr = view.getBoundingClientRect();
    const rx = vr.left + vr.width * 0.35;
    const ry = vr.top + vr.height * 0.4;
    let before = fractionAt(document.querySelector('.reader-page'), rx, ry);
    for (let i = 0; i < 5; i++) wheel(view, rx, ry, -60, true);
    await wait(600);
    let after = fractionAt(document.querySelector('.reader-page'), rx, ry);
    R.ok('reader: Ctrl+wheel keeps the point under the pointer', samePoint(before, after) && after[2] > before[2] * 1.5, fmt(before, after));
    R.ok("reader: the browser doesn't zoom the whole app", wheel(view, rx, ry, -60, true).defaultPrevented);
    await wait(500);
    // Reader: + keeps the middle of the view.
    const mx = vr.left + vr.width / 2;
    const my = vr.top + vr.height / 2;
    before = fractionAt(document.querySelector('.reader-page'), mx, my);
    document.querySelector('[aria-label="Aumentar zoom"]').click();
    await wait(600);
    after = fractionAt(document.querySelector('.reader-page'), mx, my);
    R.ok('reader: + keeps the middle of the view', samePoint(before, after) && after[2] > before[2], fmt(before, after));

    // Editor.
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar') && document.querySelector('.doc-page canvas')?.width > 1, 20000);
    await wait(1200);
    const area = document.querySelector('.canvas-area');
    const ar = area.getBoundingClientRect();
    const px = ar.left + ar.width * 0.3;
    const py = ar.top + ar.height * 0.35;
    before = fractionAt(document.querySelector('.doc-page'), px, py);
    for (let i = 0; i < 6; i++) wheel(area, px, py, -50);
    await wait(600);
    after = fractionAt(document.querySelector('.doc-page'), px, py);
    R.ok('editor: the wheel zooms around the pointer', samePoint(before, after) && after[2] > before[2] * 1.3, fmt(before, after));
    const page = document.querySelector('.doc-page');
    const w0 = page.style.width;
    wheel(area, px, py, -50);
    for (let i = 0; i < 20 && page.style.width === w0; i++) await new Promise((r) => requestAnimationFrame(r));
    const slide = getComputedStyle(page).transitionDuration;
    const full = Math.abs(page.getBoundingClientRect().width - parseFloat(page.style.width)) < 1;
    R.ok("editor: the page doesn't slide while zooming", /^0s/.test(slide) && full, `${slide}, full size on the first frame: ${full}`);
    await wait(600);
    const cx = ar.left + ar.width / 2;
    const cy = ar.top + ar.height / 2;
    before = fractionAt(document.querySelector('.doc-page'), cx, cy);
    document.querySelector('[aria-label^="Aumentar"]').click();
    await wait(600);
    after = fractionAt(document.querySelector('.doc-page'), cx, cy);
    R.ok('editor: + keeps the middle of the view', samePoint(before, after), fmt(before, after));
    for (let i = 0; i < 30; i++) wheel(area, px, py, 120);
    await wait(600);
    const r1 = document.querySelector('.doc-page').getBoundingClientRect();
    const off = [Math.round(r1.left + r1.width / 2 - (ar.left + ar.width / 2)), Math.round(r1.top + r1.height / 2 - (ar.top + ar.height / 2))];
    R.ok('editor: zoomed out, the page settles in the middle', Math.abs(off[0]) <= 2 && Math.abs(off[1]) <= 2, String(off));

    // A two-finger pinch zooms around the fingers.
    const fx = ar.left + ar.width * 0.4;
    const fy = ar.top + ar.height * 0.45;
    before = fractionAt(document.querySelector('.doc-page'), fx, fy);
    const touch = (type, id, x, y) => new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 61, buttons: type === 'pointerup' ? 0 : 1 });
    area.dispatchEvent(touch('pointerdown', 61, fx - 30, fy));
    area.dispatchEvent(touch('pointerdown', 62, fx + 30, fy));
    for (let i = 1; i <= 10; i++) {
      area.dispatchEvent(touch('pointermove', 61, fx - 30 - i * 6, fy));
      area.dispatchEvent(touch('pointermove', 62, fx + 30 + i * 6, fy));
      await wait(16);
    }
    area.dispatchEvent(touch('pointerup', 61, fx - 90, fy));
    area.dispatchEvent(touch('pointerup', 62, fx + 90, fy));
    await wait(600);
    after = fractionAt(document.querySelector('.doc-page'), fx, fy);
    R.ok('a pinch zooms around the fingers', samePoint(before, after, 0.015) && after[2] > before[2] * 2.5, fmt(before, after));
  };

  /** Nothing overflows the screen or gets cut at this size: home, reader,
   * editor, Cortar, Ajustar. */
  const layout = async (R, width, height, mobile) => {
    await window.__qa('viewport', { width, height, mobile });
    await wait(800);
    const problems = () => {
      const clipped = [...document.querySelectorAll('button, .btn, .chip, .tile-btn, .panel-label, .toolbar-btn')]
        .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 2)
        .map((el) => text(el).slice(0, 30) || el.className);
      return { overflow: document.documentElement.scrollWidth > innerWidth, clipped };
    };
    const check = (where) => {
      const p = problems();
      R.ok(`${where}: nothing overflows or gets cut`, !p.overflow && !p.clipped.length, JSON.stringify(p));
    };
    check('home');
    await dropTallPhoto();
    await wait(800);
    check('reader');
    const choices = document.querySelector('.reader-choices').getBoundingClientRect();
    R.ok('reader: the choices are on screen', choices.bottom <= innerHeight && choices.left >= 0 && choices.right <= innerWidth, `${Math.round(choices.left)}–${Math.round(choices.right)}, bottom ${Math.round(choices.bottom)} of ${innerHeight}`);
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar') && document.querySelector('.doc-page canvas')?.width > 1, 20000);
    await wait(1000);
    check('editor');
    btn(/^Cortar/)?.click();
    await wait(1000);
    check('Cortar');
    btn(/^Ajustar/)?.click();
    await wait(1000);
    check('Ajustar');
    await window.__qa('viewport', {});
  };
  parts.layoutDesktop = (R) => layout(R, 1440, 900, false);
  parts.layoutLaptop = (R) => layout(R, 1280, 720, false);
  parts.layoutPhone = (R) => layout(R, 390, 844, true);

  /** Drops test files on the home screen, as if picked. */
  const dropFiles = async (names) => {
    const files = await Promise.all(names.map((n) => window.__file(n)));
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  };
  /** Types into an input the way a person does (React sees it). */
  const typeInto = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** How many pixels of a canvas carry ink (not near-white). */
  const inkIn = (canvas) => {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) n++;
    return n;
  };

  parts.password = async (R) => {
    const { pdfPassword } = await window.__qa('secrets');
    await dropFiles(['protegido-senha.pdf']);
    const dialog = await until(() => document.querySelector('.password-dialog'), 10000);
    R.ok('a PDF with an opening password asks for it', !!dialog && text(dialog).includes('protegido-senha.pdf'), text(dialog?.querySelector('.dialog-text')));
    const input = () => document.querySelector('.password-dialog input');
    const openBtn = () => [...document.querySelectorAll('.password-dialog button')].find((b) => text(b) === 'Abrir');
    typeInto(input(), 'errada');
    await wait(100);
    openBtn().click();
    const wrong = await until(() => /Senha incorreta/.test(text(document.querySelector('.password-dialog'))), 10000);
    await window.__shot('senha-incorreta');
    R.ok('a wrong password says so and asks again', !!wrong && input().value === '');
    typeInto(input(), pdfPassword);
    await wait(100);
    openBtn().click();
    const shown = await until(() => !document.querySelector('.password-dialog') && document.querySelector('.reader-page canvas')?.width > 1, 15000);
    await wait(800);
    const canvas = document.querySelector('.reader-page canvas');
    R.ok('the right password opens it in the reader, its text drawn', !!shown && inkIn(canvas) > 200, `${canvas?.width}×${canvas?.height}, ${canvas ? inkIn(canvas) : 0} dark pixels`);
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar') || document.querySelector('.password-dialog'), 20000);
    await wait(1500);
    R.ok('"Editar" opens it without asking again', !!document.querySelector('.toolbar') && !document.querySelector('.password-dialog'));
    const runs = await until(() => document.querySelectorAll('.text-run').length, 10000);
    R.ok('its text can be clicked to edit', runs > 0, `${runs} text runs`);
    btn(/^Adicionar texto/)?.click();
    await wait(800);
    const pdf = await exportAs(/^PDF/);
    await window.__sink(pdf.blob, 'senha-exportado.pdf');
    const info = await window.__inspectPdf(pdf.blob);
    R.ok('the exported PDF opens without a password (its page as an image)', info.encrypted === false && info.pages === 1 && info.images.length === 1, JSON.stringify({ encrypted: info.encrypted, pages: info.pages, images: info.images.length }));
    const toast = text(document.querySelector('.toast'));
    R.ok('…and says so', /protegido/.test(toast) && /abre sem senha/.test(toast), toast);
  };

  parts.passwordCancel = async (R) => {
    await dropFiles(['protegido-senha.pdf']);
    await until(() => document.querySelector('.password-dialog'), 10000);
    [...document.querySelectorAll('.password-dialog button')].find((b) => text(b) === 'Cancelar').click();
    await until(() => document.querySelector('.dropzone') && !document.querySelector('.password-dialog'), 10000);
    await wait(500);
    R.ok('"Cancelar" goes back home, with no error', !!document.querySelector('.dropzone') && !document.querySelector('.reader-viewport') && !document.querySelector('.alert'), text(document.querySelector('.alert')));
    // Among several files: cancelling leaves them all unopened, quietly.
    await dropFiles(['protegido-senha.pdf', 'texto.pdf']);
    await until(() => document.querySelector('.queue-choices'), 5000);
    document.querySelector('.queue-choices .btn-primary').click();
    await until(() => document.querySelector('.password-dialog'), 10000);
    [...document.querySelectorAll('.password-dialog button')].find((b) => text(b) === 'Cancelar').click();
    await wait(1000);
    R.ok('…and among several files too', !document.querySelector('.toolbar') && document.querySelectorAll('.queue-row').length === 2 && !document.querySelector('.alert'), text(document.querySelector('.alert')));
    // A PDF protected only by its author opens without asking.
    document.querySelectorAll('.queue-row .alert-close').forEach((b) => b.click());
    await wait(300);
    await dropFiles(['protegido-dono.pdf']);
    const opened = await until(() => document.querySelector('.reader-page canvas')?.width > 1 || document.querySelector('.password-dialog'), 15000);
    R.ok('a PDF protected only by its author opens without asking', !!opened && !document.querySelector('.password-dialog'));
  };

  /** Back to the home screen, the way the Back button goes. */
  const goHome = async () => {
    window.confirm = () => true;
    for (let i = 0; i < 6 && !document.querySelector('.dropzone'); i++) {
      history.back();
      await wait(700);
    }
    return !!document.querySelector('.dropzone');
  };
  /** A file the page made (a download), opened again as if picked. */
  const dropBlob = async (blob, name) => {
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: blob.type || 'application/pdf' }));
    document.querySelector('.dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  };
  const choose = (select, value) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /** Signs the open document through Exportar → Assinar e baixar. */
  const signWith = async (certName, { stamp = true, corner = null, page = null } = {}) => {
    const { certPassword } = await window.__qa('secrets');
    btn(/^Exportar/).click();
    await wait(400);
    [...document.querySelectorAll('[role=menuitem]')].find((b) => /Assinar/.test(text(b))).click();
    await until(() => document.querySelector('.sign-dialog'), 5000);
    await wait(600);
    window.__nextFiles = [await window.__file(certName)];
    document.querySelector('.sign-dialog .cert-empty').click();
    await wait(200);
    typeInto(document.querySelector('#sign-pass'), certPassword);
    if (!stamp) document.querySelector('.sign-check input').click();
    await wait(100);
    const selects = [...document.querySelectorAll('.sign-select select')];
    if (page) choose(selects[0], page);
    if (corner) choose(selects[selects.length - 1], corner);
    await wait(100);
    const note = text(document.querySelector('.sign-existing'));
    const before = window.__dl.length;
    [...document.querySelectorAll('.sign-dialog button')].find((b) => /Assinar e baixar/.test(text(b))).click();
    const got = await until(() => window.__dl[before] || document.querySelector('.sign-dialog .alert'), 60000);
    const error = text(document.querySelector('.sign-dialog .alert'));
    const done = await until(() => /PDF assinado/.test(text(document.querySelector('.sign-dialog'))), 3000);
    const doneText = text(document.querySelector('.sign-dialog'));
    if (done) [...document.querySelectorAll('.sign-dialog button')].find((b) => text(b) === 'Concluir')?.click();
    else [...document.querySelectorAll('.sign-dialog button')].find((b) => text(b) === 'Cancelar')?.click();
    await wait(300);
    return { blob: got?.blob ?? null, note, done: !!done, doneText, error };
  };
  /** Pixels close to the stamp's green, inside a box of the page shown in
   * the reader — given as fractions of the page, from its top-left. */
  const greenIn = (fx0, fy0, fx1, fy1) => {
    const c = document.querySelector('.reader-page canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let y = Math.floor(fy0 * c.height); y < fy1 * c.height; y++) {
      for (let x = Math.floor(fx0 * c.width); x < fx1 * c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (Math.abs(d[i] - 29) < 30 && Math.abs(d[i + 1] - 158) < 30 && Math.abs(d[i + 2] - 117) < 30) n++;
      }
    }
    return n;
  };
  const allValid = (info) => info.signatures.length > 0 && info.signatures.every((sig) => sig.digestOk && sig.signatureOk);

  parts.sign = async (R) => {
    R.ok('opens a 3-page PDF', await open(['texto.pdf']));
    const first = await signWith('cert-valido.p12');
    R.ok('signs it', first.done && !!first.blob, first.error || first.doneText.slice(0, 80));
    await window.__sink(first.blob, 'assinado-1.pdf');
    let info = await window.__inspectPdf(first.blob);
    R.ok('the signature checks out (hash and RSA, over the whole file)', allValid(info) && info.signatures.length === 1 && info.signatures[0].coversToEnd && info.signatures[0].signer === 'FULANO DE TAL:12345678900', JSON.stringify(info.signatures));
    R.ok('added as an update: the original bytes are still all there', info.revisions === 2, `${info.revisions} revisions`);
    const stamp = info.widgets.find((w) => w.appearance);
    R.ok('a stamp on the last page, bottom right', !!stamp && stamp.page === 3 && stamp.rect[0] > 300 && stamp.rect[1] < 100, JSON.stringify(info.widgets));

    // Signed again by someone else: the first signature stays valid.
    R.ok('back home', await goHome());
    await dropBlob(first.blob, 'assinado-1.pdf');
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 15000);
    await wait(600);
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar'), 20000);
    await wait(1200);
    const second = await signWith('cert-segundo.p12');
    R.ok('the dialog says the signature already there stays valid', /já tem 1 assinatura/.test(second.note) && /continua valendo/.test(second.note), second.note);
    R.ok('signs it again', second.done && !!second.blob, second.error);
    await window.__sink(second.blob, 'assinado-2.pdf');
    info = await window.__inspectPdf(second.blob);
    const [sigA, sigB] = info.signatures;
    R.ok('both signatures check out', info.signatures.length === 2 && allValid(info), JSON.stringify(info.signatures.map((x) => ({ signer: x.signer, digestOk: x.digestOk, signatureOk: x.signatureOk, coversToEnd: x.coversToEnd }))));
    R.ok('the first covers its own version, the second the whole file', sigA && !sigA.coversToEnd && sigB?.coversToEnd && sigB.signer === 'CICLANA DA SILVA:98765432100', JSON.stringify(info.signatures.map((x) => x.byteRange)));
    R.ok("every cross-reference section places each object where it is", info.xref.ok && info.xref.sections === 3, JSON.stringify(info.xref));
    const stamps = info.widgets.filter((w) => w.appearance && w.page === 3);
    const overlap = stamps.length === 2 && stamps[0].rect[0] < stamps[1].rect[2] && stamps[0].rect[2] > stamps[1].rect[0] && stamps[0].rect[1] < stamps[1].rect[3] && stamps[0].rect[3] > stamps[1].rect[1];
    R.ok("the second stamp doesn't cover the first", stamps.length === 2 && !overlap, JSON.stringify(stamps.map((w) => w.rect.map(Math.round))));
  };

  parts.signClassic = async (R) => {
    // A PDF with a classic cross-reference table, signed twice.
    R.ok('opens a PDF with a classic cross-reference table', await open(['texto-classico.pdf']));
    const first = await signWith('cert-valido.p12');
    await goHome();
    await dropBlob(first.blob, 'classico-assinado.pdf');
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 15000);
    await wait(600);
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar'), 20000);
    await wait(1200);
    const second = await signWith('cert-segundo.p12');
    const info = await window.__inspectPdf(second.blob);
    R.ok('both signatures check out', info.signatures.length === 2 && allValid(info), JSON.stringify(info.signatures.map((x) => [x.signer, x.digestOk, x.signatureOk])));
    R.ok('three cross-reference tables, each placing its objects right', info.xref.ok && info.xref.kinds.join() === 'table,table,table', JSON.stringify(info.xref));
  };

  parts.signStamp = async (R) => {
    R.ok('opens a 3-page PDF', await open(['texto.pdf']));
    const signed = await signWith('cert-valido.p12', { page: 'first', corner: 'top-left' });
    R.ok('signs it, stamp on the first page, top left', signed.done, signed.error);
    const info = await window.__inspectPdf(signed.blob);
    const stamp = info.widgets.find((w) => w.appearance);
    R.ok('the stamp is where it was asked to be', !!stamp && stamp.page === 1 && stamp.rect[0] < 100 && stamp.rect[3] > 700, JSON.stringify(stamp));
    // Shown when the signed file is opened.
    await goHome();
    await dropBlob(signed.blob, 'assinado.pdf');
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 15000);
    await wait(1200);
    const green = greenIn(0, 0, 0.5, 0.2);
    await window.__shot('carimbo');
    R.ok('…and drawn there when the file is opened', green > 300, `${green} green pixels`);
    // No stamp: nothing drawn, still signed.
    await goHome();
    R.ok('opens it again', await open(['texto.pdf']));
    const plain = await signWith('cert-valido.p12', { stamp: false });
    const plainInfo = await window.__inspectPdf(plain.blob);
    R.ok('without the stamp: signed, nothing on the page', plain.done && allValid(plainInfo) && plainInfo.widgets.length === 1 && !plainInfo.widgets[0].appearance && plainInfo.widgets[0].rect.every((v) => v === 0), JSON.stringify(plainInfo.widgets));
  };

  parts.signRotated = async (R) => {
    // Page 1 is stored portrait with /Rotate 90: shown landscape.
    R.ok('opens a PDF with a turned page', await open(['rotacionado.pdf']));
    const signed = await signWith('cert-valido.p12', { page: 'first' });
    const info = await window.__inspectPdf(signed.blob);
    const stamp = info.widgets.find((w) => w.appearance);
    R.ok('signed, the stamp on the turned page', signed.done && allValid(info) && stamp?.page === 1 && stamp.rotation === 90, JSON.stringify(stamp));
    await goHome();
    await dropBlob(signed.blob, 'girado.pdf');
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 15000);
    await wait(1200);
    const c = document.querySelector('.reader-page canvas');
    const green = greenIn(0.55, 0.75, 1, 1);
    await window.__shot('carimbo-girado');
    R.ok('drawn at the bottom right as the page is seen', c.width > c.height && green > 300, `${c.width}×${c.height}, ${green} green pixels`);
  };

  parts.signEdited = async (R) => {
    R.ok('opens a PDF', await open(['texto.pdf']));
    const first = await signWith('cert-valido.p12');
    await goHome();
    await dropBlob(first.blob, 'assinado.pdf');
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 15000);
    await wait(600);
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar'), 20000);
    await wait(1200);
    // An edit: the signed file can't stay as it was.
    btn(/^Adicionar texto/).click();
    await wait(600);
    document.querySelector('.canvas-area').click();
    await wait(300);
    const second = await signWith('cert-segundo.p12');
    R.ok("the dialog warns the earlier signature won't hold", /deixam de valer/.test(second.note), second.note);
    const info = await window.__inspectPdf(second.blob);
    const last = info.signatures[info.signatures.length - 1];
    R.ok('the new signature checks out', second.done && last?.digestOk && last.signatureOk && last.coversToEnd && last.signer === 'CICLANA DA SILVA:98765432100', JSON.stringify(info.signatures));
  };

  parts.signExpired = async (R) => {
    R.ok('opens a PDF', await open(['texto.pdf']));
    const result = await signWith('cert-vencido.p12');
    R.ok('an expired certificate is refused, saying when it expired', !result.done && /venceu em (31\/12\/2020|01\/01\/2021)/.test(result.error), result.error);
  };

  /** Comprimir → a level → "Comprimir agora" → the result panel and the file. */
  const compressPdf = async (level) => {
    btn(/^Comprimir/).click();
    await wait(400);
    if (level) [...document.querySelectorAll('.right-panel .segmented-btn')].find((b) => text(b) === level)?.click();
    await wait(200);
    panelBtn('Comprimir agora').click();
    const result = await until(() => document.querySelector('.compress-result'), 120000);
    const before = window.__dl.length;
    [...document.querySelectorAll('.right-panel button')].find((b) => /Baixar/.test(text(b))).click();
    const got = await until(() => window.__dl[before], 20000);
    return { panel: text(result), blob: got?.blob ?? null, name: got?.name };
  };
  /** Opens a PDF the page made in the editor, and counts its text runs. */
  const textRunsOf = async (blob, name) => {
    await goHome();
    await dropBlob(blob, name);
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 20000);
    await wait(600);
    document.querySelectorAll('.reader-choices .reader-choice')[1].click();
    await until(() => document.querySelector('.toolbar'), 20000);
    return (await until(() => document.querySelectorAll('.text-run').length, 10000)) || 0;
  };

  parts.compressPdf = async (R) => {
    const original = (await window.__file('imagem-pesada.pdf')).size;
    R.ok('opens a PDF with two big pictures and text', await open(['imagem-pesada.pdf']));
    const runsBefore = (await until(() => document.querySelectorAll('.text-run').length, 10000)) || 0;
    const t0 = performance.now();
    const out = await compressPdf('Equilibrada');
    R.info.compressMs = Math.round(performance.now() - t0);
    await window.__sink(out.blob, 'comprimido.pdf');
    R.ok('much smaller', out.blob && out.blob.size < original * 0.3, `${original} -> ${out.blob?.size} bytes in ${R.info.compressMs} ms`);
    R.ok('says the pictures were recompressed and the text kept', /imagens foram recomprimidas/.test(out.panel) && /selecionável/.test(out.panel), out.panel.replace(/\s+/g, ' ').slice(0, 160));
    const info = await window.__inspectPdf(out.blob);
    // Shown 495 × 371 pt: at 150 dpi, about 1031 × 773 pixels.
    R.ok('pictures scaled to what the page shows (150 dpi) and stored as JPEG', info.images.length === 2 && info.images.every((im) => im.width <= 1100 && im.width >= 950 && im.filter.includes('DCTDecode')), JSON.stringify(info.images));
    R.ok('a valid file', info.xref?.ok && info.pages === 2, JSON.stringify(info.xref));
    const runsAfter = await textRunsOf(out.blob, 'comprimido.pdf');
    R.ok('its text is still text (selectable, editable)', runsBefore > 0 && runsAfter === runsBefore, `${runsBefore} text runs before, ${runsAfter} after`);
    await wait(1500);
    await window.__shot('comprimido');
  };

  parts.compressMask = async (R) => {
    // A photo with see-through parts: its mask shrinks with it, kept exact.
    R.ok('opens a PDF with a cut-out photo', await open(['recorte.pdf']));
    const out = await compressPdf('Equilibrada');
    const info = await window.__inspectPdf(out.blob);
    const [picture, mask] = [info.images.find((im) => im.filter.includes('DCT')), info.images.find((im) => im.filter.includes('Flate'))];
    // Shown 180 × 120 pt: at 150 dpi, 375 × 250 pixels.
    R.ok('the photo and its mask, both at the size shown', picture?.width === 375 && mask?.width === 375 && mask.height === 250, JSON.stringify(info.images));
    await goHome();
    await dropBlob(out.blob, 'recorte-comprimido.pdf');
    await until(() => document.querySelector('.reader-page canvas')?.width > 1, 20000);
    await wait(1000);
    // Around the photo, the yellow page shows through; inside, its colors.
    const c = document.querySelector('.reader-page canvas');
    const at = (fx, fy) => [...c.getContext('2d').getImageData(Math.floor(fx * c.width), Math.floor(fy * c.height), 1, 1).data];
    const corner = at(62 / 595.28, (841.89 - 758) / 841.89);
    const middle = at(150 / 595.28, (841.89 - 700) / 841.89);
    R.ok('still see-through around it, its colors inside', corner[0] > 230 && corner[1] > 200 && corner[2] < 140 && middle[0] > 180 && middle[1] < 130, `corner ${corner}, middle ${middle}`);
    await window.__shot('recorte-comprimido');
  };

  parts.compressText = async (R) => {
    // Nothing to gain: never bigger than what was opened.
    const original = (await window.__file('texto.pdf')).size;
    R.ok('opens a text-only PDF', await open(['texto.pdf']));
    const out = await compressPdf('Leve');
    R.ok('never bigger than the original', out.blob && out.blob.size <= original, `${original} -> ${out.blob?.size}`);
    R.ok('says so plainly', /menor tamanho possível|−\d+%/.test(out.panel), out.panel.replace(/\s+/g, ' ').slice(0, 160));
    const runs = await textRunsOf(out.blob, 'texto-comprimido.pdf');
    R.ok('text kept', runs > 0, `${runs} text runs`);
  };

  parts.wide = async (R) => {
    R.ok('opens a 16400 px wide image', await open(['largo-16400.png']));
    const before = window.__dl.length;
    btn(/^Exportar/).click();
    await wait(400);
    const row = [...document.querySelectorAll('[role=menuitem]')].find((b) => /^WEBP/.test(text(b)));
    if (!row) {
      R.ok('WebP not offered here (no encoder)', true);
      return;
    }
    row.click();
    const banner = await until(() => text(document.querySelector('.error-banner')), 20000);
    R.ok('WebP over 16383 px explains itself instead of failing', /16383/.test(banner || '') && window.__dl.length === before, banner);
  };

  window.__runPart = async (name) => {
    const R = {
      part: name,
      checks: [],
      info: {},
      ok(label, pass, detail) {
        this.checks.push({ label, pass: !!pass, detail: detail === undefined ? undefined : String(detail).slice(0, 300) });
      },
    };
    window.__errorsQ.length = 0;
    try {
      await parts[name](R);
    } catch (err) {
      R.checks.push({ label: 'no exception', pass: false, detail: String(err?.stack || err).slice(0, 600) });
    }
    R.errors = [...window.__errorsQ];
    R.banner = text(document.querySelector('.error-banner')) || null;
    delete R.ok;
    return R;
  };
  window.__parts = Object.keys(parts);
})();
