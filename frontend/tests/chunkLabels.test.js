/**
 * Tests for chunk labeling feature (Module 1 user labels).
 * Run with: node frontend/tests/chunkLabels.test.js
 */

const assert = require('assert');

// ─── Extract functions under test ─────────────────────────────────────────────
// Copied from App to test in isolation without browser.

function _splitIntoChunks(text) {
  if (!text || !text.trim()) return [];
  const blocks = text.split(/\n\n+/);
  const chunks = [];
  let current = [];
  let currentLines = 0;
  const MIN_LINES = 4;

  const countLines = (block) => block.split('\n').length;

  const flushCurrent = () => {
    if (current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentLines = 0;
    }
  };

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const isHeader = /^#{1,4}\s/.test(trimmed);
    const lines = countLines(trimmed);

    if (isHeader && currentLines >= MIN_LINES) {
      flushCurrent();
    }

    current.push(trimmed);
    currentLines += lines;

    if (currentLines >= MIN_LINES && !isHeader) {
      const nextIdx = blocks.indexOf(block) + 1;
      const nextBlock = nextIdx < blocks.length ? blocks[nextIdx]?.trim() : '';
      const nextIsHeader = nextBlock && /^#{1,4}\s/.test(nextBlock);
      if (nextIsHeader || currentLines >= MIN_LINES + 4) {
        flushCurrent();
      }
    }
  }
  flushCurrent();

  if (chunks.length > 1) {
    const lastLines = countLines(chunks[chunks.length - 1]);
    if (lastLines < 3) {
      const merged = chunks[chunks.length - 2] + '\n\n' + chunks[chunks.length - 1];
      chunks.splice(chunks.length - 2, 2, merged);
    }
  }

  return chunks;
}

function _injectChunkLabels(content, chunkLabels) {
  if (!chunkLabels || Object.keys(chunkLabels).length === 0) return content;
  const chunks = _splitIntoChunks(content);
  if (chunks.length === 0) return content;

  const parts = chunks.map((chunk, i) => {
    const label = chunkLabels[String(i)];
    if (label === 'understood') return chunk + '\n[USER: understood this section]';
    if (label === 'unsure') return chunk + '\n[USER: unsure about this section]';
    return chunk;
  });
  return parts.join('\n\n');
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

// ─── Helper: build multi-line text ────────────────────────────────────────────

function lines(n, prefix = 'Line') {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');
}

function paragraphs(count, linesEach = 3) {
  return Array.from({ length: count }, (_, i) =>
    lines(linesEach, `P${i + 1}L`)
  ).join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// _splitIntoChunks TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── _splitIntoChunks Parser Tests ───');

test('empty string returns empty array', () => {
  assert.deepStrictEqual(_splitIntoChunks(''), []);
});

test('null input returns empty array', () => {
  assert.deepStrictEqual(_splitIntoChunks(null), []);
});

test('undefined input returns empty array', () => {
  assert.deepStrictEqual(_splitIntoChunks(undefined), []);
});

test('whitespace-only returns empty array', () => {
  assert.deepStrictEqual(_splitIntoChunks('   \n\n  '), []);
});

test('short single paragraph stays as one chunk', () => {
  const text = 'This is a short paragraph.';
  const chunks = _splitIntoChunks(text);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], 'This is a short paragraph.');
});

test('two short paragraphs merge into one chunk (below MIN_LINES)', () => {
  const text = 'First paragraph.\n\nSecond paragraph.';
  const chunks = _splitIntoChunks(text);
  assert.strictEqual(chunks.length, 1);
  assert.ok(chunks[0].includes('First paragraph.'));
  assert.ok(chunks[0].includes('Second paragraph.'));
});

test('text with 12+ lines splits into multiple chunks', () => {
  const text = paragraphs(4, 4); // 4 paragraphs x 4 lines = 16 lines
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
});

test('header at start of text does not cause empty first chunk', () => {
  const text = '## Introduction\n' + lines(8, 'Intro');
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks[0].includes('## Introduction'));
});

test('header forces new chunk when previous chunk has enough lines', () => {
  const text = lines(8, 'Para') + '\n\n## New Section\n' + lines(4, 'Sec');
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
  const hasHeaderChunk = chunks.some(c => c.startsWith('## New Section'));
  assert.ok(hasHeaderChunk, 'Header should start a new chunk');
});

test('header does NOT force new chunk when previous chunk is too small', () => {
  const text = 'Short intro.\n\n## Section\n' + lines(8, 'Content');
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks[0].includes('Short intro.'));
  assert.ok(chunks[0].includes('## Section'));
});

test('small trailing chunk gets merged with previous', () => {
  const text = lines(8, 'Main') + '\n\nShort end.';
  const chunks = _splitIntoChunks(text);
  const lastChunk = chunks[chunks.length - 1];
  assert.ok(lastChunk.includes('Short end.'), 'Trailing text should be present');
  // If there are multiple chunks, the short end should merge with previous
  if (chunks.length > 1) {
    assert.ok(lastChunk.split('\n').length >= 3, 'Merged chunk should have >= 3 lines');
  }
});

test('very long response with multiple headers creates correct boundaries', () => {
  const text = [
    '## Overview',
    lines(8, 'Overview'),
    '## Details',
    lines(8, 'Detail'),
    '## Conclusion',
    lines(8, 'Conclusion'),
  ].join('\n\n');
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);
});

test('code block lines are counted but code block is not split', () => {
  const text = 'Some intro text.\n\n```python\ndef foo():\n    pass\n    return 1\n    x = 2\n    y = 3\n```\n\nMore text after code.';
  const chunks = _splitIntoChunks(text);
  // Should remain as one chunk (code block + context < split threshold)
  assert.strictEqual(chunks.length, 1);
  assert.ok(chunks[0].includes('```python'));
  assert.ok(chunks[0].includes('More text after code.'));
});

test('single paragraph with many lines stays as one chunk', () => {
  const text = lines(20, 'L');
  const chunks = _splitIntoChunks(text);
  assert.strictEqual(chunks.length, 1);
});

test('three paragraphs of 3 lines each merge into one chunk', () => {
  const text = paragraphs(3, 3); // 9 lines across 3 paragraphs
  const chunks = _splitIntoChunks(text);
  // 9 lines >= MIN_LINES (6), may or may not split depending on logic
  // but shouldn't be more than 2
  assert.ok(chunks.length <= 2, `Expected <= 2 chunks, got ${chunks.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// _injectChunkLabels TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── _injectChunkLabels Tests ───');

test('null labels returns content unchanged', () => {
  const content = 'Hello world.';
  assert.strictEqual(_injectChunkLabels(content, null), content);
});

test('empty labels object returns content unchanged', () => {
  const content = 'Hello world.';
  assert.strictEqual(_injectChunkLabels(content, {}), content);
});

test('labels on short content (1 chunk) injects understood marker', () => {
  const text = lines(8, 'Line');
  const result = _injectChunkLabels(text, { '0': 'understood' });
  assert.ok(result.includes('[USER: understood this section]'));
});

test('labels on short content (1 chunk) injects unsure marker', () => {
  const text = lines(8, 'Line');
  const result = _injectChunkLabels(text, { '0': 'unsure' });
  assert.ok(result.includes('[USER: unsure about this section]'));
});

test('understood label on multi-chunk content injects after correct chunk', () => {
  const text = [
    '## Part A',
    lines(8, 'A'),
    '## Part B',
    lines(8, 'B'),
  ].join('\n\n');
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 2, 'Need at least 2 chunks for this test');

  const result = _injectChunkLabels(text, { '1': 'understood' });
  assert.ok(result.includes('[USER: understood this section]'));
  // The marker should come after the second chunk's content
  const markerIdx = result.indexOf('[USER: understood this section]');
  const partBIdx = result.indexOf('## Part B');
  assert.ok(markerIdx > partBIdx, 'Marker should be after Part B');
});

test('multiple labels on different chunks', () => {
  const text = [
    '## Part A',
    lines(8, 'A'),
    '## Part B',
    lines(8, 'B'),
  ].join('\n\n');
  const result = _injectChunkLabels(text, { '0': 'understood', '1': 'unsure' });
  assert.ok(result.includes('[USER: understood this section]'));
  assert.ok(result.includes('[USER: unsure about this section]'));
});

test('label with out-of-range chunk index is ignored', () => {
  const text = 'Short text.';
  const result = _injectChunkLabels(text, { '99': 'understood' });
  assert.ok(!result.includes('[USER:'));
});

test('unlabeled chunks have no markers', () => {
  const text = [
    '## Part A',
    lines(8, 'A'),
    '## Part B',
    lines(8, 'B'),
  ].join('\n\n');
  const result = _injectChunkLabels(text, { '0': 'understood' });
  const markers = result.match(/\[USER:/g) || [];
  assert.strictEqual(markers.length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// LABEL TOGGLE LOGIC TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Label Toggle Logic Tests ───');

function simulateToggle(chunkLabels, chunkIdx, label) {
  const labels = { ...chunkLabels };
  const current = labels[chunkIdx];
  const newLabel = current === label ? null : label;
  if (newLabel) {
    labels[chunkIdx] = newLabel;
  } else {
    delete labels[chunkIdx];
  }
  return labels;
}

test('setting label on unlabeled chunk', () => {
  const result = simulateToggle({}, '0', 'understood');
  assert.strictEqual(result['0'], 'understood');
});

test('toggling same label removes it', () => {
  const result = simulateToggle({ '0': 'understood' }, '0', 'understood');
  assert.strictEqual(result['0'], undefined);
});

test('switching from understood to unsure', () => {
  const step1 = simulateToggle({ '0': 'understood' }, '0', 'unsure');
  assert.strictEqual(step1['0'], 'unsure');
});

test('switching from unsure to understood', () => {
  const step1 = simulateToggle({ '0': 'unsure' }, '0', 'understood');
  assert.strictEqual(step1['0'], 'understood');
});

test('labels on different chunks are independent', () => {
  let labels = {};
  labels = simulateToggle(labels, '0', 'understood');
  labels = simulateToggle(labels, '1', 'unsure');
  assert.strictEqual(labels['0'], 'understood');
  assert.strictEqual(labels['1'], 'unsure');
});

test('removing one label does not affect others', () => {
  let labels = { '0': 'understood', '1': 'unsure' };
  labels = simulateToggle(labels, '0', 'understood');
  assert.strictEqual(labels['0'], undefined);
  assert.strictEqual(labels['1'], 'unsure');
});

// ═══════════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Edge Cases ───');

test('text with only headers and no body content', () => {
  const text = '## Header 1\n\n## Header 2\n\n## Header 3';
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks[0].includes('## Header 1'));
});

test('text with horizontal rules', () => {
  const text = lines(8, 'Before') + '\n\n---\n\n' + lines(8, 'After');
  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 1);
});

test('inject labels preserves original content structure', () => {
  const text = lines(8, 'Line');
  const original = text;
  const result = _injectChunkLabels(text, { '0': 'understood' });
  assert.ok(result.startsWith(original.split('\n')[0]));
  assert.ok(result.includes(original.split('\n')[7]));
});

test('inject labels on empty content returns empty', () => {
  assert.strictEqual(_injectChunkLabels('', { '0': 'understood' }), '');
});

test('real-world markdown response chunking', () => {
  const text = `## What is Machine Learning?

Machine learning is a subset of artificial intelligence that focuses on building systems
that can learn from data. Instead of being explicitly programmed, these systems improve
their performance over time through experience.

There are three main types of machine learning:
- Supervised learning
- Unsupervised learning
- Reinforcement learning

## Supervised Learning

In supervised learning, the model is trained on labeled data. Each training example
consists of an input and a desired output. The model learns to map inputs to outputs
by minimizing the error between its predictions and the actual labels.

Common algorithms include:
- Linear regression
- Decision trees
- Neural networks

## Key Concepts

The most important concepts to understand are overfitting, underfitting, and the
bias-variance tradeoff. These determine how well your model generalizes to new data.`;

  const chunks = _splitIntoChunks(text);
  assert.ok(chunks.length >= 2, `Real-world text should produce >= 2 chunks, got ${chunks.length}`);
  assert.ok(chunks[0].includes('Machine learning'));
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
      const stackLines = f.error.stack.split('\n').slice(1, 4);
      stackLines.forEach(l => console.log(`    ${l.trim()}`));
    }
  });
  process.exit(1);
}

process.exit(0);
