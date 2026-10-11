// Riconoscimento della carta: individua la carta nella foto, legge le fasce con nome e numero
// e abbina il testo all'indice. reader(imageData, filtro) -> Promise<[{text, conf, x, y, w, h}]>
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vision.js'), require('./match.js'));
  else root.Recog = factory(root.Vision, root.Match);
})(typeof self !== 'undefined' ? self : this, function (Vision, Match) {
  'use strict';

  const TOP_END = 0.16;    // fascia alta: nome e PS
  const BOT_START = 0.81;  // fascia bassa: debolezza, illustratore, sigla, numero
  const GAP = 24;
  const WIDTHS = [900, 1150]; // seconda lettura a scala diversa se la prima non basta

  const EVOLVE = /(si evolve|evolves from|evolution de|évolution de|entwickelt sich|evoluciona de|evolui de)/i;
  const LANG_WORDS = {
    it: ['debolezza', 'resistenza', 'ritirata'],
    en: ['weakness', 'resistance', 'retreat'],
    fr: ['faiblesse', 'retraite'],
    de: ['schwache', 'resistenz', 'ruckzug'],
    es: ['debilidad', 'resistencia', 'retirada'],
    pt: ['fraqueza', 'recuo']
  };
  const LANG_CODES = ['IT', 'EN', 'FR', 'DE', 'ES', 'PT'];

  // Unisce fascia alta e fascia bassa della carta in un'unica immagine da leggere
  function composite(card, W) {
    const k = W / card.width, H = Math.round(card.height * k);
    const sm = Vision.resize(card, W, H);
    const th = Math.round(H * TOP_END), by = Math.round(H * BOT_START), bh = H - by;
    const out = Vision.makeImage(W, th + GAP + bh);
    out.data.fill(128);
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    out.data.set(sm.data.subarray(0, th * W * 4), 0);
    out.data.set(sm.data.subarray(by * W * 4, (by + bh) * W * 4), (th + GAP) * W * 4);
    return { image: out, th, W };
  }

  // Ipotesi "numero|totale" da una riga letta. peso 1 = letta con la barra, 0.5 = ricostruita.
  function parseNumbers(text, hyps, numOnly) {
    const add = (n, t, w) => {
      const tot = parseInt(t, 10);
      if (!tot) return;
      const key = Match.numKey(n) + '|' + tot;
      hyps.set(key, Math.max(hyps.get(key) || 0, w));
    };
    const s = text.toUpperCase().replace(/[OQ](?=\d)|(?<=\d)[OQ]/g, '0');
    let m;
    // forma normale, con eventuale prefisso di lettere (TG12/TG30, GG35/GG70, SV001/SV122)
    const re = /([A-Z]{0,3}\d{1,3})\s?\/\s?([A-Z]{0,3})(\d{2,4})/g;
    while ((m = re.exec(s))) {
      const num = m[1], tot = m[3];
      add(num, tot.slice(0, 3), 1);
      if (tot.length > 3) add(num, tot.slice(0, 3), 1);        // "202/1827": stella letta come cifra
      if (tot.length >= 3) add(num, tot.slice(0, 2), 0.5);
      // prefisso di lettere letto insieme alla sigla: provo anche le sole cifre
      const digits = num.replace(/^[A-Z]+/, '');
      if (digits !== num) add(digits, tot.slice(0, 3), 0.5);
      // cifra spuria davanti al numero ("9202/182")
      if (/^\d{4}$/.test(num)) add(num.slice(1), tot.slice(0, 3), 0.5);
    }
    // barra letta come 7, 1 o persa: "0567191" -> 056/191
    const re2 = /(?<![\d\/])(\d{5,7})(?![\d\/])/g;
    while ((m = re2.exec(s))) {
      const d = m[1];
      for (let i = 1; i <= 3; i++) {
        for (const tl of [3, 2]) {
          if (i + 1 + tl === d.length && (d[i] === '7' || d[i] === '1')) add(d.slice(0, i), d.slice(i + 1), 0.5);
          if (i + tl === d.length && d.length <= 6) add(d.slice(0, i), d.slice(i), 0.3);
        }
      }
    }
    // promo senza totale: "SVP 045", "SWSH123", "SM210"
    const re3 = /\b(SVP|SWSH|SM|XY|BW|DP|HGSS)\s?(\d{1,3})\b/g;
    while ((m = re3.exec(s))) { numOnly.add(Match.numKey(m[1] + m[2])); numOnly.add(Match.numKey(m[2])); }
  }

  function buildEvidence(top, bottom, abbrSet) {
    const ev = { nameTexts: [], numHyps: new Map(), numOnly: new Set(), footTexts: [], abbrs: new Set(), lang: null, hps: new Set() };
    for (const l of top) {
      const t = l.text.trim();
      if (!t) continue;
      for (const m of t.match(/\d{2,3}/g) || []) ev.hps.add(parseInt(m, 10));
      if (EVOLVE.test(t)) continue;
      if (/^[\d\s+x×.,-]+$/.test(t)) continue;
      ev.nameTexts.push(t);
    }
    const votes = {};
    for (const l of bottom) {
      const t = l.text.trim();
      if (!t) continue;
      ev.footTexts.push(t);
      parseNumbers(t, ev.numHyps, ev.numOnly);
      const n = Match.norm(t).replace(/ /g, '');
      for (const lg of Object.keys(LANG_WORDS)) for (const w of LANG_WORDS[lg]) {
        if (n.length <= w.length + 3 && Match.similarity(w, n) >= 0.8) votes[lg] = (votes[lg] || 0) + 1;
      }
      // sigla dell'espansione, spesso letta attaccata alla lingua: "TEFIT", "PARIT", "SSPIT", "M24"
      const up = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (up.length >= 2 && up.length <= 7) {
        for (const a of abbrSet) {
          if (!up.startsWith(a)) continue;
          const rest = up.slice(a.length);
          if (rest === '' || rest.length <= 2) {
            ev.abbrs.add(a);
            if (LANG_CODES.indexOf(rest) >= 0) votes[rest.toLowerCase()] = (votes[rest.toLowerCase()] || 0) + 1.5;
          }
        }
      }
    }
    // "resistenza"/"resistencia" e "ritirata"/"retirada" si somigliano: la lingua vale solo
    // se ha almeno due indizi e stacca nettamente la seconda, altrimenti resta indefinita
    const ord = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
    if (ord.length && votes[ord[0]] >= 2 && (ord.length < 2 || votes[ord[0]] - votes[ord[1]] >= 1)) ev.lang = ord[0];
    return ev;
  }

  function mergeEvidence(a, b) {
    if (!a) return b;
    a.nameTexts = a.nameTexts.concat(b.nameTexts);
    a.footTexts = a.footTexts.concat(b.footTexts);
    for (const [k, v] of b.numHyps) a.numHyps.set(k, (a.numHyps.get(k) || 0) + v);
    for (const k of b.numOnly) a.numOnly.add(k);
    for (const k of b.abbrs) a.abbrs.add(k);
    for (const k of b.hps) a.hps.add(k);
    a.lang = a.lang || b.lang;
    return a;
  }

  async function recognize(img, reader, ix, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const progress = opts.onProgress || function () {};
    progress('Cerco la carta nella foto');
    const ex = Vision.extractCard(img, opts.guide);
    const auto = ex.used === 'auto';
    if (!ix.abbrSet) { ix.abbrSet = new Set(); for (const s of ix.sets) for (const a of s.abbr) if (a.length >= 2) ix.abbrSet.add(a); }
    let ev = null, res = { list: [], sure: false }, reads = 0, usedWhole = false, wholeArea = null;
    const raw = [];
    if (auto) {
      for (const W of WIDTHS) {
        progress(reads ? 'Rileggo con più dettaglio' : 'Leggo nome e numero');
        const comp = composite(ex.card, W);
        // Leggo solo le righe utili: la lettura costa circa un quarto di secondo per riga.
        // In alto il nome e i PS sono le scritte più grandi; in basso servono solo le righe corte
        // (numero, sigla, illustratore, debolezza/resistenza/ritirata), non regole e descrizioni.
        const lines = await reader(comp.image, (geos) => {
          const isTop = (g) => g.y + g.h / 2 < comp.th;
          const maxTop = Math.max(1, ...geos.filter(isTop).map((g) => g.h));
          return geos.map((g) => isTop(g) ? g.h >= maxTop * 0.5 : g.w <= W * 0.36);
        });
        reads++;
        const top = lines.filter((l) => l.y + l.h / 2 < comp.th);
        const bottom = lines.filter((l) => l.y + l.h / 2 >= comp.th);
        raw.push({ W, top: top.map((l) => l.text), bottom: bottom.map((l) => l.text) });
        ev = mergeEvidence(ev, buildEvidence(top, bottom, ix.abbrSet));
        res = Match.rank(ix, ev, { limit: 8 });
        if (res.sure) break;
      }
    }
    // Se la carta non è stata individuata, o le fasce non hanno dato un risultato sicuro
    // (foto molto ravvicinata, sfondo confuso), leggo tutta la foto e ricavo le fasce
    // dalla posizione del testo.
    if (!res.sure) {
      progress(auto ? 'Provo a leggere tutta la foto' : 'Leggo il testo della foto');
      const g = opts.guide || { x: 0, y: 0, w: 1, h: 1 };
      const area = Vision.crop(img, g.x * img.width, g.y * img.height, g.w * img.width, g.h * img.height);
      const k = Math.min(1, 1000 / area.width, 1500 / area.height);
      const whole = k < 1 ? Vision.resize(area, area.width * k, area.height * k) : area;
      const W = whole.width;
      const lines = await reader(whole, (geos) => geos.map((gg) => gg.w <= W * 0.6));
      reads++;
      if (lines.length) {
        const y0 = Math.min.apply(null, lines.map((l) => l.y)), y1 = Math.max.apply(null, lines.map((l) => l.y + l.h));
        const span = Math.max(1, y1 - y0);
        const top = lines.filter((l) => l.y + l.h / 2 < y0 + span * 0.22);
        const bottom = lines.filter((l) => l.y + l.h / 2 > y0 + span * 0.75);
        raw.push({ W, tutta: true, top: top.map((l) => l.text), bottom: bottom.map((l) => l.text) });
        const ev2 = buildEvidence(top, bottom, ix.abbrSet);
        const res2 = Match.rank(ix, ev2, { limit: 8 });
        const s1 = res.list.length ? res.list[0].score : 0, s2 = res2.list.length ? res2.list[0].score : 0;
        if (res2.sure || s2 > s1) { res = res2; ev = ev2; usedWhole = true; wholeArea = area; }
      }
    }
    return {
      list: res.list, sure: res.sure, lang: ev ? ev.lang : null, reads, ms: Date.now() - t0,
      detection: usedWhole ? 'foto intera' : ex.used, box: ex.box, card: usedWhole ? wholeArea : ex.card, raw,
      evidence: ev ? { nameTexts: ev.nameTexts, numHyps: [...ev.numHyps.entries()], abbrs: [...ev.abbrs], hps: [...ev.hps] } : null
    };
  }

  return { recognize, parseNumbers, composite };
});
