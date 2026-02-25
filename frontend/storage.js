/* localStorage persistence layer for Loom */

const Storage = {
  _KEY: 'loom_data',

  _getAll() {
    try {
      const raw = localStorage.getItem(this._KEY);
      return raw ? JSON.parse(raw) : this._defaultData();
    } catch {
      return this._defaultData();
    }
  },

  _saveAll(data) {
    localStorage.setItem(this._KEY, JSON.stringify(data));
  },

  _defaultData() {
    return {
      topics: [],
      chats: [],
      messages: {},
      concepts: [],
      currentChatId: null,
    };
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
    const topics = data.topics;
    if (topics.length === 0) return;
    const needsMigration = topics.some(t => t.colorHue === undefined || t.colorHue === null);
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
    this._saveAll(data);
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

  // ── Model Preferences ───────────────────────────────────────────────────

  getChatModel() {
    return localStorage.getItem('loom_chatModel') || 'gemini-2.5-flash';
  },

  setChatModel(model) {
    localStorage.setItem('loom_chatModel', model);
  },

  getSidebarModel() {
    return localStorage.getItem('loom_sidebarModel') || 'gemini-2.5-flash';
  },

  setSidebarModel(model) {
    localStorage.setItem('loom_sidebarModel', model);
  },

  clear() {
    localStorage.removeItem(this._KEY);
  },
};
