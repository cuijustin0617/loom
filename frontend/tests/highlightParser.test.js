/**
 * Pure parser tests for streamed AI-suggested highlight markers.
 * Run with: node frontend/tests/highlightParser.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = {
  console,
  document: { addEventListener() {} },
  window: {},
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
const helpers = vm.runInContext(
  `${appSrc}\n({
    extract: (text) => App._extractHighlights(text),
    displayText: (text) => App._highlightDisplayText(text),
  })`,
  context,
);
const { extract, displayText } = helpers;
const plain = value => JSON.parse(JSON.stringify(value));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

test('extracts one complete pair', () => {
  assert.deepStrictEqual(plain(extract('Use {~HL~}small steps{~/HL~} today.')), {
    cleanText: 'Use small steps today.',
    highlights: [{ spanText: 'small steps', occurrence: 0 }],
  });
});

test('extracts two complete pairs', () => {
  const result = plain(extract('{~HL~}First{~/HL~}, then {~HL~}second{~/HL~}.'));
  assert.strictEqual(result.cleanText, 'First, then second.');
  assert.strictEqual(result.highlights.length, 2);
});

test('strips unclosed opener but keeps trailing text', () => {
  assert.deepStrictEqual(plain(extract('Start {~HL~}still streaming')), {
    cleanText: 'Start still streaming',
    highlights: [],
  });
});

test('strips orphan closer', () => {
  assert.strictEqual(extract('Plain{~/HL~} text').cleanText, 'Plain text');
});

test('is syntax agnostic inside inline code', () => {
  const result = plain(extract('`{~HL~}const x = 1{~/HL~}`'));
  assert.strictEqual(result.cleanText, '`const x = 1`');
  assert.strictEqual(result.highlights[0].spanText, 'const x = 1');
});

test('handles empty and null input', () => {
  assert.deepStrictEqual(plain(extract('')), { cleanText: '', highlights: [] });
  assert.deepStrictEqual(plain(extract(null)), { cleanText: '', highlights: [] });
});

test('is idempotent on clean text', () => {
  const once = extract('Already clean');
  assert.deepStrictEqual(plain(extract(once.cleanText)), plain(once));
});

test('counts repeated span occurrences', () => {
  const result = plain(extract('same {~HL~}same{~/HL~} {~HL~}same{~/HL~}'));
  assert.deepStrictEqual(result.highlights.map(h => h.occurrence), [1, 2]);
});

test('never leaks marker residue', () => {
  for (const input of ['{~HL~}open', 'close{~/HL~}', '{~HLbroken}', '{~/HLbroken}']) {
    const clean = extract(input).cleanText;
    assert.ok(!clean.includes('{~HL'));
    assert.ok(!clean.includes('{~/HL'));
  }
});

test('maps Markdown-wrapped highlights to rendered text', () => {
  assert.strictEqual(displayText('**Use caching**'), 'Use caching');
  assert.strictEqual(displayText('[read the guide](https://example.com)'), 'read the guide');
  assert.strictEqual(displayText('`cache_key`'), 'cache_key');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
