/**
 * Turns a free-typed name (customer, client) into something safe to use
 * as a Windows folder/file name segment in a download path.
 */
const PathUtils = (() => {
  function sanitizeForPath(name) {
    const cleaned = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/[.\s]+$/, '')
      .trim();

    // If there's no alphanumeric content left, return the fallback
    if (!/[a-zA-Z0-9]/.test(cleaned)) {
      return 'Unfiled';
    }

    return cleaned;
  }

  return { sanitizeForPath };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PathUtils;
if (typeof module === 'undefined') { var sanitizeForPath = PathUtils.sanitizeForPath; }
