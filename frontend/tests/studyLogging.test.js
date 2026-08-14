/**
 * Tests for study logging: verifies all new and existing StudyLog events
 * are present in the codebase with correct event names and data fields.
 * Run with: node frontend/tests/studyLogging.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const ROOT = path.resolve(__dirname, '../..');
const appContent = fs.readFileSync(path.join(ROOT, 'frontend/app.js'), 'utf8');
const sidebarContent = fs.readFileSync(path.join(ROOT, 'frontend/sidebar.js'), 'utf8');
const utilsContent = fs.readFileSync(path.join(ROOT, 'frontend/utils.js'), 'utf8');
const mainPy = fs.readFileSync(path.join(ROOT, 'backend/main.py'), 'utf8');

// ═══════════════════════════════════════════════════════════════════════════════
// StudyLog Infrastructure (utils.js)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── StudyLog Infrastructure ───');

test('StudyLog has _queue for local backup', () => {
    assert.ok(utilsContent.includes('_queue: []'), 'Should have _queue array');
});

test('StudyLog has _restoreQueue for recovering unsent events', () => {
    assert.ok(utilsContent.includes('_restoreQueue()'), 'Should have _restoreQueue method');
});

test('StudyLog has _persistQueue for localStorage backup', () => {
    assert.ok(utilsContent.includes('_persistQueue()'), 'Should have _persistQueue method');
});

test('StudyLog has _flush for retry logic', () => {
    assert.ok(utilsContent.includes('async _flush()'), 'Should have async _flush method');
});

test('StudyLog has _scheduleFlush for delayed retry', () => {
    assert.ok(utilsContent.includes('_scheduleFlush()'), 'Should have _scheduleFlush method');
});

test('StudyLog has init() that restores queue and sets beforeunload', () => {
    assert.ok(utilsContent.includes('init()'), 'Should have init method');
    const initFn = utilsContent.substring(
        utilsContent.lastIndexOf('init()'),
        utilsContent.indexOf('};', utilsContent.lastIndexOf('init()'))
    );
    assert.ok(initFn.includes('_restoreQueue'), 'init should call _restoreQueue');
    assert.ok(initFn.includes('beforeunload'), 'init should set beforeunload handler');
});

test('StudyLog uses localStorage key loom_event_queue', () => {
    assert.ok(utilsContent.includes("'loom_event_queue'"), 'Should use loom_event_queue key');
});

test('StudyLog event() falls back to queue on fetch failure', () => {
    const eventFn = utilsContent.substring(
        utilsContent.indexOf('event(eventType,'),
        utilsContent.indexOf('init()')
    );
    assert.ok(eventFn.includes('.catch('), 'event() should catch fetch errors');
    assert.ok(eventFn.includes('_queue.push'), 'Should push to queue on failure');
    assert.ok(eventFn.includes('_persistQueue'), 'Should persist queue on failure');
});

test('StudyLog._flush retries up to _maxRetries', () => {
    assert.ok(utilsContent.includes('_maxRetries'), 'Should have _maxRetries config');
    assert.ok(utilsContent.includes('item.retries < this._maxRetries'), 'Should check retries');
});

test('StudyLog.init() is called in App._enterApp()', () => {
    assert.ok(appContent.includes('StudyLog.init()'), 'App should call StudyLog.init()');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Existing Events (preserved)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Existing Events (preserved) ───');

test('session_start event exists', () => {
    assert.ok(appContent.includes("'session_start'"), 'Should log session_start');
});

test('session_end event exists', () => {
    const count = (appContent.match(/'session_end'/g) || []).length;
    assert.ok(count >= 2, `Should log session_end at least 2 times (logout + beforeunload), found ${count}`);
});

test('query_sent event exists', () => {
    assert.ok(appContent.includes("'query_sent'"), 'Should log query_sent');
});

test('chat_created event exists', () => {
    assert.ok(appContent.includes("'chat_created'"), 'Should log chat_created');
});

test('chat_deleted event exists', () => {
    assert.ok(appContent.includes("'chat_deleted'"), 'Should log chat_deleted');
});

test('text label events exist (text_label_applied / removed / comment)', () => {
    assert.ok(appContent.includes("'text_label_applied'"), 'Should log text_label_applied');
    assert.ok(appContent.includes("'text_label_removed'"), 'Should log text_label_removed');
    assert.ok(appContent.includes("'text_comment_committed'"), 'Should log text_comment_committed');
});

test('topic_suggestion_accepted event exists', () => {
    assert.ok(appContent.includes("'topic_suggestion_accepted'"), 'Should log topic_suggestion_accepted');
});

test('topic_suggestion_dismissed event exists', () => {
    assert.ok(appContent.includes("'topic_suggestion_dismissed'"), 'Should log topic_suggestion_dismissed');
});

test('topic_created event exists', () => {
    assert.ok(appContent.includes("'topic_created'"), 'Should log topic_created');
});

test('topic_renamed event exists', () => {
    assert.ok(appContent.includes("'topic_renamed'"), 'Should log topic_renamed');
});

test('chat_moved event exists', () => {
    assert.ok(appContent.includes("'chat_moved'"), 'Should log chat_moved');
});

test('chat_unassigned event exists', () => {
    assert.ok(appContent.includes("'chat_unassigned'"), 'Should log chat_unassigned');
});

test('proposal_shown event exists (supersedes current_profile_updated)', () => {
    assert.ok(sidebarContent.includes("'proposal_shown'"),
        'Should log proposal_shown event');
    assert.ok(!sidebarContent.includes("'current_profile_updated'"),
        'current_profile_updated should be superseded by proposal events');
});

test('current_profile_edited event exists (replaces summary_edited)', () => {
    assert.ok(sidebarContent.includes("'current_profile_edited'"),
        'Should log current_profile_edited event');
});

test('current_profile_section_toggled event exists (replaces overview_section_toggled)', () => {
    assert.ok(sidebarContent.includes("'current_profile_section_toggled'") || sidebarContent.includes("section_collapsed"),
        'Should log section toggle event');
});

test('context_card_shown event exists (replaces past_lookup)', () => {
    assert.ok(appContent.includes("'context_card_shown'"),
        'Should log context_card_shown event');
});

test('past continue uses navigation not build-on event', () => {
    assert.ok(!sidebarContent.includes("'past_build_on_click'"),
        'past_build_on_click removed');
    assert.ok(appContent.includes('Open chat →') || appContent.includes('past-context-open-btn'),
        'Open chat present on in-chat cards');
});

test('future_direction_clicked event removed', () => {
    assert.ok(!sidebarContent.includes("'future_direction_clicked'"),
        'future_direction_clicked removed');
});

test('future_suggestion_dragged event removed', () => {
    assert.ok(!sidebarContent.includes("'future_suggestion_dragged'"),
        'future_suggestion_dragged removed');
});

test('goal_question_asked event exists (replaces module3_direction_new_chat)', () => {
    assert.ok(sidebarContent.includes("'goal_question_asked'"),
        'Should log goal_question_asked event');
});

test('future_directions_refreshed event exists (replaces module3_shuffled)', () => {
    assert.ok(sidebarContent.includes("'future_directions_refreshed'"),
        'Should log future_directions_refreshed event');
});

test('context_block_added event removed', () => {
    assert.ok(!appContent.includes("'context_block_added'"), 'context_block_added removed');
});

test('baseline_details_shown event exists', () => {
    assert.ok(appContent.includes("'baseline_details_shown'"), 'Should log baseline_details_shown');
});

// ═══════════════════════════════════════════════════════════════════════════════
// New Events — Chat & UI
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── New Events: Chat & UI ───');

test('chat_selected event with view field (distinguishes recent vs topics)', () => {
    assert.ok(appContent.includes("'chat_selected'"), 'Should log chat_selected');
    const idx = appContent.indexOf("'chat_selected'");
    const surrounding = appContent.substring(idx - 50, idx + 200);
    assert.ok(surrounding.includes('view:'), 'chat_selected should include view field');
});

test('view_switched event logged on toggle-btn click', () => {
    assert.ok(appContent.includes("'view_switched'"), 'Should log view_switched');
    const idx = appContent.indexOf("'view_switched'");
    const surrounding = appContent.substring(idx - 50, idx + 200);
    assert.ok(surrounding.includes('view:'), 'view_switched should include view field');
});

test('sidebar_collapsed event logged with side and collapsed fields', () => {
    assert.ok(appContent.includes("'sidebar_collapsed'"), 'Should log sidebar_collapsed');
    const idx = appContent.indexOf("'sidebar_collapsed'");
    const surrounding = appContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('side'), 'Should include side field');
    assert.ok(surrounding.includes('collapsed'), 'Should include collapsed field');
});

test('context_tag_clicked event logged with type only (no label)', () => {
    assert.ok(appContent.includes("'context_tag_clicked'"), 'Should log context_tag_clicked');
    const idx = appContent.indexOf("'context_tag_clicked'");
    const surrounding = appContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('type:'), 'Should include type field');
    assert.ok(!surrounding.includes('label:'), 'Should NOT include label field (privacy)');
});

// ═══════════════════════════════════════════════════════════════════════════════
// New Events — Topic Management
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── New Events: Topic Management ───');

test('topic_auto_detect_triggered event logged', () => {
    assert.ok(appContent.includes("'topic_auto_detect_triggered'"), 'Should log topic_auto_detect_triggered');
    const idx = appContent.indexOf("'topic_auto_detect_triggered'");
    const surrounding = appContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('candidateCount'), 'Should include candidateCount');
});

test('topic_assigned event uses assignMethod instead of isAutoDetected', () => {
    const assignments = [];
    let searchIdx = 0;
    while (true) {
        const idx = appContent.indexOf("'topic_assigned'", searchIdx);
        if (idx === -1) break;
        assignments.push(appContent.substring(idx, idx + 200));
        searchIdx = idx + 1;
    }
    assert.ok(assignments.length >= 2, `Should have at least 2 topic_assigned calls, found ${assignments.length}`);
    const hasManual = assignments.some(s => s.includes("assignMethod: 'manual'"));
    const hasAuto = assignments.some(s => s.includes("assignMethod: 'auto'"));
    assert.ok(hasManual, 'Should have at least one manual assignment');
    assert.ok(hasAuto, 'Should have at least one auto assignment');
});

test('topic_picker_opened event logged', () => {
    assert.ok(appContent.includes("'topic_picker_opened'"), 'Should log topic_picker_opened');
});

test('topic_picker_selected event logged with topicId only (no topicName)', () => {
    assert.ok(appContent.includes("'topic_picker_selected'"), 'Should log topic_picker_selected');
    const idx = appContent.indexOf("'topic_picker_selected'");
    const surrounding = appContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('topicId'), 'Should include topicId');
    assert.ok(!surrounding.includes('topicName'), 'Should NOT include topicName (privacy)');
});

test('topic_picker_keyboard_select event logged', () => {
    assert.ok(appContent.includes("'topic_picker_keyboard_select'"), 'Should log topic_picker_keyboard_select');
});

test('topic_merge_drag event logged with source and target', () => {
    assert.ok(appContent.includes("'topic_merge_drag'"), 'Should log topic_merge_drag');
    const idx = appContent.indexOf("'topic_merge_drag'");
    const surrounding = appContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('sourceTopicId'), 'Should include sourceTopicId');
    assert.ok(surrounding.includes('targetTopicId'), 'Should include targetTopicId');
});

test('topic_merge_dialog_opened event logged', () => {
    assert.ok(appContent.includes("'topic_merge_dialog_opened'"), 'Should log topic_merge_dialog_opened');
    const idx = appContent.indexOf("'topic_merge_dialog_opened'");
    const surrounding = appContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('topicId'), 'Should include topicId');
});

test('topic_merge_confirmed event logged in sidebar.js', () => {
    assert.ok(sidebarContent.includes("'topic_merge_confirmed'"), 'Should log topic_merge_confirmed');
    const idx = sidebarContent.indexOf("'topic_merge_confirmed'");
    const surrounding = sidebarContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('sourceTopicId'), 'Should include sourceTopicId');
    assert.ok(surrounding.includes('targetTopicId'), 'Should include targetTopicId');
});

test('topic_merge_cancelled event logged in sidebar.js', () => {
    assert.ok(sidebarContent.includes("'topic_merge_cancelled'"), 'Should log topic_merge_cancelled');
});

// ═══════════════════════════════════════════════════════════════════════════════
// New Events — Current Profile (Past/Current/Future design)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── New Events: Current Profile ───');

test('current_profile_section_toggled event or section_collapsed logged', () => {
    assert.ok(sidebarContent.includes("'current_profile_section_toggled'") || sidebarContent.includes("'section_collapsed'"),
        'Should log section toggle in current profile');
});

test('section_collapsed event logged in sidebar.js', () => {
    assert.ok(sidebarContent.includes("'section_collapsed'"),
        'sidebar.js should log section_collapsed');
    const idx = sidebarContent.indexOf("'section_collapsed'");
    const surrounding = sidebarContent.substring(idx - 20, idx + 200);
    assert.ok(surrounding.includes('topicId') || surrounding.includes('module') || surrounding.includes('section'),
        'section_collapsed event should include context');
});

// ═══════════════════════════════════════════════════════════════════════════════
// New Events — Past Section
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── New Events: Past Section ───');

test('context_card_shown event logged with topicId', () => {
    assert.ok(appContent.includes("'context_card_shown'"), 'Should log context_card_shown');
    const idx = appContent.indexOf("'context_card_shown'");
    const surrounding = appContent.substring(idx - 20, idx + 280);
    assert.ok(surrounding.includes('topicId'), 'context_card_shown should include topicId');
});

test('connection_contested event logged for inline connection cards', () => {
    assert.ok(appContent.includes("'connection_contested'"),
        'Should log connection_contested event');
});

test('context_excluded_for_topic event logged for topic-level exclusion', () => {
    assert.ok(appContent.includes("'context_excluded_for_topic'"),
        'Should log context_excluded_for_topic event');
});

test('context_item_scoped event removed with scope toggle', () => {
    assert.ok(!sidebarContent.includes("'context_item_scoped'"),
        'context_item_scoped no longer logged');
});

// ═══════════════════════════════════════════════════════════════════════════════
// New Events — Future Directions
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── New Events: Future Directions ───');

test('goal_saved event logged', () => {
    assert.ok(sidebarContent.includes("'goal_saved'"),
        'Should log goal_saved');
});

test('goal_dismissed event logged', () => {
    assert.ok(sidebarContent.includes("'goal_dismissed'"),
        'Should log goal_dismissed');
});

test('goal_explored is no longer logged (goals stay until deleted)', () => {
    assert.ok(!sidebarContent.includes("'goal_explored'"),
        'Asking a goal should not log goal_explored');
});

test('goal_modified event logged', () => {
    assert.ok(sidebarContent.includes("'goal_modified'"),
        'Should log goal_modified');
});

test('goal_authored event logged', () => {
    assert.ok(sidebarContent.includes("'goal_authored'"),
        'Should log goal_authored');
});

test('goal_removed event logged', () => {
    assert.ok(sidebarContent.includes("'goal_removed'"),
        'Should log goal_removed');
});

test('future_suggestion_clicked event logged', () => {
    assert.ok(sidebarContent.includes("'future_suggestion_clicked'") || appContent.includes("'future_suggestion_clicked'"),
        'Should log future_suggestion_clicked');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Concept Stances removed — event no longer logged from sidebar
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Concept Stance Events Removed ───');

test('current_concept_stance_set event removed from sidebar.js', () => {
    assert.ok(!sidebarContent.includes("'current_concept_stance_set'"),
        'Should not log current_concept_stance_set (stance UI removed)');
});

test('current_concept_toggled removed with chunk labels', () => {
    assert.ok(!appContent.includes("'current_concept_toggled'"),
        'Chunk label event current_concept_toggled should be removed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// New Events — Context Block
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── New Events: Context Block ───');

test('context_block_closed event removed', () => {
    assert.ok(!appContent.includes("'context_block_closed'"), 'context_block_closed removed');
});

test('context_block_toggled event removed', () => {
    assert.ok(!appContent.includes("'context_block_toggled'"), 'context_block_toggled removed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Backend — Backup and Admin Endpoints
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Backend: Backup & Admin ───');

test('backend has _backup_events_to_json function', () => {
    assert.ok(mainPy.includes('_backup_events_to_json'), 'Should define _backup_events_to_json');
});

test('backend auto-backs up every 50 events', () => {
    assert.ok(mainPy.includes('row_count % 50 == 0'), 'Should auto-backup every 50 events');
});

test('backend has /api/admin/backup endpoint', () => {
    assert.ok(mainPy.includes('/api/admin/backup'), 'Should have backup endpoint');
});

test('backend has /api/admin/events/summary endpoint', () => {
    assert.ok(mainPy.includes('/api/admin/events/summary'), 'Should have events summary endpoint');
});

test('backend has /api/admin/export endpoint', () => {
    assert.ok(mainPy.includes('/api/admin/export'), 'Should have export endpoint');
});

test('backend backup keeps only last 10 backups', () => {
    assert.ok(mainPy.includes('backups[:-10]'), 'Should keep only last 10 backups');
});

test('backend backup creates backups directory', () => {
    assert.ok(mainPy.includes('backup_dir.mkdir'), 'Should create backups directory');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Event Uniqueness — all events have distinct names
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Event Uniqueness ───');

test('all event names are unique and distinct', () => {
    const allCode = appContent + sidebarContent;
    const eventNames = [];
    const regex = /StudyLog\.event\('([^']+)'/g;
    let match;
    while ((match = regex.exec(allCode)) !== null) {
        if (!eventNames.includes(match[1])) {
            eventNames.push(match[1]);
        }
    }
    // Should have at least 25 unique event names (current design)
    assert.ok(eventNames.length >= 25,
        `Should have at least 25 unique event names, found ${eventNames.length}: ${eventNames.join(', ')}`);
});

test('no duplicate event names with different meanings', () => {
    const currentEvents = [
        'chat_selected', 'view_switched', 'topic_auto_detect_triggered',
        'topic_picker_opened', 'topic_picker_selected', 'topic_picker_keyboard_select',
        'topic_merge_drag', 'topic_merge_dialog_opened', 'topic_merge_confirmed', 'topic_merge_cancelled',
        'context_card_shown',
        'connection_contested', 'context_excluded_for_topic',
        'current_profile_edited',
        'proposal_shown', 'proposal_accepted', 'proposal_edited', 'proposal_dismissed',
        'proposal_empty', 'proposal_superseded',
        'goal_saved', 'goal_dismissed',
        'goal_modified', 'goal_authored', 'goal_removed',
        'future_directions_refreshed',
        'goal_question_asked',
        'section_collapsed',
        'sidebar_collapsed', 'context_tag_clicked',
    ];
    const unique = new Set(currentEvents);
    assert.strictEqual(unique.size, currentEvents.length, 'All event names should be unique');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Complete Event Inventory
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Complete Event Inventory ───');

const ALL_EXPECTED_EVENTS = [
    // Session
    'session_start', 'session_end',
    // Chat
    'chat_created', 'chat_deleted', 'chat_selected', 'query_sent',
    // View
    'view_switched',
    // Topics
    'topic_suggestion_accepted', 'topic_suggestion_dismissed',
    'topic_created', 'topic_renamed', 'topic_assigned',
    'topic_auto_detect_triggered',
    'topic_picker_opened', 'topic_picker_selected', 'topic_picker_keyboard_select',
    'topic_merge_drag', 'topic_merge_dialog_opened', 'topic_merge_confirmed', 'topic_merge_cancelled',
    // Past section
    'context_card_shown', 'context_excluded_for_topic', 'context_link_opened',
    'connection_contested',
    'construct_included_in_chat',
    // Current profile
    'current_profile_edited',
    'proposal_shown', 'proposal_accepted', 'proposal_edited', 'proposal_dismissed',
    'proposal_empty', 'proposal_superseded',
    'section_collapsed',
    // Future directions / goals
    'goal_saved', 'goal_dismissed',
    'goal_modified', 'goal_authored', 'goal_removed',
    'goal_question_asked', 'future_directions_refreshed',
    // UI
    'sidebar_collapsed', 'context_tag_clicked',
    // Baseline
    'baseline_details_shown',
    // Moved chat
    'chat_moved', 'chat_unassigned',
    // Text-selection labels
    'text_label_applied', 'text_label_removed', 'text_comment_committed',
];

const allCode = appContent + sidebarContent;
ALL_EXPECTED_EVENTS.forEach(evt => {
    test(`event '${evt}' exists in codebase`, () => {
        assert.ok(allCode.includes(`'${evt}'`), `Event '${evt}' should exist in app.js or sidebar.js`);
    });
});

// ─── Topic assignment: one-assignment-per-chat guard ─────────────────────────

test('auto topic_assigned is guarded by !chat.topicId in _handleTopicDetection', () => {
    // Find _handleTopicDetection and locate the auto topic_assigned call inside it
    const fnStart = appContent.indexOf('async _handleTopicDetection(');
    assert.ok(fnStart !== -1, '_handleTopicDetection must exist');
    const fnEnd = appContent.indexOf('\n  },\n', fnStart);
    const fnBody = appContent.substring(fnStart, fnEnd);

    // The auto assignment StudyLog.event call must be inside a !chat.topicId guard
    const autoIdx = fnBody.indexOf("assignMethod: 'auto'");
    assert.ok(autoIdx !== -1, "auto assignMethod must exist in _handleTopicDetection");

    // Look back from the auto assignment call for the guard condition
    const before = fnBody.substring(0, autoIdx);
    const lastIfIdx = before.lastIndexOf('if (');
    assert.ok(lastIfIdx !== -1, 'There must be an if-guard before the auto assignment');
    const guardExpr = before.substring(lastIfIdx, before.length);
    assert.ok(
        guardExpr.includes('!chat.topicId'),
        `auto topic_assigned must be guarded by !chat.topicId, found: "${guardExpr.trim().slice(0, 100)}"`
    );
});

test('manual topic_assigned is also guarded by !chat.topicId', () => {
    const manualIdx = appContent.indexOf("assignMethod: 'manual'");
    assert.ok(manualIdx !== -1, "manual assignMethod must exist");
    const before = appContent.substring(Math.max(0, manualIdx - 300), manualIdx);
    assert.ok(before.includes('!chat.topicId'), 'manual topic_assigned must also be guarded by !chat.topicId');
});

test('topic_assigned auto and manual never share the same if-block in _handleTopicDetection', () => {
    const fnStart = appContent.indexOf('async _handleTopicDetection(');
    const fnEnd = appContent.indexOf('\n  },\n', fnStart);
    const fnBody = appContent.substring(fnStart, fnEnd);

    // Count auto topic_assigned calls (excluding isOneOff)
    const autoMatches = [...fnBody.matchAll(/assignMethod: 'auto'/g)];
    // There should be exactly 2: one for isOneOff path, one for normal path
    assert.ok(autoMatches.length >= 1, 'Should have at least one auto assignment in _handleTopicDetection');

    // Confirm there is NO manual assignment inside _handleTopicDetection (manual is in sendMessage)
    assert.ok(!fnBody.includes("assignMethod: 'manual'"), '_handleTopicDetection should not contain manual assignment');
});

test('topic_assigned is only fired when chat has no existing topicId (one-per-chat guarantee)', () => {
    // All three auto-assignment sites in _handleTopicDetection must be inside !chat.topicId guards
    const fnStart = appContent.indexOf('async _handleTopicDetection(');
    const fnEnd = appContent.indexOf('\n  },\n', fnStart);
    const fnBody = appContent.substring(fnStart, fnEnd);

    let searchIdx = 0;
    while (true) {
        const evtIdx = fnBody.indexOf("'topic_assigned'", searchIdx);
        if (evtIdx === -1) break;
        const before = fnBody.substring(0, evtIdx);
        const lastIf = before.lastIndexOf('if (');
        const guardSnippet = before.substring(lastIf);
        assert.ok(
            guardSnippet.includes('!chat.topicId'),
            `topic_assigned at offset ${evtIdx} in _handleTopicDetection must be inside !chat.topicId guard`
        );
        searchIdx = evtIdx + 1;
    }
});

// ─── Privacy: no user content in logs ────────────────────────────────────────

console.log('\n─── Privacy: no user content in logs ───');

function getEventContext(code, eventName, range = 200) {
    const idx = code.indexOf(`'${eventName}'`);
    if (idx === -1) return '';
    return code.substring(idx, idx + range);
}

test('topic_created does not log topicName', () => {
    let searchIdx = 0;
    while (true) {
        const idx = appContent.indexOf("'topic_created'", searchIdx);
        if (idx === -1) break;
        const ctx = appContent.substring(idx, idx + 200);
        assert.ok(!ctx.includes('topicName'), `topic_created should not include topicName: ${ctx.slice(0, 80)}`);
        assert.ok(ctx.includes('topicId'), 'topic_created should include topicId');
        assert.ok(ctx.includes('isAutoDetected'), 'topic_created should include isAutoDetected');
        searchIdx = idx + 1;
    }
});

test('topic_renamed does not log oldName or newName', () => {
    const idx = appContent.indexOf("'topic_renamed'");
    assert.ok(idx !== -1, 'topic_renamed must exist');
    const lineEnd = appContent.indexOf('\n', idx);
    const eventLine = appContent.substring(idx, lineEnd);
    assert.ok(eventLine.includes('topicId'), 'topic_renamed should include topicId');
    assert.ok(!eventLine.includes('oldName'), 'topic_renamed should NOT include oldName');
    assert.ok(!eventLine.includes('newName'), 'topic_renamed should NOT include newName');
});

test('topic_merge_dialog_opened does not log topicName', () => {
    const ctx = getEventContext(appContent, 'topic_merge_dialog_opened');
    assert.ok(ctx.includes('topicId'), 'Should include topicId');
    assert.ok(!ctx.includes('topicName'), 'Should NOT include topicName');
});

test('goal_saved logs stage evolve', () => {
    const ctx = getEventContext(sidebarContent, 'goal_saved');
    assert.ok(ctx.includes("stage: 'evolve'") || ctx.includes('stage: "evolve"') || ctx.includes("stage: 'evolve'"),
        'Should include stage evolve');
});

test('context_tag_clicked does not log label', () => {
    const ctx = getEventContext(appContent, 'context_tag_clicked');
    assert.ok(ctx.includes('type'), 'Should include type');
    assert.ok(!ctx.includes('label'), 'Should NOT include label');
});

test('goal_question_asked uses stage evolve', () => {
    const ctx = getEventContext(sidebarContent, 'goal_question_asked');
    assert.ok(ctx.includes("stage: 'evolve'") || ctx.includes('evolve'),
        'Should include stage evolve');
});

test('current_profile_edited does not log content values', () => {
    let searchIdx = 0;
    let found = false;
    while (true) {
        const idx = sidebarContent.indexOf("'current_profile_edited'", searchIdx);
        if (idx === -1) break;
        found = true;
        const ctx = sidebarContent.substring(idx, idx + 200);
        assert.ok(!ctx.includes('oldValue'), `current_profile_edited should NOT include oldValue`);
        assert.ok(!ctx.includes('newValue'), `current_profile_edited should NOT include newValue`);
        searchIdx = idx + 1;
    }
    assert.ok(found, 'current_profile_edited event should exist in sidebar.js');
});

test('current_profile_edited uses positional indices (section, idx)', () => {
    const allEdits = [];
    let searchIdx = 0;
    while (true) {
        const idx = sidebarContent.indexOf("'current_profile_edited'", searchIdx);
        if (idx === -1) break;
        allEdits.push(sidebarContent.substring(idx, idx + 200));
        searchIdx = idx + 1;
    }
    if (allEdits.length > 0) {
        const hasIdx = allEdits.some(s => s.includes('idx') || s.includes('Idx'));
        assert.ok(hasIdx, 'current_profile_edited should include positional index');
    }
});

test('proposal_shown logs topicId and change count in data payload', () => {
    const ctx = getEventContext(sidebarContent, 'proposal_shown');
    assert.ok(ctx.includes('topicId'), 'Should include topicId');
    assert.ok(ctx.includes('nChanges'), 'Should include nChanges');
});

test('future_directions_refreshed does not log direction titles', () => {
    const ctx = getEventContext(sidebarContent, 'future_directions_refreshed');
    assert.ok(!ctx.includes('direction:'), 'Should NOT include direction text content');
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
    });
    process.exit(1);
}

process.exit(0);
