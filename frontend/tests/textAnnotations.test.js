/**
 * Free-text selection annotation tests.
 * Run with: node frontend/tests/textAnnotations.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(root, 'sidebar.js'), 'utf8');
const stylesSrc = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('\n─── Chunk system removed ───');

test('chunk helpers removed from app.js', () => {
  for (const name of [
    '_splitIntoChunks', '_injectChunkLabels', '_renderChunkedContent',
    '_bindChunkLabelHandlers', '_toggleChunkLabel',
  ]) {
    assert.ok(!appSrc.includes(name), `${name} should be removed`);
  }
});

test('chunk CSS removed', () => {
  assert.ok(!stylesSrc.includes('.msg-chunk'), 'msg-chunk styles removed');
  assert.ok(!stylesSrc.includes('.chunk-label-btn'), 'chunk-label-btn styles removed');
});

console.log('\n─── Annotation UI & persistence ───');

test('app.js defines annotation popover + apply/remove', () => {
  assert.ok(appSrc.includes('_ensureAnnoPopover'), 'popover builder');
  assert.ok(appSrc.includes('_bindAnnotationHandlers'), 'handlers bound');
  assert.ok(appSrc.includes('_applyAnnotation'), 'apply annotation');
  assert.ok(appSrc.includes('_removeAnnotation'), 'remove annotation');
  assert.ok(appSrc.includes('_applyAnnotationsToDom'), 'DOM highlights');
  assert.ok(appSrc.includes('mark.anno'), 'anno mark selector');
});

test('quick labels cover four types plus comment', () => {
  for (const label of ['clear', 'unsure', 'interested', 'not_relevant', 'comment']) {
    assert.ok(appSrc.includes(`data-label="${label}"`) || appSrc.includes(`'${label}'`),
      `should support label ${label}`);
  }
  assert.ok(appSrc.includes('data-action="comment"'), 'Comment… action');
});

test('annotations stored on message.annotations', () => {
  assert.ok(appSrc.includes('msg.annotations'), 'stores on msg.annotations');
  assert.ok(appSrc.includes('spanText'), 'stores spanText');
  assert.ok(appSrc.includes('occurrence'), 'stores occurrence index');
});

test('quick labels set Sidebar._labelsDirty', () => {
  assert.ok(appSrc.includes('Sidebar._labelsDirty = true'), 'sets dirty for quick labels');
  assert.ok(appSrc.includes('_applyAnnotation'), 'via _applyAnnotation');
});

test('comment goes through proposal pipeline (not immediate ai-edit)', () => {
  assert.ok(!appSrc.includes('_commitAnnotationComment'), 'comment commit helper removed');
  assert.ok(appSrc.includes("Noted — it'll show up in your next profile suggestion") || appSrc.includes('Noted'), 'comment toast');
  assert.ok(appSrc.includes('Sidebar._labelsDirty = true'), 'comments set labels dirty');
    assert.ok(appSrc.includes("'text_label_applied'"), 'label logged');
});

test('chunk labels are not injected into chat prompts', () => {
  assert.ok(!appSrc.includes('_injectChunkLabels'), 'no inject helper');
  assert.ok(!sidebarSrc.includes('_injectChunkLabels'), 'sidebar does not inject');
});

console.log('\n─── Logging ───');

test('text_label_* events logged', () => {
  assert.ok(appSrc.includes("'text_label_applied'"), 'text_label_applied');
  assert.ok(appSrc.includes("'text_label_removed'"), 'text_label_removed');
  assert.ok(appSrc.includes("'text_label_applied'"), 'text_label_applied');
  assert.ok(!appSrc.includes("'current_concept_toggled'"), 'old chunk event removed');
});

console.log('\n─── Sidebar flush path ───');

test('_flushDirtyLabels sends annotations array', () => {
  const fnStart = sidebarSrc.indexOf('_flushDirtyLabels() {');
  assert.ok(fnStart >= 0, 'find _flushDirtyLabels');
  const fnBlock = sidebarSrc.substring(fnStart, fnStart + 2200);
  assert.ok(fnBlock.includes('annotations:'), 'sends annotations');
  assert.ok(fnBlock.includes("_stageProposal(freshTopic, data, 'labels'"), 'stages labels proposal');
  assert.ok(!fnBlock.includes('_injectChunkLabels'), 'does not inject chunks');
  assert.ok(fnBlock.includes('.then('), 'fire-and-forget');
});

test('_collectPendingAnnotations includes comments and skips flushed ids', () => {
  const fnStart = sidebarSrc.indexOf('_collectPendingAnnotations(topic) {');
  assert.ok(fnStart >= 0, 'find collector');
  const fnBlock = sidebarSrc.substring(fnStart, fnStart + 1200);
  assert.ok(!fnBlock.includes("if (a.label === 'comment') continue"), 'includes comments');
  assert.ok(fnBlock.includes('_flushedAnnotationIds'), 'tracks flushed ids');
});

test('proposal card can show evidence span', () => {
  assert.ok(sidebarSrc.includes('proposal-evidence') || sidebarSrc.includes('from your'),
    'evidence hint in proposal card');
});

console.log('\n─── Styles ───');

test('anno + label-popover styles present', () => {
  assert.ok(stylesSrc.includes('mark.anno'), 'anno mark');
  assert.ok(stylesSrc.includes('anno-interested'), 'interested style');
  assert.ok(stylesSrc.includes('anno-not_relevant'), 'not_relevant style');
  assert.ok(stylesSrc.includes('.label-popover'), 'popover');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
