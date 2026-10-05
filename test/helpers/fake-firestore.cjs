/**
 * test/helpers/fake-firestore.cjs — in-memory, compat-shaped fake Firestore for tests.
 * node --test also loads this file (it is under test/); it defines no tests.
 *
 * makeDb() -> db with collection()/doc()/batch()/runTransaction(). Transactions are genuinely
 * optimistic: every tx.get records the doc's version; if any of them changed before commit the
 * fn re-runs (max 5 attempts, then { code: 'aborted' }).
 * Hooks: db._hooks.beforeCommit (async, runs ONCE, between fn and commit — land a "concurrent"
 * write there), db._hooks.failWrites(col, id) -> true makes that write reject with
 * { code: 'permission-denied' }. db._data = { col: { id: { data } } }; db._seed(col, id, doc).
 * { merge: true } is shallow.
 */
function makeDb() {
  const data = {};
  const listeners = [];   // { col, cb }
  const hooks = { beforeCommit: null, failWrites: null };
  const copy = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  const versions = {};   // 'col/id' -> counter, survives deletes
  function entry(col, id) { return data[col] && data[col][id]; }
  function version(col, id) { return versions[col + '/' + id] || 0; }
  function bump(col, id) { versions[col + '/' + id] = version(col, id) + 1; }
  function checkWrite(col, id) { if (hooks.failWrites && hooks.failWrites(col, id)) throw err('permission-denied', 'permission-denied'); }
  function put(col, id, doc) {
    data[col] = data[col] || {};
    data[col][id] = { data: copy(doc) };
    bump(col, id);
  }
  function remove(col, id) {
    if (!entry(col, id)) return;
    delete data[col][id];
    bump(col, id);
  }
  const snapOf = (col, id) => { const e = entry(col, id); return { id, exists: !!e, data: () => (e ? copy(e.data) : undefined), metadata: { fromCache: false } }; };
  function notify(col) { listeners.filter(l => l.col === col).forEach(l => l.fire()); }

  function applySet(col, id, doc, opts) {
    const e = entry(col, id);
    put(col, id, opts && opts.merge && e ? { ...e.data, ...copy(doc) } : doc);
  }
  function applyUpdate(col, id, patch) {
    const e = entry(col, id);
    if (!e) throw err('not-found', `No document to update: ${col}/${id}`);
    put(col, id, { ...e.data, ...copy(patch) });
  }

  function docRef(col, id) {
    return {
      id, path: `${col}/${id}`, _col: col,
      async get() { return snapOf(col, id); },
      async set(d, opts) { checkWrite(col, id); applySet(col, id, d, opts); notify(col); },
      async update(p) { checkWrite(col, id); applyUpdate(col, id, p); notify(col); },
      async delete() { checkWrite(col, id); remove(col, id); notify(col); },
    };
  }

  function query(col, spec) {
    const q = {
      where(f, op, v) { if (op !== '==') throw new Error('fake: only == supported'); return query(col, { ...spec, filters: [...spec.filters, [f, v]] }); },
      orderBy(f, dir) { return query(col, { ...spec, order: [f, dir || 'asc'] }); },
      limit(n) { return query(col, { ...spec, lim: n }); },
      _snap() {
        let rows = Object.entries(data[col] || {}).map(([id, e]) => ({ id, d: e.data }));
        spec.filters.forEach(([f, v]) => { rows = rows.filter(r => r.d[f] === v); });
        if (spec.order) {
          const [f, dir] = spec.order;
          rows = rows.filter(r => r.d[f] !== undefined).sort((a, b) => (a.d[f] < b.d[f] ? -1 : a.d[f] > b.d[f] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
        }
        if (spec.lim != null) rows = rows.slice(0, spec.lim);
        const docs = rows.map(r => ({ id: r.id, exists: true, data: () => copy(r.d) }));
        return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false }, forEach: cb => docs.forEach(cb) };
      },
      async get() { return q._snap(); },
      onSnapshot(cb, errCb) {
        const l = { col, fire() { try { cb(q._snap()); } catch (e) { if (errCb) errCb(e); } } };
        listeners.push(l);
        l.fire();
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      },
      doc: id => docRef(col, id),
    };
    return q;
  }

  // All-or-nothing: reject the whole commit BEFORE applying anything if an update targets a doc
  // that will not exist at that point (accounting for earlier sets/deletes in the same commit).
  function preflight(ws) {
    const exists = {};
    ws.forEach(w => {
      const k = w.col + '/' + w.id;
      const cur = k in exists ? exists[k] : !!entry(w.col, w.id);
      if (w.op === 'update' && !cur) throw err('not-found', `No document to update: ${k}`);
      exists[k] = w.op !== 'delete';
    });
  }

  async function runTransaction(fn) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const reads = new Map();   // 'col/id' -> version seen
      const writes = [];         // { op, col, id, doc, opts }
      const tx = {
        async get(ref) {
          if (writes.length) throw err('failed-precondition', 'Firestore transactions require all reads to be executed before all writes');
          reads.set(ref.path, version(ref._col, ref.id)); return snapOf(ref._col, ref.id);
        },
        set(ref, d, opts) { writes.push({ op: 'set', col: ref._col, id: ref.id, doc: copy(d), opts }); return tx; },
        update(ref, p) { writes.push({ op: 'update', col: ref._col, id: ref.id, doc: copy(p) }); return tx; },
        delete(ref) { writes.push({ op: 'delete', col: ref._col, id: ref.id }); return tx; },
      };
      const result = await fn(tx);
      if (hooks.beforeCommit) { const h = hooks.beforeCommit; hooks.beforeCommit = null; await h(); }
      const stale = [...reads].some(([path, v]) => { const [c, i] = [path.slice(0, path.indexOf('/')), path.slice(path.indexOf('/') + 1)]; return version(c, i) !== v; });
      if (stale) continue;
      writes.forEach(w => checkWrite(w.col, w.id));
      preflight(writes);
      const touched = new Set();
      writes.forEach(w => {
        if (w.op === 'set') applySet(w.col, w.id, w.doc, w.opts);
        else if (w.op === 'update') applyUpdate(w.col, w.id, w.doc);
        else remove(w.col, w.id);
        touched.add(w.col);
      });
      touched.forEach(notify);
      return result;
    }
    throw err('aborted', 'Transaction aborted: too much contention');
  }

  function batch() {
    const ops = [];
    const b = {
      set(ref, d, opts) { ops.push(['set', ref, d, opts]); return b; },
      update(ref, p) { ops.push(['update', ref, p]); return b; },
      delete(ref) { ops.push(['delete', ref]); return b; },
      async commit() {
        ops.forEach(([, ref]) => checkWrite(ref._col, ref.id));
        preflight(ops.map(([op, ref]) => ({ op, col: ref._col, id: ref.id })));
        const touched = new Set();
        ops.forEach(([op, ref, d, o]) => {
          if (op === 'set') applySet(ref._col, ref.id, d, o); else if (op === 'update') applyUpdate(ref._col, ref.id, d); else remove(ref._col, ref.id);
          touched.add(ref._col);
        });
        touched.forEach(notify);
      },
    };
    return b;
  }

  const db = {
    _data: data, _hooks: hooks,
    _seed(col, id, doc) { put(col, id, doc); },
    collection: col => query(col, { filters: [], order: null, lim: null }),
    batch, runTransaction,
  };
  return db;
}

module.exports = { makeDb };
