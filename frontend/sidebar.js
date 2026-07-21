/* Right sidebar: Unified Past · Current · Future temporal context probe */

const Sidebar = {
  currentTopicId: null,
  currentData: null,
  _labelsDirty: false,

  init() {
    this._initStatusDrag();
    this._initStatusUpdate();
    this._initMergeDialog();
    this._initShuffle();
    this._initModuleCollapse();
    if (localStorage.getItem('loom_sidebarTab') === 'graph') {
      localStorage.setItem('loom_sidebarTab', 'list');
    }
  },

  _activateListTab() {
    if (this.currentTopicId) {
      ['sectionPast', 'sectionCurrent', 'sectionFuture'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
      });
    }
  },

  // ── Lifecycle ─────────────────────────────────────────────────────────

  show(topicId) {
    if (STUDY_CONDITION === 'baseline') return;
    this.currentTopicId = topicId;
    StudyLog.event('past_lookup', { topicId });
    document.getElementById('sidebarEmpty').style.display = 'none';

    const topic = Storage.getTopic(topicId);
    if (topic) {
      const tc = Utils.getTopicColor(topic);
      const badge = document.getElementById('topicBadge');
      badge.style.display = 'inline-block';
      badge.textContent = topic.name;
      badge.style.background = tc.light;
      badge.style.color = tc.color;

      document.getElementById('pastTopicName').textContent = topic.name;
      document.getElementById('currentTopicName').textContent = topic.name;

      this._activateListTab();

      if (topic.sidebarCache) {
        this.currentData = topic.sidebarCache;
        this.render(topic.sidebarCache, topic);
        return;
      }
    }
    this._showLoading();
  },

  showBaseline() {
    document.getElementById('sidebarEmpty').style.display = 'none';
    const baselineModule = document.getElementById('moduleBaseline');
    if (baselineModule) baselineModule.style.display = 'block';
    const details = Storage.getPersonalDetails();
    if (details.length > 0) App._renderBaselineDetails(details);
  },

  hide() {
    this.currentTopicId = null;
    document.getElementById('sectionPast').style.display = 'none';
    document.getElementById('sectionCurrent').style.display = 'none';
    document.getElementById('sectionFuture').style.display = 'none';
    document.getElementById('topicBadge').style.display = 'none';

    if (STUDY_CONDITION === 'baseline') {
      document.getElementById('sidebarEmpty').style.display = 'none';
      this.showBaseline();
    } else {
      document.getElementById('sidebarEmpty').style.display = 'block';
      const baselineModule = document.getElementById('moduleBaseline');
      if (baselineModule) baselineModule.style.display = 'none';
    }
  },

  async refresh() {
    if (!this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return;

    const chatId = Storage.getCurrentChatId();
    const messages = Storage.getMessages(chatId).map(m => {
      if (m.role === 'assistant' && m.chunkLabels && Object.keys(m.chunkLabels).length > 0) {
        return { role: m.role, content: App._injectChunkLabels(m.content, m.chunkLabels) };
      }
      return { role: m.role, content: m.content };
    });
    if (messages.length === 0) return;
    this._labelsDirty = false;
    this._showLoading();

    try {
      const allChats = Storage.getAllChatSummariesForTopic(topic.id).filter(c => c.id !== chatId);
      const allConcepts = Storage.getConceptsByTopic(topic.id);

      const resp = await fetch('/api/sidebar/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          messages,
          topicId: topic.id,
          topicName: topic.name,
          topicStatus: this._serializeStatus(topic.statusSummary),
          allChatSummaries: allChats,
          allConcepts: allConcepts.map(c => ({ id: c.id, title: c.title, preview: c.preview })),
          model: Storage.getSidebarModel(),
        }),
      });

      const data = await resp.json();
      this.currentData = data;
      this.render(data, topic);

      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        freshTopic.sidebarCache = data;
        Storage.saveTopic(freshTopic);
      }
    } catch (err) {
      console.error('Sidebar refresh failed:', err);
      Utils.showToast('Sidebar refresh failed', 'error');
    }
  },

  render(data, topic) {
    if (!topic) topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return;

    // Current: update profile if new data
    let statusData = data.statusUpdate || topic.statusSummary || null;
    if (data.statusUpdate) {
      const oldConcepts = (topic.statusSummary && topic.statusSummary.concepts_traversed) || [];
      const merged = {
        overview: data.statusUpdate.overview || [],
        concepts_traversed: this._sortConcepts(
          this._mergeStances(data.statusUpdate.concepts_traversed || [], oldConcepts)
        ),
      };
      topic.statusSummary = merged;
      topic.statusLastUpdated = Utils.timestamp();
      Storage.saveTopic(topic);
      statusData = merged;
    }
    this._renderStatus(statusData);

    // Past: clear loading skeleton — past chats are populated by showPastChats() after each response
    const pastList = document.getElementById('pastChatsList');
    if (pastList && pastList.querySelector('.skeleton')) {
      pastList.innerHTML = '<p class="temporal-empty-hint">Past context will appear here after your first response.</p>';
    }

    // Future: directions — always breadth first, depth second
    const dirContainer = document.getElementById('directionCards');
    dirContainer.innerHTML = '';
    const dirs = [...(data.newDirections || [])].sort((a, b) => {
      const order = { breadth: 0, depth: 1 };
      return (order[a.type] ?? 2) - (order[b.type] ?? 2);
    });
    if (dirs.length === 0) {
      dirContainer.innerHTML = '<p class="temporal-empty-hint">Keep chatting to generate future directions.</p>';
    }
    dirs.forEach((dir, idx) => dirContainer.appendChild(this._createDirectionCard(dir, idx)));
  },

  // ── Past: Persistent Section ──────────────────────────────────────────

  /**
   * Render the Past section with the injected past chats from this response.
   * Called from app.js after each assistant response.
   */
  showPastChats(injectedPastChats) {
    const container = document.getElementById('pastChatsList');
    if (!container) return;
    if (!injectedPastChats || injectedPastChats.length === 0) {
      container.innerHTML = '<p class="temporal-empty-hint">No relevant past chats found for this question.</p>';
      return;
    }
    container.innerHTML = '';
    injectedPastChats.forEach((chat, idx) => {
      container.appendChild(this._createPastChatCard(chat, idx));
    });
    StudyLog.event('past_lookup', { topicId: this.currentTopicId, count: injectedPastChats.length });
  },

  _createPastChatCard(chat, idx) {
    const el = document.createElement('div');
    el.className = 'temporal-card past-chat-card';
    el.draggable = true;

    const title = Utils.escapeHtml(chat.title || 'Past conversation');
    const userAsked = chat.userAsked ? Utils.escapeHtml(chat.userAsked.slice(0, 120)) : '';
    const aiCovered = chat.aiCovered ? Utils.escapeHtml(chat.aiCovered.slice(0, 80)) : '';

    el.innerHTML = `
      <div class="temporal-card-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11" class="temporal-card-icon">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <span class="temporal-card-title">${title}</span>
      </div>
      ${userAsked ? `<div class="temporal-card-excerpt">${userAsked}</div>` : ''}
      <div class="temporal-card-meta">Retrieved via text similarity</div>
      <div class="temporal-card-actions">
        <button class="probe-btn probe-relevant" data-idx="${idx}" title="Mark as relevant">Relevant</button>
        <button class="probe-btn probe-not-relevant" data-idx="${idx}" title="Mark as not relevant">Not relevant</button>
        <button class="past-build-btn" data-chat-id="${Utils.escapeHtml(chat.chatId || '')}" data-title="${title}" title="Build on this chat">Build on this →</button>
      </div>
    `;

    // Probe calibration buttons
    el.querySelector('.probe-relevant').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('past_relevance_calibrated', { topicId: this.currentTopicId, chatId: chat.chatId, decision: 'relevant', idx });
      el.querySelector('.probe-relevant').classList.add('probe-active');
      el.querySelector('.probe-not-relevant').classList.remove('probe-active');
    });
    el.querySelector('.probe-not-relevant').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('past_relevance_calibrated', { topicId: this.currentTopicId, chatId: chat.chatId, decision: 'not_relevant', idx });
      el.querySelector('.probe-not-relevant').classList.add('probe-active');
      el.querySelector('.probe-relevant').classList.remove('probe-active');
    });

    // Build on this
    el.querySelector('.past-build-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('past_build_on_click', { topicId: this.currentTopicId, chatId: chat.chatId, idx });
      const pastMessages = Storage.getMessages(chat.chatId || '');
      let contextText = '';
      if (pastMessages.length > 0) {
        const parts = ['--- Previous conversation ---'];
        pastMessages.forEach(m => {
          const role = m.role === 'user' ? 'User' : 'AI';
          const text = (m.content || '').slice(0, 600);
          parts.push(`${role}: ${text}${(m.content || '').length > 600 ? '...' : ''}`);
        });
        parts.push('--- End ---');
        contextText = parts.join('\n');
      } else {
        contextText = chat.userAsked ? `[Past context] ${chat.userAsked}` : title;
      }
      App.setContextBlock(contextText, `[Past Context] ${chat.title || 'Past conversation'}`, {
        type: 'past_chat',
        title: chat.title || '',
      });
    });

    // Drag to chat
    el.addEventListener('dragstart', (e) => {
      const fullText = userAsked || title;
      e.dataTransfer.setData('text/plain', fullText);
      e.dataTransfer.setData('application/loom-label', `[Past Context] ${chat.title || 'Past conversation'}`);
      e.dataTransfer.setData('application/loom-context-type', 'past_chat');
      el.classList.add('dragging');
      StudyLog.event('past_card_dragged', { topicId: this.currentTopicId, chatId: chat.chatId, idx });
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    return el;
  },

  // ── Current: Concepts Traversed ───────────────────────────────────────

  _renderStatus(statusData) {
    const container = this._getStatusContainer();
    if (!container) return;
    if (!statusData) {
      container.innerHTML = '<p class="temporal-empty-hint">Chat to build your current profile.</p>';
      return;
    }

    const overview = (typeof statusData === 'string')
      ? [statusData]
      : (statusData.overview || []);
    // Support new concepts_traversed schema; fall back gracefully for old data
    const concepts = (typeof statusData === 'object' && statusData.concepts_traversed)
      ? statusData.concepts_traversed
      : this._migrateThreadsToConcepts(statusData);

    let html = '';

    // Overview bullets
    if (overview.length > 0) {
      const overviewCollapsed = localStorage.getItem('loom_overviewCollapsed') === 'true';
      html += `
        <div class="status-section status-section-overview">
          <div class="status-section-label collapsible${overviewCollapsed ? ' section-collapsed' : ''}" data-section-toggle="overview">
            <span class="section-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="8" height="8"><polyline points="6 9 12 15 18 9"/></svg></span>
            Overview
            <button class="overview-ai-edit-btn" title="AI edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>
            </button>
          </div>
          <div class="overview-ai-prompt-slot"></div>
          <div class="status-section-items${overviewCollapsed ? ' section-collapsed' : ''}" data-section-items="overview">
      `;
      overview.forEach((pt, i) => {
        html += `<div class="status-item" data-section="overview" data-idx="${i}">
          <span class="status-item-text">${Utils.escapeHtml(pt)}</span>
          <span class="status-item-actions">
            <button class="status-item-btn status-item-del" title="Remove">×</button>
          </span></div>`;
      });
      html += '</div></div>';
    }

    // Concepts traversed — stance-tagged draggable chips (classified on top, neutral by frequency)
    const sortedConcepts = this._sortConcepts(concepts);
    if (typeof statusData === 'object') {
      statusData.concepts_traversed = sortedConcepts;
    }

    html += `<div class="status-section status-section-concepts">
      <div class="status-section-label">Concepts Traversed <span style="font-weight:400;color:var(--text-muted);font-size:10px;">· drag to classify</span></div>
      <div class="concept-drop-tray" id="conceptDropZones" style="display:none;">
        <div class="drop-zone zone-interested" data-stance="interested">Interested</div>
        <div class="drop-zone zone-understood" data-stance="understood">✓ Understood</div>
        <div class="drop-zone zone-not-interested" data-stance="not_interested">✗ Not Relevant</div>
      </div>
      <div class="concept-tags-container" id="conceptTagsContainer">`;
    if (sortedConcepts.length === 0) {
      html += '<span class="temporal-empty-hint" style="font-size:11px;">No concepts tracked yet.</span>';
    } else {
      const stanceIcon = { interested: '', understood: '✓', not_interested: '✗', neutral: '' };
      const classified = sortedConcepts.filter(c => c.stance && c.stance !== 'neutral');
      const unclassified = sortedConcepts.filter(c => !c.stance || c.stance === 'neutral');

      const renderTag = (c, i) => {
        const title = Utils.escapeHtml(c.title || '');
        const stance = c.stance || 'neutral';
        const icon = stanceIcon[stance] || '';
        const countBadge = stance === 'neutral'
          ? `<span class="concept-count" title="Mentioned ${c.mentions || 1} time${(c.mentions || 1) !== 1 ? 's' : ''}">${c.mentions || 1}</span>`
          : '';
        return `<span class="concept-tag stance-${stance}" data-concept-idx="${i}" data-stance="${stance}" draggable="true" title="Drag to classify · × to remove">
          ${icon ? `<span class="stance-icon">${icon}</span>` : ''}${title}${countBadge}<button class="concept-delete-btn" data-idx="${i}" title="Remove">×</button>
        </span>`;
      };

      if (classified.length > 0) {
        html += '<div class="concept-tags-group concept-tags-classified">';
        classified.forEach(c => {
          const i = sortedConcepts.indexOf(c);
          html += renderTag(c, i);
        });
        html += '</div>';
      }
      if (unclassified.length > 0) {
        if (classified.length > 0) html += '<div class="concept-tags-divider"></div>';
        html += '<div class="concept-tags-group concept-tags-unclassified">';
        if (classified.length > 0) {
          html += '<div class="concept-tags-group-label">Unclassified · most mentioned first</div>';
        }
        unclassified.forEach(c => {
          const i = sortedConcepts.indexOf(c);
          html += renderTag(c, i);
        });
        html += '</div>';
      }
    }
    html += `</div></div>`;

    if (!html) {
      html = '<p class="temporal-empty-hint">Chat more to build your profile.</p>';
    }
    container.innerHTML = html;
    this._bindStatusItemActions();
  },

  /** Migrate old threads/specifics or checked:bool data to stance-based concept list */
  _migrateThreadsToConcepts(statusData) {
    if (!statusData || typeof statusData === 'string') return [];
    const result = [];
    // Extract from threads
    (statusData.threads || []).forEach(thread => {
      if (thread.label) result.push({ title: thread.label, stance: 'neutral' });
      (thread.steps || []).forEach(s => {
        const text = typeof s === 'string' ? s : (s.text || '');
        if (text) result.push({ title: text.slice(0, 40), stance: 'neutral' });
      });
    });
    // Extract from specifics
    (statusData.specifics || []).forEach(s => {
      const text = typeof s === 'string' ? s : (s.text || '');
      if (text) result.push({ title: text.slice(0, 40), stance: 'neutral' });
    });
    return result.slice(0, 20);
  },

  _normalizeConcept(c) {
    if (typeof c === 'string') return { title: c, stance: 'neutral', mentions: 1 };
    const stance = c.stance || (c.checked ? 'understood' : 'neutral');
    return {
      title: c.title || '',
      stance,
      mentions: Math.max(1, c.mentions || 1),
    };
  },

  _sortConcepts(concepts) {
    const STANCE_ORDER = { interested: 0, understood: 1, not_interested: 2, neutral: 3 };
    return (concepts || []).map(c => this._normalizeConcept(c)).sort((a, b) => {
      const sa = STANCE_ORDER[a.stance] ?? 3;
      const sb = STANCE_ORDER[b.stance] ?? 3;
      if (sa !== sb) return sa - sb;
      return (b.mentions || 1) - (a.mentions || 1);
    });
  },

  /** Preserve user stances and mention counts when new concepts come in from backend */
  _mergeStances(newConcepts, oldConcepts) {
    const oldMap = Object.fromEntries(
      (oldConcepts || []).map(c => {
        const norm = this._normalizeConcept(c);
        return [norm.title.toLowerCase(), norm];
      })
    );
    return (newConcepts || []).map(c => {
      const title = typeof c === 'object' ? c.title : c;
      const key = title?.toLowerCase();
      const prev = oldMap[key];
      if (prev) {
        return {
          title,
          stance: prev.stance,
          mentions: prev.mentions + 1,
        };
      }
      return { title, stance: 'neutral', mentions: 1 };
    });
  },

  _bindStatusItemActions() {
    const container = this._getStatusContainer();
    if (!container) return;

    // Overview delete
    container.querySelectorAll('.status-item .status-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.status-item');
        const section = item.dataset.section;
        const idx = parseInt(item.dataset.idx);
        this._deleteStatusItem(section, idx);
      });
    });

    // Overview inline edit on double-click
    container.querySelectorAll('.status-item[data-section]').forEach(item => {
      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._startInlineEdit(item, item.dataset.section, parseInt(item.dataset.idx));
      });
    });

    // AI-edit button for overview
    container.querySelectorAll('.overview-ai-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this._showAiEditPrompt();
      });
    });

    // Concept tag drag-to-classify
    const dropTray = container.querySelector('#conceptDropZones');
    let draggingIdx = null;

    container.querySelectorAll('.concept-tag').forEach(tag => {
      tag.addEventListener('dragstart', (e) => {
        draggingIdx = parseInt(tag.dataset.conceptIdx);
        tag.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        if (dropTray) {
          dropTray.style.display = 'flex';
          dropTray.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
      tag.addEventListener('dragend', () => {
        tag.classList.remove('dragging');
        draggingIdx = null;
        if (dropTray) dropTray.style.display = 'none';
        container.querySelectorAll('.drop-zone').forEach(z => z.classList.remove('drag-over'));
      });
    });

    if (dropTray) {
      dropTray.querySelectorAll('.drop-zone').forEach(zone => {
        zone.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          zone.classList.add('drag-over');
        });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          zone.classList.remove('drag-over');
          if (draggingIdx !== null) {
            this._setConceptStance(draggingIdx, zone.dataset.stance);
          }
          dropTray.style.display = 'none';
        });
      });
    }

    // Concept delete
    container.querySelectorAll('.concept-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        this._deleteConcept(idx);
      });
    });
  },

  _setConceptStance(idx, stance) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const concepts = topic.statusSummary.concepts_traversed;
    if (!concepts || idx < 0 || idx >= concepts.length) return;
    const c = this._normalizeConcept(concepts[idx]);
    const previousStance = c.stance;
    const title = c.title;
    concepts[idx] = { title, stance, mentions: c.mentions };
    topic.statusSummary.concepts_traversed = this._sortConcepts(concepts);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_concept_stance_set', {
      topicId: this.currentTopicId,
      conceptTitle: title,
      stance,
      previousStance,
    });
  },

  _deleteConcept(idx) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const concepts = topic.statusSummary.concepts_traversed;
    if (!concepts || idx < 0 || idx >= concepts.length) return;
    concepts.splice(idx, 1);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_concept_toggled', { topicId: this.currentTopicId, conceptIdx: idx, deleted: true });
  },

  _startInlineEdit(item, section, idx) {
    const textEl = item.querySelector('.status-item-text');
    if (!textEl) return;
    const original = textEl.textContent;
    const input = document.createElement('textarea');
    input.className = 'status-inline-edit';
    input.value = original;
    input.rows = 1;
    textEl.replaceWith(input);
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    input.focus();
    input.select();
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    });
    const save = () => {
      const val = input.value.trim();
      if (val && val !== original) this._editStatusItem(section, idx, val);
      else this._renderStatus(this._getCurrentStatus());
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = original; input.blur(); }
    });
  },

  _getCurrentStatus() {
    if (!this.currentTopicId) return null;
    const topic = Storage.getTopic(this.currentTopicId);
    return topic ? topic.statusSummary : null;
  },

  _deleteStatusItem(section, idx) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_profile_edited', { topicId: this.currentTopicId, section, editType: 'delete', itemIdx: idx });
  },

  _editStatusItem(section, idx, newText) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    if (section === 'overview') arr[idx] = newText;
    else {
      if (typeof arr[idx] === 'object') arr[idx].text = newText;
      else arr[idx] = newText;
    }
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_profile_edited', { topicId: this.currentTopicId, section, editType: 'edit', itemIdx: idx });
  },

  _showAiEditPrompt() {
    const container = this._getStatusContainer();
    if (!container) return;
    const slot = container.querySelector('.overview-ai-prompt-slot');
    if (!slot) return;
    const existing = slot.querySelector('.overview-ai-prompt');
    if (existing) { existing.remove(); return; }

    const row = document.createElement('div');
    row.className = 'overview-ai-prompt';
    row.innerHTML = `<textarea class="overview-ai-input" placeholder="Describe a change..." rows="1"></textarea><button class="overview-ai-send" title="Apply"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;
    slot.appendChild(row);

    const input = row.querySelector('.overview-ai-input');
    const sendBtn = row.querySelector('.overview-ai-send');
    input.focus();
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
    });

    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      this._submitAiEdit(text, row, sendBtn);
    };
    const dismiss = () => row.remove();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') dismiss();
    });
    sendBtn.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  },

  async _submitAiEdit(instruction, promptRow, sendBtn) {
    if (!this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const overview = topic.statusSummary.overview || [];

    const input = promptRow.querySelector('.overview-ai-input');
    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('loading');

    try {
      const resp = await fetch('/api/topic/status/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName: topic.name,
          overview,
          instruction,
          model: Storage.getSidebarModel(),
        }),
      });
      const data = await resp.json();
      const newOverview = data.overview || overview;
      topic.statusSummary.overview = newOverview;
      topic.statusLastUpdated = Utils.timestamp();
      if (topic.sidebarCache && topic.sidebarCache.statusUpdate) {
        topic.sidebarCache.statusUpdate.overview = newOverview;
      }
      Storage.saveTopic(topic);
      this._renderStatus(topic.statusSummary);
      Utils.showToast('Profile updated', 'success');
      StudyLog.event('current_profile_edited', { topicId: this.currentTopicId, trigger: 'ai_edit' });
    } catch (err) {
      console.error('AI overview edit failed:', err);
      Utils.showToast('AI edit failed', 'error');
      input.disabled = false;
      sendBtn.disabled = false;
      sendBtn.classList.remove('loading');
    }
  },

  _serializeStatus(statusSummary) {
    if (!statusSummary) return '';
    if (typeof statusSummary === 'string') return statusSummary;
    const parts = [];
    if (statusSummary.overview && statusSummary.overview.length > 0) {
      parts.push('Overview: ' + statusSummary.overview.join('; '));
    }
    const concepts = statusSummary.concepts_traversed || [];
    if (concepts.length > 0) {
      const byStance = { interested: [], understood: [], not_interested: [], neutral: [] };
      concepts.forEach(c => {
        const title = typeof c === 'object' ? c.title : c;
        const stance = typeof c === 'object' ? (c.stance || (c.checked ? 'understood' : 'neutral')) : 'neutral';
        if (title) (byStance[stance] || byStance.neutral).push(title);
      });
      if (byStance.interested.length > 0)
        parts.push('Interested in (prioritize these): ' + byStance.interested.join(', '));
      if (byStance.understood.length > 0)
        parts.push('Understood already (assume base knowledge): ' + byStance.understood.join(', '));
      if (byStance.not_interested.length > 0)
        parts.push('Not interested (avoid): ' + byStance.not_interested.join(', '));
      if (byStance.neutral.length > 0)
        parts.push('Concepts encountered (neutral): ' + byStance.neutral.join(', '));
    }
    // Legacy fallback
    if (statusSummary.threads && !statusSummary.concepts_traversed) {
      statusSummary.threads.forEach(t => {
        const stepStrs = (t.steps || []).map(s =>
          typeof s === 'object' ? s.text : s
        );
        parts.push(`Topic area "${t.label}": ${stepStrs.join(', ')}`);
      });
    }
    return parts.join('\n');
  },

  // ── Future: Direction Cards ───────────────────────────────────────────

  _createDirectionCard(dir, directionIdx) {
    const el = document.createElement('div');
    const typeClass = dir.type === 'breadth' ? 'type-breadth' : dir.type === 'depth' ? 'type-depth' : '';
    el.className = `temporal-card direction-card${typeClass ? ' ' + typeClass : ''}`;
    el.draggable = true;

    const badgeHtml = dir.type === 'breadth'
      ? `<div class="direction-type-badge badge-breadth"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg> Go Broader</div>`
      : dir.type === 'depth'
        ? `<div class="direction-type-badge badge-depth"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg> Go Deeper</div>`
        : '';
    const anchorHtml = dir.anchor
      ? `<div class="direction-anchor">${Utils.escapeHtml(dir.anchor)}</div>`
      : '';
    const reasonHtml = dir.reason
      ? `<div class="direction-reason">${Utils.escapeHtml(dir.reason)}</div>`
      : '';

    el.innerHTML = `
      ${badgeHtml}
      ${anchorHtml}
      <div class="temporal-card-header">
        <span class="temporal-card-title">${Utils.escapeHtml(dir.title || '')}</span>
      </div>
      <div class="temporal-card-question">${Utils.escapeHtml(dir.question || '')}</div>
      ${reasonHtml}
      <div class="temporal-card-actions">
        <button class="probe-btn probe-accept" title="Accept this suggestion">Accept</button>
        <button class="probe-btn probe-ignore" title="Ignore this suggestion">Ignore</button>
        <button class="card-new-chat-btn" title="Ask in new chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Ask
        </button>
      </div>
    `;

    // Probe action buttons
    el.querySelector('.probe-accept').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('future_suggestion_accepted', { topicId: this.currentTopicId, directionIdx, title: dir.title });
      el.querySelector('.probe-accept').classList.add('probe-active');
      el.querySelector('.probe-ignore').classList.remove('probe-active');
    });
    el.querySelector('.probe-ignore').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('future_suggestion_ignored', { topicId: this.currentTopicId, directionIdx, title: dir.title });
      el.querySelector('.probe-ignore').classList.add('probe-active');
      el.querySelector('.probe-accept').classList.remove('probe-active');
    });

    // New chat
    el.querySelector('.card-new-chat-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('future_direction_new_chat', { topicId: this.currentTopicId, directionIdx });
      this._startDirectionInNewChat(dir);
    });

    // Drag to chat
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', dir.question || '');
      e.dataTransfer.setData('application/loom-label', `[Future Direction] ${dir.title || ''}`);
      e.dataTransfer.setData('application/loom-context-type', 'future_direction');
      e.dataTransfer.setData('application/loom-question', dir.question || '');
      el.classList.add('dragging');
      StudyLog.event('future_suggestion_dragged', { topicId: this.currentTopicId, directionIdx, title: dir.title });
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    // Click to inject in chat
    el.addEventListener('click', () => {
      StudyLog.event('future_direction_clicked', { topicId: this.currentTopicId, directionIdx });
      App.setContextBlock(dir.question || '', `[Future Direction] ${dir.title || ''}`, {
        type: 'future_direction',
        title: dir.title || '',
        question: dir.question || '',
      });
    });

    return el;
  },

  _startDirectionInNewChat(dir) {
    const topicId = this.currentTopicId;
    App.newChat();
    if (topicId) {
      App.selectedTopicId = topicId;
      const topicSel = document.getElementById('topicSelect');
      if (topicSel) topicSel.value = topicId;
    }
    document.getElementById('chatInput').value = dir.question || '';
    App.sendMessage();
  },

  // ── Loading State ─────────────────────────────────────────────────────

  _showLoading() {
    const sc = this._getStatusContainer();
    if (sc) sc.innerHTML = `
      <div class="skeleton skeleton-line" style="width:90%"></div>
      <div class="skeleton skeleton-line" style="width:70%"></div>
      <div class="skeleton skeleton-line" style="width:80%"></div>
    `;
    // Past section is not loaded here — it's populated by showPastChats() from the SSE done event
    const pastList = document.getElementById('pastChatsList');
    if (pastList && !pastList.querySelector('.past-chat-card')) {
      pastList.innerHTML = '<p class="temporal-empty-hint">Past context will appear here after your first response.</p>';
    }
    const dirCards = document.getElementById('directionCards');
    if (dirCards) dirCards.innerHTML = '<div class="skeleton skeleton-card"></div>';
  },

  _getStatusContainer() {
    return document.getElementById('statusStructured');
  },

  // ── Status Update Button ──────────────────────────────────────────────

  _initStatusUpdate() {
    const btn = document.getElementById('statusUpdateHeaderBtn');
    if (!btn) return;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!this.currentTopicId) return;
      const topic = Storage.getTopic(this.currentTopicId);
      if (!topic) return;

      btn.classList.add('loading');
      btn.disabled = true;

      try {
        const summaries = Storage.getAllChatSummariesForTopic(topic.id);
        const chatId = Storage.getCurrentChatId();
        const currentMessages = Storage.getMessages(chatId).map(m => {
          if (m.role === 'assistant' && m.chunkLabels && Object.keys(m.chunkLabels).length > 0) {
            return { role: m.role, content: App._injectChunkLabels(m.content, m.chunkLabels) };
          }
          return { role: m.role, content: m.content };
        });
        this._labelsDirty = false;
        const resp = await fetch('/api/topic/status/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topicName: topic.name,
            currentStatus: this._serializeStatus(topic.statusSummary),
            recentSummaries: summaries.map(s => s.summary),
            currentMessages,
            model: Storage.getSidebarModel(),
          }),
        });
        const data = await resp.json();
        let newStatus;
        if (data.overview || data.concepts_traversed) {
          const oldConcepts = (topic.statusSummary && topic.statusSummary.concepts_traversed) || [];
          newStatus = {
            overview: data.overview || [],
            concepts_traversed: this._sortConcepts(
              this._mergeStances(data.concepts_traversed || [], oldConcepts)
            ),
          };
        } else {
          newStatus = data.status || topic.statusSummary;
        }
        topic.statusSummary = newStatus;
        topic.statusLastUpdated = Utils.timestamp();
        if (topic.sidebarCache) topic.sidebarCache.statusUpdate = newStatus;
        Storage.saveTopic(topic);
        this._renderStatus(newStatus);
        Utils.showToast('Current profile updated', 'success');
        StudyLog.event('current_profile_updated', { topicId: this.currentTopicId, trigger: 'manual' });
      } catch (err) {
        console.error('Status update failed:', err);
        Utils.showToast('Update failed', 'error');
      }
      btn.classList.remove('loading');
      btn.disabled = false;
    });
  },

  _flushDirtyLabels() {
    if (!this._labelsDirty || !this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return;

    const chatId = Storage.getCurrentChatId();
    const messages = Storage.getMessages(chatId).map(m => {
      if (m.role === 'assistant' && m.chunkLabels && Object.keys(m.chunkLabels).length > 0) {
        return { role: m.role, content: App._injectChunkLabels(m.content, m.chunkLabels) };
      }
      return { role: m.role, content: m.content };
    });
    if (messages.length === 0) return;

    this._labelsDirty = false;
    const summaries = Storage.getAllChatSummariesForTopic(topic.id);
    const topicId = this.currentTopicId;

    fetch('/api/topic/status/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicName: topic.name,
        currentStatus: this._serializeStatus(topic.statusSummary),
        recentSummaries: summaries.map(s => s.summary),
        currentMessages: messages,
        model: Storage.getSidebarModel(),
      }),
    }).then(resp => resp.json()).then(data => {
      let newStatus;
      if (data.overview || data.concepts_traversed) {
        const oldConcepts = (topic.statusSummary && topic.statusSummary.concepts_traversed) || [];
        newStatus = {
          overview: data.overview || [],
          concepts_traversed: this._sortConcepts(
            this._mergeStances(data.concepts_traversed || [], oldConcepts)
          ),
        };
      } else {
        newStatus = data.status || topic.statusSummary;
      }
      const freshTopic = Storage.getTopic(topicId);
      if (freshTopic) {
        freshTopic.statusSummary = newStatus;
        freshTopic.statusLastUpdated = Utils.timestamp();
        if (freshTopic.sidebarCache) freshTopic.sidebarCache.statusUpdate = newStatus;
        Storage.saveTopic(freshTopic);
      }
      StudyLog.event('current_profile_updated', { topicId, trigger: 'label_flush' });
    }).catch(err => {
      console.warn('Label flush status update failed:', err);
    });
  },

  // ── Shuffle / Refresh Directions ──────────────────────────────────────

  _initShuffle() {
    const btn = document.getElementById('shuffleDirectionsBtn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.shuffleDirections('sidebar');
    });
  },

  async shuffleDirections(location = 'sidebar', targetTopicId = null) {
    const topicId = targetTopicId || this.currentTopicId;
    if (!topicId) return;
    const topic = Storage.getTopic(topicId);
    if (!topic) return;

    let btn = null;
    if (location !== 'welcome') {
      btn = document.getElementById('shuffleDirectionsBtn');
      if (btn) btn.classList.add('loading');
    }

    let oldDirs = [];
    if (location === 'welcome' && topic.sidebarCache) {
      oldDirs = (topic.sidebarCache.newDirections || []).map(d => d.title);
    } else if (this.currentData) {
      oldDirs = (this.currentData.newDirections || []).map(d => d.title);
    }

    const chatId = Storage.getCurrentChatId();
    const messages = chatId ? Storage.getMessages(chatId) : [];
    const currentSummary = messages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');

    // Build covered concepts string from current profile
    let coveredConcepts = '';
    if (topic.statusSummary && typeof topic.statusSummary === 'object') {
      const concepts = topic.statusSummary.concepts_traversed || [];
      coveredConcepts = concepts.map(c => typeof c === 'object' ? c.title : c).join(', ');
    }

    try {
      const resp = await fetch('/api/sidebar/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName: topic.name,
          topicStatus: this._serializeStatus(topic.statusSummary),
          coveredConcepts,
          allConcepts: Storage.getConceptsByTopic(topic.id).map(c => ({
            id: c.id, title: c.title, preview: c.preview,
          })),
          currentSummary,
          previouslySuggested: oldDirs,
          model: Storage.getSidebarModel(),
        }),
      });
      const data = await resp.json();
      const newDirs = data.newDirections || [];

      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        if (!freshTopic.sidebarCache) freshTopic.sidebarCache = {};
        freshTopic.sidebarCache.newDirections = newDirs;
        Storage.saveTopic(freshTopic);
      }

      if (location === 'sidebar' && topicId === this.currentTopicId) {
        const dirContainer = document.getElementById('directionCards');
        if (dirContainer) {
          dirContainer.innerHTML = '';
          const sortedDirs = [...newDirs].sort((a, b) => {
            const order = { breadth: 0, depth: 1 };
            return (order[a.type] ?? 2) - (order[b.type] ?? 2);
          });
          if (sortedDirs.length === 0) {
            dirContainer.innerHTML = '<p class="temporal-empty-hint">Keep chatting for suggestions.</p>';
          }
          sortedDirs.forEach((dir, idx) => dirContainer.appendChild(this._createDirectionCard(dir, idx)));
        }
        if (this.currentData) this.currentData.newDirections = newDirs;
      }

      StudyLog.event('future_directions_refreshed', {
        topicId,
        location,
        oldCount: oldDirs.length,
        newCount: newDirs.length,
      });
    } catch (err) {
      console.error('Shuffle directions failed:', err);
      if (location === 'sidebar') Utils.showToast('Failed to refresh suggestions', 'error');
    }

    if (btn) btn.classList.remove('loading');
  },

  // ── Drag from Status Block ────────────────────────────────────────────

  _initStatusDrag() {
    const el = this._getStatusContainer();
    if (!el) return;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', this._serializeStatus(this._getCurrentStatus()));
      e.dataTransfer.setData('application/loom-label', '[Current Profile]');
      e.dataTransfer.setData('application/loom-context-type', 'current_profile');
      StudyLog.event('current_profile_dragged', { topicId: this.currentTopicId });
    });
  },

  // ── Dialog Management ─────────────────────────────────────────────────

  _initMergeDialog() {
    document.getElementById('mergeCancelBtn').addEventListener('click', () => {
      StudyLog.event('topic_merge_cancelled', { sourceTopicId: App._mergeSourceTopicId || null });
      document.getElementById('mergeTopicDialog').style.display = 'none';
    });

    document.getElementById('mergeConfirmBtn').addEventListener('click', async () => {
      const targetId = document.getElementById('mergeTargetSelect').value;
      const sourceTopicId = App._mergeSourceTopicId;
      if (!targetId || !sourceTopicId) return;
      StudyLog.event('topic_merge_confirmed', { sourceTopicId, targetTopicId: targetId });
      document.getElementById('mergeTopicDialog').style.display = 'none';
      await App._mergeTopics(targetId, sourceTopicId);
    });
  },

  // ── Collapse / Expand Sections ────────────────────────────────────────

  _initModuleCollapse() {
    document.querySelectorAll('.module-collapse-btn').forEach(btn => {
      const moduleId = btn.dataset.module;
      const collapsed = localStorage.getItem('loom_moduleCollapse_' + moduleId) === 'true';
      if (collapsed) {
        const body = document.getElementById(moduleId + 'Body');
        if (body) body.classList.add('collapsed');
        btn.classList.add('collapsed');
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleModuleCollapse(moduleId);
      });
    });

    document.querySelectorAll('.temporal-section-header').forEach(header => {
      header.addEventListener('click', (e) => {
        if (e.target.closest('.module-collapse-btn') || e.target.closest('.status-update-btn') || e.target.closest('.shuffle-btn')) return;
        const sectionId = header.dataset.section;
        if (!sectionId) return;
        const moduleId = sectionId.replace('section', 'section');
        this._toggleModuleCollapse(moduleId);
      });
    });

    // Overview section collapse within Current
    document.addEventListener('click', (e) => {
      const label = e.target.closest('.status-section-label.collapsible');
      if (!label) return;
      const sectionKey = label.dataset.sectionToggle;
      const itemsEl = label.parentElement.querySelector('[data-section-items="' + sectionKey + '"]');
      if (!itemsEl) return;
      const isCollapsed = label.classList.toggle('section-collapsed');
      itemsEl.classList.toggle('section-collapsed', isCollapsed);
      localStorage.setItem('loom_overviewCollapsed', isCollapsed);
      StudyLog.event('current_profile_section_toggled', { section: sectionKey, collapsed: isCollapsed });
    });
  },

  _toggleModuleCollapse(moduleId) {
    const body = document.getElementById(moduleId + 'Body');
    const btn = document.querySelector('.module-collapse-btn[data-module="' + moduleId + '"]');
    if (!body) return;
    const collapsed = body.classList.toggle('collapsed');
    if (btn) btn.classList.toggle('collapsed', collapsed);
    localStorage.setItem('loom_moduleCollapse_' + moduleId, collapsed);
    StudyLog.event('section_collapsed', { moduleId, collapsed });
  },
};
