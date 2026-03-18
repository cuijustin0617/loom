/* Loom main application controller */

const API_BASE = '';  // same origin

// Global condition flag set after login
let STUDY_CONDITION = 'loom';

// ═══════════════════════════════════════════════════════════════════════════════
// TopicSuggester — keyword-first hybrid similarity search for topic suggestions
// ═══════════════════════════════════════════════════════════════════════════════

const TopicSuggester = {
  // Tunable thresholds
  KEYWORD_CONFIDENT: 0.45,
  KEYWORD_AMBIGUOUS: 0.2,
  COMBINED_THRESHOLD: 0.35,
  EMBEDDING_ONLY_THRESHOLD: 0.45,
  KEYWORD_ONLY_THRESHOLD: 0.35,
  MIN_QUERY_LENGTH: 12,
  DEBOUNCE_MS: 300,
  KEYWORD_WEIGHT: 0.4,
  EMBEDDING_WEIGHT: 0.6,

  STOP_WORDS: new Set([
    'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
    'from','is','it','as','be','was','are','were','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might','can',
    'this','that','these','those','i','me','my','we','our','you','your','he',
    'she','they','them','their','its','not','no','so','if','then','than','too',
    'very','just','about','up','out','how','what','when','where','which','who',
    'why','all','each','some','any','few','more','most','am','into','also',
  ]),

  _keywordIndex: {},
  _idfWeights: {},
  _embeddingCache: {},
  _embeddingsReady: false,
  _abortController: null,
  _debounceTimer: null,
  _suggestionDismissed: false,
  _currentSuggestedTopicId: null,

  // ── Tokenization ───────────────────────────────────────────────────────

  _tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(t => t.length > 1 && !this.STOP_WORDS.has(t));
  },

  _bigrams(tokens) {
    const bg = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      bg.push(tokens[i] + ' ' + tokens[i + 1]);
    }
    return bg;
  },

  // ── Topic Document Builder ─────────────────────────────────────────────

  _buildTopicDocument(topic) {
    const parts = [topic.name];
    if (topic.statusSummary) {
      const s = topic.statusSummary;
      if (Array.isArray(s.overview)) parts.push(...s.overview);
      if (Array.isArray(s.threads)) {
        s.threads.forEach(t => { if (t.label) parts.push(t.label); });
      }
    }
    return parts.join(' ');
  },

  _simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
  },

  // ── Keyword Index ──────────────────────────────────────────────────────

  rebuildKeywordIndex() {
    const topics = Storage.getTopics().filter(t => t.name !== 'Unassigned');
    this._keywordIndex = {};
    const docFreq = {};

    topics.forEach(t => {
      const doc = this._buildTopicDocument(t);
      const tokens = this._tokenize(doc);
      const tokenSet = new Set(tokens);
      const bigrams = new Set(this._bigrams(tokens));
      this._keywordIndex[t.id] = { tokens: tokenSet, bigrams, doc, hash: this._simpleHash(doc) };
      tokenSet.forEach(tok => { docFreq[tok] = (docFreq[tok] || 0) + 1; });
    });

    const numDocs = topics.length || 1;
    this._idfWeights = {};
    Object.keys(docFreq).forEach(tok => {
      this._idfWeights[tok] = Math.log(numDocs / docFreq[tok]) + 1;
    });
  },

  // ── Keyword Scoring ────────────────────────────────────────────────────

  scoreKeyword(queryText) {
    const queryTokens = this._tokenize(queryText);
    if (queryTokens.length === 0) return [];
    const queryBigrams = this._bigrams(queryTokens);

    const results = [];
    for (const [topicId, idx] of Object.entries(this._keywordIndex)) {
      let score = 0;
      let totalWeight = 0;
      queryTokens.forEach(qt => {
        const w = this._idfWeights[qt] || 1;
        totalWeight += w;
        if (idx.tokens.has(qt)) score += w;
      });
      if (totalWeight > 0) score /= totalWeight;

      // Bigram bonus: up to 30% extra
      if (queryBigrams.length > 0) {
        let bigramHits = 0;
        queryBigrams.forEach(bg => { if (idx.bigrams.has(bg)) bigramHits++; });
        score += 0.3 * (bigramHits / queryBigrams.length);
      }

      score = Math.min(score, 1.0);
      results.push({ topicId, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  },

  // ── Cosine Similarity (client-side) ────────────────────────────────────

  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  },

  // ── Embedding Cache ────────────────────────────────────────────────────

  async refreshTopicEmbeddings() {
    const topics = Storage.getTopics().filter(t => t.name !== 'Unassigned');
    if (topics.length === 0) return;

    const toEmbed = [];
    const toEmbedIds = [];
    topics.forEach(t => {
      const idx = this._keywordIndex[t.id];
      if (!idx) return;
      const cached = this._embeddingCache[t.id];
      if (cached && cached.hash === idx.hash) return;
      toEmbed.push(idx.doc);
      toEmbedIds.push(t.id);
    });

    if (toEmbed.length === 0) {
      this._embeddingsReady = Object.keys(this._embeddingCache).length > 0;
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/api/embed/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: toEmbed }),
      });
      if (!resp.ok) throw new Error('Batch embed failed');
      const data = await resp.json();
      data.embeddings.forEach((emb, i) => {
        const topicId = toEmbedIds[i];
        this._embeddingCache[topicId] = {
          embedding: emb,
          hash: this._keywordIndex[topicId].hash,
        };
      });
      this._embeddingsReady = true;
    } catch (e) {
      console.warn('Topic embedding refresh failed:', e);
    }
  },

  scoreEmbedding(queryEmbedding) {
    const results = [];
    for (const [topicId, cached] of Object.entries(this._embeddingCache)) {
      const score = this._cosineSimilarity(queryEmbedding, cached.embedding);
      results.push({ topicId, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  },

  // ── Hybrid Ranking ─────────────────────────────────────────────────────

  async rankTopics(queryText) {
    const kwResults = this.scoreKeyword(queryText);
    if (kwResults.length === 0) return null;

    const topKw = kwResults[0];

    // High-confidence keyword match — return immediately
    if (topKw.score >= this.KEYWORD_CONFIDENT) {
      return { topicId: topKw.topicId, score: topKw.score, method: 'keyword' };
    }

    // Try embedding refinement
    if (this._embeddingsReady) {
      if (this._abortController) this._abortController.abort();
      this._abortController = new AbortController();

      try {
        const resp = await fetch(`${API_BASE}/api/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: queryText }),
          signal: this._abortController.signal,
        });
        if (!resp.ok) throw new Error('Embed failed');
        const data = await resp.json();
        const embResults = this.scoreEmbedding(data.embedding);

        if (topKw.score >= this.KEYWORD_AMBIGUOUS && embResults.length > 0) {
          // Combine scores for all topics, pick best combined
          const combined = this._combineScores(kwResults, embResults);
          if (combined && combined.score >= this.COMBINED_THRESHOLD) {
            return { ...combined, method: 'hybrid' };
          }
        } else if (embResults.length > 0 && embResults[0].score >= this.EMBEDDING_ONLY_THRESHOLD) {
          return { topicId: embResults[0].topicId, score: embResults[0].score, method: 'embedding' };
        }
      } catch (e) {
        if (e.name === 'AbortError') return null;
        console.warn('Embedding ranking failed, using keyword only:', e);
      }
    }

    // Fallback: keyword only with higher threshold
    if (topKw.score >= this.KEYWORD_ONLY_THRESHOLD) {
      return { topicId: topKw.topicId, score: topKw.score, method: 'keyword-fallback' };
    }

    return null;
  },

  _combineScores(kwResults, embResults) {
    const embMap = {};
    embResults.forEach(r => { embMap[r.topicId] = r.score; });

    let best = null;
    kwResults.forEach(kw => {
      const emb = embMap[kw.topicId] || 0;
      const combined = this.KEYWORD_WEIGHT * kw.score + this.EMBEDDING_WEIGHT * emb;
      if (!best || combined > best.score) {
        best = { topicId: kw.topicId, score: combined };
      }
    });
    return best;
  },

  // ── Suggestion UI ──────────────────────────────────────────────────────

  _showTopicSuggestion(topicId) {
    const topic = Storage.getTopic(topicId);
    if (!topic) return;
    const el = document.getElementById('topicSuggestion');
    if (!el) return;

    const tc = Utils.getTopicColor(topic);
    this._currentSuggestedTopicId = topicId;

    el.innerHTML = `
      <span class="topic-suggestion-dot" style="background:${tc.color}"></span>
      <span class="topic-suggestion-text">Looks like <strong>${Utils.escapeHtml(topic.name)}</strong></span>
      <button class="topic-suggestion-accept" style="background:${tc.light};color:${tc.color}">Select topic</button>
      <button class="topic-suggestion-dismiss">&times;</button>
    `;
    el.style.background = tc.light;

    el.querySelector('.topic-suggestion-accept').addEventListener('click', () => {
      this._acceptSuggestion(topicId);
    });
    el.querySelector('.topic-suggestion-dismiss').addEventListener('click', () => {
      this._dismissSuggestion();
    });

    // Trigger reflow then animate in
    el.classList.remove('hiding');
    el.style.display = 'flex';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('visible'));
    });
  },

  _hideTopicSuggestion() {
    const el = document.getElementById('topicSuggestion');
    if (!el || !el.classList.contains('visible')) {
      if (el) { el.style.display = 'none'; el.classList.remove('visible', 'hiding'); }
      return;
    }
    el.classList.add('hiding');
    el.classList.remove('visible');
    setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('hiding');
    }, 150);
    this._currentSuggestedTopicId = null;
  },

  _acceptSuggestion(topicId) {
    App.selectedTopicId = topicId;
    // Sync hidden select
    const sel = document.getElementById('topicSelect');
    if (sel) sel.value = topicId;
    // Update custom picker
    App._updateTopicPickerDisplay(topicId);
    this._hideTopicSuggestion();
    Utils.showToast('Topic selected', 'success');
    StudyLog.event('topic_suggestion_accepted', { topicId });
  },

  _dismissSuggestion() {
    this._suggestionDismissed = true;
    this._hideTopicSuggestion();
    StudyLog.event('topic_suggestion_dismissed', { topicId: this._currentSuggestedTopicId });
  },

  // ── Debounced Handler ──────────────────────────────────────────────────

  onInputChange(text) {
    clearTimeout(this._debounceTimer);

    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    if (text.length < this.MIN_QUERY_LENGTH) {
      this._hideTopicSuggestion();
      return;
    }

    if (this._suggestionDismissed) return;
    if (App.selectedTopicId) return;

    const topics = Storage.getTopics().filter(t => t.name !== 'Unassigned');
    if (topics.length === 0) return;

    this._debounceTimer = setTimeout(async () => {
      const result = await this.rankTopics(text);
      const mc = document.getElementById('mainContent');
      if (result && !this._suggestionDismissed && !App.selectedTopicId
          && mc && mc.classList.contains('welcome-mode')) {
        this._showTopicSuggestion(result.topicId);
      } else {
        this._hideTopicSuggestion();
      }
    }, this.DEBOUNCE_MS);
  },

  reset() {
    this._suggestionDismissed = false;
    this._currentSuggestedTopicId = null;
    clearTimeout(this._debounceTimer);
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._hideTopicSuggestion();
  },

  // ── Custom Topic Picker (dropdown) ─────────────────────────────────────

  initPicker() {
    const trigger = document.getElementById('topicPickerTrigger');
    const dropdown = document.getElementById('topicPickerDropdown');
    if (!trigger || !dropdown) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('open')) {
        this._closePicker();
      } else {
        this._openPicker();
      }
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      } else if (e.key === 'Escape') {
        this._closePicker();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#topicPicker')) {
        this._closePicker();
      }
    });
  },

  _openPicker() {
    const dropdown = document.getElementById('topicPickerDropdown');
    const trigger = document.getElementById('topicPickerTrigger');
    if (!dropdown || !trigger) return;

    StudyLog.event('topic_picker_opened', {});
    this._populateTopicPicker();
    trigger.classList.add('open');
    dropdown.style.display = 'block';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => dropdown.classList.add('open'));
    });

    this._pickerFocusIdx = -1;
    dropdown.addEventListener('keydown', this._pickerKeyHandler);
  },

  _closePicker() {
    const dropdown = document.getElementById('topicPickerDropdown');
    const trigger = document.getElementById('topicPickerTrigger');
    if (!dropdown || !trigger) return;

    dropdown.classList.remove('open');
    trigger.classList.remove('open');
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    dropdown.removeEventListener('keydown', this._pickerKeyHandler);
  },

  _pickerFocusIdx: -1,

  _pickerKeyHandler(e) {
    const options = document.querySelectorAll('.topic-picker-option');
    if (!options.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      TopicSuggester._pickerFocusIdx = Math.min(TopicSuggester._pickerFocusIdx + 1, options.length - 1);
      options.forEach(o => o.classList.remove('focused'));
      options[TopicSuggester._pickerFocusIdx].classList.add('focused');
      options[TopicSuggester._pickerFocusIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      TopicSuggester._pickerFocusIdx = Math.max(TopicSuggester._pickerFocusIdx - 1, 0);
      options.forEach(o => o.classList.remove('focused'));
      options[TopicSuggester._pickerFocusIdx].classList.add('focused');
      options[TopicSuggester._pickerFocusIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (TopicSuggester._pickerFocusIdx >= 0) {
        StudyLog.event('topic_picker_keyboard_select', { key: 'Enter', index: TopicSuggester._pickerFocusIdx });
        options[TopicSuggester._pickerFocusIdx].click();
      }
    } else if (e.key === 'Escape') {
      TopicSuggester._closePicker();
    }
  },

  _populateTopicPicker() {
    const dropdown = document.getElementById('topicPickerDropdown');
    if (!dropdown) return;

    const topics = Storage.getTopics().filter(t => t.name !== 'Unassigned');
    const currentVal = App.selectedTopicId || '';

    let html = `<div class="topic-picker-option${!currentVal ? ' selected' : ''}" data-value="">
      <span class="topic-picker-option-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
      <span class="topic-picker-option-name">Auto-detect</span>
    </div>`;

    topics.forEach(t => {
      const tc = Utils.getTopicColor(t);
      const sel = t.id === currentVal ? ' selected' : '';
      html += `<div class="topic-picker-option${sel}" data-value="${t.id}">
        <span class="topic-picker-option-dot" style="background:${tc.color}"></span>
        <span class="topic-picker-option-name">${Utils.escapeHtml(t.name)}</span>
      </div>`;
    });

    dropdown.innerHTML = html;

    dropdown.querySelectorAll('.topic-picker-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const val = opt.dataset.value;
        StudyLog.event('topic_picker_selected', { topicId: val || null });
        App.selectedTopicId = val || null;
        const sel = document.getElementById('topicSelect');
        if (sel) sel.value = val;
        App._updateTopicPickerDisplay(val || null);
        this._closePicker();
        if (val) {
          this._suggestionDismissed = true;
          this._hideTopicSuggestion();
        }
      });
    });
  },
};

const App = {
  msgCountSinceRefresh: 0,
  currentChatId: null,
  inactivityTimer: null,
  pendingSummarize: false,
  pendingAttachments: [],
  useSearch: true,
  selectedTopicId: null,

  async init() {
    if (Storage.restoreSession()) {
      this._enterApp();
    } else {
      this._showLogin();
    }
  },

  _showLogin() {
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
    const idInput = document.getElementById('loginIdInput');
    const pwInput = document.getElementById('loginPasswordInput');
    const btn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');
    idInput.focus();

    const doLogin = async () => {
      const id = idInput.value.trim();
      const pw = pwInput.value;
      errorEl.textContent = '';
      if (!id || !pw) {
        errorEl.textContent = 'Please enter both ID and password.';
        (id ? pwInput : idInput).classList.add('shake');
        setTimeout(() => { idInput.classList.remove('shake'); pwInput.classList.remove('shake'); }, 400);
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Logging in…';
      try {
        const resp = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id, password: pw }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          errorEl.textContent = err.detail || 'Login failed.';
          btn.disabled = false;
          btn.textContent = 'Continue';
          return;
        }
        const data = await resp.json();
        Storage.setUser(id, data.condition);
        StudyLog.event('session_start', { isNew: data.isNew });
        this._enterApp();
      } catch (e) {
        errorEl.textContent = 'Connection error. Is the server running?';
        btn.disabled = false;
        btn.textContent = 'Continue';
      }
    };
    btn.addEventListener('click', doLogin);
    pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') pwInput.focus(); });
  },

  _enterApp() {
    STUDY_CONDITION = Storage.getCondition();
    StudyLog.init();
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';

    // Update sidebar footer with user info
    const userId = Storage.getUserId();
    document.getElementById('userName').textContent = userId;
    document.getElementById('userAvatar').textContent = userId.charAt(0).toUpperCase();
    document.getElementById('userCondition').textContent = STUDY_CONDITION === 'baseline' ? 'Baseline' : 'Loom';

    // Apply condition-specific UI
    if (STUDY_CONDITION === 'baseline') {
      document.body.classList.add('baseline-mode');
      // Show baseline panel in right sidebar
      setTimeout(() => Sidebar.showBaseline(), 0);
    } else {
      document.body.classList.remove('baseline-mode');
    }

    try { Storage.migrateTopicColors(); } catch (e) { console.warn('migrateTopicColors failed:', e); }
    try { Storage.reEmbedChats(); } catch (e) { console.warn('reEmbedChats failed:', e); }
    try { Sidebar.init(); } catch (e) { console.warn('Sidebar.init failed:', e); }
    this._bindEvents();
    try { this._loadState(); } catch (e) { console.warn('_loadState failed:', e); }

    // Safety: ensure no dialog overlays are stuck open from a prior session
    document.querySelectorAll('.dialog-overlay').forEach(d => { d.style.display = 'none'; });

    this.inactivityTimer = new InactivityTimer(() => this._onInactive(), 120000);
    this.inactivityTimer.start();

    if (STUDY_CONDITION === 'loom') {
      try { this._migrateStructuredSummaries(); } catch (e) { console.warn('migrateStructuredSummaries failed:', e); }
      try { this._migrateStatusToThreads(); } catch (e) { console.warn('migrateStatusToThreads failed:', e); }
    }

    const chats = Storage.getChats();
    if (chats.length === 0) {
      Storage.pullSync();
    }
  },

  _bindEvents() {
    document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    document.getElementById('chatInput').addEventListener('input', (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    });

    document.getElementById('newChatBtn').addEventListener('click', () => this.newChat());
    document.getElementById('newTopicBtn').addEventListener('click', () => this._showTopicDialog());
    document.getElementById('topicCancelBtn').addEventListener('click', () => this._hideTopicDialog());
    document.getElementById('topicCreateBtn').addEventListener('click', () => this._createTopic());

    // View toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        StudyLog.event('view_switched', { view: btn.dataset.view });
        this._renderChatList(btn.dataset.view);
      });
    });

    // Drag-and-drop on entire middle panel (context + images)
    const inputArea = document.getElementById('chatInputArea');
    const mainContent = document.getElementById('mainContent');
    const _handleDragOver = (e) => {
      e.preventDefault();
      inputArea.classList.add('drag-over');
    };
    const _handleDragLeave = (e) => {
      if (!mainContent.contains(e.relatedTarget)) inputArea.classList.remove('drag-over');
    };
    const _handleDrop = (e) => {
      e.preventDefault();
      inputArea.classList.remove('drag-over');
      // Handle dropped files (images, documents)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this._handleFiles(e.dataTransfer.files);
        return;
      }
      // Handle sidebar drag context
      const text = e.dataTransfer.getData('text/plain');
      const label = e.dataTransfer.getData('application/loom-label');
      if (text) this.setContextBlock(text, label);
    };
    mainContent.addEventListener('dragover', _handleDragOver);
    mainContent.addEventListener('dragleave', _handleDragLeave);
    mainContent.addEventListener('drop', _handleDrop);

    // Context block controls
    document.getElementById('contextCloseBtn').addEventListener('click', () => this.clearContextBlock());
    document.getElementById('contextToggleBtn').addEventListener('click', () => this._toggleContextExpand());

    // File attachment
    document.getElementById('attachBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e) => {
      this._handleFiles(e.target.files);
      e.target.value = '';
    });

    // Google Search grounding toggle (on by default)
    const searchBtn = document.getElementById('searchToggleBtn');
    searchBtn.classList.add('active');
    searchBtn.title = 'Google Search ON';
    searchBtn.addEventListener('click', () => {
      this.useSearch = !this.useSearch;
      searchBtn.classList.toggle('active', this.useSearch);
      searchBtn.title = this.useSearch ? 'Google Search ON' : 'Google Search grounding';
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
      StudyLog.event('session_end');
      Sidebar._flushDirtyLabels();
      this._summarizeCurrentChat();
      Storage.logout();
      location.reload();
    });

    // Summarize on tab leave
    window.addEventListener('beforeunload', () => {
      StudyLog.event('session_end');
      Sidebar._flushDirtyLabels();
      this._summarizeCurrentChat();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        Sidebar._flushDirtyLabels();
        this._summarizeCurrentChat();
      } else {
        this._renderChatList();
      }
    });

    // Resize handles
    this._initResize('resizeLeft', 'leftSidebar', 'left');
    this._initResize('resizeRight', 'rightSidebar', 'right');

    // Sidebar collapse toggles
    this._initCollapseToggle('collapseLeftBtn', 'leftSidebar', 'left');
    this._initCollapseToggle('collapseRightBtn', 'rightSidebar', 'right');

    // Model is fixed to Gemini 3 Flash (no selector)
    Storage.setChatModel('gemini-3-flash-preview');
    Storage.setSidebarModel('gemini-3-flash-preview');

    // Topic selector in input bar (hidden, synced by custom picker)
    const topicSel = document.getElementById('topicSelect');
    topicSel.addEventListener('change', () => {
      this.selectedTopicId = topicSel.value || null;
    });

    // Custom topic picker
    TopicSuggester.initPicker();

    // Topic suggestion: debounced input handler
    document.getElementById('chatInput').addEventListener('input', () => {
      const mainContent = document.getElementById('mainContent');
      if (!mainContent.classList.contains('welcome-mode')) return;
      if (STUDY_CONDITION !== 'loom') return;
      const text = document.getElementById('chatInput').value;
      TopicSuggester.onInputChange(text);
    });
  },

  _initResize(handleId, sidebarId, side) {
    const handle = document.getElementById(handleId);
    const sidebar = document.getElementById(sidebarId);
    if (!handle || !sidebar) return;

    let startX, startWidth, rafId;

    const onMouseMove = (e) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
        if (Math.abs(e.clientX - startX) > 3) {
          handle.dataset.dragMoved = 'true';
        }
        const newWidth = Math.max(
          side === 'left' ? 200 : 240,
          Math.min(side === 'left' ? 400 : 500, startWidth + delta)
        );
        sidebar.style.flexBasis = newWidth + 'px';
      });
    };

    const onMouseUp = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (rafId) cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Delay removing the drag-moved flag slightly so click events can see it
      setTimeout(() => {
        handle.dataset.dragMoved = 'false';
      }, 50);
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      handle.dataset.dragMoved = 'false';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  },

  _initCollapseToggle(btnId, sidebarId, side) {
    const btn = document.getElementById(btnId);
    const sidebar = document.getElementById(sidebarId);
    if (!btn || !sidebar) return;

    const svgLeft = '<polyline points="15 18 9 12 15 6"/>';
    const svgRight = '<polyline points="9 18 15 12 9 6"/>';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const handle = btn.closest('.resize-handle');
      if (handle && handle.dataset.dragMoved === 'true') {
        return; // Ignore click if it was a drag
      }

      const collapsed = sidebar.classList.toggle('collapsed');
      StudyLog.event('sidebar_collapsed', { side, collapsed });
      const svg = btn.querySelector('svg');
      if (side === 'left') {
        svg.innerHTML = collapsed ? svgRight : svgLeft;
      } else {
        svg.innerHTML = collapsed ? svgLeft : svgRight;
      }
    });
  },

  _loadState() {
    let chatId = Storage.getCurrentChatId();
    if (!chatId || !Storage.getChat(chatId)) {
      const chat = Storage.createChat();
      chatId = chat.id;
    }
    this.currentChatId = chatId;
    this._renderChat(chatId);
    this._renderChatList('recent');
  },

  _populateTopicSelector() {
    const sel = document.getElementById('topicSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Auto-detect</option>';
    const topics = Storage.getTopics().filter(t => t.name !== 'Unassigned');
    topics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    sel.value = prev || '';
    this.selectedTopicId = sel.value || null;

    // Rebuild keyword index and refresh embeddings in the background
    TopicSuggester.rebuildKeywordIndex();
    TopicSuggester.refreshTopicEmbeddings();
  },

  _updateTopicPickerDisplay(topicId) {
    const label = document.getElementById('topicPickerLabel');
    const dot = document.getElementById('topicPickerDot');
    const icon = document.querySelector('.topic-picker-icon');
    const trigger = document.getElementById('topicPickerTrigger');
    if (!label || !dot || !trigger) return;

    if (!topicId) {
      label.textContent = 'Topic';
      dot.style.display = 'none';
      if (icon) icon.style.display = '';
      trigger.classList.remove('topic-selected');
      return;
    }

    const topic = Storage.getTopic(topicId);
    if (!topic) return;
    const tc = Utils.getTopicColor(topic);
    label.textContent = topic.name;
    dot.style.display = 'block';
    dot.style.background = tc.color;
    if (icon) icon.style.display = 'none';
    trigger.classList.add('topic-selected');
    trigger.style.color = tc.color;
    trigger.style.background = tc.light;
  },

  // ── Chat Operations ───────────────────────────────────────────────────

  newChat() {
    try { Sidebar._flushDirtyLabels(); } catch (e) { console.warn('flushDirtyLabels failed:', e); }
    try { this._summarizeCurrentChat(); } catch (e) { console.warn('summarizeCurrentChat failed:', e); }
    const chat = Storage.createChat();
    this.currentChatId = chat.id;
    this.msgCountSinceRefresh = 0;
    this.pendingSummarize = false;
    this.selectedTopicId = null;
    const topicSel = document.getElementById('topicSelect');
    if (topicSel) topicSel.value = '';
    this._updateTopicPickerDisplay(null);
    TopicSuggester.reset();
    this.useSearch = true;
    const searchBtn = document.getElementById('searchToggleBtn');
    if (searchBtn) {
      searchBtn.classList.add('active');
      searchBtn.title = 'Google Search ON';
    }
    Sidebar.hide();
    try { this._renderChat(chat.id); } catch (e) { console.warn('renderChat failed:', e); }
    try { this._renderChatList(); } catch (e) { console.warn('renderChatList failed:', e); }
    document.getElementById('chatInput').focus();
    StudyLog.event('chat_created', { chatId: chat.id });
  },

  async sendMessage() {
    const input = document.getElementById('chatInput');
    let content = input.value.trim();

    // Prepend context block if present
    let contextBlock = null;
    const ctxEl = document.getElementById('contextBlock');
    if (ctxEl.style.display !== 'none') {
      const fullText = document.getElementById('contextFullText').value.trim();
      if (fullText) {
        contextBlock = fullText;
        const isLinkedChat = fullText.includes('--- Previous chat history ---');
        const wrapper = isLinkedChat
          ? `[The user is building on a previous conversation they had. Here is that conversation and how it connects:\n${fullText}]`
          : `[Context from my knowledge map: ${fullText}]`;
        content = content
          ? `${wrapper}\n\n${content}`
          : `${wrapper}\n\nPlease continue building on this previous conversation.`;
      }
      this.clearContextBlock();
    }

    if (!content && this.pendingAttachments.length === 0) return;
    if (!content && this.pendingAttachments.length > 0) {
      content = 'Please describe or analyze the attached file(s).';
    }

    input.value = '';
    input.style.height = 'auto';

    if (!this.currentChatId) {
      const chat = Storage.createChat();
      this.currentChatId = chat.id;
    }

    // Pre-assign topic and inject status as context if a topic is selected
    if (this.selectedTopicId) {
      const chat = Storage.getChat(this.currentChatId);
      const msgs = Storage.getMessages(this.currentChatId);
      if (chat && !chat.topicId && msgs.length === 0) {
        chat.topicId = this.selectedTopicId;
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        StudyLog.event('topic_assigned', { chatId: this.currentChatId, topicId: this.selectedTopicId, assignMethod: 'manual' });
        const topic = Storage.getTopic(this.selectedTopicId);
        if (topic) {
          topic.lastActive = Utils.timestamp();
          Storage.saveTopic(topic);
          if (topic.name !== 'Unassigned') {
            if (topic.statusSummary) {
              const statusStr = Sidebar._serializeStatus(topic.statusSummary);
              content = `[My current status in "${topic.name}": ${statusStr}]\n\n${content}`;
            }
            Sidebar.show(this.selectedTopicId);
          }
        }
      }
    }

    // Add user message
    const userMsg = {
      id: 'msg_' + Utils.generateId(),
      chatId: this.currentChatId,
      role: 'user',
      content: content,
      contextBlock: contextBlock,
      attachments: this.pendingAttachments.length > 0
        ? this.pendingAttachments.map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data }))
        : null,
      timestamp: Utils.timestamp(),
    };
    Storage.addMessage(this.currentChatId, userMsg);
    this._appendMessage(userMsg);
    this.pendingSummarize = true;
    const currentChat = Storage.getChat(this.currentChatId);
    StudyLog.event('query_sent', {
      chatId: this.currentChatId,
      topicId: currentChat?.topicId || this.selectedTopicId || null,
      hasContext: !!contextBlock,
    });

    // Exit welcome mode and hide topic selector
    const mainContent = document.getElementById('mainContent');
    mainContent.classList.remove('welcome-mode');
    const welcomeSuggestions = document.getElementById('welcomeSuggestions');
    if (welcomeSuggestions) welcomeSuggestions.remove();
    const welcomeGreeting = document.querySelector('.welcome-greeting');
    if (welcomeGreeting) welcomeGreeting.remove();
    const topicSelEl = document.getElementById('topicSelect');
    if (topicSelEl) topicSelEl.style.display = 'none';
    const topicPickerEl = document.getElementById('topicPicker');
    if (topicPickerEl) topicPickerEl.style.display = 'none';
    TopicSuggester._hideTopicSuggestion();

    document.getElementById('sendBtn').disabled = true;

    const messages = Storage.getMessages(this.currentChatId).map(m => ({
      role: m.role, content: m.content,
    }));
    const topics = Storage.getTopics().map(t => ({ id: t.id, name: t.name }));

    // Only send same-topic past chats for connections in Loom mode
    let sameTopicSummaries = [];
    if (STUDY_CONDITION === 'loom') {
      const currentChat2 = Storage.getChat(this.currentChatId);
      const currentTopicId = currentChat2?.topicId || this.selectedTopicId;
      sameTopicSummaries = currentTopicId
        ? Storage.getChats()
          .filter(c => c.id !== this.currentChatId && c.summary && c.topicId === currentTopicId)
          .map(c => ({
            id: c.id, title: c.title, summary: c.summary,
            userAsked: c.userAsked || '', aiCovered: c.aiCovered || '',
            embedding: c.embedding, topicId: c.topicId,
          }))
        : [];
    }

    const reqBody = {
      chatId: this.currentChatId,
      messages,
      existingTopics: STUDY_CONDITION === 'loom' ? topics : [],
      existingConcepts: STUDY_CONDITION === 'loom' ? Storage.getConcepts().map(c => ({
        id: c.id, topicId: c.topicId, title: c.title, preview: c.preview,
      })) : [],
      model: Storage.getChatModel(),
      useSearch: this.useSearch,
      allChatSummaries: sameTopicSummaries,
      condition: STUDY_CONDITION,
      personalDetails: STUDY_CONDITION === 'baseline' ? Storage.getPersonalDetails() : [],
    };
    if (this.pendingAttachments.length > 0) {
      reqBody.attachments = this.pendingAttachments.map(a => ({
        mimeType: a.mimeType, data: a.data,
      }));
      this.pendingAttachments = [];
      this._renderAttachments();
    }

    // Create a live assistant message element for streaming
    const assistantEl = this._createStreamingMessage();

    try {
      const resp = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullResponse = '';

      const _processSSELine = async (line) => {
        if (!line.startsWith('data: ')) return;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'chunk') {
            fullResponse += evt.text;
            this._updateStreamingMessage(assistantEl, fullResponse);
          } else if (evt.type === 'done') {
            fullResponse = evt.response || fullResponse;
            console.log('[Module2] done event received, response length:', fullResponse.length);
            console.log('[Module2] has markers:', /\{~\d+\}/.test(fullResponse));
            console.log('[Module2] has conn block:', fullResponse.includes('{~CONNECTIONS~}'));

            const assistantMsgId = 'msg_' + Utils.generateId();
            this._finalizeStreamingMessage(assistantEl, fullResponse, assistantMsgId);

            const { mainText: cleanContent, connectionsJson: savedConns } = this._stripConnectionBlock(this._stripSearchArtifacts(fullResponse));
            console.log('[Module2] connections parsed:', savedConns?.length || 0);
            const cleanText = cleanContent.replace(/\{~\d+\}/g, '');
            const assistantMsg = {
              id: assistantMsgId,
              chatId: this.currentChatId,
              role: 'assistant',
              content: cleanText,
              rawContent: cleanContent,
              connections: savedConns || null,
              contextBlock: null,
              timestamp: Utils.timestamp(),
            };
            Storage.addMessage(this.currentChatId, assistantMsg);

            if (STUDY_CONDITION === 'loom') {
              if (evt.topic && evt.topic.confidence > 0.35) {
                await this._handleTopicDetection(evt.topic);
              }
              if (evt.concepts && evt.concepts.length > 0) {
                this._handleConcepts(evt.concepts);
              }
              const chat = Storage.getChat(this.currentChatId);
              if (!this._isUnassignedTopic(chat?.topicId)) {
                if (savedConns && savedConns.length > 0) {
                  Sidebar.showConnections(savedConns);
                } else {
                  Sidebar.clearConnections();
                }
              }
            }
          } else if (evt.type === 'error') {
            this._finalizeStreamingMessage(assistantEl, evt.message || 'Error from server.');
          }
        } catch (parseErr) {
          console.warn('[Module2] SSE parse error:', parseErr, 'line length:', line.length, 'line start:', line.slice(0, 100));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          await _processSSELine(line);
        }
      }

      // Process any remaining data left in buffer after stream closes
      if (buffer.trim()) {
        console.log('[Module2] Processing remaining buffer after stream close, length:', buffer.length);
        for (const line of buffer.split('\n')) {
          await _processSSELine(line);
        }
      }

      // Update chat title from first exchange, stripping any injected status prefix
      const chat = Storage.getChat(this.currentChatId);
      if (chat && chat.title === 'New Chat') {
        const rawTitle = messages[0]?.content || 'Chat';
        const cleanTitle = rawTitle.replace(/^\[My current status in "[^"]*":[^\]]*\]\s*/s, '').trim();
        chat.title = Utils.truncate(cleanTitle || rawTitle, 40);
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        document.getElementById('chatTitle').textContent = chat.title;
        this._renderChatList();
      }

      this.msgCountSinceRefresh++;
      const currentChat = Storage.getChat(this.currentChatId);
      if (STUDY_CONDITION === 'loom' && !this._isUnassignedTopic(currentChat?.topicId)) {
        if (this.msgCountSinceRefresh === 1 || this.msgCountSinceRefresh % 3 === 0) {
          Sidebar.refresh();
        }
      } else if (STUDY_CONDITION !== 'loom') {
        this._extractBaselineDetails();
      }

    } catch (err) {
      console.error('Chat error:', err);
      this._finalizeStreamingMessage(assistantEl, 'Failed to get response. Check your connection.');
      Utils.showToast('Failed to get response. Check your connection.', 'error');
    }

    document.getElementById('sendBtn').disabled = false;
  },

  // ── Chunk Labeling (Module 1) ────────────────────────────────────────

  _splitIntoChunks(text) {
    if (!text || !text.trim()) return [];
    const blocks = text.split(/\n\n+/);
    const chunks = [];
    let current = [];
    let currentLines = 0;
    const MIN_LINES = 4;

    const countLines = (block) => block.split('\n').length;

    const flushCurrent = () => {
      if (current.length > 0) {
        chunks.push(current.join('\n\n'));
        current = [];
        currentLines = 0;
      }
    };

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const isHeader = /^#{1,4}\s/.test(trimmed);
      const lines = countLines(trimmed);

      if (isHeader && currentLines >= MIN_LINES) {
        flushCurrent();
      }

      current.push(trimmed);
      currentLines += lines;

      if (currentLines >= MIN_LINES && !isHeader) {
        const nextIdx = blocks.indexOf(block) + 1;
        const nextBlock = nextIdx < blocks.length ? blocks[nextIdx]?.trim() : '';
        const nextIsHeader = nextBlock && /^#{1,4}\s/.test(nextBlock);
        if (nextIsHeader || currentLines >= MIN_LINES + 4) {
          flushCurrent();
        }
      }
    }
    flushCurrent();

    // Fallback: if only 1 chunk but text has multiple paragraph blocks, re-split
    // so plain-text replies without headers still get tagging
    if (chunks.length <= 1 && chunks.length > 0) {
      const paragraphs = chunks[0].split(/\n\n+/).filter(p => p.trim());
      if (paragraphs.length >= 2) {
        const totalLines = paragraphs.reduce((sum, p) => sum + countLines(p), 0);
        if (totalLines >= 6) {
          const reChunks = [];
          let acc = [];
          let accLines = 0;
          for (const para of paragraphs) {
            acc.push(para);
            accLines += countLines(para);
            if (accLines >= MIN_LINES) {
              reChunks.push(acc.join('\n\n'));
              acc = [];
              accLines = 0;
            }
          }
          if (acc.length > 0) {
            if (reChunks.length > 0 && accLines < 2) {
              reChunks[reChunks.length - 1] += '\n\n' + acc.join('\n\n');
            } else {
              reChunks.push(acc.join('\n\n'));
            }
          }
          if (reChunks.length >= 2) return reChunks;
        }
      }
    }

    if (chunks.length > 1) {
      const lastLines = countLines(chunks[chunks.length - 1]);
      if (lastLines < 3) {
        const merged = chunks[chunks.length - 2] + '\n\n' + chunks[chunks.length - 1];
        chunks.splice(chunks.length - 2, 2, merged);
      }
    }

    return chunks;
  },

  _injectChunkLabels(content, chunkLabels) {
    if (!chunkLabels || Object.keys(chunkLabels).length === 0) return content;
    const chunks = this._splitIntoChunks(content);
    if (chunks.length === 0) return content;

    const parts = chunks.map((chunk, i) => {
      const label = chunkLabels[String(i)];
      if (label === 'understood') return chunk + '\n[USER: understood this section]';
      if (label === 'unsure') return chunk + '\n[USER: unsure about this section]';
      return chunk;
    });
    return parts.join('\n\n');
  },

  _renderChunkedContent(text, msgId, chunkLabels) {
    let chunks = this._splitIntoChunks(text);
    // Always allow tagging — if splitter produced 0 or 1 chunks, use the whole text as a single chunk
    if (chunks.length === 0 && text && text.trim()) {
      chunks = [text.trim()];
    } else if (chunks.length === 0) {
      return { html: Utils.renderMarkdown(text), chunked: false };
    }

    const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>';
    const questionSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>';

    const chunksHtml = chunks.map((chunk, i) => {
      let rendered = Utils.renderMarkdown(chunk);
      rendered = this._parseConnectionMarkers(rendered);
      const label = chunkLabels?.[String(i)] || '';
      const understoodActive = label === 'understood' ? ' active' : '';
      const unsureActive = label === 'unsure' ? ' active' : '';
      const labeledClass = label === 'understood' ? ' labeled-understood'
        : label === 'unsure' ? ' labeled-unsure' : '';

      return `<div class="msg-chunk${labeledClass}" data-chunk-idx="${i}" data-msg-id="${msgId}">
        <div class="chunk-content">${rendered}</div>
        <div class="chunk-label-bar">
          <button class="chunk-label-btn${understoodActive}" data-label="understood" title="I understood this (or double-click chunk)">${checkSvg}</button>
          <button class="chunk-label-btn${unsureActive}" data-label="unsure" title="I'm unsure about this">${questionSvg}</button>
        </div>
      </div>`;
    }).join('');

    return { html: chunksHtml, chunked: true };
  },

  _bindChunkLabelHandlers(containerEl) {
    containerEl.querySelectorAll('.msg-chunk').forEach(chunkEl => {
      chunkEl.querySelectorAll('.chunk-label-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const msgId = chunkEl.dataset.msgId;
          const chunkIdx = chunkEl.dataset.chunkIdx;
          const label = btn.dataset.label;
          this._toggleChunkLabel(chunkEl, msgId, chunkIdx, label);
        });
      });
      chunkEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('.chunk-label-btn')) return;
        const msgId = chunkEl.dataset.msgId;
        const chunkIdx = chunkEl.dataset.chunkIdx;
        this._toggleChunkLabel(chunkEl, msgId, chunkIdx, 'understood');
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
      });
    });
  },

  _toggleChunkLabel(chunkEl, msgId, chunkIdx, label) {
    const chatId = this.currentChatId;
    const messages = Storage.getMessages(chatId);
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    if (!msg.chunkLabels) msg.chunkLabels = {};
    const current = msg.chunkLabels[chunkIdx];
    const newLabel = current === label ? null : label;

    if (newLabel) {
      msg.chunkLabels[chunkIdx] = newLabel;
    } else {
      delete msg.chunkLabels[chunkIdx];
    }

    const data = Storage._getAll();
    const msgArr = data.messages[chatId];
    if (msgArr) {
      const idx = msgArr.findIndex(m => m.id === msgId);
      if (idx >= 0) {
        msgArr[idx] = msg;
        Storage._saveAll(data);
      }
    }

    chunkEl.querySelectorAll('.chunk-label-btn').forEach(b => b.classList.remove('active'));
    if (newLabel) {
      chunkEl.querySelector(`.chunk-label-btn[data-label="${newLabel}"]`)?.classList.add('active');
    }

    chunkEl.classList.remove('labeled-understood', 'labeled-unsure');
    if (newLabel) {
      chunkEl.classList.add(`labeled-${newLabel}`);
    }

    Sidebar._labelsDirty = true;

    StudyLog.event('chunk_labeled', {
      chatId,
      msgId,
      chunkIdx: parseInt(chunkIdx),
      label: newLabel || 'removed',
    });
  },

  _createStreamingMessage() {
    const container = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `<div class="message-content"><span class="streaming-cursor"></span></div>`;
    container.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return el;
  },

  _parseConnectionMarkers(html) {
    return html.replace(/((?:\S+\s+){0,2}\S+)\s*\{~(\d+)\}/g,
      '<span class="conn-marker loading" data-conn-id="$2">$1<span class="conn-dots"></span></span>');
  },

  _stripSearchArtifacts(text) {
    return text.replace(/google:search\{[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n');
  },

  _stripConnectionBlock(text) {
    const connStart = text.indexOf('{~CONNECTIONS~}');
    if (connStart === -1) return { mainText: text, connectionsJson: null };
    const mainText = text.substring(0, connStart).trimEnd();
    const connEnd = text.indexOf('{~END~}', connStart);
    if (connEnd === -1) return { mainText, connectionsJson: null };
    const jsonStr = text.substring(connStart + '{~CONNECTIONS~}'.length, connEnd).trim();
    try {
      const connections = JSON.parse(jsonStr);
      return { mainText, connectionsJson: Array.isArray(connections) ? connections : null };
    } catch {
      return { mainText, connectionsJson: null };
    }
  },

  _updateStreamingMessage(el, text) {
    const contentEl = el.querySelector('.message-content');
    const { mainText } = this._stripConnectionBlock(this._stripSearchArtifacts(text));
    const rendered = Utils.renderMarkdown(mainText);
    const withMarkers = this._parseConnectionMarkers(rendered);
    contentEl.innerHTML = withMarkers + '<span class="streaming-cursor"></span>';
  },

  _finalizeStreamingMessage(el, text, msgId) {
    const contentEl = el.querySelector('.message-content');
    const { mainText, connectionsJson } = this._stripConnectionBlock(this._stripSearchArtifacts(text));
    const markersInMainText = mainText.match(/\{~\d+\}/g);
    console.log('[Module2 finalize] mainText markers:', markersInMainText);
    console.log('[Module2 finalize] connectionsJson:', connectionsJson?.length || 0);

    const { html: chunkedHtml, chunked } = this._renderChunkedContent(mainText, msgId || '', null);

    if (chunked) {
      contentEl.innerHTML = chunkedHtml;
    } else {
      const rendered = Utils.renderMarkdown(mainText);
      const withMarkers = this._parseConnectionMarkers(rendered);
      contentEl.innerHTML = withMarkers;
    }

    if (connectionsJson && connectionsJson.length > 0) {
      this._resolveConnectionMarkers(contentEl, connectionsJson);
    } else {
      contentEl.querySelectorAll('.conn-marker').forEach(m => m.remove());
    }

    if (chunked) {
      this._bindChunkLabelHandlers(contentEl);
    }
  },

  _resolveConnectionMarkers(contentEl, connectionsJson) {
    contentEl.querySelectorAll('.conn-marker').forEach(marker => {
      const id = parseInt(marker.dataset.connId, 10);
      const conn = connectionsJson.find(c => c.id === id);
      if (conn) {
        marker.classList.remove('loading');
        marker.classList.add('resolved');
        marker.dataset.connText = conn.text || '';
        marker.dataset.connChatId = conn.chatId || '';
        marker.dataset.connChatTitle = conn.chatTitle || '';
        marker.dataset.connUserAsked = conn.userAsked || '';
        marker.dataset.connAiCovered = conn.aiCovered || '';
        const dots = marker.querySelector('.conn-dots');
        if (dots) {
          dots.className = 'conn-icon';
          dots.textContent = '';
          dots.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
        }
      } else {
        marker.remove();
      }
    });
    this._bindConnectionCards(contentEl);
  },

  _connCardEl: null,
  _connCardMarker: null,
  _connScrollHandler: null,

  _getConnCard() {
    if (!this._connCardEl) {
      const card = document.createElement('div');
      card.className = 'conn-card';
      card.innerHTML = `
        <div class="conn-card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <span class="conn-card-title"></span>
          <button class="conn-card-close">&times;</button>
        </div>
        <div class="conn-card-summary">
          <div class="conn-card-row">
            <span class="conn-card-label">You asked</span>
            <span class="conn-card-value conn-card-user-asked"></span>
          </div>
          <div class="conn-card-row">
            <span class="conn-card-label">You explored</span>
            <span class="conn-card-value conn-card-ai-covered"></span>
          </div>
        </div>
        <div class="conn-card-insight"></div>
        <div class="conn-card-actions">
          <button class="conn-card-build">Build on this</button>
          <a class="conn-card-goto" href="#">Go to chat</a>
        </div>
      `;
      document.body.appendChild(card);

      card.querySelector('.conn-card-close').addEventListener('click', () => this._hideConnCard());

      card.querySelector('.conn-card-goto').addEventListener('click', (e) => {
        e.preventDefault();
        const chatId = card.dataset.targetChatId;
        if (chatId) {
          StudyLog.event('module2_connection_clicked', { chatId: this.currentChatId, connectionChatId: chatId, action: 'view' });
          this._hideConnCard();
          const chat = Storage.getChat(chatId);
          if (chat) {
            Sidebar._flushDirtyLabels();
            this._summarizeCurrentChat();
            this.msgCountSinceRefresh = 0;
            this._renderChat(chatId);
            this._renderChatList();
          }
        }
      });

      card.querySelector('.conn-card-build').addEventListener('click', () => {
        const chatId = card.dataset.targetChatId || '';
        const insight = card.dataset.insight || '';
        const title = card.dataset.title || '';

        const parts = [];
        if (insight) parts.push(`Connection to "${title}": ${insight}`);

        // Include the full past chat history for rich context
        if (chatId) {
          const pastMessages = Storage.getMessages(chatId);
          if (pastMessages.length > 0) {
            parts.push('\n--- Previous chat history ---');
            pastMessages.forEach(m => {
              const role = m.role === 'user' ? 'User' : 'AI';
              const text = (m.content || '').slice(0, 800);
              parts.push(`${role}: ${text}${m.content?.length > 800 ? '...' : ''}`);
            });
            parts.push('--- End of previous chat ---');
          }
        }
        const contextText = parts.join('\n');

        StudyLog.event('module2_connection_clicked', { chatId: this.currentChatId, connectionChatId: chatId, action: 'build' });
        this._hideConnCard();
        if (contextText) {
          this.setContextBlock(contextText, title);
          document.getElementById('chatInput').focus();
        }
      });

      document.addEventListener('click', (e) => {
        if (card.classList.contains('visible') && !card.contains(e.target) && !e.target.closest('.conn-marker')) {
          this._hideConnCard();
        }
      });

      this._connCardEl = card;
    }
    return this._connCardEl;
  },

  _showConnCard(marker) {
    const card = this._getConnCard();

    const title = marker.dataset.connChatTitle || 'Past chat';
    const userAsked = marker.dataset.connUserAsked || '';
    const aiCovered = marker.dataset.connAiCovered || '';
    const insight = marker.dataset.connText || '';
    const chatId = marker.dataset.connChatId || '';

    card.querySelector('.conn-card-title').textContent = title;
    card.querySelector('.conn-card-insight').textContent = insight;

    const summaryEl = card.querySelector('.conn-card-summary');
    const userRow = card.querySelector('.conn-card-row:first-child');
    const aiRow = card.querySelector('.conn-card-row:last-child');

    if (userAsked || aiCovered) {
      summaryEl.style.display = '';
      card.querySelector('.conn-card-user-asked').textContent = userAsked || '—';
      card.querySelector('.conn-card-ai-covered').textContent = aiCovered || '—';
      userRow.style.display = userAsked ? '' : 'none';
      aiRow.style.display = aiCovered ? '' : 'none';
    } else {
      summaryEl.style.display = 'none';
    }

    card.dataset.targetChatId = chatId;
    card.dataset.userAsked = userAsked;
    card.dataset.aiCovered = aiCovered;
    card.dataset.insight = insight;
    card.dataset.title = title;

    const gotoLink = card.querySelector('.conn-card-goto');
    gotoLink.style.display = chatId ? '' : 'none';

    card.classList.add('visible');
    this._connCardMarker = marker;

    // Position anchored to marker
    const positionCard = () => {
      const rect = marker.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      // Check if marker is still visible in viewport
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        this._hideConnCard();
        return;
      }
      let top = rect.bottom + 8;
      if (top + cardRect.height > window.innerHeight - 16) {
        top = rect.top - cardRect.height - 8;
      }
      let left = rect.left + rect.width / 2 - cardRect.width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - cardRect.width - 12));
      card.style.top = top + 'px';
      card.style.left = left + 'px';
    };

    requestAnimationFrame(positionCard);

    // Follow scroll and dismiss when marker leaves viewport
    if (this._connScrollHandler) {
      const chatMessages = document.getElementById('chatMessages');
      chatMessages.removeEventListener('scroll', this._connScrollHandler);
    }
    this._connScrollHandler = () => {
      if (!card.classList.contains('visible')) return;
      requestAnimationFrame(positionCard);
    };
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.addEventListener('scroll', this._connScrollHandler, { passive: true });
  },

  _hideConnCard() {
    if (this._connCardEl && this._connCardEl.classList.contains('visible')) {
      StudyLog.event('connection_card_closed', { chatId: this.currentChatId });
    }
    if (this._connCardEl) this._connCardEl.classList.remove('visible');
    this._connCardMarker = null;
    if (this._connScrollHandler) {
      const chatMessages = document.getElementById('chatMessages');
      if (chatMessages) chatMessages.removeEventListener('scroll', this._connScrollHandler);
      this._connScrollHandler = null;
    }
  },

  _bindConnectionCards(container) {
    container.querySelectorAll('.conn-marker.resolved').forEach(marker => {
      marker.style.cursor = 'pointer';
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        StudyLog.event('connection_marker_clicked', { connId: marker.dataset.connId, chatId: this.currentChatId });
        this._showConnCard(marker);
      });
      marker.addEventListener('mouseenter', () => {
        StudyLog.event('connection_marker_hovered', { connId: marker.dataset.connId, chatId: this.currentChatId });
        Sidebar.highlightSidebarCard(marker.dataset.connId, true);
      });
      marker.addEventListener('mouseleave', () => {
        Sidebar.highlightSidebarCard(marker.dataset.connId, false);
      });
    });
  },

  _isUnassignedTopic(topicId) {
    if (!topicId) return false;
    const topic = Storage.getTopic(topicId);
    return topic?.name === 'Unassigned';
  },

  _getOrCreateUnassignedTopic() {
    const existing = Storage.getTopics().find(t => t.name === 'Unassigned');
    if (existing) return existing;
    const topic = Storage.createTopic('Unassigned');
    topic.userCreated = false;
    Storage.saveTopic(topic);
    return topic;
  },

  async _handleTopicDetection(topicData) {
    // One-off questions go to the "Unassigned" topic
    if (topicData.isOneOff) {
      const unassigned = this._getOrCreateUnassignedTopic();
      const chat = Storage.getChat(this.currentChatId);
      if (chat && !chat.topicId) {
        chat.topicId = unassigned.id;
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        StudyLog.event('topic_assigned', { chatId: this.currentChatId, topicId: unassigned.id, assignMethod: 'auto', isOneOff: true });
      }
      this._renderChatList();
      return;
    }

    let topicId = topicData.matchedExistingId;
    let isNew = false;

    if (!topicId && topicData.name) {
      const existing = Storage.getTopics().find(
        t => t.name.toLowerCase() === topicData.name.toLowerCase()
      );
      if (existing) {
        topicId = existing.id;
      } else {
        const topic = Storage.createTopic(topicData.name);
        topicId = topic.id;
        isNew = true;
        StudyLog.event('topic_created', { topicId, isAutoDetected: true });
      }
    }

    if (topicId) {
      const chat = Storage.getChat(this.currentChatId);
      if (chat && !chat.topicId) {
        chat.topicId = topicId;
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        StudyLog.event('topic_assigned', { chatId: this.currentChatId, topicId, assignMethod: 'auto' });
      }

      const topic = Storage.getTopic(topicId);
      if (topic) {
        topic.lastActive = Utils.timestamp();
        Storage.saveTopic(topic);
      }

      if (!this._isUnassignedTopic(topicId)) {
        Sidebar.show(topicId);
      }
      this._renderChatList();
    }
  },

  _handleConcepts(concepts) {
    const chat = Storage.getChat(this.currentChatId);
    if (!chat || !chat.topicId || this._isUnassignedTopic(chat.topicId)) return;

    concepts.forEach(c => {
      const existing = Storage.getConcepts().find(
        ex => ex.title.toLowerCase() === c.title.toLowerCase() && ex.topicId === chat.topicId
      );
      if (existing) {
        if (!existing.chatIds.includes(this.currentChatId)) {
          existing.chatIds.push(this.currentChatId);
          Storage.saveConcept(existing);
        }
      } else {
        const concept = {
          id: 'concept_' + Utils.generateId(),
          topicId: chat.topicId,
          title: c.title,
          preview: c.preview || '',
          chatIds: [this.currentChatId],
        };
        Storage.saveConcept(concept);
        if (!chat.conceptIds.includes(concept.id)) {
          chat.conceptIds.push(concept.id);
          Storage.saveChat(chat);
        }
      }
    });
  },

  // ── Chat Summarization ────────────────────────────────────────────────

  async _summarizeCurrentChat() {
    if (!this.currentChatId || !this.pendingSummarize) return;
    const chat = Storage.getChat(this.currentChatId);
    if (!chat || chat.summarized) return;

    const messages = Storage.getMessages(this.currentChatId);
    if (messages.length < 2) return;

    this.pendingSummarize = false;

    try {
      const resp = await fetch(`${API_BASE}/api/chat/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          model: Storage.getChatModel(),
        }),
      });
      const data = await resp.json();

      chat.title = data.title || chat.title;
      chat.summary = data.summary || '';
      chat.userAsked = data.userAsked || '';
      chat.aiCovered = data.aiCovered || '';
      chat.summarized = true;
      chat.lastActive = Utils.timestamp();
      Storage.saveChat(chat);

      // Generate embedding for the summary
      if (chat.summary) {
        try {
          const embResp = await fetch(`${API_BASE}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chat.summary }),
          });
          const embData = await embResp.json();
          chat.embedding = embData.embedding;
          Storage.saveChat(chat);
        } catch (e) {
          console.warn('Embedding failed:', e);
        }
      }

      this._renderChatList();

      // Auto-detect topics for unassigned chats
      if (!chat.topicId) {
        await this._autoDetectTopics();
      }
    } catch (err) {
      console.warn('Summarization failed:', err);
    }
  },

  async _migrateStructuredSummaries() {
    const chats = Storage.getChats().filter(c => c.summarized && c.summary && !c.userAsked);
    if (chats.length === 0) return;
    console.log(`[Migration] Re-summarizing ${chats.length} legacy chat(s) for structured fields...`);
    for (const chat of chats) {
      try {
        const messages = Storage.getMessages(chat.id);
        if (messages.length < 2) continue;
        const resp = await fetch(`${API_BASE}/api/chat/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            model: Storage.getChatModel(),
          }),
        });
        const data = await resp.json();
        chat.title = data.title || chat.title;
        chat.summary = data.summary || chat.summary;
        chat.userAsked = data.userAsked || '';
        chat.aiCovered = data.aiCovered || '';
        Storage.saveChat(chat);
        console.log(`[Migration] ✅ ${chat.id.slice(0, 12)} "${chat.title?.slice(0, 30)}"`);
      } catch (err) {
        console.warn(`[Migration] ❌ ${chat.id}:`, err);
      }
    }
    console.log('[Migration] Structured summary migration complete.');
    this._renderChatList();
  },

  async _migrateStatusToThreads() {
    const topics = Storage.getTopics().filter(t => {
      if (t.name === 'Unassigned') return false;
      const s = t.statusSummary;
      if (!s || typeof s !== 'object') return false;
      // Has old specifics but no threads yet
      return (s.specifics && s.specifics.length > 0) && (!s.threads || s.threads.length === 0);
    });
    if (topics.length === 0) return;
    console.log(`[Migration] Converting ${topics.length} topic(s) from specifics → threads...`);
    for (const topic of topics) {
      try {
        const summaries = Storage.getAllChatSummariesForTopic(topic.id);
        const resp = await fetch(`${API_BASE}/api/topic/status/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topicName: topic.name,
            currentStatus: Sidebar._serializeStatus(topic.statusSummary),
            recentSummaries: summaries.map(s => s.summary),
            model: Storage.getSidebarModel(),
          }),
        });
        const data = await resp.json();
        if (data.overview || data.threads) {
          topic.statusSummary = { overview: data.overview || [], threads: data.threads || [] };
        }
        topic.statusLastUpdated = Utils.timestamp();
        topic.sidebarCache = null;
        Storage.saveTopic(topic);
        console.log(`[Migration] Threads ✅ "${topic.name}"`);
      } catch (err) {
        console.warn(`[Migration] Threads ❌ "${topic.name}":`, err);
      }
    }
    console.log('[Migration] Status → threads migration complete.');
    if (Sidebar.currentTopicId) {
      const current = Storage.getTopic(Sidebar.currentTopicId);
      if (current) Sidebar._renderStatus(current.statusSummary);
    }
  },

  async _autoDetectTopics() {
    // Include chats from "Unassigned" topic in reclassification
    const unassignedTopic = Storage.getTopics().find(t => t.name === 'Unassigned');
    const unassignedTopicId = unassignedTopic?.id;
    const candidateChats = Storage.getChats().filter(c =>
      c.summary && (!c.topicId || c.topicId === unassignedTopicId)
    );
    if (candidateChats.length < 2) return;

    StudyLog.event('topic_auto_detect_triggered', { candidateCount: candidateChats.length });
    try {
      const resp = await fetch(`${API_BASE}/api/topic/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatSummaries: candidateChats.map(c => ({ id: c.id, summary: c.summary })),
          existingTopics: Storage.getTopics()
            .filter(t => t.name !== 'Unassigned')
            .map(t => ({ id: t.id, name: t.name })),
        }),
      });
      const data = await resp.json();
      let changed = false;

      if (data.newTopics && data.newTopics.length > 0) {
        for (const topicData of data.newTopics) {
          if (!topicData.chatIds || topicData.chatIds.length < 2) continue;
          const topic = Storage.createTopic(topicData.name);
          topic.userCreated = false;
          Storage.saveTopic(topic);

          for (const chatId of topicData.chatIds) {
            const chat = Storage.getChat(chatId);
            if (chat && (!chat.topicId || chat.topicId === unassignedTopicId)) {
              chat.topicId = topic.id;
              Storage.saveChat(chat);
            }
          }
          changed = true;
        }
        Utils.showToast(`Detected new topic${data.newTopics.length > 1 ? 's' : ''}: ${data.newTopics.map(t => t.name).join(', ')}`);
      }

      // Assign to existing topics
      if (data.assignToExisting && data.assignToExisting.length > 0) {
        for (const assignment of data.assignToExisting) {
          if (!assignment.topicId || !assignment.chatIds) continue;
          const topic = Storage.getTopic(assignment.topicId);
          if (!topic) continue;
          for (const chatId of assignment.chatIds) {
            const chat = Storage.getChat(chatId);
            if (chat && (!chat.topicId || chat.topicId === unassignedTopicId)) {
              chat.topicId = assignment.topicId;
              Storage.saveChat(chat);
              changed = true;
            }
          }
        }
      }

      if (changed) this._renderChatList();
    } catch (err) {
      console.warn('Auto-detect topics failed:', err);
    }
  },

  _onInactive() {
    Sidebar._flushDirtyLabels();
    this._summarizeCurrentChat();
  },

  // ── File Attachments ───────────────────────────────────────────────────

  _handleFiles(files) {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        Utils.showToast(`File "${file.name}" is too large (max 20MB)`, 'error');
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        this.pendingAttachments.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: base64,
          previewUrl: file.type.startsWith('image/') ? reader.result : null,
        });
        this._renderAttachments();
      };
      reader.readAsDataURL(file);
    }
  },

  _renderAttachments() {
    const container = document.getElementById('inputAttachments');
    if (this.pendingAttachments.length === 0) {
      container.classList.remove('has-items');
      container.innerHTML = '';
      return;
    }
    container.classList.add('has-items');
    container.innerHTML = '';
    this.pendingAttachments.forEach((att, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'attachment-thumb';
      if (att.previewUrl) {
        thumb.innerHTML = `<img src="${att.previewUrl}" alt="${Utils.escapeHtml(att.name)}">`;
      } else {
        thumb.innerHTML = `<div class="att-name">${Utils.escapeHtml(att.name)}</div>`;
      }
      const removeBtn = document.createElement('button');
      removeBtn.className = 'attachment-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', () => {
        this.pendingAttachments.splice(idx, 1);
        this._renderAttachments();
      });
      thumb.appendChild(removeBtn);
      container.appendChild(thumb);
    });
  },

  // ── Context Block ─────────────────────────────────────────────────────

  setContextBlock(fullText, label) {
    const block = document.getElementById('contextBlock');
    const compact = document.getElementById('contextCompact');
    const fullArea = document.getElementById('contextFullText');
    const fullDiv = document.getElementById('contextFull');

    compact.textContent = `• ${label}: "${Utils.truncate(fullText, 60)}"`;
    fullArea.value = fullText;
    fullDiv.style.display = 'none';
    document.getElementById('contextToggleBtn').textContent = 'Expand';
    block.style.display = 'block';
    const sourceType = fullText.includes('--- Previous chat history ---') ? 'connection' : label === 'Status Summary' ? 'status' : 'direction';
    StudyLog.event('context_block_added', { chatId: this.currentChatId, sourceType });
  },

  clearContextBlock() {
    if (document.getElementById('contextBlock').style.display !== 'none') {
      StudyLog.event('context_block_closed', { chatId: this.currentChatId });
    }
    document.getElementById('contextBlock').style.display = 'none';
    document.getElementById('contextFullText').value = '';
    document.getElementById('contextCompact').textContent = '';
  },

  _toggleContextExpand() {
    const fullDiv = document.getElementById('contextFull');
    const btn = document.getElementById('contextToggleBtn');
    if (fullDiv.style.display === 'none') {
      fullDiv.style.display = 'block';
      btn.textContent = 'Collapse';
      StudyLog.event('context_block_toggled', { expanded: true });
    } else {
      fullDiv.style.display = 'none';
      btn.textContent = 'Expand';
      StudyLog.event('context_block_toggled', { expanded: false });
    }
  },

  // ── Rendering ─────────────────────────────────────────────────────────

  _renderChat(chatId) {
    this.currentChatId = chatId;
    Storage.setCurrentChatId(chatId);
    const chat = Storage.getChat(chatId);
    const messages = Storage.getMessages(chatId);
    const mainContent = document.getElementById('mainContent');

    document.getElementById('chatTitle').textContent = chat?.title || 'New Chat';
    const msgContainer = document.getElementById('chatMessages');
    msgContainer.innerHTML = '';

    const topicSel = document.getElementById('topicSelect');
    const topicPickerEl = document.getElementById('topicPicker');
    if (messages.length === 0) {
      mainContent.classList.add('welcome-mode');
      this._renderWelcome(msgContainer);
      if (topicSel) topicSel.style.display = '';
      if (topicPickerEl) topicPickerEl.style.display = '';
      TopicSuggester.reset();
    } else {
      mainContent.classList.remove('welcome-mode');
      messages.forEach(m => this._appendMessage(m));
      if (topicSel) topicSel.style.display = 'none';
      if (topicPickerEl) topicPickerEl.style.display = 'none';
    }

    if (STUDY_CONDITION === 'baseline') {
      Sidebar.showBaseline();
    } else if (chat?.topicId && !this._isUnassignedTopic(chat.topicId)) {
      Sidebar.show(chat.topicId);
      this.msgCountSinceRefresh = 0;
    } else {
      Sidebar.hide();
    }

    if (!this._isUnassignedTopic(chat?.topicId)) {
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && m.connections?.length > 0);
      if (lastAssistant) {
        Sidebar.showConnections(lastAssistant.connections);
      } else {
        Sidebar.clearConnections();
      }
    }

    this._highlightActiveChat(chatId);
  },

  _renderWelcome(container) {
    const suggestions = this._getSuggestionCards();
    let suggestionsHtml = '';
    if (suggestions.length > 0 && STUDY_CONDITION === 'loom') {
      const cardsHtml = suggestions.map((s, i) => {
        const tc = Utils.getTopicColor(s.topicColorObj);
        return `<div class="welcome-suggestion-card" data-suggestion-idx="${i}">
          <div class="welcome-card-topic" style="color:${tc.color};">
            <span class="topic-color-dot" style="background:${tc.color};"></span>
            ${Utils.escapeHtml(s.topicName)}
          </div>
          <div class="welcome-card-question">${Utils.escapeHtml(s.question)}</div>
        </div>`;
      }).join('');
      const shuffleBtnHtml = `<button class="welcome-shuffle-btn" id="welcomeShuffleBtn" title="Shuffle suggestions">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
          <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
          <line x1="4" y1="4" x2="9" y2="9"/>
        </svg>
        Shuffle
      </button>`;
      suggestionsHtml = `<div class="welcome-suggestions" id="welcomeSuggestions">${cardsHtml}${shuffleBtnHtml}</div>`;
    }

    container.innerHTML = `
      <div class="welcome-greeting">
        <div class="welcome-icon">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 2C12 2 6 8 6 14C6 17.5 8.5 20 12 22C15.5 20 18 17.5 18 14C18 8 12 2 12 2Z" fill="white" opacity="0.9"/>
            <ellipse cx="12" cy="14" rx="2" ry="3" fill="white" opacity="0.5"/>
          </svg>
        </div>
        <h2>Where should we start?</h2>
        <p>Ask anything. Loom will build your knowledge map as you go.</p>
      </div>
      ${suggestionsHtml}`;

    if (suggestions.length > 0 && STUDY_CONDITION === 'loom') {
      this._bindSuggestionCards(suggestions);
      const shuffleBtn = document.getElementById('welcomeShuffleBtn');
      if (shuffleBtn) {
        shuffleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          StudyLog.event('module3_shuffled', { location: 'welcome', topicId: null });
          // Re-render welcome with refreshed suggestions (triggers sidebar.shuffleDirections for each topic)
          shuffleBtn.classList.add('loading');
          const promises = suggestions.map(s => Sidebar.shuffleDirections('welcome', s.topicId));
          Promise.all(promises).then(() => {
            shuffleBtn.classList.remove('loading');
            const msgContainer = document.getElementById('chatMessages');
            this._renderWelcome(msgContainer);
          });
        });
      }
    }
  },

  _getSuggestionCards() {
    const topics = Storage.getTopics()
      .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
      .slice(0, 3);

    const cards = [];
    for (const topic of topics) {
      if (!topic.sidebarCache) continue;
      const dirs = topic.sidebarCache.newDirections || [];
      if (dirs.length === 0) continue;
      cards.push({
        topicId: topic.id,
        topicName: topic.name,
        topicColorObj: topic,
        statusSummary: Sidebar._serializeStatus(topic.statusSummary) || '',
        title: dirs[0].title || '',
        question: dirs[0].question || '',
      });
    }
    // Ensure at least 2 cards by pulling extra directions from existing topics
    if (cards.length < 2) {
      for (const topic of topics) {
        if (cards.length >= 2) break;
        if (!topic.sidebarCache) continue;
        const dirs = topic.sidebarCache.newDirections || [];
        for (let i = 1; i < dirs.length && cards.length < 2; i++) {
          const already = cards.some(c => c.topicId === topic.id && c.question === dirs[i].question);
          if (already) continue;
          cards.push({
            topicId: topic.id,
            topicName: topic.name,
            topicColorObj: topic,
            statusSummary: Sidebar._serializeStatus(topic.statusSummary) || '',
            title: dirs[i].title || '',
            question: dirs[i].question || '',
          });
        }
      }
    }
    return cards;
  },

  _bindSuggestionCards(suggestions) {
    const container = document.getElementById('welcomeSuggestions');
    if (!container) return;
    container.querySelectorAll('.welcome-suggestion-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.suggestionIdx, 10);
        const s = suggestions[idx];
        if (s) {
          StudyLog.event('welcome_suggestion_clicked', { topicId: s.topicId, suggestionIdx: idx });
          this._startSuggestedChat(s);
        }
      });
    });
  },

  _startSuggestedChat(suggestion) {
    const mainContent = document.getElementById('mainContent');
    mainContent.classList.remove('welcome-mode');
    const prev = document.getElementById('welcomeSuggestions');
    if (prev) prev.remove();

    if (!this.currentChatId) {
      const chat = Storage.createChat();
      this.currentChatId = chat.id;
    }

    const chat = Storage.getChat(this.currentChatId);
    if (chat) {
      chat.topicId = suggestion.topicId;
      chat.lastActive = Utils.timestamp();
      Storage.saveChat(chat);
    }

    const topic = Storage.getTopic(suggestion.topicId);
    if (topic) {
      topic.lastActive = Utils.timestamp();
      Storage.saveTopic(topic);
      if (topic.name !== 'Unassigned') {
        Sidebar.show(suggestion.topicId);
      }
    }

    let content = suggestion.question;
    if (suggestion.statusSummary) {
      content = `[My current status in "${suggestion.topicName}": ${suggestion.statusSummary}]\n\n${content}`;
    }

    // Set the input and auto-send
    document.getElementById('chatInput').value = content;
    this.sendMessage();
  },

  _parseUserMessageModules(content) {
    const modules = [];
    let remaining = content || '';

    while (remaining.startsWith('[')) {
      let type, label, body, endIdx;

      if (remaining.startsWith('[My current status in "')) {
        type = 'status';
        const prefix = '[My current status in "';
        const nameEnd = remaining.indexOf('"', prefix.length);
        if (nameEnd === -1) break;
        const topicName = remaining.substring(prefix.length, nameEnd);
        label = `Status: ${topicName}`;
        const bodyStart = nameEnd + '": '.length;
        const closeNewline = remaining.indexOf(']\n\n', bodyStart);
        if (closeNewline !== -1) {
          body = remaining.substring(bodyStart, closeNewline);
          endIdx = closeNewline + 3;
        } else if (remaining.endsWith(']')) {
          body = remaining.substring(bodyStart, remaining.length - 1);
          endIdx = remaining.length;
        } else {
          break;
        }
      } else if (remaining.startsWith('[The user is building on a previous conversation')) {
        type = 'linked_chat';
        const connPrefix = 'Connection to "';
        const connIdx = remaining.indexOf(connPrefix);
        if (connIdx !== -1) {
          const connNameEnd = remaining.indexOf('"', connIdx + connPrefix.length);
          label = connNameEnd !== -1
            ? `Previous conversation: ${remaining.substring(connIdx + connPrefix.length, connNameEnd)}`
            : 'Previous conversation';
        } else {
          label = 'Previous conversation';
        }
        const endMarker = '--- End of previous chat ---]';
        const markerIdx = remaining.indexOf(endMarker);
        if (markerIdx !== -1) {
          body = remaining.substring(1, markerIdx + endMarker.length - 1);
          endIdx = markerIdx + endMarker.length;
        } else {
          const closeNewline = remaining.indexOf(']\n\n');
          if (closeNewline !== -1) {
            body = remaining.substring(1, closeNewline);
            endIdx = closeNewline + 3;
          } else if (remaining.endsWith(']')) {
            body = remaining.substring(1, remaining.length - 1);
            endIdx = remaining.length;
          } else {
            break;
          }
        }
        if (remaining[endIdx] === '\n') endIdx++;
        if (remaining[endIdx] === '\n') endIdx++;
      } else if (remaining.startsWith('[Context from my knowledge map:')) {
        type = 'knowledge_context';
        label = 'Knowledge context';
        const bodyStart = '[Context from my knowledge map: '.length;
        const closeNewline = remaining.indexOf(']\n\n', bodyStart);
        if (closeNewline !== -1) {
          body = remaining.substring(bodyStart, closeNewline);
          endIdx = closeNewline + 3;
        } else if (remaining.endsWith(']')) {
          body = remaining.substring(bodyStart, remaining.length - 1);
          endIdx = remaining.length;
        } else {
          break;
        }
      } else {
        break;
      }

      modules.push({ type, label, body });
      remaining = remaining.substring(endIdx);
    }

    return { modules, userQuery: remaining.trim() };
  },

  _renderContextBar(modules) {
    const statusSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const linkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

    const tags = modules.map((mod, i) => {
      const isStatus = mod.type === 'status';
      const icon = isStatus ? statusSvg : linkSvg;
      const typeClass = isStatus ? 'ctx-status' : 'ctx-linked';
      return `<span class="ctx-tag ${typeClass}" data-ctx-idx="${i}">${icon} ${Utils.escapeHtml(mod.label)}</span>`;
    }).join('<span class="ctx-dot">&middot;</span>');

    return `<div class="message-context-bar">${tags}</div><div class="ctx-detail-panel"></div>`;
  },

  _appendMessage(msg) {
    const container = document.getElementById('chatMessages');

    const el = document.createElement('div');
    el.className = `message ${msg.role}`;

    let contextBarHtml = '';
    let displayContent = msg.content;
    let visibleModules = [];

    if (msg.role === 'user') {
      const { modules, userQuery } = this._parseUserMessageModules(msg.content);
      visibleModules = modules.filter(m => m.type !== 'knowledge_context');
      if (visibleModules.length > 0) {
        contextBarHtml = this._renderContextBar(visibleModules);
      }
      displayContent = userQuery || msg.content;
    }

    let attachHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      const thumbs = msg.attachments.map(att => {
        if (att.mimeType && att.mimeType.startsWith('image/') && att.data) {
          return `<img src="data:${att.mimeType};base64,${att.data}" style="max-width:200px;max-height:200px;border-radius:8px;margin:4px 0;">`;
        }
        return `<div style="font-size:11px;color:var(--text-muted);">📎 ${Utils.escapeHtml(att.name || 'file')}</div>`;
      }).join('');
      attachHtml = `<div class="message-attachments">${thumbs}</div>`;
    }

    let renderedContent;
    let isChunked = false;
    if (msg.role === 'assistant') {
      const hasConns = msg.connections && msg.connections.length > 0 && msg.rawContent;
      const rawText = hasConns ? msg.rawContent : msg.content;
      const { html: chunkedHtml, chunked } = this._renderChunkedContent(rawText, msg.id || '', msg.chunkLabels);
      if (chunked) {
        isChunked = true;
        renderedContent = chunkedHtml;
      } else if (hasConns) {
        renderedContent = this._parseConnectionMarkers(Utils.renderMarkdown(msg.rawContent));
      } else {
        renderedContent = Utils.renderMarkdown(msg.content);
      }
    } else {
      renderedContent = Utils.escapeHtml(displayContent);
    }

    if (contextBarHtml) {
      el.innerHTML = `${attachHtml}<div class="message-bubble-group">${contextBarHtml}<div class="message-content">${renderedContent}</div></div>`;
    } else {
      el.innerHTML = `${attachHtml}<div class="message-content">${renderedContent}</div>`;
    }
    container.appendChild(el);

    if (visibleModules.length > 0) {
      el.querySelectorAll('.ctx-tag').forEach(tag => {
        tag.addEventListener('click', () => {
          const idx = parseInt(tag.dataset.ctxIdx);
          const mod = visibleModules[idx];
          StudyLog.event('context_tag_clicked', { type: mod?.type || '' });
          const panel = el.querySelector('.ctx-detail-panel');
          if (panel.classList.contains('visible') && panel.dataset.activeIdx === String(idx)) {
            panel.classList.remove('visible');
            tag.classList.remove('active');
          } else {
            el.querySelectorAll('.ctx-tag').forEach(t => t.classList.remove('active'));
            panel.textContent = visibleModules[idx].body;
            panel.dataset.activeIdx = String(idx);
            panel.classList.add('visible');
            tag.classList.add('active');
          }
        });
      });
    }

    if (msg.role === 'assistant' && msg.connections && msg.connections.length > 0) {
      const contentEl = el.querySelector('.message-content');
      this._resolveConnectionMarkers(contentEl, msg.connections);
    }

    if (isChunked) {
      const contentEl = el.querySelector('.message-content');
      this._bindChunkLabelHandlers(contentEl);
    }

    container.scrollTop = container.scrollHeight;
  },

  _appendSystemMessage(text) {
    const container = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `<div class="message-content" style="color:var(--danger);">${Utils.escapeHtml(text)}</div>`;
    container.appendChild(el);
  },

  _showTyping() {
    const container = document.getElementById('chatMessages');
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.id = 'typingMessage';
    el.innerHTML = `<div class="message-content"><div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  },

  _hideTyping() {
    const el = document.getElementById('typingMessage');
    if (el) el.remove();
  },

  _renderChatList(view) {
    if (!view) {
      view = document.querySelector('.toggle-btn.active')?.dataset?.view || 'recent';
    }
    this._populateTopicSelector();
    const container = document.getElementById('chatList');
    const chats = Storage.getChats();
    container.innerHTML = '';

    if (view === 'recent') {
      const sorted = [...chats].sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      let currentGroup = null;
      sorted.forEach(chat => {
        const d = new Date(chat.lastActive);
        let group;
        if (d >= todayStart) group = 'Today';
        else if (d >= weekStart) group = 'This week';
        else if (d >= monthStart) group = 'This month';
        else group = 'Older';

        if (group !== currentGroup) {
          currentGroup = group;
          const label = document.createElement('div');
          label.className = 'chat-list-time-label';
          label.textContent = group;
          container.appendChild(label);
        }
        container.appendChild(this._createChatItem(chat));
      });
    } else {
      // Group by topic: show real topics first, "Unassigned" at the end
      const allTopics = Storage.getTopics().sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
      const realTopics = allTopics.filter(t => t.name !== 'Unassigned');
      const unassignedTopic = allTopics.find(t => t.name === 'Unassigned');
      const noTopicChats = chats.filter(c => !c.topicId);

      realTopics.forEach(topic => {
        const topicChats = chats.filter(c => c.topicId === topic.id)
          .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
        if (topicChats.length === 0) return;

        const title = document.createElement('div');
        title.className = 'chat-list-group-title';
        title.dataset.topicId = topic.id;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = topic.name;
        title.appendChild(nameSpan);

        nameSpan.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this._startTopicRename(nameSpan, topic.id);
        });

        if (realTopics.length > 1) {
          title.draggable = true;
          title.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/topic-id', topic.id);
            e.dataTransfer.effectAllowed = 'move';
            title.classList.add('topic-dragging');
          });
          title.addEventListener('dragend', () => title.classList.remove('topic-dragging'));
          title.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('text/topic-id')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              title.classList.add('topic-drop-target');
            }
          });
          title.addEventListener('dragleave', () => title.classList.remove('topic-drop-target'));
          title.addEventListener('drop', (e) => {
            e.preventDefault();
            title.classList.remove('topic-drop-target');
            const draggedTopicId = e.dataTransfer.getData('text/topic-id');
            if (draggedTopicId && draggedTopicId !== topic.id) {
              StudyLog.event('topic_merge_drag', { sourceTopicId: draggedTopicId, targetTopicId: topic.id });
              this._mergeTopics(draggedTopicId, topic.id);
            }
          });

          const mergeBtn = document.createElement('button');
          mergeBtn.className = 'topic-merge-btn';
          mergeBtn.title = 'Merge with another topic';
          mergeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
          mergeBtn.draggable = false;
          mergeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            StudyLog.event('topic_merge_dialog_opened', { topicId: topic.id });
            this._openMergeDialog(topic.id);
          });
          title.appendChild(mergeBtn);
        }
        container.appendChild(title);
        topicChats.forEach(chat => container.appendChild(this._createChatItem(chat)));
      });

      // Combine "Unassigned" topic chats + truly unassigned (no topicId) under one label
      const unassignedChats = [
        ...(unassignedTopic ? chats.filter(c => c.topicId === unassignedTopic.id) : []),
        ...noTopicChats,
      ].sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));

      if (unassignedChats.length > 0) {
        const title = document.createElement('div');
        title.className = 'chat-list-group-title unassigned-group';
        title.textContent = 'Unassigned';
        container.appendChild(title);
        unassignedChats.forEach(chat => container.appendChild(this._createChatItem(chat)));
      }
    }
  },

  _createChatItem(chat) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (chat.id === this.currentChatId ? ' active' : '');

    const topic = chat.topicId ? Storage.getTopic(chat.topicId) : null;
    const tc = (topic && topic.name !== 'Unassigned') ? Utils.getTopicColor(topic) : { color: '#ccc' };

    const moveBtn = STUDY_CONDITION === 'loom'
      ? `<button class="chat-move-btn" title="Move to topic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          </svg>
        </button>`
      : '';

    const unassignBtn = chat.topicId && STUDY_CONDITION === 'loom'
      ? `<button class="chat-unassign-btn" title="Remove from topic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
          </svg>
        </button>`
      : '';

    el.innerHTML = `
      <span class="topic-dot" style="background:${tc.color}"></span>
      <div class="chat-item-info">
        <div class="chat-item-title">${Utils.escapeHtml(chat.title)}</div>
        ${chat.summary ? `<div class="chat-item-summary">${Utils.escapeHtml(Utils.truncate(chat.summary, 50))}</div>` : ''}
      </div>
      <div class="chat-item-actions">
        ${moveBtn}
        ${unassignBtn}
        <button class="chat-delete-btn" title="Delete chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    `;

    const moveBtnEl = el.querySelector('.chat-move-btn');
    if (moveBtnEl) {
      moveBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showMoveDropdown(moveBtnEl, chat.id, chat.topicId);
      });
    }

    const unassignEl = el.querySelector('.chat-unassign-btn');
    if (unassignEl) {
      unassignEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this._unassignChat(chat.id, chat.topicId);
      });
    }

    const deleteBtn = el.querySelector('.chat-delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteChat(chat.id, chat.topicId);
    });

    el.addEventListener('click', () => {
      const currentView = document.querySelector('.toggle-btn.active')?.dataset?.view || 'recent';
      StudyLog.event('chat_selected', { chatId: chat.id, topicId: chat.topicId || null, view: currentView });
      Sidebar._flushDirtyLabels();
      this._summarizeCurrentChat();
      this.msgCountSinceRefresh = 0;
      this._renderChat(chat.id);
      this._renderChatList();
    });
    return el;
  },

  _unassignChat(chatId, topicId) {
    const chat = Storage.getChat(chatId);
    if (!chat) return;
    chat.topicId = null;
    Storage.saveChat(chat);

    if (topicId) {
      const remaining = Storage.getChatsByTopic(topicId);
      if (remaining.length === 0) {
        Storage.deleteTopic(topicId);
      }
    }

    if (chatId === this.currentChatId) {
      Sidebar.hide();
    }

    this._renderChatList();
    StudyLog.event('chat_unassigned', { chatId, topicId });
    Utils.showToast('Chat removed from topic', 'info');
  },

  _showMoveDropdown(anchorEl, chatId, currentTopicId) {
    const chat = Storage.getChat(chatId);
    if (!chat) return;

    const topics = Storage.getTopics().filter(t =>
      t.id !== currentTopicId && t.name !== 'Unassigned'
    );
    if (topics.length === 0) {
      Utils.showToast('No other topics to move to', 'info');
      return;
    }

    this._moveChatId = chatId;
    this._moveChatOldTopicId = currentTopicId;

    const popover = document.getElementById('moveChatPopover');
    popover.innerHTML = '<div class="move-chat-popover-label">Move to topic</div>';
    topics.forEach(t => {
      const tc = Utils.getTopicColor(t);
      const chip = document.createElement('div');
      chip.className = 'move-topic-chip';
      chip.innerHTML = `<span class="move-topic-chip-dot" style="background:${tc.color}"></span><span class="move-topic-chip-name">${Utils.escapeHtml(t.name)}</span>`;
      chip.addEventListener('click', () => {
        popover.style.display = 'none';
        this._moveChat(chatId, t.id, currentTopicId);
      });
      popover.appendChild(chip);
    });

    const rect = anchorEl.getBoundingClientRect();
    popover.style.display = 'block';
    popover.style.left = Math.min(rect.left, window.innerWidth - 250) + 'px';
    popover.style.top = (rect.bottom + 4) + 'px';

    const closeOnOutside = (e) => {
      if (!popover.contains(e.target) && e.target !== anchorEl) {
        popover.style.display = 'none';
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
  },

  _moveChat(chatId, newTopicId, oldTopicId) {
    const chat = Storage.getChat(chatId);
    if (!chat) return;
    const oldId = oldTopicId || chat.topicId;
    chat.topicId = newTopicId;
    chat.lastActive = Utils.timestamp();
    Storage.saveChat(chat);

    const newTopic = Storage.getTopic(newTopicId);
    if (newTopic) {
      newTopic.lastActive = Utils.timestamp();
      Storage.saveTopic(newTopic);
    }

    if (oldId) {
      const remaining = Storage.getChatsByTopic(oldId);
      if (remaining.length === 0) {
        Storage.deleteTopic(oldId);
      }
    }

    if (chatId === this.currentChatId && newTopic && newTopic.name !== 'Unassigned') {
      Sidebar.show(newTopicId);
    }

    this._renderChatList();
    this._populateTopicSelector();
    const topicName = newTopic ? newTopic.name : 'topic';
    StudyLog.event('chat_moved', { chatId, oldTopicId: oldId, newTopicId });
    Utils.showToast(`Moved to "${topicName}"`, 'success');
  },

  _deleteChat(chatId, topicId) {
    StudyLog.event('chat_deleted', { chatId, topicId });
    Storage.deleteChat(chatId);

    if (topicId) {
      const remaining = Storage.getChatsByTopic(topicId);
      if (remaining.length === 0) {
        Storage.deleteTopic(topicId);
      }
    }

    if (chatId === this.currentChatId) {
      const chats = Storage.getChats();
      if (chats.length > 0) {
        const sorted = [...chats].sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
        this._renderChat(sorted[0].id);
      } else {
        this.currentChatId = null;
        Storage.setCurrentChatId(null);
        this.newChat();
      }
    }

    this._renderChatList();
  },

  _highlightActiveChat(chatId) {
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    // Re-highlight happens on re-render
  },

  // ── Rename Topic ──────────────────────────────────────────────────────

  _startTopicRename(spanEl, topicId) {
    const topic = Storage.getTopic(topicId);
    if (!topic) return;
    const original = topic.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'topic-rename-input';
    input.value = original;
    spanEl.replaceWith(input);
    input.focus();
    input.select();
    const save = () => {
      const val = input.value.trim();
      if (val && val !== original) {
        this._renameTopic(topicId, val, original);
      } else {
        this._renderChatList();
      }
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = original; input.blur(); }
    });
  },

  async _renameTopic(topicId, newName, oldName) {
    const topic = Storage.getTopic(topicId);
    if (!topic) return;
    topic.name = newName;
    topic.lastActive = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderChatList();
    this._populateTopicSelector();
    if (Sidebar.currentTopicId === topicId) {
      document.getElementById('statusTopicName').textContent = newName;
      const badge = document.getElementById('topicBadge');
      if (badge) badge.textContent = newName;
    }
    StudyLog.event('topic_renamed', { topicId });
    Utils.showToast(`Renamed to "${newName}"`, 'success');

    // Check if overview needs adjusting for the name change
    const overview = topic.statusSummary?.overview;
    if (overview && overview.length > 0) {
      try {
        const resp = await fetch(`${API_BASE}/api/topic/rename-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldName,
            newName,
            overview,
            model: Storage.getSidebarModel(),
          }),
        });
        const data = await resp.json();
        if (data.needsUpdate && data.overview) {
          const freshTopic = Storage.getTopic(topicId);
          if (freshTopic && freshTopic.statusSummary) {
            freshTopic.statusSummary.overview = data.overview;
            freshTopic.statusLastUpdated = Utils.timestamp();
            if (freshTopic.sidebarCache?.statusUpdate) {
              freshTopic.sidebarCache.statusUpdate.overview = data.overview;
            }
            Storage.saveTopic(freshTopic);
            if (Sidebar.currentTopicId === topicId) {
              Sidebar._renderStatus(freshTopic.statusSummary);
            }
          }
        }
      } catch (e) {
        console.warn('Topic rename overview check failed:', e);
      }
    }
  },

  // ── Merge Topics (from left sidebar) ─────────────────────────────────

  _openMergeDialog(topicId) {
    const currentTopic = Storage.getTopic(topicId);
    if (!currentTopic) return;

    const otherTopics = Storage.getTopics().filter(t => t.id !== topicId);
    if (otherTopics.length === 0) {
      Utils.showToast('No other topics to merge with', 'info');
      return;
    }

    this._mergeSourceTopicId = topicId;
    document.getElementById('mergeCurrentTopic').textContent = currentTopic.name;
    const select = document.getElementById('mergeTargetSelect');
    select.innerHTML = '';
    otherTopics.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      select.appendChild(opt);
    });
    document.getElementById('mergeTopicDialog').style.display = 'flex';
  },

  async _mergeTopics(absorbedTopicId, keepTopicId) {
    const keepTopic = Storage.getTopic(keepTopicId);
    const absorbTopic = Storage.getTopic(absorbedTopicId);
    if (!keepTopic || !absorbTopic) return;

    const chatsToMove = Storage.getChatsByTopic(absorbedTopicId);
    chatsToMove.forEach(chat => {
      chat.topicId = keepTopicId;
      Storage.saveChat(chat);
    });
    const conceptsToMove = Storage.getConceptsByTopic(absorbedTopicId);
    conceptsToMove.forEach(c => {
      c.topicId = keepTopicId;
      Storage.saveConcept(c);
    });
    Storage.deleteTopic(absorbedTopicId);

    try {
      const summaries = Storage.getAllChatSummariesForTopic(keepTopicId);
      const resp = await fetch('/api/topic/status/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName: keepTopic.name,
          currentStatus: keepTopic.statusSummary || '',
          recentSummaries: summaries.map(s => s.summary),
          model: Storage.getSidebarModel(),
        }),
      });
      const data = await resp.json();
      if (data.overview || data.threads) {
        keepTopic.statusSummary = { overview: data.overview || [], threads: data.threads || [] };
      } else {
        keepTopic.statusSummary = data.status || keepTopic.statusSummary;
      }
      keepTopic.statusLastUpdated = Utils.timestamp();
      keepTopic.sidebarCache = null;
      Storage.saveTopic(keepTopic);
    } catch (err) {
      console.warn('Post-merge status update failed:', err);
    }

    if (!this._isUnassignedTopic(keepTopicId)) {
      Sidebar.show(keepTopicId);
      Sidebar.refresh();
    }
    this._renderChatList();
    this._populateTopicSelector();
    Utils.showToast(`Merged "${absorbTopic.name}" into "${keepTopic.name}"`, 'success');
  },

  // ── Dialogs ───────────────────────────────────────────────────────────

  _showTopicDialog() {
    document.getElementById('newTopicDialog').style.display = 'flex';
    document.getElementById('topicNameInput').value = '';
    document.getElementById('topicDescInput').value = '';
    document.getElementById('topicNameInput').focus();
  },

  _hideTopicDialog() {
    document.getElementById('newTopicDialog').style.display = 'none';
  },

  _createTopic() {
    const name = document.getElementById('topicNameInput').value.trim();
    if (!name) return;
    const desc = document.getElementById('topicDescInput').value.trim();
    const topic = Storage.createTopic(name, desc);
    StudyLog.event('topic_created', { topicId: topic.id, isAutoDetected: false });
    this._hideTopicDialog();
    this._renderChatList();
  },

  // ── Baseline Personal Details ──────────────────────────────────────────

  async _extractBaselineDetails() {
    if (STUDY_CONDITION !== 'baseline') return;
    const messages = Storage.getMessages(this.currentChatId);
    if (messages.length < 2) return;

    try {
      const resp = await fetch(`${API_BASE}/api/baseline/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          existingDetails: Storage.getPersonalDetails(),
          model: Storage.getChatModel(),
        }),
      });
      const data = await resp.json();
      if (data.details && Array.isArray(data.details)) {
        Storage.setPersonalDetails(data.details);
        this._renderBaselineDetails(data.details);
        Sidebar.showBaseline();
        StudyLog.event('baseline_details_shown', { count: data.details.length });
      }
    } catch (err) {
      console.warn('Baseline extraction failed:', err);
    }
  },

  _renderBaselineDetails(details) {
    const container = document.getElementById('baselineDetailsContent');
    if (!container) return;
    if (!details || details.length === 0) {
      container.innerHTML = '<p class="baseline-details-empty">Start chatting and I\'ll learn about you.</p>';
      return;
    }
    const items = details.map(d => `<li>${Utils.escapeHtml(d)}</li>`).join('');
    container.innerHTML = `<ul class="baseline-details-list">${items}</ul>`;
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
