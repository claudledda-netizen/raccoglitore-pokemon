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
  const VISTE = ['scansiona', 'lettura', 'conferma', 'ricerca', 'collezione'];
  function mostra(v) {
    for (const n of VISTE) $('vista-' + n).hidden = n !== v;
    for (const b of document.querySelectorAll('.navigazione button')) {
      const attiva = b.dataset.vista === (v === 'collezione' ? 'collezione' : 'scansiona');
      if (attiva) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
    if (v === 'collezione') disegnaCollezione();
  }
  let avvisoTimer = null;
  function avviso(testo, errore) {
    const a = $('avviso');
    a.textContent = testo; a.className = 'avviso' + (errore ? ' errore' : ''); a.hidden = false;
    clearTimeout(avvisoTimer);
    avvisoTimer = setTimeout(() => { a.hidden = true; }, errore ? 7000 : 3500);
  }

  // ---------- immagini ----------
  function immagineUfficiale(card, lang, qualita) {
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
        box.replaceChildren(el('div', { class: 'segnaposto', text: 'Immagine non disponibile' }));
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
      prices: null, manualPrice: null
    };
    try {
      await Store.add(item);
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
  async function aggiornaConto() {
    const items = await Store.all();
    const tot = items.reduce((s, i) => s + (i.qty || 1), 0);
    $('conto').textContent = tot === 0 ? '' : tot === 1 ? '1 carta' : tot + ' carte';
    return items;
  }
  async function disegnaCollezione() {
    const items = await aggiornaConto();
    $('collezione-vuota').hidden = items.length > 0;
    const g = $('griglia');
    g.replaceChildren();
    items.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
    for (const it of items) {
      const foto = fotoDi(it);
      const img = foto ? el('img', { src: foto, alt: '', loading: 'lazy' }) : el('img', { alt: '', src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' });
      g.appendChild(el('button', { type: 'button', class: 'tasca', 'aria-label': it.name + ', apri i dettagli', onclick: () => apriDettaglio(it.id) }, [
        img,
        el('span', { class: 'tasca-nome', text: it.name }),
        el('span', { class: 'tasca-info', text: it.localId + (it.setTotal ? '/' + it.setTotal : '') + (it.qty > 1 ? '  ×' + it.qty : '') })
      ]));
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
    $('dettaglio').showModal();
  }
  async function chiudiDettaglio() {
    const d = $('dettaglio');
    if (d.returnValue === 'salva' && inDettaglio) {
      const it = inDettaglio;
      const card = IX.cards.find((c) => c.id === it.cardId);
      it.lang = $('d-lingua').value;
      if (card) it.name = Match.displayName(card, it.lang);
      it.variant = $('d-variante').value;
      it.condition = $('d-condizione').value;
      it.qty = parseInt($('d-quantita').value, 10) || 1;
      await Store.put(it);
      avviso('Modifiche salvate');
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

  // memoria per l'uso senza rete (solo su indirizzo sicuro)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker non registrato', e));
  }

  window.App = { get index() { return IX; } };
  avvio();
})();
