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

  renderMarkdown(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);
    // Fenced code blocks: ```lang\n...\n```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    });
    // Inline code: `...`
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    // Tables: | col | col |\n|---|---|\n| val | val |
    html = html.replace(/(^\|.+\|$\n?)+/gm, (block) => {
      const rows = block.trim().split('\n').filter(r => r.trim());
      if (rows.length < 2) return block;
      const isSep = r => /^\|(\s*[-:]{1,}\s*\|)+\s*$/.test(r.trim());
      const sepIdx = rows.findIndex(isSep);
      if (sepIdx < 1) return block;
      const parseRow = r => r.split('|').slice(1, -1).map(c => c.trim());
      const headCells = parseRow(rows[sepIdx - 1]).map(c => `<th>${c}</th>`).join('');
      let bodyHtml = '';
      for (let i = sepIdx + 1; i < rows.length; i++) {
        if (isSep(rows[i])) continue;
        bodyHtml += '<tr>' + parseRow(rows[i]).map(c => `<td>${c}</td>`).join('') + '</tr>';
      }
      return `<table class="md-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
    });
    // Headings: ### h3, ## h2, # h1 (must be at line start)
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold: **...**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *...*
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    // Inline LaTeX: $...$
    html = html.replace(/\$([^$]+)\$/g, (_, tex) => {
      const syms = {
        '\\rightarrow': '\u2192', '\\leftarrow': '\u2190', '\\leftrightarrow': '\u2194',
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
      };
      let out = tex;
      for (const [cmd, ch] of Object.entries(syms)) out = out.split(cmd).join(ch);
      return out.replace(/[{}]/g, '');
    });
    // Bullet lists: lines starting with "- " or "* "
    html = html.replace(/^([*-]) (.+)$/gm, '<li>$2</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // Newlines to <br> (outside of pre blocks)
    html = html.replace(/\n/g, '<br>');
    // Clean up <br> inside heading tags
    html = html.replace(/<\/h([1-4])><br>/g, '</h$1>');
    html = html.replace(/<br><h([1-4])>/g, '<h$1>');
    // Clean up <br> inside <pre> (they already have whitespace preserved)
    html = html.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/g, (match) => {
      return match.replace(/<br>/g, '\n');
    });
    // Clean up <br> around tables
    html = html.replace(/<br><table/g, '<table');
    html = html.replace(/<\/table><br>/g, '</table>');
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
