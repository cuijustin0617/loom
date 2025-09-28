// Shared text normalization for messages
// - Removes invisible chars
// - Unifies epsilon variants and collapses duplicates
// - Collapses triplicate variable forms like x0x_0x0 -> x_0
// - Wraps bare subscripts/superscripts in inline math when appropriate (optional)

export function normalizeText(input) {
  if (!input || typeof input !== 'string') return input;
  let s = input;

  // Remove zero-width/invisible characters that sneak in from copy/paste or models
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');

  // Unify epsilon variants
  // Allow one or more backslashes for robustness (\\epsilon, \\\epsilon)
  s = s.replace(/\\+epsilon/gi, 'ε');
  s = s.replace(/ϵ/g, 'ε');
  // Collapse multiple ε into a single one
  s = s.replace(/ε{2,}/g, 'ε');

  // Collapse triplicate synonym patterns like x0x_0x0 or xtx_txt to x_0 / x_t
  // Optional whitespace allowed between parts
  s = s.replace(/\b([A-Za-z])([A-Za-z0-9])\s*\1_\2\s*\1\2\b/g, '$1_$2');

  // Common typo from model outputs
  s = s.replace(/\bvvv-prediction\b/gi, 'v-prediction');

  // Wrap bare LaTeX subscripts/superscripts so KaTeX renders when markdown is parsed later
  // Keep this conservative to avoid over-wrapping (avoid already wrapped expressions)
  s = s.replace(/(?<!\$)\b([A-Za-z])_\{?([A-Za-z0-9])\}?\b(?!\$)/g, (_m, v, sub) => `$${v}_${sub}$`);
  s = s.replace(/(?<!\$)\b([A-Za-z])\^\{?([A-Za-z0-9])\}?\b(?!\$)/g, (_m, v, sup) => `$${v}^${sup}$`);

  // Fix malformed Markdown tables: add header separator, trim duplicate pipes,
  // consolidate stray lines into the last cell using <br>, and ensure consistent column counts.
  s = fixMalformedTables(s);

  return s;
}

function fixMalformedTables(text) {
  const lines = String(text).split('\n');
  const out = [];
  let tableRows = null; // array of rows (each: array of cells)
  let maxCols = 0;
  let sawSeparator = false;
  let inFence = false;

  const isFence = (ln) => /^\s*```/.test(ln);
  const isTableLike = (ln) => /\|/.test(ln) && (ln.match(/\|/g)?.length || 0) >= 2;
  const isSeparatorRow = (ln) => {
    const t = ln.trim();
    if (!/\|/.test(t)) return false;
    // Allow forms like | --- | :---: | --- |
    const parts = t.replace(/^\||\|$/g, '').split('|').map(p => p.trim());
    return parts.length > 0 && parts.every(p => /^:?[-]{3,}:?$/.test(p));
  };

  const pushTable = () => {
    if (!tableRows || tableRows.length === 0) return;
    if (!sawSeparator) {
      // Build header separator automatically
      const sep = '|' + Array(maxCols).fill(' --- ').join('|') + '|';
      // Emit header row
      out.push(renderRow(tableRows[0], maxCols));
      out.push(sep);
      for (let i = 1; i < tableRows.length; i++) out.push(renderRow(tableRows[i], maxCols));
    } else {
      // Already contains a separator, just emit rows normalized
      for (let i = 0; i < tableRows.length; i++) out.push(renderRow(tableRows[i], maxCols));
    }
    tableRows = null;
    maxCols = 0;
    sawSeparator = false;
  };

  const renderRow = (cells, n) => {
    const row = cells.slice(0, n);
    while (row.length < n) row.push('');
    return '|' + row.map(c => c.trim()).join(' | ') + ' |';
  };

  const parseRow = (ln) => {
    // Remove leading/trailing pipes; collapse multiple pipes and trim
    let t = ln.trim();
    t = t.replace(/\|\s*\|+/g, '|'); // collapse repeats
    t = t.replace(/^\|/, '').replace(/\|$/, '');
    let parts = t.split('|').map(p => p.trim());
    // Remove spurious empty cells from double pipes
    parts = parts.filter((p, i, arr) => !(p === '' && (i === 0 || i === arr.length - 1)));
    if (parts.length === 0) parts = [''];
    return parts;
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (isFence(ln)) {
      // Flush any pending table before toggling fence
      pushTable();
      inFence = !inFence;
      out.push(ln);
      continue;
    }
    if (inFence) { out.push(ln); continue; }

    if (tableRows) {
      if (isTableLike(ln)) {
        if (isSeparatorRow(ln)) {
          sawSeparator = true;
          // Normalize separator: recompute after we know maxCols
          continue; // skip; we'll generate one when pushing
        }
        const parts = parseRow(ln);
        maxCols = Math.max(maxCols, parts.length);
        tableRows.push(parts);
        continue;
      }
      // Non-table line while inside a table block
      const trimmed = ln.trim();
      if (trimmed.length > 0) {
        // Append to the last cell with <br> to keep multi-line content in-cell
        const lastRow = tableRows[tableRows.length - 1];
        const lastIdx = lastRow.length - 1;
        lastRow[lastIdx] = (lastRow[lastIdx] ? lastRow[lastIdx] + '<br>' : '') + trimmed;
      } else {
        // Blank line ends the table
        pushTable();
        out.push(ln);
      }
      continue;
    }

    // Not currently in a table
    if (isTableLike(ln)) {
      tableRows = [];
      sawSeparator = false;
      const parts = parseRow(ln);
      maxCols = Math.max(maxCols, parts.length);
      tableRows.push(parts);
      continue;
    }

    out.push(ln);
  }

  // Flush at end
  pushTable();
  return out.join('\n');
}
