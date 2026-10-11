// Esportazione: file Excel della collezione e copia di sicurezza dei dati.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Esporta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VARIANTI = { normal: 'Normale', holo: 'Holo', reverse: 'Reverse holo', lenticular: 'Lenticolare', metal: 'Metallo' };
  const LINGUE = { it: 'Italiano', en: 'Inglese', fr: 'Francese', de: 'Tedesco', es: 'Spagnolo', pt: 'Portoghese', ja: 'Giapponese', xx: 'Altra' };
  const CONDIZIONI = { M: 'Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };
  const EUR = '#,##0.00 "€"', USD = '#,##0.00 "$"', DATA = 'dd/mm/yyyy';
  const BLU = 'FF14213D', GIALLO = 'FFF2A900', GRIGIO = 'FFEEF1F4';

  const numero = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  // data senza ora, in UTC, così Excel mostra lo stesso giorno in qualsiasi fuso
  const giorno = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

  // Le colonne del foglio "Collezione", nell'ordine in cui compaiono
  const COLONNE = [
    { k: 'nome', t: 'Nome', w: 26 },
    { k: 'espansione', t: 'Espansione', w: 26 },
    { k: 'numero', t: 'Numero', w: 10 },
    { k: 'rarita', t: 'Rarità', w: 18 },
    { k: 'lingua', t: 'Lingua', w: 11 },
    { k: 'variante', t: 'Variante', w: 23 },
    { k: 'condizione', t: 'Condizione', w: 13 },
    { k: 'qta', t: 'Quantità', w: 10 },
    { k: 'min', t: 'Minimo Cardmarket', w: 13, f: EUR },
    { k: 'media', t: 'Media Cardmarket', w: 13, f: EUR },
    { k: 'tendenza', t: 'Tendenza Cardmarket', w: 13, f: EUR },
    { k: 'max', t: 'Massimo TCGplayer', w: 13, f: USD },
    { k: 'manuale', t: 'Prezzo corretto a mano', w: 16, f: EUR },
    { k: 'unitario', t: 'Valore unitario', w: 12, f: EUR },
    { k: 'totale', t: 'Valore totale', w: 13, f: EUR },
    { k: 'quotata', t: 'Quotazione del', w: 14, f: DATA, a: 'center' },
    { k: 'aggiunta', t: 'Aggiunta il', w: 14, f: DATA, a: 'center' },
    { k: 'codice', t: 'Codice carta', w: 14 }
  ];
  const col = (k) => COLONNE.findIndex((c) => c.k === k) + 1;
  const lettera = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const L = (k) => lettera(col(k));

  function riga(it) {
    const pr = it.prices || {};
    return {
      nome: it.name || '', espansione: it.setName || '',
      numero: String(it.localId || '') + (it.setTotal ? '/' + it.setTotal : ''),
      rarita: it.rarity && it.rarity !== 'None' ? it.rarity : '',
      lingua: LINGUE[it.lang] || it.lang || '',
      variante: (VARIANTI[it.variant] || it.variant || '') + (it.edition === 'prima' ? ', prima edizione' : ''),
      condizione: CONDIZIONI[it.condition] || it.condition || '',
      qta: it.qty || 1,
      min: pr.eur ? numero(pr.eur.min) : null, media: pr.eur ? numero(pr.eur.media) : null, tendenza: pr.eur ? numero(pr.eur.tendenza) : null,
      max: pr.usd ? numero(pr.usd.max) : null,
      manuale: numero(it.manualPrice),
      quotata: giorno((pr.eur && pr.eur.aggiornato) || (pr.usd && pr.usd.aggiornato) || null),
      aggiunta: giorno(it.addedAt), codice: it.cardId || ''
    };
  }

  // Costruisce la cartella di lavoro. I totali sono formule, così restano giusti se il file viene modificato.
  function buildWorkbook(items, ExcelJS, quando) {
    const adesso = quando || new Date();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Raccoglitore'; wb.created = adesso;
    wb.calcProperties = { fullCalcOnLoad: true };
    const ws = wb.addWorksheet('Collezione', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
    ws.columns = COLONNE.map((c) => ({ key: c.k, width: c.w }));
    // in stampa: orizzontale, tutte le colonne su una pagina, intestazione ripetuta
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
    const testa = ws.getRow(1);
    COLONNE.forEach((c, i) => { testa.getCell(i + 1).value = c.t; });
    testa.height = 32;
    testa.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLU } };
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    const righe = items.map(riga);
    const n = righe.length, primo = 2, ultimo = n + 1;
    righe.forEach((r, i) => {
      const y = i + 2, row = ws.getRow(y);
      for (const c of COLONNE) {
        if (c.k === 'unitario' || c.k === 'totale') continue;
        const v = r[c.k];
        if (v !== null && v !== '' && v !== undefined) row.getCell(col(c.k)).value = v;
      }
      // valore unitario: il prezzo a mano se c'è, altrimenti la media Cardmarket
      const u = r.manuale !== null ? r.manuale : r.media;
      row.getCell(col('unitario')).value = { formula: `IF(${L('manuale')}${y}<>"",${L('manuale')}${y},IF(${L('media')}${y}<>"",${L('media')}${y},""))`, result: u === null ? '' : u };
      row.getCell(col('totale')).value = { formula: `IF(${L('unitario')}${y}="","",${L('unitario')}${y}*${L('qta')}${y})`, result: u === null ? '' : Math.round(u * r.qta * 100) / 100 };
      COLONNE.forEach((c, k) => { if (c.f) row.getCell(k + 1).numFmt = c.f; if (c.a) row.getCell(k + 1).alignment = { horizontal: c.a }; });
      row.getCell(col('unitario')).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIGIO } };
      row.getCell(col('totale')).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIGIO } };
      row.getCell(col('totale')).font = { bold: true, name: 'Calibri', size: 11 };
    });
    // riga dei totali
    const yt = ultimo + 1, tot = ws.getRow(yt);
    const somma = (arr) => Math.round(arr.reduce((s, v) => s + v, 0) * 100) / 100;
    const totValore = somma(righe.map((r) => { const u = r.manuale !== null ? r.manuale : r.media; return u === null ? 0 : u * r.qta; }));
    const totCarte = righe.reduce((s, r) => s + r.qta, 0);
    tot.getCell(1).value = 'Totale';
    tot.getCell(col('qta')).value = { formula: `SUM(${L('qta')}${primo}:${L('qta')}${ultimo})`, result: totCarte };
    tot.getCell(col('totale')).value = { formula: `SUM(${L('totale')}${primo}:${L('totale')}${ultimo})`, result: totValore };
    tot.getCell(col('totale')).numFmt = EUR;
    for (let k = 1; k <= COLONNE.length; k++) {
      const c = tot.getCell(k);
      c.font = { bold: true, name: 'Calibri', size: 11 };
      c.border = { top: { style: 'medium', color: { argb: BLU } } };
    }
    tot.getCell(col('totale')).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GIALLO } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ultimo, column: COLONNE.length } };

    // foglio di riepilogo
    const rs = wb.addWorksheet('Riepilogo');
    rs.columns = [{ width: 38 }, { width: 18 }, { width: 70 }];
    rs.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    const C = (k) => `Collezione!$${L(k)}$${primo}:$${L(k)}$${ultimo}`;
    const totMin = somma(righe.map((r) => (r.min === null ? 0 : r.min * r.qta)));
    const senza = righe.reduce((s, r) => s + ((r.manuale !== null ? r.manuale : r.media) === null ? r.qta : 0), 0);
    const aMano = righe.reduce((s, r) => s + (r.manuale !== null ? r.qta : 0), 0);
    const voci = [
      ['Raccoglitore', null, null, 'titolo'],
      ['Esportato il', giorno(adesso.toISOString()), null, DATA],
      [],
      ['Valore della collezione', { formula: `SUM(${C('totale')})`, result: totValore }, 'Media Cardmarket, o prezzo corretto a mano, per quantità.', EUR, 'forte'],
      ['Somma dei prezzi minimi', { formula: `SUMPRODUCT(${C('min')},${C('qta')})`, result: totMin }, 'Minimo Cardmarket per quantità.', EUR],
      ['Carte', { formula: `SUM(${C('qta')})`, result: totCarte }, 'Somma delle quantità.', '0'],
      ['Carte diverse', n, 'Righe del foglio Collezione.', '0'],
      ['Carte senza quotazione', { formula: `SUMPRODUCT((${C('unitario')}="")*${C('qta')})`, result: senza }, 'Non entrano nel valore della collezione.', '0'],
      ['Carte con prezzo corretto a mano', { formula: `SUMPRODUCT((${C('manuale')}<>"")*${C('qta')})`, result: aMano }, null, '0'],
      [],
      ['Come leggere i prezzi', null, null, 'sezione'],
      ['Minimo, media e tendenza', null, 'Cardmarket, in euro. Riguardano la carta non gradata e non distinguono condizione né lingua.'],
      ['Massimo', null, 'TCGplayer, in dollari. È l\'annuncio più caro in vendita, non un prezzo di vendita: per questo non entra nei totali.'],
      ['Valore unitario', null, 'Il prezzo corretto a mano se presente, altrimenti la media Cardmarket.'],
      ['Fonte dei dati', null, 'TCGdex (api.tcgdex.net). La data di ogni quotazione è nella colonna "Quotazione del".']
    ];
    voci.forEach((v, i) => {
      const row = rs.getRow(i + 1);
      if (!v.length) return;
      row.getCell(1).value = v[0];
      if (v[1] !== null && v[1] !== undefined) row.getCell(2).value = v[1];
      if (v[2]) { row.getCell(3).value = v[2]; row.getCell(3).alignment = { wrapText: true, vertical: 'top' }; row.getCell(3).font = { color: { argb: 'FF586377' } }; }
      row.getCell(1).alignment = { vertical: 'top' };
      if (v[3] === 'titolo') row.getCell(1).font = { bold: true, name: 'Calibri', size: 16, color: { argb: BLU } };
      else if (v[3] === 'sezione') row.getCell(1).font = { bold: true, name: 'Calibri', size: 11, color: { argb: BLU } };
      else if (v[3]) { row.getCell(2).numFmt = v[3]; row.getCell(2).alignment = { horizontal: 'right', vertical: 'top' }; }
      if (v[4] === 'forte') {
        row.getCell(1).font = { bold: true, name: 'Calibri', size: 11 };
        row.getCell(2).font = { bold: true, name: 'Calibri', size: 14 };
        row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GIALLO } };
      }
    });
    return { wb, totali: { valore: totValore, minimo: totMin, carte: totCarte, righe: n, senza, aMano } };
  }

  async function toXlsxBlob(items, ExcelJS) {
    const { wb, totali } = buildWorkbook(items, ExcelJS);
    const buf = await wb.xlsx.writeBuffer();
    return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), totali };
  }

  // ---------- copia di sicurezza ----------
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataUrlToBlob = async (u) => (await fetch(u)).blob();

  async function toBackupBlob(items) {
    const carte = [];
    for (const it of items) {
      const c = Object.assign({}, it);
      delete c.id;
      c.photo = it.photo ? await blobToDataUrl(it.photo) : null;
      carte.push(c);
    }
    const dati = { app: 'raccoglitore', versione: 1, creato: new Date().toISOString(), carte };
    return new Blob([JSON.stringify(dati)], { type: 'application/json' });
  }

  // Legge una copia di sicurezza e restituisce le carte non ancora presenti (stessa carta e stesso momento di aggiunta)
  async function readBackup(file, esistenti) {
    let dati;
    try { dati = JSON.parse(await file.text()); } catch (e) { throw new Error('il file non è una copia di sicurezza leggibile'); }
    if (!dati || dati.app !== 'raccoglitore' || !Array.isArray(dati.carte)) throw new Error('il file non è una copia di sicurezza di questa app');
    const chiave = (c) => (c.cardId || '') + '|' + (c.addedAt || '');
    const presenti = new Set(esistenti.map(chiave));
    const nuove = []; let doppie = 0, scartate = 0;
    for (const c of dati.carte) {
      if (!c || typeof c.cardId !== 'string' || typeof c.name !== 'string') { scartate++; continue; }
      if (presenti.has(chiave(c))) { doppie++; continue; }
      presenti.add(chiave(c));
      const it = {
        cardId: c.cardId, setId: String(c.setId || ''), localId: String(c.localId || ''), name: c.name, nameEn: String(c.nameEn || ''),
        setName: String(c.setName || ''), setTotal: numero(c.setTotal), rarity: String(c.rarity || ''),
        lang: String(c.lang || 'it'), variant: String(c.variant || ''), edition: String(c.edition || ''), condition: String(c.condition || 'NM'),
        qty: Math.max(1, Math.min(999, parseInt(c.qty, 10) || 1)), addedAt: String(c.addedAt || new Date().toISOString()),
        recog: c.recog && typeof c.recog === 'object' ? { sure: !!c.recog.sure, why: Array.isArray(c.recog.why) ? c.recog.why.map(String) : [] } : { sure: false, why: [] },
        prices: c.prices && typeof c.prices === 'object' ? c.prices : null,
        manualPrice: numero(c.manualPrice), photo: null
      };
      if (typeof c.photo === 'string' && c.photo.indexOf('data:image/') === 0) { try { it.photo = await dataUrlToBlob(c.photo); } catch (e) { it.photo = null; } }
      nuove.push(it);
    }
    return { nuove, doppie, scartate, totale: dati.carte.length };
  }

  return { buildWorkbook, toXlsxBlob, toBackupBlob, readBackup, COLONNE };
});
