// Quotazioni: scarica i prezzi da TCGdex (Cardmarket in EUR, TCGplayer in USD) e sceglie quelli della variante posseduta.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Prices = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const API = 'https://api.tcgdex.net/v2/';
  const LANGS = ['en', 'it', 'fr', 'de', 'es', 'pt'];

  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

  // Scarica la scheda della carta. I prezzi non dipendono dalla lingua: provo l'inglese e,
  // se la carta non esiste in inglese, le altre lingue.
  async function fetchCard(cardId, fetchFn) {
    const f = fetchFn || fetch;
    let last = null;
    for (const lang of LANGS) {
      const res = await f(API + lang + '/cards/' + encodeURIComponent(cardId));
      if (res.ok) return res.json();
      last = res.status;
      if (res.status !== 404) break;
    }
    const e = new Error(last === 404 ? 'carta non presente nella fonte dei prezzi' : 'la fonte dei prezzi ha risposto ' + last);
    e.status = last;
    throw e;
  }

  // Sceglie i prezzi della variante (normal, holo, reverse) e dell'edizione ('prima' o altro).
  // Restituisce { eur: {min, media, tendenza, media7, media30, aggiornato, nota}, usd: {min, media, max, mercato, aggiornato, tipo}, scaricato }
  function extract(json, variant, edition) {
    const prima = edition === 'prima';
    const haPrima = (v) => (v.stamp || []).indexOf('1st-edition') >= 0;
    const conPrezzi = (v) => v.pricing && (v.pricing.cardmarket || v.pricing.tcgplayer);
    const vds = (json.variants_detailed || []).filter(conPrezzi);
    let pr = json.pricing || {};
    let nota = '';
    // la fonte può avere prezzi separati per variante e per prima edizione
    const vd = vds.find((v) => v.type === variant && haPrima(v) === prima) || (prima ? null : vds.find((v) => v.type === variant && !haPrima(v)));
    if (vd) pr = vd.pricing;
    else if (prima) nota = 'La fonte non ha un prezzo separato per la prima edizione: questo è quello dell\'edizione illimitata.';

    let eur = null;
    const cm = pr.cardmarket;
    if (cm) {
      // nei dati Cardmarket i campi "-holo" sono i prezzi della versione reverse holo
      const base = { min: num(cm.low), media: num(cm.avg), tendenza: num(cm.trend), media7: num(cm.avg7), media30: num(cm.avg30) };
      const rev = { min: num(cm['low-holo']), media: num(cm['avg-holo']), tendenza: num(cm['trend-holo']), media7: num(cm['avg7-holo']), media30: num(cm['avg30-holo']) };
      const pieno = (o) => o.min !== null || o.media !== null || o.tendenza !== null;
      let scelta = base;
      if (variant === 'reverse') {
        if (pieno(rev)) scelta = rev;
        else if (pieno(base)) nota = nota || 'Cardmarket non ha un prezzo per la versione reverse: questo è quello della versione normale.';
      } else if (!pieno(base) && pieno(rev)) scelta = rev;
      if (pieno(scelta)) {
        // se manca la media uso la tendenza, e lo dichiaro
        if (scelta.media === null && scelta.tendenza !== null) { scelta = Object.assign({}, scelta, { media: scelta.tendenza }); nota = nota || 'Media non disponibile: è indicato il prezzo di tendenza.'; }
        eur = Object.assign({ aggiornato: cm.updated || null }, scelta);
      }
    }

    let usd = null;
    const tp = pr.tcgplayer;
    if (tp) {
      const tipi = Object.keys(tp).filter((k) => tp[k] && typeof tp[k] === 'object');
      const ordine = { normal: ['normal', 'unlimited'], holo: ['holofoil', 'unlimited-holofoil'], reverse: ['reverse-holofoil'] }[variant] || [];
      const cerca = prima ? ['1st-edition-' + (variant === 'holo' ? 'holofoil' : 'normal'), '1st-edition-holofoil', '1st-edition'].concat(ordine) : ordine;
      let tipo = cerca.find((k) => tipi.indexOf(k) >= 0);
      if (!tipo && tipi.length === 1) tipo = tipi[0];
      if (tipo) {
        const t = tp[tipo];
        usd = { min: num(t.lowPrice), media: num(t.midPrice), max: num(t.highPrice), mercato: num(t.marketPrice), aggiornato: tp.updated || null, tipo };
        if (usd.min === null && usd.media === null && usd.max === null) usd = null;
      }
    }
    return { eur, usd, nota, variante: variant, edizione: edition || '', scaricato: new Date().toISOString() };
  }

  // Valore unitario in EUR usato per i totali: il prezzo corretto a mano, altrimenti la media Cardmarket
  function value(item) {
    if (typeof item.manualPrice === 'number' && item.manualPrice >= 0) return { eur: item.manualPrice, fonte: 'manuale' };
    if (item.prices && item.prices.eur && item.prices.eur.media !== null) return { eur: item.prices.eur.media, fonte: 'media' };
    return { eur: null, fonte: null };
  }

  const fEUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
  const fUSD = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' });
  const eur = (v) => (v === null || v === undefined ? 'n.d.' : fEUR.format(v));
  const usd = (v) => (v === null || v === undefined ? 'n.d.' : fUSD.format(v));
  const day = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('it-IT'); };

  return { fetchCard, extract, value, eur, usd, day };
});
