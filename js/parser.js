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

  for (const box of topBoxes) {
    const title = box.querySelector(':scope > .boxborder > .boxtitle')?.textContent.trim().toLowerCase() || '';

    if (title.includes('toolpath')) {
      toolpaths  = extractToolpaths(box);
      totalTime  = extractTotalTime(box);
    } else if (title.includes('material')) {
      materialInfo = extractMaterialInfo(box);
    }
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

  // Rows nested inside .childindent — three .box33 cols: name | tool | time
  for (const row of box.querySelectorAll('.childindent .fullwidth')) {
    const cols = row.querySelectorAll('.box33');
    const name = cols[0]?.querySelector('.level')?.textContent.trim() || '';
    const tool = cols[1]?.querySelector('.level')?.textContent.trim() || '';
    const time = cols[2]?.querySelector('.level')?.textContent.trim() || '';
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

/* ── Utility ── */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
