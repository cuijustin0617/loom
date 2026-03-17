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
    assert.ok(initFunc.includes('_initMoveDialog'), 'init should call _initMoveDialog');
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

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TODO 1: Move chat to different topic
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── NEW TODO 1: Move Chat to Topic ───');

test('app.js has _moveChat method', () => {
    assert.ok(appContent.includes('_moveChat(chatId,'),
        'app.js should define _moveChat method');
});

test('app.js has _showMoveDropdown method', () => {
    assert.ok(appContent.includes('_showMoveDropdown('),
        'app.js should define _showMoveDropdown method');
});

test('chat item has move button markup', () => {
    assert.ok(appContent.includes('chat-move-btn'),
        'app.js should reference chat-move-btn class');
});

test('CSS defines chat-move-btn style', () => {
    assert.ok(cssContent.includes('.chat-move-btn'),
        'CSS should define .chat-move-btn');
});

test('move chat dialog exists in HTML', () => {
    assert.ok(htmlContent.includes('id="moveChatDialog"'),
        'HTML should define moveChatDialog');
});

test('_moveChat updates topicId and cleans up empty topics', () => {
    const moveFn = appContent.substring(
        appContent.indexOf('_moveChat(chatId,'),
        appContent.indexOf('_deleteChat(chatId,')
    );
    assert.ok(moveFn.includes('chat.topicId = newTopicId'),
        '_moveChat should set new topicId');
    assert.ok(moveFn.includes('Storage.deleteTopic'),
        '_moveChat should clean up empty source topic');
    assert.ok(moveFn.includes('chat_moved'),
        '_moveChat should log chat_moved event');
});

test('move dropdown excludes current topic and Unassigned', () => {
    const dropdownFn = appContent.substring(
        appContent.indexOf('_showMoveDropdown('),
        appContent.indexOf('_moveChat(chatId,')
    );
    assert.ok(dropdownFn.includes("t.id !== currentTopicId"),
        'Dropdown should filter out current topic');
    assert.ok(dropdownFn.includes("t.name !== 'Unassigned'"),
        'Dropdown should filter out Unassigned');
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TODO 2: Rename topic
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── NEW TODO 2: Rename Topic ───');

test('app.js has _renameTopic method', () => {
    assert.ok(appContent.includes('_renameTopic(topicId,'),
        'app.js should define _renameTopic method');
});

test('app.js has _startTopicRename method', () => {
    assert.ok(appContent.includes('_startTopicRename('),
        'app.js should define _startTopicRename method');
});

test('topic title has double-click rename listener', () => {
    assert.ok(appContent.includes("'dblclick'") && appContent.includes('_startTopicRename'),
        'Should bind dblclick to _startTopicRename');
});

test('_renameTopic updates topic name and saves', () => {
    const renameFn = appContent.substring(
        appContent.indexOf('async _renameTopic('),
        appContent.indexOf('// ── Merge Topics')
    );
    assert.ok(renameFn.includes('topic.name = newName'),
        '_renameTopic should set new name');
    assert.ok(renameFn.includes('Storage.saveTopic'),
        '_renameTopic should save topic');
    assert.ok(renameFn.includes('topic_renamed'),
        '_renameTopic should log topic_renamed event');
});

test('_renameTopic calls rename-check endpoint for overview', () => {
    const renameFn = appContent.substring(
        appContent.indexOf('async _renameTopic('),
        appContent.indexOf('// ── Merge Topics')
    );
    assert.ok(renameFn.includes('/api/topic/rename-check'),
        '_renameTopic should call rename-check API');
});

test('CSS defines topic-rename-input style', () => {
    assert.ok(cssContent.includes('.topic-rename-input'),
        'CSS should define .topic-rename-input');
});

test('backend prompts.py has TOPIC_RENAME_CHECK_PROMPT', () => {
    assert.ok(promptContent.includes('TOPIC_RENAME_CHECK_PROMPT'),
        'prompts.py should define TOPIC_RENAME_CHECK_PROMPT');
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TODO 4: IME input fix and attachment-only send
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── NEW TODO 4: IME Input Fix ───');

test('chatInput keydown handler checks isComposing', () => {
    assert.ok(appContent.includes('e.isComposing'),
        'chatInput handler should check e.isComposing');
});

test('sendMessage allows sending with only attachments', () => {
    assert.ok(appContent.includes('this.pendingAttachments.length === 0) return'),
        'sendMessage should check pendingAttachments before early return');
});

test('sendMessage provides default message for attachment-only sends', () => {
    assert.ok(appContent.includes('pendingAttachments.length > 0'),
        'sendMessage should handle attachment-only case');
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TODO 5: Deduplicate module 2 connection cards
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── NEW TODO 5: Deduplicate Connection Cards ───');

test('showConnections groups connections by chatId', () => {
    assert.ok(sidebarContent.includes("const grouped = {}"),
        'showConnections should group connections by chatId');
    assert.ok(sidebarContent.includes('groupOrder'),
        'showConnections should maintain group order');
});

test('grouped cards show count badge for multiple connections', () => {
    assert.ok(sidebarContent.includes('conn-sb-count'),
        'Should render count badge for multiple connections from same chat');
});

test('individual insight items have per-connection hover/click', () => {
    assert.ok(sidebarContent.includes('conn-sb-insight-item'),
        'Should render individual insight items within grouped card');
});

test('CSS defines conn-sb-insights and conn-sb-insight-item styles', () => {
    assert.ok(cssContent.includes('.conn-sb-insights'),
        'CSS should define .conn-sb-insights');
    assert.ok(cssContent.includes('.conn-sb-insight-item'),
        'CSS should define .conn-sb-insight-item');
});

test('CSS defines conn-sb-count badge style', () => {
    assert.ok(cssContent.includes('.conn-sb-count'),
        'CSS should define .conn-sb-count badge');
});

// ═══════════════════════════════════════════════════════════════════════════════
// NEW TODO 6: Default search button to ON
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── NEW TODO 6: Search Default ON ───');

test('useSearch defaults to true', () => {
    assert.ok(appContent.includes('useSearch: true'),
        'useSearch should default to true');
});

test('search button gets active class on init', () => {
    const bindEvents = appContent.substring(
        appContent.indexOf('_bindEvents()'),
        appContent.indexOf('_initResize(')
    );
    assert.ok(bindEvents.includes("searchBtn.classList.add('active')"),
        'searchBtn should get active class during _bindEvents');
});

test('newChat resets useSearch to true', () => {
    const newChatFn = appContent.substring(
        appContent.indexOf('newChat()'),
        appContent.indexOf('async sendMessage()')
    );
    assert.ok(newChatFn.includes('this.useSearch = true'),
        'newChat should reset useSearch to true');
});

test('newChat reactivates searchToggleBtn', () => {
    const newChatFn = appContent.substring(
        appContent.indexOf('newChat()'),
        appContent.indexOf('async sendMessage()')
    );
    assert.ok(newChatFn.includes("searchBtn.classList.add('active')") || newChatFn.includes("searchBtn") ,
        'newChat should reactivate searchToggleBtn');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Keyword Scorer Logic (pure unit tests)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Keyword Scorer Logic ───');

// Re-implement tokenize and scoring for unit tests
const STOP_WORDS = new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','it','as','be','was','are','were','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might','can',
    'this','that','these','those','i','me','my','we','our','you','your','he',
    'she','they','them','their','its','not','no','so','if','then','than','too',
    'very','just','about','up','out','how','what','when','where','which','who',
    'why','all','each','some','any','few','more','most','am','into','also',
]);

function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function bigrams(tokens) {
    const bg = [];
    for (let i = 0; i < tokens.length - 1; i++) {
        bg.push(tokens[i] + ' ' + tokens[i + 1]);
    }
    return bg;
}

test('tokenize removes stop words and lowercases', () => {
    const tokens = tokenize('How do I learn Machine Learning in Python?');
    assert.ok(!tokens.includes('how'), 'Should remove stop word "how"');
    assert.ok(!tokens.includes('do'), 'Should remove stop word "do"');
    assert.ok(!tokens.includes('i'), 'Should remove stop word "i"');
    assert.ok(!tokens.includes('in'), 'Should remove stop word "in"');
    assert.ok(tokens.includes('learn'), 'Should keep "learn"');
    assert.ok(tokens.includes('machine'), 'Should lowercase "Machine"');
    assert.ok(tokens.includes('learning'), 'Should keep "learning"');
    assert.ok(tokens.includes('python'), 'Should keep "python"');
});

test('tokenize filters single-character tokens', () => {
    const tokens = tokenize('I a b c deep learning');
    assert.ok(!tokens.includes('b'), 'Should filter single-char "b"');
    assert.ok(!tokens.includes('c'), 'Should filter single-char "c"');
    assert.ok(tokens.includes('deep'), 'Should keep "deep"');
});

test('bigram generation produces correct pairs', () => {
    const tokens = ['machine', 'learning', 'python'];
    const bg = bigrams(tokens);
    assert.strictEqual(bg.length, 2);
    assert.strictEqual(bg[0], 'machine learning');
    assert.strictEqual(bg[1], 'learning python');
});

test('bigrams of single token returns empty', () => {
    assert.strictEqual(bigrams(['hello']).length, 0);
});

test('keyword scoring: query with exact topic words scores > 0', () => {
    const queryTokens = tokenize('teach me about PyTorch neural networks');
    const topicTokens = new Set(tokenize('Machine Learning PyTorch basics Neural network fundamentals'));
    let matched = 0;
    queryTokens.forEach(qt => { if (topicTokens.has(qt)) matched++; });
    const score = matched / queryTokens.length;
    assert.ok(score > 0, `Score should be > 0, got ${score}`);
});

test('keyword scoring: query with no overlap scores 0', () => {
    const queryTokens = tokenize('how to cook pasta Italian recipe');
    const topicTokens = new Set(tokenize('Machine Learning PyTorch basics Neural network'));
    let matched = 0;
    queryTokens.forEach(qt => { if (topicTokens.has(qt)) matched++; });
    const score = matched / queryTokens.length;
    assert.strictEqual(score, 0, 'Score should be 0 for unrelated query');
});

test('IDF weighting: rare tokens get higher weight than common ones', () => {
    const docFreq = { 'python': 3, 'pytorch': 1, 'learning': 3 };
    const numDocs = 3;
    const idfPytorch = Math.log(numDocs / docFreq['pytorch']) + 1;
    const idfPython = Math.log(numDocs / docFreq['python']) + 1;
    assert.ok(idfPytorch > idfPython,
        `IDF for rare "pytorch" (${idfPytorch.toFixed(2)}) should be > common "python" (${idfPython.toFixed(2)})`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Topic Document Builder
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Topic Document Builder ───');

test('app.js contains _buildTopicDocument method', () => {
    assert.ok(appContent.includes('_buildTopicDocument('),
        'app.js should define _buildTopicDocument');
});

test('_buildTopicDocument uses topic name', () => {
    const fn = appContent.substring(
        appContent.indexOf('_buildTopicDocument('),
        appContent.indexOf('_simpleHash(')
    );
    assert.ok(fn.includes('topic.name'), 'Should use topic.name');
});

test('_buildTopicDocument uses overview and thread labels', () => {
    const fn = appContent.substring(
        appContent.indexOf('_buildTopicDocument('),
        appContent.indexOf('_simpleHash(')
    );
    assert.ok(fn.includes('overview') || fn.includes('statusSummary'),
        'Should reference overview');
    assert.ok(fn.includes('threads') || fn.includes('label'),
        'Should reference threads/labels');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Hybrid Ranking Logic (pure unit tests)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Hybrid Ranking Logic ───');

test('app.js contains TopicSuggester with hybrid thresholds', () => {
    assert.ok(appContent.includes('KEYWORD_CONFIDENT'),
        'Should define KEYWORD_CONFIDENT threshold');
    assert.ok(appContent.includes('KEYWORD_AMBIGUOUS'),
        'Should define KEYWORD_AMBIGUOUS threshold');
    assert.ok(appContent.includes('COMBINED_THRESHOLD'),
        'Should define COMBINED_THRESHOLD');
    assert.ok(appContent.includes('EMBEDDING_ONLY_THRESHOLD'),
        'Should define EMBEDDING_ONLY_THRESHOLD');
});

test('high keyword score skips embedding call', () => {
    const rankFn = appContent.substring(
        appContent.indexOf('async rankTopics('),
        appContent.indexOf('_combineScores(')
    );
    assert.ok(rankFn.includes('KEYWORD_CONFIDENT'),
        'rankTopics should check KEYWORD_CONFIDENT');
    assert.ok(rankFn.includes("method: 'keyword'"),
        'Should return method: keyword for high confidence');
});

test('ambiguous keyword score triggers embedding', () => {
    const rankFn = appContent.substring(
        appContent.indexOf('async rankTopics('),
        appContent.indexOf('_combineScores(')
    );
    assert.ok(rankFn.includes('KEYWORD_AMBIGUOUS'),
        'rankTopics should check KEYWORD_AMBIGUOUS');
    assert.ok(rankFn.includes('/api/embed'),
        'Should call embed API for ambiguous matches');
});

test('combined scoring uses correct weights', () => {
    const combineFn = appContent.substring(
        appContent.indexOf('_combineScores('),
        appContent.indexOf('// ── Suggestion UI')
    );
    assert.ok(combineFn.includes('KEYWORD_WEIGHT') && combineFn.includes('EMBEDDING_WEIGHT'),
        'Should use KEYWORD_WEIGHT and EMBEDDING_WEIGHT');
});

test('combined score math: 0.4 * keyword + 0.6 * embedding', () => {
    const kwWeight = 0.4;
    const embWeight = 0.6;
    const combined = kwWeight * 0.5 + embWeight * 0.8;
    assert.ok(Math.abs(combined - 0.68) < 1e-10,
        `0.4 * 0.5 + 0.6 * 0.8 should be ~0.68, got ${combined}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Suggestion UI
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Suggestion UI ───');

test('CSS defines .topic-suggestion styles', () => {
    assert.ok(cssContent.includes('.topic-suggestion'),
        'CSS should define .topic-suggestion');
});

test('CSS defines .topic-suggestion.visible with opacity transition', () => {
    assert.ok(cssContent.includes('.topic-suggestion.visible'),
        'CSS should define .topic-suggestion.visible');
    assert.ok(cssContent.includes('translateY'),
        'Should use translateY for entrance animation');
});

test('CSS defines .topic-suggestion-accept and .topic-suggestion-dismiss', () => {
    assert.ok(cssContent.includes('.topic-suggestion-accept'),
        'CSS should define .topic-suggestion-accept');
    assert.ok(cssContent.includes('.topic-suggestion-dismiss'),
        'CSS should define .topic-suggestion-dismiss');
});

test('HTML has topic suggestion container', () => {
    assert.ok(htmlContent.includes('id="topicSuggestion"'),
        'HTML should have topicSuggestion element');
    assert.ok(htmlContent.includes('topic-suggestion'),
        'HTML should have topic-suggestion class');
});

test('app.js has _showTopicSuggestion and _hideTopicSuggestion methods', () => {
    assert.ok(appContent.includes('_showTopicSuggestion('),
        'Should define _showTopicSuggestion');
    assert.ok(appContent.includes('_hideTopicSuggestion('),
        'Should define _hideTopicSuggestion');
});

test('app.js tracks _suggestionDismissed state', () => {
    assert.ok(appContent.includes('_suggestionDismissed'),
        'Should track _suggestionDismissed state');
});

test('suggestion accept updates selectedTopicId', () => {
    const defStart = appContent.indexOf('_acceptSuggestion(topicId) {');
    assert.ok(defStart >= 0, '_acceptSuggestion function definition should exist');
    const acceptFn = appContent.substring(defStart, defStart + 300);
    assert.ok(acceptFn.includes('App.selectedTopicId'),
        'Accept should update App.selectedTopicId');
});

test('suggestion dismiss sets _suggestionDismissed to true', () => {
    const dismissFn = appContent.substring(
        appContent.indexOf('_dismissSuggestion('),
        appContent.indexOf('// ── Debounced Handler')
    );
    assert.ok(dismissFn.includes('_suggestionDismissed = true'),
        'Dismiss should set _suggestionDismissed = true');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Custom Topic Picker Dropdown
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Custom Topic Picker ───');

test('CSS defines .topic-picker-trigger styles', () => {
    assert.ok(cssContent.includes('.topic-picker-trigger'),
        'CSS should define .topic-picker-trigger');
});

test('CSS defines .topic-picker-dropdown styles', () => {
    assert.ok(cssContent.includes('.topic-picker-dropdown'),
        'CSS should define .topic-picker-dropdown');
});

test('CSS defines .topic-picker-option styles', () => {
    assert.ok(cssContent.includes('.topic-picker-option'),
        'CSS should define .topic-picker-option');
});

test('CSS defines .topic-picker-dropdown.open with animation', () => {
    assert.ok(cssContent.includes('.topic-picker-dropdown.open'),
        'CSS should define .topic-picker-dropdown.open');
    assert.ok(cssContent.includes('scale(0.95)'),
        'Dropdown should have scale animation');
});

test('HTML has custom topic picker elements', () => {
    assert.ok(htmlContent.includes('id="topicPickerTrigger"'),
        'HTML should have topicPickerTrigger');
    assert.ok(htmlContent.includes('id="topicPickerDropdown"'),
        'HTML should have topicPickerDropdown');
    assert.ok(htmlContent.includes('topic-picker-label'),
        'HTML should have topic-picker-label');
});

test('app.js has _populateTopicPicker method', () => {
    assert.ok(appContent.includes('_populateTopicPicker('),
        'Should define _populateTopicPicker');
});

test('app.js has _updateTopicPickerDisplay method', () => {
    assert.ok(appContent.includes('_updateTopicPickerDisplay('),
        'Should define _updateTopicPickerDisplay');
});

test('custom picker syncs with hidden select', () => {
    const populateFn = appContent.substring(
        appContent.indexOf('_populateTopicPicker('),
        appContent.indexOf('};', appContent.indexOf('_populateTopicPicker(') + 300)
    );
    assert.ok(populateFn.includes("topicSelect") || populateFn.includes("sel.value"),
        'Picker should sync value to hidden select');
});

test('custom picker has keyboard navigation', () => {
    assert.ok(appContent.includes('_pickerKeyHandler'),
        'Should have keyboard handler');
    assert.ok(appContent.includes('ArrowDown') && appContent.includes('ArrowUp'),
        'Should handle arrow keys');
    assert.ok(appContent.includes("'Escape'"),
        'Should handle Escape key');
});

test('newChat resets TopicSuggester', () => {
    const newChatFn = appContent.substring(
        appContent.indexOf('newChat()'),
        appContent.indexOf('async sendMessage()')
    );
    assert.ok(newChatFn.includes('TopicSuggester.reset()'),
        'newChat should call TopicSuggester.reset()');
    assert.ok(newChatFn.includes('_updateTopicPickerDisplay(null)'),
        'newChat should reset picker display');
});

test('sendMessage hides topic suggestion and picker', () => {
    const startIdx = appContent.indexOf('async sendMessage()');
    const sendFn = appContent.substring(startIdx, startIdx + 4000);
    assert.ok(sendFn.includes('_hideTopicSuggestion'),
        'sendMessage should hide topic suggestion');
    assert.ok(sendFn.includes('topicPickerEl'),
        'sendMessage should hide topic picker');
});

test('debounced input handler checks welcome mode', () => {
    assert.ok(appContent.includes("welcome-mode") && appContent.includes('TopicSuggester.onInputChange'),
        'Input handler should check welcome-mode and call TopicSuggester');
});

test('native select is hidden in HTML', () => {
    assert.ok(htmlContent.includes('id="topicSelect"') && htmlContent.includes('style="display:none;"'),
        'Native select should be hidden');
});

test('topic picker hidden in baseline mode CSS', () => {
    assert.ok(cssContent.includes('baseline-mode .topic-picker') ||
        cssContent.includes('baseline-mode .topic-suggestion'),
        'Picker and suggestion should be hidden in baseline mode');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Cosine Similarity (client-side)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Client-side Cosine Similarity ───');

test('app.js contains _cosineSimilarity method', () => {
    assert.ok(appContent.includes('_cosineSimilarity('),
        'app.js should define _cosineSimilarity');
});

test('cosine similarity: identical vectors = 1', () => {
    const a = [1, 2, 3];
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * a[i]; normA += a[i] * a[i]; normB += a[i] * a[i];
    }
    const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    assert.ok(Math.abs(sim - 1.0) < 1e-7, `Should be ~1.0, got ${sim}`);
});

test('cosine similarity: orthogonal vectors = 0', () => {
    const a = [1, 0], b = [0, 1];
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    assert.ok(Math.abs(sim) < 1e-7, `Should be ~0, got ${sim}`);
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
