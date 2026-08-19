/**
 * Storage migration tests for the one-time bucket and Important label.
 * Run with: node frontend/tests/oneTimeBucket.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const values = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: false }),
  localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  },
  Utils: {
    generateId: () => 'id',
    timestamp: () => '2026-08-18T00:00:00Z',
    TOPIC_COLORS: [{ hue: 210 }],
    findDistantHue: () => 210,
  },
};
vm.createContext(context);
const Storage = vm.runInContext(`${source}\nStorage`, context);

const seeded = {
  topics: [{ id: 'bucket', name: 'Unassigned' }],
  chats: [{ id: 'chat', topicId: 'bucket' }],
  messages: {
    chat: [{
      id: 'msg',
      role: 'assistant',
      annotations: [{ id: 'a', label: 'interested', spanText: 'important fact' }],
    }],
  },
  currentChatId: 'chat',
  concepts: [],
  settings: {},
  personalDetails: [],
};
values.set('loom_data_user', JSON.stringify(seeded));
Storage.setUser('user', 'loom');

const firstTopic = Storage.getTopics()[0];
assert.strictEqual(firstTopic.name, 'One-time questions');
assert.strictEqual(firstTopic.oneTimeBucket, true);
assert.strictEqual(Storage.getMessages('chat')[0].annotations[0].label, 'important');

const afterFirstLoad = values.get('loom_data_user');
Storage.getTopics();
Storage.getMessages('chat');
const afterSecondLoad = values.get('loom_data_user');
assert.strictEqual(afterSecondLoad, afterFirstLoad, 'second load is idempotent');

assert.ok(indexSource.includes('id="oneTimeChatBtn"'));
assert.ok(appSource.includes('newOneTimeChat()'));
assert.ok(appSource.includes("source: 'button'"));
assert.ok(appSource.includes("source: 'classified'"));
const dismissStart = appSource.indexOf('_dismissSuggestion()');
const dismissEnd = appSource.indexOf('// ── Debounced Handler', dismissStart);
assert.ok(!appSource.slice(dismissStart, dismissEnd).includes('_getOrCreateOneTimeTopic'));

console.log('\n9 passed, 0 failed');
