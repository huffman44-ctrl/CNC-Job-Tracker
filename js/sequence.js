/**
 * Sticker-text sequence generator for the print queue (spec:
 * docs/superpowers/specs/2026-09-10-print-queue-design.md § Sequence generation).
 * Pure — no DOM, no Firebase — so it runs under node --test.
 *
 * Mode is auto-detected: both endpoints numeric -> ED1..ED45; both a single
 * repeated letter -> EDA..EDZ, EDAA, EDBB ... ("doubling", deliberately NOT
 * spreadsheet AA/AB/AC — those get misread on a 1-inch label). I and O are
 * kept; skipping them would put every label after H out of step with the
 * cut lists the stickers are matched against.
 */
const Sequence = (() => {
  const MAX_ITEMS = 500;
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const NUM_RE = /^\d+$/;
  const ALPHA_RE = /^([A-Z])\1*$/;   // one letter, optionally repeated: A, BB, CCC

  const isNum = v => NUM_RE.test(v);
  const isAlpha = v => ALPHA_RE.test(v.toUpperCase());

  // A=0 … Z=25, AA=26 … ZZ=51, AAA=52 …
  function alphaIndex(v) {
    const u = v.toUpperCase();
    return (u.length - 1) * 26 + ALPHABET.indexOf(u[0]);
  }
  function alphaAt(i) {
    return ALPHABET[i % 26].repeat(Math.floor(i / 26) + 1);
  }

  function generateSequence(prefix, start, end) {
    const pre = String(prefix ?? '');
    const s = String(start ?? '').trim();
    const e = String(end ?? '').trim();
    if (!s || !e) throw new Error('Enter both a start and an end.');

    const numeric = isNum(s) && isNum(e);
    const alpha = isAlpha(s) && isAlpha(e);
    if (!numeric && !alpha) {
      const bad = [s, e].find(v => !isNum(v) && !isAlpha(v));
      if (bad && /^[A-Za-z]+$/.test(bad)) {
        throw new Error(`${bad} isn't a valid endpoint — letters repeat: A, B … Z, AA, BB.`);
      }
      if (bad) {
        throw new Error(`${bad} isn't a valid endpoint — use a number (1, 45) or a letter (A, Z, AA).`);
      }
      throw new Error(`Can't mix ${s} and ${e} — both ends must be numbers or both letters.`);
    }

    let count, at;
    if (numeric) {
      const a = parseInt(s, 10), b = parseInt(e, 10);
      if (b < a) throw new Error(`${s} comes after ${e} — ranges don't run backwards.`);
      count = b - a + 1;
      at = i => String(a + i);
    } else {
      const a = alphaIndex(s), b = alphaIndex(e);
      if (b < a) throw new Error(`${s.toUpperCase()} comes after ${e.toUpperCase()} — ranges don't run backwards.`);
      count = b - a + 1;
      at = i => alphaAt(a + i);
    }
    if (count > MAX_ITEMS) {
      throw new Error(`That range is ${count} stickers — the limit is ${MAX_ITEMS}.`);
    }
    return Array.from({ length: count }, (_, i) => pre + at(i));
  }

  function parseLines(text) {
    return String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  }

  function rangeLabel(lines) {
    if (!lines || lines.length === 0) return '';
    if (lines.length === 1) return lines[0];
    return `${lines[0]} – ${lines[lines.length - 1]}`;
  }

  return { generateSequence, parseLines, rangeLabel, MAX_ITEMS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Sequence;
