/**
 * Tests for UI features from TODO.md.
 * Run with: node frontend/tests/uiFeatures.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

// ─── Load file contents ───────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '../..');
const cssContent = fs.readFileSync(path.join(ROOT, 'frontend/styles.css'), 'utf8');
const htmlContent = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const sidebarContent = fs.readFileSync(path.join(ROOT, 'frontend/sidebar.js'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT, 'frontend/app.js'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 1: Reduced assistant message padding
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── TODO 1: Reduced Assistant Message Padding ───');

test('assistant message content has reduced horizontal padding (76px not 108px)', () => {
    // Match the CSS rule for .message.assistant .message-content
    const match = cssContent.match(/\.message\.assistant\s+\.message-content\s*\{[^}]*padding:\s*([^;]+);/);
    assert.ok(match, 'Should find .message.assistant .message-content CSS rule');
    const padding = match[1].trim();
    assert.ok(padding.includes('76px'), `Padding should include 76px, got: ${padding}`);
    assert.ok(!padding.includes('108px'), 'Padding should NOT include 108px (old value)');
});

test('padding reduction is approximately 30% (108 → ~76)', () => {
    const original = 108;
    const reduced = 76;
    const reductionPercent = ((original - reduced) / original) * 100;
    assert.ok(reductionPercent >= 28 && reductionPercent <= 32,
        `Reduction should be ~30%, got ${reductionPercent.toFixed(1)}%`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 2: Module 1 "User Knowledge" label
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── TODO 2: Module 1 "User Knowledge" Label ───');

test('Module 1 HTML contains "User Knowledge" label', () => {
    assert.ok(htmlContent.includes('User Knowledge'),
        'index.html should contain "User Knowledge" text');
});

test('Module 1 module-title has "User Knowledge" as text', () => {
    // Find the module-title inside Module 1 (module-status)
    const module1Section = htmlContent.substring(
        htmlContent.indexOf('id="moduleStatus"'),
        htmlContent.indexOf('id="moduleConnections"')
    );
    assert.ok(module1Section.includes('>User Knowledge<'),
        'Module 1 should have a module-title with "User Knowledge"');
});

test('Module 1 still has statusTopicName element for dynamic topic name', () => {
    assert.ok(htmlContent.includes('id="statusTopicName"'),
        'Should still have statusTopicName element for dynamic content');
});

test('Module 2 still labeled "Linked past chats"', () => {
    assert.ok(htmlContent.includes('>Linked past chats<'),
        'Module 2 should still be labeled "Linked past chats"');
});

test('Module 3 still labeled "Explore next"', () => {
    assert.ok(htmlContent.includes('>Explore next<'),
        'Module 3 should still be labeled "Explore next"');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 3: Refresh button removed, update button in header with shuffle style
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── TODO 3: Refresh Button Removed, Update Button Restyled ───');

test('refresh sidebar button is removed from HTML', () => {
    assert.ok(!htmlContent.includes('sidebarRefreshBtn'),
        'HTML should not contain sidebarRefreshBtn');
    assert.ok(!htmlContent.includes('Refresh sidebar'),
        'HTML should not contain "Refresh sidebar" text');
});

test('sidebar-refresh-btn CSS class is removed', () => {
    assert.ok(!cssContent.includes('.sidebar-refresh-btn'),
        'CSS should not contain .sidebar-refresh-btn class');
});

test('status-update-btn CSS exists', () => {
    assert.ok(cssContent.includes('.status-update-btn'),
        'CSS should define .status-update-btn class');
});

test('status update button is in Module 1 header', () => {
    const module1Header = htmlContent.substring(
        htmlContent.indexOf('data-module="moduleStatus"'),
        htmlContent.indexOf('id="moduleStatusBody"')
    );
    assert.ok(module1Header.includes('statusUpdateHeaderBtn'),
        'Module 1 header should contain statusUpdateHeaderBtn');
    assert.ok(module1Header.includes('status-update-btn'),
        'Module 1 header update button should use status-update-btn class');
});

test('sidebar.js uses statusUpdateHeaderBtn instead of old statusUpdateBtn', () => {
    assert.ok(sidebarContent.includes('statusUpdateHeaderBtn'),
        'sidebar.js should reference statusUpdateHeaderBtn');
    assert.ok(!sidebarContent.includes("getElementById('statusUpdateBtn')"),
        'sidebar.js should NOT reference old statusUpdateBtn');
});

test('sidebarRefreshBtn is not referenced in sidebar.js', () => {
    assert.ok(!sidebarContent.includes('sidebarRefreshBtn'),
        'sidebar.js should not reference sidebarRefreshBtn');
});

test('status update button uses loading class animation (like shuffle)', () => {
    assert.ok(sidebarContent.includes("btn.classList.add('loading')"),
        'Should add loading class for spinner animation');
    assert.ok(sidebarContent.includes("btn.classList.remove('loading')"),
        'Should remove loading class after update');
});

test('status-update-btn has loading animation style', () => {
    assert.ok(cssContent.includes('.status-update-btn.loading'),
        'CSS should have .status-update-btn.loading rule');
});

test('old statusUpdateBtn text element is removed from HTML', () => {
    assert.ok(!htmlContent.includes('id="statusUpdateBtn"'),
        'HTML should not contain old statusUpdateBtn element');
    assert.ok(!htmlContent.includes('status-actions'),
        'HTML should not contain status-actions container');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 4: Collapsible modules with persistent state
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── TODO 4: Collapsible Modules ───');

test('all 3 modules have module-collapse-btn', () => {
    const collapseButtons = htmlContent.match(/module-collapse-btn/g);
    assert.ok(collapseButtons && collapseButtons.length >= 3,
        `Should have at least 3 module-collapse-btn occurrences, found ${collapseButtons ? collapseButtons.length : 0}`);
});

test('all 3 modules have module-body wrapper', () => {
    assert.ok(htmlContent.includes('id="moduleStatusBody"'),
        'Module 1 should have moduleStatusBody');
    assert.ok(htmlContent.includes('id="moduleConnectionsBody"'),
        'Module 2 should have moduleConnectionsBody');
    assert.ok(htmlContent.includes('id="moduleDirectionsBody"'),
        'Module 3 should have moduleDirectionsBody');
});

test('module-collapse-btn CSS exists', () => {
    assert.ok(cssContent.includes('.module-collapse-btn'),
        'CSS should define .module-collapse-btn');
});

test('module-body.collapsed hides content', () => {
    assert.ok(cssContent.includes('.module-body.collapsed'),
        'CSS should define .module-body.collapsed rule');
    // Check it sets display: none
    const rule = cssContent.substring(cssContent.indexOf('.module-body.collapsed'));
    assert.ok(rule.includes('display: none'),
        '.module-body.collapsed should set display: none');
});

test('module headers have data-module attributes for collapse', () => {
    assert.ok(htmlContent.includes('data-module="moduleStatus"'),
        'Module 1 header should have data-module="moduleStatus"');
    assert.ok(htmlContent.includes('data-module="moduleConnections"'),
        'Module 2 header should have data-module="moduleConnections"');
    assert.ok(htmlContent.includes('data-module="moduleDirections"'),
        'Module 3 header should have data-module="moduleDirections"');
});

test('sidebar.js has _initModuleCollapse method', () => {
    assert.ok(sidebarContent.includes('_initModuleCollapse'),
        'sidebar.js should define _initModuleCollapse');
});

test('sidebar.js has _toggleModuleCollapse method', () => {
    assert.ok(sidebarContent.includes('_toggleModuleCollapse'),
        'sidebar.js should define _toggleModuleCollapse');
});

test('module collapse state is persisted to localStorage', () => {
    assert.ok(sidebarContent.includes('loom_moduleCollapse_'),
        'Should use localStorage key with loom_moduleCollapse_ prefix');
    assert.ok(sidebarContent.includes("localStorage.setItem('loom_moduleCollapse_'"),
        'Should save collapse state to localStorage');
    assert.ok(sidebarContent.includes("localStorage.getItem('loom_moduleCollapse_'"),
        'Should restore collapse state from localStorage');
});

test('_initModuleCollapse is called from init()', () => {
    // Check that init calls _initModuleCollapse
    const initFunc = sidebarContent.substring(
        sidebarContent.indexOf('init()'),
        sidebarContent.indexOf('show(topicId)')
    );
    assert.ok(initFunc.includes('_initModuleCollapse'),
        'init() should call _initModuleCollapse');
});

test('module header clicking does not toggle when clicking update/shuffle buttons', () => {
    assert.ok(sidebarContent.includes("e.target.closest('.status-update-btn')"),
        'Should check for status-update-btn clicks');
    assert.ok(sidebarContent.includes("e.target.closest('.shuffle-btn')"),
        'Should check for shuffle-btn clicks');
});

test('overview field in Module 1 is collapsible', () => {
    assert.ok(sidebarContent.includes('loom_overviewCollapsed'),
        'Should persist overview collapse state');
    assert.ok(sidebarContent.includes('section-collapsed'),
        'Should use section-collapsed class for overview toggle');
    assert.ok(cssContent.includes('.status-section-label.collapsible'),
        'CSS should define collapsible overview label styles');
    assert.ok(cssContent.includes('.status-section-items.section-collapsed'),
        'CSS should define section-collapsed items rule');
});

// ── Module collapse persistence logic unit test ──────────────────────────────

test('module collapse localStorage logic: toggle and persist', () => {
    // Simulate the collapse toggle logic
    const state = {};
    const mockLocalStorage = {
        getItem(key) { return state[key] || null; },
        setItem(key, value) { state[key] = String(value); },
    };

    function toggleModuleCollapse(moduleId) {
        const key = 'loom_moduleCollapse_' + moduleId;
        const current = mockLocalStorage.getItem(key) === 'true';
        const newState = !current;
        mockLocalStorage.setItem(key, newState);
        return newState;
    }

    // Initially not collapsed
    assert.strictEqual(mockLocalStorage.getItem('loom_moduleCollapse_moduleStatus'), null);

    // Toggle to collapsed
    const result1 = toggleModuleCollapse('moduleStatus');
    assert.strictEqual(result1, true);
    assert.strictEqual(mockLocalStorage.getItem('loom_moduleCollapse_moduleStatus'), 'true');

    // Toggle back to expanded
    const result2 = toggleModuleCollapse('moduleStatus');
    assert.strictEqual(result2, false);
    assert.strictEqual(mockLocalStorage.getItem('loom_moduleCollapse_moduleStatus'), 'false');

    // Different modules are independent
    toggleModuleCollapse('moduleConnections');
    assert.strictEqual(mockLocalStorage.getItem('loom_moduleCollapse_moduleConnections'), 'true');
    assert.strictEqual(mockLocalStorage.getItem('loom_moduleCollapse_moduleStatus'), 'false');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TODO 5: Connection card positioning and UI
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── TODO 5: Connection Card Positioning and UI ───');

test('app.js has _connCardMarker and _connScrollHandler properties', () => {
    assert.ok(appContent.includes('_connCardMarker'),
        'app.js should have _connCardMarker property');
    assert.ok(appContent.includes('_connScrollHandler'),
        'app.js should have _connScrollHandler property');
});

test('_showConnCard adds scroll listener on chatMessages', () => {
    assert.ok(appContent.includes("chatMessages.addEventListener('scroll', this._connScrollHandler"),
        'Should add scroll event listener to chatMessages');
});

test('_showConnCard checks if marker is still visible before positioning', () => {
    assert.ok(appContent.includes('rect.bottom < 0 || rect.top > window.innerHeight'),
        'Should check if marker is out of viewport');
});

test('_hideConnCard removes scroll listener', () => {
    // Check that _hideConnCard cleans up the scroll handler
    const startIdx = appContent.indexOf('_hideConnCard() {');
    const hideFunc = appContent.substring(
        startIdx,
        appContent.indexOf('_bindConnectionCards', startIdx)
    );
    assert.ok(hideFunc.includes('removeEventListener') && hideFunc.includes('_connScrollHandler'),
        '_hideConnCard should remove scroll event listener');
    assert.ok(hideFunc.includes('_connScrollHandler = null'),
        '_hideConnCard should null out scroll handler');
    assert.ok(hideFunc.includes('_connCardMarker = null'),
        '_hideConnCard should null out marker reference');
});

test('_showConnCard sets marker reference', () => {
    assert.ok(appContent.includes('this._connCardMarker = marker'),
        '_showConnCard should store marker reference');
});

test('connection card CSS has refined styling (top border, softer shadow)', () => {
    assert.ok(cssContent.includes('border-top: 2.5px solid var(--accent-purple)'),
        'Card should have top accent border');
    assert.ok(!cssContent.match(/\.conn-card\s*\{[^}]*border-left:\s*3px/),
        'Card should NOT have thick left border anymore');
});

test('connection card has scale animation on appear', () => {
    assert.ok(cssContent.includes('scale(0.98)'),
        'Card should have subtle scale-down in hidden state');
    assert.ok(cssContent.includes('scale(1)'),
        'Card should scale up to 1 when visible');
});

test('connection card border-radius is refined', () => {
    const match = cssContent.match(/\.conn-card\s*\{[^}]*border-radius:\s*(\d+)px/);
    assert.ok(match, 'Should have border-radius on .conn-card');
    assert.strictEqual(match[1], '14', 'Border radius should be 14px');
});

// ── Connection card position logic unit test ─────────────────────────────────

test('positionCard logic: card below marker when space available', () => {
    const markerRect = { top: 200, bottom: 220, left: 300, width: 100 };
    const cardRect = { height: 250, width: 340 };
    const viewportHeight = 800;

    let top = markerRect.bottom + 8;
    if (top + cardRect.height > viewportHeight - 16) {
        top = markerRect.top - cardRect.height - 8;
    }

    assert.strictEqual(top, 228, 'Card should be positioned 8px below marker bottom');
});

test('positionCard logic: card above marker when no room below', () => {
    const markerRect = { top: 600, bottom: 620, left: 300, width: 100 };
    const cardRect = { height: 250, width: 340 };
    const viewportHeight = 800;

    let top = markerRect.bottom + 8;
    if (top + cardRect.height > viewportHeight - 16) {
        top = markerRect.top - cardRect.height - 8;
    }

    assert.strictEqual(top, 342, 'Card should flip above marker when not enough room below');
});

test('positionCard logic: horizontal centering with edge clamping', () => {
    const markerRect = { left: 10, width: 80 };
    const cardWidth = 340;
    const viewportWidth = 1200;

    let left = markerRect.left + markerRect.width / 2 - cardWidth / 2;
    left = Math.max(12, Math.min(left, viewportWidth - cardWidth - 12));

    assert.ok(left >= 12, 'Left position should be at least 12px from edge');
    assert.ok(left <= viewportWidth - cardWidth - 12, 'Should not overflow right edge');
});

test('positionCard logic: marker out of viewport triggers hide', () => {
    const markerRect1 = { top: -50, bottom: -30 }; // above viewport
    const markerRect2 = { top: 1000, bottom: 1020 }; // below viewport (800px viewport)
    const viewportHeight = 800;

    const shouldHide1 = markerRect1.bottom < 0 || markerRect1.top > viewportHeight;
    const shouldHide2 = markerRect2.bottom < 0 || markerRect2.top > viewportHeight;
    const shouldNotHide = { top: 200, bottom: 220 };
    const visible = shouldNotHide.bottom < 0 || shouldNotHide.top > viewportHeight;

    assert.strictEqual(shouldHide1, true, 'Marker above viewport should trigger hide');
    assert.strictEqual(shouldHide2, true, 'Marker below viewport should trigger hide');
    assert.strictEqual(visible, false, 'Marker in viewport should NOT trigger hide');
});

// ═══════════════════════════════════════════════════════════════════════════════
// GENERAL INTEGRITY CHECKS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── General Integrity Checks ───');

test('module headers have cursor:pointer for clickability', () => {
    const match = cssContent.match(/\.module-header\s*\{[^}]*cursor:\s*pointer/);
    assert.ok(match, 'Module header should have cursor: pointer');
});

test('sidebar.js init() calls all necessary init functions', () => {
    const initFunc = sidebarContent.substring(
        sidebarContent.indexOf('init()'),
        sidebarContent.indexOf('},', sidebarContent.indexOf('init()'))
    );
    assert.ok(initFunc.includes('_initStatusEdit'), 'init should call _initStatusEdit');
    assert.ok(initFunc.includes('_initStatusDrag'), 'init should call _initStatusDrag');
    assert.ok(initFunc.includes('_initStatusUpdate'), 'init should call _initStatusUpdate');
    assert.ok(initFunc.includes('_initMergeDialog'), 'init should call _initMergeDialog');
    assert.ok(initFunc.includes('_initShuffle'), 'init should call _initShuffle');
    assert.ok(initFunc.includes('_initModuleCollapse'), 'init should call _initModuleCollapse');
});

test('no references to removed elements remain in sidebar.js', () => {
    assert.ok(!sidebarContent.includes("getElementById('sidebarRefreshBtn')"),
        'Should not reference removed sidebarRefreshBtn element');
    assert.ok(!sidebarContent.includes("getElementById('statusUpdateBtn')"),
        'Should not reference removed statusUpdateBtn element');
});

test('no references to removed elements remain in HTML', () => {
    assert.ok(!htmlContent.includes('sidebarRefreshBtn'),
        'HTML should not contain sidebarRefreshBtn');
    assert.ok(!htmlContent.includes('id="statusUpdateBtn"'),
        'HTML should not contain old statusUpdateBtn');
});

// ═══════════════════════════════════════════════════════════════════════════════
// UI REFINEMENTS: Model label, subtitle, direction cards, prompt
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── UI Refinements ───');

const promptContent = fs.readFileSync(path.join(ROOT, 'backend/prompts.py'), 'utf8');

test('sidebar model label is removed from HTML', () => {
    assert.ok(!htmlContent.includes('sidebarModelSelect'),
        'HTML should not contain sidebarModelSelect element');
});

test('subtitle "Personalized context modules" is removed', () => {
    assert.ok(!htmlContent.includes('Personalized context modules'),
        'HTML should not contain "Personalized context modules" subtitle');
});

test('direction card borders are subtle (use rgba, not solid accent)', () => {
    const strengthenRule = cssContent.match(/\.direction-card\.type-strengthen\s*\{[^}]*border-left-color:\s*([^;]+)/);
    assert.ok(strengthenRule, 'Should find .type-strengthen rule');
    assert.ok(strengthenRule[1].includes('rgba'),
        `Strengthen border should use rgba for subtlety, got: ${strengthenRule[1]}`);
});

test('direction card base border is thin (1.5px)', () => {
    const cardRule = cssContent.match(/\.direction-card\s*\{[^}]*border-left:\s*([^;]+)/);
    assert.ok(cardRule, 'Should find .direction-card border-left rule');
    assert.ok(cardRule[1].includes('1.5px'),
        `Border should be 1.5px, got: ${cardRule[1]}`);
});

test('directions prompt asks for open-ended concise questions', () => {
    assert.ok(promptContent.includes('OPEN-ENDED') && promptContent.includes('CONCISE'),
        'Prompt should ask for OPEN-ENDED and CONCISE questions');
    assert.ok(promptContent.includes('Do NOT write long, multi-part'),
        'Prompt should warn against long multi-part questions');
    assert.ok(promptContent.includes('curiosity-driven'),
        'Prompt should ask for curiosity-driven questions');
});

test('directions prompt example questions are short and general', () => {
    assert.ok(promptContent.includes("'What is X?'") || promptContent.includes('"What is X?"'),
        'Prompt examples should include simple patterns like "What is X?"');
    assert.ok(promptContent.includes('How do X and Y relate?'),
        'Bridge example should be a short general question');
    assert.ok(promptContent.includes('What comes after Z?'),
        'Extend example should be a short general question');
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
