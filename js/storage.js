/**
 * Completion record shape:
 * {
 *   completedAt: ISO string,   // date/time the operator confirmed
 *   operator:    string,       // operator name (optional)
 *   notes:       string        // free-text notes (optional)
 * }
 *
 * Storage key: "cnc::<fileKey>::<itemId>"
 * fileKey is a hash of the filename so records from different files don't collide.
 */
const Storage = (() => {
  const PREFIX = 'cnc';

  function _key(fileKey, itemId) {
    return `${PREFIX}::${fileKey}::${itemId}`;
  }

  function get(fileKey, itemId) {
    try {
      const raw = localStorage.getItem(_key(fileKey, itemId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function set(fileKey, itemId, record) {
    try {
      localStorage.setItem(_key(fileKey, itemId), JSON.stringify(record));
    } catch (e) {
      console.warn('Storage.set failed:', e);
    }
  }

  function clear(fileKey, itemId) {
    localStorage.removeItem(_key(fileKey, itemId));
  }

  function clearAll(fileKey) {
    const prefix = `${PREFIX}::${fileKey}::`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }

  function getAllForFile(fileKey) {
    const prefix = `${PREFIX}::${fileKey}::`;
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const itemId = k.slice(prefix.length);
        try { result[itemId] = JSON.parse(localStorage.getItem(k)); } catch {}
      }
    }
    return result;
  }

  function exportCSV(fileKey, sections) {
    const rows = [['Section', 'Toolpath', 'Tool', 'Time Estimate', 'Completed At', 'Operator', 'Notes']];

    for (const section of sections) {
      if (section.type !== 'toolpaths') continue;
      for (const item of section.items) {
        const rec = get(fileKey, item.id);
        rows.push([
          section.title,
          item.name,
          item.tool,
          item.timeEstimate,
          rec ? rec.completedAt : '',
          rec ? (rec.operator || '') : '',
          rec ? (rec.notes || '') : '',
        ]);
      }
    }

    return rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');
  }

  return { get, set, clear, clearAll, getAllForFile, exportCSV };
})();
