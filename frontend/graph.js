/**
 * GraphView — Past · Current · Future trajectory visualization.
 * Renders a three-row node graph with SVG bezier edges inside #graphCanvas.
 */
const GraphView = (() => {
  // ── Constants ────────────────────────────────────────────────────────────
  const EDGE_THRESHOLD = 0.12; // min token overlap score for Past→Concept edge
  const CANVAS_ID = 'graphCanvas';

  // ── Token helpers ────────────────────────────────────────────────────────
  function _tokenize(str = '') {
    return str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  function _overlapScore(tokensA, tokensB) {
    if (!tokensA.length || !tokensB.length) return 0;
    const setA = new Set(tokensA);
    let hits = 0;
    for (const t of tokensB) if (setA.has(t)) hits++;
    return hits / Math.max(tokensA.length, tokensB.length);
  }

  // ── Edge inference ───────────────────────────────────────────────────────
  function _computeEdges(pastChats, concepts, directions) {
    const edges = []; // { from: 'past-i', to: 'concept-j' } or { from: 'concept-j', to: 'dir-k' }

    // Past → Concept edges
    pastChats.forEach((chat, ci) => {
      const chatTokens = _tokenize(`${chat.title || ''} ${chat.userAsked || ''} ${chat.aiCovered || ''}`);
      concepts.forEach((concept, ki) => {
        const cTokens = _tokenize(typeof concept === 'object' ? concept.title : concept);
        const score = _overlapScore(chatTokens, cTokens);
        if (score >= EDGE_THRESHOLD) {
          edges.push({ from: `past-${ci}`, to: `concept-${ki}`, score });
        }
      });
    });

    // Concept → Direction edges
    directions.forEach((dir, di) => {
      const anchorText = (dir.anchor || dir.title || '').toLowerCase();
      let connected = false;
      concepts.forEach((concept, ki) => {
        const title = (typeof concept === 'object' ? concept.title : concept) || '';
        if (anchorText.includes(title.toLowerCase()) && title.length > 2) {
          edges.push({ from: `concept-${ki}`, to: `dir-${di}`, score: 1 });
          connected = true;
        }
      });
      // Fallback: keyword overlap with direction title
      if (!connected) {
        const dirTokens = _tokenize(`${dir.title || ''} ${dir.question || ''}`);
        let bestScore = 0;
        let bestKi = -1;
        concepts.forEach((concept, ki) => {
          const cTokens = _tokenize(typeof concept === 'object' ? concept.title : concept);
          const s = _overlapScore(dirTokens, cTokens);
          if (s > bestScore) { bestScore = s; bestKi = ki; }
        });
        if (bestKi >= 0) {
          edges.push({ from: `concept-${bestKi}`, to: `dir-${di}`, score: bestScore });
        }
      }
    });

    return edges;
  }

  // ── Layout ───────────────────────────────────────────────────────────────
  function _layoutRow(container, items, rowClass, labelText) {
    const row = document.createElement('div');
    row.className = `graph-row ${rowClass}`;

    const label = document.createElement('div');
    label.className = 'graph-row-label';
    label.textContent = labelText;
    row.appendChild(label);

    const nodesWrap = document.createElement('div');
    nodesWrap.className = 'graph-nodes-wrap';

    const nodeEls = [];
    items.forEach((item, i) => {
      const nodeEl = document.createElement('div');
      const id = `${rowClass.replace('row-', '')}-${i}`;
      nodeEl.id = `gnode-${id}`;
      nodeEl.className = `graph-node ${rowClass}-node`;
      nodeEl.dataset.nodeId = id;

      // Stance class for concept nodes
      if (rowClass === 'row-concept' && typeof item === 'object' && item.stance) {
        nodeEl.classList.add(`stance-${item.stance}`);
      }
      // Type class for direction nodes
      if (rowClass === 'row-dir' && item.type) {
        nodeEl.classList.add(`type-${item.type}`);
      }

      const title = typeof item === 'object' ? (item.title || item.name || '') : item;
      nodeEl.textContent = title;
      nodeEl.title = title;
      nodesWrap.appendChild(nodeEl);
      nodeEls.push({ el: nodeEl, id });
    });

    row.appendChild(nodesWrap);
    container.appendChild(row);
    return nodeEls;
  }

  // ── SVG Edge drawing ─────────────────────────────────────────────────────
  function _drawEdges(svg, edges, nodeMap) {
    const canvasRect = svg.parentElement.getBoundingClientRect();

    edges.forEach(edge => {
      const fromEl = nodeMap[edge.from];
      const toEl = nodeMap[edge.to];
      if (!fromEl || !toEl) return;

      const fr = fromEl.getBoundingClientRect();
      const tr = toEl.getBoundingClientRect();

      const x1 = fr.left + fr.width / 2 - canvasRect.left;
      const y1 = fr.bottom - canvasRect.top;
      const x2 = tr.left + tr.width / 2 - canvasRect.left;
      const y2 = tr.top - canvasRect.top;

      const cy = (y1 + y2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#bbbbb5');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('opacity', '0.35');
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      path.className = 'graph-edge';
      svg.appendChild(path);
    });
  }

  // ── Hover highlighting ───────────────────────────────────────────────────
  function _bindHover(canvas, nodeMap) {
    canvas.querySelectorAll('.graph-node').forEach(nodeEl => {
      const id = nodeEl.dataset.nodeId;
      nodeEl.addEventListener('mouseenter', () => {
        const connectedIds = new Set([id]);
        canvas.querySelectorAll('.graph-edge').forEach(edge => {
          if (edge.dataset.from === id) connectedIds.add(edge.dataset.to);
          if (edge.dataset.to === id) connectedIds.add(edge.dataset.from);
        });
        canvas.querySelectorAll('.graph-node').forEach(n => {
          const active = connectedIds.has(n.dataset.nodeId);
          n.classList.toggle('highlighted', active);
          n.classList.toggle('dimmed', !active);
        });
        canvas.querySelectorAll('.graph-edge').forEach(edge => {
          const active = connectedIds.has(edge.dataset.from) && connectedIds.has(edge.dataset.to);
          edge.setAttribute('opacity', active ? '0.85' : '0.08');
          edge.setAttribute('stroke', active ? '#555' : '#bbbbb5');
          edge.setAttribute('stroke-width', active ? '2' : '1.5');
        });
      });
      nodeEl.addEventListener('mouseleave', () => {
        canvas.querySelectorAll('.graph-node').forEach(n => {
          n.classList.remove('highlighted', 'dimmed');
        });
        canvas.querySelectorAll('.graph-edge').forEach(edge => {
          edge.setAttribute('opacity', '0.35');
          edge.setAttribute('stroke', '#bbbbb5');
          edge.setAttribute('stroke-width', '1.5');
        });
      });
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────
  function render(data) {
    const canvas = document.getElementById(CANVAS_ID);
    if (!canvas) return;
    canvas.innerHTML = '';

    const pastChats = data.pastChats || [];
    const concepts = data.concepts || [];
    const directions = [...(data.newDirections || [])].sort((a, b) => {
      const order = { breadth: 0, depth: 1 };
      return (order[a.type] ?? 2) - (order[b.type] ?? 2);
    });

    if (!pastChats.length && !concepts.length && !directions.length) {
      canvas.innerHTML = '<p class="graph-empty-hint">Keep chatting to build your trajectory.</p>';
      return;
    }

    // Render rows
    const pastNodeEls = _layoutRow(canvas, pastChats, 'row-past', 'Past');
    const conceptNodeEls = _layoutRow(canvas, concepts, 'row-concept', 'Current');
    const dirNodeEls = _layoutRow(canvas, directions, 'row-dir', 'Future');

    // Build nodeMap keyed by logical id
    const nodeMap = {};
    pastNodeEls.forEach(n => { nodeMap[`past-${n.id.replace('past-', '')}`] = n.el; });
    pastNodeEls.forEach((n, i) => { nodeMap[`past-${i}`] = n.el; });
    conceptNodeEls.forEach((n, i) => { nodeMap[`concept-${i}`] = n.el; });
    dirNodeEls.forEach((n, i) => { nodeMap[`dir-${i}`] = n.el; });

    // SVG overlay for edges (positioned after layout so we get real rects)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('graph-svg-overlay');
    canvas.appendChild(svg);

    // Compute edges
    const edges = _computeEdges(pastChats, concepts, directions);

    // Draw edges async so DOM layout has settled
    requestAnimationFrame(() => {
      const rect = canvas.getBoundingClientRect();
      const fullH = canvas.scrollHeight;
      svg.setAttribute('width', rect.width);
      svg.setAttribute('height', fullH);
      svg.style.height = fullH + 'px';
      _drawEdges(svg, edges, nodeMap);
      _bindHover(canvas, nodeMap);
    });
  }

  function clear() {
    const canvas = document.getElementById(CANVAS_ID);
    if (canvas) canvas.innerHTML = '';
  }

  return { render, clear };
})();
