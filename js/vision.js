// Elaborazione dell'immagine: individua la carta nella foto e prepara i ritagli per la lettura del testo.
// Funzioni pure su oggetti {data: Uint8ClampedArray RGBA, width, height}: girano nel browser e in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Vision = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function makeImage(width, height) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }

  // Ridimensionamento con media a blocchi (riduzione) o bilineare (ingrandimento)
  function resize(img, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const out = makeImage(w, h);
    const sx = img.width / w, sy = img.height / h;
    const s = img.data, d = out.data;
    if (sx >= 1.5 || sy >= 1.5) {
      for (let y = 0; y < h; y++) {
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * sy)));
        for (let x = 0; x < w; x++) {
          const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * sx)));
          let r = 0, g = 0, b = 0, n = 0;
          for (let yy = y0; yy < y1; yy++) {
            let p = (yy * img.width + x0) * 4;
            for (let xx = x0; xx < x1; xx++, p += 4) { r += s[p]; g += s[p + 1]; b += s[p + 2]; n++; }
          }
          const q = (y * w + x) * 4;
          d[q] = r / n; d[q + 1] = g / n; d[q + 2] = b / n; d[q + 3] = 255;
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
        const y0 = Math.floor(fy), y1 = Math.min(img.height - 1, y0 + 1), wy = fy - y0;
        for (let x = 0; x < w; x++) {
          const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
          const x0 = Math.floor(fx), x1 = Math.min(img.width - 1, x0 + 1), wx = fx - x0;
          const a = (y0 * img.width + x0) * 4, b = (y0 * img.width + x1) * 4;
          const c = (y1 * img.width + x0) * 4, e = (y1 * img.width + x1) * 4;
          const q = (y * w + x) * 4;
          for (let k = 0; k < 3; k++) {
            d[q + k] = (s[a + k] * (1 - wx) + s[b + k] * wx) * (1 - wy) + (s[c + k] * (1 - wx) + s[e + k] * wx) * wy;
          }
          d[q + 3] = 255;
        }
      }
    }
    return out;
  }

  function crop(img, x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.min(img.width - x, Math.round(w)); h = Math.min(img.height - y, Math.round(h));
    const out = makeImage(Math.max(1, w), Math.max(1, h));
    for (let yy = 0; yy < h; yy++) {
      const src = ((y + yy) * img.width + x) * 4;
      out.data.set(img.data.subarray(src, src + w * 4), yy * w * 4);
    }
    return out;
  }

  // Rotazione di un angolo piccolo (radianti) attorno al centro, interpolazione bilineare
  function rotate(img, angle) {
    if (Math.abs(angle) < 0.004) return img;
    const w = img.width, h = img.height, out = makeImage(w, h);
    const cs = Math.cos(angle), sn = Math.sin(angle), cx = w / 2, cy = h / 2;
    const s = img.data, d = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        let fx = cx + dx * cs - dy * sn, fy = cy + dx * sn + dy * cs;
        fx = Math.min(w - 1.001, Math.max(0, fx)); fy = Math.min(h - 1.001, Math.max(0, fy));
        const x0 = fx | 0, y0 = fy | 0, wx = fx - x0, wy = fy - y0;
        const a = (y0 * w + x0) * 4, b = a + 4, c = a + w * 4, e = c + 4, q = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          d[q + k] = (s[a + k] * (1 - wx) + s[b + k] * wx) * (1 - wy) + (s[c + k] * (1 - wx) + s[e + k] * wx) * wy;
        }
        d[q + 3] = 255;
      }
    }
    return out;
  }

  // Individua la carta: lo sfondo è stimato dai colori presenti lungo il bordo della foto.
  // Restituisce {x, y, w, h, angle, ok} in coordinate dell'immagine originale.
  function detectCard(img) {
    const W = 200, scale = img.width / W, H = Math.max(1, Math.round(img.height / scale));
    const sm = resize(img, W, H), p = sm.data;
    const bin = (i) => ((p[i] >> 4) << 8) | ((p[i + 1] >> 4) << 4) | (p[i + 2] >> 4);
    const hist = new Uint32Array(4096);
    const m = Math.max(2, Math.round(W * 0.04));
    let nb = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x < m || y < m || x >= W - m || y >= H - m) { hist[bin((y * W + x) * 4)]++; nb++; }
    }
    const bg = new Uint8Array(4096);
    for (let b = 0; b < 4096; b++) {
      if (hist[b] / nb < 0.002) continue;
      const r = b >> 8, g = (b >> 4) & 15, bl = b & 15;
      for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
        const rr = r + dr, gg = g + dg, bb = bl + db;
        if (rr < 0 || gg < 0 || bb < 0 || rr > 15 || gg > 15 || bb > 15) continue;
        bg[(rr << 8) | (gg << 4) | bb] = 1;
      }
    }
    let mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = bg[bin(i * 4)] ? 0 : 1;
    // chiusura e apertura morfologica 3x3 per togliere righe sottili e buchi
    const morph = (src, need) => {
      const dst = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += src[(y + dy) * W + x + dx];
        dst[y * W + x] = n >= need ? 1 : 0;
      }
      return dst;
    };
    mask = morph(mask, 5); mask = morph(mask, 5);
    // componente connessa più grande
    const lab = new Int32Array(W * H); let best = 0, bestN = 0, cur = 0;
    const stack = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!mask[i] || lab[i]) continue;
      cur++; let sp = 0, n = 0; stack[sp++] = i; lab[i] = cur;
      while (sp) {
        const j = stack[--sp]; n++;
        const x = j % W, y = (j / W) | 0;
        if (x > 0 && mask[j - 1] && !lab[j - 1]) { lab[j - 1] = cur; stack[sp++] = j - 1; }
        if (x < W - 1 && mask[j + 1] && !lab[j + 1]) { lab[j + 1] = cur; stack[sp++] = j + 1; }
        if (y > 0 && mask[j - W] && !lab[j - W]) { lab[j - W] = cur; stack[sp++] = j - W; }
        if (y < H - 1 && mask[j + W] && !lab[j + W]) { lab[j + W] = cur; stack[sp++] = j + W; }
      }
      if (n > bestN) { bestN = n; best = cur; }
    }
    const fail = { x: 0, y: 0, w: img.width, h: img.height, angle: 0, ok: false };
    if (bestN < W * H * 0.08) return fail;
    // estremi per riga e per colonna della componente
    const rowL = new Int32Array(H).fill(-1), rowR = new Int32Array(H).fill(-1), rowN = new Int32Array(H);
    const colN = new Int32Array(W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (lab[y * W + x] !== best) continue;
      if (rowL[y] < 0) rowL[y] = x; rowR[y] = x; rowN[y]++; colN[x]++;
    }
    const maxRow = Math.max.apply(null, rowN), maxCol = Math.max.apply(null, colN);
    let y0 = 0, y1 = H - 1, x0 = 0, x1 = W - 1;
    while (y0 < H && rowN[y0] < maxRow * 0.5) y0++;
    while (y1 > 0 && rowN[y1] < maxRow * 0.5) y1--;
    while (x0 < W && colN[x0] < maxCol * 0.5) x0++;
    while (x1 > 0 && colN[x1] < maxCol * 0.5) x1--;
    if (y1 <= y0 || x1 <= x0) return fail;
    // inclinazione: retta ai minimi quadrati sul bordo sinistro e destro (fascia centrale)
    const fit = (arr) => {
      const ya = Math.round(y0 + (y1 - y0) * 0.2), yb = Math.round(y0 + (y1 - y0) * 0.8);
      let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
      for (let y = ya; y <= yb; y++) { if (arr[y] < 0) continue; sx += y; sy += arr[y]; sxx += y * y; sxy += y * arr[y]; n++; }
      const den = n * sxx - sx * sx;
      return den ? (n * sxy - sx * sy) / den : 0;
    };
    let angle = Math.atan((fit(rowL) + fit(rowR)) / 2);
    if (Math.abs(angle) > 0.26) angle = 0; // oltre 15 gradi non mi fido della stima
    const box = { x: x0 * scale, y: y0 * scale, w: (x1 - x0 + 1) * scale, h: (y1 - y0 + 1) * scale, angle: -angle, ok: true };
    const ratio = box.w / box.h; // una carta è circa 63 x 88 mm = 0,716
    if (ratio < 0.58 || ratio > 0.88) box.ok = false;
    if (box.w < img.width * 0.25) box.ok = false;
    return box;
  }

  // Ritaglia la carta raddrizzata. Se la carta non è stata trovata usa il riquadro guida (frazioni dell'immagine).
  function extractCard(img, guide) {
    let box = detectCard(img);
    let used = 'auto';
    if (!box.ok) {
      used = guide ? 'guida' : 'intera';
      const g = guide || { x: 0, y: 0, w: 1, h: 1 };
      box = { x: g.x * img.width, y: g.y * img.height, w: g.w * img.width, h: g.h * img.height, angle: 0, ok: false };
    }
    // margine per non perdere il bordo quando la carta è inclinata
    const mx = box.w * 0.03, my = box.h * 0.03;
    let card = crop(img, box.x - mx, box.y - my, box.w + 2 * mx, box.h + 2 * my);
    if (box.angle) card = rotate(card, box.angle);
    return { card, box, used };
  }

  // Scala di grigi con estensione del contrasto; invert=true per testo chiaro su fondo scuro
  function toGray(img, invert) {
    const out = makeImage(img.width, img.height), s = img.data, d = out.data, n = img.width * img.height;
    const hist = new Uint32Array(256);
    const g = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = (s[i * 4] * 299 + s[i * 4 + 1] * 587 + s[i * 4 + 2] * 114) / 1000 | 0;
      g[i] = v; hist[v]++;
    }
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255; lo++) { acc += hist[lo]; if (acc > n * 0.02) break; }
    acc = 0;
    for (; hi > 0; hi--) { acc += hist[hi]; if (acc > n * 0.02) break; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) {
      let v = (g[i] - lo) * 255 / span;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (invert) v = 255 - v;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    return out;
  }

  // Binarizzazione adattiva (media locale): 'chiaro' tiene il testo chiaro, 'scuro' il testo scuro.
  // rFrac = raggio della finestra come frazione dell'altezza. Il risultato è testo nero su fondo bianco.
  function binarize(img, mode, rFrac, k) {
    const w = img.width, h = img.height, n = w * h, s = img.data;
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = (s[i * 4] * 299 + s[i * 4 + 1] * 587 + s[i * 4 + 2] * 114) / 1000;
    const W1 = w + 1, integ = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += g[y * w + x];
        integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row;
      }
    }
    const r = Math.max(4, Math.round(h * (rFrac || 0.12)));
    const out = makeImage(w, h), d = out.data;
    k = k || 0.08;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0]) / ((y1 - y0) * (x1 - x0));
        const v = g[y * w + x];
        const text = mode === 'chiaro' ? v > mean * (1 + k) + 4 : v < mean * (1 - k) - 4;
        const q = (y * w + x) * 4;
        d[q] = d[q + 1] = d[q + 2] = text ? 0 : 255; d[q + 3] = 255;
      }
    }
    return out;
  }

  // Ritaglia una zona della carta (frazioni del ritaglio) e la porta alla scala in cui
  // la carta intera sarebbe alta cardH pixel: cosi' la dimensione del testo non dipende dalla foto.
  function zone(card, z, cardH) {
    const c = crop(card, z.x * card.width, z.y * card.height, z.w * card.width, z.h * card.height);
    const k = cardH / card.height;
    return resize(c, c.width * k, c.height * k);
  }

  return { makeImage, resize, crop, rotate, detectCard, extractCard, toGray, binarize, zone };
});
