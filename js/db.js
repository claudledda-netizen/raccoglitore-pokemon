// Archivio locale della collezione (IndexedDB): resta sul dispositivo.
(function (root) {
  'use strict';
  const NAME = 'collezione-carte', STORE = 'carte';
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(NAME, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          os.createIndex('cardId', 'cardId', { unique: false });
        }
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), os = t.objectStore(STORE);
      let out;
      const rq = fn(os);
      if (rq) rq.onsuccess = () => { out = rq.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  root.Store = {
    all: () => tx('readonly', (os) => os.getAll()),
    get: (id) => tx('readonly', (os) => os.get(id)),
    add: (item) => tx('readwrite', (os) => os.add(item)),
    put: (item) => tx('readwrite', (os) => os.put(item)),
    remove: (id) => tx('readwrite', (os) => os.delete(id)),
    clear: () => tx('readwrite', (os) => os.clear())
  };
})(self);
