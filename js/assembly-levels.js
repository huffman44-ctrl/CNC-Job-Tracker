/**
 * Assembly-level decoding: the "-NN" suffix of an assembly number -> which of
 * the four kit options are included. Port of assembly_levels.py — keep the
 * two level tables in step until the Python tool retires.
 */
const AssemblyLevels = (() => {
  // Display order for the four options (columns J-M of the Order Log's
  // "Assembly Numbering" tab).
  const FEATURES = ['Panelling', 'Sink', 'Hex Flooring', 'Wiring'];

  // Level -> the four options, in FEATURES order. Hardcoded source of truth;
  // update here (and in the Python tool) if VanLab revises the definitions.
  const ASSEMBLY_LEVELS = {
    '01': [false, false, false, false],
    '02': [false, false, false, true],
    '03': [false, false, true,  true],
    '04': [false, true,  true,  true],
    '05': [false, true,  false, true],
    '06': [false, true,  false, false],
    '07': [true,  false, false, false],
    '08': [true,  false, false, true],
    '09': [true,  false, true,  true],
    '10': [true,  true,  true,  true],
    '11': [true,  true,  false, true],
    '12': [true,  true,  false, false],
    '13': [false, true,  true,  false],
    '14': [true,  true,  true,  false],
  };

  function parseLevel(assembly) {
    if (!assembly) return null;
    const m = String(assembly).match(/^\s*\d{1,2}-(\d{1,2})\s*$/);
    if (!m) return null;
    const level = m[1].padStart(2, '0');
    return ASSEMBLY_LEVELS[level] ? level : null;
  }

  function decode(assembly) {
    const level = parseLevel(assembly);
    if (level === null) return null;
    return FEATURES.map((name, i) => [name, ASSEMBLY_LEVELS[level][i]]);
  }

  return { decode };
})();
