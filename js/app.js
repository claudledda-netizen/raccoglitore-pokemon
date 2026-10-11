// Interfaccia dell'app: scatto, riconoscimento, conferma con menu a tendina, collezione.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, props, kids) => {
    const n = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    }
    for (const c of kids || []) if (c) n.appendChild(c);
    return n;
  };

  const LINGUE = [['it', 'Italiano'], ['en', 'Inglese'], ['fr', 'Francese'], ['de', 'Tedesco'], ['es', 'Spagnolo'], ['pt', 'Portoghese'], ['ja', 'Giapponese'], ['xx', 'Altra lingua']];
  const VARIANTI = { normal: 'Normale', holo: 'Holo', reverse: 'Reverse holo', lenticular: 'Lenticolare', metal: 'Metallo' };
  const CONDIZIONI = [['M', 'Mint'], ['NM', 'Near Mint'], ['EX', 'Excellent'], ['GD', 'Good'], ['LP', 'Light Played'], ['PL', 'Played'], ['PO', 'Poor']];
  const nomeLingua = (c) => (LINGUE.find((l) => l[0] === c) || [c, c])[1];
  const nomeCondizione = (c) => (CONDIZIONI.find((l) => l[0] === c) || [c, c])[1];

  let IX = null;            // indice delle carte
  let corrente = null;      // carta in fase di conferma: {card, photoBlob, photoUrl, result}
  let ritornoRicerca = 'scansiona';
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('prefs') || '{}'); } catch (e) { return {}; } })();
  const salvaPrefs = () => { try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch (e) { /* senza memoria locale si riparte dai valori predefiniti */ } };

  // ---------- viste ----------
  const VISTE = ['scansiona', 'lettura', 'conferma', 'ricerca', 'collezione', 'esporta'];
  function mostra(v) {
    for (const n of VISTE) $('vista-' + n).hidden = n !== v;
    for (const b of document.querySelectorAll('.navigazione button')) {
      const attiva = b.dataset.vista === (v === 'collezione' || v === 'esporta' ? v : 'scansiona');
      if (attiva) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
    if (v === 'collezione') disegnaCollezione();
    if (v === 'esporta') disegnaEsporta();
  }
  let avvisoTimer = null;
  function avviso(testo, errore) {
    const a = $('avviso');
    a.textContent = testo; a.className = 'avviso' + (errore ? ' errore' : ''); a.hidden = false;
    clearTimeout(avvisoTimer);
    avvisoTimer = setTimeout(() => { a.hidden = true; }, errore ? 7000 : 3500);
  }

  // ---------- immagini ----------
  // ripiego: funzione che restituisce cosa mostrare se l'immagine ufficiale non si carica
  function immagineUfficiale(card, lang, qualita, ripiego) {
    // provo la lingua della carta, poi l'inglese, poi un segnaposto con il nome
    const prove = [];
    if (lang && card.langs.indexOf(lang) >= 0) prove.push(lang);
    if (prove.indexOf('en') < 0 && card.langs.indexOf('en') >= 0) prove.push('en');
    for (const l of card.langs) if (prove.indexOf(l) < 0) prove.push(l);
    const box = el('div', { class: 'ufficiale-dentro', style: 'display:contents' });
    const img = el('img', { alt: 'Immagine ufficiale di ' + Match.displayName(card, lang), loading: 'lazy' });
    let i = 0;
    const prossima = () => {
      if (i >= prove.length) {
        box.replaceChildren((ripiego && ripiego()) || el('div', { class: 'segnaposto', text: 'Immagine non disponibile' }));
        return;
      }
      img.src = Match.imageUrl(card, prove[i++], qualita || 'low');
    };
    img.addEventListener('error', prossima);
    box.appendChild(img);
    prossima();
    return box;
  }

  async function fileToImageData(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const MAX = 2200;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return ctx.getImageData(0, 0, c.width, c.height);
  }
  function imageToBlob(img, maxH) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    let out = c;
    if (img.height > maxH) {
      out = document.createElement('canvas');
      out.height = maxH; out.width = Math.round(img.width * maxH / img.height);
      const ctx = out.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(c, 0, 0, out.width, out.height);
    }
    return new Promise((res) => out.toBlob(res, 'image/jpeg', 0.86));
  }

  // ---------- quotazioni ----------
  const rispostePrezzi = new Map(); // cardId -> Promise della scheda scaricata
  function scaricaPrezzi(cardId, forza) {
    if (forza || !rispostePrezzi.has(cardId)) {
      const p = Prices.fetchCard(cardId);
      p.catch(() => { if (rispostePrezzi.get(cardId) === p) rispostePrezzi.delete(cardId); });
      rispostePrezzi.set(cardId, p);
    }
    return rispostePrezzi.get(cardId);
  }
  function messaggioPrezzi(e) {
    if (!navigator.onLine) return 'Quotazione non disponibile: il telefono è senza rete.';
    if (e && e.status === 404) return 'Questa carta non è presente nella fonte dei prezzi.';
    return 'Quotazione non scaricata: ' + (e && e.message ? e.message : 'errore di rete') + '.';
  }
  // Tre cartellini: minimo e media da Cardmarket in euro, massimo da TCGplayer in dollari
  function bloccoQuotazione(pr) {
    if (!pr || (!pr.eur && !pr.usd)) return el('div', { class: 'quotazione' }, [el('p', { class: 'quotazione-stato', text: 'Nessuna quotazione trovata per questa carta e variante.' })]);
    const cella = (nome, valore, fonte, cls) => el('div', { class: 'cella' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'cella-nome', text: nome }), el('span', { class: 'cella-valore', text: valore }), el('span', { class: 'cella-fonte', text: fonte })
    ]);
    const note = [];
    const quando = [pr.eur && pr.eur.aggiornato ? 'Cardmarket del ' + Prices.day(pr.eur.aggiornato) : '', pr.usd && pr.usd.aggiornato ? 'TCGplayer del ' + Prices.day(pr.usd.aggiornato) : ''].filter(Boolean).join(', ');
    if (quando) note.push('Prezzi ' + quando + '.');
    if (pr.eur && pr.eur.tendenza !== null) note.push('Tendenza Cardmarket ' + Prices.eur(pr.eur.tendenza) + '.');
    if (pr.nota) note.push(pr.nota);
    return el('div', { class: 'quotazione' }, [
      el('div', { class: 'quotazione-celle' }, [
        cella('Minimo', Prices.eur(pr.eur ? pr.eur.min : null), 'Cardmarket'),
        cella('Media', Prices.eur(pr.eur ? pr.eur.media : null), 'Cardmarket', 'cella-media'),
        cella('Massimo', Prices.usd(pr.usd ? pr.usd.max : null), 'TCGplayer')
      ]),
      el('p', { class: 'quotazione-nota', text: note.join(' ') })
    ]);
  }
  function testoValore(item) {
    const v = Prices.value(item);
    if (v.eur === null) return 'Senza quotazione in euro: questa carta non entra nel valore della collezione finché non inserisci un prezzo a mano.';
    const q = item.qty || 1;
    return 'Valore usato: ' + Prices.eur(v.eur) + ' a carta (' + (v.fonte === 'manuale' ? 'prezzo corretto a mano' : 'media Cardmarket') + ')' + (q > 1 ? ', ' + Prices.eur(v.eur * q) + ' per ' + q + ' copie.' : '.');
  }
  // Quotazione nella schermata di conferma: si aggiorna quando cambiano carta, variante o edizione
  async function quotazioneConferma() {
    const box = $('conferma-quotazione');
    if (!corrente || !corrente.card) { box.replaceChildren(); return; }
    const card = corrente.card, variante = $('f-variante').value;
    const edizione = $('riga-edizione').hidden ? '' : $('f-edizione').value;
    corrente.prezzi = null;
    if (!variante) { box.replaceChildren(el('p', { class: 'quotazione-stato', text: 'Scegli la variante per vedere la quotazione.' })); return; }
    box.replaceChildren(el('p', { class: 'quotazione-stato', text: 'Cerco la quotazione' }));
    try {
      const json = await scaricaPrezzi(card.id);
      if (!corrente || corrente.card !== card || $('f-variante').value !== variante) return; // nel frattempo è cambiata la scelta
      corrente.prezzi = Prices.extract(json, variante, edizione);
      box.replaceChildren(bloccoQuotazione(corrente.prezzi));
    } catch (e) {
      if (corrente && corrente.card === card) box.replaceChildren(el('p', { class: 'quotazione-stato', text: messaggioPrezzi(e) + ' Puoi aggiungere la carta lo stesso e aggiornare la quotazione dopo.' }));
    }
  }
  // Scarica e salva la quotazione di una carta già in collezione
  async function aggiornaPrezziDi(item, forza) {
    const json = await scaricaPrezzi(item.cardId, forza);
    item.prices = Prices.extract(json, item.variant, item.edition);
    const attuale = await Store.get(item.id);
    if (!attuale) return null; // tolta nel frattempo
    attuale.prices = item.prices;
    await Store.put(attuale);
    return item.prices;
  }

  // ---------- menu a tendina ----------
  function riempi(select, voci, valore, segnaposto) {
    select.replaceChildren();
    if (segnaposto) select.appendChild(el('option', { value: '', text: segnaposto }));
    for (const [v, t] of voci) select.appendChild(el('option', { value: v, text: t }));
    select.value = valore != null && voci.some((x) => x[0] === valore) ? valore : (segnaposto ? '' : voci[0][0]);
  }
  function vociVariante(card) {
    const v = card.variants.filter((x) => x !== '1ed');
    const lista = v.length ? v : ['normal', 'holo', 'reverse'];
    return lista.map((x) => [x, VARIANTI[x] || x]);
  }
  const vociQuantita = () => Array.from({ length: 99 }, (_, i) => [String(i + 1), String(i + 1)]);

  // ---------- riconoscimento ----------
  async function elabora(file) {
    if (!file) return;
    if (!IX) { avviso('Sto ancora caricando l\'elenco delle carte. Riprova tra un momento.', true); return; }
    const url = URL.createObjectURL(file);
    $('lettura-foto').src = url;
    $('lettura-stato').textContent = 'Preparo la foto';
    mostra('lettura');
    try {
      const img = await fileToImageData(file);
      if (OcrEngine.state.phase !== 'pronto') $('lettura-stato').textContent = 'Scarico il lettore (solo la prima volta)';
      await OcrEngine.load();
      const r = await Recog.recognize(img, OcrEngine.read, IX, { onProgress: (t) => { $('lettura-stato').textContent = t; } });
      const blob = await imageToBlob(r.card, 900);
      apriConferma({ result: r, photoBlob: blob, card: r.list.length ? r.list[0].card : null });
    } catch (e) {
      console.error(e);
      avviso('Non sono riuscito a leggere la foto: ' + (e && e.message ? e.message : e), true);
      mostra('scansiona');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function apriConferma(stato) {
    if (corrente && corrente.photoUrl) URL.revokeObjectURL(corrente.photoUrl);
    corrente = stato;
    corrente.photoUrl = stato.photoBlob ? URL.createObjectURL(stato.photoBlob) : '';
    $('conferma-foto').src = corrente.photoUrl;
    $('confronto').hidden = false;
    $('conferma-foto').parentElement.hidden = !stato.photoBlob;
    const r = stato.result;
    if (!stato.card) {
      // nessuna carta trovata: si passa alla ricerca a mano tenendo la foto
      $('conferma-titolo').textContent = 'Non ho riconosciuto la carta';
      $('scheda').replaceChildren(el('p', { class: 'scheda-riga', text: 'Il nome o il numero non si leggono abbastanza bene. Puoi cercarla a mano: la foto resta allegata.' }));
      $('conferma-ufficiale').replaceChildren(el('div', { class: 'segnaposto', text: 'Nessuna carta trovata' }));
      $('candidati').replaceChildren();
      $('modulo').hidden = true;
      $('conferma-quotazione').replaceChildren();
      mostra('conferma');
      return;
    }
    $('modulo').hidden = false;
    $('conferma-titolo').textContent = r ? (r.sure ? 'È questa la tua carta?' : 'Controlla: non sono sicuro') : 'Completa i dati della carta';
    disegnaScheda();
    disegnaCandidati();
    mostra('conferma');
  }

  function linguaIniziale(card) {
    const r = corrente.result;
    const voce = r && r.list.find((x) => x.card === card);
    return (r && r.lang) || (voce && voce.lang && card.names[voce.lang] && voce.lang !== 'en' ? voce.lang : null) || prefs.lingua || 'it';
  }

  function disegnaScheda() {
    const card = corrente.card, r = corrente.result;
    const lang = corrente.lingua || linguaIniziale(card);
    corrente.lingua = lang;
    $('conferma-ufficiale').replaceChildren(immagineUfficiale(card, lang, 'high'));
    const voce = r && r.list.find((x) => x.card === card);
    const prove = voce ? el('p', { class: 'scheda-prove' + (r.sure && voce === r.list[0] ? '' : ' incerta'), text: 'Riconosciuta da: ' + voce.why.join(', ') }) : null;
    $('scheda').replaceChildren(...[
      el('p', { class: 'scheda-nome', text: Match.displayName(card, lang) }),
      el('p', { class: 'scheda-riga' }, [
        el('span', { class: 'scheda-numero', text: card.localId + (card.set.official ? '/' + card.set.official : '') }),
        document.createTextNode('  ' + Match.setName(card.set, 'it') + (card.rarity && card.rarity !== 'None' ? ', ' + card.rarity : ''))
      ]),
      prove
    ].filter(Boolean));
    riempi($('f-lingua'), LINGUE, lang);
    const vv = vociVariante(card);
    riempi($('f-variante'), vv, vv.length === 1 ? vv[0][0] : null, vv.length === 1 ? null : 'Scegli la variante');
    $('riga-edizione').hidden = card.variants.indexOf('1ed') < 0;
    $('f-edizione').value = 'illimitata';
    riempi($('f-condizione'), CONDIZIONI, prefs.condizione || 'NM');
    riempi($('f-quantita'), vociQuantita(), '1');
    quotazioneConferma();
  }

  function rigaCandidato(card, lang, scelto, onClick, extra) {
    const mini = el('div', { class: 'miniatura' }, [immagineUfficiale(card, lang, 'low')]);
    return el('button', { type: 'button', class: 'candidato', 'aria-pressed': scelto ? 'true' : 'false', onclick: onClick }, [
      mini,
      el('div', null, [
        el('strong', { text: Match.displayName(card, lang) }),
        el('span', { text: card.localId + (card.set.official ? '/' + card.set.official : '') + '  ' + Match.setName(card.set, 'it') + (extra ? '  ' + extra : '') })
      ])
    ]);
  }

  function disegnaCandidati() {
    const r = corrente.result, box = $('candidati');
    box.replaceChildren();
    if (!r || r.list.length < 2) return;
    // se sono sicuro mostro le alternative solo su richiesta
    const lista = r.list.slice(0, 6);
    const titolo = el('p', { text: r.sure ? 'Altre carte simili' : 'Quale di queste è la tua?' });
    const righe = lista.map((x) => rigaCandidato(x.card, corrente.lingua, x.card === corrente.card, () => {
      corrente.card = x.card; corrente.lingua = null; disegnaScheda(); disegnaCandidati();
    }));
    if (r.sure) {
      const apri = el('button', { type: 'button', class: 'pulsante pulsante-testo', text: 'Mostra carte simili', onclick: () => { box.replaceChildren(titolo, ...righe); } });
      box.appendChild(apri);
    } else {
      box.replaceChildren(titolo, ...righe);
    }
  }

  async function salvaCarta(ev) {
    ev.preventDefault();
    if (!corrente || !corrente.card) return;
    const c = corrente.card, lang = $('f-lingua').value;
    const voce = corrente.result && corrente.result.list.find((x) => x.card === c);
    const item = {
      cardId: c.id, setId: c.set.id, localId: c.localId,
      name: Match.displayName(c, lang), nameEn: c.names.en || '',
      setName: Match.setName(c.set, 'it'), setTotal: c.set.official || null, rarity: c.rarity || '',
      lang, variant: $('f-variante').value,
      edition: $('riga-edizione').hidden ? '' : $('f-edizione').value,
      condition: $('f-condizione').value, qty: parseInt($('f-quantita').value, 10) || 1,
      photo: corrente.photoBlob || null, addedAt: new Date().toISOString(),
      recog: corrente.result ? { sure: !!(corrente.result.sure && voce === corrente.result.list[0]), why: voce ? voce.why : ['scelta a mano'] } : { sure: false, why: ['scelta a mano'] },
      prices: corrente.prezzi || null, manualPrice: null
    };
    try {
      item.id = await Store.add(item);
    } catch (e) {
      console.error(e);
      avviso('Non sono riuscito a salvare la carta sul telefono: ' + (e && e.message ? e.message : e), true);
      return;
    }
    prefs.lingua = lang; prefs.condizione = item.condition; salvaPrefs();
    if (corrente.photoUrl) URL.revokeObjectURL(corrente.photoUrl);
    corrente = null;
    await aggiornaConto();
    avviso('Aggiunta alla collezione: ' + item.name);
    // se la quotazione non era ancora arrivata la recupero in sottofondo
    if (!item.prices) aggiornaPrezziDi(item, false).then(aggiornaConto).catch(() => {});
    mostra('scansiona');
  }

  // ---------- ricerca a mano ----------
  function apriRicerca(ritorno) {
    ritornoRicerca = ritorno;
    const sel = $('r-espansione');
    if (sel.options.length <= 1) {
      const sets = IX.sets.filter((s) => s.count > 0).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const s of sets) {
        sel.appendChild(el('option', { value: s.id, text: Match.setName(s, 'it') + (s.abbr[0] ? ' (' + s.abbr[0] + ')' : '') + (s.date ? ', ' + s.date.slice(0, 4) : '') }));
      }
    }
    $('r-testo').value = ''; $('r-risultati').replaceChildren();
    mostra('ricerca');
  }
  function scegliDaRicerca(card) {
    apriConferma({ result: null, photoBlob: corrente ? corrente.photoBlob : null, card });
  }
  function ricercaEspansione() {
    const id = $('r-espansione').value, num = $('r-numero');
    num.replaceChildren(el('option', { value: '', text: id ? 'Scegli il numero' : 'Scegli prima l\'espansione' }));
    num.disabled = !id;
    if (!id) return;
    const cards = IX.cards.filter((c) => c.set.id === id).sort((a, b) => a.localId.localeCompare(b.localId, 'it', { numeric: true }));
    for (const c of cards) num.appendChild(el('option', { value: String(c.i), text: c.localId + '  ' + Match.displayName(c, prefs.lingua || 'it') }));
  }
  function ricercaTesto() {
    const q = $('r-testo').value.trim(), box = $('r-risultati');
    box.replaceChildren();
    if (q.length < 2) return;
    const res = Match.search(IX, q, 30);
    if (!res.length) { box.appendChild(el('p', { text: 'Nessuna carta con questo nome o numero.' })); return; }
    for (const c of res) box.appendChild(rigaCandidato(c, prefs.lingua || 'it', false, () => scegliDaRicerca(c)));
  }

  // ---------- collezione ----------
  const urlFoto = new Map();
  function fotoDi(item) {
    if (!item.photo) return '';
    if (!urlFoto.has(item.id)) urlFoto.set(item.id, URL.createObjectURL(item.photo));
    return urlFoto.get(item.id);
  }
  // Totali della collezione: valore (prezzo a mano o media, per quantità) e totale al minimo
  function totali(items) {
    let carte = 0, valore = 0, minimo = 0, senza = 0, aMano = 0;
    for (const it of items) {
      const q = it.qty || 1, v = Prices.value(it);
      carte += q;
      // somma dei prezzi minimi: stessa regola del file Excel (minimo Cardmarket per quantità)
      if (it.prices && it.prices.eur && typeof it.prices.eur.min === 'number') minimo += it.prices.eur.min * q;
      if (v.eur === null) { senza += q; continue; }
      valore += v.eur * q;
      if (v.fonte === 'manuale') aMano += q;
    }
    return { carte, valore, minimo, senza, aMano };
  }
  async function aggiornaConto() {
    const items = await Store.all();
    const t = totali(items);
    $('conto').textContent = t.carte === 0 ? '' : t.carte === 1 ? '1 carta' : t.carte + ' carte';
    $('conto-valore').textContent = t.carte && t.senza < t.carte ? Prices.eur(t.valore) : '';
    return items;
  }

  const SIGLA_VARIANTE = { normal: 'Normale', holo: 'Holo', reverse: 'Reverse', lenticular: 'Lenticolare', metal: 'Metallo' };
  function ordina(items, criterio) {
    const tot = (it) => { const v = Prices.value(it); return v.eur === null ? null : v.eur * (it.qty || 1); };
    const perValore = (dir) => (a, b) => {
      const x = tot(a), y = tot(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;   // le carte senza quotazione vanno sempre in fondo
      if (y === null) return -1;
      return dir * (x - y);
    };
    const per = {
      recente: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
      nome: (a, b) => a.name.localeCompare(b.name, 'it') || String(a.localId).localeCompare(String(b.localId), 'it', { numeric: true }),
      espansione: (a, b) => (a.setName || '').localeCompare(b.setName || '', 'it') || String(a.localId).localeCompare(String(b.localId), 'it', { numeric: true }),
      'valore-alto': perValore(-1),
      'valore-basso': perValore(1)
    };
    return items.slice().sort(per[criterio] || per.recente);
  }

  // Sotto ogni carta della galleria: minimo, media e massimo, più il prezzo a mano se c'è
  function prezziTasca(it, v) {
    const pr = it.prices;
    if (v.eur === null && !(pr && (pr.eur || pr.usd))) return el('span', { class: 'tasca-prezzo assente', text: 'senza quotazione' });
    const riga = (nome, valore, forte) => el('span', { class: 'tasca-riga' + (forte ? ' forte' : '') }, [el('span', { text: nome }), el('span', { text: valore })]);
    const righe = [
      riga('Min', Prices.eur(pr && pr.eur ? pr.eur.min : null)),
      riga('Media', Prices.eur(pr && pr.eur ? pr.eur.media : null), v.fonte !== 'manuale'),
      riga('Max', Prices.usd(pr && pr.usd ? pr.usd.max : null))
    ];
    if (v.fonte === 'manuale') righe.push(riga('A mano', Prices.eur(v.eur), true));
    return el('span', { class: 'tasca-prezzi' }, righe);
  }

  function disegnaGalleria(items) {
    const g = $('griglia');
    g.replaceChildren();
    for (const it of items) {
      // nella collezione si vede l'immagine ufficiale; la foto scattata fa da ripiego
      // (carta non più in elenco, immagine mancante, telefono senza rete) e resta nel dettaglio
      const foto = fotoDi(it);
      const card = IX ? IX.cards.find((c) => c.id === it.cardId) : null;
      const conFoto = () => foto ? el('img', { src: foto, alt: '' }) : null;
      const img = card ? immagineUfficiale(card, it.lang, 'low', conFoto) : (conFoto() || el('div', { class: 'segnaposto', text: it.name }));
      const v = Prices.value(it);
      g.appendChild(el('button', { type: 'button', class: 'tasca', 'aria-label': it.name + ', apri i dettagli', onclick: () => apriDettaglio(it.id) }, [
        img,
        el('span', { class: 'tasca-nome', text: it.name }),
        el('span', { class: 'tasca-info', text: it.localId + (it.setTotal ? '/' + it.setTotal : '') + (it.qty > 1 ? '  ×' + it.qty : '') }),
        prezziTasca(it, v)
      ]));
    }
  }

  function disegnaTabella(items, t) {
    const tab = $('tabella');
    const th = (testo, cls, criteri) => {
      const c = el('th', { scope: 'col', class: cls || '' });
      if (!criteri) { c.textContent = testo; return c; }
      // intestazioni ordinabili: un tocco ordina, un secondo tocco inverte dove ha senso
      const attivo = criteri.indexOf(prefs.ordine) >= 0;
      if (attivo) c.setAttribute('aria-sort', prefs.ordine === 'valore-alto' ? 'descending' : 'ascending');
      c.appendChild(el('button', { type: 'button', text: testo, onclick: () => {
        const i = criteri.indexOf(prefs.ordine);
        prefs.ordine = criteri[(i + 1) % criteri.length]; salvaPrefs(); disegnaCollezione();
      } }));
      return c;
    };
    const testa = el('thead', null, [el('tr', null, [
      th('Carta', '', ['nome']), th('Valore', '', ['valore-alto', 'valore-basso']), th('Q.tà'),
      th('Minimo'), th('Media'), th('Massimo'), th('Variante', 'testo'), th('Lingua', 'testo'), th('Cond.', 'testo')
    ])]);
    const corpo = el('tbody');
    for (const it of items) {
      const pr = it.prices, v = Prices.value(it), q = it.qty || 1;
      const num = (testo, vuoto) => el('td', { class: vuoto ? 'assente' : '', text: testo });
      const valore = el('td', { class: v.eur === null ? 'assente' : 't-valore' });
      valore.appendChild(document.createTextNode(v.eur === null ? 'n.d.' : Prices.eur(v.eur * q)));
      if (v.fonte === 'manuale') valore.appendChild(el('span', { class: 't-sotto', text: 'prezzo a mano' }));
      corpo.appendChild(el('tr', { onclick: () => apriDettaglio(it.id) }, [
        el('td', null, [
          el('button', { type: 'button', class: 't-nome', text: it.name, 'aria-label': it.name + ', apri i dettagli' }),
          el('span', { class: 't-sotto', text: it.localId + (it.setTotal ? '/' + it.setTotal : '') + ' ' + (it.setName || '') })
        ]),
        valore,
        el('td', { text: String(q) }),
        num(Prices.eur(pr && pr.eur ? pr.eur.min : null), !(pr && pr.eur && pr.eur.min !== null)),
        num(Prices.eur(pr && pr.eur ? pr.eur.media : null), !(pr && pr.eur && pr.eur.media !== null)),
        num(Prices.usd(pr && pr.usd ? pr.usd.max : null), !(pr && pr.usd && pr.usd.max !== null)),
        el('td', { class: 'testo', text: (SIGLA_VARIANTE[it.variant] || it.variant || '') + (it.edition === 'prima' ? ', 1ª ed.' : '') }),
        el('td', { class: 'testo', text: (it.lang || '').toUpperCase() }),
        el('td', { class: 'testo', text: it.condition || '' })
      ]));
    }
    const piede = el('tfoot', null, [el('tr', null, [
      el('td', { text: 'Totale' }), el('td', { class: 't-valore', text: Prices.eur(t.valore) }), el('td', { text: String(t.carte) }),
      el('td', { text: Prices.eur(t.minimo) }), el('td'), el('td'), el('td'), el('td'), el('td')
    ])]);
    tab.replaceChildren(testa, corpo, piede);
  }

  async function disegnaCollezione() {
    const tutti = await aggiornaConto();
    const t = totali(tutti);
    const vuota = tutti.length === 0;
    $('collezione-vuota').hidden = !vuota;
    $('strumenti').hidden = vuota;
    $('riepilogo').hidden = vuota;
    const tabella = prefs.vista === 'tabella';
    $('griglia').hidden = vuota || tabella;
    $('tabella-box').hidden = vuota || !tabella;
    if (vuota) { $('griglia').replaceChildren(); $('tabella').replaceChildren(); return; }
    $('vista-galleria').setAttribute('aria-pressed', tabella ? 'false' : 'true');
    $('vista-tabella').setAttribute('aria-pressed', tabella ? 'true' : 'false');
    $('ordine').value = prefs.ordine || 'recente';
    // riepilogo
    $('totale').textContent = Prices.eur(t.valore);
    const note = [(t.carte === 1 ? '1 carta' : t.carte + ' carte') + ', valutate alla media Cardmarket' + (t.aMano ? ' o al prezzo corretto a mano (' + t.aMano + ')' : '') + '.'];
    if (t.minimo > 0) note.push('Ai prezzi minimi varrebbe ' + Prices.eur(t.minimo) + '.');
    if (t.senza) note.push((t.senza === 1 ? '1 carta è senza quotazione e non è contata' : t.senza + ' carte sono senza quotazione e non sono contate') + '.');
    $('totale-nota').textContent = note.join(' ');
    const items = ordina(tutti, prefs.ordine || 'recente');
    if (tabella) disegnaTabella(items, t); else disegnaGalleria(items);
  }

  // ---------- esporta ----------
  let excelPromise = null;
  function caricaExcel() {
    // la libreria per i file Excel si scarica solo quando serve
    if (root_ExcelJS()) return Promise.resolve(root_ExcelJS());
    if (!excelPromise) {
      excelPromise = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = 'vendor/exceljs/exceljs.min.js';
        sc.onload = () => (root_ExcelJS() ? res(root_ExcelJS()) : rej(new Error('libreria Excel non valida')));
        sc.onerror = () => { excelPromise = null; rej(new Error(navigator.onLine ? 'libreria Excel non scaricata' : 'serve la rete per scaricare la libreria Excel la prima volta')); };
        document.head.appendChild(sc);
      });
    }
    return excelPromise;
  }
  function root_ExcelJS() { return window.ExcelJS || null; }
  const oggi = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); };
  // Dentro l'app Android i file non si scaricano come nel browser: passano al telefono a pezzi
  const NATIVO = !!(window.AndroidApp && window.AndroidApp.inizia);
  async function versoAndroid(blob, nome, modo) {
    const id = window.AndroidApp.inizia(nome);
    if (!id) throw new Error('il telefono non ha accettato il file');
    const dati = new Uint8Array(await blob.arrayBuffer());
    const PASSO = 384 * 1024;
    for (let o = 0; o < dati.length; o += PASSO) {
      const pezzo = dati.subarray(o, o + PASSO);
      let bin = '';
      for (let i = 0; i < pezzo.length; i += 0x8000) bin += String.fromCharCode.apply(null, pezzo.subarray(i, i + 0x8000));
      if (!window.AndroidApp.aggiungi(id, btoa(bin))) throw new Error('scrittura del file non riuscita');
    }
    const esito = window.AndroidApp.concludi(id, blob.type || 'application/octet-stream', modo);
    if (esito !== 'ok') throw new Error(esito);
  }
  async function scarica(blob, nome) {
    if (NATIVO) return versoAndroid(blob, nome, 'salva');
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function statoEsporta(testo, errore) { const e = $('esporta-stato'); e.textContent = testo; e.className = 'esporta-stato' + (errore ? ' errore' : ''); }
  async function disegnaEsporta() {
    const items = await aggiornaConto(), t = totali(items);
    const vuota = items.length === 0;
    $('esporta-riepilogo').textContent = vuota ? 'La collezione è vuota: non c\'è ancora niente da esportare.'
      : (t.carte === 1 ? '1 carta' : t.carte + ' carte') + ', valore ' + Prices.eur(t.valore) + (t.senza ? ', ' + t.senza + ' senza quotazione' : '') + '.';
    for (const id of ['esporta-excel', 'condividi-excel', 'salva-copia']) $(id).disabled = vuota;
    // la condivisione di file esiste solo su alcuni telefoni e browser
    let puo = false;
    try { puo = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] })); } catch (e) { puo = false; }
    $('condividi-excel').hidden = !(puo || NATIVO);
    statoEsporta('');
  }
  async function creaExcel() {
    const items = ordina(await Store.all(), prefs.ordine || 'recente');
    if (!items.length) throw new Error('la collezione è vuota');
    const ExcelJS = await caricaExcel();
    const r = await Esporta.toXlsxBlob(items, ExcelJS);
    return { blob: r.blob, totali: r.totali, nome: 'raccoglitore-' + oggi() + '.xlsx' };
  }
  async function esportaExcel(condividi) {
    statoEsporta('Preparo il file Excel');
    try {
      const f = await creaExcel();
      if (condividi && NATIVO) {
        await versoAndroid(f.blob, f.nome, 'condividi');
        statoEsporta('File Excel pronto da condividere: ' + f.nome);
      } else if (condividi) {
        try {
          await navigator.share({ files: [new File([f.blob], f.nome, { type: f.blob.type })], title: 'Raccoglitore' });
          statoEsporta('File Excel condiviso: ' + f.nome);
        } catch (e) {
          if (e && e.name === 'AbortError') { statoEsporta(''); return; }
          throw e;
        }
      } else {
        await scarica(f.blob, f.nome);
        statoEsporta('File Excel scaricato: ' + f.nome + ' (' + f.totali.righe + ' righe, valore ' + Prices.eur(f.totali.valore) + '). Lo trovi tra i download del telefono.');
      }
    } catch (e) {
      console.error(e);
      statoEsporta('File Excel non creato: ' + (e && e.message ? e.message : e) + '.', true);
    }
  }
  async function salvaCopia() {
    statoEsporta('Preparo la copia dei dati');
    try {
      const items = await Store.all();
      const blob = await Esporta.toBackupBlob(items);
      await scarica(blob, 'raccoglitore-copia-' + oggi() + '.json');
      statoEsporta('Copia dei dati scaricata: ' + items.length + (items.length === 1 ? ' carta' : ' carte diverse') + ', ' + (blob.size / 1048576).toFixed(1).replace('.', ',') + ' MB. Conservala fuori dal telefono.');
    } catch (e) {
      console.error(e);
      statoEsporta('Copia dei dati non creata: ' + (e && e.message ? e.message : e) + '.', true);
    }
  }
  async function ripristinaCopia(file) {
    if (!file) return;
    statoEsporta('Leggo la copia dei dati');
    try {
      const r = await Esporta.readBackup(file, await Store.all());
      for (const it of r.nuove) await Store.add(it);
      await disegnaEsporta();
      const parti = [r.nuove.length === 1 ? '1 carta aggiunta' : r.nuove.length + ' carte aggiunte'];
      if (r.doppie) parti.push(r.doppie + ' già presenti e lasciate come sono');
      if (r.scartate) parti.push(r.scartate + ' scartate perché incomplete');
      statoEsporta('Ripristino completato: ' + parti.join(', ') + '.');
    } catch (e) {
      console.error(e);
      statoEsporta('Ripristino non riuscito: ' + (e && e.message ? e.message : e) + '.', true);
    }
  }

  let inDettaglio = null;
  async function apriDettaglio(id) {
    const it = await Store.get(id);
    if (!it) return;
    inDettaglio = it;
    const card = IX.cards.find((c) => c.id === it.cardId);
    $('d-foto').src = fotoDi(it) || '';
    $('d-nome').textContent = it.name;
    $('d-info').textContent = it.localId + (it.setTotal ? '/' + it.setTotal : '') + '  ' + it.setName + (it.rarity && it.rarity !== 'None' ? ', ' + it.rarity : '');
    riempi($('d-lingua'), LINGUE, it.lang);
    const vv = card ? vociVariante(card) : Object.keys(VARIANTI).map((k) => [k, VARIANTI[k]]);
    if (!vv.some((x) => x[0] === it.variant) && it.variant) vv.push([it.variant, VARIANTI[it.variant] || it.variant]);
    riempi($('d-variante'), vv, it.variant);
    riempi($('d-condizione'), CONDIZIONI, it.condition);
    riempi($('d-quantita'), vociQuantita(), String(it.qty || 1));
    $('d-prezzo').value = typeof it.manualPrice === 'number' ? String(it.manualPrice).replace('.', ',') : '';
    disegnaQuotazioneDettaglio();
    $('dettaglio').showModal();
  }
  function disegnaQuotazioneDettaglio(stato) {
    const it = inDettaglio;
    if (!it) return;
    $('d-quotazione').replaceChildren(stato ? el('p', { class: 'quotazione-stato', text: stato }) : it.prices ? bloccoQuotazione(it.prices) : el('p', { class: 'quotazione-stato', text: 'Quotazione non ancora scaricata.' }));
    $('d-valore').textContent = testoValore(Object.assign({}, it, { manualPrice: leggiPrezzoManuale(), qty: parseInt($('d-quantita').value, 10) || 1 }));
  }
  function leggiPrezzoManuale() {
    const t = $('d-prezzo').value.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }
  async function aggiornaDettaglio() {
    const it = inDettaglio;
    if (!it) return;
    // la quotazione segue la variante scelta ora nel menu; se è diversa da quella salvata
    // resta provvisoria finché non si salvano le modifiche
    const variante = $('d-variante').value;
    disegnaQuotazioneDettaglio('Cerco la quotazione');
    try {
      const json = await scaricaPrezzi(it.cardId, true);
      if (inDettaglio !== it) return;
      it.prices = Prices.extract(json, variante, it.edition);
      if (variante === it.variant) {
        const attuale = await Store.get(it.id);
        if (attuale) { attuale.prices = it.prices; await Store.put(attuale); }
      }
      if (inDettaglio === it) disegnaQuotazioneDettaglio();
    } catch (e) {
      if (inDettaglio === it) disegnaQuotazioneDettaglio(messaggioPrezzi(e));
    }
  }
  let aggiornamentoInCorso = false;
  async function aggiornaTutte() {
    if (aggiornamentoInCorso) return;
    aggiornamentoInCorso = true;
    const b = $('aggiorna-tutte'), stato = $('aggiorna-stato');
    b.disabled = true;
    const items = await Store.all();
    let fatti = 0, falliti = 0, senza = 0;
    // tre richieste alla volta, per non sovraccaricare la fonte
    const coda = items.slice();
    const lavora = async () => {
      for (;;) {
        const it = coda.shift();
        if (!it) return;
        try { const pr = await aggiornaPrezziDi(it, true); if (pr && !pr.eur && !pr.usd) senza++; }
        catch (e) { falliti++; }
        fatti++;
        stato.textContent = 'Aggiorno le quotazioni: ' + fatti + ' di ' + items.length;
      }
    };
    await Promise.all([lavora(), lavora(), lavora()]);
    aggiornamentoInCorso = false; b.disabled = false;
    await disegnaCollezione();
    stato.textContent = falliti === items.length && items.length ? (navigator.onLine ? 'Nessuna quotazione scaricata: la fonte dei prezzi non risponde.' : 'Nessuna quotazione scaricata: il telefono è senza rete.')
      : 'Quotazioni aggiornate: ' + (items.length - falliti) + ' di ' + items.length + (falliti ? ', ' + falliti + ' non riuscite' : '') + (senza ? ', ' + senza + ' senza prezzo nella fonte' : '') + '.';
  }
  async function chiudiDettaglio() {
    const d = $('dettaglio');
    if (d.returnValue === 'salva' && inDettaglio) {
      const it = inDettaglio;
      const card = IX.cards.find((c) => c.id === it.cardId);
      it.lang = $('d-lingua').value;
      if (card) it.name = Match.displayName(card, it.lang);
      const varianteNuova = $('d-variante').value;
      const cambiata = !it.prices || it.prices.variante !== varianteNuova;
      it.variant = varianteNuova;
      it.condition = $('d-condizione').value;
      it.qty = parseInt($('d-quantita').value, 10) || 1;
      it.manualPrice = leggiPrezzoManuale();
      await Store.put(it);
      avviso('Modifiche salvate');
      // variante diversa: la quotazione salvata non vale più, la riallineo
      if (cambiata) { try { await aggiornaPrezziDi(it, false); } catch (e) { /* resta quella vecchia, si può aggiornare a mano */ } }
    }
    d.returnValue = '';
    inDettaglio = null;
    disegnaCollezione();
  }
  async function eliminaCorrente() {
    if (!inDettaglio) return;
    const b = $('d-elimina');
    // conferma in due tocchi, senza finestre del browser
    if (b.dataset.conferma !== '1') {
      b.dataset.conferma = '1'; b.textContent = 'Tocca di nuovo per togliere la carta';
      setTimeout(() => { b.dataset.conferma = ''; b.textContent = 'Togli dalla collezione'; }, 4000);
      return;
    }
    b.dataset.conferma = ''; b.textContent = 'Togli dalla collezione';
    const nome = inDettaglio.name;
    await Store.remove(inDettaglio.id);
    if (urlFoto.has(inDettaglio.id)) { URL.revokeObjectURL(urlFoto.get(inDettaglio.id)); urlFoto.delete(inDettaglio.id); }
    inDettaglio = null;
    $('dettaglio').close('chiudi');
    avviso('Tolta dalla collezione: ' + nome);
  }

  // ---------- avvio ----------
  function statoLettore(s) {
    const box = $('lettore');
    if (s.phase === 'pronto' || s.phase === 'fermo') { box.hidden = true; return; }
    box.hidden = false;
    if (s.phase === 'errore') { $('lettore-testo').textContent = 'Il lettore non si è caricato (' + s.error + '). Controlla la connessione e riapri l\'app.'; return; }
    const mb = (n) => (n / 1048576).toFixed(0);
    $('lettore-testo').textContent = s.phase === 'avvio' ? 'Avvio il lettore delle carte' : 'Scarico il lettore delle carte, solo la prima volta (circa 28 MB in tutto): ' + Math.round(100 * s.loaded / Math.max(1, s.total)) + '%';
    $('lettore-barra').style.width = Math.min(100, Math.round(100 * s.loaded / Math.max(1, s.total))) + '%';
  }

  async function avvio() {
    for (const b of document.querySelectorAll('.navigazione button')) b.addEventListener('click', () => mostra(b.dataset.vista));
    for (const id of ['input-fotocamera', 'input-galleria']) {
      $(id).addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; elabora(f); });
    }
    $('modulo').addEventListener('submit', salvaCarta);
    $('annulla').addEventListener('click', () => { corrente = null; mostra('scansiona'); });
    $('altra-carta').addEventListener('click', () => apriRicerca('conferma'));
    $('apri-ricerca').addEventListener('click', () => { corrente = null; if (IX) apriRicerca('scansiona'); });
    $('r-indietro').addEventListener('click', () => mostra(ritornoRicerca === 'conferma' && corrente ? 'conferma' : 'scansiona'));
    $('r-espansione').addEventListener('change', ricercaEspansione);
    $('r-numero').addEventListener('change', (e) => { const c = IX.cards[parseInt(e.target.value, 10)]; if (c) scegliDaRicerca(c); });
    let t = null;
    $('r-testo').addEventListener('input', () => { clearTimeout(t); t = setTimeout(ricercaTesto, 250); });
    $('modulo-ricerca').addEventListener('submit', (e) => { e.preventDefault(); ricercaTesto(); });
    $('f-lingua').addEventListener('change', (e) => {
      if (!corrente || !corrente.card) return;
      corrente.lingua = e.target.value;
      $('conferma-ufficiale').replaceChildren(immagineUfficiale(corrente.card, corrente.lingua, 'high'));
      document.querySelector('.scheda-nome').textContent = Match.displayName(corrente.card, corrente.lingua);
    });
    $('vai-scansiona').addEventListener('click', () => mostra('scansiona'));
    $('dettaglio').addEventListener('close', chiudiDettaglio);
    $('d-elimina').addEventListener('click', eliminaCorrente);
    $('d-aggiorna').addEventListener('click', aggiornaDettaglio);
    $('aggiorna-tutte').addEventListener('click', aggiornaTutte);
    $('esporta-excel').addEventListener('click', () => esportaExcel(false));
    $('condividi-excel').addEventListener('click', () => esportaExcel(true));
    $('salva-copia').addEventListener('click', salvaCopia);
    $('input-copia').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; ripristinaCopia(f); });
    $('vista-galleria').addEventListener('click', () => { prefs.vista = 'galleria'; salvaPrefs(); disegnaCollezione(); });
    $('vista-tabella').addEventListener('click', () => { prefs.vista = 'tabella'; salvaPrefs(); disegnaCollezione(); });
    $('ordine').addEventListener('change', (e) => { prefs.ordine = e.target.value; salvaPrefs(); disegnaCollezione(); });
    for (const id of ['d-prezzo', 'd-quantita']) $(id).addEventListener('input', () => disegnaQuotazioneDettaglio());
    $('f-variante').addEventListener('change', quotazioneConferma);
    $('f-edizione').addEventListener('change', quotazioneConferma);
    OcrEngine.onState(statoLettore);

    aggiornaConto().catch((e) => { console.error(e); avviso('La memoria del telefono non è accessibile: le carte non verranno salvate.', true); });
    try {
      const raw = await (await fetch('data/cards.json')).json();
      IX = Match.build(raw);
    } catch (e) {
      console.error(e);
      avviso('Non sono riuscito a caricare l\'elenco delle carte. Controlla la connessione e riapri l\'app.', true);
      return;
    }
    // il lettore si scarica in sottofondo così la prima foto non deve aspettare
    OcrEngine.load().catch(() => {});
  }

  // memoria per l'uso senza rete (solo su indirizzo sicuro; nell'app Android i file sono già dentro l'app)
  if (!(window.AndroidApp && window.AndroidApp.inizia) && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
  }

  // Tasto indietro del telefono (app Android): chiude il dettaglio o torna alla schermata di scatto.
  // Restituisce false quando non c'è più niente da chiudere, e allora l'app esce.
  function indietro() {
    if ($('dettaglio').open) { $('dettaglio').close('chiudi'); return true; }
    if (!$('vista-ricerca').hidden) { mostra(ritornoRicerca === 'conferma' && corrente ? 'conferma' : 'scansiona'); return true; }
    if (!$('vista-lettura').hidden) return true; // lettura in corso: resto qui
    if ($('vista-scansiona').hidden) { if (!$('vista-conferma').hidden) corrente = null; mostra('scansiona'); return true; }
    return false;
  }

  window.App = { get index() { return IX; }, indietro };
  avvio();
})();
