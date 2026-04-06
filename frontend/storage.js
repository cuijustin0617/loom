/* localStorage persistence layer for ChatWeave — per-user keying */

const Storage = {
  _userId: null,
  _condition: null,
  _MAX_MESSAGES_PER_CHAT_ON_QUOTA: 120,
  _MAX_CHATS_ON_QUOTA: 40,

  // ── User Session ─────────────────────────────────────────────────────

  get _KEY() {
    return this._userId ? `loom_data_${this._userId}` : 'loom_data';
  },

  setUser(userId, condition) {
    this._userId = userId;
    this._condition = 'loom';
    localStorage.setItem('loom_currentUser', userId);
    localStorage.setItem('loom_currentCondition', this._condition);
  },

  getUserId() { return this._userId; },
  getCondition() { return this._condition || 'loom'; },

  restoreSession() {
    const saved = localStorage.getItem('loom_currentUser');
    if (saved) {
      const cond = localStorage.getItem('loom_currentCondition');
      this.setUser(saved, cond);
      return true;
    }
    return false;
  },

  logout() {
    this._userId = null;
    this._condition = null;
    localStorage.removeItem('loom_currentUser');
    localStorage.removeItem('loom_currentCondition');
  },

  // ── Core Data ────────────────────────────────────────────────────────

  _getAll() {
    try {
      const raw = localStorage.getItem(this._KEY);
      if (!raw) return this._defaultData();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return this._defaultData();
      }
      const defaults = this._defaultData();
      for (const key of Object.keys(defaults)) {
        if (!(key in parsed)) parsed[key] = defaults[key];
      }
      if (this._stripAttachmentBase64(parsed)) {
        try { localStorage.setItem(this._KEY, JSON.stringify(parsed)); } catch { /* quota */ }
      }
      return parsed;
    } catch {
      return this._defaultData();
    }
  },

  _migrated: false,

  _stripAttachmentBase64(data) {
    if (this._migrated) return false;
    this._migrated = true;
    let changed = false;
    const msgs = data.messages || {};
    for (const chatId of Object.keys(msgs)) {
      for (const msg of msgs[chatId]) {
        if (msg.attachments && Array.isArray(msg.attachments)) {
          for (const att of msg.attachments) {
            if (att.data) {
              delete att.data;
              changed = true;
            }
          }
        }
      }
    }
    return changed;
  },

  _saveAll(data) {
    try {
      const compacted = this._writeWithQuotaRecovery(data);
      if (!compacted) return false;
    } catch (e) {
      console.error('Storage quota exceeded:', e);
      return false;
    }
    this._scheduleSync();
    return true;
  },

  _writeWithQuotaRecovery(data) {
    const variants = [
      this._prepareDataForWrite(data, 0),
      this._prepareDataForWrite(data, 1),
      this._prepareDataForWrite(data, 2),
      this._prepareDataForWrite(data, 3),
    ];

    for (let i = 0; i < variants.length; i++) {
      try {
        localStorage.setItem(this._KEY, JSON.stringify(variants[i]));
        return variants[i];
      } catch (e) {
        if (i === variants.length - 1) {
          console.error('Storage quota exceeded:', e);
          return null;
        }
      }
    }
    return null;
  },

  _prepareDataForWrite(data, level) {
    const clone = JSON.parse(JSON.stringify(data || this._defaultData()));
    this._stripAttachmentBase64(clone);
    if (level <= 0) return clone;

    // Tier 1: drop bulky chat embeddings; they can be regenerated.
    if (Array.isArray(clone.chats)) {
      for (const chat of clone.chats) {
        if (chat && Array.isArray(chat.embedding) && chat.embedding.length) {
          chat.embedding = null;
        }
      }
    }
    if (level <= 1) return clone;

    // Tier 2: keep only recent messages per chat.
    if (clone.messages && typeof clone.messages === 'object') {
      for (const chatId of Object.keys(clone.messages)) {
        const msgs = clone.messages[chatId];
        if (Array.isArray(msgs) && msgs.length > this._MAX_MESSAGES_PER_CHAT_ON_QUOTA) {
          clone.messages[chatId] = msgs.slice(-this._MAX_MESSAGES_PER_CHAT_ON_QUOTA);
        }
      }
    }
    if (level <= 2) return clone;

    // Tier 3: keep most recent chats and matching messages.
    const chats = Array.isArray(clone.chats) ? clone.chats : [];
    if (!chats.length) return clone;
    chats.sort((a, b) => String(b?.lastActive || b?.createdAt || '').localeCompare(String(a?.lastActive || a?.createdAt || '')));
    const keepIds = new Set(chats.slice(0, this._MAX_CHATS_ON_QUOTA).map(c => c.id).filter(Boolean));
    if (clone.currentChatId) keepIds.add(clone.currentChatId);
    clone.chats = chats.filter(c => keepIds.has(c.id));
    const nextMessages = {};
    for (const id of keepIds) {
      if (clone.messages && clone.messages[id]) nextMessages[id] = clone.messages[id];
    }
    clone.messages = nextMessages;
    return clone;
  },

  _defaultData() {
    return {
      topics: [],
      chats: [],
      messages: {},
      concepts: [],
      currentChatId: null,
      personalDetails: [],
    };
  },

  // ── Server Sync (debounced) ──────────────────────────────────────────

  _syncTimer: null,
  _scheduleSync() {
    if (!this._userId) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => this._pushSync(), 3000);
  },

  async _pushSync() {
    if (!this._userId) return;
    try {
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: this._userId,
          data: this._getAll(),
        }),
      });
    } catch (e) {
      console.warn('Sync push failed:', e);
    }
  },

  async pullSync() {
    if (!this._userId) return false;
    try {
      const resp = await fetch(`/api/sync?userId=${encodeURIComponent(this._userId)}`);
      if (!resp.ok) return false;
      const result = await resp.json();
      if (result.data) {
        return !!this._writeWithQuotaRecovery(result.data);
      }
    } catch (e) {
      console.warn('Sync pull failed:', e);
    }
    return false;
  },

  // ── Topics ──────────────────────────────────────────────────────────────

  getTopics() {
    return this._getAll().topics;
  },

  getTopic(id) {
    return this.getTopics().find(t => t.id === id) || null;
  },

  saveTopic(topic) {
    const data = this._getAll();
    const idx = data.topics.findIndex(t => t.id === topic.id);
    if (idx >= 0) data.topics[idx] = topic;
    else data.topics.push(topic);
    this._saveAll(data);
    return topic;
  },

  deleteTopic(id) {
    const data = this._getAll();
    data.topics = data.topics.filter(t => t.id !== id);
    this._saveAll(data);
  },

  createTopic(name, statusSummary = '') {
    const topics = this.getTopics();
    const existingHues = topics.map(t => {
      if (t.colorHue !== undefined && t.colorHue !== null) return t.colorHue;
      const legacy = Utils.TOPIC_COLORS[(t.colorIndex || 0) % Utils.TOPIC_COLORS.length];
      return legacy.hue;
    });
    const colorHue = Utils.findDistantHue(existingHues);
    const topic = {
      id: 'topic_' + Utils.generateId(),
      name,
      colorHue,
      statusSummary,
      statusLastUpdated: Utils.timestamp(),
      userCreated: true,
      lastActive: Utils.timestamp(),
    };
    return this.saveTopic(topic);
  },

  migrateTopicColors() {
    const data = this._getAll();
    if (!data || !Array.isArray(data.topics)) return;
    const topics = data.topics;
    if (!topics || topics.length === 0) return;
    const lo = Utils._BLUE_FAMILY_MIN;
    const hi = Utils._BLUE_FAMILY_MAX;
    const needsMigration = topics.some(t =>
      t.colorHue === undefined || t.colorHue === null ||
      t.colorHue < lo || t.colorHue > hi
    );
    if (!needsMigration) return;
    const assignedHues = [];
    for (const topic of topics) {
      const hue = Utils.findDistantHue(assignedHues);
      topic.colorHue = hue;
      delete topic.colorIndex;
      assignedHues.push(hue);
    }
    this._saveAll(data);
  },

  // ── Chats ───────────────────────────────────────────────────────────────

  getChats() {
    return this._getAll().chats;
  },

  getChat(id) {
    return this.getChats().find(c => c.id === id) || null;
  },

  getChatsByTopic(topicId) {
    return this.getChats().filter(c => c.topicId === topicId);
  },

  saveChat(chat) {
    const data = this._getAll();
    const idx = data.chats.findIndex(c => c.id === chat.id);
    if (idx >= 0) data.chats[idx] = chat;
    else data.chats.push(chat);
    this._saveAll(data);
    return chat;
  },

  createChat() {
    const chat = {
      id: 'chat_' + Utils.generateId(),
      topicId: null,
      title: 'New Chat',
      summary: '',
      embedding: null,
      conceptIds: [],
      createdAt: Utils.timestamp(),
      lastActive: Utils.timestamp(),
      summarized: false,
    };
    const data = this._getAll();
    data.chats.push(chat);
    data.currentChatId = chat.id;
    this._saveAll(data);
    return chat;
  },

  deleteChat(id) {
    const data = this._getAll();
    data.chats = data.chats.filter(c => c.id !== id);
    delete data.messages[id];
    if (data.currentChatId === id) data.currentChatId = null;
    this._saveAll(data);
  },

  // ── Messages ────────────────────────────────────────────────────────────

  getMessages(chatId) {
    const data = this._getAll();
    return data.messages[chatId] || [];
  },

  addMessage(chatId, message) {
    const data = this._getAll();
    if (!data.messages[chatId]) data.messages[chatId] = [];
    data.messages[chatId].push(message);
    const ok = this._saveAll(data);
    if (!ok) return null;
    return message;
  },

  // ── Current Chat ────────────────────────────────────────────────────────

  getCurrentChatId() {
    return this._getAll().currentChatId;
  },

  setCurrentChatId(chatId) {
    const data = this._getAll();
    data.currentChatId = chatId;
    this._saveAll(data);
  },

  // ── Concepts ────────────────────────────────────────────────────────────

  getConcepts() {
    const data = this._getAll();
    return data.concepts || [];
  },

  getConceptsByTopic(topicId) {
    return this.getConcepts().filter(c => c.topicId === topicId);
  },

  saveConcept(concept) {
    const data = this._getAll();
    if (!data.concepts) data.concepts = [];
    const idx = data.concepts.findIndex(c => c.id === concept.id);
    if (idx >= 0) data.concepts[idx] = concept;
    else data.concepts.push(concept);
    this._saveAll(data);
    return concept;
  },

  deleteConcept(id) {
    const data = this._getAll();
    if (data.concepts) {
      data.concepts = data.concepts.filter(c => c.id !== id);
      this._saveAll(data);
    }
  },

  // ── Personal Details (baseline condition) ──────────────────────────────

  getPersonalDetails() {
    return this._getAll().personalDetails || [];
  },

  setPersonalDetails(details) {
    const data = this._getAll();
    data.personalDetails = details;
    this._saveAll(data);
  },

  // ── Bulk helpers ────────────────────────────────────────────────────────

  getAllChatSummariesForTopic(topicId) {
    return this.getChatsByTopic(topicId)
      .filter(c => c.title && c.title !== 'New Chat')
      .map(c => ({
        id: c.id,
        title: c.title,
        summary: c.summary || c.title,
        embedding: c.embedding,
        type: 'chat',
      }));
  },

  // ── Embedding Migration ─────────────────────────────────────────────────

  async reEmbedChats() {
    const snapshot = this._getAll();
    if (!snapshot || !Array.isArray(snapshot.chats)) return;

    const EXPECTED_DIM = 3072;
    const needsReEmbed = snapshot.chats.filter(c =>
      c.summary && c.summary.trim() &&
      (!c.embedding || c.embedding.length !== EXPECTED_DIM)
    );
    if (!needsReEmbed.length) return;

    console.log(`[reEmbed] Re-embedding ${needsReEmbed.length} chats...`);
    for (const chat of needsReEmbed) {
      try {
        const resp = await fetch('/api/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chat.summary }),
        });
        if (!resp.ok) continue;
        const result = await resp.json();
        // Re-read fresh data before each write to avoid stale overwrites
        const fresh = this._getAll();
        const idx = fresh.chats.findIndex(c => c.id === chat.id);
        if (idx >= 0) {
          fresh.chats[idx].embedding = result.embedding;
          this._saveAll(fresh);
        }
        console.log(`[reEmbed] ✅ ${chat.id} (${chat.title})`);
      } catch (e) {
        console.warn(`[reEmbed] ❌ ${chat.id}:`, e);
      }
    }
    console.log('[reEmbed] Migration complete');
  },

  // ── Model Preferences ───────────────────────────────────────────────────

  getChatModel() {
    return localStorage.getItem('loom_chatModel') || 'gemini-3-flash-preview';
  },

  setChatModel(model) {
    localStorage.setItem('loom_chatModel', model);
  },

  getSidebarModel() {
    return localStorage.getItem('loom_sidebarModel') || 'gemini-3-flash-preview';
  },

  setSidebarModel(model) {
    localStorage.setItem('loom_sidebarModel', model);
  },

  clear() {
    localStorage.removeItem(this._KEY);
  },
};
