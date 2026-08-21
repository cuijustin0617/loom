/**
 * Design-probe Round 2 behavior tests (10a + 10b).
 * Node vm harness loading storage.js / sidebar.js / app.js with stubbed browser globals.
 *
 * Run: node frontend/tests/designProbe.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextEncoder } = require('util');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    const run = () => {
        const ret = fn();
        if (ret && typeof ret.then === 'function') {
            return ret.then(() => {
                passed++;
                console.log(`  ✓ ${name}`);
            }).catch(e => {
                failed++;
                failures.push({ name, error: e });
                console.log(`  ✗ ${name}`);
                console.log(`    ${e.message}`);
            });
        }
        passed++;
        console.log(`  ✓ ${name}`);
        return Promise.resolve();
    };
    try {
        return run();
    } catch (e) {
        failed++;
        failures.push({ name, error: e });
        console.log(`  ✗ ${name}`);
        console.log(`    ${e.message}`);
        return Promise.resolve();
    }
}

const plain = x => JSON.parse(JSON.stringify(x));

const ROOT = path.resolve(__dirname, '../..');
const storageSrc = fs.readFileSync(path.join(ROOT, 'frontend/storage.js'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(ROOT, 'frontend/sidebar.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'frontend/app.js'), 'utf8');

function makeEl(tag) {
    const classSet = new Set();
    const children = [];
    const listeners = {};
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        className: '',
        _innerHTML: '',
        _parsed: {},
        style: {},
        dataset: {},
        disabled: false,
        value: '',
        parentNode: null,
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
            this._innerHTML = String(v);
            this._parsed = {};
            const re = /<button([^>]*)>([\s\S]*?)<\/button>/gi;
            let m;
            while ((m = re.exec(this._innerHTML))) {
                const attrs = m[1];
                const text = m[2].replace(/<[^>]+>/g, '');
                const classM = attrs.match(/class="([^"]*)"/);
                const cls = classM ? classM[1] : '';
                const btn = makeEl('button');
                btn.className = cls;
                btn.textContent = text;
                cls.split(/\s+/).filter(Boolean).forEach(c => {
                    btn.classList.add(c);
                    el._parsed['.' + c] = btn;
                });
            }
        },
        _text: '',
        get textContent() { return this._text || this._innerHTML.replace(/<[^>]+>/g, ''); },
        set textContent(v) {
            this._text = String(v ?? '');
            this._innerHTML = this._text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
        classList: {
            add(c) { classSet.add(c); el.className = [...classSet].join(' '); },
            remove(c) { classSet.delete(c); el.className = [...classSet].join(' '); },
            contains(c) { return classSet.has(c); },
            toggle(c) { classSet.has(c) ? classSet.delete(c) : classSet.add(c); el.className = [...classSet].join(' '); },
        },
        querySelector(sel) {
            if (this._parsed[sel]) return this._parsed[sel];
            if (sel && sel[0] === '.' && this._innerHTML.includes(sel.slice(1))) {
                const dummy = makeEl('div');
                this._parsed[sel] = dummy;
                return dummy;
            }
            return null;
        },
        querySelectorAll: () => [],
        addEventListener(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
        },
        click() {
            (listeners.click || []).forEach(fn => fn({
                stopPropagation() {},
                currentTarget: el,
                target: el,
            }));
        },
        _children: children,
        appendChild(c) { children.push(c); c.parentNode = this; return c; },
        insertBefore(c) { children.unshift(c); c.parentNode = this; return c; },
        remove() {
            if (this.parentNode && this.parentNode._children) {
                this.parentNode._children = this.parentNode._children.filter(x => x !== this);
            }
        },
        replaceWith() {},
        closest: () => null,
        focus() {},
        select() {},
        scrollIntoView() {},
        get firstChild() { return children[0] || null; },
        get children() { return children; },
    };
    return el;
}

function makeEnv(opts = {}) {
    const store = new Map();
    const loggedEvents = [];
    const fetchCalls = [];
    const byId = {};
    const cannedRefresh = opts.cannedRefresh || {
        statusUpdate: {
            overview: [{ type: 'bullet', text: 'Knows Python' }],
            goals: [{ text: 'Explore generative AI system design' }, { text: 'Master offline evaluation' }],
        },
        newDirections: [{
            title: 'Explore generative AI system design',
            exampleQuestion: 'How would you design a retrieval-augmented generation system?',
            type: 'depth',
            anchor: 'profile',
        }],
    };
    const pastChats = opts.injectedPastChats || [
        { chatId: 'chat_past_a', title: 'Past A', userAsked: 'What is backprop?' },
        { chatId: 'chat_past_b', title: 'Past B', userAsked: 'What is dropout?' },
    ];

    const document = {
        getElementById(id) {
            if (!byId[id]) byId[id] = makeEl('div');
            return byId[id];
        },
        createElement: tag => makeEl(tag),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        body: makeEl('body'),
    };

    async function fetchImpl(url, init) {
        fetchCalls.push({ url, init });
        const u = String(url);
        if (u.includes('/api/log')) {
            return { ok: true, json: async () => ({ ok: true }) };
        }
        if (u.includes('/api/sidebar/refresh')) {
            return { ok: true, json: async () => cannedRefresh };
        }
        if (u.includes('/api/sidebar/goal-question')) {
            return { ok: true, json: async () => ({ question: 'How would you evaluate this system offline?' }) };
        }
        if (u.includes('/api/chat/stream')) {
            const sse = [
                'data: {"type":"chunk","text":"Hello"}',
                `data: ${JSON.stringify({
                    type: 'done',
                    response: 'Hello',
                    topic: { name: 'ML', matchedExistingId: null, confidence: 0.9 },
                    injectedPastChats: pastChats,
                })}`,
                '',
            ].join('\n\n');
            const bytes = new TextEncoder().encode(sse);
            let sent = false;
            return {
                ok: true,
                body: {
                    getReader() {
                        return {
                            read() {
                                if (sent) return Promise.resolve({ done: true, value: undefined });
                                sent = true;
                                return Promise.resolve({ done: false, value: bytes });
                            },
                        };
                    },
                },
                json: async () => ({}),
            };
        }
        return { ok: false, json: async () => ({}) };
    }

    const ctx = {
        console,
        setTimeout, clearTimeout,
        JSON, Math, Date, Object, Array, String, Number, Boolean, Set, Promise,
        parseInt, parseFloat, isNaN, Infinity,
        TextEncoder,
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
        document,
        window: null,
        fetch: fetchImpl,
        Utils: {
            timestamp: () => new Date().toISOString(),
            generateId: () => Math.random().toString(36).slice(2, 10),
            escapeHtml: s => String(s ?? '')
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            showToast() {},
            renderMarkdown: s => String(s ?? ''),
            truncate: (s, n) => String(s ?? '').slice(0, n),
            wordDiff: (a, b) => [{ type: 'same', text: b || a || '' }],
            TOPIC_COLORS: [{ hue: 210 }],
            getTopicColor: () => ({ color: '#456', light: '#eef' }),
            findDistantHue: () => 210,
            _BLUE_FAMILY_MIN: 180,
            _BLUE_FAMILY_MAX: 260,
        },
        StudyLog: {
            events: loggedEvents,
            event(type, data) { loggedEvents.push({ type, data: data || {} }); },
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    const exported = vm.runInContext(
        storageSrc + '\n' + sidebarSrc + '\n' + appSrc + '\n;({ Storage, Sidebar, App })',
        ctx
    );
    exported.App.sendMessage = function () {};
    exported.App.newChat = function () { this.currentChatId = 'chat_new'; };
    return {
        ctx, Storage: exported.Storage, Sidebar: exported.Sidebar, App: exported.App,
        loggedEvents, fetchCalls, document, byId,
    };
}

function lastOf(events, type) {
    const hits = events.filter(e => e.type === type);
    return hits[hits.length - 1] || null;
}

function seedTopic(Storage, extra = {}) {
    const t = Storage.createTopic('ML');
    t.statusSummary = {
        overview: extra.overview || [{ text: 'CS student', source: 'user' }],
        goals: extra.goals || [{ id: 'goal_keep', text: 'Explore generative AI system design', source: 'user' }],
    };
    Object.assign(t, extra.topic || {});
    return Storage.saveTopic(t);
}

// ═══════════════════════════════════════════════════════════════════════════════
async function run() {

console.log('\n─── 10a: storage / migration ───');

await test('legacy topic.goals migrates to statusSummary.goals with source user', () => {
    const { Storage } = makeEnv();
    const t = {
        id: 't1',
        goals: [{ id: 'g1', title: 'Explore generative AI system design' }, 'Master offline evaluation', null],
        statusSummary: { overview: [{ text: 'Knows Python', source: 'inferred' }] },
    };
    Storage._migrateTopic(t);
    assert.strictEqual(t.statusSummary.goals.length, 2);
    assert.strictEqual(t.statusSummary.goals[0].id, 'g1');
    assert.strictEqual(t.statusSummary.goals[0].text, 'Explore generative AI system design');
    assert.strictEqual(t.statusSummary.goals[0].source, 'user');
    assert.strictEqual(t.statusSummary.goals[1].text, 'Master offline evaluation');
    assert.strictEqual(t.statusSummary.goals[1].source, 'user');
});

await test('createTopic initializes statusSummary overview/goals empty arrays', () => {
    const { Storage } = makeEnv();
    const t = Storage.createTopic('New');
    assert.deepStrictEqual(plain(t.statusSummary), { overview: [], goals: [] });
    assert.strictEqual(t.needsInitialUpdate, true);
});

await test('topic migration only marks truly empty uncached topics for an initial update', () => {
    const { Storage } = makeEnv();
    const empty = { id: 'empty', statusSummary: { overview: [], goals: [] } };
    const populated = { id: 'populated', statusSummary: { overview: [{ text: 'Known' }], goals: [] } };
    const cached = {
        id: 'cached',
        statusSummary: { overview: [], goals: [] },
        sidebarCache: { statusUpdate: { overview: [], goals: [] } },
    };
    Storage._migrateTopic(empty);
    Storage._migrateTopic(populated);
    Storage._migrateTopic(cached);
    assert.strictEqual(empty.needsInitialUpdate, true);
    assert.strictEqual(populated.needsInitialUpdate, false);
    assert.strictEqual(cached.needsInitialUpdate, false);
});

await test('initial topic update clears its marker on success and restores it on failure', async () => {
    const { Storage, Sidebar, App } = makeEnv();
    const topic = Storage.createTopic('Fresh');
    App._isOneTimeTopic = () => false;
    Sidebar.refresh = async trigger => {
        assert.strictEqual(trigger, 'initial');
        return true;
    };
    assert.strictEqual(await App._triggerInitialTopicUpdate(topic.id), true);
    assert.strictEqual(Storage.getTopic(topic.id).needsInitialUpdate, false);

    const failed = Storage.createTopic('Retry');
    Sidebar.refresh = async () => false;
    assert.strictEqual(await App._triggerInitialTopicUpdate(failed.id), false);
    assert.strictEqual(Storage.getTopic(failed.id).needsInitialUpdate, true);
});

await test('Overview Markdown round-trips headers, bullets, Unicode, and punctuation', () => {
    const { Sidebar } = makeEnv();
    const overview = [
        { type: 'header', text: 'Background' },
        { type: 'bullet', text: 'Uses **Markdown** & 日本語', source: 'inferred' },
    ];
    const markdown = Sidebar._overviewToMarkdown(overview);
    assert.strictEqual(markdown, '## Background\n- Uses **Markdown** & 日本語');
    assert.deepStrictEqual(plain(Sidebar._parseOverviewMarkdown(markdown, overview)), overview);
});

await test('Overview Markdown parser drops blank lines and supports reordered plain bullets', () => {
    const { Sidebar } = makeEnv();
    const previous = [
        { type: 'bullet', text: 'First', source: 'inferred' },
        { type: 'bullet', text: 'Second', source: 'user' },
    ];
    const parsed = Sidebar._parseOverviewMarkdown('\n- Second\n\nFirst\n\n', previous);
    assert.deepStrictEqual(plain(parsed), [
        { type: 'bullet', text: 'Second', source: 'user' },
        { type: 'bullet', text: 'First', source: 'inferred' },
    ]);
});

await test('Overview Markdown parser preserves duplicate metadata in encounter order', () => {
    const { Sidebar } = makeEnv();
    const previous = [
        { type: 'bullet', text: 'Same', source: 'inferred' },
        { type: 'bullet', text: 'Same', source: 'user' },
    ];
    const parsed = Sidebar._parseOverviewMarkdown('- Same\n- Same', previous);
    assert.deepStrictEqual(plain(parsed), previous);
});

await test('saving Overview Markdown snapshots exactly once and unchanged save is a no-op', () => {
    const { Storage, Sidebar, loggedEvents } = makeEnv();
    const topic = Storage.createTopic('ML');
    topic.statusSummary.overview = [{ type: 'bullet', text: 'Old', source: 'inferred' }];
    Storage.saveTopic(topic);
    Sidebar.currentTopicId = topic.id;
    Sidebar._renderStatus = () => {};

    assert.strictEqual(Sidebar._saveOverviewMarkdown('- New'), true);
    let saved = Storage.getTopic(topic.id);
    assert.strictEqual(saved.statusHistory.length, 1);
    assert.strictEqual(saved.statusHistory[0].trigger, 'overview_markdown_edit');
    assert.deepStrictEqual(plain(saved.statusSummary.overview), [
        { type: 'bullet', text: 'New', source: 'user' },
    ]);
    assert.strictEqual(Sidebar._saveOverviewMarkdown('- New'), false);
    saved = Storage.getTopic(topic.id);
    assert.strictEqual(saved.statusHistory.length, 1);
    assert.strictEqual(lastOf(loggedEvents, 'current_profile_edited').data.editType, 'markdown');
});

await test('saving whitespace-only Overview Markdown deletes all items with one snapshot', () => {
    const { Storage, Sidebar } = makeEnv();
    const topic = Storage.createTopic('ML');
    topic.statusSummary.overview = [{ type: 'bullet', text: '<script>alert(1)</script>', source: 'user' }];
    Storage.saveTopic(topic);
    Sidebar.currentTopicId = topic.id;
    Sidebar._renderStatus = () => {};
    Sidebar._saveOverviewMarkdown(' \n \t');
    const saved = Storage.getTopic(topic.id);
    assert.deepStrictEqual(plain(saved.statusSummary.overview), []);
    assert.strictEqual(saved.statusHistory.length, 1);
});

await test('truncateBeforeMessage atomically removes target and later turns and invalidates summary', () => {
    const { Storage } = makeEnv();
    const chat = Storage.createChat();
    chat.title = 'Original title';
    chat.summary = 'old summary';
    chat.userAsked = 'old ask';
    chat.aiCovered = 'old answer';
    chat.embedding = [1, 2];
    chat.summarized = true;
    Storage.saveChat(chat);
    Storage.addMessage(chat.id, { id: 'u1', role: 'user', content: 'first' });
    Storage.addMessage(chat.id, { id: 'a1', role: 'assistant', content: 'reply' });
    Storage.addMessage(chat.id, { id: 'u2', role: 'user', content: 'second' });

    const result = Storage.truncateBeforeMessage(chat.id, 'u2');
    assert.strictEqual(result.target.id, 'u2');
    assert.deepStrictEqual(plain(Storage.getMessages(chat.id).map(m => m.id)), ['u1', 'a1']);
    const saved = Storage.getChat(chat.id);
    assert.strictEqual(saved.summary, '');
    assert.strictEqual(saved.userAsked, '');
    assert.strictEqual(saved.aiCovered, '');
    assert.strictEqual(saved.embedding, null);
    assert.strictEqual(saved.summarized, false);
    assert.strictEqual(saved.title, 'Original title');
});

await test('truncateBeforeMessage leaves persisted history intact when storage write fails', () => {
    const { Storage } = makeEnv();
    const chat = Storage.createChat();
    Storage.addMessage(chat.id, { id: 'u1', role: 'user', content: 'first' });
    Storage.addMessage(chat.id, { id: 'a1', role: 'assistant', content: 'reply' });
    Storage._saveAll = () => false;
    assert.strictEqual(Storage.truncateBeforeMessage(chat.id, 'u1'), null);
    assert.deepStrictEqual(plain(Storage.getMessages(chat.id).map(m => m.id)), ['u1', 'a1']);
});

await test('truncateBeforeMessage handles a middle user turn and preserves earlier history', () => {
    const { Storage } = makeEnv();
    const chat = Storage.createChat();
    ['u1', 'a1', 'u2', 'a2', 'u3'].forEach((id, index) => {
        Storage.addMessage(chat.id, {
            id,
            role: id[0] === 'u' ? 'user' : 'assistant',
            content: `message ${index}`,
        });
    });
    const result = Storage.truncateBeforeMessage(chat.id, 'u2');
    assert.deepStrictEqual(plain(Storage.getMessages(chat.id).map(m => m.id)), ['u1', 'a1']);
    assert.deepStrictEqual(plain(result.removed.map(m => m.id)), ['u2', 'a2', 'u3']);
});

await test('message rewrite restores Construct checkpoint and clears downstream state', async () => {
    const { Storage, Sidebar, App, loggedEvents, document } = makeEnv();
    const topic = Storage.createTopic('ML');
    topic.statusSummary = { overview: [{ text: 'After', source: 'inferred' }], goals: [{ text: 'Later goal' }] };
    topic.pendingProposal = { changes: [{ kind: 'overview_add', text: 'stale' }] };
    topic.sidebarCache = { statusUpdate: topic.statusSummary, newDirections: [] };
    topic._flushedAnnotationIds = ['keep', 'drop'];
    Storage.saveTopic(topic);
    const chat = Storage.createChat();
    chat.topicId = topic.id;
    chat.summary = 'stale';
    chat.embedding = [0.1];
    Storage.saveChat(chat);
    const checkpoint = {
        topicId: topic.id,
        statusSummary: { overview: [{ text: 'Before', source: 'user' }], goals: [] },
    };
    Storage.addMessage(chat.id, {
        id: 'u1', role: 'user', content: 'old question', constructCheckpoint: checkpoint,
        attachments: [{ name: 'notes.txt', mimeType: 'text/plain' }],
    });
    Storage.addMessage(chat.id, {
        id: 'a1', role: 'assistant', content: 'old reply',
        annotations: [{ id: 'drop', label: 'important', spanText: 'old' }],
    });
    App.currentChatId = chat.id;
    App._renderChat = () => {};
    Sidebar.show = () => {};
    let sent = 0;
    App.sendMessage = async () => { sent++; };

    assert.strictEqual(await App._rewriteUserMessage('u1', 'new question', { confirmRewrite: false }), true);
    assert.deepStrictEqual(plain(Storage.getMessages(chat.id)), []);
    const savedTopic = Storage.getTopic(topic.id);
    assert.strictEqual(savedTopic.statusSummary.overview[0].text, 'Before');
    assert.strictEqual(savedTopic.pendingProposal, null);
    assert.ok(!savedTopic.sidebarCache);
    assert.deepStrictEqual(plain(savedTopic._flushedAnnotationIds), ['keep']);
    assert.strictEqual(savedTopic.statusHistory.at(-1).trigger, 'message_edit_rollback');
    assert.strictEqual(document.getElementById('chatInput').value, 'new question');
    assert.strictEqual(App._messageRewriteMeta.attachments[0].name, 'notes.txt');
    assert.strictEqual(sent, 1);
    assert.strictEqual(lastOf(loggedEvents, 'message_edited').data.removedMessages, 2);
});

await test('message rewrite rejects empty, unchanged, and active-stream edits without truncating', async () => {
    const { Storage, App } = makeEnv();
    const chat = Storage.createChat();
    Storage.addMessage(chat.id, { id: 'u1', role: 'user', content: 'same' });
    App.currentChatId = chat.id;
    App._renderChat = () => {};
    assert.strictEqual(await App._rewriteUserMessage('u1', '   ', { confirmRewrite: false }), false);
    assert.strictEqual(await App._rewriteUserMessage('u1', 'same', { confirmRewrite: false }), false);
    App._sendInFlight = true;
    assert.strictEqual(await App._rewriteUserMessage('u1', 'different', { confirmRewrite: false }), false);
    assert.strictEqual(Storage.getMessages(chat.id).length, 1);
});

await test('message rewrite replaces only the visible query and preserves context prefixes', () => {
    const { App } = makeEnv();
    const original = '[My current status in "ML": Overview: prior]\n\nold visible query';
    assert.strictEqual(
        App._replaceVisibleUserQuery(original, 'new visible query'),
        '[My current status in "ML": Overview: prior]\n\nnew visible query'
    );
});

await test('topic reassignment round-trips regular and one-off state and updates current sidebar', () => {
    const { Storage, Sidebar, App, loggedEvents, document } = makeEnv();
    const first = Storage.createTopic('First');
    const second = Storage.createTopic('Second');
    const oneOff = App._getOrCreateOneTimeTopic();
    const chat = Storage.createChat();
    chat.topicId = first.id;
    Storage.saveChat(chat);
    App.currentChatId = chat.id;
    let shown = null;
    let hidden = 0;
    Sidebar.show = id => { shown = id; };
    Sidebar.hide = () => { hidden++; };

    App._moveChat(chat.id, oneOff.id, first.id, { method: 'one_off' });
    let saved = Storage.getChat(chat.id);
    assert.strictEqual(saved.topicId, oneOff.id);
    assert.strictEqual(saved.oneTime, true);
    assert.strictEqual(hidden, 1);
    assert.strictEqual(document.getElementById('topicBadge').textContent, 'One-off');

    App._moveChat(chat.id, second.id, oneOff.id, { method: 'picker' });
    saved = Storage.getChat(chat.id);
    assert.strictEqual(saved.topicId, second.id);
    assert.strictEqual(saved.oneTime, false);
    assert.strictEqual(shown, second.id);
    assert.strictEqual(document.getElementById('topicBadge').textContent, 'Second');
    const event = lastOf(loggedEvents, 'topic_badge_reassigned');
    assert.strictEqual(event.data.newTopicId, second.id);
    assert.strictEqual(event.data.isOneOff, false);
});

await test('same-topic reassignment is a no-op', () => {
    const { Storage, App, loggedEvents } = makeEnv();
    const topic = Storage.createTopic('Same');
    const chat = Storage.createChat();
    chat.topicId = topic.id;
    Storage.saveChat(chat);
    App._moveChat(chat.id, topic.id, topic.id);
    assert.strictEqual(loggedEvents.filter(e => e.type === 'chat_moved').length, 0);
});

await test('inline topic creation reuses duplicate names case-insensitively', () => {
    const { Storage, App, loggedEvents } = makeEnv();
    const existing = Storage.createTopic('Research Methods');
    const reused = App._getOrCreateTopicByName('  research methods  ');
    assert.strictEqual(reused.id, existing.id);
    assert.strictEqual(loggedEvents.filter(e => e.type === 'topic_created').length, 0);
    const created = App._getOrCreateTopicByName('New Direction');
    assert.strictEqual(created.name, 'New Direction');
    assert.strictEqual(loggedEvents.filter(e => e.type === 'topic_created').length, 1);
});

await test('annotation migration keeps supported labels and removes deprecated labels', () => {
    const { Storage } = makeEnv();
    const data = {
        messages: {
            c1: [{
                annotations: [
                    { id: 'a1', label: 'interested', spanText: 'legacy important' },
                    { id: 'a2', label: 'clear', spanText: 'old clear' },
                    { id: 'a3', label: 'not_relevant', spanText: 'old irrelevant' },
                    { id: 'a4', label: 'unsure', spanText: 'questionable' },
                    { id: 'a5', label: 'comment', spanText: 'note', comment: '<b>mine</b>' },
                ],
            }],
        },
    };
    assert.strictEqual(Storage._migrateAnnotations(data), true);
    assert.deepStrictEqual(
        plain(data.messages.c1[0].annotations.map(a => [a.id, a.label])),
        [['a1', 'important'], ['a4', 'unsure'], ['a5', 'comment']]
    );
    assert.strictEqual(data.messages.c1[0].annotations[2].comment, '<b>mine</b>');
});

await test('Evolve card keeps breadth/depth data internal with neutral markup', () => {
    const { Sidebar } = makeEnv();
    const card = Sidebar._createSuggestedGoalCard({
        title: 'Explore adjacent systems',
        type: 'breadth',
        suggestedAt: '2026-08-20T00:00:00.000Z',
        exampleQuestion: 'What adjacent system should I explore?',
    }, 0);
    assert.ok(card.className.includes('suggested-goal-card'));
    assert.ok(!card.className.includes('type-breadth'));
    assert.ok(!card.innerHTML.includes('broader'));
    assert.ok(!card.innerHTML.includes('Suggested</span>'));
});

await test('one-time annotations clear dirty state without profile refresh', () => {
    const { Storage, Sidebar, App, fetchCalls } = makeEnv();
    Storage.refreshTopicEmbeddings = async () => {};
    const bucket = Storage.createTopic('One-time questions');
    bucket.oneTimeBucket = true;
    Storage.saveTopic(bucket);
    const chat = Storage.createChat({ oneTime: true });
    chat.topicId = bucket.id;
    Storage.saveChat(chat);
    Storage.setCurrentChatId(chat.id);
    App.currentChatId = chat.id;
    Sidebar.currentTopicId = null;
    Sidebar._labelsDirty = true;

    Sidebar._flushDirtyLabels();

    assert.strictEqual(Sidebar._labelsDirty, false);
    assert.ok(!fetchCalls.some(call => String(call.url).includes('/api/topic/status/update')));
});

await test('background topic assignment does not replace visible sidebar', async () => {
    const { Storage, Sidebar, App } = makeEnv();
    Storage.refreshTopicEmbeddings = async () => {};
    const visibleTopic = Storage.createTopic('Visible');
    const backgroundTopic = Storage.createTopic('Background');
    const visibleChat = Storage.createChat();
    visibleChat.topicId = visibleTopic.id;
    Storage.saveChat(visibleChat);
    const backgroundChat = Storage.createChat();
    App.currentChatId = visibleChat.id;
    App._renderChatList = () => {};
    let shown = 0;
    let hidden = 0;
    Sidebar.show = () => { shown += 1; };
    Sidebar.hide = () => { hidden += 1; };

    await App._assignTopicToChat(backgroundChat.id, { topicId: backgroundTopic.id });

    assert.strictEqual(Storage.getChat(backgroundChat.id).topicId, backgroundTopic.id);
    assert.strictEqual(shown, 0);
    assert.strictEqual(hidden, 0);
});

await test('_ensureStatusShape repairs string/null/legacy without losing overview', () => {
    const { Sidebar } = makeEnv();
    const keep = [{ text: 'Knows Python', source: 'user' }];
    const a = { statusSummary: { overview: keep } };
    Sidebar._ensureStatusShape(a);
    assert.deepStrictEqual(plain(a.statusSummary.overview), keep);
    assert.deepStrictEqual(plain(a.statusSummary.goals), []);

    const b = { statusSummary: 'Legacy profile text' };
    Sidebar._ensureStatusShape(b);
    assert.strictEqual(b.statusSummary.overview[0].text, 'Legacy profile text');
    assert.deepStrictEqual(plain(b.statusSummary.goals), []);

    const c = { statusSummary: null };
    Sidebar._ensureStatusShape(c);
    assert.deepStrictEqual(plain(c.statusSummary), { overview: [], goals: [] });
});

await test('pushStatusSnapshot increments statusVersionCounter and stores v; cap keeps counter monotonic', () => {
    const { Storage } = makeEnv();
    const t = { id: 't1', statusSummary: { overview: [], goals: [] }, statusHistory: [] };
    Storage.pushStatusSnapshot(t, 'a');
    assert.strictEqual(t.statusVersionCounter, 1);
    assert.strictEqual(t.statusHistory[0].v, 1);
    assert.strictEqual(t.currentVersion, 1);
    for (let i = 0; i < 12; i++) Storage.pushStatusSnapshot(t, 's' + i);
    assert.strictEqual(t.statusHistory.length, 10);
    assert.ok(t.statusVersionCounter >= 13);
    assert.strictEqual(t.statusHistory[t.statusHistory.length - 1].v, t.statusVersionCounter);
    assert.ok(t.statusHistory[0].v < t.statusHistory[9].v, 'counter stays monotonic after cap');
});

await test('exclusion toggle round-trips excludedChatIds', () => {
    const { Storage } = makeEnv();
    const t = Storage.createTopic('ML');
    t.excludedChatIds.push('chat_a');
    Storage.saveTopic(t);
    assert.ok(Storage.getTopic(t.id).excludedChatIds.includes('chat_a'));
    const t2 = Storage.getTopic(t.id);
    t2.excludedChatIds = t2.excludedChatIds.filter(id => id !== 'chat_a');
    Storage.saveTopic(t2);
    assert.deepStrictEqual(plain(Storage.getTopic(t.id).excludedChatIds), []);
});

console.log('\n─── 10a: proposal / diff ───');

await test('_diffGoalItems add/edit/remove; Dice-similar pairs match as edits', () => {
    const { Sidebar } = makeEnv();
    const add = Sidebar._diffGoalItems([], [{ text: 'Explore generative AI system design' }]);
    assert.deepStrictEqual(plain(add), [{
        kind: 'goal_add', field: 'goals', text: 'Explore generative AI system design',
    }]);

    const edit = Sidebar._diffGoalItems(
        [{ text: 'Explore generative AI system design' }],
        [{ text: 'Explore generative AI design' }]
    );
    assert.strictEqual(edit.length, 1);
    assert.strictEqual(edit[0].kind, 'goal_edit');
    assert.strictEqual(edit[0].field, 'goals');

    const remove = Sidebar._diffGoalItems([{ text: 'Learn cooking basics' }], []);
    assert.strictEqual(remove[0].kind, 'goal_remove');
    assert.strictEqual(remove[0].field, 'goals');

    const swap = Sidebar._diffGoalItems(
        [{ text: 'Learn cooking basics' }],
        [{ text: 'Master offline evaluation' }]
    );
    const kinds = swap.map(c => String(c.kind)).sort();
    assert.ok(kinds.includes('goal_add') && kinds.includes('goal_remove'));
});

await test('_stageProposal without goals key produces no goal changes', () => {
    const { Storage, Sidebar } = makeEnv();
    const topic = seedTopic(Storage);
    Sidebar._stageProposal(topic, { overview: [{ text: 'Knows Python' }] }, 'manual');
    const kinds = (topic.pendingProposal.changes || []).map(c => c.kind);
    assert.ok(!kinds.some(k => String(k).startsWith('goal_')), 'ai-edit path must never wipe goals');
});

await test('_stageProposal with goals: [] does not wipe existing user goals', () => {
    const { Storage, Sidebar } = makeEnv();
    const topic = seedTopic(Storage);
    const staged = Sidebar._stageProposal(topic, {
        overview: topic.statusSummary.overview,
        goals: [],
    }, 'new_messages');
    if (topic.pendingProposal) {
        const kinds = topic.pendingProposal.changes.map(c => c.kind);
        assert.ok(!kinds.includes('goal_remove'), 'wipe protection');
    } else {
        assert.strictEqual(staged, false);
    }
    assert.strictEqual(topic.statusSummary.goals.length, 1);
});

await test('_stageProposal caps oversized proposals and logs truncation', () => {
    const { Storage, Sidebar, loggedEvents } = makeEnv();
    const topic = seedTopic(Storage, { overview: [], goals: [] });
    const staged = Sidebar._stageProposal(topic, {
        overview: Array.from({ length: 9 }, (_, i) => ({ text: `New fact ${i}` })),
        goals: [],
    }, 'interval');
    assert.strictEqual(staged, true);
    assert.strictEqual(topic.pendingProposal.changes.length, 6);
    const event = lastOf(loggedEvents, 'proposal_truncated');
    assert.ok(event);
    assert.strictEqual(event.data.originalCount, 9);
    assert.strictEqual(event.data.keptCount, 6);
    assert.strictEqual(event.data.trigger, 'interval');
});

await test('suggested overview adds render in proposed order under their header', () => {
    const { Sidebar } = makeEnv();
    const current = [
        { type: 'header', text: 'Background' },
        { type: 'bullet', text: '23-year-old player' },
        { type: 'header', text: 'Training Preferences' },
        { type: 'bullet', text: 'Recovers from a fibula fracture' },
    ];
    const proposal = {
        changes: [
            { kind: 'overview_add', field: 'overview', itemType: 'header', text: 'Injury & Recovery' },
            { kind: 'overview_add', field: 'overview', itemType: 'bullet', text: 'Currently focusing on seated drills' },
        ],
        statusUpdate: {
            overview: [
                { type: 'header', text: 'Background' },
                { type: 'bullet', text: '23-year-old player' },
                { type: 'header', text: 'Training Preferences' },
                { type: 'header', text: 'Injury & Recovery' },
                { type: 'bullet', text: 'Recovers from a fibula fracture' },
                { type: 'bullet', text: 'Currently focusing on seated drills' },
            ],
        },
    };
    const html = Sidebar._renderSuggestionOverview(current, proposal, false);
    const injury = html.indexOf('Injury &amp; Recovery');
    const seated = html.indexOf('Currently focusing on seated drills');
    const recovers = html.indexOf('Recovers from a fibula fracture');
    const training = html.indexOf('Training Preferences');
    assert.ok(injury >= 0 && seated >= 0 && recovers >= 0);
    assert.ok(injury > training, 'new header follows the previous section');
    assert.ok(recovers > injury, 'existing bullet moves under the new header in preview');
    assert.ok(seated > injury, 'new bullet follows the new header, not the bottom dump');
});

await test('overview add inserts at proposed index rather than always appending', () => {
    const { Storage, Sidebar } = makeEnv();
    const topic = seedTopic(Storage, {
        overview: [
            { type: 'header', text: 'Background' },
            { type: 'bullet', text: '23-year-old player' },
            { type: 'header', text: 'Training Preferences' },
            { type: 'bullet', text: 'Recovers from a fibula fracture' },
        ],
        goals: [],
    });
    Sidebar.currentTopicId = topic.id;
    Sidebar._stageProposal(topic, {
        overview: [
            { type: 'header', text: 'Background' },
            { type: 'bullet', text: '23-year-old player' },
            { type: 'header', text: 'Training Preferences' },
            { type: 'header', text: 'Injury & Recovery' },
            { type: 'bullet', text: 'Recovers from a fibula fracture' },
        ],
        goals: [],
    }, 'interval');
    const headerAdd = topic.pendingProposal.changes.find(
        c => c.kind === 'overview_add' && c.text === 'Injury & Recovery'
    );
    assert.ok(headerAdd);
    Sidebar._applyChangeToSummary(topic.statusSummary, headerAdd, 'inferred');
    const texts = topic.statusSummary.overview.map(it => it.text);
    const headerAt = texts.indexOf('Injury & Recovery');
    assert.ok(headerAt >= 0);
    assert.ok(headerAt < texts.length - 1, 'header is not dumped at the end');
    assert.strictEqual(texts[headerAt + 1], 'Recovers from a fibula fracture');
});

await test('per-line accept updates summary, shrinks changes; last accept clears proposal', () => {
    const { Storage, Sidebar, loggedEvents } = makeEnv();
    const topic = seedTopic(Storage, { goals: [] });
    Sidebar.currentTopicId = topic.id;
    Sidebar._stageProposal(topic, {
        overview: [{ text: 'Knows Python' }],
        goals: [{ text: 'Explore generative AI system design' }, { text: 'Master offline evaluation' }],
    }, 'new_messages');
    const n = topic.pendingProposal.changes.length;
    assert.ok(n >= 2);
    const first = topic.pendingProposal.changes[0];
    Sidebar._acceptProposalChange(0);
    const t2 = Storage.getTopic(topic.id);
    assert.strictEqual(t2.pendingProposal.changes.length, n - 1);
    const acc = lastOf(loggedEvents, 'proposal_change_accepted');
    assert.ok(acc);
    assert.ok(acc.data.field);
    assert.ok(['add', 'edit', 'remove'].includes(acc.data.kind));

    while (Storage.getTopic(topic.id).pendingProposal) {
        Sidebar._acceptProposalChange(0);
    }
    assert.strictEqual(Storage.getTopic(topic.id).pendingProposal, null);
});

await test('_saveSuggestedGoal pushes once; second save is a no-op', () => {
    const { Storage, Sidebar, loggedEvents } = makeEnv();
    const topic = seedTopic(Storage, { goals: [] });
    Sidebar.currentTopicId = topic.id;
    const dir = {
        title: 'Explore generative AI system design',
        anchor: 'coverage',
        type: 'depth',
        exampleQuestion: 'How should I evaluate a generative AI system?',
    };
    Sidebar._saveSuggestedGoal(dir);
    const g = Storage.getTopic(topic.id).statusSummary.goals;
    assert.strictEqual(g.length, 1);
    assert.strictEqual(g[0].text, dir.title);
    assert.strictEqual(g[0].source, 'user');
    assert.strictEqual(g[0].suggestionTitle, dir.title);
    assert.ok(g[0].id);
    assert.strictEqual(g[0].savedQuestions.length, 1);
    assert.strictEqual(g[0].savedQuestions[0].text, dir.exampleQuestion);
    Sidebar._saveSuggestedGoal(dir);
    assert.strictEqual(Storage.getTopic(topic.id).statusSummary.goals.length, 1);
    assert.strictEqual(Storage.getTopic(topic.id).statusSummary.goals[0].savedQuestions.length, 1);

    const saved = lastOf(loggedEvents, 'goal_saved');
    assert.ok(saved);
    assert.deepStrictEqual(plain(saved.data), {
        stage: 'evolve',
        initiative: 'user',
        surface: 'sidebar',
        topicId: topic.id,
        suggestionTitle: dir.title,
        anchor: 'coverage',
    });
    const questionSaved = lastOf(loggedEvents, 'question_saved');
    assert.ok(questionSaved);
    assert.strictEqual(questionSaved.data.goalId, g[0].id);
});

await test('Evolve Save waits for and retains its generated question', async () => {
    const { Storage, Sidebar } = makeEnv();
    const topic = seedTopic(Storage, { goals: [] });
    Sidebar.currentTopicId = topic.id;
    Sidebar._ensureCardQuestion = async () => 'What evidence would validate this direction?';
    let savedDirection = null;
    Sidebar._saveSuggestedGoal = dir => { savedDirection = { ...dir }; };
    const card = Sidebar._createSuggestedGoalCard({
        title: 'Validate the direction',
        type: 'depth',
        exampleQuestion: '',
    }, 0);

    card.querySelector('.direction-save-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(savedDirection);
    assert.strictEqual(savedDirection.exampleQuestion, 'What evidence would validate this direction?');
});

await test('_removeGoal removes from statusSummary.goals not legacy topic.goals', () => {
    const { Storage, Sidebar } = makeEnv();
    const topic = seedTopic(Storage, {
        goals: [{ id: 'goal_x', text: 'Explore generative AI system design', source: 'user' }],
    });
    topic.goals = [{ id: 'goal_x', title: 'Explore generative AI system design' }];
    Storage.saveTopic(topic);
    Sidebar.currentTopicId = topic.id;
    Sidebar._removeGoal('goal_x');
    const t2 = Storage.getTopic(topic.id);
    assert.strictEqual(t2.statusSummary.goals.length, 0);
    assert.strictEqual(t2.goals.length, 1, 'legacy array untouched');
});

await test('_serializeStatus includes Goals: block', () => {
    const { Sidebar } = makeEnv();
    const out = Sidebar._serializeStatus({
        overview: [{ text: 'Knows Python' }],
        goals: [{ text: 'Explore generative AI system design' }],
    });
    assert.ok(out.includes('Goals:'));
    assert.ok(out.includes('Explore generative AI system design'));
});

await test('per-line drop logs proposal_change_dismissed with field and kind', () => {
    const { Storage, Sidebar, loggedEvents } = makeEnv();
    const topic = seedTopic(Storage, { goals: [] });
    Sidebar.currentTopicId = topic.id;
    Sidebar._stageProposal(topic, {
        overview: [{ text: 'Knows Python' }],
        goals: [{ text: 'Master offline evaluation' }],
    }, 'manual');
    const ch = topic.pendingProposal.changes[0];
    Sidebar._dropProposalChange(0);
    const ev = lastOf(loggedEvents, 'proposal_change_dismissed');
    assert.ok(ev);
    assert.ok(ev.data.field === 'overview' || ev.data.field === 'goals');
    assert.ok(['add', 'edit', 'remove'].includes(ev.data.kind));
    void ch;
});

await test('exclusion revert logs context_exclusion_reverted', () => {
    const { Storage, App, loggedEvents } = makeEnv();
    const topic = Storage.createTopic('ML');
    const chat = Storage.createChat();
    chat.topicId = topic.id;
    Storage.saveChat(chat);
    App.currentChatId = chat.id;
    const assistantEl = makeEl('div');
    const past = [
        { chatId: 'chat_past_a', title: 'Past A', userAsked: 'backprop' },
        { chatId: 'chat_past_b', title: 'Past B', userAsked: 'dropout' },
    ];
    App._renderInjectedPastPanel(assistantEl, past);
    const cards = [];
    collectCards(assistantEl, cards);
    assert.ok(cards.length >= 1, 'exclude buttons present');
    const btn = cards[0].querySelector('.past-context-exclude-btn');
    btn.click();
    assert.ok(lastOf(loggedEvents, 'context_excluded_for_topic'));
    btn.click();
    const reverted = lastOf(loggedEvents, 'context_exclusion_reverted');
    assert.ok(reverted);
    assert.strictEqual(reverted.data.initiative, 'user');
    assert.strictEqual(reverted.data.surface, 'chat');
    assert.strictEqual(reverted.data.topicId, topic.id);
});

await test('version_restored payload includes versionId', () => {
    const { Storage, Sidebar, loggedEvents } = makeEnv();
    const topic = seedTopic(Storage);
    Sidebar.currentTopicId = topic.id;
    Storage.pushStatusSnapshot(topic, 'manual');
    const v1 = topic.statusHistory[0].v;
    topic.statusSummary.overview.push({ text: 'Later', source: 'user' });
    Storage.pushStatusSnapshot(topic, 'manual');
    Storage.saveTopic(topic);
    Sidebar._restoreStatusVersion(0);
    const ev = lastOf(loggedEvents, 'version_restored');
    assert.ok(ev);
    assert.strictEqual(ev.data.versionId, v1);
});

console.log('\n─── 10b: mock session ───');

await test('mock session emits canonical event sequence', () => {
    const { Storage, Sidebar, App, loggedEvents } = makeEnv();
    const topic = seedTopic(Storage, {
        overview: [{ text: 'CS student', source: 'user' }],
        goals: [{ id: 'goal_keep', text: 'Explore generative AI system design', source: 'user' }],
    });
    const pastA = Storage.createChat();
    pastA.topicId = topic.id;
    pastA.summary = 'Covered backprop';
    pastA.userAsked = 'What is backprop?';
    Storage.saveChat(pastA);
    const pastB = Storage.createChat();
    pastB.topicId = topic.id;
    pastB.summary = 'Covered dropout';
    pastB.userAsked = 'What is dropout?';
    Storage.saveChat(pastB);
    const current = Storage.createChat();
    current.topicId = topic.id;
    Storage.saveChat(current);
    App.currentChatId = current.id;
    App.selectedTopicId = topic.id;
    Sidebar.currentTopicId = topic.id;

    loggedEvents.push({
        type: 'query_sent',
        data: { chatId: current.id, topicId: topic.id, hasContext: false },
    });
    loggedEvents.push({
        type: 'construct_included_in_chat',
        data: { topicId: topic.id, nOverview: 1, nGoals: 1, surface: 'chat' },
    });

    const assistantEl = makeEl('div');
    const injected = [
        { chatId: pastA.id, title: pastA.title || 'Past A', userAsked: pastA.userAsked },
        { chatId: pastB.id, title: pastB.title || 'Past B', userAsked: pastB.userAsked },
    ];
    App._renderInjectedPastPanel(assistantEl, injected);

    const cards = [];
    collectCards(assistantEl, cards);
    assert.ok(cards.length >= 1, 'injected cards');
    const excludeBtn = cards[0].querySelector('.past-context-exclude-btn');
    excludeBtn.click();
    excludeBtn.click();

    Sidebar._stageProposal(topic, {
        overview: [{ text: 'CS student' }, { text: 'Knows Python' }],
        goals: [
            { text: 'Explore generative AI system design' },
            { text: 'Master offline and online evaluation' },
        ],
    }, 'new_messages');
    const goalIdx = topic.pendingProposal.changes.findIndex(c => c.field === 'goals');
    assert.ok(goalIdx >= 0, 'goal change staged');
    Sidebar._acceptProposalChange(goalIdx);
    Sidebar._acceptProposal();

    const dir = {
        title: 'Compare RAG and fine-tuning',
        anchor: 'coverage',
        exampleQuestion: 'When is RAG a better fit than fine-tuning?',
        type: 'breadth',
    };
    Sidebar._saveSuggestedGoal(dir);
    const savedGoal = Sidebar._findGoal(Storage.getTopic(topic.id), dir.title);
    loggedEvents.push({
        type: 'goal_question_asked',
        data: {
            stage: 'evolve', initiative: 'user', surface: 'sidebar',
            topicId: topic.id, directionIdx: 0,
            goalId: savedGoal.id,
            goalSource: savedGoal.source || 'user',
            suggestionId: dir.title,
            askMode: 'new_chat',
            autoSend: false,
        },
    });
    Sidebar._startGoalInNewChat({ title: dir.title, question: dir.exampleQuestion });

    const types = loggedEvents.map(e => e.type);
    const expected = [
        'query_sent', 'construct_included_in_chat', 'context_card_shown',
        'context_excluded_for_topic', 'context_exclusion_reverted',
        'proposal_shown', 'proposal_change_accepted', 'proposal_accepted',
        'goal_saved', 'question_saved', 'goal_question_asked',
    ];
    let from = 0;
    expected.forEach(name => {
        const idx = types.indexOf(name, from);
        assert.ok(idx !== -1, `missing ${name} in ${types.join(' > ')}`);
        from = idx + 1;
    });

    const shown = loggedEvents.find(e => e.type === 'context_card_shown');
    assert.ok(!shown.data.replay, 'fresh stream has no replay flag');
    assert.strictEqual(shown.data.count, 2);
    const included = loggedEvents.find(e => e.type === 'construct_included_in_chat');
    assert.strictEqual(included.data.nGoals, 1);
    const shownProposal = lastOf(loggedEvents, 'proposal_shown');
    assert.ok(shownProposal.data.field === 'overview' || shownProposal.data.field === 'goals'
        || Array.isArray(shownProposal.data.fields));
    const asked = lastOf(loggedEvents, 'goal_question_asked');
    assert.ok(asked.data.goalSource);
    assert.strictEqual(asked.data.suggestionId, dir.title);
    const saved = lastOf(loggedEvents, 'goal_saved');
    assert.strictEqual(saved.data.initiative, 'user');
    assert.strictEqual(saved.data.surface, 'sidebar');
});

await test('history re-render flags context_card_shown replay: true without duplicating fresh path', () => {
    const { Storage, App, loggedEvents } = makeEnv();
    const topic = Storage.createTopic('ML');
    const chat = Storage.createChat();
    chat.topicId = topic.id;
    Storage.saveChat(chat);
    App.currentChatId = chat.id;
    const injected = [
        { chatId: 'chat_past_a', title: 'Past A', userAsked: 'q1' },
        { chatId: 'chat_past_b', title: 'Past B', userAsked: 'q2' },
    ];
    const liveEl = makeEl('div');
    App._renderInjectedPastPanel(liveEl, injected);
    const freshCount = loggedEvents.filter(e => e.type === 'context_card_shown').length;
    assert.strictEqual(freshCount, 1);
    assert.ok(!lastOf(loggedEvents, 'context_card_shown').data.replay);

    const histEl = makeEl('div');
    App._renderInjectedPastPanel(histEl, injected, { replay: true });
    const all = loggedEvents.filter(e => e.type === 'context_card_shown');
    assert.strictEqual(all.length, 2, 'one fresh + one replay, no extras');
    assert.strictEqual(all[1].data.replay, true);
    assert.ok(!all[0].data.replay);
});

await test('sidebar folds Evolve down to one card before Construct', () => {
    const { Sidebar, document } = makeEnv();
    const content = document.getElementById('sidebarContent');
    const construct = document.getElementById('sectionCurrent');
    const evolve = document.getElementById('sectionFuture');
    content.clientHeight = 500;
    construct.style.display = 'block';
    evolve.style.display = 'block';
    construct.offsetHeight = 280;
    construct.offsetTop = 0;
    evolve.offsetHeight = 300;
    evolve.offsetTop = 296;
    Sidebar._evolveOneCardMinHeight = () => 120;

    Sidebar._layoutSidebarStack();
    assert.strictEqual(evolve.style.maxHeight, '204px');
    assert.strictEqual(construct.style.maxHeight || '', '');
});

await test('sidebar folds Construct only after Evolve is one complete card', () => {
    const { Sidebar, document } = makeEnv();
    const content = document.getElementById('sidebarContent');
    const construct = document.getElementById('sectionCurrent');
    const evolve = document.getElementById('sectionFuture');
    content.clientHeight = 400;
    construct.style.display = 'block';
    evolve.style.display = 'block';
    construct.offsetHeight = 280;
    construct.offsetTop = 0;
    evolve.offsetHeight = 300;
    evolve.offsetTop = 296;
    Sidebar._evolveOneCardMinHeight = () => 120;

    Sidebar._layoutSidebarStack();
    assert.strictEqual(evolve.style.maxHeight, '120px');
    assert.strictEqual(construct.style.maxHeight, '264px');
});

await test('Construct fold scrolls Overview before Goals and keeps the Goals title', () => {
    const { Sidebar, document } = makeEnv();
    const construct = document.getElementById('sectionCurrent');
    const goals = document.getElementById('constructGoalsSection');
    const goalsList = document.getElementById('constructGoalsList');

    const overviewItems = makeEl('div');
    overviewItems.offsetHeight = 180;
    overviewItems.scrollHeight = 180;
    const overviewLabel = makeEl('div');
    overviewLabel.offsetHeight = 20;
    const overviewSlot = makeEl('div');
    overviewSlot.offsetHeight = 0;
    const overview = makeEl('div');
    overview.querySelector = (sel) => {
        if (String(sel).includes('status-section-items')) return overviewItems;
        if (String(sel).includes('status-section-label')) return overviewLabel;
        if (String(sel).includes('overview-ai-prompt-slot')) return overviewSlot;
        return null;
    };
    construct.querySelector = (sel) => {
        if (String(sel).includes('status-section-overview')) return overview;
        return null;
    };
    const goalsLabel = makeEl('div');
    goalsLabel.offsetHeight = 22;
    const goalsHint = makeEl('div');
    goalsHint.offsetHeight = 16;
    const addRow = makeEl('div');
    addRow.offsetHeight = 28;
    goals.querySelector = (sel) => {
        const s = String(sel);
        if (s.includes('status-section-label')) return goalsLabel;
        if (s.includes('status-section-hint')) return goalsHint;
        if (s.includes('add-')) return addRow;
        return null;
    };
    goalsList.offsetHeight = 80;
    goalsList.scrollHeight = 80;

    Sidebar._foldConstructTo(construct, 260);
    assert.strictEqual(overviewItems.style.maxHeight, '94px');
    assert.strictEqual(overviewItems.style.overflowY, 'auto');
    assert.ok(!goalsList.style.maxHeight, 'Goals list should stay unfolded while Overview can still shrink');
});

await test('Evolve fold puts a scroll height on the cards list', () => {
    const { Sidebar, document } = makeEnv();
    const evolve = document.getElementById('sectionFuture');
    const cards = document.getElementById('directionCards');
    const header = makeEl('div');
    header.offsetHeight = 28;
    const subtitle = makeEl('div');
    subtitle.offsetHeight = 16;
    evolve.querySelector = (sel) => {
        if (String(sel).includes('temporal-section-header')) return header;
        if (String(sel).includes('temporal-section-subtitle')) return subtitle;
        return null;
    };
    Sidebar._capEvolveTo(evolve, 160);
    assert.strictEqual(evolve.style.maxHeight, '160px');
    assert.strictEqual(cards.style.maxHeight, '116px');
    assert.strictEqual(cards.style.overflowY, 'auto');
});

console.log(`\n═══════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════`);
if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => {
        console.log(`  ✗ ${f.name}`);
        console.log(`    ${f.stack || f.error.stack || f.error.message}`);
    });
    process.exit(1);
}
process.exit(0);
}

function collectCards(root, cards) {
    const visit = (n) => {
        if (!n) return;
        if (n.querySelector && n.querySelector('.past-context-exclude-btn')) {
            if (!cards.includes(n)) cards.push(n);
        }
        (n._children || []).forEach(visit);
    };
    visit(root);
}

run();
