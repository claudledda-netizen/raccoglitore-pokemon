// Indice delle carte e abbinamento tra il testo letto dalla foto e le carte conosciute.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Match = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LANG_ORDER = ['en', 'it', 'fr', 'de', 'es', 'pt'];
  const LANG_NAMES = { it: 'Italiano', en: 'Inglese', fr: 'Francese', de: 'Tedesco', es: 'Spagnolo', pt: 'Portoghese' };
  // suffissi di meccanica che l'OCR legge male perché stampati come simboli
  const SUFFIX = /\b(ex|gx|v|vmax|vstar|v astro|vastro|v union|vunion|break|lv x|lv\.x|prime|legend|star|tag team)\b/g;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  const compact = (s) => norm(s).replace(/ /g, '');
  const coreName = (s) => norm(s).replace(SUFFIX, ' ').replace(/ +/g, ' ').trim();
  const numKey = (s) => { s = String(s).toUpperCase().trim(); return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s; };

  // Distanza minima di modifica tra il nome e una qualsiasi sottostringa del testo (algoritmo di Sellers)
  function substringDistance(pattern, text) {
    const m = pattern.length, n = text.length;
    if (!m) return 0;
    let prev = new Uint16Array(n + 1), cur = new Uint16Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      const pc = pattern.charCodeAt(i - 1);
      for (let j = 1; j <= n; j++) {
        const cost = pc === text.charCodeAt(j - 1) ? 0 : 1;
        const a = prev[j - 1] + cost, b = prev[j] + 1, c = cur[j - 1] + 1;
        cur[j] = a < b ? (a < c ? a : c) : (b < c ? b : c);
      }
      const t = prev; prev = cur; cur = t;
    }
    let best = m;
    for (let j = 0; j <= n; j++) if (prev[j] < best) best = prev[j];
    return best;
  }

  function similarity(name, text) {
    if (!name || !text) return 0;
    if (name.length <= 4) {
      // nomi molto corti: solo corrispondenza esatta di una parola intera
      return (' ' + text + ' ').indexOf(' ' + name + ' ') >= 0 ? 1 : 0;
    }
    const p = name.replace(/ /g, ''), t = text.replace(/ /g, '');
    return Math.max(0, 1 - substringDistance(p, t) / p.length);
  }

  function build(raw) {
    const sets = raw.sets.map((s) => ({ id: s.id, serie: s.s, name: s.n, official: s.o, date: s.d, abbr: s.a || [], count: s.c }));
    const cards = raw.cards.map((c, i) => {
      const set = sets[c[0]];
      const names = c[2];
      return {
        i, set, localId: c[1], id: set.id + '-' + c[1], names,
        hp: c[3] || 0, rarity: c[4] >= 0 ? raw.rar[c[4]] : '',
        variants: c[5] ? c[5].split(',') : [],
        illustrator: c[6] >= 0 ? raw.ill[c[6]] : '',
        attacks: c[7] || [],
        langs: LANG_ORDER.filter((l, bi) => (c[8] || 0) & (1 << bi))
      };
    });
    const byNum = new Map();      // "numero|totale" -> carte
    const byNumOnly = new Map();  // "numero" -> carte
    const nameMap = new Map();    // nome normalizzato -> {full, core, cards:Set}
    for (const c of cards) {
      const nk = numKey(c.localId);
      if (c.set.official) {
        const k = nk + '|' + c.set.official;
        if (!byNum.has(k)) byNum.set(k, []);
        byNum.get(k).push(c);
      }
      if (!byNumOnly.has(nk)) byNumOnly.set(nk, []);
      byNumOnly.get(nk).push(c);
      c.normNames = {};
      for (const l of Object.keys(c.names)) {
        const full = norm(c.names[l]);
        c.normNames[l] = full;
        if (!nameMap.has(full)) nameMap.set(full, { full, core: coreName(c.names[l]), cards: [] });
        nameMap.get(full).cards.push(c);
      }
    }
    // indice a trigrammi sui nomi "nucleo" per la ricerca approssimata
    const nameList = [...nameMap.values()];
    const tri = new Map();
    nameList.forEach((e, idx) => {
      const s = e.core.replace(/ /g, '');
      const seen = new Set();
      for (let k = 0; k + 3 <= s.length; k++) {
        const g = s.substr(k, 3);
        if (seen.has(g)) continue; seen.add(g);
        if (!tri.has(g)) tri.set(g, []);
        tri.get(g).push(idx);
      }
    });
    return { sets, cards, byNum, byNumOnly, nameMap, nameList, tri, built: raw.built };
  }

  // Ricerca approssimata dei nomi presenti in un testo letto
  function findNames(ix, text, limit) {
    const t = norm(text), tc = t.replace(/ /g, '');
    if (tc.length < 3) return [];
    const votes = new Map();
    const seen = new Set();
    for (let k = 0; k + 3 <= tc.length; k++) {
      const g = tc.substr(k, 3);
      if (seen.has(g)) continue; seen.add(g);
      const l = ix.tri.get(g);
      if (!l) continue;
      for (const idx of l) votes.set(idx, (votes.get(idx) || 0) + 1);
    }
    const cand = [...votes.entries()]
      .map(([idx, v]) => ({ e: ix.nameList[idx], v, frac: v / Math.max(1, ix.nameList[idx].core.replace(/ /g, '').length - 2) }))
      .filter((x) => x.frac >= 0.34)
      .sort((a, b) => b.frac - a.frac || b.v - a.v).slice(0, 60);
    const out = [];
    for (const c of cand) {
      const sc = nameScore(c.e, t);
      if (sc.sim >= 0.7) out.push({ entry: c.e, sim: sc.sim, len: sc.len });
    }
    // i nomi corti letti per intero (es. "Mew") non hanno trigrammi sufficienti: li cerco come parole
    for (const w of new Set(t.split(' '))) {
      if (w.length < 3 || w.length > 4) continue;
      for (const e of ix.nameList) if (e.core === w) out.push({ entry: e, sim: 1, len: w.length });
    }
    out.sort((a, b) => b.sim * b.len - a.sim * a.len);
    return out.slice(0, limit || 12);
  }

  function nameScore(entry, normText) {
    const sFull = similarity(entry.full, normText);
    const sCore = entry.core && entry.core !== entry.full ? similarity(entry.core, normText) * 0.92 : 0;
    return sFull >= sCore ? { sim: sFull, len: entry.full.replace(/ /g, '').length } : { sim: sCore, len: entry.core.replace(/ /g, '').length };
  }

  function bestNameSim(card, normTexts) {
    let best = 0, lang = null;
    for (const l of Object.keys(card.normNames)) {
      const full = card.normNames[l], core = coreName(card.names[l]);
      for (const t of normTexts) {
        const s = Math.max(similarity(full, t), core !== full ? similarity(core, t) * 0.92 : 0);
        if (s > best) { best = s; lang = l; }
      }
    }
    return { sim: best, lang };
  }

  // Classifica le carte candidate in base alle prove raccolte dalla lettura.
  // ev = { nameTexts, numHyps: Map("num|tot" -> peso), numOnly: Set, footTexts, abbrs: Set, hps: Set }
  function rank(ix, ev, opts) {
    opts = opts || {};
    const nameTexts = (ev.nameTexts || []).map(norm).filter(Boolean);
    const footTexts = (ev.footTexts || []).map(norm).filter(Boolean);
    const cand = new Map();
    const add = (c) => { if (!cand.has(c.i)) cand.set(c.i, { card: c, numVotes: 0 }); return cand.get(c.i); };
    const hyps = ev.numHyps ? [...ev.numHyps.entries()] : [];
    for (const [key, votes] of hyps) {
      const hit = ix.byNum.get(key);
      if (hit) for (const c of hit) add(c).numVotes += votes;
    }
    for (const t of nameTexts) {
      for (const f of findNames(ix, t, 10)) for (const c of f.entry.cards) add(c);
    }
    // numeri letti, anche senza totale: servono a scegliere tra le stampe trovate dal nome
    const hypNums = new Set(ev.numOnly || []);
    for (const [key] of hyps) hypNums.add(key.split('|')[0]);
    const hps = ev.hps || new Set();
    const abbrs = ev.abbrs || new Set();
    const out = [];
    for (const o of cand.values()) {
      const c = o.card;
      const ns = bestNameSim(c, nameTexts);
      let score = 0; const why = [];
      if (o.numVotes) { score += 34 + Math.min(12, o.numVotes * 6); why.push('numero ' + c.localId + '/' + c.set.official); }
      else if (hypNums.has(numKey(c.localId))) { score += 14; why.push('numero ' + c.localId); }
      if (ns.sim >= 0.6) { score += 50 * ns.sim; why.push('nome'); }
      if (c.hp && hps.has(c.hp)) { score += 8; why.push('PS ' + c.hp); }
      if (c.illustrator) {
        const il = norm(c.illustrator);
        if (il.length >= 5 && footTexts.some((t) => similarity(il, t) >= 0.8)) { score += 6; why.push('illustratore'); }
      }
      if (c.set.abbr.some((a) => abbrs.has(a))) { score += 10; why.push('sigla ' + c.set.abbr.find((a) => abbrs.has(a))); }
      if (score < 20) continue;
      out.push({ card: c, score, why, nameSim: ns.sim, lang: ns.sim >= 0.6 ? ns.lang : null, numExact: !!o.numVotes, numVotes: o.numVotes });
    }
    out.sort((a, b) => b.score - a.score || (b.card.set.date || '').localeCompare(a.card.set.date || ''));
    const top = out[0], second = out[1];
    // "sicuro": numero e nome concordano e il distacco dal secondo è netto
    // (un numero ricostruito, cioè letto senza barra, vale solo se anche la sigla dell'espansione concorda)
    const numSolid = !!top && (top.numVotes >= 1 || top.why.some((w) => w.indexOf('sigla') === 0));
    const sure = !!top && top.numExact && numSolid && top.nameSim >= 0.7 && (!second || top.score - second.score >= 12);
    return { list: out.slice(0, opts.limit || 8), sure };
  }

  // Ricerca manuale per nome o numero (campo di ricerca dell'app)
  function search(ix, query, limit) {
    const q = norm(query);
    if (!q) return [];
    const m = query.match(/([A-Za-z]{0,3}\d{1,3})\s*\/\s*(\d{2,3})/);
    if (m) return (ix.byNum.get(numKey(m[1]) + '|' + parseInt(m[2], 10)) || []).slice(0, limit || 40);
    const res = [];
    for (const e of ix.nameList) {
      if (e.full.indexOf(q) >= 0) for (const c of e.cards) res.push(c);
      if (res.length > 400) break;
    }
    const uniq = [...new Set(res)];
    uniq.sort((a, b) => (b.set.date || '').localeCompare(a.set.date || ''));
    return uniq.slice(0, limit || 40);
  }

  function imageUrl(card, lang, quality) {
    return 'https://assets.tcgdex.net/' + (lang || 'en') + '/' + card.set.serie + '/' + card.set.id + '/' + card.localId + '/' + (quality || 'low') + '.webp';
  }
  function displayName(card, lang) { return card.names[lang] || card.names.en || card.names[Object.keys(card.names)[0]]; }
  function setName(set, lang) { return (lang === 'it' && set.name.it) || set.name.en || set.name.it || set.id; }

  return { build, rank, search, findNames, norm, numKey, similarity, imageUrl, displayName, setName, LANG_NAMES };
});
