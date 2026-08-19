/* ChatWeave main application controller */

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
      if (Array.isArray(s.overview)) {
        parts.push(...s.overview.map(it => (typeof it === 'string' ? it : (it && it.text) || '')));
      }
      if (Array.isArray(s.goals)) {
        parts.push(...s.goals.map(g => (typeof g === 'string' ? g : (g && (g.text || g.title)) || '')));
      }
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
    const topics = Storage.getTopics().filter(t => !App._isOneTimeTopic(t.id));
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
    const topics = Storage.getTopics().filter(t => !App._isOneTimeTopic(t.id));
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

    const topics = Storage.getTopics().filter(t => !App._isOneTimeTopic(t.id));
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

    const topics = Storage.getTopics().filter(t => !App._isOneTimeTopic(t.id));
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
    document.getElementById('userCondition').textContent = STUDY_CONDITION === 'baseline' ? 'Baseline' : 'ChatWeave';

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
    this._bindAnnotationHandlers();
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
    document.getElementById('oneTimeChatBtn').addEventListener('click', () => this.newOneTimeChat());
    document.getElementById('newTopicBtn').addEventListener('click', () => this._showTopicDialog());
    document.getElementById('topicCancelBtn').addEventListener('click', () => this._hideTopicDialog());
    document.getElementById('topicCreateBtn').addEventListener('click', () => this._createTopic());

    // View toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderChatList(btn.dataset.view);
      });
    });

    // Drag-and-drop files on entire middle panel
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
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this._handleFiles(e.dataTransfer.files);
      }
    };
    mainContent.addEventListener('dragover', _handleDragOver);
    mainContent.addEventListener('dragleave', _handleDragLeave);
    mainContent.addEventListener('drop', _handleDrop);

    // File attachment
    document.getElementById('attachBtn').addEventListener('click', () => {
      document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', (e) => {
      this._handleFiles(e.target.files);
      e.target.value = '';
    });

    // Google Search grounding toggle (hidden in probe mode; search always enabled)
    const searchBtn = document.getElementById('searchToggleBtn');
    if (searchBtn) {
      searchBtn.classList.add('active');
      searchBtn.title = 'Google Search ON';
      searchBtn.addEventListener('click', () => {
        this.useSearch = !this.useSearch;
        searchBtn.classList.toggle('active', this.useSearch);
        searchBtn.title = this.useSearch ? 'Google Search ON' : 'Google Search grounding';
      });
    }

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

    // Model selector
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
    const topics = Storage.getTopics().filter(t => !this._isOneTimeTopic(t.id));
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
    const prevChatId = this.currentChatId;
    this._onExitChat(prevChatId);
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

  newOneTimeChat() {
    const prevChatId = this.currentChatId;
    this._onExitChat(prevChatId);
    try { Sidebar._flushDirtyLabels(); } catch (e) { console.warn('flushDirtyLabels failed:', e); }
    try { this._summarizeCurrentChat(); } catch (e) { console.warn('summarizeCurrentChat failed:', e); }
    const bucket = this._getOrCreateOneTimeTopic();
    const chat = Storage.createChat({ oneTime: true });
    chat.topicId = bucket.id;
    chat.oneTime = true;
    Storage.saveChat(chat);
    bucket.lastActive = Utils.timestamp();
    Storage.saveTopic(bucket);
    this.currentChatId = chat.id;
    this.msgCountSinceRefresh = 0;
    this.pendingSummarize = false;
    this.selectedTopicId = null;
    const topicSel = document.getElementById('topicSelect');
    if (topicSel) topicSel.value = '';
    this._updateTopicPickerDisplay(null);
    TopicSuggester.reset();
    TopicSuggester._suggestionDismissed = true;
    this.useSearch = true;
    const searchBtn = document.getElementById('searchToggleBtn');
    if (searchBtn) {
      searchBtn.classList.add('active');
      searchBtn.title = 'Google Search ON';
    }
    Sidebar.hide();
    try { this._renderChat(chat.id); } catch (e) { console.warn('renderChat failed:', e); }
    TopicSuggester._suggestionDismissed = true;
    try { this._renderChatList(); } catch (e) { console.warn('renderChatList failed:', e); }
    document.getElementById('chatInput').focus();
    StudyLog.event('chat_created', { chatId: chat.id });
    StudyLog.event('one_time_chat_started', { chatId: chat.id, source: 'button' });
  },

  _onExitChat(prevChatId) {
    const chat = Storage.getChat(prevChatId);
    const canRefresh = STUDY_CONDITION === 'loom' && chat && chat.topicId
      && !this._isOneTimeTopic(chat.topicId);
    if (canRefresh && (this.msgCountSinceRefresh > 0 || Sidebar._labelsDirty)) {
      Sidebar.currentTopicId = chat.topicId;
      Sidebar.refresh('chat_exit');
    }
    this.msgCountSinceRefresh = 0;
  },

  async sendMessage() {
    const input = document.getElementById('chatInput');
    let content = input.value.trim();

    if (!content && this.pendingAttachments.length === 0) return;
    if (!content && this.pendingAttachments.length > 0) {
      content = 'Please describe or analyze the attached file(s).';
    }

    const savedInput = input.value;

    if (!this.currentChatId) {
      const chat = Storage.createChat();
      this.currentChatId = chat.id;
    }
    const sendChatId = this.currentChatId;
    const sendSelectedTopicId = this.selectedTopicId;
    const sendUseSearch = this.useSearch;
    const sendChatModel = Storage.getChatModel();

    // Pre-assign topic and inject status as context if a topic is selected
    if (sendSelectedTopicId) {
      const chat = Storage.getChat(sendChatId);
      const msgs = Storage.getMessages(sendChatId);
      if (chat && !chat.topicId && msgs.length === 0) {
        chat.topicId = sendSelectedTopicId;
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        StudyLog.event('topic_assigned', { chatId: sendChatId, topicId: sendSelectedTopicId, assignMethod: 'manual' });
        const topic = Storage.getTopic(sendSelectedTopicId);
        if (topic) {
          topic.lastActive = Utils.timestamp();
          Storage.saveTopic(topic);
          if (!this._isOneTimeTopic(topic.id)) {
            if (topic.statusSummary) {
              const statusStr = Sidebar._serializeStatus(topic.statusSummary);
              content = `[My current status in "${topic.name}": ${statusStr}]\n\n${content}`;
            }
            Sidebar.show(sendSelectedTopicId);
          }
        }
      }
    }

    // Add user message (attachments stored without base64 data to avoid localStorage quota issues)
    const userMsg = {
      id: 'msg_' + Utils.generateId(),
      chatId: sendChatId,
      role: 'user',
      content: content,
      contextBlock: null,
      contextMeta: null,
      attachments: this.pendingAttachments.length > 0
        ? this.pendingAttachments.map(a => ({ name: a.name, mimeType: a.mimeType }))
        : null,
      timestamp: Utils.timestamp(),
    };
    const saved = Storage.addMessage(sendChatId, userMsg);
    if (!saved) {
      Utils.showToast('Storage full — could not save message. Try clearing old chats.', 'error');
      input.value = savedInput;
      return;
    }

    input.value = '';
    input.style.height = 'auto';

    this._appendMessage(userMsg);
    this.pendingSummarize = true;
    const currentChat = Storage.getChat(sendChatId);
    StudyLog.event('query_sent', {
      chatId: sendChatId,
      topicId: currentChat?.topicId || sendSelectedTopicId || null,
      hasContext: false,
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

    // Capture attachment data for API before clearing pending
    let apiAttachments = null;
    if (this.pendingAttachments.length > 0) {
      apiAttachments = this.pendingAttachments.map(a => ({
        mimeType: a.mimeType, data: a.data,
      }));
      this.pendingAttachments = [];
      this._renderAttachments();
    }

    this._dismissPendingHighlights('batch');

    const messages = Storage.getMessages(sendChatId).map(m => ({
      role: m.role, content: m.content,
    }));
    const topics = Storage.getTopics()
      .filter(t => !this._isOneTimeTopic(t.id))
      .map(t => ({ id: t.id, name: t.name }));

    // Two-stage classification: classify BEFORE the reply so topic context shapes it.
    const chatPre = Storage.getChat(sendChatId);
    if (STUDY_CONDITION === 'loom' && chatPre && !chatPre.topicId && !chatPre.oneTime
        && !sendSelectedTopicId) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        const t0 = performance.now();
        try {
          const resp = await fetch(`${API_BASE}/api/topic/classify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: firstUserMsg.content.slice(0, 2000),
              existingTopics: topics,
            }),
          });
          const cls = await resp.json();
          StudyLog.event('topic_classified_first', {
            chatId: sendChatId,
            topicId: cls.topicId || null,
            newTopicName: cls.newTopicName || null,
            isOneOff: !!cls.isOneOff,
            parsePath: cls.parsePath || 'fallback_none',
            latencyMs: Math.round(performance.now() - t0),
            source: 'pre_reply',
          });
          if (cls.isOneOff || cls.topicId || cls.newTopicName) {
            await this._assignTopicToChat(sendChatId, {
              ...cls,
              assignMethod: 'pre_reply_classify',
            });
          }
        } catch (e) {
          console.warn('Pre-reply classification failed (continuing without topic):', e);
          StudyLog.event('topic_classified_first', {
            chatId: sendChatId,
            topicId: null,
            newTopicName: null,
            isOneOff: false,
            parsePath: 'fallback_none',
            latencyMs: Math.round(performance.now() - t0),
            source: 'pre_reply',
          });
        }
      }
    }

    // Only send same-topic past chats for connections in ChatWeave mode
    let sameTopicSummaries = [];
    const currentChat2 = Storage.getChat(sendChatId);
    if (STUDY_CONDITION === 'loom') {
      const currentTopicId = currentChat2?.topicId || sendSelectedTopicId;
      sameTopicSummaries = currentTopicId && !this._isOneTimeTopic(currentTopicId)
        ? Storage.getChats()
          .filter(c => c.id !== sendChatId && c.summary && c.topicId === currentTopicId)
          .map(c => ({
            id: c.id, title: c.title, summary: c.summary,
            userAsked: c.userAsked || '', aiCovered: c.aiCovered || '',
            embedding: c.embedding, topicId: c.topicId,
          }))
        : [];
      // Exclude contested (topic-level) past chats
      const chatTopic = currentChat2?.topicId ? Storage.getTopic(currentChat2.topicId) : null;
      const excluded = new Set((chatTopic && chatTopic.excludedChatIds) || []);
      if (excluded.size > 0) {
        sameTopicSummaries = sameTopicSummaries.filter(s => !excluded.has(s.id));
      }
    }

    const currentTopicId = currentChat2?.topicId || sendSelectedTopicId;
    const currentTopic = currentTopicId ? Storage.getTopic(currentTopicId) : null;
    const chatTopicId = currentChat2?.topicId || null;
    const reqBody = {
      chatId: sendChatId,
      messages,
      existingTopics: STUDY_CONDITION === 'loom' ? topics : [],
      existingConcepts: [],
      model: sendChatModel,
      useSearch: sendUseSearch,
      allChatSummaries: sameTopicSummaries,
      condition: STUDY_CONDITION,
      personalDetails: STUDY_CONDITION === 'baseline' ? Storage.getPersonalDetails() : [],
      topicStatus: (currentTopic && STUDY_CONDITION === 'loom' && !this._isOneTimeTopic(currentTopic.id))
        ? Sidebar._serializeStatus(currentTopic.statusSummary)
        : '',
    };
    if (apiAttachments) {
      reqBody.attachments = apiAttachments;
    }
    if (reqBody.topicStatus) {
      const overview = (currentTopic.statusSummary && currentTopic.statusSummary.overview) || [];
      const goals = (currentTopic.statusSummary && currentTopic.statusSummary.goals) || [];
      StudyLog.event('construct_included_in_chat', {
        topicId: currentTopic.id,
        nOverview: overview.length,
        nGoals: goals.length,
        surface: 'chat',
      });
    }

    // Create a live assistant message element for streaming
    const assistantEl = this._createStreamingMessage(sendChatId);
    const ensureAssistantVisible = () => {
      if (this.currentChatId !== sendChatId || assistantEl.isConnected) return;
      document.getElementById('chatMessages')?.appendChild(assistantEl);
    };

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
            ensureAssistantVisible();
            fullResponse += evt.text;
            this._updateStreamingMessage(assistantEl, fullResponse);
          } else if (evt.type === 'done') {
            ensureAssistantVisible();
            fullResponse = evt.response || fullResponse;

            const assistantMsgId = 'msg_' + Utils.generateId();
            const finalHighlightData = this._finalizeStreamingMessage(assistantEl, fullResponse, assistantMsgId);

            const { mainText: strippedMain } = this._stripConnectionBlock(this._stripSearchArtifacts(fullResponse));
            const { cleanText, highlights } = this._extractHighlights(strippedMain);
            const assistantMsg = {
              id: assistantMsgId,
              chatId: sendChatId,
              role: 'assistant',
              content: this._stripConnectionResidue(cleanText),
              rawContent: this._stripConnectionResidue(cleanText),
              suggestedHighlights: finalHighlightData?.highlights || highlights,
              injectedPastChats: evt.injectedPastChats || null,
              contextBlock: null,
              timestamp: Utils.timestamp(),
            };
            Storage.addMessage(sendChatId, assistantMsg);
            if (assistantMsg.suggestedHighlights.length > 0) {
              StudyLog.event('label_highlight_shown', {
                msgId: assistantMsgId,
                count: assistantMsg.suggestedHighlights.length,
                origin: 'ai-suggested',
              });
            }

            // Render injected past context panel above assistant response
            if (this.currentChatId === sendChatId
                && evt.injectedPastChats && evt.injectedPastChats.length > 0) {
              this._renderInjectedPastPanel(assistantEl, evt.injectedPastChats);
            }

            if (STUDY_CONDITION === 'loom') {
              if (evt.topic && evt.topic.confidence > 0.35) {
                await this._handleTopicDetection(evt.topic, sendChatId);
              }
            }
          } else if (evt.type === 'error') {
            ensureAssistantVisible();
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
      const chat = Storage.getChat(sendChatId);
      if (chat && chat.title === 'New Chat') {
        const rawTitle = messages[0]?.content || 'Chat';
        const cleanTitle = rawTitle.replace(/^\[My current status in "[^"]*":[^\]]*\]\s*/s, '').trim();
        chat.title = Utils.truncate(cleanTitle || rawTitle, 40);
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        if (this.currentChatId === sendChatId) {
          document.getElementById('chatTitle').textContent = chat.title;
        }
        this._renderChatList();
      }

      if (this.currentChatId === sendChatId) {
        this.msgCountSinceRefresh++;
        const completedChat = Storage.getChat(sendChatId);
        if (STUDY_CONDITION === 'loom' && !this._isOneTimeTopic(completedChat?.topicId)) {
          if (this.msgCountSinceRefresh > 0 && this.msgCountSinceRefresh % 3 === 0) {
            Sidebar.refresh('interval');
          }
        } else if (STUDY_CONDITION !== 'loom') {
          this._extractBaselineDetails();
        }
      }

    } catch (err) {
      console.error('Chat error:', err);
      ensureAssistantVisible();
      this._finalizeStreamingMessage(assistantEl, 'Failed to get response. Check your connection.');
      Utils.showToast('Failed to get response. Check your connection.', 'error');
    } finally {
      document.getElementById('sendBtn').disabled = false;
    }
  },

  // ── Free-text selection annotations ─────────────────────────────────────

  _LABEL_META: {
    important: { symbol: '★', title: 'Important' },
    clear: { symbol: '✓', title: 'Got it' },
    unsure: { symbol: '?', title: 'Unsure' },
    not_relevant: { symbol: '✗', title: 'Not relevant' },
    comment: { symbol: '💬', title: 'Comment' },
  },

  _annoPopover: null,
  _annoState: null,
  _annoSelTimer: null,

  _ensureAnnoPopover() {
    if (this._annoPopover) return this._annoPopover;
    const el = document.createElement('div');
    el.id = 'labelPopover';
    el.className = 'label-popover';
    el.innerHTML = `
      <div class="label-popover-header" style="display:none"></div>
      <div class="label-popover-actions">
        <button type="button" class="label-popover-btn" data-label="important" title="Important">★ Important</button>
        <button type="button" class="label-popover-btn" data-label="clear" title="Got it">✓ Got it</button>
        <button type="button" class="label-popover-btn" data-label="unsure" title="Unsure">? Unsure</button>
        <button type="button" class="label-popover-btn" data-label="not_relevant" title="Not relevant">✗ Not relevant</button>
        <button type="button" class="label-popover-btn" data-action="comment" title="Add a comment">Comment…</button>
        <button type="button" class="label-popover-btn danger" data-action="dismiss-suggestion" style="display:none">Dismiss</button>
        <button type="button" class="label-popover-btn danger" data-action="remove" title="Remove label" style="display:none">Remove</button>
      </div>
      <div class="label-popover-comment">
        <textarea placeholder="Add a note about this span…" rows="2"></textarea>
        <div class="label-popover-comment-actions">
          <button type="button" class="label-popover-btn" data-action="cancel-comment">Cancel</button>
          <button type="button" class="label-popover-btn active" data-action="save-comment">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    // Keep the text selection while interacting with the popover; handle on pointerdown
    // so the label applies before any document dismiss/selection handlers run.
    el.addEventListener('pointerdown', (e) => {
      const t = e.target.nodeType === 3 ? e.target.parentElement : e.target;
      const btn = t && t.closest ? t.closest('[data-label], [data-action]') : null;
      if (!btn || !el.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.label) {
        this._applyAnnotation(btn.dataset.label);
        return;
      }
      const action = btn.dataset.action;
      if (action === 'comment') {
        el.querySelector('.label-popover-comment').classList.add('open');
        el.querySelector('textarea').focus();
        return;
      }
      if (action === 'cancel-comment') {
        el.querySelector('.label-popover-comment').classList.remove('open');
        return;
      }
      if (action === 'save-comment') {
        const comment = (el.querySelector('textarea').value || '').trim();
        if (!comment) return;
        this._applyAnnotation('comment', comment);
        return;
      }
      if (action === 'dismiss-suggestion') this._dismissPendingHighlight('click');
      if (action === 'remove') this._removeAnnotation();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    this._annoPopover = el;
    return el;
  },

  _bindAnnotationHandlers() {
    if (this._annoHandlersBound) return;
    this._annoHandlersBound = true;
    document.addEventListener('mouseup', (e) => {
      if (e.target.closest('#labelPopover')) return;
      if (e.target.closest('mark.anno')) return;
      setTimeout(() => this._maybeShowAnnoPopoverFromSelection(), 10);
    });
    document.addEventListener('mousedown', (e) => {
      const t = e.target.nodeType === 3 ? e.target.parentElement : e.target;
      if (this._annoPopover && t && t.closest && !t.closest('#labelPopover') && !t.closest('mark.anno')) {
        this._hideAnnoPopover();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._hideAnnoPopover();
    });
    document.addEventListener('click', (e) => {
      const pending = e.target.closest('.hl-pending');
      if (pending) {
        e.preventDefault();
        e.stopPropagation();
        this._openAnnoPopoverForPending(pending);
        return;
      }
      const mark = e.target.closest('mark.anno');
      if (!mark) return;
      e.preventDefault();
      e.stopPropagation();
      this._openAnnoPopoverForMark(mark);
    });
  },

  _findAssistantContentFromNode(node) {
    const el = node.nodeType === 3 ? node.parentElement : node;
    if (!el || !el.closest) return null;
    return el.closest('#chatMessages .message.assistant .message-content');
  },

  _normalizeAnnoSpan(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  },

  /** Collapse whitespace runs to a single space; map each normalized index → raw offset. */
  _buildNormalizedOffsetMap(raw) {
    const normalizedChars = [];
    const normToRaw = [];
    let i = 0;
    const s = raw || '';
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        const runStart = i;
        while (i < s.length && /\s/.test(s[i])) i++;
        if (normalizedChars.length > 0 && i < s.length) {
          normalizedChars.push(' ');
          normToRaw.push(runStart);
        }
      } else {
        normalizedChars.push(s[i]);
        normToRaw.push(i);
        i++;
      }
    }
    return { normalized: normalizedChars.join(''), normToRaw };
  },

  _rawOffsetIn(contentEl, node, offset) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // offset is a child index — resolve to a text position
      let pos = 0;
      for (let i = 0; i < offset && i < node.childNodes.length; i++) {
        pos += (node.childNodes[i].textContent || '').length;
      }
      if (node !== contentEl) {
        const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_ALL, null);
        let n;
        let before = 0;
        while ((n = walker.nextNode())) {
          if (n === node) return before + pos;
          if (n.nodeType === Node.TEXT_NODE) before += (n.nodeValue || '').length;
        }
      }
      return pos;
    }
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, null);
    let pos = 0;
    let n;
    while ((n = walker.nextNode())) {
      if (n === node) return pos + offset;
      pos += (n.nodeValue || '').length;
    }
    return pos;
  },

  _selectionOccurrence(contentEl, spanText, range) {
    const raw = contentEl.textContent || '';
    const { normalized, normToRaw } = this._buildNormalizedOffsetMap(raw);
    const target = this._normalizeAnnoSpan(spanText);
    if (!target || !normalized) return 0;
    const rawStart = this._rawOffsetIn(contentEl, range.startContainer, range.startOffset);
    let normStart = 0;
    while (normStart < normToRaw.length && normToRaw[normStart] < rawStart) normStart++;
    let occ = 0;
    let idx = 0;
    while (true) {
      const found = normalized.indexOf(target, idx);
      if (found === -1 || found >= normStart) break;
      occ += 1;
      idx = found + Math.max(target.length, 1);
    }
    return occ;
  },

  _isStreamingActive() {
    return !!document.querySelector('#chatMessages .streaming-cursor');
  },

  _maybeShowAnnoPopoverFromSelection() {
    if (this._isStreamingActive()) { this._hideAnnoPopover(); return; }
    if (STUDY_CONDITION === 'baseline') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = this._normalizeAnnoSpan(sel.toString());
    if (text.length <= 2) return;
    const range = sel.getRangeAt(0);
    const startContent = this._findAssistantContentFromNode(range.startContainer);
    const endContent = this._findAssistantContentFromNode(range.endContainer);
    if (!startContent || startContent !== endContent) return;
    const msgId = startContent.dataset.msgId;
    if (!msgId) return;
    const occurrence = this._selectionOccurrence(startContent, text, range);
    this._annoState = { msgId, spanText: text, occurrence, existingId: null };
    this._showAnnoPopover(range.getBoundingClientRect());
  },

  _openAnnoPopoverForMark(mark) {
    const content = mark.closest('.message-content');
    if (!content) return;
    const msgId = content.dataset.msgId;
    const annoId = mark.dataset.annoId;
    const msgs = Storage.getMessages(Storage.getCurrentChatId());
    const msg = msgs.find(m => m.id === msgId);
    const anno = msg && (msg.annotations || []).find(a => a.id === annoId);
    if (!anno) return;
    this._annoState = {
      msgId,
      spanText: anno.spanText,
      occurrence: anno.occurrence || 0,
      existingId: anno.id,
      existingLabel: anno.label,
      existingComment: anno.comment || '',
    };
    this._showAnnoPopover(mark.getBoundingClientRect(), anno);
  },

  _openAnnoPopoverForPending(span) {
    const content = span.closest('.message-content');
    if (!content) return;
    this._annoState = {
      msgId: content.dataset.msgId,
      spanText: span.dataset.spanText || span.textContent || '',
      occurrence: Number(span.dataset.occurrence || 0),
      existingId: null,
      pending: true,
    };
    this._showAnnoPopover(span.getBoundingClientRect(), null, { pending: true });
  },

  _showAnnoPopover(rect, existingAnno = null, opts = {}) {
    const el = this._ensureAnnoPopover();
    el.querySelectorAll('[data-label]').forEach(btn => {
      const activeLabel = existingAnno?.label || 'important';
      btn.classList.toggle('active', activeLabel === btn.dataset.label);
    });
    const removeBtn = el.querySelector('[data-action="remove"]');
    removeBtn.style.display = existingAnno ? '' : 'none';
    const pending = !!opts.pending;
    const header = el.querySelector('.label-popover-header');
    header.textContent = pending ? 'AI suggested — confirm or change' : '';
    header.style.display = pending ? '' : 'none';
    el.querySelector('[data-action="dismiss-suggestion"]').style.display = pending ? '' : 'none';
    const commentBox = el.querySelector('.label-popover-comment');
    const ta = commentBox.querySelector('textarea');
    if (existingAnno && existingAnno.label === 'comment') {
      commentBox.classList.add('open');
      ta.value = existingAnno.comment || '';
    } else {
      commentBox.classList.remove('open');
      ta.value = '';
    }
    el.classList.add('visible');
    const pad = 8;
    let top = rect.bottom + pad;
    let left = rect.left + rect.width / 2 - 110;
    requestAnimationFrame(() => {
      const h = el.offsetHeight || 80;
      const w = el.offsetWidth || 220;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - pad);
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
    });
  },

  _hideAnnoPopover() {
    if (!this._annoPopover) return;
    this._annoPopover.classList.remove('visible');
    this._annoPopover.querySelector('.label-popover-comment')?.classList.remove('open');
    this._annoState = null;
  },

  _applyAnnotation(label, comment = '') {
    const state = this._annoState;
    if (!state || !state.msgId || !state.spanText) return;
    const chatId = Storage.getCurrentChatId();
    const msgs = Storage.getMessages(chatId);
    const msg = msgs.find(m => m.id === state.msgId);
    if (!msg) return;
    const wasPending = !!state.pending;
    if (!Array.isArray(msg.annotations)) msg.annotations = [];

    const spanText = this._normalizeAnnoSpan(state.spanText);
    if (!spanText) return;
    state.spanText = spanText;
    const occ = state.occurrence || 0;
    // Prefer updating an existing annotation on the same span (by id, or same text+occurrence)
    let existing = state.existingId
      ? msg.annotations.find(a => a.id === state.existingId)
      : msg.annotations.find(a => this._normalizeAnnoSpan(a.spanText) === spanText && (a.occurrence || 0) === occ);

    // Toggle-off: re-clicking an already-active quick label removes the annotation
    // (comment uses Save with new text — don't treat that as cancel)
    if (!wasPending && existing && existing.label === label && label !== 'comment') {
      state.existingId = existing.id;
      this._removeAnnotation();
      return;
    }

    if (existing) {
      existing.label = label;
      existing.spanText = spanText;
      existing.ts = Date.now();
      if (label === 'comment') existing.comment = comment;
      else delete existing.comment;
    } else {
      msg.annotations.push({
        id: 'anno_' + Utils.generateId(),
        spanText,
        occurrence: occ,
        label,
        ...(label === 'comment' ? { comment } : {}),
        ts: Date.now(),
      });
    }
    // Drop older duplicates of the same normalized span+occurrence
    const seen = new Map();
    msg.annotations = msg.annotations.filter(a => {
      if (!a || !a.spanText) return false;
      a.spanText = this._normalizeAnnoSpan(a.spanText);
      const key = `${a.spanText}::${a.occurrence || 0}`;
      const prev = seen.get(key);
      if (!prev) { seen.set(key, a); return true; }
      if ((a.ts || 0) >= (prev.ts || 0)) {
        seen.set(key, a);
        return true;
      }
      return false;
    }).filter(a => {
      const key = `${this._normalizeAnnoSpan(a.spanText)}::${a.occurrence || 0}`;
      return seen.get(key) === a;
    });
    Storage.saveMessages(chatId, msgs);
    if (wasPending) {
      msg.suggestedHighlights = (msg.suggestedHighlights || []).filter(h =>
        !(this._highlightDisplayText(h.spanText) === spanText && (h.occurrence || 0) === occ)
      );
      Storage.saveMessages(chatId, msgs);
      this._applyPendingHighlightsToDom(state.msgId, msg.suggestedHighlights);
      StudyLog.event('label_highlight_confirmed', { msgId: state.msgId, spanText, label });
      if (label !== 'important') {
        StudyLog.event('label_highlight_changed', {
          msgId: state.msgId, spanText, from: 'important', to: label,
        });
      }
    }
    this._applyAnnotationsToDom(state.msgId, msg.annotations);
    StudyLog.event('text_label_applied', {
      stage: 'construct',
      initiative: 'mixed',
      origin: wasPending ? 'ai-suggested' : 'user',
      surface: 'chat',
      label,
      hasComment: label === 'comment',
      msgId: state.msgId,
    });

    if (label === 'comment') {
      Utils.showToast("Noted — it'll show up in your next profile suggestion.");
    }
    if (typeof Sidebar !== 'undefined') {
      Sidebar._labelsDirty = true;
    }
    this._hideAnnoPopover();
    window.getSelection()?.removeAllRanges();
  },

  _removeAnnotation() {
    const state = this._annoState;
    if (!state || !state.existingId) return;
    const chatId = Storage.getCurrentChatId();
    const msgs = Storage.getMessages(chatId);
    const msg = msgs.find(m => m.id === state.msgId);
    if (!msg || !Array.isArray(msg.annotations)) return;
    msg.annotations = msg.annotations.filter(a => a.id !== state.existingId);
    Storage.saveMessages(chatId, msgs);
    this._applyAnnotationsToDom(state.msgId, msg.annotations);
    StudyLog.event('text_label_removed', {
      stage: 'construct',
      initiative: 'user',
      origin: 'user',
      surface: 'chat',
      msgId: state.msgId,
    });
    if (typeof Sidebar !== 'undefined') Sidebar._labelsDirty = true;
    this._hideAnnoPopover();
  },

  _dismissPendingHighlight(reason = 'click') {
    const state = this._annoState;
    if (!state || !state.pending) return;
    const chatId = Storage.getCurrentChatId();
    const msgs = Storage.getMessages(chatId);
    const msg = msgs.find(m => m.id === state.msgId);
    if (!msg) return;
    const spanText = this._normalizeAnnoSpan(state.spanText);
    const occurrence = state.occurrence || 0;
    msg.suggestedHighlights = (msg.suggestedHighlights || []).filter(h =>
      !(this._highlightDisplayText(h.spanText) === spanText && (h.occurrence || 0) === occurrence)
    );
    Storage.saveMessages(chatId, msgs);
    this._applyPendingHighlightsToDom(msg.id, msg.suggestedHighlights);
    StudyLog.event('label_highlight_dismissed', {
      msgId: msg.id, spanText, reason,
    });
    this._hideAnnoPopover();
  },

  _dismissPendingHighlights(reason = 'batch') {
    const chatId = this.currentChatId;
    if (!chatId) return;
    const msgs = Storage.getMessages(chatId);
    let count = 0;
    msgs.forEach(msg => {
      if (!Array.isArray(msg.suggestedHighlights) || msg.suggestedHighlights.length === 0) return;
      count += msg.suggestedHighlights.length;
      msg.suggestedHighlights = [];
      this._applyPendingHighlightsToDom(msg.id, []);
    });
    if (!count) return;
    Storage.saveMessages(chatId, msgs);
    StudyLog.event('label_highlight_dismissed', {
      msgId: null, spanText: null, reason, count,
    });
  },

  _applyPendingHighlightsToDom(msgId, highlights) {
    const content = document.querySelector(`.message-content[data-msg-id="${msgId}"]`);
    if (!content) return;
    content.querySelectorAll('.hl-pending').forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
    (Array.isArray(highlights) ? highlights : []).forEach((highlight, index) => {
      if (!highlight || !highlight.spanText) return;
      this._wrapAnnotationOccurrence(content, {
        id: `pending_${index}`,
        spanText: highlight.spanText,
        occurrence: highlight.occurrence || 0,
      }, {
        tagName: 'span',
        className: 'hl-pending',
        dataset: {
          spanText: highlight.spanText,
          occurrence: String(highlight.occurrence || 0),
        },
      });
    });
  },

  _applyAnnotationsToDom(msgId, annotations) {
    const content = document.querySelector(`.message-content[data-msg-id="${msgId}"]`);
    if (!content) return;
    content.querySelectorAll('mark.anno').forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    });
    const list = Array.isArray(annotations) ? annotations.slice() : [];
    // One highlight per span+occurrence — keep the newest if duplicates exist
    const byKey = new Map();
    for (const anno of list) {
      if (!anno || !anno.spanText) continue;
      const key = `${this._normalizeAnnoSpan(anno.spanText)}::${anno.occurrence || 0}`;
      const prev = byKey.get(key);
      if (!prev || (anno.ts || 0) >= (prev.ts || 0)) byKey.set(key, anno);
    }
    const deduped = [...byKey.values()];
    deduped.sort((a, b) => (b.spanText || '').length - (a.spanText || '').length);
    for (const anno of deduped) {
      this._wrapAnnotationOccurrence(content, anno);
    }
    // Drop empty / whitespace-only marks (stray underline dots between paragraphs)
    content.querySelectorAll('mark.anno').forEach(mark => {
      mark.normalize();
      if (!(mark.textContent || '').trim()) mark.remove();
    });
  },

  _wrapAnnotationOccurrence(root, anno, opts = {}) {
    const target = this._normalizeAnnoSpan(anno.spanText);
    if (!target) return false;
    const occurrence = anno.occurrence || 0;
    const raw = root.textContent || '';
    const { normalized, normToRaw } = this._buildNormalizedOffsetMap(raw);
    let normStart = -1;
    let from = 0;
    let seen = 0;
    while (from <= normalized.length) {
      const idx = normalized.indexOf(target, from);
      if (idx === -1) break;
      if (seen === occurrence) { normStart = idx; break; }
      seen += 1;
      from = idx + Math.max(target.length, 1);
    }
    if (normStart < 0 || !normToRaw.length) return false;
    const normEnd = normStart + target.length;
    const start = normToRaw[normStart];
    const end = normToRaw[normEnd - 1] + 1;

    // Collect every text node intersecting [start, end) — wrap per node so
    // multi-paragraph selections stay valid DOM (inline mark cannot wrap blocks).
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let pos = 0;
    const segments = [];
    let node;
    while ((node = walker.nextNode())) {
      const len = (node.nodeValue || '').length;
      const nodeStart = pos;
      const nodeEnd = pos + len;
      if (nodeEnd > start && nodeStart < end) {
        if (!(node.parentElement && node.parentElement.closest('mark.anno'))) {
          const sliceStart = Math.max(0, start - nodeStart);
          const sliceEnd = Math.min(len, end - nodeStart);
          if (sliceStart < sliceEnd) {
            const slice = (node.nodeValue || '').slice(sliceStart, sliceEnd);
            if (!/^\s*$/.test(slice)) {
              segments.push({ node, sliceStart, sliceEnd });
            }
          }
        }
      }
      pos += len;
      if (nodeStart >= end) break;
    }
    if (segments.length === 0) return false;

    // Process last→first so earlier text-node identities stay valid after splits.
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      let middle = seg.node;
      if (seg.sliceEnd < (middle.nodeValue || '').length) {
        middle.splitText(seg.sliceEnd);
      }
      if (seg.sliceStart > 0) {
        middle = middle.splitText(seg.sliceStart);
      }
      const mark = document.createElement(opts.tagName || 'mark');
      mark.className = opts.className || `anno anno-${anno.label}`;
      if (opts.dataset) {
        Object.entries(opts.dataset).forEach(([key, value]) => { mark.dataset[key] = value; });
      } else {
        mark.dataset.annoId = anno.id;
        mark.title = (this._LABEL_META[anno.label] || {}).title || anno.label;
      }
      middle.parentNode.replaceChild(mark, middle);
      mark.appendChild(middle);
    }
    return true;
  },

  _createStreamingMessage(chatId = this.currentChatId) {
    const el = document.createElement('div');
    el.className = 'message assistant';
    el.innerHTML = `<div class="message-content"><span class="streaming-cursor"></span></div>`;
    if (this.currentChatId === chatId) {
      const container = document.getElementById('chatMessages');
      container.appendChild(el);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return el;
  },

  _stripSearchArtifacts(text) {
    return text.replace(/google:search\{[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n');
  },

  _salvageJsonArray(jsonStr) {
    const s = (jsonStr || '').trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {}
    // Best-effort: largest valid JSON array prefix
    for (let end = s.length; end > 1; end--) {
      if (s[end - 1] !== ']') continue;
      try {
        const parsed = JSON.parse(s.slice(0, end));
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
    }
    return null;
  },

  _stripConnectionResidue(text) {
    return (text || '')
      .replace(/\{~CONNECTIONS~\}[\s\S]*?(?:\{~END~\}|$)/g, '')
      .replace(/\{~\d+\}/g, '')
      .replace(/\{~END~\}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd();
  },

  _extractHighlights(text) {
    const source = text == null ? '' : String(text);
    const highlights = [];
    let cleanText = '';
    let lastIndex = 0;
    const pairPattern = /\{~HL~\}([\s\S]*?)\{~\/HL~\}/g;
    let match;
    while ((match = pairPattern.exec(source)) !== null) {
      cleanText += source.slice(lastIndex, match.index);
      const inner = match[1] || '';
      cleanText += inner;
      const spanText = inner.trim();
      if (spanText && spanText.length <= 200) {
        let occurrence = 0;
        let from = 0;
        const before = cleanText.slice(0, Math.max(0, cleanText.length - inner.length));
        while (from <= before.length) {
          const found = before.indexOf(spanText, from);
          if (found === -1) break;
          occurrence += 1;
          from = found + Math.max(spanText.length, 1);
        }
        highlights.push({ spanText, occurrence });
      }
      lastIndex = pairPattern.lastIndex;
    }
    cleanText += source.slice(lastIndex);
    cleanText = cleanText
      .replace(/\{~HL~\}/g, '')
      .replace(/\{~\/HL~\}/g, '')
      .replace(/\{~\/?HL/g, '');
    return { cleanText, highlights };
  },

  _highlightDisplayText(spanText) {
    const raw = spanText == null ? '' : String(spanText);
    try {
      if (typeof document !== 'undefined' && document.createElement && Utils?.renderMarkdown) {
        const scratch = document.createElement('div');
        scratch.innerHTML = Utils.renderMarkdown(raw);
        return this._normalizeAnnoSpan(scratch.textContent || '');
      }
    } catch (_) {}
    const codeSpans = [];
    const withoutCode = raw.replace(/(`{1,3})(.*?)\1/g, (_match, _ticks, code) => {
      const token = `\uE000${codeSpans.length}\uE001`;
      codeSpans.push(code);
      return token;
    });
    const plain = withoutCode
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~]/g, '')
      .replace(/\uE000(\d+)\uE001/g, (_match, index) => codeSpans[Number(index)] || '');
    return this._normalizeAnnoSpan(plain);
  },

  _renderPendingHighlights(contentEl, highlights) {
    const normalized = (Array.isArray(highlights) ? highlights : [])
      .map(highlight => ({
        ...highlight,
        spanText: this._highlightDisplayText(highlight?.spanText),
      }))
      .filter(highlight => highlight.spanText);
    normalized.forEach((highlight, index) => {
      this._wrapAnnotationOccurrence(contentEl, {
        id: `pending_${index}`,
        spanText: highlight.spanText,
        occurrence: highlight.occurrence || 0,
      }, {
        tagName: 'span',
        className: 'hl-pending',
        dataset: {
          spanText: highlight.spanText,
          occurrence: String(highlight.occurrence || 0),
        },
      });
    });
    return normalized;
  },

  _stripConnectionBlock(text) {
    const connStart = text.indexOf('{~CONNECTIONS~}');
    if (connStart === -1) {
      return { mainText: this._stripConnectionResidue(text), connectionsJson: null };
    }
    const mainText = this._stripConnectionResidue(text.substring(0, connStart));
    const connEnd = text.indexOf('{~END~}', connStart);
    const jsonStr = connEnd === -1
      ? text.substring(connStart + '{~CONNECTIONS~}'.length).trim()
      : text.substring(connStart + '{~CONNECTIONS~}'.length, connEnd).trim();
    const connections = this._salvageJsonArray(jsonStr);
    return { mainText, connectionsJson: connections };
  },

  _parseConnectionMarkers(html) {
    // Strip any leftover raw marker tokens that escaped markdown rendering
    const cleaned = (html || '')
      .replace(/\{~CONNECTIONS~\}[\s\S]*?(?:\{~END~\}|$)/g, '')
      .replace(/\{~END~\}/g, '');
    return cleaned.replace(/((?:\S+\s+){0,2}\S+)\s*\{~(\d+)\}/g,
      '<span class="conn-marker loading" data-conn-id="$2">$1<span class="conn-dots"></span></span>');
  },

  _resolveConnectionMarkers(contentEl, connectionsJson) {
    const list = Array.isArray(connectionsJson) ? connectionsJson : [];
    contentEl.querySelectorAll('.conn-marker').forEach(marker => {
      const id = parseInt(marker.dataset.connId, 10);
      const conn = list.find(c => c.id === id);
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
        // Unwrap: keep text, drop marker shell / loading dots
        const dots = marker.querySelector('.conn-dots, .conn-icon');
        if (dots) dots.remove();
        const parent = marker.parentNode;
        while (marker.firstChild) parent.insertBefore(marker.firstChild, marker);
        parent.removeChild(marker);
      }
    });
    this._bindConnectionCards(contentEl);
  },

  _clearUnresolvedConnMarkers(contentEl) {
    contentEl.querySelectorAll('.conn-marker').forEach(marker => {
      const dots = marker.querySelector('.conn-dots, .conn-icon');
      if (dots) dots.remove();
      const parent = marker.parentNode;
      while (marker.firstChild) parent.insertBefore(marker.firstChild, marker);
      parent.removeChild(marker);
    });
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
          <a class="conn-card-goto" href="#">Go to chat</a>
          <button class="conn-card-contest" title="This connection is incorrect">⚑</button>
        </div>
      `;
      document.body.appendChild(card);
      card.querySelector('.conn-card-close').addEventListener('click', () => this._hideConnCard());
      card.querySelector('.conn-card-goto').addEventListener('click', (e) => {
        e.preventDefault();
        const chatId = card.dataset.targetChatId;
        if (chatId) {
          this._hideConnCard();
          const chat = Storage.getChat(chatId);
          if (chat) {
            const prevChatId = this.currentChatId;
            this._onExitChat(prevChatId);
            Sidebar._flushDirtyLabels();
            this._summarizeCurrentChat();
            this._renderChat(chatId);
            this._renderChatList();
          }
        }
      });
      card.querySelector('.conn-card-contest').addEventListener('click', () => {
        const chatId = card.dataset.targetChatId || '';
        const marker = this._connCardMarker;
        const curChat = this.currentChatId ? Storage.getChat(this.currentChatId) : null;
        const topic = curChat && curChat.topicId ? Storage.getTopic(curChat.topicId) : null;
        if (topic && chatId) {
          if (!Array.isArray(topic.excludedChatIds)) topic.excludedChatIds = [];
          if (!topic.excludedChatIds.includes(chatId)) topic.excludedChatIds.push(chatId);
          Storage.saveTopic(topic);
        }
        // Mark the source assistant message (markers are stamped with data-msg-id at finalize)
        const msgId = marker && marker.dataset.msgId;
        if (msgId && this.currentChatId) {
          const data = Storage._getAll();
          const msgArr = data.messages[this.currentChatId];
          const mIdx = msgArr ? msgArr.findIndex(m => m.id === msgId) : -1;
          if (mIdx >= 0) {
            msgArr[mIdx].connContested = { chatId, ts: Utils.timestamp() };
            Storage._saveAll(data);
          }
        }
        if (marker) marker.classList.add('conn-marker-contested');
        this._hideConnCard();
        Utils.showToast("Won't be used in this topic");
        StudyLog.event('connection_contested', {
          initiative: 'mixed', surface: 'chat',
          topicId: topic ? topic.id : null, chatId,
        });
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
    if (userAsked || aiCovered) {
      summaryEl.style.display = '';
      card.querySelector('.conn-card-user-asked').textContent = userAsked || '—';
      card.querySelector('.conn-card-ai-covered').textContent = aiCovered || '—';
    } else {
      summaryEl.style.display = 'none';
    }
    card.dataset.targetChatId = chatId;
    card.dataset.userAsked = userAsked;
    card.dataset.aiCovered = aiCovered;
    card.dataset.insight = insight;
    card.dataset.title = title;
    card.querySelector('.conn-card-goto').style.display = chatId ? '' : 'none';
    card.classList.add('visible');
    this._connCardMarker = marker;

    const positionCard = () => {
      const rect = marker.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const chatMessages = document.getElementById('chatMessages');
      const chatRect = chatMessages?.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { this._hideConnCard(); return; }
      const topBound = Math.max(12, (chatRect?.top || 0) + 8);
      const bottomBound = Math.min(window.innerHeight - 12, (chatRect?.bottom || window.innerHeight) - 8);
      let top = rect.bottom + 8;
      if (top + cardRect.height > bottomBound && rect.top - cardRect.height - 8 >= topBound) {
        top = rect.top - cardRect.height - 8;
      }
      top = Math.max(topBound, Math.min(top, bottomBound - cardRect.height));
      let left = rect.left + rect.width / 2 - cardRect.width / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - cardRect.width - 12));
      card.style.top = top + 'px';
      card.style.left = left + 'px';
    };
    requestAnimationFrame(positionCard);

    if (this._connScrollHandler) {
      const chatMessages = document.getElementById('chatMessages');
      chatMessages?.removeEventListener('scroll', this._connScrollHandler);
    }
    this._connScrollHandler = () => {
      if (!card.classList.contains('visible')) return;
      requestAnimationFrame(positionCard);
    };
    document.getElementById('chatMessages')?.addEventListener('scroll', this._connScrollHandler, { passive: true });
  },

  _hideConnCard() {
    if (this._connCardEl) this._connCardEl.classList.remove('visible');
    this._connCardMarker = null;
    if (this._connScrollHandler) {
      document.getElementById('chatMessages')?.removeEventListener('scroll', this._connScrollHandler);
      this._connScrollHandler = null;
    }
  },

  _bindConnectionCards(container) {
    container.querySelectorAll('.conn-marker.resolved').forEach(marker => {
      marker.style.cursor = 'pointer';
      marker.addEventListener('mouseenter', () => {
        StudyLog.event('connection_marker_hovered', { surface: 'chat' });
      });
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        StudyLog.event('connection_marker_clicked', { surface: 'chat' });
        this._showConnCard(marker);
      });
    });
  },

  _updateStreamingMessage(el, text) {
    const contentEl = el.querySelector('.message-content');
    const { mainText } = this._stripConnectionBlock(this._stripSearchArtifacts(text));
    const { cleanText, highlights } = this._extractHighlights(mainText);
    // Mid-stream: hide incomplete trailer / raw markers; show loading markers only for complete {~N}
    const safe = cleanText
      .replace(/\{~CONNECTIONS~\}[\s\S]*$/g, '')
      .replace(/\{~\d*$/g, '')
      .replace(/\{~\/?H?L?~?$/g, '');
    const rendered = Utils.renderMarkdown(safe);
    contentEl.innerHTML = this._parseConnectionMarkers(rendered);
    this._renderPendingHighlights(contentEl, highlights);
    contentEl.insertAdjacentHTML('beforeend', '<span class="streaming-cursor"></span>');
  },

  _finalizeStreamingMessage(el, text, msgId) {
    const contentEl = el.querySelector('.message-content');
    const { mainText, connectionsJson } = this._stripConnectionBlock(this._stripSearchArtifacts(text));
    const { cleanText, highlights } = this._extractHighlights(mainText);
    contentEl.innerHTML = this._parseConnectionMarkers(Utils.renderMarkdown(cleanText));
    const renderedHighlights = this._renderPendingHighlights(contentEl, highlights);
    // Strip any leftover raw marker tokens that weren't turned into spans
    contentEl.querySelectorAll('*').forEach(() => {});
    if (msgId) contentEl.dataset.msgId = msgId;
    if (connectionsJson && connectionsJson.length > 0) {
      this._resolveConnectionMarkers(contentEl, connectionsJson);
      if (msgId) contentEl.querySelectorAll('.conn-marker').forEach(m => { m.dataset.msgId = msgId; });
    } else {
      this._clearUnresolvedConnMarkers(contentEl);
    }
    // Final safety: never leave loading markers or raw {~N} text
    contentEl.querySelectorAll('.conn-marker.loading').forEach(m => {
      const dots = m.querySelector('.conn-dots, .conn-icon');
      if (dots) dots.remove();
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    if (contentEl.innerHTML.includes('{~')) {
      contentEl.innerHTML = contentEl.innerHTML
        .replace(/\{~CONNECTIONS~\}[\s\S]*?(?:\{~END~\}|$)/g, '')
        .replace(/\{~\d+\}/g, '')
        .replace(/\{~END~\}/g, '');
    }
    return { cleanText, highlights: renderedHighlights };
  },

  // ── Injected Past Context Panel ────────────────────────────────────────

  _renderInjectedPastPanel(assistantEl, injectedPastChats, opts = {}) {
    if (!injectedPastChats || injectedPastChats.length === 0) return;
    const existing = assistantEl.querySelector('.past-context-panel');
    if (existing) existing.remove();

    const currentChat = this.currentChatId ? Storage.getChat(this.currentChatId) : null;
    const topic = currentChat?.topicId ? Storage.getTopic(currentChat.topicId) : null;
    const excluded = new Set((topic && topic.excludedChatIds) || []);

    const panel = document.createElement('div');
    panel.className = 'past-context-panel';
    const label = document.createElement('span');
    label.className = 'past-context-label';
    label.textContent = 'Context used:';
    panel.appendChild(label);

    injectedPastChats.forEach(chat => {
      const card = document.createElement('div');
      card.className = 'past-context-card';
      if (chat.chatId && excluded.has(chat.chatId)) {
        card.classList.add('past-chat-contested');
      }
      const title = Utils.escapeHtml(chat.title || 'Past conversation');
      const excerpt = chat.userAsked ? Utils.escapeHtml(chat.userAsked.slice(0, 120)) : '';
      card.innerHTML = `
        <div class="temporal-card-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11" class="temporal-card-icon">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <span class="temporal-card-title">${title}</span>
        </div>
        ${excerpt ? `<div class="temporal-card-excerpt">${excerpt}</div>` : ''}
        <div class="temporal-card-actions">
          <button class="past-context-exclude-btn" type="button">${excluded.has(chat.chatId) ? "Undo don't use" : "Don't use for this topic"}</button>
          <button class="past-context-open-btn" type="button" data-chat-id="${Utils.escapeHtml(chat.chatId || '')}">Open chat →</button>
        </div>
      `;
      card.querySelector('.past-context-exclude-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!topic || !chat.chatId) return;
        if (!Array.isArray(topic.excludedChatIds)) topic.excludedChatIds = [];
        const excludeBtn = e.currentTarget;
        const already = topic.excludedChatIds.includes(chat.chatId);
        if (already) {
          topic.excludedChatIds = topic.excludedChatIds.filter(id => id !== chat.chatId);
          Storage.saveTopic(topic);
          card.classList.remove('past-chat-contested');
          excludeBtn.textContent = "Don't use for this topic";
          StudyLog.event('context_exclusion_reverted', {
            topicId: topic.id, chatId: chat.chatId, initiative: 'user', surface: 'chat',
          });
        } else {
          topic.excludedChatIds.push(chat.chatId);
          Storage.saveTopic(topic);
          card.classList.add('past-chat-contested');
          excludeBtn.textContent = "Undo don't use";
          StudyLog.event('context_excluded_for_topic', {
            topicId: topic.id, chatId: chat.chatId, initiative: 'user', surface: 'chat',
          });
        }
      });
      card.querySelector('.past-context-open-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const chatId = chat.chatId;
        if (!chatId || !Storage.getChat(chatId)) return;
        const prevChatId = this.currentChatId;
        this._onExitChat(prevChatId);
        Sidebar._flushDirtyLabels();
        this._summarizeCurrentChat();
        this._renderChat(chatId);
        this._renderChatList();
        StudyLog.event('context_link_opened', {
          topicId: topic ? topic.id : null, chatId, surface: 'chat',
        });
      });
      panel.appendChild(card);
    });

    assistantEl.insertBefore(panel, assistantEl.firstChild);
    StudyLog.event('context_card_shown', {
      topicId: topic ? topic.id : null,
      count: injectedPastChats.length,
      surface: 'chat',
      ...(opts.replay ? { replay: true } : {}),
    });
  },

  _isOneTimeTopic(topicId) {
    if (!topicId) return false;
    const topic = Storage.getTopic(topicId);
    return !!(topic && (
      topic.oneTimeBucket
      || topic.name === 'Unassigned'
      || topic.name === 'One-time questions'
    ));
  },

  _getOrCreateOneTimeTopic() {
    const existing = Storage.getTopics().find(t =>
      t.oneTimeBucket || t.name === 'Unassigned' || t.name === 'One-time questions'
    );
    if (existing) return existing;
    const topic = Storage.createTopic('One-time questions');
    topic.userCreated = false;
    topic.oneTimeBucket = true;
    Storage.saveTopic(topic);
    return topic;
  },

  async _assignTopicToChat(chatId, {
    topicId = null,
    newTopicName = '',
    isOneOff = false,
    assignMethod = 'auto',
  } = {}) {
    const chat = Storage.getChat(chatId);
    if (!chat || chat.topicId) return;

    if (isOneOff) {
      const bucket = this._getOrCreateOneTimeTopic();
      chat.topicId = bucket.id;
      chat.oneTime = true;
      chat.lastActive = Utils.timestamp();
      Storage.saveChat(chat);
      bucket.lastActive = Utils.timestamp();
      Storage.saveTopic(bucket);
      StudyLog.event('one_time_chat_started', { chatId, source: 'classified' });
      StudyLog.event('topic_assigned', {
        chatId, topicId: bucket.id, assignMethod, isOneOff: true,
      });
      if (this.currentChatId === chatId) Sidebar.hide();
      this._renderChatList();
      return;
    }

    if (!topicId && newTopicName) {
      const existing = Storage.getTopics().find(
        t => t.name.toLowerCase() === newTopicName.toLowerCase()
      );
      if (existing) {
        topicId = existing.id;
      } else {
        const topic = Storage.createTopic(newTopicName);
        topicId = topic.id;
        StudyLog.event('topic_created', { topicId, isAutoDetected: true });
      }
    }

    if (topicId) {
      chat.topicId = topicId;
      chat.lastActive = Utils.timestamp();
      Storage.saveChat(chat);
      StudyLog.event('topic_assigned', { chatId, topicId, assignMethod });

      const topic = Storage.getTopic(topicId);
      if (topic) {
        topic.lastActive = Utils.timestamp();
        Storage.saveTopic(topic);
      }

      if (this.currentChatId === chatId && !this._isOneTimeTopic(topicId)) {
        Sidebar.show(topicId);
      }
      this._renderChatList();
    }
  },

  async _handleTopicDetection(topicData, chatId = this.currentChatId) {
    return this._assignTopicToChat(chatId, {
      topicId: topicData.matchedExistingId || null,
      newTopicName: topicData.name || '',
      isOneOff: !!topicData.isOneOff,
      assignMethod: 'auto',
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
      if (this._isOneTimeTopic(t.id)) return false;
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
    const candidateChats = Storage.getChats().filter(c =>
      c.summary && !c.topicId
    );
    if (candidateChats.length < 2) return;

    try {
      const resp = await fetch(`${API_BASE}/api/topic/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatSummaries: candidateChats.map(c => ({ id: c.id, summary: c.summary })),
          existingTopics: Storage.getTopics()
            .filter(t => !this._isOneTimeTopic(t.id))
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
            if (chat && !chat.topicId) {
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
            if (chat && !chat.topicId) {
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
    const isOneTime = !!(chat?.oneTime || this._isOneTimeTopic(chat?.topicId));
    if (messages.length === 0) {
      mainContent.classList.add('welcome-mode');
      this._renderWelcome(msgContainer, { suppressSuggestions: isOneTime });
      if (topicSel) topicSel.style.display = isOneTime ? 'none' : '';
      if (topicPickerEl) topicPickerEl.style.display = isOneTime ? 'none' : '';
      TopicSuggester.reset();
      if (isOneTime) TopicSuggester._suggestionDismissed = true;
    } else {
      mainContent.classList.remove('welcome-mode');
      messages.forEach(m => this._appendMessage(m));
      if (topicSel) topicSel.style.display = 'none';
      if (topicPickerEl) topicPickerEl.style.display = 'none';
    }

    if (STUDY_CONDITION === 'baseline') {
      Sidebar.showBaseline();
    } else if (chat?.topicId && !this._isOneTimeTopic(chat.topicId)) {
      Sidebar.show(chat.topicId);
      this.msgCountSinceRefresh = 0;
    } else {
      Sidebar.hide();
    }

    this._highlightActiveChat(chatId);
  },

  _renderWelcome(container, opts = {}) {
    const suggestions = opts.suppressSuggestions ? [] : this._getSuggestionCards();
    let suggestionsHtml = '';
    if (suggestions.length > 0 && STUDY_CONDITION === 'loom') {
      const cardsHtml = suggestions.map((s, i) => {
        const tc = Utils.getTopicColor(s.topicColorObj);
        const sendText = s.question || s.title || '';
        const goalTitleLine = (s.title && s.question)
          ? `<div class="welcome-card-goal-title">${Utils.escapeHtml(s.title)}</div>`
          : '';
        const mainLine = `<div class="welcome-card-question">${Utils.escapeHtml(sendText)}</div>`;
        return `<div class="welcome-suggestion-card" data-suggestion-idx="${i}">
          <div class="welcome-card-topic" style="color:${tc.color};">
            <span class="topic-color-dot" style="background:${tc.color};"></span>
            ${Utils.escapeHtml(s.topicName)}
          </div>
          ${s.isGoal ? '<div class="welcome-card-intention-badge">Your goal</div>' : ''}
          ${goalTitleLine}
          ${mainLine}
        </div>`;
      }).join('');
      const shuffleBtnHtml = `<button class="welcome-shuffle-btn" id="welcomeShuffleBtn" title="Shuffle">
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
        <h2>Where should we start?</h2>
        <p>Ask anything. ChatWeave will keep relevant context organized as you go.</p>
      </div>
      ${suggestionsHtml}`;

    if (suggestions.length > 0 && STUDY_CONDITION === 'loom') {
      this._bindSuggestionCards(suggestions);
      const shuffleBtn = document.getElementById('welcomeShuffleBtn');
      if (shuffleBtn) {
        shuffleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          StudyLog.event('directions_shuffled', { stage: 'evolve', initiative: 'user', surface: 'welcome', location: 'welcome', topicId: null });
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
    // Saved goals come first on the welcome screen
    for (const topic of topics) {
      const goals = (topic.statusSummary && Array.isArray(topic.statusSummary.goals))
        ? topic.statusSummary.goals : [];
      for (const g of goals) {
        cards.push({
          topicId: topic.id,
          topicName: topic.name,
          topicColorObj: topic,
          statusSummary: Sidebar._serializeStatus(topic.statusSummary) || '',
          title: g.text || g.title || '',
          question: '',
          isGoal: true,
          goalId: g.id,
        });
      }
    }
    for (const topic of topics) {
      if (!topic.sidebarCache) continue;
      const dirs = (topic.sidebarCache.newDirections || []).map(d => Sidebar._normalizeDirection(d));
      if (dirs.length === 0) continue;
      cards.push({
        topicId: topic.id,
        topicName: topic.name,
        topicColorObj: topic,
        statusSummary: Sidebar._serializeStatus(topic.statusSummary) || '',
        title: dirs[0].title || '',
        question: dirs[0].exampleQuestion || '',
      });
    }
    // Ensure at least 2 cards by pulling extra directions from existing topics
    if (cards.length < 2) {
      for (const topic of topics) {
        if (cards.length >= 2) break;
        if (!topic.sidebarCache) continue;
        const dirs = (topic.sidebarCache.newDirections || []).map(d => Sidebar._normalizeDirection(d));
        for (let i = 1; i < dirs.length && cards.length < 2; i++) {
          const already = cards.some(c => c.topicId === topic.id && c.question === dirs[i].exampleQuestion);
          if (already) continue;
          cards.push({
            topicId: topic.id,
            topicName: topic.name,
            topicColorObj: topic,
            statusSummary: Sidebar._serializeStatus(topic.statusSummary) || '',
            title: dirs[i].title || '',
            question: dirs[i].exampleQuestion || '',
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
          StudyLog.event('welcome_suggestion_clicked', {
            initiative: 'user', surface: 'welcome', title: s.title || '', topicId: s.topicId, suggestionIdx: idx,
          });
          this._startSuggestedChat(s);
        }
      });
    });
  },

  _markWelcomeGoalExplored(_suggestion) {
    // Goals stay active until deleted — no-op.
  },

  async _startSuggestedChat(suggestion) {
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
      if (!this._isOneTimeTopic(topic.id)) {
        Sidebar.show(suggestion.topicId);
      }
    }

    let content = suggestion.question || suggestion.title || '';
    if (suggestion.statusSummary) {
      content = `[My current status in "${suggestion.topicName}": ${suggestion.statusSummary}]\n\n${content}`;
    }

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

  _renderContextBar(modules, options = {}) {
    const contextOnly = !!options.contextOnly;
    const statusSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    const linkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

    const items = modules.map((mod, i) => {
      if (mod.type === 'direction_suggestion') {
        const cardType = Utils.escapeHtml(mod.cardType || 'extend');
        const title = Utils.escapeHtml(mod.title || mod.label || 'Suggested next question');
        const question = Utils.escapeHtml(mod.question || mod.body || '');
        return `<div class="ctx-card ctx-card-direction type-${cardType}">
          <div class="ctx-card-tag">${cardType}</div>
          <div class="ctx-card-title">${title}</div>
          <div class="ctx-card-question">${question}</div>
        </div>`;
      }
      const isStatus = mod.type === 'status';
      const icon = isStatus ? statusSvg : linkSvg;
      const typeClass = isStatus ? 'ctx-status' : 'ctx-linked';
      let inlineStyle = '';
      if (isStatus) {
        const topicName = (mod.label || '').replace(/^Status:\s*/, '');
        let topic = Storage.getTopics().find(t => t.name === topicName);
        if (!topic && this.currentChatId) {
          const chat = Storage.getChat(this.currentChatId);
          if (chat && chat.topicId) topic = Storage.getTopic(chat.topicId);
        }
        if (topic) {
          const tc = Utils.getTopicColor(topic);
          inlineStyle = ` style="color:${tc.color};background:${tc.light}"`;
        }
      }
      return `<span class="ctx-tag ${typeClass}" data-ctx-idx="${i}"${inlineStyle}>${icon} ${Utils.escapeHtml(mod.label)}</span>`;
    });

    const html = items.map((entry, idx) => {
      const isCard = entry.includes('ctx-card');
      const prevIsCard = idx > 0 && items[idx - 1].includes('ctx-card');
      if (idx > 0 && !isCard && !prevIsCard) return `<span class="ctx-dot">&middot;</span>${entry}`;
      return entry;
    }).join('');

    const barClass = contextOnly ? 'message-context-bar context-only' : 'message-context-bar';
    return `<div class="${barClass}">${html}</div><div class="ctx-detail-panel"></div>`;
  },

  _appendMessage(msg) {
    const container = document.getElementById('chatMessages');

    const el = document.createElement('div');
    el.className = `message ${msg.role}`;
    // Attachment rendering below checks att.data and falls back to att.name.

    let contextBarHtml = '';
    let displayContent = msg.content;
    let visibleModules = [];

    if (msg.role === 'user') {
      const { modules, userQuery } = this._parseUserMessageModules(msg.content);
      const modulesWithMeta = modules.map(m => ({ ...m }));
      if (msg.contextMeta && msg.contextMeta.type === 'direction_card') {
        const knowledgeIdx = modulesWithMeta.findIndex(m => m.type === 'knowledge_context');
        const directionModule = {
          type: 'direction_suggestion',
          label: msg.contextMeta.title || 'Suggested next question',
          title: msg.contextMeta.title || 'Suggested next question',
          question: msg.contextMeta.question || modulesWithMeta[knowledgeIdx]?.body || '',
          body: modulesWithMeta[knowledgeIdx]?.body || msg.contextMeta.question || '',
          cardType: msg.contextMeta.cardType || 'extend',
        };
        if (knowledgeIdx !== -1) modulesWithMeta[knowledgeIdx] = directionModule;
        else modulesWithMeta.unshift(directionModule);
      }
      visibleModules = modulesWithMeta.filter(m => m.type !== 'knowledge_context');
      const contextOnly = !!(msg.contextMeta && msg.contextMeta.type === 'direction_card' && !((userQuery || '').trim()));
      if (visibleModules.length > 0) {
        contextBarHtml = this._renderContextBar(visibleModules, { contextOnly });
      }
      displayContent = (msg.contextMeta && msg.contextMeta.type === 'direction_card' && !userQuery)
        ? ''
        : (userQuery || msg.content);
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
    if (msg.role === 'assistant') {
      // Historical messages: never leave loading markers (connections aren't persisted)
      const cleaned = this._stripConnectionResidue(msg.content || '');
      renderedContent = Utils.renderMarkdown(cleaned);
    } else {
      renderedContent = Utils.escapeHtml(displayContent);
    }

    const msgIdAttr = (msg.role === 'assistant' && msg.id)
      ? ` data-msg-id="${Utils.escapeHtml(msg.id)}"`
      : '';
    if (contextBarHtml && (msg.role !== 'user' || (displayContent || '').trim())) {
      el.innerHTML = `${attachHtml}<div class="message-bubble-group">${contextBarHtml}<div class="message-content"${msgIdAttr}>${renderedContent}</div></div>`;
    } else if (contextBarHtml) {
      el.innerHTML = `${attachHtml}<div class="message-bubble-group">${contextBarHtml}</div>`;
    } else {
      el.innerHTML = `${attachHtml}<div class="message-content"${msgIdAttr}>${renderedContent}</div>`;
    }
    container.appendChild(el);

    if (visibleModules.length > 0) {
      el.querySelectorAll('.ctx-tag').forEach(tag => {
        tag.addEventListener('click', () => {
          const idx = parseInt(tag.dataset.ctxIdx);
          const panel = el.querySelector('.ctx-detail-panel');
          if (panel.classList.contains('visible') && panel.dataset.activeIdx === String(idx)) {
            panel.classList.remove('visible');
            tag.classList.remove('active');
          } else {
            el.querySelectorAll('.ctx-tag').forEach(t => t.classList.remove('active'));
            panel.textContent = visibleModules[idx]?.body || '';
            panel.dataset.activeIdx = String(idx);
            panel.classList.add('visible');
            tag.classList.add('active');
          }
        });
      });
    }

    // Re-apply contested strike-through on connection markers after reload
    if (msg.role === 'assistant' && msg.connContested) {
      el.querySelectorAll('.conn-marker').forEach(m => m.classList.add('conn-marker-contested'));
    }

    // Render injected past context panel if present
    if (msg.role === 'assistant' && msg.injectedPastChats && msg.injectedPastChats.length > 0) {
      this._renderInjectedPastPanel(el, msg.injectedPastChats, { replay: true });
    }

    if (msg.role === 'assistant' && msg.id && Array.isArray(msg.suggestedHighlights)
        && msg.suggestedHighlights.length > 0) {
      const content = el.querySelector('.message-content');
      if (content) this._renderPendingHighlights(content, msg.suggestedHighlights);
    }

    if (msg.role === 'assistant' && msg.id && Array.isArray(msg.annotations) && msg.annotations.length > 0) {
      this._applyAnnotationsToDom(msg.id, msg.annotations);
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
      // Group by topic: show real topics first, then one-time and unclassified chats.
      const allTopics = Storage.getTopics().sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
      const realTopics = allTopics.filter(t => !this._isOneTimeTopic(t.id));
      const oneTimeTopic = allTopics.find(t => this._isOneTimeTopic(t.id));
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

      const oneTimeChats = oneTimeTopic
        ? chats.filter(c => c.topicId === oneTimeTopic.id)
          .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
        : [];
      if (oneTimeChats.length > 0) {
        const title = document.createElement('div');
        title.className = 'chat-list-group-title unassigned-group';
        title.textContent = 'One-time questions';
        container.appendChild(title);
        oneTimeChats.forEach(chat => container.appendChild(this._createChatItem(chat)));
      }
      if (noTopicChats.length > 0) {
        const title = document.createElement('div');
        title.className = 'chat-list-group-title unassigned-group';
        title.textContent = 'No topic yet';
        container.appendChild(title);
        noTopicChats
          .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
          .forEach(chat => container.appendChild(this._createChatItem(chat)));
      }
    }
  },

  _createChatItem(chat) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (chat.id === this.currentChatId ? ' active' : '');

    const topic = chat.topicId ? Storage.getTopic(chat.topicId) : null;
    const tc = (topic && !this._isOneTimeTopic(topic.id)) ? Utils.getTopicColor(topic) : { color: '#ccc' };

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
      const prevChatId = this.currentChatId;
      this._onExitChat(prevChatId);
      Sidebar._flushDirtyLabels();
      this._summarizeCurrentChat();
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
      t.id !== currentTopicId && !this._isOneTimeTopic(t.id)
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

    if (chatId === this.currentChatId && newTopic && !this._isOneTimeTopic(newTopic.id)) {
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
      Sidebar._applyTopicColor(topic);
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
            Sidebar._stageProposal(freshTopic, {
              overview: data.overview,
            }, 'rename');
            if (Sidebar.currentTopicId === topicId) {
              Sidebar._renderStatus(freshTopic.statusSummary || null);
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
      const mergedOverview = data.overview || (data.status && data.status.overview) || null;
      if (mergedOverview) {
        Sidebar._stageProposal(keepTopic, {
          overview: mergedOverview,
        }, 'merge');
      }
      keepTopic.sidebarCache = null;
      Storage.saveTopic(keepTopic);
    } catch (err) {
      console.warn('Post-merge status update failed:', err);
    }

    if (!this._isOneTimeTopic(keepTopicId)) {
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
