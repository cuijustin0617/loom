/* Right sidebar: Unified Past · Current · Future temporal context probe */

const Sidebar = {
  currentTopicId: null,
  currentData: null,
  _labelsDirty: false,

  init() {
    this._initStatusDrag();
    this._initStatusUpdate();
    this._initStatusHistory();
    this._initMergeDialog();
    this._initShuffle();
    this._initAddIntention();
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
    this._renderIntentions(topic);
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

    // Future: intentions + directions — always breadth first, depth second
    this._renderIntentions(topic);
    this._renderDirectionCards(data.newDirections || []);
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
      <div class="temporal-card-meta">Retrieved via text similarity</div>
      <div class="temporal-card-actions">
        <button class="past-contest-btn" title="This connection is incorrect">⚑ Incorrect</button>
        <button class="past-suppress-btn" title="Don't use in this chat">Don't use in this chat</button>
        <button class="past-build-btn" data-chat-id="${Utils.escapeHtml(chat.chatId || '')}" data-title="${title}" title="Build on this chat">Build on this →</button>
      </div>
    `;

    // Contest: exclude this chat from the topic's context
    el.querySelector('.past-contest-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const t = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
      if (t && chat.chatId) {
        if (!t.excludedChatIds.includes(chat.chatId)) t.excludedChatIds.push(chat.chatId);
        Storage.saveTopic(t);
      }
      el.classList.add('past-chat-contested');
      StudyLog.event('connection_contested', { stage: 'apply', initiative: 'mixed', topicId: this.currentTopicId, chatId: chat.chatId });
    });

    // Suppress: don't use this past chat in the current chat only
    el.querySelector('.past-suppress-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const curChat = Storage.getChat(Storage.getCurrentChatId());
      if (curChat && chat.chatId) {
        if (!Array.isArray(curChat.suppressedChatIds)) curChat.suppressedChatIds = [];
        if (!curChat.suppressedChatIds.includes(chat.chatId)) curChat.suppressedChatIds.push(chat.chatId);
        Storage.saveChat(curChat);
      }
      Utils.showToast("Won't be used in this chat — takes effect on your next message");
      StudyLog.event('context_suppressed_in_chat', { stage: 'apply', initiative: 'user', chatId: chat.chatId });
    });

    // Build on this
    el.querySelector('.past-build-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('past_build_on_click', { stage: 'apply', initiative: 'user', topicId: this.currentTopicId, chatId: chat.chatId, idx });
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
      StudyLog.event('past_card_dragged', { stage: 'apply', initiative: 'user', topicId: this.currentTopicId, chatId: chat.chatId, idx });
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    return el;
  },

  // ── Current: Overview status ──────────────────────────────────────────

  _renderStatus(statusData) {
    const container = this._getStatusContainer();
    if (!container) return;

    // Pending proposal card pinned on top — only when statusData reflects the
    // currently displayed topic (getTopic returns fresh parses, so compare by value)
    let proposalHtml = '';
    const curTopic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (curTopic && curTopic.pendingProposal &&
        (statusData == null || statusData === curTopic.statusSummary ||
         JSON.stringify(statusData) === JSON.stringify(curTopic.statusSummary))) {
      proposalHtml = this._renderProposalCard(curTopic);
    }

    if (!statusData) {
      container.innerHTML = proposalHtml || '<p class="temporal-empty-hint">Chat to build your current profile.</p>';
      if (proposalHtml) this._bindProposalActions();
      return;
    }

    const overview = (typeof statusData === 'string')
      ? [statusData]
      : (statusData.overview || []);

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
        const src = pt && typeof pt === 'object' ? pt.source : null;
        const srcBadge = src === 'label-derived' ? '<span class="status-item-source">from your labels</span>'
          : src === 'user' ? '<span class="status-item-source">you wrote this</span>' : '';
        const scoped = pt && typeof pt === 'object' && pt.scope === 'topic';
        const scopeBadge = scoped ? '<span class="status-item-scoped">this topic only</span>' : '';
        html += `<div class="status-item" data-section="overview" data-idx="${i}">
          <span class="status-item-text">${Utils.escapeHtml(this._statusItemText(pt))}${srcBadge}${scopeBadge}</span>
          <span class="status-item-actions">
            <button class="status-item-btn status-item-scope${scoped ? ' scope-active' : ''}" data-idx="${i}" title="Use only within this topic">⌖</button>
            <button class="status-item-btn status-item-del" title="Remove">×</button>
          </span></div>`;
      });
      html += '</div></div>';
    }

    if (!html && !proposalHtml) {
      html = '<p class="temporal-empty-hint">Chat more to build your profile.</p>';
    }
    container.innerHTML = proposalHtml + html;
    this._bindStatusItemActions();
    if (proposalHtml) this._bindProposalActions();
  },

  /** Overview items may be plain strings or {text, source} objects */
  _statusItemText(item) {
    return typeof item === 'string' ? item : (item && item.text) || '';
  },

  /** Diff a proposed status summary against the current one */
  _diffStatus(currentSummary, proposedSummary) {
    const cur = (currentSummary && typeof currentSummary === 'object') ? currentSummary : {};
    const prop = (proposedSummary && typeof proposedSummary === 'object') ? proposedSummary : {};
    const norm = s => (s || '').trim().toLowerCase();
    const curTexts = (cur.overview || []).map(it => this._statusItemText(it).trim()).filter(Boolean);
    const propTexts = (prop.overview || []).map(it => this._statusItemText(it).trim()).filter(Boolean);

    const changes = [];
    const removed = curTexts.filter(t => !propTexts.some(p => norm(p) === norm(t)));
    const added = propTexts.filter(t => !curTexts.some(c => norm(c) === norm(t)));

    // Pair a remove+add sharing a long common prefix (first 20 chars) as an edit
    const unmatchedAdds = [...added];
    removed.forEach(oldText => {
      const idx = unmatchedAdds.findIndex(t => norm(t.slice(0, 20)) === norm(oldText.slice(0, 20)));
      if (idx >= 0) {
        changes.push({ kind: 'overview_edit', oldText, text: unmatchedAdds[idx] });
        unmatchedAdds.splice(idx, 1);
      } else {
        changes.push({ kind: 'overview_remove', text: oldText });
      }
    });
    unmatchedAdds.forEach(text => changes.push({ kind: 'overview_add', text }));
    return changes;
  },

  /**
   * Stage a system-generated status update as a pending proposal.
   * Returns true when a proposal with actual changes was staged.
   */
  _stageProposal(topic, statusUpdate, trigger, evidenceAnnotations = null) {
    if (!topic || !statusUpdate) return false;
    const effective = {
      overview: (statusUpdate.overview || []).map(it => ({
        text: this._statusItemText(it),
        source: trigger === 'labels' ? 'label-derived' : 'inferred',
      })),
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
    const evidence = (evidenceAnnotations || [])
      .filter(a => a && a.spanText && a.label && a.label !== 'comment')
      .map(a => ({ spanText: a.spanText, label: a.label }));
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

  // ── Proposal Card (pending profile update) ────────────────────────────

  _renderProposalCard(topic) {
    const p = topic.pendingProposal;
    if (!p) return '';
    const triggerLabels = {
      labels: 'based on your recent labels',
      new_messages: 'based on recent messages',
      manual: 'from your manual refresh',
      merge: 'from merging topics',
      rename: 'from the topic rename',
    };
    const labelSymbols = {
      clear: '✓', unsure: '?', interested: '♥', not_relevant: '✗',
    };
    const triggerLine = triggerLabels[p.trigger] || p.trigger || '';
    const evidenceHint = (p.evidence && p.evidence.length)
      ? (() => {
          const e = p.evidence[0];
          const sym = labelSymbols[e.label] || '';
          const snippet = (e.spanText || '').length > 48
            ? (e.spanText || '').slice(0, 48) + '…'
            : (e.spanText || '');
          return ` · from your ${sym} on "${snippet}"`;
        })()
      : '';
    const lines = (p.changes || []).map(ch => {
      if (ch.kind === 'overview_add') {
        return `<div class="proposal-change proposal-change-add">+ Add: "${Utils.escapeHtml(ch.text)}"${evidenceHint ? `<span class="proposal-evidence">${Utils.escapeHtml(evidenceHint)}</span>` : ''}</div>`;
      }
      if (ch.kind === 'overview_remove') {
        return `<div class="proposal-change proposal-change-remove">− Remove: "${Utils.escapeHtml(ch.text)}"</div>`;
      }
      if (ch.kind === 'overview_edit') {
        return `<div class="proposal-change proposal-change-edit">~ Edit: "${Utils.escapeHtml(ch.oldText)}" → "${Utils.escapeHtml(ch.text)}"</div>`;
      }
      return '';
    }).join('');
    return `
      <div class="temporal-card proposal-card" id="proposalCard">
        <div class="temporal-card-header">
          <span class="temporal-card-title">Proposed update to "${Utils.escapeHtml(topic.name)}"</span>
        </div>
        ${triggerLine ? `<div class="temporal-card-meta">${Utils.escapeHtml(triggerLine)}</div>` : ''}
        <div class="proposal-changes">${lines}</div>
        <div class="proposal-actions">
          <button class="probe-btn proposal-accept-btn" title="Accept this update">Accept</button>
          <button class="probe-btn proposal-edit-btn" title="Edit before applying">Edit</button>
          <button class="probe-btn proposal-dismiss-btn" title="Not part of my context">Not part of my context</button>
        </div>
      </div>
    `;
  },

  _bindProposalActions() {
    const card = document.getElementById('proposalCard');
    if (!card) return;
    const bind = (sel, fn) => {
      const btn = card.querySelector(sel);
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    bind('.proposal-accept-btn', () => this._acceptProposal());
    bind('.proposal-edit-btn', () => this._editProposal());
    bind('.proposal-dismiss-btn', () => this._dismissProposal());
  },

  /** Current topic, only when it has a pending proposal */
  _getProposalTopic() {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    return (topic && topic.pendingProposal) ? topic : null;
  },

  _acceptProposal() {
    const topic = this._getProposalTopic();
    if (!topic) return;
    const p = topic.pendingProposal;
    Storage.pushStatusSnapshot(topic, 'proposal_accept');
    topic.statusSummary = { ...(topic.statusSummary || {}), overview: p.statusUpdate.overview };
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

  /** Swap the proposal card into edit mode: one textarea per change, each skippable */
  _editProposal() {
    const topic = this._getProposalTopic();
    const card = document.getElementById('proposalCard');
    if (!topic || !card) return;
    const kindLabels = {
      overview_add: '+ Add', overview_remove: '− Remove',
      overview_edit: '~ Edit',
    };
    const rows = (topic.pendingProposal.changes || []).map((ch, i) => {
      const prefill = ch.kind === 'overview_remove' ? ch.oldText : ch.text;
      return `
        <div class="proposal-edit-row" data-idx="${i}">
          <div class="proposal-edit-row-head">
            <span class="proposal-edit-kind">${kindLabels[ch.kind] || ch.kind}</span>
            <button class="probe-btn proposal-skip-btn" title="Skip this change">Skip</button>
          </div>
          <textarea class="status-inline-edit proposal-edit-input" rows="1">${Utils.escapeHtml(prefill || '')}</textarea>
        </div>`;
    }).join('');
    card.innerHTML = `
      <div class="temporal-card-header">
        <span class="temporal-card-title">Edit proposed update</span>
      </div>
      ${rows}
      <div class="proposal-actions">
        <button class="probe-btn proposal-accept-btn proposal-save-btn" title="Apply edited update">Save changes</button>
        <button class="probe-btn proposal-cancel-btn" title="Back to proposal">Cancel</button>
      </div>
    `;
    card.querySelectorAll('.proposal-edit-input').forEach(ta => {
      const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', grow);
      grow();
    });
    card.querySelectorAll('.proposal-skip-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('.proposal-edit-row');
        row.classList.toggle('proposal-skipped');
        btn.textContent = row.classList.contains('proposal-skipped') ? 'Keep' : 'Skip';
      });
    });
    card.querySelector('.proposal-save-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._saveProposalEdits();
    });
    card.querySelector('.proposal-cancel-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._renderStatus(this._getCurrentStatus());
    });
  },

  _saveProposalEdits() {
    const topic = this._getProposalTopic();
    const card = document.getElementById('proposalCard');
    if (!topic || !card) return;
    const p = topic.pendingProposal;
    Storage.pushStatusSnapshot(topic, 'proposal_edit');
    if (!topic.statusSummary || typeof topic.statusSummary !== 'object') {
      topic.statusSummary = { overview: [] };
    }
    const summary = topic.statusSummary;
    if (!Array.isArray(summary.overview)) summary.overview = [];
    const norm = s => (s || '').trim().toLowerCase();
    const findOverviewIdx = text =>
      summary.overview.findIndex(it => norm(this._statusItemText(it)) === norm(text));

    card.querySelectorAll('.proposal-edit-row').forEach(row => {
      if (row.classList.contains('proposal-skipped')) return;
      const ch = p.changes[parseInt(row.dataset.idx, 10)];
      if (!ch) return;
      const text = row.querySelector('.proposal-edit-input').value.trim();
      if (ch.kind === 'overview_remove') {
        const i = findOverviewIdx(ch.oldText);
        if (i >= 0) summary.overview.splice(i, 1);
      } else if (ch.kind === 'overview_edit') {
        const i = findOverviewIdx(ch.oldText);
        if (text) {
          if (i >= 0) {
            if (typeof summary.overview[i] === 'object') {
              summary.overview[i].text = text;
              summary.overview[i].source = 'user';
            } else {
              summary.overview[i] = { text, source: 'user' };
            }
          } else {
            summary.overview.push({ text, source: 'user' });
          }
        } else if (i >= 0) {
          summary.overview.splice(i, 1); // emptied edit = remove
        }
      } else if (ch.kind === 'overview_add') {
        if (text) summary.overview.push({ text, source: 'user' });
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

    // Overview scope toggle ("use only within this topic")
    container.querySelectorAll('.status-item .status-item-scope').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleItemScope('overview', parseInt(btn.dataset.idx));
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

  /** Toggle an overview bullet between topic-scoped and anywhere */
  _toggleItemScope(section, idx) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    Storage.pushStatusSnapshot(topic, 'scope');
    const item = arr[idx];
    const nowScoped = !(item && typeof item === 'object' && item.scope === 'topic');
    if (typeof item === 'object' && item) {
      if (nowScoped) item.scope = 'topic';
      else delete item.scope;
    } else if (section === 'overview') {
      arr[idx] = { text: item, scope: 'topic' };
    }
    const itemText = section === 'overview'
      ? this._statusItemText(arr[idx])
      : (typeof arr[idx] === 'object' ? arr[idx].title : arr[idx]);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('context_item_scoped', {
      stage: 'apply', initiative: 'user', topicId: this.currentTopicId,
      itemText, scope: nowScoped ? 'topic' : 'anywhere',
    });
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
    if (arr[idx] && typeof arr[idx] === 'object') {
      arr[idx].text = newText;
      arr[idx].source = 'user';
    } else {
      arr[idx] = { text: newText, source: 'user' };
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
      const newOverview = data.overview || overview;
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

  _serializeStatus(statusSummary, opts = {}) {
    if (!statusSummary) return '';
    if (typeof statusSummary === 'string') return statusSummary;
    const includeTopicScoped = opts.includeTopicScoped !== false;
    const parts = [];
    if (statusSummary.overview && statusSummary.overview.length > 0) {
      const items = statusSummary.overview
        .filter(it => includeTopicScoped || !(it && typeof it === 'object' && it.scope === 'topic'))
        .map(it => (typeof it === 'string' ? it : (it && it.text) || ''));
      if (items.length > 0) {
        parts.push('Overview: ' + items.join('; '));
      }
    }
    return parts.join('\n');
  },

  // ── Future: Direction Cards ───────────────────────────────────────────

  _createDirectionCard(dir, directionIdx) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const matchedIntention = topic ? this._findIntention(topic, dir.title) : null;
    // When the direction is saved as an intention, the intention is source of truth for the question
    const effectiveDir = matchedIntention ? { ...dir, question: matchedIntention.question } : dir;

    const el = document.createElement('div');
    const typeClass = dir.type === 'breadth' ? 'type-breadth' : dir.type === 'depth' ? 'type-depth' : '';
    el.className = `temporal-card direction-card${matchedIntention ? ' intention-linked' : ''}${typeClass ? ' ' + typeClass : ''}`;
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

    const intentionBadgeHtml = matchedIntention
      ? `<div class="intention-badge">Your intention</div>` : '';
    const provenanceHtml = matchedIntention
      ? `<div class="direction-provenance">Suggested ${Utils.escapeHtml(this._formatIntentionDate(matchedIntention.suggestedAt))} · saved by you</div>`
      : effectiveDir.editedByUser
        ? `<div class="direction-provenance">edited by you</div>`
        : '';
    const saveBtnHtml = matchedIntention ? ''
      : `<button class="probe-btn direction-save-btn" title="Save as intention">Save as intention</button>`;

    el.innerHTML = `
      ${badgeHtml}
      ${intentionBadgeHtml}
      ${anchorHtml}
      <div class="temporal-card-header">
        <span class="temporal-card-title">${Utils.escapeHtml(effectiveDir.title || '')}</span>
      </div>
      <div class="temporal-card-question">${Utils.escapeHtml(effectiveDir.question || '')}</div>
      ${reasonHtml}
      ${provenanceHtml}
      <div class="temporal-card-actions">
        ${saveBtnHtml}
        <button class="probe-btn direction-modify-btn" title="Edit the question">Modify</button>
        <button class="probe-btn direction-dismiss-btn" title="Dismiss this suggestion">Dismiss</button>
        <button class="card-new-chat-btn" title="Explore in new chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Explore now
        </button>
      </div>
    `;

    // Disposition buttons
    const saveBtn = el.querySelector('.direction-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._saveDirectionAsIntention(effectiveDir);
      });
    }
    el.querySelector('.direction-modify-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._startDirectionEdit(el, effectiveDir);
    });
    el.querySelector('.direction-dismiss-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._dismissDirection(effectiveDir, el);
    });

    // New chat
    el.querySelector('.card-new-chat-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('future_direction_new_chat', { stage: 'evolve', initiative: 'user', topicId: this.currentTopicId, directionIdx });
      const chatId = this._startDirectionInNewChat(effectiveDir);
      this._markIntentionExplored(effectiveDir.title, chatId);
    });

    // Drag to chat
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', effectiveDir.question || '');
      e.dataTransfer.setData('application/loom-label', `[Future Direction] ${effectiveDir.title || ''}`);
      e.dataTransfer.setData('application/loom-context-type', 'future_direction');
      e.dataTransfer.setData('application/loom-question', effectiveDir.question || '');
      el.classList.add('dragging');
      StudyLog.event('future_suggestion_dragged', { stage: 'evolve', initiative: 'user', topicId: this.currentTopicId, directionIdx, title: dir.title });
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    // Click to inject in chat
    el.addEventListener('click', () => {
      StudyLog.event('future_direction_clicked', { stage: 'evolve', initiative: 'user', topicId: this.currentTopicId, directionIdx });
      App.setContextBlock(effectiveDir.question || '', `[Future Direction] ${effectiveDir.title || ''}`, {
        type: 'future_direction',
        title: effectiveDir.title || '',
        question: effectiveDir.question || '',
      });
    });

    return el;
  },

  // ── Future: Intentions ────────────────────────────────────────────────

  _findIntention(topic, title) {
    if (!topic || !Array.isArray(topic.intentions) || !title) return null;
    const norm = (title || '').trim().toLowerCase();
    return topic.intentions.find(i => (i.title || '').trim().toLowerCase() === norm) || null;
  },

  _formatIntentionDate(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  },

  /** Re-render the whole Evolve section body (intentions + direction cards) from saved state */
  _renderEvolveSection(topic) {
    if (!topic) topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    this._renderIntentions(topic);
    const dirs = (topic && topic.sidebarCache && topic.sidebarCache.newDirections) || [];
    this._renderDirectionCards(dirs);
  },

  _renderIntentions(topic) {
    const container = document.getElementById('intentionsList');
    if (!container) return;
    const intentions = (topic && Array.isArray(topic.intentions)) ? topic.intentions : [];
    container.innerHTML = '';
    if (intentions.length === 0) return;
    const label = document.createElement('div');
    label.className = 'intentions-label';
    label.textContent = 'Your intentions';
    container.appendChild(label);
    intentions.forEach(intention => container.appendChild(this._createIntentionCard(intention)));
  },

  _renderDirectionCards(dirs, emptyHint = 'Keep chatting to generate future directions.') {
    const dirContainer = document.getElementById('directionCards');
    if (!dirContainer) return;
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const dismissed = new Set(((topic && topic.dismissedDirections) || []).map(t => (t || '').toLowerCase()));
    dirContainer.innerHTML = '';
    const sorted = [...(dirs || [])]
      .filter(d => !dismissed.has((d.title || '').toLowerCase()))
      .sort((a, b) => {
        const order = { breadth: 0, depth: 1 };
        return (order[a.type] ?? 2) - (order[b.type] ?? 2);
      });
    if (sorted.length === 0) {
      dirContainer.innerHTML = `<p class="temporal-empty-hint">${emptyHint}</p>`;
      return;
    }
    sorted.forEach((dir, idx) => dirContainer.appendChild(this._createDirectionCard(dir, idx)));
  },

  _createIntentionCard(intention) {
    const el = document.createElement('div');
    const explored = intention.status === 'explored';
    el.className = `temporal-card intention-card${explored ? ' intention-explored' : ''}`;

    const badgeText = explored ? 'Explored' : intention.editedByUser ? 'Edited by you' : 'Your intention';
    const provenance = intention.source === 'user'
      ? `Added by you ${this._formatIntentionDate(intention.savedAt)}`.trim()
      : `Suggested ${this._formatIntentionDate(intention.suggestedAt)} · saved by you`;

    // Explored: muted/collapsed with an optional link to the chat
    if (explored) {
      el.innerHTML = `
        <div class="temporal-card-header">
          <span class="temporal-card-title">${Utils.escapeHtml(intention.title || '')}</span>
        </div>
        <div class="intention-card-meta">
          <span class="intention-badge">${badgeText}</span>
          ${intention.chatId ? '<a class="intention-view-chat" href="#">view chat</a>' : ''}
        </div>
      `;
      const link = el.querySelector('.intention-view-chat');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            this._flushDirtyLabels();
            App._summarizeCurrentChat();
            App._renderChat(intention.chatId);
            App._renderChatList();
          } catch (err) {
            console.warn('Failed to open intention chat:', err);
          }
        });
      }
      return el;
    }

    el.innerHTML = `
      <div class="temporal-card-header">
        <span class="temporal-card-title">${Utils.escapeHtml(intention.title || '')}</span>
      </div>
      <div class="temporal-card-question">${Utils.escapeHtml(intention.question || '')}</div>
      <div class="intention-card-meta">
        <span class="intention-badge">${badgeText}</span>
        <span class="direction-provenance">${Utils.escapeHtml(provenance)}</span>
      </div>
      <div class="temporal-card-actions">
        <button class="probe-btn intention-remove-btn" title="Remove intention">Remove</button>
        <button class="card-new-chat-btn intention-explore-btn" title="Explore in new chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Explore now
        </button>
      </div>
    `;

    el.querySelector('.intention-explore-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('future_direction_new_chat', { stage: 'evolve', initiative: 'user', topicId: this.currentTopicId, intentionId: intention.id });
      const chatId = this._startDirectionInNewChat({ title: intention.title, question: intention.question });
      this._markIntentionExplored(intention.title, chatId);
    });
    el.querySelector('.intention-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._removeIntention(intention.id);
    });

    return el;
  },

  _saveDirectionAsIntention(dir) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic || this._findIntention(topic, dir.title)) return;
    const now = Utils.timestamp();
    topic.intentions.push({
      id: 'int_' + Utils.generateId(),
      title: dir.title || '',
      question: dir.question || '',
      anchor: dir.anchor || null,
      type: dir.type || null,
      reason: dir.reason || null,
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
    StudyLog.event('intention_saved', { stage: 'evolve', initiative: 'mixed', topicId: topic.id, title: dir.title });
  },

  _dismissDirection(dir, el) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    el.remove();
    if (!topic.dismissedDirections.includes(dir.title)) {
      topic.dismissedDirections.push(dir.title);
    }
    Storage.saveTopic(topic);
    StudyLog.event('intention_dismissed', { stage: 'evolve', initiative: 'user', topicId: topic.id, title: dir.title });
  },

  _markIntentionExplored(title, chatId) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    const intention = this._findIntention(topic, title);
    if (!intention || intention.status === 'explored') return;
    intention.status = 'explored';
    intention.exploredAt = Utils.timestamp();
    intention.chatId = chatId || null;
    Storage.saveTopic(topic);
    this._renderEvolveSection(topic);
    StudyLog.event('intention_explored', {
      stage: 'evolve', initiative: 'mixed', topicId: topic.id,
      source: intention.source, title: intention.title,
    });
  },

  _removeIntention(intentionId) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    const idx = (topic.intentions || []).findIndex(i => i.id === intentionId);
    if (idx < 0) return;
    const title = topic.intentions[idx].title;
    topic.intentions.splice(idx, 1);
    Storage.saveTopic(topic);
    this._renderEvolveSection(topic);
    StudyLog.event('intention_removed', { stage: 'evolve', initiative: 'user', topicId: topic.id, title });
  },

  /** Inline-edit a direction card's question (reuse the status inline-edit pattern) */
  _startDirectionEdit(el, dir) {
    const qEl = el.querySelector('.temporal-card-question');
    if (!qEl || el.querySelector('.direction-edit-input')) return;
    const original = dir.question || '';
    const ta = document.createElement('textarea');
    ta.className = 'status-inline-edit direction-edit-input';
    ta.value = original;
    ta.rows = 1;
    qEl.replaceWith(ta);
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
      if (val && val !== original) this._saveDirectionEdit(dir, val);
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

  _saveDirectionEdit(dir, newQuestion) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    const intention = this._findIntention(topic, dir.title);
    if (intention) {
      // Already saved — update the stored intention instead
      intention.question = newQuestion;
      intention.editedByUser = true;
    } else {
      dir.question = newQuestion;
      dir.editedByUser = true;
      const cached = (topic.sidebarCache && topic.sidebarCache.newDirections) || [];
      const entry = cached.find(d => d.title === dir.title);
      if (entry) { entry.question = newQuestion; entry.editedByUser = true; }
      if (this.currentData && Array.isArray(this.currentData.newDirections)) {
        const cur = this.currentData.newDirections.find(d => d.title === dir.title);
        if (cur) { cur.question = newQuestion; cur.editedByUser = true; }
      }
    }
    Storage.saveTopic(topic);
    this._renderEvolveSection(topic);
    StudyLog.event('intention_modified', { stage: 'evolve', initiative: 'user', topicId: topic.id, title: dir.title });
  },

  _initAddIntention() {
    const input = document.getElementById('addIntentionInput');
    const btn = document.getElementById('addIntentionBtn');
    if (!input || !btn) return;
    const submit = () => {
      const text = input.value.trim();
      if (!text || !this.currentTopicId) return;
      const topic = Storage.getTopic(this.currentTopicId);
      if (!topic) return;
      topic.intentions.push({
        id: 'int_' + Utils.generateId(),
        title: text.split(/\s+/).slice(0, 6).join(' '),
        question: text,
        anchor: null,
        type: null,
        reason: null,
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
      StudyLog.event('intention_authored', { stage: 'evolve', initiative: 'user', topicId: topic.id });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    btn.addEventListener('click', (e) => { e.stopPropagation(); submit(); });
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
    const undoBtn = document.getElementById('statusUndoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._undoStatusUpdate();
      });
    }
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
    const history = Array.isArray(topic.statusHistory) ? topic.statusHistory : [];
    if (history.length === 0) {
      Utils.showToast('Nothing to undo');
      return;
    }
    const popped = history.pop();
    Storage.pushStatusSnapshot(topic, 'pre_undo');
    topic.statusSummary = popped.statusSummary;
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('update_undone', {
      stage: 'construct',
      initiative: 'user',
      topicId: this.currentTopicId,
      trigger: popped.trigger,
    });
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
    // Bind outside-click / Escape handlers after this click finishes bubbling
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
    const history = (topic && Array.isArray(topic.statusHistory)) ? topic.statusHistory : [];
    let html = '<div class="status-history-popover-label">Update history</div>';
    if (history.length === 0) {
      html += '<div class="status-history-empty">No previous versions</div>';
    } else {
      [...history].reverse().forEach((snap, revIdx) => {
        const idx = history.length - 1 - revIdx;
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
    pop.querySelectorAll('.status-history-restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._restoreStatusVersion(parseInt(btn.dataset.idx, 10));
      });
    });
  },

  _restoreStatusVersion(idx) {
    if (!this.currentTopicId) return;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || !Array.isArray(topic.statusHistory)) return;
    const snapshot = topic.statusHistory[idx];
    if (!snapshot) return;
    Storage.pushStatusSnapshot(topic, 'pre_restore');
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
      labels: 'from labels',
      manual: 'manual update',
      new_messages: 'auto-update',
      ai_edit: 'AI edit',
      inline_edit: 'edit',
      delete_item: 'delete',
      delete_concept: 'concept removed',
      stance: 'stance change',
      proposal_accept: 'proposal accepted',
      proposal_edit: 'proposal edited',
      pre_undo: 'before restore',
      pre_restore: 'before restore',
      merge: 'topic merge',
      rename: 'rename',
    };
    return labels[trigger] || trigger || 'update';
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

  /** Collect quick-label annotations not yet sent to status update (excludes comments). */
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
          if (a.label === 'comment') continue;
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
    // Dismissed directions count as previously suggested so they stay excluded
    const dismissed = Array.isArray(topic.dismissedDirections) ? topic.dismissedDirections : [];
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
      const newDirs = (data.newDirections || []).filter(d => !dismissedLower.has((d.title || '').toLowerCase()));

      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        if (!freshTopic.sidebarCache) freshTopic.sidebarCache = {};
        freshTopic.sidebarCache.newDirections = newDirs;
        Storage.saveTopic(freshTopic);
      }

      if (location === 'sidebar' && topicId === this.currentTopicId) {
        this._renderDirectionCards(newDirs, 'Keep chatting for suggestions.');
        if (freshTopic) this._renderIntentions(freshTopic);
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
