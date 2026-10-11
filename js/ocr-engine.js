// Motore di lettura del testo nel browser (modelli PP-OCR eseguiti con onnxruntime-web, tutto sul dispositivo).
(function (root) {
  'use strict';
  const BASE = new URL('vendor/', document.baseURI).href;
  let enginePromise = null;
  const listeners = new Set();
  const state = { phase: 'fermo', loaded: 0, total: 0, error: null };

  function emit() { for (const f of listeners) { try { f(state); } catch (e) { /* ignora */ } } }

  async function fetchWithProgress(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Download fallito: ' + url + ' (' + res.status + ')');
    const len = parseInt(res.headers.get('Content-Length') || '0', 10);
    if (!res.body || !len) { const b = await res.arrayBuffer(); state.loaded += b.byteLength; emit(); return b; }
    const reader = res.body.getReader();
    const chunks = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length; state.loaded += value.length; emit();
    }
    const out = new Uint8Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
  }

  function load() {
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
      state.phase = 'scarico'; state.loaded = 0; state.total = 13740000; state.error = null; emit();
      const ort = root.ort, E = root['esearch-ocr'];
      if (!ort || !E) throw new Error('Librerie di lettura non caricate');
      ort.env.wasm.wasmPaths = BASE + 'ort/';
      // il calcolo gira in un processo separato, così la pagina resta reattiva durante la lettura
      ort.env.wasm.proxy = true;
      ort.env.wasm.numThreads = root.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const [det, rec, dic] = await Promise.all([
        fetchWithProgress(BASE + 'ocr/det.onnx'),
        fetchWithProgress(BASE + 'ocr/rec.onnx'),
        fetch(BASE + 'ocr/dict.txt').then((r) => r.text())
      ]);
      state.phase = 'avvio'; emit();
      const eng = await E.init({ det: { input: det }, rec: { input: rec, decodeDic: dic }, ort });
      state.phase = 'pronto'; emit();
      return eng;
    })().catch((e) => { state.phase = 'errore'; state.error = String(e && e.message || e); emit(); enginePromise = null; throw e; });
    return enginePromise;
  }

  // reader per Recog: trova le righe di testo, poi legge solo quelle scelte da keep
  async function read(image, keep) {
    const eng = await load();
    const id = image instanceof ImageData ? image : new ImageData(image.data, image.width, image.height);
    const boxes = await eng.det(id);
    const geo = (b) => {
      const xs = b.box.map((p) => p[0]), ys = b.box.map((p) => p[1]);
      const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
      return { x, y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
    };
    // keep riceve la geometria di tutte le righe trovate e restituisce quali leggere
    const geos = boxes.map(geo);
    const mask = keep ? keep(geos) : geos.map(() => true);
    const kept = boxes.filter((b, i) => mask[i]);
    if (!kept.length) return [];
    const res = await eng.rec(kept);
    return res.filter((r) => r.text && r.text.trim()).map((r) => Object.assign({ text: r.text, conf: r.mean }, geo(r)));
  }

  root.OcrEngine = { load, read, state, onState: (f) => { listeners.add(f); return () => listeners.delete(f); } };
})(self);
