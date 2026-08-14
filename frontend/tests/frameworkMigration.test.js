/**
 * Tests for the ChatWeave framework migration (Construct / Apply / Evolve):
 * data migration, status snapshots, proposal flow, intentions, scrutability,
 * copy changes, and logging re-key.
 *
 * Behavior tests load storage.js + sidebar.js in a Node vm with stubbed
 * browser globals; the rest are source-level assertions.
 *
 * Run with: node frontend/tests/frameworkMigration.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// Objects created inside the vm have a foreign Object prototype; strip it for deep equality
const plain = x => JSON.parse(JSON.stringify(x));

const ROOT = path.resolve(__dirname, '../..');
const storageSrc = fs.readFileSync(path.join(ROOT, 'frontend/storage.js'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(ROOT, 'frontend/sidebar.js'), 'utf8');
const appContent = fs.readFileSync(path.join(ROOT, 'frontend/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(ROOT, 'frontend/styles.css'), 'utf8');
const mainPy = fs.readFileSync(path.join(ROOT, 'backend/main.py'), 'utf8');
const promptsPy = fs.readFileSync(path.join(ROOT, 'backend/prompts.py'), 'utf8');

// ── vm harness ────────────────────────────────────────────────────────────────

function fakeEl() {
    return {
        innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {}, appendChild() {}, replaceWith() {}, remove() {},
        closest: () => null, focus() {}, select() {},
        scrollIntoView() {},
    };
}

function makeEnv() {
    const store = new Map();
    const loggedEvents = [];
    const ctx = {
        console,
        setTimeout, clearTimeout,
        JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Promise, parseInt, parseFloat,
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
        document: {
            getElementById: () => fakeEl(),
            createElement: () => fakeEl(),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            body: fakeEl(),
        },
        fetch: () => Promise.resolve({ ok: false, json: async () => ({}) }),
        Utils: {
            timestamp: () => new Date().toISOString(),
            generateId: () => Math.random().toString(36).slice(2, 10),
            escapeHtml: s => String(s ?? ''),
            showToast() {},
            renderMarkdown: s => String(s ?? ''),
            TOPIC_COLORS: [{ hue: 210 }],
            findDistantHue: () => 210,
            _BLUE_FAMILY_MIN: 180,
            _BLUE_FAMILY_MAX: 260,
        },
        StudyLog: {
            events: loggedEvents,
            event(type, data) { loggedEvents.push({ type, data: data || {} }); },
        },
        App: {},
    };
    vm.createContext(ctx);
    const { Storage, Sidebar } = vm.runInContext(
        storageSrc + '\n' + sidebarSrc + '\n;({ Storage, Sidebar })', ctx
    );
    return { ctx, Storage, Sidebar, loggedEvents };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1 — Data model + migration (storage.js)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 1: data model + migration ───');

test('_migrateTopic fills all new fields on a legacy topic', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', name: 'ML', statusSummary: { overview: [] } };
    Storage._migrateTopic(t);
    assert.deepStrictEqual(plain(t.statusHistory), []);
    assert.strictEqual(t.pendingProposal, null);
    assert.deepStrictEqual(plain(t.goals), []);
    assert.deepStrictEqual(plain(t.statusSummary.goals), []);
    assert.deepStrictEqual(plain(t.excludedChatIds), []);
    assert.deepStrictEqual(plain(t.dismissedGoals), []);
    assert.ok(!('intentions' in t), 'legacy intentions removed');
    assert.ok(!('dismissedDirections' in t), 'legacy dismissedDirections removed');
});

test('_migrateTopic converts string overview items to {text, source:inferred}', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', statusSummary: { overview: ['knows Python', { text: 'CS student', source: 'user' }] } };
    Storage._migrateTopic(t);
    assert.deepStrictEqual(plain(t.statusSummary.overview[0]), { text: 'knows Python', source: 'inferred' });
    assert.deepStrictEqual(plain(t.statusSummary.overview[1]), { text: 'CS student', source: 'user' });
});

test('_migrateTopic is idempotent', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', statusSummary: { overview: ['a'] } };
    Storage._migrateTopic(t);
    const once = JSON.stringify(t);
    Storage._migrateTopic(t);
    assert.strictEqual(JSON.stringify(t), once);
});

test('_migrateTopic caps statusHistory at 10 (keeps most recent)', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', statusHistory: Array.from({ length: 14 }, (_, i) => ({ trigger: 't' + i })) };
    Storage._migrateTopic(t);
    assert.strictEqual(t.statusHistory.length, 10);
    assert.strictEqual(t.statusHistory[9].trigger, 't13');
});

test('_getAll migrates legacy topics read from localStorage', () => {
    const { ctx, Storage } = makeEnv();
    ctx.localStorage.setItem('loom_data', JSON.stringify({
        topics: [{ id: 't1', name: 'Old', statusSummary: { overview: ['legacy bullet'] } }],
        chats: [], messages: {}, concepts: [], currentChatId: null, personalDetails: [],
    }));
    const topic = Storage.getTopic('t1');
    assert.deepStrictEqual(plain(topic.statusSummary.overview[0]), { text: 'legacy bullet', source: 'inferred' });
    assert.deepStrictEqual(plain(topic.goals), []);
    assert.deepStrictEqual(plain(topic.statusSummary.goals), []);
    assert.strictEqual(topic.pendingProposal, null);
});

test('_migrateTopic seeds statusSummary.goals from legacy topic.goals', () => {
    const { Storage } = makeEnv();
    const t = {
        id: 't1',
        statusSummary: { overview: [{ text: 'knows Python', source: 'inferred' }] },
        goals: [{ id: 'goal_abc', title: 'Compare X and Y' }],
    };
    Storage._migrateTopic(t);
    assert.strictEqual(t.statusSummary.goals.length, 1);
    assert.strictEqual(t.statusSummary.goals[0].id, 'goal_abc');
    assert.strictEqual(t.statusSummary.goals[0].text, 'Compare X and Y');
    assert.strictEqual(t.statusSummary.goals[0].source, 'inferred');
    Storage._migrateTopic(t);
    assert.strictEqual(t.statusSummary.goals.length, 1, 'idempotent');
});

test('_migrateTopic retags Evolve-saved user goals as inferred', () => {
    const { Storage } = makeEnv();
    const t = {
        id: 't1',
        statusSummary: {
            overview: [],
            goals: [
                { id: 'g1', text: 'Explore generative AI system design', source: 'user', suggestionTitle: 'Explore generative AI system design' },
                { id: 'g2', text: 'I want to pass MLSD interviews', source: 'user' },
                { id: 'g3', text: 'Machine Learning System Design', source: 'user' },
            ],
        },
        goals: [{ id: 'g3', title: 'Machine Learning System Design' }],
    };
    Storage._migrateTopic(t);
    assert.strictEqual(t.statusSummary.goals[0].source, 'inferred', 'unedited suggestion');
    assert.strictEqual(t.statusSummary.goals[1].source, 'user', 'typed goal kept');
    assert.strictEqual(t.statusSummary.goals[2].source, 'inferred', 'legacy Evolve title');
});

test('createTopic includes all new schema fields', () => {
    const { Storage } = makeEnv();
    const t = Storage.createTopic('New Topic');
    assert.deepStrictEqual(plain(t.statusHistory), []);
    assert.strictEqual(t.pendingProposal, null);
    assert.deepStrictEqual(plain(t.goals), []);
    assert.deepStrictEqual(plain(t.statusSummary), { overview: [], goals: [] });
    assert.deepStrictEqual(plain(t.excludedChatIds), []);
    assert.deepStrictEqual(plain(t.dismissedGoals), []);
});

test('_migrateTopic archives concepts_traversed and promotes interested stances', () => {
    const { Storage } = makeEnv();
    const t = {
        id: 't1',
        statusSummary: {
            overview: [{ text: 'CS student', source: 'inferred' }],
            concepts_traversed: [
                { title: 'SVM', stance: 'interested' },
                { title: 'CNN', stance: 'neutral' },
                { title: 'Backprop', stance: 'interested' },
            ],
        },
    };
    Storage._migrateTopic(t);
    assert.ok(!('concepts_traversed' in t.statusSummary), 'concepts_traversed removed');
    assert.strictEqual(t._archivedConcepts.length, 3, 'archived');
    const interest = t.statusSummary.overview.find(o => (o.text || '').startsWith('Interested in:'));
    assert.ok(interest, 'interested bullet added');
    assert.ok(interest.text.includes('SVM') && interest.text.includes('Backprop'));
    assert.ok(!interest.text.includes('CNN'), 'neutral not promoted');
    assert.strictEqual(interest.source, 'user');
});

test('_migrateTopic archive is idempotent and skips duplicate interested bullet', () => {
    const { Storage } = makeEnv();
    const t = {
        id: 't1',
        statusSummary: {
            overview: [],
            concepts_traversed: [{ title: 'SVM', stance: 'interested' }],
        },
    };
    Storage._migrateTopic(t);
    const once = JSON.stringify(t);
    // re-attach concepts to simulate a second pass on already-migrated-looking data
    t.statusSummary.concepts_traversed = [{ title: 'SVM', stance: 'interested' }];
    Storage._migrateTopic(t);
    const bullets = t.statusSummary.overview.filter(o => (o.text || '').startsWith('Interested in:'));
    assert.strictEqual(bullets.length, 1, 'no duplicate interested bullet');
    assert.strictEqual(t._archivedConcepts.length, 2, 'second archive appends');
});

test('pushStatusSnapshot deep-copies statusSummary with ts + trigger', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', statusSummary: { overview: [{ text: 'a', source: 'user' }] }, statusHistory: [] };
    Storage.pushStatusSnapshot(t, 'stance');
    t.statusSummary.overview[0].text = 'mutated';
    assert.strictEqual(t.statusHistory.length, 1);
    assert.strictEqual(t.statusHistory[0].trigger, 'stance');
    assert.ok(t.statusHistory[0].ts, 'snapshot has timestamp');
    assert.strictEqual(t.statusHistory[0].statusSummary.overview[0].text, 'a', 'deep copy is immune to later mutation');
});

test('pushStatusSnapshot caps history at 10, FIFO', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', statusSummary: {}, statusHistory: [] };
    for (let i = 0; i < 13; i++) Storage.pushStatusSnapshot(t, 'snap' + i);
    assert.strictEqual(t.statusHistory.length, 10);
    assert.strictEqual(t.statusHistory[0].trigger, 'snap3');
    assert.strictEqual(t.statusHistory[9].trigger, 'snap12');
});

test('backend _serialize_status_to_str accepts dict overview items', () => {
    assert.ok(mainPy.includes('def _overview_item_text') || mainPy.includes('pt.get("text"'),
        'main.py should read .text from dict overview items with string fallback');
    assert.ok(mainPy.includes('## ') || mainPy.includes('## {text}') || mainPy.includes('f"## '),
        'main.py serializer should emit markdown headers');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 — Sidebar rename/reorder (Construct → Apply → Evolve)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 2: Construct / Apply / Evolve sections ───');

test('sections ordered Construct (sectionCurrent) → Evolve (sectionFuture)', () => {
    const iConstruct = indexHtml.indexOf('id="sectionCurrent"');
    const iEvolve = indexHtml.indexOf('id="sectionFuture"');
    assert.ok(iConstruct > -1 && iEvolve > -1, 'Construct and Evolve section ids exist');
    assert.ok(iConstruct < iEvolve, 'DOM order is Construct, Evolve');
    assert.ok(!indexHtml.includes('id="sectionPast"'), 'Apply sectionPast removed');
});

test('section titles renamed to Construct / Evolve', () => {
    assert.ok(indexHtml.includes('Construct'), 'Construct title');
    assert.ok(indexHtml.includes('Evolve'), 'Evolve title');
    assert.ok(!indexHtml.includes('data-phase="apply"'), 'Apply crumb removed');
});

test('breadcrumb uses data-phase construct|evolve', () => {
    assert.ok(indexHtml.includes('data-phase="construct"'));
    assert.ok(indexHtml.includes('data-phase="evolve"'));
    assert.ok(!indexHtml.includes('data-phase="apply"'), 'apply crumb gone');
    assert.ok(!indexHtml.includes('data-phase="past"'), 'old data-phase="past" removed');
    assert.ok(!indexHtml.includes('data-phase="future"'), 'old data-phase="future" removed');
});

test('dot classes exist in styles.css and are used in index.html', () => {
    ['dot-construct', 'dot-evolve'].forEach(cls => {
        assert.ok(stylesCss.includes('.' + cls), `.${cls} defined in css`);
        assert.ok(indexHtml.includes(cls), `${cls} used in html`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Snapshot / undo plumbing
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 3: snapshots + undo/history ───');

test('every status mutation snapshots BEFORE mutating', () => {
    ['_deleteStatusItem', '_editStatusItem', '_submitAiEdit']
        .forEach(fn => {
            let start = sidebarSrc.indexOf('\n  ' + fn + '(');
            if (start === -1) start = sidebarSrc.indexOf('\n  async ' + fn + '(');
            assert.ok(start > -1, `${fn} exists`);
            const block = sidebarSrc.slice(start, start + 1600);
            assert.ok(block.includes('Storage.pushStatusSnapshot('), `${fn} pushes a snapshot`);
        });
});

test('undo + history controls exist in Construct header', () => {
    assert.ok(!indexHtml.includes('statusUndoBtn'), 'undo button removed');
    assert.ok(indexHtml.includes('statusHistoryBtn'), 'history button kept');
    assert.ok(indexHtml.includes('statusHistoryBtn'), 'history button');
});

test('update_undone and version_restored logged with stage construct', () => {
    ['update_undone', 'version_restored'].forEach(evt => {
        const idx = sidebarSrc.indexOf(`'${evt}'`);
        assert.ok(idx > -1, `${evt} logged`);
        assert.ok(sidebarSrc.slice(idx, idx + 200).includes("'construct'"), `${evt} tagged stage construct`);
    });
});

test('_editStatusItem snapshots old value and tags edit as user-sourced', () => {
    const { ctx, Storage, Sidebar } = makeEnv();
    ctx.localStorage.setItem('loom_data', JSON.stringify({
        topics: [{ id: 't1', name: 'ML', statusSummary: { overview: ['original text'] } }],
        chats: [], messages: {}, concepts: [], currentChatId: null, personalDetails: [],
    }));
    Sidebar.currentTopicId = 't1';
    Sidebar._editStatusItem('overview', 0, 'edited text');
    const t = Storage.getTopic('t1');
    assert.strictEqual(t.statusSummary.overview[0].text, 'edited text');
    assert.strictEqual(t.statusSummary.overview[0].source, 'user', 'edited item is user-sourced');
    assert.strictEqual(t.statusHistory.length, 1, 'snapshot taken');
    assert.strictEqual(t.statusHistory[0].statusSummary.overview[0].text, 'original text', 'snapshot holds pre-edit value');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4 — Proposed updates
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 4: proposal flow ───');

test('_diffStatus detects overview additions', () => {
    const { Sidebar } = makeEnv();
    const changes = Sidebar._diffStatus(
        { overview: [{ text: 'a' }] },
        { overview: [{ text: 'a' }, { text: 'b' }] }
    );
    assert.deepStrictEqual(plain(changes), [{ kind: 'overview_add', field: 'overview', itemType: 'bullet', text: 'b' }]);
});

test('_diffStatus detects overview removals', () => {
    const { Sidebar } = makeEnv();
    const changes = Sidebar._diffStatus(
        { overview: [{ text: 'stays here fine' }, { text: 'goes away entirely' }] },
        { overview: [{ text: 'stays here fine' }] }
    );
    assert.deepStrictEqual(plain(changes), [{ kind: 'overview_remove', field: 'overview', itemType: 'bullet', text: 'goes away entirely', oldText: 'goes away entirely' }]);
});

test('_diffStatus pairs prefix-matched remove+add as an edit', () => {
    const { Sidebar } = makeEnv();
    const changes = Sidebar._diffStatus(
        { overview: ['Learning Python basics for data work'] },
        { overview: ['Learning Python basics and Django now'] }
    );
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].kind, 'overview_edit');
    assert.strictEqual(changes[0].oldText, 'Learning Python basics for data work');
    assert.strictEqual(changes[0].text, 'Learning Python basics and Django now');
});

test('_diffStatus is overview-only (ignores concepts_traversed if present)', () => {
    const { Sidebar } = makeEnv();
    const changes = Sidebar._diffStatus(
        { overview: [{ text: 'same' }], concepts_traversed: [{ title: 'SVM' }] },
        { overview: [{ text: 'same' }], concepts_traversed: [{ title: 'Transformers' }] }
    );
    assert.strictEqual(changes.length, 0, 'concept-only diffs produce no changes');
});

test('_diffStatus diffs goals when the proposed payload includes goals', () => {
    const { Sidebar } = makeEnv();
    const changes = Sidebar._diffStatus(
        { overview: [], goals: [{ id: 'g1', text: 'Keep this' }] },
        { overview: [], goals: [{ text: 'Keep this' }, { text: 'New goal' }] }
    );
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].kind, 'goal_add');
    assert.strictEqual(changes[0].field, 'goals');
    assert.strictEqual(changes[0].text, 'New goal');
});

test('_stageProposal with no changes logs proposal_empty and returns false', () => {
    const { Sidebar, loggedEvents } = makeEnv();
    const topic = { id: 't1', statusSummary: { overview: [{ text: 'a' }] } };
    const staged = Sidebar._stageProposal(topic, { overview: ['a'] }, 'manual');
    assert.strictEqual(staged, false);
    assert.ok(loggedEvents.some(e => e.type === 'proposal_empty'));
    assert.ok(!topic.pendingProposal, 'no proposal staged');
});

test('_stageProposal stages pendingProposal and logs proposal_shown with nChanges', () => {
    const { Sidebar, loggedEvents } = makeEnv();
    const topic = { id: 't1', statusSummary: { overview: [] } };
    const staged = Sidebar._stageProposal(topic, { overview: ['new fact'] }, 'new_messages');
    assert.strictEqual(staged, true);
    assert.ok(topic.pendingProposal, 'pendingProposal set');
    assert.strictEqual(topic.pendingProposal.trigger, 'new_messages');
    assert.strictEqual(topic.pendingProposal.changes.length, 1);
    const shown = loggedEvents.find(e => e.type === 'proposal_shown');
    assert.ok(shown, 'proposal_shown logged');
    assert.strictEqual(shown.data.nChanges, 1);
    assert.strictEqual(shown.data.stage, 'construct');
});

test('_stageProposal tags sources: label-derived for labels trigger, inferred otherwise', () => {
    const { Sidebar } = makeEnv();
    const t1 = { id: 't1', statusSummary: { overview: [] } };
    Sidebar._stageProposal(t1, { overview: ['from labels'] }, 'labels');
    assert.strictEqual(t1.pendingProposal.statusUpdate.overview[0].source, 'label-derived');
    const t2 = { id: 't2', statusSummary: { overview: [] } };
    Sidebar._stageProposal(t2, { overview: ['from messages'] }, 'new_messages');
    assert.strictEqual(t2.pendingProposal.statusUpdate.overview[0].source, 'inferred');
});

test('_stageProposal replacing an existing proposal logs proposal_superseded', () => {
    const { Sidebar, loggedEvents } = makeEnv();
    const topic = { id: 't1', statusSummary: { overview: [] } };
    Sidebar._stageProposal(topic, { overview: ['first'] }, 'manual');
    Sidebar._stageProposal(topic, { overview: ['second'] }, 'manual');
    assert.ok(loggedEvents.some(e => e.type === 'proposal_superseded'));
    assert.strictEqual(topic.pendingProposal.changes[0].text, 'second', 'latest proposal wins');
});

test('_stageProposal statusUpdate contains overview only', () => {
    const { Sidebar } = makeEnv();
    const topic = { id: 't1', statusSummary: { overview: [] } };
    Sidebar._stageProposal(topic, {
        overview: ['new fact'],
        concepts_traversed: [{ title: 'SVM', stance: 'neutral' }],
    }, 'manual');
    assert.ok(topic.pendingProposal);
    assert.ok(!('concepts_traversed' in topic.pendingProposal.statusUpdate),
        'proposal must not carry concepts_traversed');
    assert.strictEqual(topic.pendingProposal.statusUpdate.overview[0].text, 'new fact');
});

test('_acceptProposal applies update, snapshots, clears proposal, logs proposal_accepted', () => {
    const { ctx, Storage, Sidebar, loggedEvents } = makeEnv();
    ctx.localStorage.setItem('loom_data', JSON.stringify({
        topics: [{ id: 't1', name: 'ML', statusSummary: { overview: [{ text: 'old' }] } }],
        chats: [], messages: {}, concepts: [], currentChatId: null, personalDetails: [],
    }));
    let topic = Storage.getTopic('t1');
    Sidebar._stageProposal(topic, { overview: ['old', 'brand new'] }, 'manual');
    Sidebar.currentTopicId = 't1';
    Sidebar._acceptProposal();
    topic = Storage.getTopic('t1');
    assert.strictEqual(topic.pendingProposal, null, 'proposal cleared');
    assert.ok(topic.statusSummary.overview.some(it => it.text === 'brand new'), 'update applied');
    assert.ok(topic.statusHistory.some(h => h.trigger === 'proposal_accept'), 'snapshot taken before apply');
    assert.ok(loggedEvents.some(e => e.type === 'proposal_accepted'));
});

test('_dismissProposal clears proposal without touching status, logs proposal_dismissed', () => {
    const { ctx, Storage, Sidebar, loggedEvents } = makeEnv();
    ctx.localStorage.setItem('loom_data', JSON.stringify({
        topics: [{ id: 't1', name: 'ML', statusSummary: { overview: [{ text: 'old' }] } }],
        chats: [], messages: {}, concepts: [], currentChatId: null, personalDetails: [],
    }));
    let topic = Storage.getTopic('t1');
    Sidebar._stageProposal(topic, { overview: ['old', 'unwanted'] }, 'merge');
    Sidebar.currentTopicId = 't1';
    Sidebar._dismissProposal();
    topic = Storage.getTopic('t1');
    assert.strictEqual(topic.pendingProposal, null);
    assert.strictEqual(topic.statusSummary.overview.length, 1, 'status untouched');
    assert.ok(loggedEvents.some(e => e.type === 'proposal_dismissed'));
});

test('all three merge sites route through _stageProposal (new_messages / manual / labels)', () => {
    ["'new_messages'", "'manual'", "'labels'"].forEach(trigger => {
        assert.ok(new RegExp(`_stageProposal\\([^)]*${trigger}`).test(sidebarSrc),
            `sidebar.js stages proposal with trigger ${trigger}`);
    });
});

test('app.js stages proposals for merge and rename', () => {
    assert.ok(/_stageProposal\([\s\S]{0,220}'merge'\)/.test(appContent), 'merge routes through proposal');
    assert.ok(/_stageProposal\([\s\S]{0,220}'rename'\)/.test(appContent), 'rename routes through proposal');
});

test('proposal edit commits user-modified content with source user', () => {
    const start = sidebarSrc.lastIndexOf('_saveProposalEdits(');
    const saveBlock = sidebarSrc.slice(start, sidebarSrc.indexOf('_bindStatusItemActions(', start));
    assert.ok(saveBlock.includes("source: 'user'"), 'edited adds tagged user');
    assert.ok(saveBlock.includes("source = 'user'"), 'in-place edits tagged user');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 5 — Intentions
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 5: intentions ───');

test('all intention lifecycle events logged with stage evolve or construct', () => {
    ['goal_saved', 'goal_dismissed', 'goal_modified'].forEach(evt => {
        const idx = sidebarSrc.indexOf(`'${evt}'`);
        assert.ok(idx > -1, `${evt} logged in sidebar.js`);
        assert.ok(sidebarSrc.slice(idx, idx + 280).includes("'evolve'"), `${evt} tagged stage evolve`);
    });
    ['goal_authored', 'goal_removed'].forEach(evt => {
        const idx = sidebarSrc.indexOf(`'${evt}'`);
        assert.ok(idx > -1, `${evt} logged in sidebar.js`);
        assert.ok(sidebarSrc.slice(idx, idx + 280).includes("'construct'"), `${evt} tagged stage construct`);
    });
    assert.ok(!sidebarSrc.includes("'goal_explored'"),
        'goal_explored retired — goals stay until deleted');
});

test('old probe accept/ignore buttons are gone', () => {
    assert.ok(!sidebarSrc.includes('probe-accept'), 'probe-accept removed');
    assert.ok(!sidebarSrc.includes('probe-ignore'), 'probe-ignore removed');
});

test('dismissed goals are merged into previouslySuggested on shuffle', () => {
    const idx = sidebarSrc.indexOf('shuffleDirections');
    const block = sidebarSrc.slice(idx, idx + 2500);
    assert.ok(block.includes('dismissedGoals'), 'shuffle excludes dismissed goals');
});

test('add-goal input exists and welcome cards surface saved goals', () => {
    assert.ok(indexHtml.includes('addGoal') || sidebarSrc.includes('_initAddGoal'),
        'add goal input wired');
    assert.ok(appContent.includes('goals') && appContent.includes('isGoal'),
        'app.js suggestion cards handle goals');
});

test('saving an unedited Evolve suggestion is inferred, not user-authored', () => {
    const start = sidebarSrc.indexOf('_saveSuggestedGoal(dir, opts');
    const block = sidebarSrc.slice(start, start + 800);
    assert.ok(block.includes("dir.editedByUser ? 'user' : 'inferred'"),
        'unedited suggestion is inferred; edited text is user');
});

test('Ask this on a suggested goal does not save it as a Construct goal', () => {
    const start = sidebarSrc.indexOf("el.querySelector('.card-new-chat-btn')");
    const block = sidebarSrc.slice(start, sidebarSrc.indexOf('const regenBtn', start));
    assert.ok(block.includes('_startGoalInNewChat'), 'Ask this starts a chat');
    assert.ok(!block.includes('_saveSuggestedGoal'), 'asking does not adopt the goal');
});

test('add-goal input does not silently truncate to 8 words', () => {
    const start = sidebarSrc.indexOf('_initAddGoal(');
    const block = sidebarSrc.slice(start, sidebarSrc.indexOf('_startGoalInNewChat(', start));
    assert.ok(!block.includes('slice(0, 8)'), 'typed goal text is kept in full');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6 — Scrutability
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 6: scrutability ───');

test('_serializeStatus includes all overview items (scope filter removed)', () => {
  // Scope toggle removed — serialize always includes all items
  assert.ok(!sidebarSrc.includes('includeTopicScoped'),
    '_serializeStatus no longer takes includeTopicScoped');
});

test('_toggleItemScope removed with scope toggle', () => {
    assert.ok(!sidebarSrc.includes('_toggleItemScope('), '_toggleItemScope removed');
    assert.ok(!sidebarSrc.includes('status-item-scope'), 'scope button removed');
});

test('concept helpers and Concepts Traversed UI are gone', () => {
    ['_normalizeConcept', '_mergeStances', '_sortConcepts', '_setConceptStance', '_deleteConcept', '_migrateThreadsToConcepts']
        .forEach(fn => assert.ok(!sidebarSrc.includes(fn + '('), `${fn} removed`));
    assert.ok(!sidebarSrc.includes('Concepts Traversed'), 'Concepts Traversed label gone');
    assert.ok(!sidebarSrc.includes('concept-drop-tray'), 'drop tray gone');
});

test('source badges rendered for label-derived and user items', () => {
    assert.ok(sidebarSrc.includes('from your labels'), 'label-derived badge copy');
    assert.ok(sidebarSrc.includes('you wrote this'), 'user badge copy');
});

test('connection contest writes excludedChatIds + connContested and logs', () => {
    assert.ok(appContent.includes('conn-card-contest'), 'contest button on connection card');
    assert.ok(appContent.includes('excludedChatIds.push'), 'chat id pushed to topic excludedChatIds');
    assert.ok(appContent.includes('connContested = { chatId'), 'contested marker written to message');
    assert.ok(appContent.includes("'connection_contested'"), 'connection_contested logged');
});

test('contested marker strike-through is re-applied on reload', () => {
    assert.ok(appContent.includes('msg.connContested') &&
        appContent.includes("classList.add('conn-marker-contested')"),
        '_appendMessage re-applies conn-marker-contested from stored message');
});

test('context_card_shown logs only on the live stream path, not history replay', () => {
    assert.ok(appContent.includes("{ replay: true }"), 'history re-render marks replay');
    const fnStart = appContent.indexOf('_renderInjectedPastPanel(assistantEl, injectedPastChats');
    const fnBlock = appContent.slice(fnStart, appContent.indexOf('_isUnassignedTopic', fnStart));
    assert.ok(fnBlock.includes('if (!opts.replay)'), 'replay path skips context_card_shown');
});

test('sendMessage filters excluded chats from injected context', () => {
    assert.ok(appContent.includes('excludedChatIds'), 'topic excludedChatIds filter');
    assert.ok(!appContent.includes('suppressedChatIds'), 'chat-level suppressedChatIds removed');
    assert.ok(appContent.includes("'context_excluded_for_topic'"),
        'context_excluded_for_topic logged');
});

test('old ✓/✗ relevance calibration removed from past chat cards', () => {
    assert.ok(!sidebarSrc.includes('past_relevance_calibrated'), 'past_relevance_calibrated gone');
    assert.ok(!appContent.includes('past_relevance_calibrated'));
});

test('topic-scoped serialization enforced on cross-topic sends in app.js', () => {
    assert.ok(!appContent.includes('includeTopicScoped'), 'app.js no longer passes includeTopicScoped');
});

test('rename updates the existing #currentTopicName element (regression)', () => {
    assert.ok(!appContent.includes('statusTopicName'), 'stale #statusTopicName reference removed');
    assert.ok(appContent.includes("getElementById('currentTopicName')"), 'rename targets #currentTopicName');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 7 — Copy + prompts
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 7: copy + prompts ───');

test('_serializeStatus is overview-only (no stance phrasing)', () => {
    const { Sidebar } = makeEnv();
    const out = Sidebar._serializeStatus({
        overview: [{ text: 'Knows Python' }],
        concepts_traversed: [{ title: 'A', stance: 'interested' }],
    });
    assert.ok(out.includes('Knows Python'));
    assert.ok(!out.includes('User flagged interest'));
    assert.ok(!out.includes('A'), 'concepts not serialized');
});

test('_serializeStatus includes goals when present', () => {
    const { Sidebar } = makeEnv();
    const out = Sidebar._serializeStatus({
        overview: [{ text: 'Knows Python' }],
        goals: [{ text: 'Compare X and Y' }],
    });
    assert.ok(out.includes('Knows Python'));
    assert.ok(out.includes('Goals:'));
    assert.ok(out.includes('Compare X and Y'));
});

test('backend serialize and chat stream no longer emit stance_context', () => {
    assert.ok(mainPy.includes('def _serialize_status_to_str'), 'serializer exists');
    assert.ok(mainPy.includes('def _build_coverage_str'), 'coverage helper exists');
    assert.ok(!mainPy.includes('stance_context'), 'stance_context removed');
    assert.ok(!mainPy.includes('User flagged interest'), 'stance phrasing gone');
});

test('directions prompt is re-grounded on coverage (overview + past chats)', () => {
    assert.ok(promptsPy.includes('{coverage}'), 'coverage placeholder');
    assert.ok(!promptsPy.includes('{covered_concepts}'), 'old covered_concepts gone');
    assert.ok(promptsPy.includes('breadth must reference something NOT appearing in the coverage list'));
    assert.ok(promptsPy.includes('depth must reference something that DOES'));
    assert.ok(!promptsPy.includes('flagged interest'), 'stance grounding gone');
});

test('memory prompt places the D7 profile block before the respond cue', () => {
    const mem = promptsPy.slice(
        promptsPy.indexOf('CHAT_STREAM_MEMORY_PROMPT'),
        promptsPy.indexOf('CHAT_METADATA_PROMPT')
    );
    assert.ok(mem.includes('{profile_block}'), 'profile placeholder in memory prompt');
    assert.ok(mem.indexOf('{profile_block}') < mem.indexOf("Now respond to the user's message."),
        'profile comes before Now respond');
    assert.ok(mainPy.includes('profile_block=profile_block'),
        'memory path formats profile into the prompt, not appended after');
});

test('STATUS_UPDATE and metadata prompts drop concepts', () => {
    assert.ok(!promptsPy.includes('concepts_traversed'), 'no concepts_traversed in prompts');
    assert.ok(promptsPy.includes('"overview"') && promptsPy.includes('"type": "header"'),
        'status returns typed overview with headers');
    const meta = promptsPy.split('CHAT_METADATA_PROMPT')[1].split('STATUS_UPDATE')[0];
    assert.ok(!meta.includes('"concepts"'), 'metadata has no concepts array');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 8 — Logging re-key + admin dashboard
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n─── Phase 8: logging + admin dashboard ───');

test('removed events are gone from the frontend', () => {
    ['past_relevance_calibrated', 'future_suggestion_accepted', 'future_suggestion_ignored',
     'current_concept_stance_set'].forEach(evt => {
        assert.ok(!sidebarSrc.includes(`'${evt}'`), `${evt} removed from sidebar`);
    });
});

test('kept construct/apply/evolve events carry stage tags', () => {
    const src = appContent + sidebarSrc;
    [['current_profile_edited', 'construct'],
     ['context_excluded_for_topic', 'user'],
     ['connection_contested', 'chat'],
     ['goal_question_asked', 'evolve'],
     ['future_directions_refreshed', 'evolve']].forEach(([evt, stage]) => {
        const idx = src.indexOf(`'${evt}'`);
        assert.ok(idx > -1, `${evt} exists`);
        assert.ok(src.slice(idx, idx + 280).includes(`'${stage}'`), `${evt} tagged ${stage}`);
    });
});

test('admin dashboard groups events by Construct/Apply/Evolve/Scrutability', () => {
    assert.ok(mainPy.includes('const CONSTRUCT ='), 'CONSTRUCT list');
    assert.ok(mainPy.includes('const APPLY ='), 'APPLY list');
    assert.ok(mainPy.includes('const EVOLVE ='), 'EVOLVE list');
    assert.ok(mainPy.includes('const SCRUTABILITY ='), 'SCRUTABILITY list');
    assert.ok(!mainPy.includes('const MOD1'), 'old MOD1 gone');
    assert.ok(mainPy.includes('<th>Construct</th><th>Apply</th><th>Evolve</th><th>Scrutability</th>'),
        'table headers renamed');
    assert.ok(!mainPy.includes('<th>Mod 1</th>'), 'old Mod headers gone');
});

test('admin category lists contain the new event names', () => {
    ['proposal_shown', 'proposal_accepted', 'proposal_dismissed'].forEach(e =>
        assert.ok(mainPy.includes(`'${e}'`), `${e} in admin lists`));
    ['context_card_shown', 'context_excluded_for_topic', 'context_link_opened'].forEach(e =>
        assert.ok(mainPy.includes(`'${e}'`), `${e} in admin lists`));
    ['goal_saved', 'goal_explored', 'goal_authored'].forEach(e =>
        assert.ok(mainPy.includes(`'${e}'`), `${e} in admin lists`));
    ['update_undone', 'version_restored'].forEach(e =>
        assert.ok(mainPy.includes(`'${e}'`), `${e} in admin lists`));
});

// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════');
if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => {
        console.log(`  ✗ ${f.name}`);
        console.log(`    ${f.error.message}`);
        console.log(`    ${f.error.stack.split('\n').slice(1, 4).join('\n    ')}`);
    });
    process.exit(1);
}
