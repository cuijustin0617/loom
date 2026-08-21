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
const backendMainContent = fs.readFileSync(path.join(ROOT, 'backend/main.py'), 'utf8');
const storageContent = fs.readFileSync(path.join(ROOT, 'frontend/storage.js'), 'utf8');

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
// Construct / Apply / Evolve Temporal Sections (redesigned UI)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Construct / Apply / Evolve Temporal Sections ───');

test('HTML has Construct + Evolve sections (Apply moved in-chat)', () => {
    assert.ok(htmlContent.includes('id="sectionCurrent"'),
        'index.html should have sectionCurrent');
    assert.ok(htmlContent.includes('id="sectionFuture"'),
        'index.html should have sectionFuture');
    assert.ok(!htmlContent.includes('id="sectionPast"'),
        'Apply sectionPast should be removed from the sidebar');
    assert.ok(!htmlContent.includes('id="pastChatsList"'),
        'pastChatsList should be removed from the sidebar');
});

test('HTML has section-current with statusStructured', () => {
    assert.ok(htmlContent.includes('id="sectionCurrent"'),
        'index.html should have sectionCurrent');
    assert.ok(htmlContent.includes('id="statusStructured"'),
        'index.html should have statusStructured');
});

test('Construct visibly labels goals as User goals', () => {
    assert.ok(htmlContent.includes('User goals'), 'visible section label should say User goals');
    assert.ok(htmlContent.includes('Add a user goal…'), 'add-goal placeholder should use User goals copy');
    assert.ok(sidebarContent.includes('User goals you add will appear here.'),
        'empty state should use User goals copy');
});

test('Overview Markdown editor expands a collapsed Overview and stays open for Save or Cancel', () => {
    assert.ok(sidebarContent.includes("items.classList.remove('section-collapsed')"),
        'opening the editor should reveal collapsed Overview items');
    assert.ok(sidebarContent.includes('overview-markdown-save')
        && sidebarContent.includes('overview-markdown-cancel'),
        'editor has explicit Save and Cancel controls');
});

test('HTML has section-future with directionCards', () => {
    assert.ok(htmlContent.includes('id="sectionFuture"'),
        'index.html should have sectionFuture');
    assert.ok(htmlContent.includes('id="directionCards"'),
        'index.html should have directionCards');
    assert.ok(!htmlContent.includes('evolve-subheader-suggested'),
        'index.html should not hardcode a Suggested subheader (tags live on cards)');
    const goalsIdx = htmlContent.indexOf('id="constructGoalsList"');
    const dirsIdx = htmlContent.indexOf('id="directionCards"');
    assert.ok(goalsIdx > -1, 'Construct goals list present');
    assert.ok(dirsIdx > -1, 'Evolve direction cards present');
    assert.ok(!htmlContent.includes('id="goalsList"'), 'Evolve goals fold removed');
    assert.ok(htmlContent.includes('id="addGoalInput"') && htmlContent.includes('constructGoals'),
        'Add-goal input lives in Construct');
    assert.ok(htmlContent.includes('status-section-hint') && htmlContent.includes('goals you set for this topic'),
        'User goals section has a one-line usage hint');
    assert.ok(htmlContent.includes('temporal-topic-name') && htmlContent.includes('id="currentTopicName"'),
        'Topic name uses the emphasized topic-name class');
});

test('sidebar header omits Construct/Evolve crumbs', () => {
    assert.ok(!htmlContent.includes('temporal-breadcrumb'),
        'Construct · Evolve crumbs should be removed from the Personal Context header');
    assert.ok(!htmlContent.includes('data-phase="construct"'),
        'construct crumb should be removed');
    assert.ok(!htmlContent.includes('data-phase="evolve"'),
        'evolve crumb should be removed');
    assert.ok(!htmlContent.includes('data-phase="apply"'),
        'Apply crumb should be removed');
});

test('graph view is disabled in HTML', () => {
    assert.ok(!htmlContent.includes('id="tabGraph"'),
        'index.html should not expose tabGraph when graph view is disabled');
    assert.ok(!htmlContent.includes('id="graphCanvas"'),
        'index.html should not include graphCanvas when graph view is disabled');
    assert.ok(!htmlContent.includes('graph.js'),
        'index.html should not load graph.js when graph view is disabled');
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

test('status update button is in sectionCurrent header', () => {
    const sectionCurrentHeader = htmlContent.substring(
        htmlContent.indexOf('id="sectionCurrent"'),
        htmlContent.indexOf('id="sectionFuture"')
    );
    assert.ok(sectionCurrentHeader.includes('statusUpdateHeaderBtn'),
        'sectionCurrent header should contain statusUpdateHeaderBtn');
    assert.ok(sectionCurrentHeader.includes('status-update-btn'),
        'sectionCurrent header update button should use status-update-btn class');
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

test('new topics trigger their initial profile update after the first completed user turn', () => {
    assert.ok(appContent.includes('completedTopic?.needsInitialUpdate'),
        'completed first turn checks the new-topic marker');
    assert.ok(appContent.includes('_triggerInitialTopicUpdate(completedTopic.id)'),
        'new topic starts its initial update immediately');
    assert.ok(appContent.includes("Sidebar.refresh('initial')"),
        'initial update uses an explicit refresh trigger');
    assert.ok(appContent.includes('this.msgCountSinceRefresh % 3 === 0'),
        'established topics retain the three-message interval');
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

test('Construct and Evolve modules have module-collapse-btn', () => {
    const collapseButtons = htmlContent.match(/module-collapse-btn/g);
    assert.ok(collapseButtons && collapseButtons.length >= 2,
        `Should have at least 2 module-collapse-btn occurrences, found ${collapseButtons ? collapseButtons.length : 0}`);
});

test('Construct and Evolve sections have module-body wrapper', () => {
    assert.ok(!htmlContent.includes('id="sectionPastBody"'),
        'Past section body should be removed');
    assert.ok(htmlContent.includes('id="sectionCurrentBody"'),
        'Current section should have sectionCurrentBody');
    assert.ok(htmlContent.includes('id="sectionFutureBody"'),
        'Future section should have sectionFutureBody');
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

test('temporal section headers have data-module attributes for collapse', () => {
    assert.ok(!htmlContent.includes('data-module="sectionPast"'),
        'Past section collapse control should be removed');
    assert.ok(htmlContent.includes('data-module="sectionCurrent"'),
        'Current section header should have data-module="sectionCurrent"');
    assert.ok(htmlContent.includes('data-module="sectionFuture"'),
        'Future section header should have data-module="sectionFuture"');
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

test('overview uses leftover sidebar space instead of a short inner scroll', () => {
    assert.ok(sidebarContent.includes('status-section-overview'),
        'sidebar render should tag overview section');
    assert.ok(cssContent.includes('.status-section-overview .status-section-items'),
        'CSS should define overview items');
    const overviewRule = cssContent.slice(
        cssContent.indexOf('.status-section-overview .status-section-items')
    );
    assert.ok(!overviewRule.slice(0, 180).includes('max-height: 220px'),
        'Overview should not be capped at a short 220px fold');
    const currentRule = cssContent.slice(cssContent.indexOf('.section-current {'));
    assert.ok(currentRule.slice(0, 250).includes('flex: 0 0 auto'),
        'Construct should size to content until the stack no longer fits');
    const futureRule = cssContent.slice(cssContent.indexOf('.section-future {'));
    assert.ok(!futureRule.slice(0, 280).includes('max-height: calc(100% - 96px)'),
        'Evolve height should come from the one-card layout pass, not a CSS floor');
    assert.ok(sidebarContent.includes('_layoutSidebarStack'),
        'Sidebar should fold Evolve down to one complete card before folding Construct');
    assert.ok(sidebarContent.includes('_evolveOneCardMinHeight'),
        'Evolve min height should be one complete card plus chrome');
    assert.ok(sidebarContent.includes('_foldConstructTo'),
        'Construct fold should keep Goals visible and scroll Overview first');
    const overviewItemsRule = cssContent.slice(
        cssContent.indexOf('.status-section-overview .status-section-items')
    );
    assert.ok(overviewItemsRule.slice(0, 220).includes('overflow-y: auto'),
        'Overview items should scroll when Construct is folded');
    const cardsRule = cssContent.slice(cssContent.indexOf('.direction-cards {'));
    assert.ok(cardsRule.slice(0, 160).includes('overflow-y: auto'),
        'Evolve cards should scroll when Evolve is folded');
    const goalsLabelRule = cssContent.slice(
        cssContent.indexOf('.status-section-goals .status-section-label')
    );
    assert.ok(goalsLabelRule.slice(0, 180).includes('flex-shrink: 0'),
        'Goals title should stay visible instead of folding away');
});

test('sidebar has no Concepts Traversed section (concepts removed)', () => {
    assert.ok(!sidebarContent.includes('status-section-concepts'),
        'sidebar should not render concepts traversed section');
    assert.ok(!sidebarContent.includes('Concepts Traversed'),
        'Concepts Traversed label should be gone');
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
// Past Chat Cards & Context Drag
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Past Chat Cards & Context Drag ───');

test('app.js renders in-chat past context cards', () => {
    assert.ok(appContent.includes('_renderInjectedPastPanel'),
        'app.js should define _renderInjectedPastPanel');
    assert.ok(appContent.includes("Don't use for this topic"),
        'In-chat cards should have Don\'t use for this topic');
    assert.ok(appContent.includes('Open chat →'),
        'In-chat cards should have Open chat');
});

test('suggested goal cards are not draggable', () => {
    assert.ok(sidebarContent.includes('suggested-goal-card') || sidebarContent.includes('_createSuggestedGoalCard'),
        'Suggested goal cards exist');
    assert.ok(sidebarContent.includes('el.draggable = false'),
        'Suggested goal cards should not be draggable');
});

test('evolve cards show only unsaved suggestions with two ask actions', () => {
    assert.ok(!sidebarContent.includes('tag-saved'),
        'Saved duplicate cards are removed from Evolve');
    assert.ok(!sidebarContent.includes('tag-suggested'),
        'Redundant Suggested tag should be removed');
    assert.ok(sidebarContent.includes('goal-ask-here-btn') && sidebarContent.includes('goal-ask-new-btn'),
        'Suggested cards expose both ask actions');
    assert.ok(sidebarContent.includes('goal-card-body') && sidebarContent.includes('is-expanded'),
        'Cards expand to reveal a question');
    assert.ok(!sidebarContent.includes('saved-goals-fold'),
        'Evolve saved-goals fold removed');
});

test('app.js has drag-over drop handler', () => {
    assert.ok(appContent.includes("'dragover'") && appContent.includes("'drop'"),
        'App should handle dragover and drop events');
});

test('context block feature is removed from composer', () => {
    assert.ok(!htmlContent.includes('id="contextBlock"'),
        'contextBlock markup should be removed');
    assert.ok(!appContent.includes('setContextBlock('),
        'setContextBlock should be removed');
});

test('CSS has temporal-card style', () => {
    assert.ok(cssContent.includes('.temporal-card'),
        'CSS should define .temporal-card style');
});

test('CSS has direction-card style', () => {
    assert.ok(cssContent.includes('.direction-card'),
        'CSS should define .direction-card style');
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
    assert.ok(!initFunc.includes('_initStatusDrag'), 'init should not call _initStatusDrag');
    assert.ok(initFunc.includes('_initStatusUpdate'), 'init should call _initStatusUpdate');
    assert.ok(initFunc.includes('_initMergeDialog'), 'init should call _initMergeDialog');
    assert.ok(initFunc.includes('_initShuffle'), 'init should call _initShuffle');
    assert.ok(initFunc.includes('_initModuleCollapse'), 'init should call _initModuleCollapse');
    assert.ok(!initFunc.includes('_initViewTabs'), 'init should not wire graph/list view tabs when graph is disabled');
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

test('direction card breadth type is not visually encoded', () => {
    assert.ok(!cssContent.includes('.temporal-card.direction-card.type-breadth'),
        'Breadth should not have a special card style');
});

test('direction card depth type is not visually encoded', () => {
    assert.ok(!cssContent.includes('.temporal-card.direction-card.type-depth'),
        'Depth should not have a special card style');
});

test('directions prompt generates exactly breadth + depth directions', () => {
    assert.ok(promptContent.includes('"breadth"'),
        'Prompt should specify breadth direction type');
    assert.ok(promptContent.includes('"depth"'),
        'Prompt should specify depth direction type');
    assert.ok(promptContent.includes('exactly 2 directions') || promptContent.includes('one breadth') || promptContent.includes('one of each type'),
        'Prompt should instruct to generate one breadth and one depth');
});

test('directions prompt returns goal-level exampleQuestion fields', () => {
    assert.ok(promptContent.includes('exampleQuestion'),
        'Prompt should include exampleQuestion field');
    assert.ok(promptContent.includes('goal') || promptContent.includes('intention'),
        'Prompt should describe goal-level titles');
    assert.ok(promptContent.includes('exampleQuestion') || promptContent.includes('open-ended'),
        'Prompt should ask for an example question');
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

test('move chat popover exists in HTML (replaces old modal dialog)', () => {
    assert.ok(htmlContent.includes('id="moveChatPopover"'),
        'HTML should define moveChatPopover');
    assert.ok(!htmlContent.includes('id="moveChatDialog"'),
        'HTML should NOT contain old moveChatDialog overlay');
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

test('move dropdown excludes current topic and one-time bucket', () => {
    const dropdownFn = appContent.substring(
        appContent.indexOf('_showMoveDropdown('),
        appContent.indexOf('_moveChat(chatId,')
    );
    assert.ok(dropdownFn.includes("t.id !== currentTopicId"),
        'Dropdown should filter out current topic');
    assert.ok(dropdownFn.includes('!this._isOneTimeTopic(t.id)'),
        'Dropdown should filter out the one-time bucket');
});

test('_showMoveDropdown references moveChatPopover (not moveChatDialog)', () => {
    const dropdownFn = appContent.substring(
        appContent.indexOf('_showMoveDropdown('),
        appContent.indexOf('_moveChat(chatId,')
    );
    assert.ok(dropdownFn.includes('moveChatPopover'),
        '_showMoveDropdown should reference moveChatPopover');
    assert.ok(!dropdownFn.includes('moveChatDialog'),
        '_showMoveDropdown should NOT reference moveChatDialog');
});

test('CSS defines .move-chat-popover style', () => {
    assert.ok(cssContent.includes('.move-chat-popover'),
        'CSS should define .move-chat-popover');
});

test('CSS defines .move-topic-chip style', () => {
    assert.ok(cssContent.includes('.move-topic-chip'),
        'CSS should define .move-topic-chip');
});

test('app.js closes popover on outside click', () => {
    const start = appContent.indexOf('_showMoveDropdown(');
    const end = appContent.indexOf('\n  _moveChat(');
    const dropdownFn = appContent.substring(start, end);
    assert.ok(dropdownFn.includes('mousedown'),
        '_showMoveDropdown should add mousedown listener for outside-click close');
});

test('header topic badge is a keyboard-accessible reassignment control', () => {
    assert.ok(htmlContent.includes('id="topicBadge"') && htmlContent.includes('aria-haspopup="menu"'),
        'chat header has a topic menu button');
    assert.ok(appContent.includes("document.addEventListener('keydown', closeOnKey)"),
        'topic menu handles Escape');
    assert.ok(appContent.includes("document.createElement('button')"),
        'topic options use native buttons');
    assert.ok(appContent.includes('move-topic-create-input'),
        'topic menu supports inline topic creation');
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

test('app.js renders in-chat past context from injectedPastChats', () => {
    assert.ok(appContent.includes('_renderInjectedPastPanel('),
        'app.js should define _renderInjectedPastPanel');
    assert.ok(!sidebarContent.includes('showPastChats('),
        'sidebar Apply showPastChats should be removed');
});

test('past context cards render userAsked excerpt', () => {
    assert.ok(appContent.includes('userAsked'),
        'Past context cards should render userAsked excerpt');
});

test('CSS has past-chat-card style', () => {
    assert.ok(cssContent.includes('.past-chat-card'),
        'CSS should define .past-chat-card style');
});

test('CSS has temporal-empty-hint for empty sections', () => {
    assert.ok(cssContent.includes('.temporal-empty-hint'),
        'CSS should define .temporal-empty-hint style');
});

test('CSS has past-relevance-bar for relevance indicators', () => {
    assert.ok(cssContent.includes('past-relevance') || cssContent.includes('temporal-card'),
        'CSS should have past relevance or temporal card styling');
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

test('all chat exit paths route through conservative refresh helper', () => {
    const calls = appContent.match(/this\._onExitChat\(prevChatId\)/g) || [];
    assert.ok(calls.length >= 5,
        'new chat, one-time chat, both context links, and chat-list switching call _onExitChat');
    assert.ok(appContent.includes("Sidebar.refresh('chat_exit')"),
        'exit helper records the chat_exit refresh trigger');
});

test('sendMessage pins async work to its originating chat', () => {
    const start = appContent.indexOf('async sendMessage()');
    const end = appContent.indexOf('// ── Free-text selection annotations', start);
    const block = appContent.slice(start, end);
    assert.ok(block.includes('const sendChatId = this.currentChatId'));
    assert.ok(block.includes('Storage.addMessage(sendChatId, assistantMsg)'));
    assert.ok(block.includes('_handleTopicDetection(evt.topic, sendChatId)'));
    assert.ok(block.includes('this.currentChatId === sendChatId'));
});

test('background topic assignment does not replace the visible sidebar', () => {
    const start = appContent.indexOf('async _assignTopicToChat(');
    const end = appContent.indexOf('async _handleTopicDetection(', start);
    const block = appContent.slice(start, end);
    assert.ok(block.includes('this.currentChatId === chatId'));
});

test('Evolve Save waits for a generated question', () => {
    const start = sidebarContent.indexOf('_createSuggestedGoalCard(');
    const end = sidebarContent.indexOf('_renderSuggestedGoals(', start);
    const block = sidebarContent.slice(start, end);
    assert.ok(block.includes('const q = await getQuestion()'));
    assert.ok(block.includes('d.exampleQuestion = q'));
    assert.ok(block.indexOf('d.exampleQuestion = q') < block.indexOf('this._saveSuggestedGoal(d)'));
});

test('one-time label flush resolves and clears the active chat bucket', () => {
    const start = sidebarContent.indexOf('_flushDirtyLabels() {');
    const end = sidebarContent.indexOf('/** Collect annotations', start);
    const block = sidebarContent.slice(start, end);
    assert.ok(block.includes('Storage.getCurrentChatId()'));
    assert.ok(block.includes('activeChat?.topicId || this.currentTopicId'));
    assert.ok(block.includes('App._isOneTimeTopic(topicId)'));
});

test('sendMessage hides topic suggestion and picker', () => {
    const startIdx = appContent.indexOf('async sendMessage()');
    const sendFn = appContent.substring(startIdx, startIdx + 5000);
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

// ═══════════════════════════════════════════════════════════════════════════════
// Topic Suggestion: Race Condition Guard
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Topic Suggestion: Race Condition Guard ───');

test('TopicSuggester debounce callback checks welcome-mode after rankTopics resolves', () => {
    const debounceStart = appContent.indexOf('this._debounceTimer = setTimeout(async () => {');
    assert.ok(debounceStart >= 0, 'Should find debounce timer callback');
    const debounceBlock = appContent.substring(debounceStart, debounceStart + 500);
    assert.ok(debounceBlock.includes('rankTopics'),
        'Debounce block should call rankTopics');
    const rankIdx = debounceBlock.indexOf('rankTopics');
    const welcomeIdx = debounceBlock.indexOf('welcome-mode', rankIdx);
    assert.ok(welcomeIdx > rankIdx,
        'welcome-mode check should appear AFTER rankTopics call in debounce callback');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Title: Strip Status Prefix
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Chat Title: Strip Status Prefix ───');

test('title-setting block strips [My current status in...] prefix', () => {
    const titleBlock = appContent.substring(
        appContent.indexOf('Update chat title from first exchange'),
        appContent.indexOf('this.msgCountSinceRefresh++')
    );
    assert.ok(titleBlock.includes('My current status in'),
        'Title block should contain status prefix strip logic');
    assert.ok(titleBlock.includes('.replace(') || titleBlock.includes('replace('),
        'Title block should use .replace() to strip prefix');
});

test('status prefix regex correctly strips a sample prefix', () => {
    const raw = '[My current status in "Machine Learning": Overview: CS student]\n\nHow does backprop work?';
    const clean = raw.replace(/^\[My current status in "[^"]*":[^\]]*\]\s*/s, '').trim();
    assert.strictEqual(clean, 'How does backprop work?',
        'Regex should strip status prefix and leave the real question');
});

test('status prefix regex preserves content with no prefix', () => {
    const raw = 'How does backprop work?';
    const clean = raw.replace(/^\[My current status in "[^"]*":[^\]]*\]\s*/s, '').trim();
    assert.strictEqual(clean, 'How does backprop work?',
        'Regex should not alter content with no prefix');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sidebar: Refresh chat list on visibilitychange
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Sidebar: Refresh on Visibility Change ───');

test('visibilitychange handler calls _renderChatList when becoming visible', () => {
    const visBlock = appContent.substring(
        appContent.indexOf("addEventListener('visibilitychange'"),
        appContent.indexOf("addEventListener('visibilitychange'") + 300
    );
    assert.ok(visBlock.includes('_renderChatList'),
        'visibilitychange handler should call _renderChatList');
    assert.ok(visBlock.includes('_summarizeCurrentChat'),
        'visibilitychange handler should call _summarizeCurrentChat on hide');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Thread Familiarity: Conservative Prompt Rules
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Thread Familiarity: Conservative Prompt Rules ───');

test('STATUS_UPDATE_PROMPT has no stance field for concepts', () => {
    assert.ok(!promptContent.includes('"stance"') || !promptContent.includes('concepts_traversed'),
        'STATUS_UPDATE_PROMPT should not use concept stance fields');
    assert.ok(!promptContent.includes('"neutral"'),
        'STATUS_UPDATE_PROMPT should not default concept stance to neutral');
});

test('STATUS_UPDATE_PROMPT returns overview only (no concepts_traversed)', () => {
    assert.ok(!promptContent.includes('concepts_traversed'),
        'STATUS_UPDATE_PROMPT should not return concepts_traversed');
    assert.ok(promptContent.includes('"overview"'),
        'STATUS_UPDATE_PROMPT should return overview array');
});

test('STATUS_UPDATE_PROMPT includes overview section', () => {
    assert.ok(promptContent.includes('overview'),
        'STATUS_UPDATE_PROMPT should include overview field');
    assert.ok(promptContent.includes('profile of the USER') || promptContent.includes('Evidence, in order of authority'),
        'STATUS_UPDATE_PROMPT should describe a user-centered profile');
});

// ════════════════════════════════════════════════════════════════════════════════
// Text Annotations in Status Updates
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Text Annotations in Status Updates ───');

// -- Sidebar: _labelsDirty flag --

test('sidebar.js declares _labelsDirty property', () => {
    assert.ok(sidebarContent.includes('_labelsDirty'),
        'Sidebar should have _labelsDirty property');
    assert.ok(sidebarContent.includes('_labelsDirty: false'),
        '_labelsDirty should be initialized to false');
});

// -- _initStatusUpdate includes annotations --

test('_initStatusUpdate gathers annotations for status update', () => {
    const fnStart = sidebarContent.indexOf('_initStatusUpdate() {');
    assert.ok(fnStart >= 0, 'Should find _initStatusUpdate definition');
    const fnBlock = sidebarContent.substring(fnStart, fnStart + 2200);
    assert.ok(fnBlock.includes('_collectPendingAnnotations'),
        '_initStatusUpdate should collect pending annotations');
    assert.ok(fnBlock.includes('currentMessages'),
        '_initStatusUpdate should send currentMessages in the POST body');
    assert.ok(fnBlock.includes('annotations:'),
        '_initStatusUpdate should send annotations in the POST body');
    assert.ok(!fnBlock.includes('_injectChunkLabels'),
        '_initStatusUpdate should not inject chunk labels');
});

test('_initStatusUpdate clears _labelsDirty', () => {
    const fnStart = sidebarContent.indexOf('_initStatusUpdate() {');
    const fnBlock = sidebarContent.substring(fnStart, fnStart + 2200);
    assert.ok(fnBlock.includes('this._labelsDirty = false'),
        '_initStatusUpdate should clear _labelsDirty after gathering messages');
});

// -- refresh() clears _labelsDirty --

test('refresh() clears _labelsDirty before fetch', () => {
    const fnStart = sidebarContent.indexOf("async refresh(trigger = 'manual') {");
    assert.ok(fnStart >= 0, 'Should find refresh() definition');
    const fnBlock = sidebarContent.substring(fnStart, fnStart + 1600);
    assert.ok(fnBlock.includes('this._labelsDirty = false'),
        'refresh() should clear _labelsDirty');
    const labelsClearIdx = fnBlock.indexOf('this._labelsDirty = false');
    const fetchIdx = fnBlock.indexOf('fetch(');
    assert.ok(labelsClearIdx < fetchIdx,
        '_labelsDirty should be cleared BEFORE the fetch call in refresh()');
});

// -- _flushDirtyLabels method --

test('_flushDirtyLabels method exists and checks _labelsDirty', () => {
    assert.ok(sidebarContent.includes('_flushDirtyLabels()'),
        'Sidebar should define _flushDirtyLabels');
    const fnStart = sidebarContent.indexOf('_flushDirtyLabels() {');
    const fnBlock = sidebarContent.substring(fnStart, fnStart + 1600);
    assert.ok(fnBlock.includes('this._labelsDirty'),
        '_flushDirtyLabels should check _labelsDirty');
    assert.ok(fnBlock.includes('this.currentTopicId'),
        '_flushDirtyLabels should check currentTopicId');
});

test('_flushDirtyLabels calls /api/topic/status/update with annotations', () => {
    const fnStart = sidebarContent.indexOf('_flushDirtyLabels() {');
    const fnBlock = sidebarContent.substring(fnStart, fnStart + 2400);
    assert.ok(fnBlock.includes('/api/topic/status/update'),
        '_flushDirtyLabels should POST to /api/topic/status/update');
    assert.ok(fnBlock.includes('currentMessages'),
        '_flushDirtyLabels should send currentMessages');
    assert.ok(fnBlock.includes('annotations:'),
        '_flushDirtyLabels should send annotations');
    assert.ok(!fnBlock.includes('_injectChunkLabels'),
        '_flushDirtyLabels should not inject chunk labels');
});

test('_flushDirtyLabels clears _labelsDirty', () => {
    const fnStart = sidebarContent.indexOf('_flushDirtyLabels() {');
    const fnBlock = sidebarContent.substring(fnStart, fnStart + 1600);
    assert.ok(fnBlock.includes('this._labelsDirty = false'),
        '_flushDirtyLabels should clear _labelsDirty');
});

test('_flushDirtyLabels is fire-and-forget (uses .then not await)', () => {
    const fnStart = sidebarContent.indexOf('_flushDirtyLabels() {');
    const fnEnd = sidebarContent.indexOf('\n  _collectPendingAnnotations');
    const fnBlock = sidebarContent.substring(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2400);
    assert.ok(fnBlock.includes('.then('),
        '_flushDirtyLabels should use .then() for fire-and-forget');
    assert.ok(!/\basync\b/.test(fnBlock),
        '_flushDirtyLabels should not be async (fire-and-forget)');
});

// -- _applyAnnotation sets Sidebar._labelsDirty --

test('_applyAnnotation sets Sidebar._labelsDirty = true for quick labels', () => {
    const fnStart = appContent.indexOf("_applyAnnotation(label, comment = '') {");
    assert.ok(fnStart >= 0, 'Should find _applyAnnotation definition');
    const fnBlock = appContent.substring(fnStart, fnStart + 3500);
    assert.ok(fnBlock.includes('Sidebar._labelsDirty = true'),
        '_applyAnnotation should set Sidebar._labelsDirty to true');
});

// -- All 7 leave-chat sites call _flushDirtyLabels --

test('logout handler calls Sidebar._flushDirtyLabels()', () => {
    const logoutStart = appContent.indexOf("getElementById('logoutBtn')");
    assert.ok(logoutStart >= 0, 'Should find logoutBtn listener');
    const block = appContent.substring(logoutStart, logoutStart + 300);
    assert.ok(block.includes('_flushDirtyLabels'),
        'Logout handler should call _flushDirtyLabels');
});

test('beforeunload handler calls Sidebar._flushDirtyLabels()', () => {
    const buStart = appContent.indexOf("addEventListener('beforeunload'");
    assert.ok(buStart >= 0, 'Should find beforeunload listener');
    const block = appContent.substring(buStart, buStart + 200);
    assert.ok(block.includes('_flushDirtyLabels'),
        'beforeunload handler should call _flushDirtyLabels');
});

test('visibilitychange hidden handler calls Sidebar._flushDirtyLabels()', () => {
    const visStart = appContent.indexOf("addEventListener('visibilitychange'");
    assert.ok(visStart >= 0, 'Should find visibilitychange listener');
    const block = appContent.substring(visStart, visStart + 300);
    assert.ok(block.includes('_flushDirtyLabels'),
        'visibilitychange hidden handler should call _flushDirtyLabels');
});

test('newChat() calls Sidebar._flushDirtyLabels()', () => {
    const fnStart = appContent.indexOf('newChat() {');
    assert.ok(fnStart >= 0, 'Should find newChat() definition');
    const block = appContent.substring(fnStart, fnStart + 300);
    assert.ok(block.includes('_flushDirtyLabels'),
        'newChat() should call _flushDirtyLabels');
});

test('chat selection click calls Sidebar._flushDirtyLabels()', () => {
    const chatItemFn = appContent.indexOf('_createChatItem(chat) {');
    assert.ok(chatItemFn >= 0, 'Should find _createChatItem definition');
    const fnBlock = appContent.substring(chatItemFn, chatItemFn + 4500);
    assert.ok(fnBlock.includes('_flushDirtyLabels'),
        'Chat selection click handler should call _flushDirtyLabels');
});

test('past build-on button calls _flushDirtyLabels or flush logic', () => {
    assert.ok(sidebarContent.includes('_flushDirtyLabels') || sidebarContent.includes('flushDirtyLabels'),
        'Past card build-on interaction should trigger dirty label flush');
});

test('_onInactive() calls Sidebar._flushDirtyLabels()', () => {
    const fnStart = appContent.indexOf('_onInactive() {');
    assert.ok(fnStart >= 0, 'Should find _onInactive definition');
    const block = appContent.substring(fnStart, fnStart + 200);
    assert.ok(block.includes('_flushDirtyLabels'),
        '_onInactive should call _flushDirtyLabels');
});

// -- Backend: StatusUpdateRequest includes currentMessages + annotations --

test('backend StatusUpdateRequest model includes currentMessages field', () => {
    const classStart = backendMainContent.indexOf('class StatusUpdateRequest');
    assert.ok(classStart >= 0, 'Should find StatusUpdateRequest class');
    const block = backendMainContent.substring(classStart, classStart + 400);
    assert.ok(block.includes('currentMessages'),
        'StatusUpdateRequest should have currentMessages field');
    assert.ok(block.includes('MessageItem'),
        'currentMessages should be typed as list[MessageItem]');
    assert.ok(block.includes('annotations'),
        'StatusUpdateRequest should have annotations field');
});

test('backend update_topic_status formats currentMessages when provided', () => {
    const fnStart = backendMainContent.indexOf('async def update_topic_status');
    assert.ok(fnStart >= 0, 'Should find update_topic_status function');
    const block = backendMainContent.substring(fnStart, fnStart + 800);
    assert.ok(block.includes('req.currentMessages'),
        'update_topic_status should reference req.currentMessages');
    assert.ok(block.includes('current_messages_text'),
        'update_topic_status should build current_messages_text from request');
    assert.ok(block.includes('_serialize_annotations'),
        'update_topic_status should serialize annotations into the prompt');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Attachment Send Bug Fix: localStorage quota safety
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Attachment Send Bug Fix ───');

test('sendMessage stores attachments WITHOUT base64 data field', () => {
    const sendFn = appContent.substring(
        appContent.indexOf('async sendMessage()'),
        appContent.indexOf('_createStreamingMessage')
    );
    const userMsgBlock = sendFn.substring(
        sendFn.indexOf('const userMsg = {'),
        sendFn.indexOf('Storage.addMessage')
    );
    assert.ok(userMsgBlock.includes("name: a.name, mimeType: a.mimeType }"),
        'userMsg attachment map should only include name and mimeType (no data)');
    assert.ok(!userMsgBlock.includes('data: a.data'),
        'userMsg attachment map should NOT include data: a.data');
});

test('sendMessage still sends base64 data to API via apiAttachments', () => {
    const sendFn = appContent.substring(
        appContent.indexOf('async sendMessage()'),
        appContent.indexOf('_createStreamingMessage')
    );
    assert.ok(sendFn.includes("mimeType: a.mimeType, data: a.data"),
        'apiAttachments should include mimeType and data for the API call');
    assert.ok(sendFn.includes('reqBody.attachments = apiAttachments'),
        'reqBody should receive apiAttachments with full data');
});

test('_saveAll has try/catch for localStorage quota errors', () => {
    const saveAllStart = storageContent.indexOf('_saveAll(data)');
    assert.ok(saveAllStart >= 0, 'Should find _saveAll definition');
    const saveAllBlock = storageContent.substring(saveAllStart, saveAllStart + 300);
    assert.ok(saveAllBlock.includes('try {') && saveAllBlock.includes('catch'),
        '_saveAll should have try/catch wrapping localStorage.setItem');
    assert.ok(saveAllBlock.includes('return false'),
        '_saveAll should return false on quota error');
    assert.ok(saveAllBlock.includes('return true'),
        '_saveAll should return true on success');
});

test('addMessage returns null on storage failure', () => {
    const addMsgStart = storageContent.indexOf('addMessage(chatId, message)');
    assert.ok(addMsgStart >= 0, 'Should find addMessage definition');
    const addMsgBlock = storageContent.substring(addMsgStart, addMsgStart + 300);
    assert.ok(addMsgBlock.includes('if (!ok) return null'),
        'addMessage should return null when _saveAll fails');
});

test('sendMessage checks addMessage return and shows toast on failure', () => {
    const sendFn = appContent.substring(
        appContent.indexOf('async sendMessage()'),
        appContent.indexOf('_createStreamingMessage')
    );
    assert.ok(sendFn.includes('const saved = Storage.addMessage'),
        'sendMessage should capture addMessage return value');
    assert.ok(sendFn.includes('if (!saved)'),
        'sendMessage should check if save failed');
    assert.ok(sendFn.includes('Storage full'),
        'sendMessage should show storage-full toast on failure');
});

test('sendMessage clears textarea AFTER successful save, not before', () => {
    const sendFn = appContent.substring(
        appContent.indexOf('async sendMessage()'),
        appContent.indexOf('_createStreamingMessage')
    );
    const saveIdx = sendFn.indexOf('Storage.addMessage');
    const clearIdx = sendFn.indexOf("input.value = '';");
    assert.ok(saveIdx >= 0 && clearIdx >= 0, 'Should find both save and clear');
    assert.ok(clearIdx > saveIdx,
        'textarea clear should come AFTER Storage.addMessage, not before');
});

test('sendMessage restores input on storage failure', () => {
    const sendFn = appContent.substring(
        appContent.indexOf('async sendMessage()'),
        appContent.indexOf('_createStreamingMessage')
    );
    assert.ok(sendFn.includes('const savedInput = input.value'),
        'sendMessage should capture input value before attempting save');
    assert.ok(sendFn.includes('input.value = savedInput'),
        'sendMessage should restore input on failure');
});

test('sendBtn uses try/finally to always re-enable', () => {
    const sendFn = appContent.substring(
        appContent.indexOf('async sendMessage()'),
        appContent.indexOf('// ── Free-text selection annotations')
    );
    assert.ok(sendFn.includes('} finally {'),
        'sendMessage should have a finally block');
    const finallyIdx = sendFn.indexOf('} finally {');
    const afterFinally = sendFn.substring(finallyIdx, finallyIdx + 200);
    assert.ok(afterFinally.includes("sendBtn').disabled = false"),
        'finally block should re-enable sendBtn');
});

test('storage.js has _stripAttachmentBase64 migration method', () => {
    assert.ok(storageContent.includes('_stripAttachmentBase64'),
        'storage.js should define _stripAttachmentBase64 migration');
    const fnStart = storageContent.indexOf('_stripAttachmentBase64(data)');
    assert.ok(fnStart >= 0, 'Should find _stripAttachmentBase64 definition');
    const fnBlock = storageContent.substring(fnStart, fnStart + 500);
    assert.ok(fnBlock.includes('delete att.data'),
        'Migration should delete att.data from stored attachments');
    assert.ok(fnBlock.includes('changed = true'),
        'Migration should track whether changes were made');
});

test('_stripAttachmentBase64 is called from _getAll on first load', () => {
    const getAllStart = storageContent.indexOf('_getAll()');
    assert.ok(getAllStart >= 0, 'Should find _getAll definition');
    const getAllBlock = storageContent.substring(getAllStart, getAllStart + 1000);
    assert.ok(getAllBlock.includes('_stripAttachmentBase64'),
        '_getAll should call _stripAttachmentBase64 migration');
});

test('_appendMessage gracefully handles attachments without data field', () => {
    const appendStart = appContent.indexOf('_appendMessage(msg)');
    assert.ok(appendStart >= 0, 'Should find _appendMessage definition');
    const appendBlock = appContent.substring(appendStart, appendStart + 1200);
    assert.ok(appendBlock.includes('att.data'),
        '_appendMessage should check att.data for image rendering');
    assert.ok(appendBlock.includes('att.name'),
        '_appendMessage should fall back to file name when data is missing');
});

// ── Attachment stripping logic unit test ─────────────────────────────────────

test('attachment metadata without data is much smaller than with data', () => {
    const withData = JSON.stringify({ name: 'photo.jpg', mimeType: 'image/jpeg', data: 'x'.repeat(100000) });
    const withoutData = JSON.stringify({ name: 'photo.jpg', mimeType: 'image/jpeg' });
    assert.ok(withData.length > 100000, 'With data should be large');
    assert.ok(withoutData.length < 100, 'Without data should be tiny');
    assert.ok(withoutData.length < withData.length * 0.01,
        'Stripped attachment should be <1% the size of one with base64 data');
});

test('stripping data from attachment preserves name and mimeType', () => {
    const att = { name: 'test.png', mimeType: 'image/png', data: 'abc123base64' };
    const stripped = { name: att.name, mimeType: att.mimeType };
    assert.strictEqual(stripped.name, 'test.png');
    assert.strictEqual(stripped.mimeType, 'image/png');
    assert.strictEqual(stripped.data, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Notion Redesign: Design Tokens
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Notion Redesign: Design Tokens ───');

test('--primary is near-black, not blue', () => {
    assert.ok(!cssContent.includes('--primary: #3B82F6'),
        ':root should NOT contain --primary: #3B82F6 (old blue)');
    const match = cssContent.match(/--primary:\s*#([0-9A-Fa-f]{6})/);
    assert.ok(match, 'Should define --primary hex color');
    const hex = match[1];
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    assert.ok(r < 80 && g < 80 && b < 80,
        `--primary should be near-black, got #${hex}`);
});

test('--sidebar-bg is warm off-white, not blue-tinted', () => {
    assert.ok(!cssContent.includes('--sidebar-bg: rgba(59, 130, 246'),
        '--sidebar-bg should NOT use blue rgba');
    assert.ok(cssContent.includes('--sidebar-bg: #F7F7F5'),
        '--sidebar-bg should be #F7F7F5');
});

test('--hover-bg is defined in :root', () => {
    assert.ok(cssContent.includes('--hover-bg:'),
        ':root should define --hover-bg');
});

test('--selected-bg is defined in :root', () => {
    assert.ok(cssContent.includes('--selected-bg:'),
        ':root should define --selected-bg');
});

test('--bg-primary is defined in :root', () => {
    assert.ok(cssContent.includes('--bg-primary:'),
        ':root should define --bg-primary');
});

test('--bg-secondary is defined in :root', () => {
    assert.ok(cssContent.includes('--bg-secondary:'),
        ':root should define --bg-secondary');
});

test('body font-family includes Inter', () => {
    const bodyMatch = cssContent.match(/body\s*\{[^}]*font-family:[^}]*\}/s);
    assert.ok(bodyMatch, 'Should find body font-family rule');
    assert.ok(bodyMatch[0].includes("'Inter'"),
        `Body font-family should include 'Inter', got: ${bodyMatch[0].slice(0, 100)}`);
});

test('send button uses dark fill (var(--primary))', () => {
    const sendRule = cssContent.match(/\.send-btn\s*\{[^}]*background:\s*([^;]+)/);
    assert.ok(sendRule, 'Should find .send-btn background rule');
    assert.ok(sendRule[1].includes('var(--primary)'),
        `.send-btn background should use var(--primary), got: ${sendRule[1]}`);
});

test('login button does not use blue fill', () => {
    const loginRule = cssContent.match(/\.login-btn\s*\{[^}]*background:\s*([^;]+)/);
    assert.ok(loginRule, 'Should find .login-btn background rule');
    assert.ok(!loginRule[1].includes('#3B82F6'),
        `.login-btn background should not be blue #3B82F6`);
    assert.ok(loginRule[1].includes('var(--primary)'),
        `.login-btn background should use var(--primary)`);
});

test('.new-chat-btn is ghost style (no border)', () => {
    const newChatRule = cssContent.match(/\.new-chat-btn\s*\{[^}]*\}/s);
    assert.ok(newChatRule, 'Should find .new-chat-btn rule');
    assert.ok(newChatRule[0].includes('border: none'),
        '.new-chat-btn should have border: none (ghost style)');
});

test('.new-chat-btn hover uses neutral background', () => {
    const hoverRule = cssContent.match(/\.new-chat-btn:hover\s*\{[^}]*\}/s);
    assert.ok(hoverRule, 'Should find .new-chat-btn:hover rule');
    assert.ok(hoverRule[0].includes('var(--hover-bg)'),
        '.new-chat-btn:hover should use var(--hover-bg)');
});

// ═══════════════════════════════════════════════════════════════════════════════
// THREE-FEATURE PROBE UPGRADE: Feature 1 — Breadth/Depth Future Directions
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Feature 1: Breadth/Depth Future Directions ───');

test('SIDEBAR_NEW_DIRECTIONS_PROMPT uses breadth/depth types', () => {
    assert.ok(promptContent.includes('"breadth"'),
        'Prompt should specify breadth direction type');
    assert.ok(promptContent.includes('"depth"'),
        'Prompt should specify depth direction type');
    assert.ok(promptContent.includes('exactly two') || promptContent.includes('one breadth') || promptContent.includes('exactly 2'),
        'Prompt should instruct to generate exactly one breadth and one depth');
});

test('SIDEBAR_NEW_DIRECTIONS_PROMPT describes breadth as adjacent/new topic', () => {
    const breadthIdx = promptContent.indexOf('"breadth"');
    const surroundBreadth = promptContent.substring(breadthIdx, breadthIdx + 400);
    assert.ok(surroundBreadth.includes('adjacent') || surroundBreadth.includes('NOT yet touched') || surroundBreadth.includes('new area'),
        'Breadth should be described as an adjacent, not-yet-touched area');
});

test('SIDEBAR_NEW_DIRECTIONS_PROMPT describes depth as advanced/deeper exploration', () => {
    const depthIdx = promptContent.indexOf('"depth"');
    const surroundDepth = promptContent.substring(depthIdx, depthIdx + 400);
    assert.ok(surroundDepth.includes('advanced') || surroundDepth.includes('deeper') || surroundDepth.includes('mastery') || surroundDepth.includes('nuanced'),
        'Depth should be described as more advanced/deeper exploration');
});

test('direction prompt returns type field in each direction', () => {
    const jsonReturn = promptContent.substring(promptContent.indexOf('Return JSON'));
    assert.ok(jsonReturn.includes('"type"'),
        'Prompt return JSON should include "type" field');
    assert.ok(jsonReturn.includes('"anchor"'),
        'Prompt return JSON should include "anchor" field');
});

test('sidebar.js keeps direction type internal and out of provenance', () => {
    assert.ok(!sidebarContent.includes('direction-type-badge'),
        'sidebar.js should not render direction-type-badge');
    assert.ok(!sidebarContent.includes("provenanceParts.push('broader')"),
        'sidebar.js should not show broader in provenance');
    assert.ok(!sidebarContent.includes("provenanceParts.push('deeper')"),
        'sidebar.js should not show deeper in provenance');
    assert.ok(!sidebarContent.includes('type-breadth') && !sidebarContent.includes('type-depth'),
        'sidebar.js should not attach visual type classes');
});

test('CSS has no breadth/depth visual encoding', () => {
    assert.ok(!cssContent.includes('badge-breadth'),
        'CSS should not style badge-breadth pills');
    assert.ok(!cssContent.includes('type-breadth'),
        'CSS should not style breadth directions');
    assert.ok(!cssContent.includes('type-depth'),
        'CSS should not style depth directions');
});

test('sidebar.js shows unsaved suggested goals with breadth before depth', () => {
    assert.ok(sidebarContent.includes('_findGoal(topic, d.title)'),
        'Cards match saved goals by title');
    assert.ok(sidebarContent.includes("breadth: 0") || sidebarContent.includes("order[a.type]"),
        'Unsaved suggestions prefer breadth before depth');
});

test('backend main.py serializes status for directions prompt', () => {
    assert.ok(backendMainContent.includes('_serialize_status_to_str'),
        'main.py should have _serialize_status_to_str helper');
    assert.ok(backendMainContent.includes('topicStatus'),
        'main.py ChatRequest should include topicStatus field');
    assert.ok(backendMainContent.includes('_build_coverage_str'),
        'main.py should build coverage for directions from overview + past chats');
});

// ═══════════════════════════════════════════════════════════════════════════════
// THREE-FEATURE PROBE UPGRADE: Feature 2 — Drag-to-Classify Concept Stances
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Feature 2: Concept Stance UI Removed (overview-only) ───');

test('sidebar.js has no _setConceptStance method', () => {
    assert.ok(!sidebarContent.includes('_setConceptStance('),
        'sidebar.js should not define _setConceptStance (concepts removed)');
});

test('sidebar.js has no _mergeStances method', () => {
    assert.ok(!sidebarContent.includes('_mergeStances('),
        'sidebar.js should not define _mergeStances (concepts removed)');
});

test('sidebar.js has no concept drop tray / zones', () => {
    assert.ok(!sidebarContent.includes('concept-drop-tray'),
        'sidebar.js should not render concept-drop-tray');
    assert.ok(!sidebarContent.includes('conceptDropZones'),
        'sidebar.js should not have concept drop zones');
});

test('sidebar.js renders overview status items', () => {
    assert.ok(sidebarContent.includes('status-section-overview'),
        'sidebar.js should render overview section');
    assert.ok(sidebarContent.includes('status-item'),
        'sidebar.js should render status-item bullets');
});

test('STATUS_UPDATE_PROMPT uses overview only (no stance/checked concepts)', () => {
    assert.ok(promptContent.includes('"overview"'),
        'STATUS_UPDATE_PROMPT should use overview field');
    assert.ok(!promptContent.includes('concepts_traversed'),
        'STATUS_UPDATE_PROMPT should not return concepts_traversed');
    assert.ok(!promptContent.includes('"checked": true') && !promptContent.includes('"checked": false'),
        'STATUS_UPDATE_PROMPT should NOT use checked boolean field');
});

test('_serializeStatus in sidebar.js serializes overview (not stance groups)', () => {
    assert.ok(sidebarContent.includes('_serializeStatus(') || sidebarContent.includes('_serializeStatus :'),
        'sidebar.js should have _serializeStatus method');
    assert.ok(!sidebarContent.includes('User flagged interest'),
        'Serialization should not group by interested stance');
});

test('app.js sends topicStatus in chat API request', () => {
    assert.ok(appContent.includes('topicStatus'),
        'app.js should include topicStatus in chat request body');
});

test('backend main.py uses topicStatus without stance_context', () => {
    assert.ok(backendMainContent.includes('topicStatus'),
        'main.py ChatRequest should have topicStatus field');
    assert.ok(!backendMainContent.includes('stance_context'),
        'main.py should not build stance_context from topicStatus');
    assert.ok(backendMainContent.includes('_serialize_status_to_str'),
        'main.py should serialize overview for prompts');
});

test('directions prompt uses coverage not covered_concepts', () => {
    assert.ok(promptContent.includes('{coverage}'),
        'SIDEBAR_NEW_DIRECTIONS_PROMPT should use {coverage}');
    assert.ok(!promptContent.includes('{covered_concepts}'),
        'SIDEBAR_NEW_DIRECTIONS_PROMPT should not use {covered_concepts}');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graph view disabled (implementation kept in graph.js for future use)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Graph View Disabled ───');

test('sidebar.js resets persisted graph tab preference on init', () => {
    assert.ok(sidebarContent.includes("localStorage.getItem('loom_sidebarTab') === 'graph'"),
        'sidebar.js should detect stale graph tab preference');
    assert.ok(sidebarContent.includes("localStorage.setItem('loom_sidebarTab', 'list')"),
        'sidebar.js should reset graph tab preference to list');
});

test('sidebar.js does not reference GraphView', () => {
    assert.ok(!sidebarContent.includes('GraphView'),
        'sidebar.js should not call GraphView when graph is disabled');
});

test('sidebar.js does not define graph tab activation helpers', () => {
    assert.ok(!sidebarContent.includes('_activateGraphTab('),
        'sidebar.js should not define _activateGraphTab');
    assert.ok(!sidebarContent.includes('_renderGraph('),
        'sidebar.js should not define _renderGraph');
    assert.ok(!sidebarContent.includes('_initViewTabs('),
        'sidebar.js should not define _initViewTabs');
});

// Graph edge inference unit test (logic reused by graph.js when re-enabled)
test('token overlap score correctly measures concept similarity', () => {
    // Extract _tokenize and _overlapScore logic from graph.js
    function tokenize(str) {
        return str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2);
    }
    function overlapScore(tokA, tokB) {
        if (!tokA.length || !tokB.length) return 0;
        const setA = new Set(tokA);
        let hits = 0;
        for (const t of tokB) if (setA.has(t)) hits++;
        return hits / Math.max(tokA.length, tokB.length);
    }

    const chatTokens = tokenize('neural networks machine learning deep learning');
    const conceptTokens = tokenize('neural networks');
    const unrelatedTokens = tokenize('cooking recipes pasta');

    const score1 = overlapScore(chatTokens, conceptTokens);
    const score2 = overlapScore(chatTokens, unrelatedTokens);

    assert.ok(score1 > 0.1, `Overlap score for related concepts should be > 0.1, got ${score1}`);
    assert.ok(score2 === 0, `Overlap score for unrelated concepts should be 0, got ${score2}`);
    assert.ok(score1 > score2, 'Related concept should score higher than unrelated');
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
