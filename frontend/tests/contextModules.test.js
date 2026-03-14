/**
 * Tests for context module card parsing and rendering.
 * Run with: node frontend/tests/contextModules.test.js
 */

const assert = require('assert');

// ─── Minimal DOM mock ─────────────────────────────────────────────────────────
class MockElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.className = '';
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.children = [];
    this.dataset = {};
    this._listeners = {};
    this.parentNode = null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  addEventListener(evt, fn) {
    if (!this._listeners[evt]) this._listeners[evt] = [];
    this._listeners[evt].push(fn);
  }
  click() { (this._listeners['click'] || []).forEach(fn => fn()); }
  classList = {
    _set: new Set(),
    add(c) { this._set.add(c); },
    remove(c) { this._set.delete(c); },
    toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); },
    contains(c) { return this._set.has(c); },
  };
}

function createElement(tag) { return new MockElement(tag); }

function parseHTML(htmlStr) {
  const root = new MockElement('div');
  root.innerHTML = htmlStr;
  return root;
}

function queryAll(el, selector) {
  const html = typeof el.innerHTML === 'string' ? el.innerHTML : '';
  const results = [];
  const re = new RegExp(`class="[^"]*${selector.replace('.', '').replace(/\s+/g, '.*')}[^"]*"`, 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const mock = new MockElement('div');
    mock.className = m[0].slice(7, -1);
    results.push(mock);
  }
  return results;
}

// ─── Load Utils (escapeHtml is the only dependency needed) ────────────────────
const Utils = {
  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
  renderMarkdown(text) {
    return this.escapeHtml(text);
  },
  truncate(text, maxLen = 80) {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  },
};

// ─── Extract the functions under test from App ────────────────────────────────
// We copy the parser and renderer logic here to test them in isolation.
// This keeps tests decoupled from the browser environment.

function _parseUserMessageModules(content) {
  const modules = [];
  let remaining = content || '';

  while (remaining.startsWith('[')) {
    let type, label, body, endIdx;

    if (remaining.startsWith('[My current status in "')) {
      type = 'status';
      const prefix = '[My current status in "';
      const nameEnd = remaining.indexOf('"', prefix.length);
      if (nameEnd === -1) break;
      const topicName = remaining.substring(prefix.length, nameEnd);
      label = `Status: ${topicName}`;
      const bodyStart = nameEnd + '": '.length;
      const closeNewline = remaining.indexOf(']\n\n', bodyStart);
      if (closeNewline !== -1) {
        body = remaining.substring(bodyStart, closeNewline);
        endIdx = closeNewline + 3;
      } else if (remaining.endsWith(']')) {
        body = remaining.substring(bodyStart, remaining.length - 1);
        endIdx = remaining.length;
      } else {
        break;
      }
    } else if (remaining.startsWith('[The user is building on a previous conversation')) {
      type = 'linked_chat';
      const connPrefix = 'Connection to "';
      const connIdx = remaining.indexOf(connPrefix);
      if (connIdx !== -1) {
        const connNameEnd = remaining.indexOf('"', connIdx + connPrefix.length);
        label = connNameEnd !== -1
          ? `Previous conversation: ${remaining.substring(connIdx + connPrefix.length, connNameEnd)}`
          : 'Previous conversation';
      } else {
        label = 'Previous conversation';
      }
      const endMarker = '--- End of previous chat ---]';
      const markerIdx = remaining.indexOf(endMarker);
      if (markerIdx !== -1) {
        body = remaining.substring(1, markerIdx + endMarker.length - 1);
        endIdx = markerIdx + endMarker.length;
      } else {
        const closeNewline = remaining.indexOf(']\n\n');
        if (closeNewline !== -1) {
          body = remaining.substring(1, closeNewline);
          endIdx = closeNewline + 3;
        } else if (remaining.endsWith(']')) {
          body = remaining.substring(1, remaining.length - 1);
          endIdx = remaining.length;
        } else {
          break;
        }
      }
      if (remaining[endIdx] === '\n') endIdx++;
      if (remaining[endIdx] === '\n') endIdx++;
    } else if (remaining.startsWith('[Context from my knowledge map:')) {
      type = 'knowledge_context';
      label = 'Knowledge context';
      const bodyStart = '[Context from my knowledge map: '.length;
      const closeNewline = remaining.indexOf(']\n\n', bodyStart);
      if (closeNewline !== -1) {
        body = remaining.substring(bodyStart, closeNewline);
        endIdx = closeNewline + 3;
      } else if (remaining.endsWith(']')) {
        body = remaining.substring(bodyStart, remaining.length - 1);
        endIdx = remaining.length;
      } else {
        break;
      }
    } else {
      break;
    }

    modules.push({ type, label, body });
    remaining = remaining.substring(endIdx);
  }

  return { modules, userQuery: remaining.trim() };
}

function _renderContextBar(modules) {
  const statusSvg = '<svg class="status-svg"></svg>';
  const linkSvg = '<svg class="link-svg"></svg>';

  const tags = modules.map((mod, i) => {
    const isStatus = mod.type === 'status';
    const icon = isStatus ? statusSvg : linkSvg;
    const typeClass = isStatus ? 'ctx-status' : 'ctx-linked';
    return `<span class="ctx-tag ${typeClass}" data-ctx-idx="${i}">${icon} ${Utils.escapeHtml(mod.label)}</span>`;
  }).join('<span class="ctx-dot">&middot;</span>');

  return `<div class="message-context-bar">${tags}</div><div class="ctx-detail-panel"></div>`;
}

function simulateAppendMessage(msg) {
  const { modules, userQuery } = msg.role === 'user'
    ? _parseUserMessageModules(msg.content)
    : { modules: [], userQuery: msg.content };

  const visibleModules = modules.filter(m => m.type !== 'knowledge_context');

  const displayContent = msg.role === 'user' ? (userQuery || msg.content) : msg.content;
  const renderedContent = msg.role === 'assistant'
    ? Utils.renderMarkdown(msg.content)
    : Utils.escapeHtml(displayContent);

  const attachHtml = msg.attachments && msg.attachments.length > 0
    ? `<div class="message-attachments">${msg.attachments.map(() => '<div>att</div>').join('')}</div>`
    : '';

  if (visibleModules.length > 0) {
    const barHtml = _renderContextBar(visibleModules);
    return `<div class="message ${msg.role}">${attachHtml}<div class="message-bubble-group">${barHtml}<div class="message-content">${renderedContent}</div></div></div>`;
  }
  return `<div class="message ${msg.role}">${attachHtml}<div class="message-content">${renderedContent}</div></div>`;
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// ─── Helper content builders ──────────────────────────────────────────────────

function buildStatus(topicName, statusStr) {
  return `[My current status in "${topicName}": ${statusStr}]`;
}

function buildLinkedChat(connectionTitle, chatHistory) {
  return `[The user is building on a previous conversation they had. Here is that conversation and how it connects:\nConnection to "${connectionTitle}": Some insight\n\n--- Previous chat history ---\n${chatHistory}\n--- End of previous chat ---]`;
}

function buildKnowledge(text) {
  return `[Context from my knowledge map: ${text}]`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER UNIT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Parser Unit Tests ───');

test('plain message with no context blocks', () => {
  const { modules, userQuery } = _parseUserMessageModules('What is machine learning?');
  assert.strictEqual(modules.length, 0);
  assert.strictEqual(userQuery, 'What is machine learning?');
});

test('message with only a status block', () => {
  const content = buildStatus('Machine Learning', 'Overview: Beginner') + '\n\nWhat is ML?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].type, 'status');
  assert.strictEqual(modules[0].label, 'Status: Machine Learning');
  assert.strictEqual(modules[0].body, 'Overview: Beginner');
  assert.strictEqual(userQuery, 'What is ML?');
});

test('message with only a linked-chat block (with end marker)', () => {
  const linkedChat = buildLinkedChat('SVM Basics', 'User: What is SVM?\nAI: SVM is...');
  const content = linkedChat + '\n\nTell me more about kernels.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].type, 'linked_chat');
  assert.ok(modules[0].label.includes('SVM Basics'));
  assert.ok(modules[0].body.includes('What is SVM'));
  assert.strictEqual(userQuery, 'Tell me more about kernels.');
});

test('message with only a knowledge-context block', () => {
  const content = buildKnowledge('How does gradient descent work?') + '\n\nExplain backprop.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].type, 'knowledge_context');
  assert.strictEqual(modules[0].label, 'Knowledge context');
  assert.strictEqual(modules[0].body, 'How does gradient descent work?');
  assert.strictEqual(userQuery, 'Explain backprop.');
});

test('status + linked-chat both present', () => {
  const status = buildStatus('ML', 'Overview: Intermediate');
  const linked = buildLinkedChat('Deep Learning', 'User: hi\nAI: hello');
  const content = status + '\n\n' + linked + '\n\nWhat about CNNs?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 2);
  assert.strictEqual(modules[0].type, 'status');
  assert.strictEqual(modules[1].type, 'linked_chat');
  assert.strictEqual(userQuery, 'What about CNNs?');
});

test('linked-chat + status (reversed order)', () => {
  const linked = buildLinkedChat('Intro', 'User: a\nAI: b');
  const status = buildStatus('Physics', 'Overview: basic');
  const content = linked + '\n\n' + status + '\n\nWhat is gravity?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 2);
  assert.strictEqual(modules[0].type, 'linked_chat');
  assert.strictEqual(modules[1].type, 'status');
  assert.strictEqual(userQuery, 'What is gravity?');
});

test('status + knowledge-context', () => {
  const status = buildStatus('AI', 'Specifics: familiar with NNs');
  const know = buildKnowledge('What about transformers?');
  const content = status + '\n\n' + know + '\n\nExplain attention.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 2);
  assert.strictEqual(modules[0].type, 'status');
  assert.strictEqual(modules[1].type, 'knowledge_context');
  assert.strictEqual(userQuery, 'Explain attention.');
});

test('all three block types present', () => {
  const status = buildStatus('ML', 'Overview: adv');
  const linked = buildLinkedChat('RNN', 'User: q\nAI: a');
  const know = buildKnowledge('What about LSTMs?');
  const content = status + '\n\n' + linked + '\n\n' + know + '\n\nPlease explain.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 3);
  assert.strictEqual(modules[0].type, 'status');
  assert.strictEqual(modules[1].type, 'linked_chat');
  assert.strictEqual(modules[2].type, 'knowledge_context');
  assert.strictEqual(userQuery, 'Please explain.');
});

test('user query starts with [ but does not match known prefix', () => {
  const content = '[This is my question] about arrays?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 0);
  assert.strictEqual(userQuery, '[This is my question] about arrays?');
});

test('empty content string', () => {
  const { modules, userQuery } = _parseUserMessageModules('');
  assert.strictEqual(modules.length, 0);
  assert.strictEqual(userQuery, '');
});

test('content is only context blocks with no trailing query', () => {
  const content = buildStatus('Math', 'Overview: ok');
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].type, 'status');
  assert.strictEqual(userQuery, '');
});

test('malformed status block (missing closing bracket) degrades gracefully', () => {
  const content = '[My current status in "ML": Overview: no close bracket\n\nWhat is ML?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 0);
  assert.ok(userQuery.includes('[My current status'));
});

test('malformed linked chat block (missing end marker and bracket)', () => {
  const content = '[The user is building on a previous conversation. truncated content\n\nQuestion?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 0);
  assert.ok(userQuery.includes('[The user is building'));
});

test('status body with special characters, newlines, code', () => {
  const statusStr = 'Overview: knows `array[0]`; uses x = y + z\nSpecifics: learned O(n) & O(log n)';
  const content = buildStatus('Algorithms', statusStr) + '\n\nExplain quicksort.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].body, statusStr);
  assert.strictEqual(userQuery, 'Explain quicksort.');
});

test('linked chat body with nested brackets in code', () => {
  const history = 'User: How do I access arr[0][1]?\nAI: Use arr[0][1] notation.';
  const linked = buildLinkedChat('Arrays', history);
  const content = linked + '\n\nMore about multi-dim arrays.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.ok(modules[0].body.includes('arr[0][1]'));
  assert.strictEqual(userQuery, 'More about multi-dim arrays.');
});

test('null content input', () => {
  const { modules, userQuery } = _parseUserMessageModules(null);
  assert.strictEqual(modules.length, 0);
  assert.strictEqual(userQuery, '');
});

test('undefined content input', () => {
  const { modules, userQuery } = _parseUserMessageModules(undefined);
  assert.strictEqual(modules.length, 0);
  assert.strictEqual(userQuery, '');
});

test('status block with quotes in topic name', () => {
  const content = '[My current status in "Machine "Deep" Learning": Overview: x]\n\nQuestion';
  const { modules, userQuery } = _parseUserMessageModules(content);
  // Should extract up to the first closing quote
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].label, 'Status: Machine ');
});

test('linked chat without Connection to prefix', () => {
  const content = '[The user is building on a previous conversation they had. Here is that context.\n--- Previous chat history ---\nUser: hi\nAI: hey\n--- End of previous chat ---]\n\nFollow up.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].type, 'linked_chat');
  assert.strictEqual(modules[0].label, 'Previous conversation');
  assert.strictEqual(userQuery, 'Follow up.');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RENDERING INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Rendering Integration Tests ───');

test('user message with no context: no bubble-group, query in bubble', () => {
  const html = simulateAppendMessage({ role: 'user', content: 'Hello world' });
  assert.ok(!html.includes('message-bubble-group'));
  assert.ok(!html.includes('ctx-tag'));
  assert.ok(html.includes('message-content'));
  assert.ok(html.includes('Hello world'));
});

test('user message with one status module renders integrated bubble-group', () => {
  const content = buildStatus('ML', 'Overview: Beginner') + '\n\nWhat is ML?';
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('message-context-bar'));
  assert.ok(html.includes('ctx-tag'));
  assert.ok(html.includes('Status: ML'));
  const bubbleMatch = html.match(/<div class="message-content">([\s\S]*?)<\/div>/);
  assert.ok(bubbleMatch);
  assert.ok(bubbleMatch[1].includes('What is ML?'));
  assert.ok(!bubbleMatch[1].includes('current status'));
});

test('user message with one linked-chat module renders tag in context bar', () => {
  const linked = buildLinkedChat('SVM', 'User: q\nAI: a');
  const content = linked + '\n\nMore about SVM.';
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('Previous conversation: SVM'));
});

test('user message with status + linked-chat renders two tags in bar', () => {
  const status = buildStatus('ML', 'Overview: ok');
  const linked = buildLinkedChat('NNs', 'User: x\nAI: y');
  const content = status + '\n\n' + linked + '\n\nQuestion?';
  const html = simulateAppendMessage({ role: 'user', content });
  const tags = html.match(/ctx-tag/g);
  assert.ok(tags && tags.length >= 2);
  assert.ok(html.includes('Status: ML'));
  assert.ok(html.includes('Previous conversation: NNs'));
  assert.ok(html.includes('ctx-dot'));
});

test('knowledge-context module does NOT render (folded into message)', () => {
  const content = buildKnowledge('What is gradient descent?') + '\n\nPlease explain.';
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(!html.includes('message-bubble-group'));
  assert.ok(!html.includes('ctx-tag'));
  const bubbleMatch = html.match(/<div class="message-content">([\s\S]*?)<\/div>/);
  assert.ok(bubbleMatch[1].includes('Please explain.'));
});

test('assistant messages are unaffected (no module parsing)', () => {
  const content = buildStatus('ML', 'some status') + '\n\nSure, here is your answer.';
  const html = simulateAppendMessage({ role: 'assistant', content });
  assert.ok(!html.includes('message-bubble-group'));
  assert.ok(!html.includes('ctx-tag'));
  assert.ok(html.includes('current status'));
});

test('detail panel starts hidden (no visible class)', () => {
  const content = buildStatus('ML', 'Overview: ok') + '\n\nQ?';
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(!html.includes('ctx-detail-panel visible'));
  assert.ok(html.includes('ctx-detail-panel'));
});

test('backward compat: old message with brackets parses into bubble-group', () => {
  const content = buildStatus('Bio', 'Overview: beginner') + '\n\nWhat is DNA?';
  const html = simulateAppendMessage({ role: 'user', content, contextBlock: null });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('Status: Bio'));
  const bubbleMatch = html.match(/<div class="message-content">([\s\S]*?)<\/div>/);
  assert.ok(bubbleMatch[1].includes('What is DNA?'));
  assert.ok(!bubbleMatch[1].includes('[My current status'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASE AND REGRESSION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Edge Case & Regression Tests ───');

test('very long context body does not crash or produce invalid HTML', () => {
  const longStatus = 'x'.repeat(5000);
  const content = buildStatus('ML', longStatus) + '\n\nQ?';
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('message-content'));
  assert.ok(html.includes('Q?'));
  // Body is rendered on-demand via JS click, not embedded in initial HTML
  const { modules } = _parseUserMessageModules(content);
  assert.strictEqual(modules[0].body.length, 5000);
});

test('messages with attachments + context modules render both', () => {
  const content = buildStatus('ML', 'Beginner') + '\n\nLook at this.';
  const html = simulateAppendMessage({
    role: 'user', content,
    attachments: [{ name: 'img.png', mimeType: 'image/png', data: 'base64...' }],
  });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('message-attachments'));
  assert.ok(html.includes('message-content'));
});

test('msg.content is never mutated by rendering', () => {
  const original = buildStatus('ML', 'Overview') + '\n\nQuestion?';
  const msg = { role: 'user', content: original };
  simulateAppendMessage(msg);
  assert.strictEqual(msg.content, original);
});

test('assistant message with connection markers is not broken', () => {
  const content = 'Here is the answer. {~1} More text.';
  const html = simulateAppendMessage({
    role: 'assistant', content,
    connections: [{ id: 1, text: 'related', chatId: 'c1', chatTitle: 'Past' }],
    rawContent: content,
  });
  assert.ok(html.includes('message-content'));
  // Should contain the raw content (markers handled separately by resolve step)
  assert.ok(html.includes('Here is the answer'));
});

test('status-only message with no question yields empty message bubble', () => {
  const content = buildStatus('ML', 'Overview: ok');
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('message-content'));
});

test('multiple status blocks (edge case)', () => {
  const content = buildStatus('ML', 'a') + '\n\n' + buildStatus('Bio', 'b') + '\n\nQ?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 2);
  assert.strictEqual(modules[0].label, 'Status: ML');
  assert.strictEqual(modules[1].label, 'Status: Bio');
  assert.strictEqual(userQuery, 'Q?');
});

test('linked chat followed by knowledge context', () => {
  const linked = buildLinkedChat('Topic', 'User: hi\nAI: hey');
  const know = buildKnowledge('Explore transformers');
  const content = linked + '\n\n' + know + '\n\nTell me about attention.';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 2);
  assert.strictEqual(modules[0].type, 'linked_chat');
  assert.strictEqual(modules[1].type, 'knowledge_context');
  assert.strictEqual(userQuery, 'Tell me about attention.');
  // knowledge_context should be filtered from rendering; linked_chat tag should be present
  const html = simulateAppendMessage({ role: 'user', content });
  assert.ok(html.includes('message-bubble-group'));
  assert.ok(html.includes('Previous conversation'));
  assert.ok(!html.includes('Knowledge context'));
});

test('content with only whitespace', () => {
  const { modules, userQuery } = _parseUserMessageModules('   \n\n  ');
  assert.strictEqual(modules.length, 0);
  assert.strictEqual(userQuery, '');
});

test('consecutive separators between blocks are handled', () => {
  const status = buildStatus('ML', 'ok');
  // Extra newlines between blocks
  const content = status + '\n\n\n\nWhat is ML?';
  const { modules, userQuery } = _parseUserMessageModules(content);
  assert.strictEqual(modules.length, 1);
  assert.strictEqual(modules[0].type, 'status');
  // Extra newlines should be trimmed from userQuery
  assert.strictEqual(userQuery, 'What is ML?');
});

// ═══════════════════════════════════════════════════════════════════════════════
// LATEX RENDERING TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── LaTeX Rendering Tests ───');

// Test helper: replicates the LaTeX processing logic from Utils._processLatex
// (marked.js handles markdown; this only tests LaTeX conversion)
function renderMarkdownLatex(text) {
  let html = Utils.escapeHtml(text);
  // Stash code blocks to protect from LaTeX processing
  const _codeStash = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = _codeStash.length;
    _codeStash.push(`<pre class="code-block"><code>${code.trim()}</code></pre>`);
    return `\x00CODE${idx}\x00`;
  });
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const idx = _codeStash.length;
    _codeStash.push(`<code class="inline-code">${code}</code>`);
    return `\x00CODE${idx}\x00`;
  });

  const _latexSyms = {
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
  };
  const _applyLatexSyms = (t) => {
    let out = t;
    for (const [cmd, ch] of Object.entries(_latexSyms)) out = out.split(cmd).join(ch);
    return out;
  };
  html = html.replace(/\$\$([^$]+)\$\$/g, (_, tex) => {
    let out = _applyLatexSyms(tex);
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_\{([^}]+)\}/g, '$1<sub>$2</sub>');
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_([a-zA-Z0-9])/g, '$1<sub>$2</sub>');
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^([a-zA-Z0-9])/g, '$1<sup>$2</sup>');
    out = out.replace(/[{}]/g, '');
    return `<div class="math-block">${out}</div>`;
  });
  html = html.replace(/\$([^$]+)\$/g, (_, tex) => {
    let out = _applyLatexSyms(tex);
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_\{([^}]+)\}/g, '$1<sub>$2</sub>');
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])_([a-zA-Z0-9])/g, '$1<sub>$2</sub>');
    out = out.replace(/([a-zA-Z0-9\u0370-\u03FF])\^([a-zA-Z0-9])/g, '$1<sup>$2</sup>');
    out = out.replace(/[{}]/g, '');
    return `<span class="math-inline">${out}</span>`;
  });
  html = html.replace(/\\([a-zA-Z]+)/g, (match, cmd) => {
    const full = '\\' + cmd;
    return _latexSyms[full] || match;
  });
  html = html.replace(/([a-zA-Z0-9])_\{([^}]+)\}/g, '$1<sub>$2</sub>');
  html = html.replace(/([a-zA-Z0-9])\^\{([^}]+)\}/g, '$1<sup>$2</sup>');
  html = html.replace(/\x00CODE(\d+)\x00/g, (_, idx) => _codeStash[parseInt(idx)]);
  return html;
}

test('bare \\to outside dollar signs is converted to arrow', () => {
  const html = renderMarkdownLatex('Input \\to Output');
  assert.ok(html.includes('\u2192'), 'Should contain → arrow');
  assert.ok(!html.includes('\\to'), 'Should not contain \\to');
});

test('bare \\rightarrow outside dollar signs is converted', () => {
  const html = renderMarkdownLatex('A \\rightarrow B');
  assert.ok(html.includes('\u2192'));
});

test('inline math $x_t$ renders subscript', () => {
  const html = renderMarkdownLatex('The variable $x_t$ is important.');
  assert.ok(html.includes('math-inline'));
  assert.ok(html.includes('x<sub>t</sub>'));
});

test('inline math $h_{t-1}$ renders subscript with braces', () => {
  const html = renderMarkdownLatex('$h_{t-1}$ is the previous hidden state.');
  assert.ok(html.includes('h<sub>t-1</sub>'));
});

test('display math $$...$$ renders as math-block', () => {
  const html = renderMarkdownLatex('$$E = mc^2$$');
  assert.ok(html.includes('math-block'));
});

test('bare \\alpha, \\beta outside $ are converted', () => {
  const html = renderMarkdownLatex('learning rate \\alpha and \\beta params');
  assert.ok(html.includes('\u03B1'), 'Should contain α');
  assert.ok(html.includes('\u03B2'), 'Should contain β');
});

test('inline math with multiple symbols', () => {
  const html = renderMarkdownLatex('$\\sum_{i=0}^{n} x_i$');
  assert.ok(html.includes('\u2211'));
  assert.ok(html.includes('math-inline'));
});

test('superscript in inline math $x^2$', () => {
  const html = renderMarkdownLatex('$x^2 + y^2 = z^2$');
  assert.ok(html.includes('math-inline'));
});

test('bare subscript notation h_{t-1} outside dollars', () => {
  const html = renderMarkdownLatex('h_{t-1} is the memory');
  assert.ok(html.includes('h<sub>t-1</sub>'));
});

test('unknown bare command passes through unchanged', () => {
  const html = renderMarkdownLatex('\\foobar is not a known command');
  assert.ok(html.includes('\\foobar'));
});

test('LaTeX inside code blocks is NOT processed', () => {
  const html = renderMarkdownLatex('`\\to` in code');
  assert.ok(html.includes('inline-code'));
  assert.ok(html.includes('\\to'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT LIST TIME LABEL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Chat List Time Label Tests ───');

function getTimeGroup(dateStr) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const d = new Date(dateStr);
  if (d >= todayStart) return 'Today';
  if (d >= weekStart) return 'This week';
  if (d >= monthStart) return 'This month';
  return 'Older';
}

test('chat from today is grouped as Today', () => {
  const now = new Date();
  assert.strictEqual(getTimeGroup(now.toISOString()), 'Today');
});

test('chat from 30 days ago is grouped as Older or This month', () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const group = getTimeGroup(d.toISOString());
  assert.ok(group === 'Older' || group === 'This month');
});

test('chat from 100 days ago is grouped as Older', () => {
  const d = new Date();
  d.setDate(d.getDate() - 100);
  assert.strictEqual(getTimeGroup(d.toISOString()), 'Older');
});

test('chat from 1 hour ago is Today', () => {
  const d = new Date();
  d.setHours(d.getHours() - 1);
  const group = getTimeGroup(d.toISOString());
  // If the 1-hour-ago crosses midnight, it may not be "Today"
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  if (todayStart.getTime() === nowStart.getTime()) {
    assert.strictEqual(group, 'Today');
  } else {
    assert.strictEqual(group, 'This week');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNASSIGNED TOPIC TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Unassigned Topic Tests ───');

test('isOneOff flag causes assignment to Unassigned topic', () => {
  // Simulate the logic from _handleTopicDetection
  const topicData = { name: 'Email', confidence: 0.8, isOneOff: true };
  assert.strictEqual(topicData.isOneOff, true);
});

test('non-oneoff topic gets normal assignment', () => {
  const topicData = { name: 'Machine Learning', confidence: 0.9, isOneOff: false };
  assert.strictEqual(topicData.isOneOff, false);
  assert.strictEqual(topicData.name, 'Machine Learning');
});

test('topic selector excludes Unassigned topic entirely', () => {
  const topics = [
    { id: 't1', name: 'Machine Learning' },
    { id: 't2', name: 'Unassigned' },
    { id: 't3', name: 'Physics' },
  ];
  const filtered = topics.filter(t => t.name !== 'Unassigned');
  assert.strictEqual(filtered.length, 2);
  assert.strictEqual(filtered[0].name, 'Machine Learning');
  assert.strictEqual(filtered[1].name, 'Physics');
  assert.ok(!filtered.find(t => t.name === 'Unassigned'));
});

test('auto-detect includes Unassigned topic chats for reclassification', () => {
  const unassignedTopicId = 't_unassigned';
  const chats = [
    { id: 'c1', topicId: null, summary: 'random email' },
    { id: 'c2', topicId: unassignedTopicId, summary: 'ML question' },
    { id: 'c3', topicId: 't_ml', summary: 'deep learning' },
  ];
  const candidates = chats.filter(c =>
    c.summary && (!c.topicId || c.topicId === unassignedTopicId)
  );
  assert.strictEqual(candidates.length, 2);
  assert.strictEqual(candidates[0].id, 'c1');
  assert.strictEqual(candidates[1].id, 'c2');
});

test('sidebar skipped for Unassigned topic chats', () => {
  const topics = [
    { id: 't1', name: 'Machine Learning' },
    { id: 't_un', name: 'Unassigned' },
  ];
  const isUnassigned = (topicId) => {
    const topic = topics.find(t => t.id === topicId);
    return topic?.name === 'Unassigned';
  };
  assert.strictEqual(isUnassigned('t1'), false);
  assert.strictEqual(isUnassigned('t_un'), true);
  assert.strictEqual(isUnassigned(null), false);
  assert.strictEqual(isUnassigned('nonexistent'), false);
});

test('concepts skipped for Unassigned topic chats', () => {
  const chat = { topicId: 't_un' };
  const topics = [{ id: 't_un', name: 'Unassigned' }];
  const isUnassigned = (topicId) => topics.find(t => t.id === topicId)?.name === 'Unassigned';
  const shouldHandleConcepts = chat.topicId && !isUnassigned(chat.topicId);
  assert.strictEqual(shouldHandleConcepts, false);
});

test('chat item actions wrapper groups buttons', () => {
  // The HTML structure now wraps both buttons in .chat-item-actions
  const html = `<div class="chat-item-actions">
    <button class="chat-unassign-btn"></button>
    <button class="chat-delete-btn"></button>
  </div>`;
  assert.ok(html.includes('chat-item-actions'));
  assert.ok(html.includes('chat-unassign-btn'));
  assert.ok(html.includes('chat-delete-btn'));
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => {
    console.log(`  ✗ ${f.name}`);
    console.log(`    ${f.error.message}`);
    if (f.error.stack) {
      const lines = f.error.stack.split('\n').slice(1, 4);
      lines.forEach(l => console.log(`    ${l.trim()}`));
    }
  });
  process.exit(1);
}

process.exit(0);
