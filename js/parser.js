/**
 * Parses a CNC Job Setup Sheet HTML (VCarve export) into a flat object.
 *
 * Returns:
 * {
 *   jobName:      string,   // #jobtitle — order/job identifier
 *   sheetTitle:   string,   // first .boxtitle — e.g. "Job Layout Sheet 9"
 *   totalTime:    string,   // from toolpaths header — e.g. "00:29:05"
 *   toolpaths:    [{ id, name, tool, timeEstimate }],
 *   materialInfo: [{ label, value }]
 * }
 */
function parseJobSheet(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');

  const jobName    = doc.querySelector('#jobtitle')?.textContent.trim() || '';
  const sheetTitle = doc.querySelector('.boxtitle')?.textContent.trim()
                  || doc.querySelector('#title')?.textContent.trim()
                  || 'Sheet';

  // Locate the top-level .boxborder sections
  const allBoxes = Array.from(doc.querySelectorAll('.boxborder'));
  const topBoxes = allBoxes.filter(el => !el.parentElement.closest('.boxborder'));

  let toolpaths    = [];
  let totalTime    = '';
  let materialInfo = [];
  const detailMap  = {};

  for (const box of topBoxes) {
    const title = box.querySelector('.boxtitle')?.textContent.trim().toLowerCase() || '';

    if (title.includes('toolpaths')) {
      toolpaths  = extractToolpaths(box);
      totalTime  = extractTotalTime(box);
    } else if (/^toolpath:/.test(title)) {
      extractDetailSection(box, detailMap);
    } else if (title.includes('material')) {
      materialInfo = extractMaterialInfo(box);
    }
  }

  if (Object.keys(detailMap).length) {
    toolpaths = toolpaths.map(tp => ({ ...tp, ...(detailMap[tp.name] || {}) }));
  }

  // Extract Material Border SVG from the Job Layout Sheet section
  const svgEl = doc.querySelector('#vectorcenter svg');
  let layoutSvg = '';
  if (svgEl) {
    svgEl.removeAttribute('id');
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    layoutSvg = svgEl.outerHTML;
  }

  return { jobName, sheetTitle, totalTime, toolpaths, materialInfo, layoutSvg };
}

/* ── Toolpaths ── */
function extractToolpaths(box) {
  const items = [];
  let idx = 0;

  // Prefer rows inside .childindent (grouped by sheet); fall back to all .fullwidth rows
  let rows = Array.from(box.querySelectorAll('.childindent .fullwidth'));
  if (!rows.length) {
    rows = Array.from(box.querySelectorAll('.fullwidth')).filter(
      row => !row.closest('.tableheader') && row.querySelectorAll('.box33').length >= 3
    );
  }

  for (const row of rows) {
    const cols = row.querySelectorAll('.box33');
    const name = cols[0]?.querySelector('.level')?.textContent.trim() || cols[0]?.textContent.trim() || '';
    const tool = cols[1]?.querySelector('.level')?.textContent.trim() || cols[1]?.textContent.trim() || '';
    const time = cols[2]?.querySelector('.level')?.textContent.trim() || cols[2]?.textContent.trim() || '';
    if (name) items.push({ id: `tp-${idx++}`, name, tool, timeEstimate: time });
  }

  return items;
}

function extractTotalTime(box) {
  const headerCols = box.querySelectorAll('.tableheader .box33');
  for (const col of headerCols) {
    const text = col.textContent.trim();
    const match = text.match(/(\d{2}:\d{2}:\d{2})/);
    if (match) return match[1];
  }
  return '';
}

/* ── Material Info ── */
function extractMaterialInfo(box) {
  const info = [];

  // Each .box33 or .fullwidth that contains a <b> label + optional .boxpic span value
  for (const el of box.querySelectorAll('.box33, .fullwidth')) {
    const b = el.querySelector(':scope > .level > b, :scope > div > .level > b');
    if (!b) continue;

    const label = b.textContent.trim().replace(/:$/, '');
    const span  = el.querySelector('.boxpic span');
    const value = span
      ? span.innerHTML.replace(/<br\s*\/?>/gi, '  ').replace(/<[^>]+>/g, '').trim()
      : '';

    if (label) info.push({ label, value });
  }

  // Datum sub-items (Z-Zero, XY-origin, Clearance) live in .box33s after the Datum heading
  const datumEl = [...box.querySelectorAll('.fullwidth')].find(
    el => el.querySelector('b')?.textContent.toLowerCase().includes('datum')
  );
  if (datumEl) {
    let sib = datumEl.nextElementSibling;
    while (sib && sib.matches('.box33')) {
      const span = sib.querySelector('.boxpic span');
      if (span) {
        const lines = span.innerHTML
          .split(/<br\s*\/?>/i)
          .map(l => l.replace(/<[^>]+>/g, '').trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          info.push({ label: lines[0], value: lines.slice(1).join(', ') });
        }
      }
      sib = sib.nextElementSibling;
    }
  }

  return info;
}

/* ── Toolpath Details ── */
function extractDetailSection(box, map) {
  for (const child of box.querySelectorAll('.childboxborder')) {
    const boxtitle = child.querySelector('.boxtitle')?.textContent.trim() || '';
    const name = boxtitle.replace(/^toolpath:\s*/i, '').trim();
    if (!name) continue;

    const detail = {};
    for (const cell of child.querySelectorAll('.childboxcontainer .box25')) {
      const level = cell.querySelector('.level');
      if (!level) continue;
      const parts = level.innerHTML
        .split(/<br\s*\/?>/i)
        .map(s => s.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean);
      if (parts.length < 2) continue;
      const key = parts[0].toLowerCase().replace(/:$/, '');
      const val = parts.slice(1).join(' ');
      if      (key.includes('feed rate'))   detail.feedRate     = val;
      else if (key.includes('plunge'))      detail.plungeRate   = val;
      else if (key.includes('spindle'))     detail.spindleSpeed = val;
      else if (key.includes('tool type'))   detail.toolType     = val;
      else if (key.includes('max cut'))     detail.maxCutDepth  = val;
      else if (key.includes('pass depth'))  detail.passDepth    = val;
      else if (key.includes('stepover'))    detail.stepover     = val;
    }
    map[name] = detail;
  }
}

/* ── Utility ── */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
