/* Utility helpers for Loom app */

const Utils = {
  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  timestamp() {
    return new Date().toISOString();
  },

  timeAgo(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return `${Math.floor(diffDay / 7)}w ago`;
  },

  truncate(text, maxLen = 80) {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  },

  debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  _latexSyms: {
    '\\rightarrow': '\u2192', '\\to': '\u2192',
    '\\leftarrow': '\u2190', '\\leftrightarrow': '\u2194',
    '\\Rightarrow': '\u21D2', '\\Leftarrow': '\u21D0', '\\Leftrightarrow': '\u21D4',
    '\\times': '\u00D7', '\\div': '\u00F7', '\\pm': '\u00B1', '\\mp': '\u2213',
    '\\leq': '\u2264', '\\geq': '\u2265', '\\neq': '\u2260', '\\approx': '\u2248',
    '\\infty': '\u221E', '\\sum': '\u2211', '\\prod': '\u220F', '\\sqrt': '\u221A',
    '\\alpha': '\u03B1', '\\beta': '\u03B2', '\\gamma': '\u03B3', '\\delta': '\u03B4',
    '\\epsilon': '\u03B5', '\\theta': '\u03B8', '\\lambda': '\u03BB', '\\mu': '\u03BC',
    '\\pi': '\u03C0', '\\sigma': '\u03C3', '\\phi': '\u03C6', '\\omega': '\u03C9',
    '\\Delta': '\u0394', '\\Sigma': '\u03A3', '\\Omega': '\u03A9',
    '\\in': '\u2208', '\\notin': '\u2209', '\\subset': '\u2282', '\\subseteq': '\u2286',
    '\\cup': '\u222A', '\\cap': '\u2229', '\\forall': '\u2200', '\\exists': '\u2203',
    '\\cdot': '\u00B7', '\\dots': '\u2026', '\\ldots': '\u2026',
    '\\partial': '\u2202', '\\nabla': '\u2207', '\\emptyset': '\u2205',
    '\\langle': '\u27E8', '\\rangle': '\u27E9',
  },

  _applyLatexSyms(text) {
    let out = text;
    for (const [cmd, ch] of Object.entries(this._latexSyms)) out = out.split(cmd).join(ch);
    return out;
  },

  _processLatex(html) {
    // Display LaTeX: $$...$$
    html = html.replace(/\$\$([^$]+)\$\$/g, (_, tex) => {
      let out = this._applyLatexSyms(tex);
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_\{([^}]+)\}/g, '$1<sub>$2</sub>');
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_([a-zA-Z0-9])/g, '$1<sub>$2</sub>');
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^([a-zA-Z0-9])/g, '$1<sup>$2</sup>');
      out = out.replace(/[{}]/g, '');
      return `<div class="math-block">${out}</div>`;
    });
    // Inline LaTeX: $...$
    html = html.replace(/\$([^$]+)\$/g, (_, tex) => {
      let out = this._applyLatexSyms(tex);
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_\{([^}]+)\}/g, '$1<sub>$2</sub>');
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_([a-zA-Z0-9])/g, '$1<sub>$2</sub>');
      out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^([a-zA-Z0-9])/g, '$1<sup>$2</sup>');
      out = out.replace(/[{}]/g, '');
      return `<span class="math-inline">${out}</span>`;
    });
    // Bare LaTeX commands outside code (e.g. \to, \alpha)
    html = html.replace(/\\([a-zA-Z]+)/g, (match, cmd) => {
      const full = '\\' + cmd;
      return this._latexSyms[full] || match;
    });
    // Bare subscript/superscript outside $ (e.g. h_{t-1})
    html = html.replace(/([a-zA-Z0-9])_\{([^}]+)\}/g, '$1<sub>$2</sub>');
    html = html.replace(/([a-zA-Z0-9])\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
    return html;
  },

  renderMarkdown(text) {
    if (!text) return '';
    // Stash LaTeX before marked.js processes it (protect from escaping)
    const latexStash = [];
    let src = text;
    src = src.replace(/\$\$([^$]+)\$\$/g, (m) => { latexStash.push(m); return `\x00LATEX${latexStash.length - 1}\x00`; });
    src = src.replace(/\$([^$\n]+)\$/g, (m) => { latexStash.push(m); return `\x00LATEX${latexStash.length - 1}\x00`; });

    // Use marked.js for proper markdown parsing
    const renderer = new marked.Renderer();
    renderer.link = ({ href, text }) => {
      const escaped = this.escapeHtml(href || '');
      return `<a href="${escaped}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    };
    renderer.code = ({ text: code, lang }) => {
      const label = (lang || 'code').charAt(0).toUpperCase() + (lang || 'code').slice(1);
      return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang-label">${this.escapeHtml(label)}</span><button class="code-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='\\u29C9',1500)})">⧉</button></div><pre class="code-block"><code>${this.escapeHtml(code)}</code></pre></div>`;
    };
    renderer.codespan = ({ text: code }) => `<code class="inline-code">${code}</code>`;
    renderer.table = ({ header, rows }) => {
      const headHtml = header.map(cell => `<th>${marked.parseInline(cell.text)}</th>`).join('');
      const bodyHtml = rows.map(row => '<tr>' + row.map(cell => `<td>${marked.parseInline(cell.text)}</td>`).join('') + '</tr>').join('');
      return `<table class="md-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
    };

    let html = marked.parse(src, { renderer, breaks: true, gfm: true });

    // Restore LaTeX and process symbols
    html = html.replace(/\x00LATEX(\d+)\x00/g, (_, idx) => latexStash[parseInt(idx)]);
    html = this._processLatex(html);

    return html;
  },

  TOPIC_COLORS: [
    { color: '#3B82F6', light: '#EFF6FF', hue: 217 },
    { color: '#EC4899', light: '#FDF2F8', hue: 330 },
    { color: '#F59E0B', light: '#FFFBEB', hue: 38 },
    { color: '#10B981', light: '#ECFDF5', hue: 160 },
    { color: '#8B5CF6', light: '#F5F3FF', hue: 263 },
    { color: '#EF4444', light: '#FEF2F2', hue: 0 },
  ],

  _hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  },

  colorFromHue(hue) {
    return {
      color: this._hslToHex(hue, 65, 50),
      light: this._hslToHex(hue, 80, 96),
      hue,
    };
  },

  findDistantHue(existingHues) {
    if (existingHues.length === 0) return 217;
    let bestHue = 0;
    let bestMinDist = -1;
    for (let h = 0; h < 360; h++) {
      let minDist = 360;
      for (const eh of existingHues) {
        const dist = Math.min(Math.abs(h - eh), 360 - Math.abs(h - eh));
        if (dist < minDist) minDist = dist;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestHue = h;
      }
    }
    return bestHue;
  },

  getTopicColor(topicOrIndex) {
    if (topicOrIndex && typeof topicOrIndex === 'object') {
      if (topicOrIndex.colorHue !== undefined && topicOrIndex.colorHue !== null) {
        return this.colorFromHue(topicOrIndex.colorHue);
      }
      const idx = topicOrIndex.colorIndex || 0;
      return this.TOPIC_COLORS[idx % this.TOPIC_COLORS.length];
    }
    const idx = typeof topicOrIndex === 'number' ? topicOrIndex : 0;
    return this.TOPIC_COLORS[idx % this.TOPIC_COLORS.length];
  },

  showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.addEventListener('transitionend', () => toast.remove());
    }, 3500);
  },
};

/* ── Study Logging ─────────────────────────────────────────────────────── */
const StudyLog = {
  event(eventType, data = {}) {
    const userId = Storage?.getUserId?.() || null;
    if (!userId) return;
    const payload = {
      userId,
      condition: Storage.getCondition(),
      eventType,
      data,
      timestamp: new Date().toISOString(),
    };
    // Fire-and-forget; don't block the UI
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  },
};

/* Inactivity timer for chat summarization */
class InactivityTimer {
  constructor(callback, timeoutMs = 120000) {
    this.callback = callback;
    this.timeoutMs = timeoutMs;
    this.timer = null;
    this._onActivity = this.reset.bind(this);
  }

  start() {
    this.reset();
    document.addEventListener('keypress', this._onActivity);
    document.addEventListener('click', this._onActivity);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.callback();
    });
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.callback(), this.timeoutMs);
  }

  stop() {
    clearTimeout(this.timer);
    document.removeEventListener('keypress', this._onActivity);
    document.removeEventListener('click', this._onActivity);
  }
}
