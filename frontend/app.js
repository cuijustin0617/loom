/* Loom main application controller */

const API_BASE = '';  // same origin

const App = {
  msgCountSinceRefresh: 0,
  currentChatId: null,
  inactivityTimer: null,
  pendingSummarize: false,
  pendingAttachments: [],
  useSearch: false,
  selectedTopicId: null,

  async init() {
    Storage.migrateTopicColors();
    Sidebar.init();
    this._bindEvents();
    this._loadState();

    // Inactivity timer for summarization
    this.inactivityTimer = new InactivityTimer(() => this._onInactive(), 120000);
    this.inactivityTimer.start();
  },

  _bindEvents() {
    document.getElementById('sendBtn').addEventListener('click', () => this.sendMessage());
    document.getElementById('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
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

    // Google Search grounding toggle
    const searchBtn = document.getElementById('searchToggleBtn');
    searchBtn.addEventListener('click', () => {
      this.useSearch = !this.useSearch;
      searchBtn.classList.toggle('active', this.useSearch);
      searchBtn.title = this.useSearch ? 'Google Search ON' : 'Google Search grounding';
    });

    // Summarize on tab leave
    window.addEventListener('beforeunload', () => this._summarizeCurrentChat());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._summarizeCurrentChat();
    });

    // Resize handles
    this._initResize('resizeLeft', 'leftSidebar', 'left');
    this._initResize('resizeRight', 'rightSidebar', 'right');

    // Sidebar collapse toggles
    this._initCollapseToggle('collapseLeftBtn', 'leftSidebar', 'left');
    this._initCollapseToggle('collapseRightBtn', 'rightSidebar', 'right');

    // Model selectors
    const chatModelSel = document.getElementById('chatModelSelect');
    chatModelSel.value = Storage.getChatModel();
    chatModelSel.addEventListener('change', () => Storage.setChatModel(chatModelSel.value));

    const sidebarModelSel = document.getElementById('sidebarModelSelect');
    sidebarModelSel.value = Storage.getSidebarModel();
    sidebarModelSel.addEventListener('change', () => Storage.setSidebarModel(sidebarModelSel.value));

    // Topic selector in input bar
    const topicSel = document.getElementById('topicSelect');
    topicSel.addEventListener('change', () => {
      this.selectedTopicId = topicSel.value || null;
    });
  },

  _initResize(handleId, sidebarId, side) {
    const handle = document.getElementById(handleId);
    const sidebar = document.getElementById(sidebarId);
    if (!handle || !sidebar) return;

    let startX, startWidth;

    const onMouseMove = (e) => {
      const delta = side === 'left' ? e.clientX - startX : startX - e.clientX;
      const newWidth = Math.max(
        side === 'left' ? 200 : 240,
        Math.min(side === 'left' ? 400 : 500, startWidth + delta)
      );
      sidebar.style.flexBasis = newWidth + 'px';
    };

    const onMouseUp = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sidebar-collapse-btn')) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
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
      const collapsed = sidebar.classList.toggle('collapsed');
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
    Storage.getTopics().forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    sel.value = prev || '';
    this.selectedTopicId = sel.value || null;
  },

  // ── Chat Operations ───────────────────────────────────────────────────

  newChat() {
    this._summarizeCurrentChat();
    const chat = Storage.createChat();
    this.currentChatId = chat.id;
    this.msgCountSinceRefresh = 0;
    this.pendingSummarize = false;
    this.selectedTopicId = null;
    const topicSel = document.getElementById('topicSelect');
    if (topicSel) topicSel.value = '';
    Sidebar.hide();
    this._renderChat(chat.id);
    this._renderChatList();
    document.getElementById('chatInput').focus();
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
        content = content
          ? `[Context from my knowledge map: ${fullText}]\n\n${content}`
          : `[Context from my knowledge map: ${fullText}]\n\nPlease continue based on this context.`;
      }
      this.clearContextBlock();
    }

    if (!content) return;

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
        const topic = Storage.getTopic(this.selectedTopicId);
        if (topic) {
          topic.lastActive = Utils.timestamp();
          Storage.saveTopic(topic);
          if (topic.statusSummary) {
            content = `[My current status in "${topic.name}": ${topic.statusSummary}]\n\n${content}`;
          }
          Sidebar.show(this.selectedTopicId);
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

    // Exit welcome mode and hide topic selector
    const mainContent = document.getElementById('mainContent');
    mainContent.classList.remove('welcome-mode');
    const welcomeSuggestions = document.getElementById('welcomeSuggestions');
    if (welcomeSuggestions) welcomeSuggestions.remove();
    const welcomeGreeting = document.querySelector('.welcome-greeting');
    if (welcomeGreeting) welcomeGreeting.remove();
    const topicSelEl = document.getElementById('topicSelect');
    if (topicSelEl) topicSelEl.style.display = 'none';

    document.getElementById('sendBtn').disabled = true;

    const messages = Storage.getMessages(this.currentChatId).map(m => ({
      role: m.role, content: m.content,
    }));
    const topics = Storage.getTopics().map(t => ({ id: t.id, name: t.name }));

    const reqBody = {
      chatId: this.currentChatId,
      messages,
      existingTopics: topics,
      existingConcepts: Storage.getConcepts().map(c => ({
        id: c.id, topicId: c.topicId, title: c.title, preview: c.preview,
      })),
      model: Storage.getChatModel(),
      useSearch: this.useSearch,
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'chunk') {
              fullResponse += evt.text;
              this._updateStreamingMessage(assistantEl, fullResponse);
            } else if (evt.type === 'done') {
              fullResponse = evt.response || fullResponse;
              this._finalizeStreamingMessage(assistantEl, fullResponse);

              // Save assistant message
              const assistantMsg = {
                id: 'msg_' + Utils.generateId(),
                chatId: this.currentChatId,
                role: 'assistant',
                content: fullResponse,
                contextBlock: null,
                timestamp: Utils.timestamp(),
              };
              Storage.addMessage(this.currentChatId, assistantMsg);

              if (evt.topic && evt.topic.confidence > 0.6) {
                await this._handleTopicDetection(evt.topic);
              }
              if (evt.concepts && evt.concepts.length > 0) {
                this._handleConcepts(evt.concepts);
              }
            } else if (evt.type === 'error') {
              this._finalizeStreamingMessage(assistantEl, evt.message || 'Error from server.');
            }
          } catch (_) { /* skip malformed SSE lines */ }
        }
      }

      // Update chat title from first exchange
      const chat = Storage.getChat(this.currentChatId);
      if (chat && chat.title === 'New Chat') {
        chat.title = Utils.truncate(messages[0]?.content || 'Chat', 40);
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
        document.getElementById('chatTitle').textContent = chat.title;
        this._renderChatList();
      }

      // Sidebar refresh logic
      this.msgCountSinceRefresh++;
      if (this.msgCountSinceRefresh === 1 || this.msgCountSinceRefresh % 3 === 0) {
        Sidebar.refresh();
      }

    } catch (err) {
      console.error('Chat error:', err);
      this._finalizeStreamingMessage(assistantEl, 'Failed to get response. Check your connection.');
      Utils.showToast('Failed to get response. Check your connection.', 'error');
    }

    document.getElementById('sendBtn').disabled = false;
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

  _updateStreamingMessage(el, text) {
    const contentEl = el.querySelector('.message-content');
    contentEl.innerHTML = Utils.renderMarkdown(text) + '<span class="streaming-cursor"></span>';
  },

  _finalizeStreamingMessage(el, text) {
    const contentEl = el.querySelector('.message-content');
    contentEl.innerHTML = Utils.renderMarkdown(text);
  },

  async _handleTopicDetection(topicData) {
    let topicId = topicData.matchedExistingId;

    if (!topicId && topicData.name) {
      // Check if there are 2+ chats that could form this topic, or auto-create
      const existing = Storage.getTopics().find(
        t => t.name.toLowerCase() === topicData.name.toLowerCase()
      );
      if (existing) {
        topicId = existing.id;
      } else {
        const topic = Storage.createTopic(topicData.name);
        topicId = topic.id;
      }
    }

    if (topicId) {
      const chat = Storage.getChat(this.currentChatId);
      if (chat) {
        chat.topicId = topicId;
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
      }

      const topic = Storage.getTopic(topicId);
      if (topic) {
        topic.lastActive = Utils.timestamp();
        Storage.saveTopic(topic);
      }

      Sidebar.show(topicId);
      this._renderChatList();
    }
  },

  _handleConcepts(concepts) {
    const chat = Storage.getChat(this.currentChatId);
    if (!chat || !chat.topicId) return;

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

  async _autoDetectTopics() {
    const unassigned = Storage.getChats().filter(c => !c.topicId && c.summary);
    if (unassigned.length < 2) return;

    try {
      const resp = await fetch(`${API_BASE}/api/topic/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatSummaries: unassigned.map(c => ({ id: c.id, summary: c.summary })),
          existingTopics: Storage.getTopics().map(t => ({ id: t.id, name: t.name })),
        }),
      });
      const data = await resp.json();

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
        }
        this._renderChatList();
        Utils.showToast(`Detected new topic${data.newTopics.length > 1 ? 's' : ''}: ${data.newTopics.map(t => t.name).join(', ')}`);
      }
    } catch (err) {
      console.warn('Auto-detect topics failed:', err);
    }
  },

  _onInactive() {
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
  },

  clearContextBlock() {
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
    } else {
      fullDiv.style.display = 'none';
      btn.textContent = 'Expand';
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
    if (messages.length === 0) {
      mainContent.classList.add('welcome-mode');
      this._renderWelcome(msgContainer);
      if (topicSel) topicSel.style.display = '';
    } else {
      mainContent.classList.remove('welcome-mode');
      messages.forEach(m => this._appendMessage(m));
      if (topicSel) topicSel.style.display = 'none';
    }

    if (chat?.topicId) {
      Sidebar.show(chat.topicId);
      this.msgCountSinceRefresh = 0;
    } else {
      Sidebar.hide();
    }

    this._highlightActiveChat(chatId);
  },

  _renderWelcome(container) {
    const suggestions = this._getSuggestionCards();
    let suggestionsHtml = '';
    if (suggestions.length > 0) {
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
      suggestionsHtml = `<div class="welcome-suggestions" id="welcomeSuggestions">${cardsHtml}</div>`;
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

    if (suggestions.length > 0) {
      this._bindSuggestionCards(suggestions);
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
        statusSummary: topic.statusSummary || '',
        title: dirs[0].title || '',
        question: dirs[0].question || '',
      });
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
        if (s) this._startSuggestedChat(s);
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
      Sidebar.show(suggestion.topicId);
    }

    let content = suggestion.question;
    if (suggestion.statusSummary) {
      content = `[My current status in "${suggestion.topicName}": ${suggestion.statusSummary}]\n\n${content}`;
    }

    // Set the input and auto-send
    document.getElementById('chatInput').value = content;
    this.sendMessage();
  },

  _appendMessage(msg) {
    const container = document.getElementById('chatMessages');

    const el = document.createElement('div');
    el.className = `message ${msg.role}`;

    let contextHtml = '';
    if (msg.contextBlock) {
      contextHtml = `<div class="context-indicator">📎 With added context</div>`;
    }

    let attachHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      const thumbs = msg.attachments.map(att => {
        if (att.mimeType && att.mimeType.startsWith('image/')) {
          return `<img src="data:${att.mimeType};base64,${att.data}" style="max-width:200px;max-height:200px;border-radius:8px;margin:4px 0;">`;
        }
        return `<div style="font-size:11px;color:var(--text-muted);">📎 ${Utils.escapeHtml(att.name || 'file')}</div>`;
      }).join('');
      attachHtml = `<div class="message-attachments">${thumbs}</div>`;
    }

    const rendered = msg.role === 'assistant' ? Utils.renderMarkdown(msg.content) : Utils.escapeHtml(msg.content);
    el.innerHTML = `${contextHtml}${attachHtml}<div class="message-content">${rendered}</div>`;
    container.appendChild(el);
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
      sorted.forEach(chat => container.appendChild(this._createChatItem(chat)));
    } else {
      // Group by topic
      const topics = Storage.getTopics().sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
      const unassigned = chats.filter(c => !c.topicId);

      topics.forEach(topic => {
        const topicChats = chats.filter(c => c.topicId === topic.id)
          .sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive));
        if (topicChats.length === 0) return;

        const title = document.createElement('div');
        title.className = 'chat-list-group-title';
        title.dataset.topicId = topic.id;
        title.innerHTML = `<span>${Utils.escapeHtml(topic.name)}</span>`;
        if (topics.length > 1) {
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
            this._openMergeDialog(topic.id);
          });
          title.appendChild(mergeBtn);
        }
        container.appendChild(title);
        topicChats.forEach(chat => container.appendChild(this._createChatItem(chat)));
      });

      if (unassigned.length > 0) {
        const title = document.createElement('div');
        title.className = 'chat-list-group-title';
        title.textContent = 'Unassigned';
        container.appendChild(title);
        unassigned.sort((a, b) => new Date(b.lastActive) - new Date(a.lastActive))
          .forEach(chat => container.appendChild(this._createChatItem(chat)));
      }
    }
  },

  _createChatItem(chat) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (chat.id === this.currentChatId ? ' active' : '');

    const topic = chat.topicId ? Storage.getTopic(chat.topicId) : null;
    const tc = topic ? Utils.getTopicColor(topic) : { color: '#ccc' };

    el.innerHTML = `
      <span class="topic-dot" style="background:${tc.color}"></span>
      <div class="chat-item-info">
        <div class="chat-item-title">${Utils.escapeHtml(chat.title)}</div>
        ${chat.summary ? `<div class="chat-item-summary">${Utils.escapeHtml(Utils.truncate(chat.summary, 50))}</div>` : ''}
      </div>
      <button class="chat-delete-btn" title="Delete chat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    `;

    const deleteBtn = el.querySelector('.chat-delete-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._deleteChat(chat.id, chat.topicId);
    });

    el.addEventListener('click', () => {
      this._summarizeCurrentChat();
      this.msgCountSinceRefresh = 0;
      this._renderChat(chat.id);
      this._renderChatList();
    });
    return el;
  },

  _deleteChat(chatId, topicId) {
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
      keepTopic.statusSummary = data.status || keepTopic.statusSummary;
      keepTopic.statusLastUpdated = Utils.timestamp();
      keepTopic.sidebarCache = null;
      Storage.saveTopic(keepTopic);
    } catch (err) {
      console.warn('Post-merge status update failed:', err);
    }

    Sidebar.show(keepTopicId);
    Sidebar.refresh();
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
    Storage.createTopic(name, desc);
    this._hideTopicDialog();
    this._renderChatList();
  },
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
