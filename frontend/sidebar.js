/* Right sidebar: Unified Past · Current · Future temporal context probe */

const Sidebar = {
  currentTopicId: null,
  currentData: null,
  _labelsDirty: false,

  init() {
    this._initStatusUpdate();
    this._initStatusHistory();
    this._initMergeDialog();
    this._initShuffle();
    this._initAddGoal();
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
    this._renderGoals(topic);
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
    const messages = Storage.getMessages(chatId).map(m => ({
      role: m.role, content: m.content,
    }));
    if (messages.length === 0) return;
    const pendingAnnos = this._collectPendingAnnotations(topic);
    this._labelsDirty = false;
    this._showLoading();

    try {
      const allChats = Storage.getAllChatSummariesForTopic(topic.id).filter(c => c.id !== chatId);

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
          annotations: pendingAnnos.map(a => ({
            spanText: a.spanText, label: a.label, comment: a.comment,
          })),
          model: Storage.getSidebarModel(),
        }),
      });

      const data = await resp.json();
      if (Array.isArray(data.newDirections)) {
        data.newDirections = data.newDirections.map(d => this._normalizeDirection(d));
      }
      this.currentData = data;
      this.render(data, topic);

      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        this._markAnnotationsFlushed(freshTopic, pendingAnnos);
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

    // Current: stage system status updates as a proposal — never silently rewrite
    if (data.statusUpdate) {
      this._stageProposal(topic, data.statusUpdate, 'new_messages');
      delete data.statusUpdate; // consumed — don't re-stage from sidebarCache on next show()
      Storage.saveTopic(topic);
    }
    this._renderStatus(topic.statusSummary || null);

    // Past: clear loading skeleton — past chats are populated by showPastChats() after each response
    const pastList = document.getElementById('pastChatsList');
    if (pastList && pastList.querySelector('.skeleton')) {
      pastList.innerHTML = '<p class="temporal-empty-hint">Past context will appear here after your first response.</p>';
    }

    // Future: goals + suggested goals — always breadth first, depth second
    this._renderGoals(topic);
    this._renderSuggestedGoals((data.newDirections || []).map(d => this._normalizeDirection(d)));
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
    el.draggable = false;

    const title = Utils.escapeHtml(chat.title || 'Past conversation');
    const userAsked = chat.userAsked ? Utils.escapeHtml(chat.userAsked.slice(0, 120)) : '';

    // Cards already contested for this topic render pre-struck
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (topic && chat.chatId && (topic.excludedChatIds || []).includes(chat.chatId)) {
      el.classList.add('past-chat-contested');
    }

    el.innerHTML = `
      <div class="temporal-card-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11" class="temporal-card-icon">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        <span class="temporal-card-title">${title}</span>
      </div>
      ${userAsked ? `<div class="temporal-card-excerpt">${userAsked}</div>` : ''}
      <div class="temporal-card-meta">Related to your current chat</div>
      <div class="temporal-card-actions">
        <button class="past-suppress-btn" title="Don't use this">Don't use this</button>
        <button class="past-continue-btn" data-chat-id="${Utils.escapeHtml(chat.chatId || '')}" title="Continue this chat">Continue this chat →</button>
      </div>
    `;

    // Don't use this: suppress for current chat; toast offers topic-wide upgrade
    el.querySelector('.past-suppress-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const curChat = Storage.getChat(Storage.getCurrentChatId());
      if (curChat && chat.chatId) {
        if (!Array.isArray(curChat.suppressedChatIds)) curChat.suppressedChatIds = [];
        if (!curChat.suppressedChatIds.includes(chat.chatId)) curChat.suppressedChatIds.push(chat.chatId);
        Storage.saveChat(curChat);
      }
      StudyLog.event('context_suppressed_in_chat', { stage: 'apply', initiative: 'user', chatId: chat.chatId });
      Utils.showToast("Won't be used in this chat", 'info', {
        label: 'Never for this topic',
        onClick: () => {
          const t = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
          if (!t || !chat.chatId) return;
          if (!Array.isArray(t.excludedChatIds)) t.excludedChatIds = [];
          if (!t.excludedChatIds.includes(chat.chatId)) t.excludedChatIds.push(chat.chatId);
          // Remove from chat-level suppress once topic-excluded
          const c = Storage.getChat(Storage.getCurrentChatId());
          if (c && Array.isArray(c.suppressedChatIds)) {
            c.suppressedChatIds = c.suppressedChatIds.filter(id => id !== chat.chatId);
            Storage.saveChat(c);
          }
          Storage.saveTopic(t);
          el.classList.add('past-chat-contested');
          StudyLog.event('connection_contested', { stage: 'apply', initiative: 'user', topicId: this.currentTopicId, chatId: chat.chatId });
          Utils.showToast("Won't be used in this topic", 'info');
        },
      });
    });

    // Continue this chat → navigate to the past chat
    el.querySelector('.past-continue-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const chatId = chat.chatId;
      if (!chatId) return;
      const target = Storage.getChat(chatId);
      if (!target) return;
      this._flushDirtyLabels();
      App._summarizeCurrentChat();
      App.msgCountSinceRefresh = 0;
      App._renderChat(chatId);
      App._renderChatList();
    });

    return el;
  },

  // ── Current: Overview status ──────────────────────────────────────────

  _renderStatus(statusData, opts = {}) {
    const container = this._getStatusContainer();
    if (!container) return;

    const curTopic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const proposal = (curTopic && curTopic.pendingProposal &&
        (statusData == null || statusData === curTopic.statusSummary ||
         JSON.stringify(statusData) === JSON.stringify(curTopic.statusSummary)))
      ? curTopic.pendingProposal : null;
    const editMode = !!(opts.editMode && proposal);

    if (!statusData && !proposal) {
      container.innerHTML = '<p class="temporal-empty-hint">Chat to build your profile.</p>';
      return;
    }

    const overview = (typeof statusData === 'string')
      ? [statusData]
      : ((statusData && statusData.overview) || []);

    let html = '';
    html += `
      <div class="status-section status-section-overview">
        <div class="status-section-label collapsible${localStorage.getItem('loom_overviewCollapsed') === 'true' ? ' section-collapsed' : ''}" data-section-toggle="overview">
          <span class="section-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="8" height="8"><polyline points="6 9 12 15 18 9"/></svg></span>
          Overview
          <button class="overview-ai-edit-btn" title="AI edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>
          </button>
        </div>
        <div class="overview-ai-prompt-slot"></div>
        <div class="status-section-items${localStorage.getItem('loom_overviewCollapsed') === 'true' ? ' section-collapsed' : ''}" data-section-items="overview">
    `;

    if (proposal) {
      html += this._renderSuggestionOverview(overview, proposal, editMode);
      html += this._renderProposalActionsBar(proposal, editMode);
    } else if (overview.length > 0) {
      overview.forEach((pt, i) => {
        html += this._renderNormalOverviewItem(pt, i);
      });
    } else {
      html += '<p class="temporal-empty-hint">Chat more to build your profile.</p>';
    }

    html += '</div></div>';
    container.innerHTML = html;
    this._bindStatusItemActions();
    if (proposal) this._bindProposalActions(editMode);
  },

  /** Normalize overview items: strings / untyped objects → {type:'bullet'| 'header', text, source?} */
  _normalizeOverviewItem(it) {
    if (typeof it === 'string') {
      const text = it.trim();
      return text ? { type: 'bullet', text } : null;
    }
    if (!it || typeof it !== 'object') return null;
    const text = (it.text || '').trim();
    if (!text) return null;
    if (it.type === 'header') return { type: 'header', text };
    return { type: 'bullet', text, source: it.source };
  },

  _overviewItemKey(type, text) {
    const t = (type === 'header') ? 'h' : 'b';
    return `${t}:${(text || '').trim().toLowerCase()}`;
  },

  _renderNormalOverviewItem(pt, i) {
    const item = this._normalizeOverviewItem(pt) || { type: 'bullet', text: '' };
    if (item.type === 'header') {
      return `<div class="status-item status-header" data-section="overview" data-idx="${i}" data-item-type="header">
        <span class="status-item-text">${Utils.escapeHtml(item.text)}</span>
        <span class="status-item-actions">
          <button class="status-item-btn status-item-del" title="Remove">×</button>
        </span></div>`;
    }
    const src = item.source || null;
    const srcBadge = src === 'label-derived' ? '<span class="status-item-source">from your labels</span>'
      : src === 'user' ? '<span class="status-item-source">you wrote this</span>' : '';
    return `<div class="status-item status-bullet" data-section="overview" data-idx="${i}" data-item-type="bullet">
      <span class="status-item-text">${Utils.escapeHtml(item.text)}${srcBadge}</span>
      <span class="status-item-actions">
        <button class="status-item-btn status-item-del" title="Remove">×</button>
      </span></div>`;
  },

  _renderWordDiffHtml(oldText, newText) {
    return Utils.wordDiff(oldText, newText).map(seg => {
      const t = Utils.escapeHtml(seg.text);
      if (seg.type === 'add') return `<span class="diff-add">${t}</span>`;
      if (seg.type === 'del') return `<span class="diff-del">${t}</span>`;
      return t;
    }).join('');
  },

  _suggestionRowClass(itemType) {
    return itemType === 'header' ? 'status-item status-header' : 'status-item status-bullet';
  },

  _renderSuggestionOverview(overview, proposal, editMode) {
    const changes = proposal.changes || [];
    const keyOf = (c, field) => this._overviewItemKey(c.itemType || 'bullet', c[field] || c.text || c.oldText || '');
    const removeSet = new Set(
      changes.filter(c => c.kind === 'overview_remove').map(c => keyOf(c, 'text'))
    );
    const editMap = new Map();
    changes.filter(c => c.kind === 'overview_edit').forEach(c => editMap.set(keyOf(c, 'oldText'), c));
    const addChanges = changes
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind === 'overview_add');

    let html = '';
    overview.forEach((pt, i) => {
      const item = this._normalizeOverviewItem(pt) || { type: 'bullet', text: this._statusItemText(pt) };
      const key = this._overviewItemKey(item.type, item.text);
      const edit = editMap.get(key);
      const rowCls = this._suggestionRowClass(item.type);
      if (removeSet.has(key)) {
        const chIdx = changes.findIndex(c => c.kind === 'overview_remove' && keyOf(c, 'text') === key);
        if (editMode) {
          html += `<div class="${rowCls} suggestion-edit-row" data-change-idx="${chIdx}">
            <textarea class="status-inline-edit proposal-edit-input" rows="1" disabled>${Utils.escapeHtml(item.text)}</textarea>
            <button class="status-item-btn proposal-drop-change" data-change-idx="${chIdx}" title="Remove this change">×</button>
          </div>`;
        } else {
          html += `<div class="${rowCls} suggestion-item" data-change-idx="${chIdx}">
            <span class="status-item-text"><span class="diff-del">${Utils.escapeHtml(item.text)}</span></span>
          </div>`;
        }
      } else if (edit) {
        const chIdx = changes.findIndex(c => c.kind === 'overview_edit' && keyOf(c, 'oldText') === key);
        if (editMode) {
          html += `<div class="${rowCls} suggestion-edit-row" data-change-idx="${chIdx}">
            <textarea class="status-inline-edit proposal-edit-input" rows="1">${Utils.escapeHtml(edit.text || '')}</textarea>
            <button class="status-item-btn proposal-drop-change" data-change-idx="${chIdx}" title="Remove this change">×</button>
          </div>`;
        } else {
          html += `<div class="${rowCls} suggestion-item" data-change-idx="${chIdx}">
            <span class="status-item-text">${this._renderWordDiffHtml(edit.oldText, edit.text)}</span>
          </div>`;
        }
      } else {
        html += this._renderNormalOverviewItem(pt, i);
      }
    });

    addChanges.forEach(({ c, i }) => {
      const rowCls = this._suggestionRowClass(c.itemType || 'bullet');
      if (editMode) {
        html += `<div class="${rowCls} suggestion-edit-row" data-change-idx="${i}">
          <textarea class="status-inline-edit proposal-edit-input" rows="1">${Utils.escapeHtml(c.text || '')}</textarea>
          <button class="status-item-btn proposal-drop-change" data-change-idx="${i}" title="Remove this change">×</button>
        </div>`;
      } else {
        html += `<div class="${rowCls} suggestion-item" data-change-idx="${i}">
          <span class="status-item-text"><span class="diff-add">${Utils.escapeHtml(c.text || '')}</span></span>
        </div>`;
      }
    });
    return html;
  },

  _proposalEvidenceHint(proposal) {
    if (!proposal.evidence || !proposal.evidence.length) return '';
    const e = proposal.evidence[0];
    const snippet = (e.spanText || '').length > 48
      ? (e.spanText || '').slice(0, 48) + '…'
      : (e.spanText || '');
    if (e.label === 'comment') {
      return ` · from your comment on "${snippet}"`;
    }
    const labelSymbols = { clear: '✓', unsure: '?', interested: '♥', not_relevant: '✗' };
    const sym = labelSymbols[e.label] || '';
    return ` · from your ${sym} on "${snippet}"`;
  },

  _renderProposalActionsBar(proposal, editMode) {
    const triggerLabels = {
      labels: 'Based on your recent labels',
      new_messages: 'Based on new chat activity',
      manual: 'Based on a manual update',
      merge: 'Based on merging topics',
      rename: 'Based on the topic rename',
    };
    const triggerLine = triggerLabels[proposal.trigger] || 'Suggested update';
    const evidenceHint = this._proposalEvidenceHint(proposal);
    if (editMode) {
      return `<div class="proposal-actions-bar" id="proposalActionsBar">
        <div class="proposal-actions-meta">${Utils.escapeHtml(triggerLine)}${Utils.escapeHtml(evidenceHint)}</div>
        <div class="proposal-actions">
          <button class="probe-btn proposal-accept-btn proposal-save-btn" title="Save changes">Save</button>
          <button class="probe-btn proposal-cancel-btn" title="Cancel">Cancel</button>
        </div>
      </div>`;
    }
    return `<div class="proposal-actions-bar" id="proposalActionsBar">
      <div class="proposal-actions-meta">${Utils.escapeHtml(triggerLine)}${Utils.escapeHtml(evidenceHint)}</div>
      <div class="proposal-actions">
        <button class="probe-btn proposal-accept-btn" title="Accept all">Accept all</button>
        <button class="probe-btn proposal-dismiss-btn" title="Reject">Reject</button>
        <button class="probe-btn proposal-edit-btn" title="Edit">Edit</button>
      </div>
    </div>`;
  },

  /** Overview items may be plain strings or {text, source} objects */
  _statusItemText(item) {
    return typeof item === 'string' ? item : (item && item.text) || '';
  },

  _textSimilarity(a, b) {
    const words = (s) => new Set((s || '').toLowerCase().trim().split(/\s+/).filter(Boolean));
    const wa = words(a), wb = words(b);
    if (wa.size === 0 && wb.size === 0) return 1;
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    wa.forEach(w => { if (wb.has(w)) inter++; });
    return (2 * inter) / (wa.size + wb.size);
  },

  /** Diff a proposed status summary against the current one (similarity pairing) */
  _diffStatus(currentSummary, proposedSummary) {
    const cur = (currentSummary && typeof currentSummary === 'object') ? currentSummary : {};
    const prop = (proposedSummary && typeof proposedSummary === 'object') ? proposedSummary : {};
    const norm = s => (s || '').trim().toLowerCase();
    const curItems = (cur.overview || []).map(it => this._normalizeOverviewItem(it)).filter(Boolean);
    const propItems = (prop.overview || []).map(it => this._normalizeOverviewItem(it)).filter(Boolean);

    const usedOld = new Set();
    const usedNew = new Set();
    const pairs = [];

    // Exact matches first (same type + text)
    curItems.forEach((oldItem, oi) => {
      const ni = propItems.findIndex((t, j) =>
        !usedNew.has(j) && t.type === oldItem.type && norm(t.text) === norm(oldItem.text));
      if (ni >= 0) {
        usedOld.add(oi);
        usedNew.add(ni);
      }
    });

    // Similarity pairs for remaining (headers↔headers, bullets↔bullets only)
    const candidates = [];
    curItems.forEach((oldItem, oi) => {
      if (usedOld.has(oi)) return;
      propItems.forEach((newItem, ni) => {
        if (usedNew.has(ni) || newItem.type !== oldItem.type) return;
        const sim = this._textSimilarity(oldItem.text, newItem.text);
        if (sim >= 0.5) {
          candidates.push({
            oi, ni, sim,
            itemType: oldItem.type,
            oldText: oldItem.text,
            newText: newItem.text,
          });
        }
      });
    });
    candidates.sort((a, b) => b.sim - a.sim);
    candidates.forEach(c => {
      if (usedOld.has(c.oi) || usedNew.has(c.ni)) return;
      usedOld.add(c.oi);
      usedNew.add(c.ni);
      pairs.push({
        kind: 'overview_edit',
        itemType: c.itemType,
        oldText: c.oldText,
        text: c.newText,
      });
    });

    const changes = [...pairs];
    curItems.forEach((oldItem, oi) => {
      if (!usedOld.has(oi)) {
        changes.push({
          kind: 'overview_remove',
          itemType: oldItem.type,
          text: oldItem.text,
          oldText: oldItem.text,
        });
      }
    });
    propItems.forEach((newItem, ni) => {
      if (!usedNew.has(ni)) {
        changes.push({ kind: 'overview_add', itemType: newItem.type, text: newItem.text });
      }
    });
    return changes;
  },

  /**
   * Stage a system-generated status update as a pending proposal.
   * Returns true when a proposal with actual changes was staged.
   */
  _stageProposal(topic, statusUpdate, trigger, evidenceAnnotations = null) {
    if (!topic || !statusUpdate) return false;
    const evidence = (evidenceAnnotations || [])
      .filter(a => a && a.spanText && a.label)
      .map(a => ({ spanText: a.spanText, label: a.label, comment: a.comment }));
    const hasComment = evidence.some(e => e.label === 'comment');
    const defaultSource = hasComment ? 'user'
      : (trigger === 'labels' ? 'label-derived' : 'inferred');
    const effective = {
      overview: (statusUpdate.overview || []).map(it => {
        const n = this._normalizeOverviewItem(it);
        if (!n) return null;
        if (n.type === 'header') return { type: 'header', text: n.text };
        return { type: 'bullet', text: n.text, source: defaultSource };
      }).filter(Boolean),
    };
    const changes = this._diffStatus(
      { overview: (topic.statusSummary && topic.statusSummary.overview) || [] },
      effective
    );
    if (changes.length === 0) {
      StudyLog.event('proposal_empty', { stage: 'construct', initiative: 'mixed', topicId: topic.id, trigger });
      return false;
    }
    if (topic.pendingProposal) {
      StudyLog.event('proposal_superseded', { stage: 'construct', initiative: 'mixed', topicId: topic.id, trigger });
    }
    topic.pendingProposal = {
      ts: Utils.timestamp(),
      trigger,
      changes,
      statusUpdate: effective,
      ...(evidence.length ? { evidence } : {}),
    };
    Storage.saveTopic(topic);
    StudyLog.event('proposal_shown', {
      stage: 'construct', initiative: 'mixed', topicId: topic.id, trigger, nChanges: changes.length,
    });
    return true;
  },

  // ── Proposal actions (inline suggestion mode) ─────────────────────────

  _bindProposalActions(editMode) {
    const bar = document.getElementById('proposalActionsBar');
    if (!bar) return;
    const bind = (sel, fn) => {
      const btn = bar.querySelector(sel);
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    if (editMode) {
      bind('.proposal-save-btn', () => this._saveProposalEdits());
      bind('.proposal-cancel-btn', () => this._renderStatus(this._getCurrentStatus()));
      const container = this._getStatusContainer();
      container.querySelectorAll('.proposal-drop-change').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._dropProposalChange(parseInt(btn.dataset.changeIdx, 10));
        });
      });
      container.querySelectorAll('.proposal-edit-input').forEach(ta => {
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        ta.addEventListener('input', grow);
        grow();
      });
    } else {
      bind('.proposal-accept-btn', () => this._acceptProposal());
      bind('.proposal-edit-btn', () => this._editProposal());
      bind('.proposal-dismiss-btn', () => this._dismissProposal());
    }
  },

  /** Current topic, only when it has a pending proposal */
  _getProposalTopic() {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    return (topic && topic.pendingProposal) ? topic : null;
  },

  _sourceForProposalChange(p) {
    const evidence = p.evidence || [];
    if (evidence.some(e => e.label === 'comment')) return 'user';
    if (p.trigger === 'labels' || evidence.some(e => e.label && e.label !== 'comment')) return 'label-derived';
    return 'inferred';
  },

  _acceptProposal() {
    const topic = this._getProposalTopic();
    if (!topic) return;
    const p = topic.pendingProposal;
    Storage.pushStatusSnapshot(topic, 'proposal_accept');
    if (!topic.statusSummary || typeof topic.statusSummary !== 'object') {
      topic.statusSummary = { overview: [] };
    }
    const summary = topic.statusSummary;
    if (!Array.isArray(summary.overview)) summary.overview = [];
    const findOverviewIdx = (text, itemType) => {
      const key = this._overviewItemKey(itemType || 'bullet', text);
      return summary.overview.findIndex(it => {
        const n = this._normalizeOverviewItem(it);
        return n && this._overviewItemKey(n.type, n.text) === key;
      });
    };
    const source = this._sourceForProposalChange(p);

    (p.changes || []).forEach(ch => {
      const itemType = ch.itemType || 'bullet';
      if (ch.kind === 'overview_remove') {
        const i = findOverviewIdx(ch.text || ch.oldText, itemType);
        if (i >= 0) summary.overview.splice(i, 1);
      } else if (ch.kind === 'overview_edit') {
        const i = findOverviewIdx(ch.oldText, itemType);
        if (i >= 0) {
          if (itemType === 'header') {
            summary.overview[i] = { type: 'header', text: ch.text };
          } else if (typeof summary.overview[i] === 'object') {
            summary.overview[i].type = 'bullet';
            summary.overview[i].text = ch.text;
            summary.overview[i].source = source;
          } else {
            summary.overview[i] = { type: 'bullet', text: ch.text, source };
          }
        } else if (ch.text) {
          summary.overview.push(
            itemType === 'header'
              ? { type: 'header', text: ch.text }
              : { type: 'bullet', text: ch.text, source }
          );
        }
      } else if (ch.kind === 'overview_add') {
        if (ch.text) {
          summary.overview.push(
            itemType === 'header'
              ? { type: 'header', text: ch.text }
              : { type: 'bullet', text: ch.text, source }
          );
        }
      }
    });

    topic.statusLastUpdated = Utils.timestamp();
    if (topic.sidebarCache) topic.sidebarCache.statusUpdate = topic.statusSummary;
    topic.pendingProposal = null;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('proposal_accepted', {
      stage: 'construct', initiative: 'mixed', topicId: topic.id,
      trigger: p.trigger, nChanges: (p.changes || []).length,
    });
  },

  _dismissProposal() {
    const topic = this._getProposalTopic();
    if (!topic) return;
    const p = topic.pendingProposal;
    topic.pendingProposal = null;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary || null);
    StudyLog.event('proposal_dismissed', {
      stage: 'construct', initiative: 'user', topicId: topic.id,
      trigger: p.trigger, nChanges: (p.changes || []).length,
    });
  },

  _editProposal() {
    this._renderStatus(this._getCurrentStatus(), { editMode: true });
  },

  _dropProposalChange(idx) {
    const topic = this._getProposalTopic();
    if (!topic || !topic.pendingProposal) return;
    const changes = topic.pendingProposal.changes || [];
    if (idx < 0 || idx >= changes.length) return;
    changes.splice(idx, 1);
    if (changes.length === 0) {
      topic.pendingProposal = null;
      Storage.saveTopic(topic);
      this._renderStatus(topic.statusSummary || null);
      return;
    }
    Storage.saveTopic(topic);
    this._renderStatus(this._getCurrentStatus(), { editMode: true });
  },

  _saveProposalEdits() {
    const topic = this._getProposalTopic();
    const container = this._getStatusContainer();
    if (!topic || !container) return;
    const p = topic.pendingProposal;
    Storage.pushStatusSnapshot(topic, 'proposal_edit');
    if (!topic.statusSummary || typeof topic.statusSummary !== 'object') {
      topic.statusSummary = { overview: [] };
    }
    const summary = topic.statusSummary;
    if (!Array.isArray(summary.overview)) summary.overview = [];
    const findOverviewIdx = (text, itemType) => {
      const key = this._overviewItemKey(itemType || 'bullet', text);
      return summary.overview.findIndex(it => {
        const n = this._normalizeOverviewItem(it);
        return n && this._overviewItemKey(n.type, n.text) === key;
      });
    };

    container.querySelectorAll('.suggestion-edit-row').forEach(row => {
      const ch = p.changes[parseInt(row.dataset.changeIdx, 10)];
      if (!ch) return;
      const itemType = ch.itemType || 'bullet';
      const input = row.querySelector('.proposal-edit-input');
      const text = input ? input.value.trim() : '';
      if (ch.kind === 'overview_remove') {
        const i = findOverviewIdx(ch.oldText || ch.text, itemType);
        if (i >= 0) summary.overview.splice(i, 1);
      } else if (ch.kind === 'overview_edit') {
        const i = findOverviewIdx(ch.oldText, itemType);
        if (text) {
          if (i >= 0) {
            if (itemType === 'header') {
              summary.overview[i] = { type: 'header', text };
            } else if (typeof summary.overview[i] === 'object') {
              summary.overview[i].type = 'bullet';
              summary.overview[i].text = text;
              summary.overview[i].source = 'user';
            } else {
              summary.overview[i] = { type: 'bullet', text, source: 'user' };
            }
          } else {
            summary.overview.push(
              itemType === 'header' ? { type: 'header', text } : { type: 'bullet', text, source: 'user' }
            );
          }
        } else if (i >= 0) {
          summary.overview.splice(i, 1);
        }
      } else if (ch.kind === 'overview_add') {
        if (text) {
          summary.overview.push(
            itemType === 'header' ? { type: 'header', text } : { type: 'bullet', text, source: 'user' }
          );
        }
      }
    });

    topic.statusLastUpdated = Utils.timestamp();
    if (topic.sidebarCache) topic.sidebarCache.statusUpdate = summary;
    topic.pendingProposal = null;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('proposal_edited', {
      stage: 'construct', initiative: 'user', topicId: topic.id,
      trigger: p.trigger, nChanges: (p.changes || []).length,
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
  },

  _startInlineEdit(item, section, idx) {
    const textEl = item.querySelector('.status-item-text');
    if (!textEl) return;
    // Prefer stored text so source badges aren't pulled into the editor
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const stored = topic && topic.statusSummary && Array.isArray(topic.statusSummary[section])
      ? topic.statusSummary[section][idx] : null;
    const original = stored != null
      ? this._statusItemText(stored)
      : (textEl.childNodes[0] && textEl.childNodes[0].nodeType === 3
        ? textEl.childNodes[0].textContent
        : textEl.textContent);
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
    Storage.pushStatusSnapshot(topic, 'delete_item');
    arr.splice(idx, 1);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_profile_edited', { stage: 'construct', initiative: 'user', topicId: this.currentTopicId, section, editType: 'delete', itemIdx: idx });
  },

  _editStatusItem(section, idx, newText) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    Storage.pushStatusSnapshot(topic, 'inline_edit');
    const prev = this._normalizeOverviewItem(arr[idx]);
    if (prev && prev.type === 'header') {
      arr[idx] = { type: 'header', text: newText };
    } else if (arr[idx] && typeof arr[idx] === 'object') {
      arr[idx].type = 'bullet';
      arr[idx].text = newText;
      arr[idx].source = 'user';
    } else {
      arr[idx] = { type: 'bullet', text: newText, source: 'user' };
    }
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_profile_edited', { stage: 'construct', initiative: 'user', topicId: this.currentTopicId, section, editType: 'edit', itemIdx: idx });
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
      const newOverview = (data.overview || overview).map(it => {
        const n = this._normalizeOverviewItem(it);
        if (!n) return null;
        if (n.type === 'header') return { type: 'header', text: n.text };
        return {
          type: 'bullet',
          text: n.text,
          source: (it && typeof it === 'object' && it.source) || 'user',
        };
      }).filter(Boolean);
      Storage.pushStatusSnapshot(topic, 'ai_edit');
      topic.statusSummary.overview = newOverview;
      topic.statusLastUpdated = Utils.timestamp();
      if (topic.sidebarCache && topic.sidebarCache.statusUpdate) {
        topic.sidebarCache.statusUpdate.overview = newOverview;
      }
      Storage.saveTopic(topic);
      this._renderStatus(topic.statusSummary);
      Utils.showToast('Profile updated', 'success');
      StudyLog.event('current_profile_edited', { stage: 'construct', initiative: 'user', topicId: this.currentTopicId, trigger: 'ai_edit' });
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
    if (!statusSummary.overview || statusSummary.overview.length === 0) return '';
    const parts = [];
    for (const it of statusSummary.overview) {
      const n = this._normalizeOverviewItem(it);
      if (!n) continue;
      parts.push(n.type === 'header' ? `## ${n.text}` : `- ${n.text}`);
    }
    return parts.join('\n');
  },

  // ── Future: Suggested Goals ───────────────────────────────────────────

  _normalizeDirection(dir) {
    if (!dir || typeof dir !== 'object') return dir;
    const exampleQuestion = dir.exampleQuestion != null ? dir.exampleQuestion : (dir.question || '');
    return { ...dir, exampleQuestion };
  },

  _createSuggestedGoalCard(dir, directionIdx) {
    const d = this._normalizeDirection(dir);
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const matchedGoal = topic ? this._findGoal(topic, d.title) : null;
    const isSaved = !!matchedGoal;

    const el = document.createElement('div');
    const typeClass = d.type === 'breadth' ? 'type-breadth' : d.type === 'depth' ? 'type-depth' : '';
    el.className = `temporal-card direction-card suggested-goal-card${typeClass ? ' ' + typeClass : ''}${isSaved ? ' is-saved' : ''}`;
    el.draggable = false;

    const reasonText = (d.reason || '').trim();
    const anchorText = (d.anchor || '').trim();
    el.title = reasonText || anchorText || '';

    const typeWord = d.type === 'breadth' ? 'broader' : d.type === 'depth' ? 'deeper' : '';
    const suggestedAt = d.suggestedAt || Utils.timestamp();
    const provenanceParts = [this._formatGoalDate(suggestedAt)].filter(Boolean);
    if (typeWord) provenanceParts.push(typeWord);
    if (d.editedByUser) provenanceParts.push('edited by you');
    const provenance = provenanceParts.join(' · ');

    const tagHtml = isSaved
      ? `<span class="goal-status-tag tag-saved">Saved</span>`
      : `<span class="goal-status-tag tag-suggested">Suggested</span>`;

    el.innerHTML = `
      <div class="temporal-card-header">
        ${tagHtml}
        <span class="temporal-card-title">${Utils.escapeHtml(d.title || '')}</span>
      </div>
      ${provenance ? `<div class="direction-provenance">${Utils.escapeHtml(provenance)}</div>` : ''}
      <div class="goal-try-asking">
        <span class="goal-try-prefix">Try asking:</span>
        <span class="temporal-card-question goal-example-question">${Utils.escapeHtml(d.exampleQuestion || '')}</span>
      </div>
      <div class="temporal-card-actions">
        <button class="probe-btn card-new-chat-btn" title="Ask this">Ask this</button>
        ${isSaved ? '' : `<button class="probe-btn direction-save-btn" title="Save goal">Save goal</button>`}
        ${isSaved
          ? `<button class="goal-icon-btn intention-remove-btn" title="Remove goal">×</button>`
          : `<button class="goal-icon-btn direction-modify-btn" title="Modify goal">✎</button>
             <button class="goal-icon-btn goal-regen-btn" title="Another angle">↻</button>
             <button class="goal-icon-btn direction-dismiss-btn" title="Dismiss">×</button>`}
      </div>
    `;

    const saveBtn = el.querySelector('.direction-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._saveSuggestedGoal(d);
      });
    }
    const modifyBtn = el.querySelector('.direction-modify-btn');
    if (modifyBtn) {
      modifyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._startSuggestedGoalEdit(el, d);
      });
    }
    const dismissBtn = el.querySelector('.direction-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._dismissSuggestedGoal(d, el);
      });
    }
    const removeBtn = el.querySelector('.intention-remove-btn');
    if (removeBtn && matchedGoal) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeGoal(matchedGoal.id);
      });
    }
    el.querySelector('.card-new-chat-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        let q = (el.querySelector('.goal-example-question')?.textContent || d.exampleQuestion || '').trim();
        if (!q) {
          q = await this._fetchGoalQuestion(d.title);
          if (q) {
            d.exampleQuestion = q;
            const qEl = el.querySelector('.goal-example-question');
            if (qEl) qEl.textContent = q;
            this._persistGoalExampleQuestion(d.title, q);
          }
        }
        if (!q) {
          Utils.showToast('Could not generate a question', 'error');
          return;
        }
        StudyLog.event('goal_question_asked', { stage: 'evolve', initiative: 'user', topicId: this.currentTopicId, directionIdx });
        this._startGoalInNewChat({ title: d.title, question: q });
        // Asking a suggested goal also saves it (stays active until deleted)
        if (!isSaved) this._saveSuggestedGoal(d, { silent: true });
      } finally {
        btn.disabled = false;
      }
    });
    const regenBtn = el.querySelector('.goal-regen-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.disabled = true;
        const qEl = el.querySelector('.goal-example-question');
        const currentQ = qEl ? qEl.textContent : (d.exampleQuestion || '');
        try {
          const question = await this._fetchGoalQuestion(d.title, currentQ);
          if (question) {
            d.exampleQuestion = question;
            if (qEl) qEl.textContent = question;
            const topic = Storage.getTopic(this.currentTopicId);
            if (topic && topic.sidebarCache) {
              const entry = (topic.sidebarCache.newDirections || []).find(x => x.title === d.title);
              if (entry) { entry.exampleQuestion = question; delete entry.question; }
              Storage.saveTopic(topic);
            }
            this._persistGoalExampleQuestion(d.title, question);
          }
        } catch (err) {
          console.error('Regenerate goal question failed:', err);
          Utils.showToast('Could not regenerate question', 'error');
        }
        btn.disabled = false;
      });
    }

    return el;
  },

  // ── Future: Goals ─────────────────────────────────────────────────────

  _findGoal(topic, title) {
    if (!topic || !Array.isArray(topic.goals) || !title) return null;
    const norm = (title || '').trim().toLowerCase();
    return topic.goals.find(i => (i.title || '').trim().toLowerCase() === norm) || null;
  },

  _persistGoalExampleQuestion(title, question) {
    if (!title || !question || !this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    const goal = this._findGoal(topic, title);
    if (!goal) return;
    goal.exampleQuestion = question;
    Storage.saveTopic(topic);
  },

  _formatGoalDate(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  },

  _renderEvolveSection(topic) {
    if (!topic) topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    this._renderGoals(topic);
    const dirs = (topic && topic.sidebarCache && topic.sidebarCache.newDirections) || [];
    this._renderSuggestedGoals(dirs);
  },

  _renderGoals(topic) {
    const container = document.getElementById('goalsList');
    if (!container) return;
    const goals = (topic && Array.isArray(topic.goals)) ? topic.goals : [];
    container.innerHTML = '';
    if (goals.length === 0) return;

    const collapsed = localStorage.getItem('loom_savedGoalsCollapsed') !== 'false';
    const wrap = document.createElement('div');
    wrap.className = `saved-goals-fold${collapsed ? ' is-collapsed' : ''}`;
    wrap.innerHTML = `
      <button type="button" class="saved-goals-toggle" aria-expanded="${collapsed ? 'false' : 'true'}">
        <svg class="saved-goals-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span class="saved-goals-toggle-label">Saved goals</span>
        <span class="saved-goals-count">${goals.length}</span>
      </button>
      <div class="saved-goals-body"></div>
    `;
    const body = wrap.querySelector('.saved-goals-body');
    goals.forEach(goal => body.appendChild(this._createGoalCard(goal)));
    wrap.querySelector('.saved-goals-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      const nowCollapsed = !wrap.classList.contains('is-collapsed');
      wrap.classList.toggle('is-collapsed', nowCollapsed);
      e.currentTarget.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
      localStorage.setItem('loom_savedGoalsCollapsed', nowCollapsed ? 'true' : 'false');
    });
    container.appendChild(wrap);
  },

  _renderSuggestedGoals(dirs, emptyHint = 'Keep chatting to generate future directions.') {
    const dirContainer = document.getElementById('directionCards');
    if (!dirContainer) return;
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const dismissed = new Set(((topic && topic.dismissedGoals) || []).map(t => (t || '').toLowerCase()));
    const normalized = [...(dirs || [])]
      .map(d => this._normalizeDirection(d))
      .filter(d => !dismissed.has((d.title || '').toLowerCase()));
    const byTitle = new Map();
    normalized.forEach(d => {
      const key = (d.title || '').trim().toLowerCase();
      if (key && !byTitle.has(key)) byTitle.set(key, d);
    });

    // Prioritize saved goals as cards; enrich from matching suggestions when available.
    const cards = [];
    const goals = (topic && Array.isArray(topic.goals)) ? topic.goals : [];
    goals.forEach(goal => {
      const key = (goal.title || '').trim().toLowerCase();
      const match = key ? byTitle.get(key) : null;
      cards.push(this._normalizeDirection({
        title: goal.title || '',
        type: (match && match.type) || goal.type || null,
        reason: (match && match.reason) || goal.reason || null,
        anchor: match ? match.anchor : null,
        exampleQuestion: (match && match.exampleQuestion) || goal.exampleQuestion || '',
        suggestedAt: (match && match.suggestedAt) || goal.suggestedAt || goal.savedAt || null,
        editedByUser: !!(goal.editedByUser || (match && match.editedByUser)),
      }));
    });

    // Also include at most one unsaved suggestion (breadth before depth).
    const order = { breadth: 0, depth: 1 };
    const unsaved = normalized
      .filter(d => !this._findGoal(topic, d.title))
      .sort((a, b) => (order[a.type] ?? 2) - (order[b.type] ?? 2));
    if (unsaved[0]) cards.push(unsaved[0]);

    dirContainer.innerHTML = '';
    if (cards.length === 0) {
      dirContainer.innerHTML = `<p class="temporal-empty-hint">${emptyHint}</p>`;
      return;
    }
    cards.forEach((dir, idx) => {
      const card = this._createSuggestedGoalCard(dir, idx);
      if (card && card.nodeType) dirContainer.appendChild(card);
    });
  },

  // Back-compat alias used by render()
  _renderDirectionCards(dirs, emptyHint) {
    this._renderSuggestedGoals(dirs, emptyHint);
  },

  _createGoalCard(goal) {
    const el = document.createElement('div');
    el.className = 'saved-goal-row';
    el.innerHTML = `
      <span class="saved-goal-row-title">${Utils.escapeHtml(goal.title || '')}</span>
      <button class="probe-btn goal-ask-btn" title="Ask a question">Ask</button>
      <button class="goal-icon-btn intention-remove-btn" title="Remove goal">×</button>
    `;

    el.querySelector('.goal-ask-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const question = await this._fetchGoalQuestion(goal.title);
        if (question) {
          StudyLog.event('goal_question_asked', { stage: 'evolve', initiative: 'user', topicId: this.currentTopicId, goalId: goal.id });
          this._startGoalInNewChat({ title: goal.title, question });
        }
      } catch (err) {
        console.error('Goal question failed:', err);
        Utils.showToast('Could not generate a question', 'error');
      }
      btn.disabled = false;
    });
    el.querySelector('.intention-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._removeGoal(goal.id);
    });

    return el;
  },

  async _fetchGoalQuestion(goalTitle, excludeQuestion = '') {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return '';
    const resp = await fetch('/api/sidebar/goal-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topicName: topic.name,
        topicStatus: this._serializeStatus(topic.statusSummary),
        goalTitle,
        allChatSummaries: Storage.getAllChatSummariesForTopic(topic.id),
        excludeQuestion: excludeQuestion || undefined,
        model: Storage.getSidebarModel(),
      }),
    });
    const data = await resp.json();
    return (data && data.question) || '';
  },

  _saveSuggestedGoal(dir, opts = {}) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic || this._findGoal(topic, dir.title)) {
      if (!opts.silent) this._renderEvolveSection(topic);
      return;
    }
    const now = Utils.timestamp();
    if (!Array.isArray(topic.goals)) topic.goals = [];
    topic.goals.push({
      id: 'goal_' + Utils.generateId(),
      title: dir.title || '',
      type: dir.type || null,
      reason: dir.reason || null,
      exampleQuestion: dir.exampleQuestion || '',
      source: 'system',
      status: 'saved',
      suggestedAt: dir.suggestedAt || now,
      savedAt: now,
      exploredAt: null,
      chatId: null,
      editedByUser: !!dir.editedByUser,
    });
    Storage.saveTopic(topic);
    this._renderEvolveSection(topic);
    StudyLog.event('goal_saved', { stage: 'evolve', initiative: 'mixed', topicId: topic.id, title: dir.title });
  },

  _dismissSuggestedGoal(dir, el) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    if (!Array.isArray(topic.dismissedGoals)) topic.dismissedGoals = [];
    if (!topic.dismissedGoals.includes(dir.title)) {
      topic.dismissedGoals.push(dir.title);
    }
    Storage.saveTopic(topic);
    StudyLog.event('goal_dismissed', { stage: 'evolve', initiative: 'user', topicId: topic.id, title: dir.title });
    // Re-render so another unsaved suggestion can fill the single suggestion slot.
    this._renderEvolveSection(topic);
  },

  _markGoalExplored(title, chatId) {
    // Goals stay active until the user deletes them — asking no longer retires a goal.
    // Kept as a no-op stub so older call sites / logs remain harmless.
    return;
  },

  _removeGoal(goalId) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    const idx = (topic.goals || []).findIndex(i => i.id === goalId);
    if (idx < 0) return;
    const title = topic.goals[idx].title;
    topic.goals.splice(idx, 1);
    Storage.saveTopic(topic);
    this._renderEvolveSection(topic);
    StudyLog.event('goal_removed', { stage: 'evolve', initiative: 'user', topicId: topic.id, title });
  },

  _startSuggestedGoalEdit(el, dir) {
    const titleEl = el.querySelector('.temporal-card-title');
    if (!titleEl || el.querySelector('.direction-edit-input')) return;
    const original = dir.title || '';
    const ta = document.createElement('textarea');
    ta.className = 'status-inline-edit direction-edit-input';
    ta.value = original;
    ta.rows = 1;
    titleEl.replaceWith(ta);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('click', (e) => e.stopPropagation());
    grow();
    ta.focus();
    ta.select();

    const actionsEl = el.querySelector('.temporal-card-actions');
    const editRow = document.createElement('div');
    editRow.className = 'direction-edit-actions';
    editRow.innerHTML = `
      <button class="probe-btn direction-edit-save" title="Save edit">Save</button>
      <button class="probe-btn direction-edit-cancel" title="Cancel edit">Cancel</button>
    `;
    if (actionsEl) {
      actionsEl.style.display = 'none';
      actionsEl.parentElement.insertBefore(editRow, actionsEl);
    } else {
      el.appendChild(editRow);
    }

    editRow.querySelector('.direction-edit-save').addEventListener('click', (e) => {
      e.stopPropagation();
      const val = ta.value.trim();
      if (val && val !== original) this._saveSuggestedGoalEdit(dir, val);
      else this._renderEvolveSection();
    });
    editRow.querySelector('.direction-edit-cancel').addEventListener('click', (e) => {
      e.stopPropagation();
      this._renderEvolveSection();
    });
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); editRow.querySelector('.direction-edit-save').click(); }
      if (ev.key === 'Escape') { editRow.querySelector('.direction-edit-cancel').click(); }
    });
  },

  _saveSuggestedGoalEdit(dir, newTitle) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    const oldTitle = dir.title;
    dir.title = newTitle;
    dir.editedByUser = true;
    const cached = (topic.sidebarCache && topic.sidebarCache.newDirections) || [];
    const entry = cached.find(d => d.title === oldTitle);
    if (entry) { entry.title = newTitle; entry.editedByUser = true; }
    if (this.currentData && Array.isArray(this.currentData.newDirections)) {
      const cur = this.currentData.newDirections.find(d => d.title === oldTitle);
      if (cur) { cur.title = newTitle; cur.editedByUser = true; }
    }
    Storage.saveTopic(topic);
    this._renderEvolveSection(topic);
    StudyLog.event('goal_modified', { stage: 'evolve', initiative: 'user', topicId: topic.id, title: newTitle });
  },

  _initAddGoal() {
    const input = document.getElementById('addGoalInput');
    const btn = document.getElementById('addGoalBtn');
    if (!input || !btn) return;
    const submit = () => {
      const text = input.value.trim();
      if (!text || !this.currentTopicId) return;
      const topic = Storage.getTopic(this.currentTopicId);
      if (!topic) return;
      if (!Array.isArray(topic.goals)) topic.goals = [];
      const words = text.split(/\s+/);
      topic.goals.push({
        id: 'goal_' + Utils.generateId(),
        title: words.slice(0, 8).join(' '),
        source: 'user',
        status: 'saved',
        suggestedAt: null,
        savedAt: Utils.timestamp(),
        exploredAt: null,
        chatId: null,
        editedByUser: false,
      });
      Storage.saveTopic(topic);
      input.value = '';
      this._renderEvolveSection(topic);
      StudyLog.event('goal_authored', { stage: 'evolve', initiative: 'user', topicId: topic.id });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    btn.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
  },

  _startGoalInNewChat(dir) {
    const topicId = this.currentTopicId;
    App.newChat();
    if (topicId) {
      App.selectedTopicId = topicId;
      const topicSel = document.getElementById('topicSelect');
      if (topicSel) topicSel.value = topicId;
    }
    document.getElementById('chatInput').value = dir.question || dir.exampleQuestion || '';
    App.sendMessage();
    return App.currentChatId;
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
        const currentMessages = Storage.getMessages(chatId).map(m => ({
          role: m.role, content: m.content,
        }));
        const pendingAnnos = this._collectPendingAnnotations(topic);
        this._labelsDirty = false;
        const resp = await fetch('/api/topic/status/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topicName: topic.name,
            currentStatus: this._serializeStatus(topic.statusSummary),
            recentSummaries: summaries.map(s => s.summary),
            currentMessages,
            annotations: pendingAnnos.map(a => ({
              spanText: a.spanText, label: a.label, comment: a.comment,
            })),
            model: Storage.getSidebarModel(),
          }),
        });
        const data = await resp.json();
        const freshTopic = Storage.getTopic(this.currentTopicId);
        if (freshTopic) {
          this._markAnnotationsFlushed(freshTopic, pendingAnnos);
          const staged = data.overview
            ? this._stageProposal(freshTopic, data, 'manual', pendingAnnos)
            : false;
          this._renderStatus(freshTopic.statusSummary || null);
          if (staged) Utils.showToast('Proposed update ready for review', 'success');
          else Utils.showToast('Profile is already up to date');
        }
      } catch (err) {
        console.error('Status update failed:', err);
        Utils.showToast('Update failed', 'error');
      }
      btn.classList.remove('loading');
      btn.disabled = false;
    });
  },

  // ── Status History (Undo / Version Restore) ───────────────────────────

  _initStatusHistory() {
    const historyBtn = document.getElementById('statusHistoryBtn');
    if (historyBtn) {
      historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleHistoryPopover(historyBtn);
      });
    }
  },

  _undoStatusUpdate() {
    if (!this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return;

    // Immediately after a restore, fall back to the non-rendered backup
    if (topic._lastStableBeforeRestore) {
      const backup = topic._lastStableBeforeRestore;
      topic.statusSummary = JSON.parse(JSON.stringify(backup.statusSummary));
      topic._lastStableBeforeRestore = null;
      topic.statusLastUpdated = Utils.timestamp();
      Storage.saveTopic(topic);
      this._renderStatus(topic.statusSummary);
      this._closeHistoryPopover();
      StudyLog.event('update_undone', {
        stage: 'construct',
        initiative: 'user',
        topicId: this.currentTopicId,
        trigger: backup.trigger || 'restore',
      });
      return;
    }

    const history = Array.isArray(topic.statusHistory)
      ? topic.statusHistory.filter(s => s && s.trigger !== 'pre_undo' && s.trigger !== 'pre_restore')
      : [];
    if (history.length === 0) {
      Utils.showToast('Nothing to undo');
      return;
    }
    // Restore most recent snapshot (= Restore of index length-1), without pushing pre_*
    const lastIdx = topic.statusHistory.lastIndexOf(history[history.length - 1]);
    const idx = lastIdx >= 0 ? lastIdx : topic.statusHistory.length - 1;
    this._restoreStatusVersion(idx, { fromUndo: true });
  },

  _getHistoryPopover() {
    let el = document.getElementById('statusHistoryPopover');
    if (!el) {
      el = document.createElement('div');
      el.id = 'statusHistoryPopover';
      el.className = 'status-history-popover';
      document.body.appendChild(el);
    }
    return el;
  },

  _toggleHistoryPopover(btn) {
    const pop = this._getHistoryPopover();
    if (pop.classList.contains('visible')) {
      this._closeHistoryPopover();
      return;
    }
    this._renderHistoryPopover(pop);
    const rect = btn.getBoundingClientRect();
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.left = Math.max(8, rect.right - 260) + 'px';
    pop.classList.add('visible');
    setTimeout(() => {
      this._historyOutsideHandler = (e) => {
        if (!pop.contains(e.target)) this._closeHistoryPopover();
      };
      this._historyEscHandler = (e) => {
        if (e.key === 'Escape') this._closeHistoryPopover();
      };
      document.addEventListener('click', this._historyOutsideHandler);
      document.addEventListener('keydown', this._historyEscHandler);
    }, 0);
  },

  _closeHistoryPopover() {
    const pop = document.getElementById('statusHistoryPopover');
    if (pop) pop.classList.remove('visible');
    if (this._historyOutsideHandler) {
      document.removeEventListener('click', this._historyOutsideHandler);
      this._historyOutsideHandler = null;
    }
    if (this._historyEscHandler) {
      document.removeEventListener('keydown', this._historyEscHandler);
      this._historyEscHandler = null;
    }
  },

  _renderHistoryPopover(pop) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const raw = (topic && Array.isArray(topic.statusHistory)) ? topic.statusHistory : [];
    const history = raw
      .map((snap, idx) => ({ snap, idx }))
      .filter(({ snap }) => snap && snap.trigger !== 'pre_undo' && snap.trigger !== 'pre_restore');

    let html = '<div class="status-history-popover-label">Update history</div>';
    html += `<button type="button" class="status-history-undo-row" id="statusHistoryUndoRow">
      <span class="status-history-undo-label">Undo last change</span>
      <kbd class="status-history-kbd">⌘Z</kbd>
    </button>`;

    if (history.length === 0) {
      html += '<div class="status-history-empty">No previous versions</div>';
    } else {
      [...history].reverse().forEach(({ snap, idx }) => {
        const summary = snap.statusSummary || {};
        const overviewCount = (summary.overview || []).length;
        html += `<div class="status-history-row">
          <div class="status-history-info">
            <div class="status-history-title">${this._formatHistoryTs(snap.ts)} · ${Utils.escapeHtml(this._historyTriggerLabel(snap.trigger))}</div>
            <div class="status-history-meta">${overviewCount} items</div>
          </div>
          <button class="status-history-restore" data-idx="${idx}">Restore</button>
        </div>`;
      });
    }
    pop.innerHTML = html;
    const undoRow = pop.querySelector('#statusHistoryUndoRow');
    if (undoRow) {
      undoRow.addEventListener('click', (e) => {
        e.stopPropagation();
        this._undoStatusUpdate();
      });
    }
    pop.querySelectorAll('.status-history-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._restoreStatusVersion(parseInt(btn.dataset.idx, 10));
      });
    });
  },

  _restoreStatusVersion(idx, opts = {}) {
    if (!this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || !Array.isArray(topic.statusHistory)) return;
    const snapshot = topic.statusHistory[idx];
    if (!snapshot) return;

    if (opts.fromUndo) {
      // Undo last change = restore most recent snapshot without phantom pre_* entries
      topic.statusHistory.splice(idx, 1);
      topic._lastStableBeforeRestore = null;
      topic.statusSummary = JSON.parse(JSON.stringify(snapshot.statusSummary));
      topic.statusLastUpdated = Utils.timestamp();
      Storage.saveTopic(topic);
      this._renderStatus(topic.statusSummary);
      this._closeHistoryPopover();
      StudyLog.event('update_undone', {
        stage: 'construct',
        initiative: 'user',
        topicId: this.currentTopicId,
        trigger: snapshot.trigger,
      });
      return;
    }

    // Keep a non-rendered backup so Undo-after-Restore works without phantom history
    topic._lastStableBeforeRestore = {
      ts: Utils.timestamp(),
      trigger: 'pre_restore',
      statusSummary: JSON.parse(JSON.stringify(topic.statusSummary || { overview: [] })),
    };

    topic.statusSummary = JSON.parse(JSON.stringify(snapshot.statusSummary));
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    this._closeHistoryPopover();
    StudyLog.event('version_restored', {
      stage: 'construct',
      initiative: 'user',
      topicId: this.currentTopicId,
      trigger: snapshot.trigger,
    });
  },

  _historyTriggerLabel(trigger) {
    const labels = {
      labels: 'Updated from your labels',
      manual: 'Manual update',
      new_messages: 'Updated from chat',
      ai_edit: 'AI edit',
      inline_edit: 'Edited an item',
      delete_item: 'Deleted an item',
      proposal_accept: 'Accepted suggestion',
      proposal_edit: 'Edited suggestion',
    };
    return labels[trigger] || 'Update';
  },

  _formatHistoryTs(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  },

  _flushDirtyLabels() {
    if (!this._labelsDirty || !this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return;

    const chatId = Storage.getCurrentChatId();
    const messages = Storage.getMessages(chatId).map(m => ({
      role: m.role, content: m.content,
    }));
    if (messages.length === 0) return;

    const pendingAnnos = this._collectPendingAnnotations(topic);
    if (pendingAnnos.length === 0) {
      this._labelsDirty = false;
      return;
    }

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
        annotations: pendingAnnos.map(a => ({
          spanText: a.spanText, label: a.label, comment: a.comment,
        })),
        model: Storage.getSidebarModel(),
      }),
    }).then(resp => resp.json()).then(data => {
      const freshTopic = Storage.getTopic(topicId);
      if (!freshTopic) return;
      this._markAnnotationsFlushed(freshTopic, pendingAnnos);
      if (data.overview) {
        const staged = this._stageProposal(freshTopic, data, 'labels', pendingAnnos);
        if (staged && this.currentTopicId === topicId) {
          this._renderStatus(freshTopic.statusSummary || null);
        }
      }
    }).catch(err => {
      console.warn('Label flush status update failed:', err);
    });
  },

  /** Collect annotations not yet sent to status update (includes comments). */
  _collectPendingAnnotations(topic) {
    if (!topic) return [];
    const flushed = new Set(topic._flushedAnnotationIds || []);
    const out = [];
    const chats = Storage.getChats().filter(c => c.topicId === topic.id);
    for (const chat of chats) {
      for (const m of Storage.getMessages(chat.id)) {
        if (m.role !== 'assistant' || !Array.isArray(m.annotations)) continue;
        for (const a of m.annotations) {
          if (!a || !a.id || flushed.has(a.id)) continue;
          out.push({
            id: a.id,
            spanText: a.spanText || '',
            label: a.label,
            comment: a.comment,
          });
        }
      }
    }
    return out;
  },

  _markAnnotationsFlushed(topic, annotations) {
    if (!topic || !annotations || annotations.length === 0) return;
    const ids = new Set(topic._flushedAnnotationIds || []);
    annotations.forEach(a => { if (a && a.id) ids.add(a.id); });
    topic._flushedAnnotationIds = [...ids];
    Storage.saveTopic(topic);
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
    // Dismissed goals count as previously suggested so they stay excluded
    const dismissed = Array.isArray(topic.dismissedGoals) ? topic.dismissedGoals : [];
    const previouslySuggested = [...new Set([...oldDirs, ...dismissed])];

    const chatId = Storage.getCurrentChatId();
    const messages = chatId ? Storage.getMessages(chatId) : [];
    const currentSummary = messages.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');

    try {
      const resp = await fetch('/api/sidebar/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName: topic.name,
          topicStatus: this._serializeStatus(topic.statusSummary),
          allChatSummaries: Storage.getAllChatSummariesForTopic(topic.id),
          currentSummary,
          previouslySuggested,
          model: Storage.getSidebarModel(),
        }),
      });
      const data = await resp.json();
      const dismissedLower = new Set(dismissed.map(t => (t || '').toLowerCase()));
      const newDirs = (data.newDirections || [])
        .map(d => this._normalizeDirection(d))
        .filter(d => !dismissedLower.has((d.title || '').toLowerCase()));

      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        if (!freshTopic.sidebarCache) freshTopic.sidebarCache = {};
        freshTopic.sidebarCache.newDirections = newDirs;
        Storage.saveTopic(freshTopic);
      }

      if (location === 'sidebar' && topicId === this.currentTopicId) {
        this._renderSuggestedGoals(newDirs, 'Keep chatting for suggestions.');
        if (freshTopic) this._renderGoals(freshTopic);
        if (this.currentData) this.currentData.newDirections = newDirs;
      }

      StudyLog.event('future_directions_refreshed', {
        stage: 'evolve', initiative: 'user',
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
