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
    this._initSidebarLayout();
    if (localStorage.getItem('loom_sidebarTab') === 'graph') {
      localStorage.setItem('loom_sidebarTab', 'list');
    }
  },

  _activateListTab() {
    if (this.currentTopicId) {
      ['sectionCurrent', 'sectionFuture'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
      });
    }
  },

  // ── Lifecycle ─────────────────────────────────────────────────────────

  show(topicId) {
    if (STUDY_CONDITION === 'baseline') return;
    this.currentTopicId = topicId;
    document.getElementById('sidebarEmpty').style.display = 'none';

    const topic = Storage.getTopic(topicId);
    this._renderEvolveSection(topic);
    if (topic) {
      this._applyTopicColor(topic);

      this._activateListTab();

      if (topic.sidebarCache) {
        this.currentData = topic.sidebarCache;
        this.render(topic.sidebarCache, topic);
        return;
      }
      if (topic.pendingProposal) {
        this._renderStatus(topic.statusSummary || null);
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

  _applyTopicColor(topic) {
    const el = document.getElementById('currentTopicName');
    const color = topic ? Utils.getTopicColor(topic).color : '';
    if (el) {
      el.textContent = topic ? topic.name : '';
      el.style.color = color;
    }
    document.querySelectorAll('.temporal-phase-dot').forEach(dot => {
      dot.style.background = color;
    });
  },

  hide() {
    this.currentTopicId = null;
    document.getElementById('sectionCurrent').style.display = 'none';
    document.getElementById('sectionFuture').style.display = 'none';
    this._applyTopicColor(null);

    if (STUDY_CONDITION === 'baseline') {
      document.getElementById('sidebarEmpty').style.display = 'none';
      this.showBaseline();
    } else {
      document.getElementById('sidebarEmpty').style.display = 'block';
      const baselineModule = document.getElementById('moduleBaseline');
      if (baselineModule) baselineModule.style.display = 'none';
    }
  },

  async refresh(trigger = 'manual') {
    if (!this.currentTopicId) return false;
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return false;
    StudyLog.event('status_refresh_triggered', { topicId: topic.id, trigger });

    const chatId = Storage.getCurrentChatId();
    const messages = Storage.getMessages(chatId).map(m => ({
      role: m.role, content: m.content,
    }));
    if (messages.length === 0) return false;
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
        StudyLog.event('directions_refreshed', {
          stage: 'evolve', initiative: 'system', surface: 'sidebar', topicId: topic.id,
          count: data.newDirections.length,
        });
      }
      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        freshTopic.needsInitialUpdate = false;
        this._markAnnotationsFlushed(freshTopic, pendingAnnos);
        if (this.currentTopicId === topic.id) {
          this.currentData = data;
          this.render(data, freshTopic, trigger);
        } else if (data.statusUpdate) {
          this._stageProposal(freshTopic, data.statusUpdate, trigger);
          delete data.statusUpdate;
        }
        freshTopic.sidebarCache = data;
        Storage.saveTopic(freshTopic);
      }
      return true;
    } catch (err) {
      console.error('Sidebar refresh failed:', err);
      Utils.showToast('Sidebar refresh failed', 'error');
      return false;
    }
  },

  render(data, topic, trigger = 'new_messages') {
    if (!topic) topic = Storage.getTopic(this.currentTopicId);
    if (!topic) return;

    // Current: stage system status updates as a proposal — never silently rewrite
    if (data.statusUpdate) {
      this._stageProposal(topic, data.statusUpdate, trigger);
      delete data.statusUpdate; // consumed — don't re-stage from sidebarCache on next show()
      Storage.saveTopic(topic);
    }
    this._renderStatus(topic.statusSummary || null);

    this._renderSuggestedGoals((data.newDirections || []).map(d => this._normalizeDirection(d)));
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
      this._renderConstructGoals(null, null, false);
      this._bindStatusItemActions();
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
          <button class="overview-manual-edit-btn" title="Edit overview" aria-label="Edit overview">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="overview-ai-edit-btn" title="AI edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>
          </button>
        </div>
        <div class="overview-ai-prompt-slot"></div>
        <div class="status-section-items${localStorage.getItem('loom_overviewCollapsed') === 'true' ? ' section-collapsed' : ''}" data-section-items="overview">
    `;

    if (proposal) {
      html += this._renderSuggestionOverview(overview, proposal, editMode);
    } else if (overview.length > 0) {
      overview.forEach((pt, i) => {
        html += this._renderNormalOverviewItem(pt, i);
      });
    } else {
      html += '<p class="temporal-empty-hint">Chat more to build your profile.</p>';
    }

    html += '</div></div>';
    container.innerHTML = html;
    this._renderConstructGoals(statusData, proposal, editMode);
    this._bindStatusItemActions();
    if (proposal) this._bindProposalActions(editMode);
    this._scheduleSidebarLayout();
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

  _overviewToMarkdown(overview) {
    return (overview || []).map(it => {
      const item = this._normalizeOverviewItem(it);
      if (!item) return '';
      return item.type === 'header' ? `## ${item.text}` : `- ${item.text}`;
    }).filter(Boolean).join('\n');
  },

  _parseOverviewMarkdown(markdown, previous = []) {
    const pools = new Map();
    (previous || []).forEach(raw => {
      const item = this._normalizeOverviewItem(raw);
      if (!item) return;
      const key = this._overviewItemKey(item.type, item.text);
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(raw);
    });
    return String(markdown || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      let type = 'bullet';
      let text = line;
      const header = line.match(/^#{1,6}\s+(.+)$/);
      const bullet = line.match(/^[-*+]\s+(.+)$/);
      if (header) {
        type = 'header';
        text = header[1].trim();
      } else if (bullet) {
        text = bullet[1].trim();
      }
      if (!text) return null;
      const key = this._overviewItemKey(type, text);
      const prior = pools.get(key)?.shift();
      if (type === 'header') return { type: 'header', text };
      return {
        type: 'bullet',
        text,
        source: (prior && typeof prior === 'object' && prior.source) || 'user',
      };
    }).filter(Boolean);
  },

  _overviewEqual(a, b) {
    const normalize = list => (list || []).map(it => {
      const n = this._normalizeOverviewItem(it);
      return n ? { type: n.type, text: n.text } : null;
    }).filter(Boolean);
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
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
    return `<div class="status-item status-bullet" data-section="overview" data-idx="${i}" data-item-type="bullet">
      <span class="status-item-text">${Utils.escapeHtml(item.text)}</span>
      <span class="status-item-actions">
        <button class="status-item-btn status-item-del" title="Remove">×</button>
      </span></div>`;
  },

  _ensureStatusShape(topic) {
    if (!topic) return;
    const s = topic.statusSummary;
    if (typeof s === 'string') {
      const text = s.trim();
      topic.statusSummary = { overview: text ? [{ text, source: 'inferred' }] : [], goals: [] };
      return;
    }
    if (!s || typeof s !== 'object') {
      topic.statusSummary = { overview: [], goals: [] };
      return;
    }
    if (Array.isArray(s)) {
      topic.statusSummary = {
        overview: s.map(pt => this._normalizeOverviewItem(pt)).filter(Boolean),
        goals: [],
      };
      return;
    }
    if (!Array.isArray(s.overview)) s.overview = [];
    if (!Array.isArray(s.goals)) s.goals = [];
  },

  _getConfirmedGoals(topic) {
    if (!topic || !topic.statusSummary || !Array.isArray(topic.statusSummary.goals)) return [];
    return topic.statusSummary.goals;
  },

  _normalizeGoalItem(it, defaultSource) {
    if (typeof it === 'string') {
      const text = it.trim();
      return text ? { text, source: defaultSource || 'inferred' } : null;
    }
    if (!it || typeof it !== 'object') return null;
    const text = (it.text || it.title || '').trim();
    if (!text) return null;
    const item = { text, source: it.source || defaultSource || 'inferred' };
    if (it.id) item.id = it.id;
    if (it.suggestionTitle) item.suggestionTitle = it.suggestionTitle;
    if (it.suggestionType) item.suggestionType = it.suggestionType;
    if (it.savedQuestions) item.savedQuestions = it.savedQuestions;
    return item;
  },

  _goalText(g) {
    if (!g) return '';
    if (typeof g === 'string') return g.trim();
    return (g.text || g.title || '').trim();
  },

  _renderNormalGoalItem(g, i) {
    const item = this._normalizeGoalItem(g) || { text: '' };
    const questions = Array.isArray(item.savedQuestions) ? item.savedQuestions : [];
    const questionRows = questions.map(q => `
      <div class="goal-saved-question-row">
        <span>${Utils.escapeHtml(q.text || '')}</span>
        <button class="status-item-btn saved-question-ask" type="button">Ask</button>
      </div>`).join('');
    const details = questions.length
      ? `<details class="goal-saved-questions"><summary>${questions.length} saved question${questions.length === 1 ? '' : 's'}</summary>${questionRows}</details>`
      : '';
    return `<div class="status-goal-wrap">
      <div class="status-item status-goal" data-section="goals" data-idx="${i}" data-goal-id="${Utils.escapeHtml(item.id || '')}">
        <span class="status-item-text">${Utils.escapeHtml(item.text)}</span>
        <span class="status-item-actions">
          <button class="status-item-btn status-item-del" title="Remove">×</button>
        </span>
      </div>${details}
    </div>`;
  },

  _renderSuggestionGoals(goals, proposal, editMode) {
    const changes = proposal.changes || [];
    const keyOf = (c, field) => ((c[field] || c.text || c.oldText || '').trim().toLowerCase());
    const removeSet = new Set(
      changes.filter(c => c.kind === 'goal_remove').map(c => keyOf(c, 'text'))
    );
    const editMap = new Map();
    changes.filter(c => c.kind === 'goal_edit').forEach(c => editMap.set(keyOf(c, 'oldText'), c));
    const addChanges = changes
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind === 'goal_add');

    let html = '';
    goals.forEach((g, i) => {
      const text = this._goalText(g);
      const key = text.toLowerCase();
      const edit = editMap.get(key);
      if (removeSet.has(key)) {
        const chIdx = changes.findIndex(c => c.kind === 'goal_remove' && keyOf(c, 'text') === key);
        if (editMode) {
          html += `<div class="status-item status-goal suggestion-edit-row" data-change-idx="${chIdx}" data-field="goals">
            <textarea class="status-inline-edit proposal-edit-input" rows="1" disabled>${Utils.escapeHtml(text)}</textarea>
            <button class="status-item-btn proposal-drop-change" data-change-idx="${chIdx}" title="Remove this change">×</button>
          </div>`;
        } else {
          html += `<div class="status-item status-goal suggestion-item" data-change-idx="${chIdx}">
            <span class="status-item-text"><span class="diff-del">${Utils.escapeHtml(text)}</span></span>
            ${this._proposalLineActionsHtml(chIdx)}
          </div>`;
        }
      } else if (edit) {
        const chIdx = changes.findIndex(c => c.kind === 'goal_edit' && keyOf(c, 'oldText') === key);
        if (editMode) {
          html += `<div class="status-item status-goal suggestion-edit-row" data-change-idx="${chIdx}" data-field="goals">
            <textarea class="status-inline-edit proposal-edit-input" rows="1">${Utils.escapeHtml(edit.text || '')}</textarea>
            <button class="status-item-btn proposal-drop-change" data-change-idx="${chIdx}" title="Remove this change">×</button>
          </div>`;
        } else {
          html += `<div class="status-item status-goal suggestion-item" data-change-idx="${chIdx}">
            <span class="status-item-text">${this._renderWordDiffHtml(edit.oldText, edit.text)}</span>
            ${this._proposalLineActionsHtml(chIdx)}
          </div>`;
        }
      } else {
        html += this._renderNormalGoalItem(g, i);
      }
    });

    addChanges.forEach(({ c, i }) => {
      if (editMode) {
        html += `<div class="status-item status-goal suggestion-edit-row" data-change-idx="${i}" data-field="goals">
          <textarea class="status-inline-edit proposal-edit-input" rows="1">${Utils.escapeHtml(c.text || '')}</textarea>
          <button class="status-item-btn proposal-drop-change" data-change-idx="${i}" title="Remove this change">×</button>
        </div>`;
      } else {
        html += `<div class="status-item status-goal suggestion-item" data-change-idx="${i}">
          <span class="status-item-text"><span class="diff-add">${Utils.escapeHtml(c.text || '')}</span></span>
          ${this._proposalLineActionsHtml(i)}
        </div>`;
      }
    });
    return html;
  },

  _renderConstructGoals(statusData, proposal, editMode) {
    const list = document.getElementById('constructGoalsList');
    if (!list) return;
    const goals = (statusData && typeof statusData === 'object' && Array.isArray(statusData.goals))
      ? statusData.goals : [];
    const goalChanges = proposal
      ? (proposal.changes || []).filter(c => c.field === 'goals' || (c.kind || '').startsWith('goal_'))
      : [];
    let html = '';
    if (proposal && goalChanges.length > 0) {
      html += this._renderSuggestionGoals(goals, proposal, editMode);
    } else if (goals.length > 0) {
      goals.forEach((g, i) => { html += this._renderNormalGoalItem(g, i); });
    } else {
      html = '<p class="temporal-empty-hint">User goals you add will appear here.</p>';
    }
    if (proposal) html += this._renderProposalActionsBar(proposal, editMode);
    list.innerHTML = html;
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

  _proposalOverviewItems(proposal) {
    const ov = proposal && proposal.statusUpdate && proposal.statusUpdate.overview;
    return (ov || []).map(it => this._normalizeOverviewItem(it)).filter(Boolean);
  },

  _overviewInsertIndex(summaryOverview, ch, proposedItems) {
    const items = (summaryOverview || []).map(it => this._normalizeOverviewItem(it)).filter(Boolean);
    const pItems = proposedItems || [];
    const targetKey = this._overviewItemKey(ch.itemType || 'bullet', ch.text);
    const pIdx = pItems.findIndex(it => this._overviewItemKey(it.type, it.text) === targetKey);
    if (pIdx < 0) return items.length;
    if (pIdx === 0) return 0;
    for (let i = pIdx - 1; i >= 0; i--) {
      const predKey = this._overviewItemKey(pItems[i].type, pItems[i].text);
      const idx = items.findIndex(it => this._overviewItemKey(it.type, it.text) === predKey);
      if (idx >= 0) return idx + 1;
    }
    return 0;
  },

  _renderOverviewSuggestionRow(itemType, text, { mode, chIdx, editMode, oldText } = {}) {
    const rowCls = this._suggestionRowClass(itemType || 'bullet');
    if (editMode) {
      const disabled = mode === 'remove' ? ' disabled' : '';
      const value = mode === 'remove' ? text : (text || '');
      return `<div class="${rowCls} suggestion-edit-row" data-change-idx="${chIdx}">
        <textarea class="status-inline-edit proposal-edit-input" rows="1"${disabled}>${Utils.escapeHtml(value)}</textarea>
        <button class="status-item-btn proposal-drop-change" data-change-idx="${chIdx}" title="Remove this change">×</button>
      </div>`;
    }
    let body;
    if (mode === 'remove') {
      body = `<span class="diff-del">${Utils.escapeHtml(text || '')}</span>`;
    } else if (mode === 'edit') {
      body = this._renderWordDiffHtml(oldText, text);
    } else {
      body = `<span class="diff-add">${Utils.escapeHtml(text || '')}</span>`;
    }
    return `<div class="${rowCls} suggestion-item" data-change-idx="${chIdx}">
      <span class="status-item-text">${body}</span>
      ${this._proposalLineActionsHtml(chIdx)}
    </div>`;
  },

  _renderSuggestionOverview(overview, proposal, editMode) {
    const changes = proposal.changes || [];
    const keyOf = (c, field) => this._overviewItemKey(c.itemType || 'bullet', c[field] || c.text || c.oldText || '');
    const removeSet = new Set(
      changes.filter(c => c.kind === 'overview_remove').map(c => keyOf(c, 'text'))
    );
    const editByOld = new Map();
    const editByNew = new Map();
    changes.forEach((c, i) => {
      if (c.kind !== 'overview_edit') return;
      editByOld.set(keyOf(c, 'oldText'), { c, i });
      editByNew.set(this._overviewItemKey(c.itemType || 'bullet', c.text), { c, i });
    });
    const addByKey = new Map();
    changes.forEach((c, i) => {
      if (c.kind !== 'overview_add') return;
      addByKey.set(keyOf(c, 'text'), { c, i });
    });

    const proposed = this._proposalOverviewItems(proposal);
    let html = '';
    const shownAdd = new Set();
    const shownCurrent = new Set();

    const renderProposed = proposed.length > 0 ? proposed : null;
    if (renderProposed) {
      renderProposed.forEach((item, i) => {
        const key = this._overviewItemKey(item.type, item.text);
        const add = addByKey.get(key);
        if (add && !shownAdd.has(add.i)) {
          shownAdd.add(add.i);
          html += this._renderOverviewSuggestionRow(item.type, item.text, {
            mode: 'add', chIdx: add.i, editMode,
          });
          return;
        }
        const edit = editByNew.get(key);
        if (edit) {
          shownCurrent.add(this._overviewItemKey(edit.c.itemType || 'bullet', edit.c.oldText));
          html += this._renderOverviewSuggestionRow(item.type, edit.c.text, {
            mode: 'edit', chIdx: edit.i, editMode, oldText: edit.c.oldText,
          });
          return;
        }
        shownCurrent.add(key);
        html += this._renderNormalOverviewItem(item, i);
      });
    } else {
      overview.forEach((pt, i) => {
        const item = this._normalizeOverviewItem(pt) || { type: 'bullet', text: this._statusItemText(pt) };
        const key = this._overviewItemKey(item.type, item.text);
        const edit = editByOld.get(key);
        if (removeSet.has(key)) {
          const chIdx = changes.findIndex(c => c.kind === 'overview_remove' && keyOf(c, 'text') === key);
          html += this._renderOverviewSuggestionRow(item.type, item.text, {
            mode: 'remove', chIdx, editMode,
          });
        } else if (edit) {
          html += this._renderOverviewSuggestionRow(item.type, edit.c.text, {
            mode: 'edit', chIdx: edit.i, editMode, oldText: edit.c.oldText,
          });
        } else {
          html += this._renderNormalOverviewItem(pt, i);
        }
      });
    }

    overview.forEach((pt, i) => {
      const item = this._normalizeOverviewItem(pt);
      if (!item) return;
      const key = this._overviewItemKey(item.type, item.text);
      if (shownCurrent.has(key) || editByOld.has(key)) return;
      if (removeSet.has(key)) {
        const chIdx = changes.findIndex(c => c.kind === 'overview_remove' && keyOf(c, 'text') === key);
        html += this._renderOverviewSuggestionRow(item.type, item.text, {
          mode: 'remove', chIdx, editMode,
        });
        return;
      }
      if (!renderProposed) return;
      // Current item kept but missing from the proposed walk — keep it visible.
      html += this._renderNormalOverviewItem(pt, i);
    });

    changes.forEach((c, i) => {
      if (c.kind !== 'overview_add' || shownAdd.has(i)) return;
      html += this._renderOverviewSuggestionRow(c.itemType || 'bullet', c.text, {
        mode: 'add', chIdx: i, editMode,
      });
    });
    return html;
  },

  _proposalLineActionsHtml(chIdx) {
    return `<span class="status-item-actions proposal-line-actions">
      <button class="status-item-btn proposal-accept-change" data-change-idx="${chIdx}" title="Accept">✓</button>
      <button class="status-item-btn proposal-drop-change" data-change-idx="${chIdx}" title="Reject">×</button>
    </span>`;
  },

  _changeKindShort(kind) {
    if ((kind || '').endsWith('_add')) return 'add';
    if ((kind || '').endsWith('_edit')) return 'edit';
    if ((kind || '').endsWith('_remove')) return 'remove';
    return kind || '';
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
    const labelSymbols = { important: '★', unsure: '?' };
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
    const changes = this._diffOverviewItems(cur.overview || [], prop.overview || []);
    if (prop && Object.prototype.hasOwnProperty.call(prop, 'goals')) {
      changes.push(...this._diffGoalItems(cur.goals || [], prop.goals || []));
    }
    return changes;
  },

  _diffOverviewItems(curOverview, propOverview) {
    const norm = s => (s || '').trim().toLowerCase();
    const curItems = (curOverview || []).map(it => this._normalizeOverviewItem(it)).filter(Boolean);
    const propItems = (propOverview || []).map(it => this._normalizeOverviewItem(it)).filter(Boolean);

    const usedOld = new Set();
    const usedNew = new Set();
    const pairs = [];

    curItems.forEach((oldItem, oi) => {
      const ni = propItems.findIndex((t, j) =>
        !usedNew.has(j) && t.type === oldItem.type && norm(t.text) === norm(oldItem.text));
      if (ni >= 0) {
        usedOld.add(oi);
        usedNew.add(ni);
      }
    });

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
        field: 'overview',
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
          field: 'overview',
          itemType: oldItem.type,
          text: oldItem.text,
          oldText: oldItem.text,
        });
      }
    });
    propItems.forEach((newItem, ni) => {
      if (!usedNew.has(ni)) {
        changes.push({ kind: 'overview_add', field: 'overview', itemType: newItem.type, text: newItem.text });
      }
    });
    return changes;
  },

  _diffGoalItems(curGoals, propGoals) {
    const norm = s => (s || '').trim().toLowerCase();
    const curItems = (curGoals || []).map(it => this._normalizeGoalItem(it)).filter(Boolean);
    const propItems = (propGoals || []).map(it => this._normalizeGoalItem(it)).filter(Boolean);
    const usedOld = new Set();
    const usedNew = new Set();
    const pairs = [];

    curItems.forEach((oldItem, oi) => {
      const ni = propItems.findIndex((t, j) => !usedNew.has(j) && norm(t.text) === norm(oldItem.text));
      if (ni >= 0) {
        usedOld.add(oi);
        usedNew.add(ni);
      }
    });

    const candidates = [];
    curItems.forEach((oldItem, oi) => {
      if (usedOld.has(oi)) return;
      propItems.forEach((newItem, ni) => {
        if (usedNew.has(ni)) return;
        const sim = this._textSimilarity(oldItem.text, newItem.text);
        if (sim >= 0.5) {
          candidates.push({ oi, ni, sim, oldText: oldItem.text, newText: newItem.text, oldId: oldItem.id });
        }
      });
    });
    candidates.sort((a, b) => b.sim - a.sim);
    candidates.forEach(c => {
      if (usedOld.has(c.oi) || usedNew.has(c.ni)) return;
      usedOld.add(c.oi);
      usedNew.add(c.ni);
      pairs.push({
        kind: 'goal_edit',
        field: 'goals',
        oldText: c.oldText,
        text: c.newText,
        goalId: c.oldId,
      });
    });

    const changes = [...pairs];
    curItems.forEach((oldItem, oi) => {
      if (!usedOld.has(oi)) {
        changes.push({
          kind: 'goal_remove',
          field: 'goals',
          text: oldItem.text,
          oldText: oldItem.text,
          goalId: oldItem.id,
        });
      }
    });
    propItems.forEach((newItem, ni) => {
      if (!usedNew.has(ni)) {
        changes.push({ kind: 'goal_add', field: 'goals', text: newItem.text });
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
    if (statusUpdate && Object.prototype.hasOwnProperty.call(statusUpdate, 'goals')) {
      const proposedGoals = (statusUpdate.goals || []).map(it => this._normalizeGoalItem(it, defaultSource)).filter(Boolean);
      const currentGoals = (topic.statusSummary && topic.statusSummary.goals) || [];
      // Empty goals from the model should not wipe user-authored goals
      if (!(proposedGoals.length === 0 && currentGoals.length > 0)) {
        effective.goals = proposedGoals;
      }
    }
    let changes = this._diffStatus(topic.statusSummary || { overview: [], goals: [] }, effective);
    if (changes.length === 0) {
      StudyLog.event('proposal_empty', { stage: 'construct', initiative: 'mixed', surface: 'sidebar', topicId: topic.id, trigger, ...this._proposalLogPayload(changes) });
      return false;
    }
    const MAX_PROPOSAL_CHANGES = 6;
    if (changes.length > MAX_PROPOSAL_CHANGES) {
      const originalCount = changes.length;
      changes = changes.slice(0, MAX_PROPOSAL_CHANGES);
      StudyLog.event('proposal_truncated', {
        stage: 'construct',
        surface: 'sidebar',
        topicId: topic.id,
        trigger,
        originalCount,
        keptCount: MAX_PROPOSAL_CHANGES,
      });
    }
    if (topic.pendingProposal) {
      StudyLog.event('proposal_superseded', { stage: 'construct', initiative: 'mixed', surface: 'sidebar', topicId: topic.id, trigger, ...this._proposalLogPayload(topic.pendingProposal.changes) });
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
      stage: 'construct', initiative: 'mixed', surface: 'sidebar', topicId: topic.id, trigger, nChanges: changes.length,
      ...this._proposalLogPayload(changes),
    });
    return true;
  },

  _proposalLogPayload(changes) {
    const fields = [...new Set((changes || []).map(c => c.field).filter(Boolean))];
    const extra = {};
    if (fields.length === 1) extra.field = fields[0];
    else if (fields.length > 1) extra.fields = fields;
    return extra;
  },

  // ── Proposal actions (inline suggestion mode) ─────────────────────────

  _bindProposalActions(editMode) {
    const bar = document.getElementById('proposalActionsBar');
    const bind = (sel, fn) => {
      const btn = bar && bar.querySelector(sel);
      if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    };
    const wrap = document.getElementById('statusContent') || this._getStatusContainer();
    if (wrap) {
      wrap.querySelectorAll('.proposal-accept-change').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._acceptProposalChange(parseInt(btn.dataset.changeIdx, 10));
        });
      });
      wrap.querySelectorAll('.proposal-drop-change').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._dropProposalChange(parseInt(btn.dataset.changeIdx, 10), { editMode });
        });
      });
    }
    if (editMode) {
      bind('.proposal-save-btn', () => this._saveProposalEdits());
      bind('.proposal-cancel-btn', () => this._renderStatus(this._getCurrentStatus()));
      if (wrap) {
        wrap.querySelectorAll('.proposal-edit-input').forEach(ta => {
          const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
          ta.addEventListener('input', grow);
          grow();
        });
      }
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

  _applyChangeToSummary(summary, ch, source) {
    const itemType = ch.itemType || 'bullet';
    const findOverviewIdx = (text, type) => {
      const key = this._overviewItemKey(type || 'bullet', text);
      return summary.overview.findIndex(it => {
        const n = this._normalizeOverviewItem(it);
        return n && this._overviewItemKey(n.type, n.text) === key;
      });
    };
    const findGoalIdx = (text) => {
      const key = (text || '').trim().toLowerCase();
      return summary.goals.findIndex(g => this._goalText(g).toLowerCase() === key);
    };
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
        const item = itemType === 'header'
          ? { type: 'header', text: ch.text }
          : { type: 'bullet', text: ch.text, source };
        const proposed = this._proposalOverviewItems(this._getProposalTopic()?.pendingProposal);
        const idx = this._overviewInsertIndex(summary.overview, ch, proposed);
        summary.overview.splice(idx, 0, item);
      }
    } else if (ch.kind === 'goal_remove') {
      const i = findGoalIdx(ch.text || ch.oldText);
      if (i >= 0) summary.goals.splice(i, 1);
    } else if (ch.kind === 'goal_edit') {
      const i = findGoalIdx(ch.oldText);
      if (i >= 0 && ch.text) {
        if (typeof summary.goals[i] === 'object') {
          summary.goals[i].text = ch.text;
          summary.goals[i].source = source;
        } else {
          summary.goals[i] = { id: 'goal_' + Utils.generateId(), text: ch.text, source };
        }
      } else if (ch.text) {
        summary.goals.push({ id: 'goal_' + Utils.generateId(), text: ch.text, source });
      }
    } else if (ch.kind === 'goal_add') {
      if (ch.text) {
        summary.goals.push({ id: 'goal_' + Utils.generateId(), text: ch.text, source });
      }
    }
  },

  _acceptProposal() {
    const topic = this._getProposalTopic();
    if (!topic) return;
    const p = topic.pendingProposal;
    Storage.pushStatusSnapshot(topic, 'proposal_accept');
    this._ensureStatusShape(topic);
    const summary = topic.statusSummary;
    const source = this._sourceForProposalChange(p);

    (p.changes || []).forEach(ch => this._applyChangeToSummary(summary, ch, source));

    topic.statusLastUpdated = Utils.timestamp();
    if (topic.sidebarCache) topic.sidebarCache.statusUpdate = topic.statusSummary;
    topic.pendingProposal = null;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    this._renderEvolveSection(topic);
    StudyLog.event('proposal_accepted', {
      stage: 'construct', initiative: 'mixed', surface: 'sidebar', topicId: topic.id,
      trigger: p.trigger, nChanges: (p.changes || []).length,
      ...this._proposalLogPayload(p.changes),
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
      stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: topic.id,
      trigger: p.trigger, nChanges: (p.changes || []).length,
      ...this._proposalLogPayload(p.changes),
    });
  },

  _editProposal() {
    this._renderStatus(this._getCurrentStatus(), { editMode: true });
  },

  _acceptProposalChange(idx) {
    const topic = this._getProposalTopic();
    if (!topic || !topic.pendingProposal) return;
    const changes = topic.pendingProposal.changes || [];
    if (idx < 0 || idx >= changes.length) return;
    const ch = changes[idx];
    this._ensureStatusShape(topic);
    const source = this._sourceForProposalChange(topic.pendingProposal);
    this._applyChangeToSummary(topic.statusSummary, ch, source);
    changes.splice(idx, 1);
    const field = ch.field || ((ch.kind || '').startsWith('goal_') ? 'goals' : 'overview');
    StudyLog.event('proposal_change_accepted', {
      stage: 'construct', initiative: 'user', surface: 'sidebar',
      topicId: topic.id, field, kind: this._changeKindShort(ch.kind),
    });
    if (changes.length === 0) topic.pendingProposal = null;
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    this._renderEvolveSection(topic);
  },

  _dropProposalChange(idx, opts = {}) {
    const topic = this._getProposalTopic();
    if (!topic || !topic.pendingProposal) return;
    const changes = topic.pendingProposal.changes || [];
    if (idx < 0 || idx >= changes.length) return;
    const ch = changes[idx];
    const field = ch.field || ((ch.kind || '').startsWith('goal_') ? 'goals' : 'overview');
    changes.splice(idx, 1);
    StudyLog.event('proposal_change_dismissed', {
      stage: 'construct', initiative: 'user', surface: 'sidebar',
      topicId: topic.id, field, kind: this._changeKindShort(ch.kind),
    });
    if (changes.length === 0) {
      topic.pendingProposal = null;
      Storage.saveTopic(topic);
      this._renderStatus(topic.statusSummary || null);
      return;
    }
    Storage.saveTopic(topic);
    this._renderStatus(this._getCurrentStatus(), { editMode: !!opts.editMode });
  },

  _saveProposalEdits() {
    const topic = this._getProposalTopic();
    const container = this._getStatusContainer();
    if (!topic || !container) return;
    const p = topic.pendingProposal;
    Storage.pushStatusSnapshot(topic, 'proposal_edit');
    this._ensureStatusShape(topic);
    const summary = topic.statusSummary;
    const findOverviewIdx = (text, itemType) => {
      const key = this._overviewItemKey(itemType || 'bullet', text);
      return summary.overview.findIndex(it => {
        const n = this._normalizeOverviewItem(it);
        return n && this._overviewItemKey(n.type, n.text) === key;
      });
    };
    const findGoalIdx = (text) => {
      const key = (text || '').trim().toLowerCase();
      return summary.goals.findIndex(g => this._goalText(g).toLowerCase() === key);
    };

    const statusContent = document.getElementById('statusContent') || container;
    statusContent.querySelectorAll('.suggestion-edit-row').forEach(row => {
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
          const item = itemType === 'header'
            ? { type: 'header', text }
            : { type: 'bullet', text, source: 'user' };
          const proposed = this._proposalOverviewItems(p);
          const idx = this._overviewInsertIndex(summary.overview, { ...ch, text }, proposed);
          summary.overview.splice(idx, 0, item);
        }
      } else if (ch.kind === 'goal_remove') {
        const i = findGoalIdx(ch.oldText || ch.text);
        if (i >= 0) summary.goals.splice(i, 1);
      } else if (ch.kind === 'goal_edit') {
        const i = findGoalIdx(ch.oldText);
        if (text) {
          if (i >= 0) {
            if (typeof summary.goals[i] === 'object') {
              summary.goals[i].text = text;
              summary.goals[i].source = 'user';
            } else {
              summary.goals[i] = { id: 'goal_' + Utils.generateId(), text, source: 'user' };
            }
          } else {
            summary.goals.push({ id: 'goal_' + Utils.generateId(), text, source: 'user' });
          }
        } else if (i >= 0) {
          summary.goals.splice(i, 1);
        }
      } else if (ch.kind === 'goal_add') {
        if (text) {
          summary.goals.push({ id: 'goal_' + Utils.generateId(), text, source: 'user' });
        }
      }
    });

    topic.statusLastUpdated = Utils.timestamp();
    if (topic.sidebarCache) topic.sidebarCache.statusUpdate = summary;
    topic.pendingProposal = null;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    this._renderEvolveSection(topic);
    StudyLog.event('proposal_edited', {
      stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: topic.id,
      trigger: p.trigger, nChanges: (p.changes || []).length,
      ...this._proposalLogPayload(p.changes),
    });
  },

  _bindStatusItemActions() {
    const containers = [this._getStatusContainer(), document.getElementById('constructGoalsList')].filter(Boolean);

    containers.forEach(container => {
      container.querySelectorAll('.saved-question-ask').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._fillQuestionInput(btn.closest('.goal-saved-question-row')?.querySelector('span')?.textContent || '');
        });
      });

      container.querySelectorAll('.status-item .status-item-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const item = btn.closest('.status-item');
          const section = item.dataset.section;
          const idx = parseInt(item.dataset.idx);
          this._deleteStatusItem(section, idx);
        });
      });

      container.querySelectorAll('.status-item[data-section="goals"]').forEach(item => {
        item.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this._startInlineEdit(item, item.dataset.section, parseInt(item.dataset.idx));
        });
      });
    });

    const overviewContainer = this._getStatusContainer();
    if (overviewContainer) {
      const overviewItems = overviewContainer.querySelector('.status-section-overview .status-section-items');
      const startOverviewEdit = (e) => {
        if (e?.target?.closest?.('button, textarea')) return;
        e?.stopPropagation?.();
        this._startOverviewMarkdownEdit();
      };
      overviewItems?.addEventListener('dblclick', startOverviewEdit);
      overviewContainer.querySelectorAll('.overview-manual-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this._startOverviewMarkdownEdit();
        });
      });
      overviewContainer.querySelectorAll('.overview-ai-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this._showAiEditPrompt();
        });
      });
    }
  },

  _startOverviewMarkdownEdit() {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const container = this._getStatusContainer();
    const items = container?.querySelector('.status-section-overview .status-section-items');
    if (!topic || !items || items.querySelector('.overview-markdown-editor')) return;
    if (topic.pendingProposal) {
      Utils.showToast('Accept or dismiss the pending update before editing.');
      return;
    }
    const sectionLabel = items.closest('.status-section-overview')?.querySelector('.status-section-label');
    sectionLabel?.classList.remove('section-collapsed');
    items.classList.remove('section-collapsed');
    localStorage.setItem('loom_overviewCollapsed', 'false');
    this._ensureStatusShape(topic);
    const original = topic.statusSummary.overview || [];
    items.innerHTML = `
      <div class="overview-markdown-editor">
        <textarea class="overview-markdown-input" aria-label="Edit overview as Markdown"></textarea>
        <div class="overview-markdown-actions">
          <button type="button" class="probe-btn overview-markdown-cancel">Cancel</button>
          <button type="button" class="probe-btn overview-markdown-save">Save</button>
        </div>
      </div>`;
    const input = items.querySelector('.overview-markdown-input');
    input.value = this._overviewToMarkdown(original);
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.max(96, input.scrollHeight)}px`;
      this._scheduleSidebarLayout();
    };
    input.addEventListener('input', resize);
    items.querySelector('.overview-markdown-cancel').addEventListener('click', () => {
      this._renderStatus(topic.statusSummary);
    });
    const save = () => this._saveOverviewMarkdown(input.value);
    items.querySelector('.overview-markdown-save').addEventListener('click', save);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._renderStatus(topic.statusSummary);
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save();
      }
    });
    resize();
    input.focus();
  },

  _saveOverviewMarkdown(markdown) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return false;
    this._ensureStatusShape(topic);
    const previous = topic.statusSummary.overview || [];
    const next = this._parseOverviewMarkdown(markdown, previous);
    if (this._overviewEqual(previous, next)) {
      this._renderStatus(topic.statusSummary);
      return false;
    }
    Storage.pushStatusSnapshot(topic, 'overview_markdown_edit');
    topic.statusSummary.overview = next;
    topic.statusLastUpdated = Utils.timestamp();
    if (topic.sidebarCache?.statusUpdate) topic.sidebarCache.statusUpdate.overview = next;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('current_profile_edited', {
      stage: 'construct',
      initiative: 'user',
      surface: 'sidebar',
      topicId: topic.id,
      section: 'overview',
      editType: 'markdown',
      nItems: next.length,
    });
    return true;
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

  _fillQuestionInput(question) {
    const input = document.getElementById('chatInput');
    if (!input) return;
    input.value = (question || '').trim();
    if (typeof Event !== 'undefined' && input.dispatchEvent) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.focus();
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
    if (section === 'goals') this._renderEvolveSection(topic);
    StudyLog.event('current_profile_edited', { stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: this.currentTopicId, section, editType: 'delete', itemIdx: idx, field: section === 'goals' ? 'goals' : 'overview' });
    if (section === 'goals') {
      StudyLog.event('goal_removed', { stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: this.currentTopicId, field: 'goals' });
    }
  },

  _editStatusItem(section, idx, newText) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    Storage.pushStatusSnapshot(topic, 'inline_edit');
    if (section === 'goals') {
      if (arr[idx] && typeof arr[idx] === 'object') {
        arr[idx].text = newText;
        arr[idx].source = 'user';
      } else {
        arr[idx] = { id: 'goal_' + Utils.generateId(), text: newText, source: 'user' };
      }
    } else {
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
    }
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    if (section === 'goals') this._renderEvolveSection(topic);
    StudyLog.event('current_profile_edited', { stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: this.currentTopicId, section, editType: 'edit', itemIdx: idx, field: section === 'goals' ? 'goals' : 'overview' });
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
      StudyLog.event('current_profile_edited', { stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: this.currentTopicId, trigger: 'ai_edit' });
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
    for (const it of statusSummary.overview || []) {
      const n = this._normalizeOverviewItem(it);
      if (!n) continue;
      parts.push(n.type === 'header' ? `## ${n.text}` : `- ${n.text}`);
    }
    const goals = statusSummary.goals || [];
    const goalLines = [];
    for (const g of goals) {
      const text = this._goalText(g);
      if (text) goalLines.push(`- ${text}`);
    }
    if (goalLines.length) {
      if (parts.length) parts.push('');
      parts.push('Goals:');
      parts.push(...goalLines);
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

    const el = document.createElement('div');
    el.className = 'temporal-card direction-card suggested-goal-card is-expanded';
    el.draggable = false;

    const reasonText = (d.reason || '').trim();
    const anchorText = (d.anchor || '').trim();
    el.title = reasonText || anchorText || '';

    const suggestedAt = d.suggestedAt || Utils.timestamp();
    const provenanceParts = [this._formatGoalDate(suggestedAt)].filter(Boolean);
    if (d.editedByUser) provenanceParts.push('edited by you');
    const provenance = provenanceParts.join(' · ');
    const qText = (matchedGoal && matchedGoal.exampleQuestion) || d.exampleQuestion || '';

    el.innerHTML = `
      <div class="goal-card-header-row">
        <svg class="goal-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span class="temporal-card-title">${Utils.escapeHtml(d.title || '')}</span>
      </div>
      ${provenance ? `<div class="direction-provenance">${Utils.escapeHtml(provenance)}</div>` : ''}
      <div class="goal-card-body">
        <div class="goal-try-asking">
          <div class="goal-question-row">
            <span class="goal-try-line">
              <span class="goal-try-prefix">Try asking:</span>
              <span class="temporal-card-question goal-example-question">${Utils.escapeHtml(qText)}</span>
            </span>
            <button class="goal-icon-btn goal-regen-btn" title="Another angle">↻</button>
          </div>
          <div class="goal-card-footer">
            <div class="goal-ask-actions">
              <button class="probe-btn goal-ask-here-btn" type="button">Ask here</button>
              <button class="probe-btn goal-ask-new-btn" type="button">Ask in new chat</button>
            </div>
            <span class="temporal-card-actions">
              <button class="probe-btn direction-save-btn" title="Save question">Save</button>
              <button class="goal-icon-btn direction-dismiss-btn" title="Dismiss">×</button>
            </span>
          </div>
        </div>
      </div>
    `;

    const toggleExpand = async (e) => {
      if (e.target.closest('button')) return;
      e.stopPropagation();
      const opening = !el.classList.contains('is-expanded');
      el.classList.toggle('is-expanded', opening);
      if (opening) await this._ensureCardQuestion(el, d, matchedGoal);
      this._scheduleSidebarLayout();
    };
    el.querySelector('.goal-card-header-row').addEventListener('click', toggleExpand);

    const saveBtn = el.querySelector('.direction-save-btn');
    const dismissBtn = el.querySelector('.direction-dismiss-btn');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._dismissSuggestedGoal(d, el);
      });
    }
    const getQuestion = async () => {
      let q = (el.querySelector('.goal-example-question')?.textContent || '').trim();
      if (!q) q = await this._ensureCardQuestion(el, d, matchedGoal);
      if (!q) Utils.showToast('Could not generate a question', 'error');
      return q;
    };
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        saveBtn.disabled = true;
        try {
          const q = await getQuestion();
          if (!q) return;
          d.exampleQuestion = q;
          this._saveSuggestedGoal(d);
        } finally {
          if (el.isConnected) saveBtn.disabled = false;
        }
      });
    }
    el.querySelector('.goal-ask-here-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const q = await getQuestion();
      if (!q) return;
      StudyLog.event('goal_question_asked', {
        stage: 'evolve', initiative: 'user', surface: 'sidebar',
        topicId: this.currentTopicId, directionIdx,
        goalId: matchedGoal ? matchedGoal.id : null,
        goalSource: matchedGoal ? (matchedGoal.source || 'user') : 'inferred',
        suggestionId: d.title || null,
        askMode: 'fill_input',
        autoSend: false,
      });
      this._fillQuestionInput(q);
    });
    el.querySelector('.goal-ask-new-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const q = await getQuestion();
      if (!q) return;
      StudyLog.event('goal_question_asked', {
        stage: 'evolve', initiative: 'user', surface: 'sidebar',
        topicId: this.currentTopicId, directionIdx,
        goalId: matchedGoal ? matchedGoal.id : null,
        goalSource: matchedGoal ? (matchedGoal.source || 'user') : 'inferred',
        suggestionId: d.title || null,
        askMode: 'new_chat',
        autoSend: false,
      });
      this._startGoalInNewChat({ title: d.title, question: q });
    });
    const regenBtn = el.querySelector('.goal-regen-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        regenBtn.disabled = true;
        const qEl = el.querySelector('.goal-example-question');
        const currentQ = qEl ? qEl.textContent : '';
        try {
          const question = await this._fetchGoalQuestion(d.title, currentQ);
          if (question) {
            d.exampleQuestion = question;
            if (qEl) qEl.textContent = question;
            this._persistGoalExampleQuestion(d.title, question);
          }
        } catch (err) {
          console.error('Regenerate goal question failed:', err);
          Utils.showToast('Could not regenerate question', 'error');
        }
        regenBtn.disabled = false;
      });
    }

    if (!qText) this._ensureCardQuestion(el, d, matchedGoal);
    return el;
  },

  async _ensureCardQuestion(el, d, goal) {
    const qEl = el.querySelector('.goal-example-question');
    let q = (qEl && qEl.textContent || '').trim() || d.exampleQuestion || (goal && goal.exampleQuestion) || '';
    if (q) return q;
    q = await this._fetchGoalQuestion(d.title, goal && goal.exampleQuestion);
    if (q) {
      d.exampleQuestion = q;
      if (qEl) qEl.textContent = q;
      this._persistGoalExampleQuestion(d.title, q);
    }
    return q || '';
  },

  // ── Future: Goals ─────────────────────────────────────────────────────

  _findGoal(topic, title) {
    const goals = this._getConfirmedGoals(topic);
    if (!goals.length || !title) return null;
    const norm = (title || '').trim().toLowerCase();
    return goals.find(i => this._goalText(i).toLowerCase() === norm) || null;
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
    const dirs = (topic && topic.sidebarCache && topic.sidebarCache.newDirections) || [];
    this._renderSuggestedGoals(dirs);
  },

  _renderSuggestedGoals(dirs, emptyHint = 'Keep chatting to generate future directions.') {
    const dirContainer = document.getElementById('directionCards');
    if (!dirContainer) return;
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    const dismissed = new Set(((topic && topic.dismissedGoals) || []).map(t => (t || '').toLowerCase()));
    const normalized = [...(dirs || [])]
      .map(d => this._normalizeDirection(d))
      .filter(d => !dismissed.has((d.title || '').toLowerCase()));

    const savedGoals = this._getConfirmedGoals(topic);
    const savedKeys = new Set(savedGoals.map(g => this._goalText(g).toLowerCase()).filter(Boolean));
    const order = { breadth: 0, depth: 1 };
    const unsaved = normalized
      .filter(d => !savedKeys.has((d.title || '').toLowerCase()))
      .sort((a, b) => (order[a.type] ?? 2) - (order[b.type] ?? 2));

    dirContainer.innerHTML = '';
    if (unsaved.length === 0) {
      dirContainer.innerHTML = `<p class="temporal-empty-hint">${emptyHint}</p>`;
      this._scheduleSidebarLayout();
      return;
    }
    unsaved.forEach((dir, idx) => {
      const card = this._createSuggestedGoalCard(dir, idx);
      if (card && card.nodeType) dirContainer.appendChild(card);
    });
    this._scheduleSidebarLayout();
  },

  // Back-compat alias used by render()
  _renderDirectionCards(dirs, emptyHint) {
    this._renderSuggestedGoals(dirs, emptyHint);
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
    if (!topic) return;
    this._ensureStatusShape(topic);
    let goal = this._findGoal(topic, dir.title);
    if (!goal) {
      goal = {
        id: 'goal_' + Utils.generateId(),
        text: dir.title,
        source: 'user',
        suggestionTitle: dir.title,
        suggestionType: dir.type || null,
        savedQuestions: [],
      };
      topic.statusSummary.goals.push(goal);
      StudyLog.event('goal_saved', {
        stage: 'evolve', initiative: 'user', surface: 'sidebar',
        topicId: topic.id, suggestionTitle: dir.title, anchor: dir.anchor || null,
      });
    }
    const q = (dir.exampleQuestion || '').trim();
    if (q && !(goal.savedQuestions || []).some(saved => saved.text === q)) {
      if (!Array.isArray(goal.savedQuestions)) goal.savedQuestions = [];
      goal.savedQuestions.push({
        id: 'q_' + Utils.generateId(),
        text: q,
        ts: Utils.timestamp(),
      });
      StudyLog.event('question_saved', {
        stage: 'evolve',
        initiative: 'user',
        surface: 'sidebar',
        topicId: topic.id,
        goalId: goal.id,
        suggestionId: dir.title || null,
      });
    }
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    if (!opts.silent) this._renderEvolveSection(topic);
  },

  _dismissSuggestedGoal(dir, el) {
    const topic = this.currentTopicId ? Storage.getTopic(this.currentTopicId) : null;
    if (!topic) return;
    if (!Array.isArray(topic.dismissedGoals)) topic.dismissedGoals = [];
    if (!topic.dismissedGoals.includes(dir.title)) {
      topic.dismissedGoals.push(dir.title);
    }
    Storage.saveTopic(topic);
    StudyLog.event('goal_dismissed', { stage: 'evolve', initiative: 'user', surface: 'sidebar', topicId: topic.id, title: dir.title });
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
    this._ensureStatusShape(topic);
    const idx = topic.statusSummary.goals.findIndex(i => i.id === goalId);
    if (idx < 0) return;
    const title = this._goalText(topic.statusSummary.goals[idx]);
    topic.statusSummary.goals.splice(idx, 1);
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    this._renderEvolveSection(topic);
    StudyLog.event('goal_removed', { stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: topic.id, title, field: 'goals' });
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
    StudyLog.event('goal_modified', { stage: 'evolve', initiative: 'user', surface: 'sidebar', topicId: topic.id, title: newTitle });
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
      this._ensureStatusShape(topic);
      topic.statusSummary.goals.push({
        id: 'goal_' + Utils.generateId(),
        text,
        source: 'user',
      });
      Storage.saveTopic(topic);
      input.value = '';
      this._renderStatus(topic.statusSummary);
      this._renderEvolveSection(topic);
      StudyLog.event('goal_authored', {
        stage: 'construct', initiative: 'user', surface: 'sidebar', topicId: topic.id, field: 'goals',
      });
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
      const chat = Storage.getChat(App.currentChatId);
      if (chat) {
        chat.topicId = topicId;
        chat.lastActive = Utils.timestamp();
        Storage.saveChat(chat);
      }
      const topicSel = document.getElementById('topicSelect');
      if (topicSel) topicSel.value = topicId;
      App._updateTopicPickerDisplay(topicId);
      Sidebar.show(topicId);
    }
    this._fillQuestionInput(dir.question || dir.exampleQuestion || '');
    App._renderChatList();
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
      StudyLog.event('status_refresh_triggered', { topicId: topic.id, trigger: 'manual' });
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
        const vid = snap.v != null ? snap.v : (idx + 1);
        const isCurrent = topic && topic.currentVersion === vid;
        html += `<div class="status-history-row${isCurrent ? ' is-current' : ''}">
          <span class="status-history-vid">v${vid}</span>
          <div class="status-history-info">
            <div class="status-history-title">${this._formatHistoryTs(snap.ts)} · ${Utils.escapeHtml(this._historyTriggerLabel(snap.trigger))}${isCurrent ? '<span class="status-history-current-tag">current</span>' : ''}</div>
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
      statusSummary: JSON.parse(JSON.stringify(topic.statusSummary || { overview: [], goals: [] })),
    };

    topic.statusSummary = JSON.parse(JSON.stringify(snapshot.statusSummary));
    topic.statusLastUpdated = Utils.timestamp();
    if (snapshot.v != null) topic.currentVersion = snapshot.v;
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    this._closeHistoryPopover();
    StudyLog.event('version_restored', {
      stage: 'construct',
      initiative: 'user',
      surface: 'sidebar',
      topicId: this.currentTopicId,
      trigger: snapshot.trigger,
      versionId: snapshot.v,
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
    if (!this._labelsDirty) return;
    const chatId = Storage.getCurrentChatId();
    const activeChat = chatId ? Storage.getChat(chatId) : null;
    const topicId = activeChat?.topicId || this.currentTopicId;
    if (topicId && typeof App !== 'undefined' && App._isOneTimeTopic(topicId)) {
      this._labelsDirty = false;
      return;
    }
    if (!topicId) return;
    const topic = Storage.getTopic(topicId);
    if (!topic) return;

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
    StudyLog.event('status_refresh_triggered', { topicId, trigger: 'labels' });

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

  _collectAllAnnotations(topic) {
    if (!topic) return [];
    const out = [];
    const chats = Storage.getChats().filter(c => c.topicId === topic.id);
    for (const chat of chats) {
      for (const m of Storage.getMessages(chat.id)) {
        if (m.role !== 'assistant' || !Array.isArray(m.annotations)) continue;
        for (const a of m.annotations) {
          if (!a || !a.spanText) continue;
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
    const annos = this._collectAllAnnotations(topic);

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
          annotations: annos.map(a => ({
            spanText: a.spanText, label: a.label, comment: a.comment,
          })),
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
        if (freshTopic) this._renderEvolveSection(freshTopic);
        if (this.currentData) this.currentData.newDirections = newDirs;
      }

      StudyLog.event('directions_shuffled', {
        stage: 'evolve', initiative: 'user', surface: 'sidebar',
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
      StudyLog.event('section_collapsed', { moduleId: 'sectionCurrent', section: sectionKey, collapsed: isCollapsed, surface: 'sidebar' });
    });
  },

  _toggleModuleCollapse(moduleId) {
    const body = document.getElementById(moduleId + 'Body');
    const btn = document.querySelector('.module-collapse-btn[data-module="' + moduleId + '"]');
    if (!body) return;
    const collapsed = body.classList.toggle('collapsed');
    if (btn) btn.classList.toggle('collapsed', collapsed);
    localStorage.setItem('loom_moduleCollapse_' + moduleId, collapsed);
    StudyLog.event('section_collapsed', { moduleId, collapsed, surface: 'sidebar' });
    this._scheduleSidebarLayout();
  },

  _initSidebarLayout() {
    const sidebar = document.getElementById('rightSidebar');
    const content = document.getElementById('sidebarContent');
    if (typeof ResizeObserver !== 'undefined' && !this._sidebarLayoutObs) {
      this._sidebarLayoutObs = new ResizeObserver(() => this._scheduleSidebarLayout());
      if (sidebar) this._sidebarLayoutObs.observe(sidebar);
      if (content) this._sidebarLayoutObs.observe(content);
    }
    if (!this._sidebarLayoutResizeBound && typeof window !== 'undefined' && window.addEventListener) {
      this._sidebarLayoutResizeBound = true;
      window.addEventListener('resize', () => this._scheduleSidebarLayout());
    }
    this._scheduleSidebarLayout();
  },

  _scheduleSidebarLayout() {
    if (typeof requestAnimationFrame !== 'function') {
      this._layoutSidebarStack();
      return;
    }
    if (this._sidebarLayoutRaf) cancelAnimationFrame(this._sidebarLayoutRaf);
    this._sidebarLayoutRaf = requestAnimationFrame(() => {
      this._sidebarLayoutRaf = null;
      this._layoutSidebarStack();
    });
  },

  _layoutBox(el) {
    if (!el) return 0;
    if (typeof el.getBoundingClientRect === 'function') {
      const h = el.getBoundingClientRect().height;
      if (h) return h;
    }
    return el.offsetHeight || el.scrollHeight || 0;
  },

  _sectionChromeHeight(section) {
    if (!section) return 0;
    const header = section.querySelector('.temporal-section-header');
    const subtitle = section.querySelector('.temporal-section-subtitle');
    let chrome = this._layoutBox(header) + this._layoutBox(subtitle);
    try {
      if (typeof getComputedStyle === 'function') {
        const styles = getComputedStyle(section);
        chrome += (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
          + (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
      }
    } catch (_) { /* layout tests have no window CSSOM */ }
    return chrome;
  },

  _clearFoldLimits() {
    const construct = document.getElementById('sectionCurrent');
    const evolve = document.getElementById('sectionFuture');
    if (construct) construct.style.maxHeight = '';
    if (evolve) evolve.style.maxHeight = '';
    const overviewItems = construct && construct.querySelector('.status-section-overview .status-section-items');
    if (overviewItems) {
      overviewItems.style.maxHeight = '';
      overviewItems.style.overflowY = '';
    }
    const goalsList = document.getElementById('constructGoalsList');
    if (goalsList) {
      goalsList.style.maxHeight = '';
      goalsList.style.overflowY = '';
    }
    const cards = document.getElementById('directionCards');
    if (cards) {
      cards.style.maxHeight = '';
      cards.style.overflowY = '';
    }
  },

  _goalsChromeHeight(goals) {
    if (!goals) return 0;
    const label = goals.querySelector('.status-section-label');
    const hint = goals.querySelector('.status-section-hint');
    const addRow = goals.querySelector('.add-goal-row, .add-intention-row');
    return this._layoutBox(label) + this._layoutBox(hint) + this._layoutBox(addRow);
  },

  _constructMinHeight(construct) {
    const goals = document.getElementById('constructGoalsSection');
    const overview = construct && construct.querySelector('.status-section-overview');
    const overviewLabel = overview && overview.querySelector('.status-section-label');
    return Math.max(96, this._sectionChromeHeight(construct)
      + this._layoutBox(overviewLabel)
      + 40
      + this._goalsChromeHeight(goals));
  },

  _capScrollArea(el, height) {
    if (!el) return;
    el.style.maxHeight = `${Math.max(0, height)}px`;
    el.style.overflowY = 'auto';
  },

  _capEvolveTo(evolve, height) {
    evolve.style.maxHeight = `${Math.max(0, height)}px`;
    const cards = document.getElementById('directionCards');
    this._capScrollArea(cards, height - this._sectionChromeHeight(evolve));
  },

  _foldConstructTo(construct, height) {
    construct.style.maxHeight = `${Math.max(0, height)}px`;
    const overview = construct.querySelector('.status-section-overview');
    const overviewItems = overview && overview.querySelector('.status-section-items');
    const goals = document.getElementById('constructGoalsSection');
    const goalsList = document.getElementById('constructGoalsList');
    if (!overview || !overviewItems || !goals) return;

    const bodyH = Math.max(0, height - this._sectionChromeHeight(construct));
    const overviewChrome = this._layoutBox(overview.querySelector('.status-section-label'))
      + this._layoutBox(overview.querySelector('.overview-ai-prompt-slot'));
    const goalsChrome = this._goalsChromeHeight(goals);
    const goalsListNatural = goalsList ? (goalsList.scrollHeight || this._layoutBox(goalsList)) : 0;
    const goalsNatural = goalsChrome + goalsListNatural;
    const itemsNatural = overviewItems.scrollHeight || this._layoutBox(overviewItems);
    const overviewMinItems = 40;

    if (overviewChrome + itemsNatural + goalsNatural <= bodyH) return;

    const leftoverForItems = bodyH - goalsNatural - overviewChrome;
    if (leftoverForItems >= overviewMinItems) {
      this._capScrollArea(overviewItems, leftoverForItems);
      return;
    }

    const free = bodyH - overviewChrome - goalsChrome;
    if (free >= overviewMinItems && goalsList) {
      this._capScrollArea(overviewItems, overviewMinItems);
      this._capScrollArea(goalsList, free - overviewMinItems);
      return;
    }
    this._capScrollArea(overviewItems, Math.max(0, free));
    if (goalsList) this._capScrollArea(goalsList, 0);
  },

  _evolveOneCardMinHeight(evolve) {
    const header = evolve.querySelector('.temporal-section-header');
    const subtitle = evolve.querySelector('.temporal-section-subtitle');
    const body = evolve.querySelector('.module-body');
    const card = evolve.querySelector('.suggested-goal-card, .direction-card, .temporal-card');
    const box = (el) => {
      if (!el || !el.getBoundingClientRect) return el && el.offsetHeight ? el.offsetHeight : 0;
      return el.getBoundingClientRect().height || el.offsetHeight || 0;
    };
    const styles = (typeof getComputedStyle === 'function') ? getComputedStyle(evolve) : { paddingTop: '0', paddingBottom: '0' };
    let min = box(header) + box(subtitle)
      + (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    if (body && typeof getComputedStyle === 'function') {
      const bodyStyles = getComputedStyle(body);
      min += (parseFloat(bodyStyles.paddingTop) || 0) + (parseFloat(bodyStyles.paddingBottom) || 0);
    }
    min += card ? box(card) : box(evolve.querySelector('.temporal-empty-hint'));
    return Math.max(min, 96);
  },

  _layoutSidebarStack() {
    const content = document.getElementById('sidebarContent');
    const construct = document.getElementById('sectionCurrent');
    const evolve = document.getElementById('sectionFuture');
    if (!content || !construct || !evolve) return;
    if (construct.style.display === 'none' || evolve.style.display === 'none' || !content.clientHeight) {
      this._clearFoldLimits();
      return;
    }

    this._clearFoldLimits();

    const available = content.clientHeight;
    const constructH = construct.offsetHeight || 0;
    const evolveH = evolve.offsetHeight || 0;
    const extra = Math.max(0, (evolve.offsetTop || 0) - (construct.offsetTop || 0) - constructH);
    if (constructH + extra + evolveH <= available + 1) return;

    const constructMin = this._constructMinHeight(construct);
    const oneCardMin = Math.min(evolveH, this._evolveOneCardMinHeight(evolve));
    if (constructH + extra + oneCardMin <= available) {
      this._capEvolveTo(evolve, available - constructH - extra);
      return;
    }

    let evolveCap = oneCardMin;
    let constructCap = available - extra - evolveCap;
    if (constructCap < constructMin) {
      constructCap = Math.min(constructH, constructMin);
      evolveCap = Math.max(96, available - extra - constructCap);
    }
    this._capEvolveTo(evolve, evolveCap);
    this._foldConstructTo(construct, constructCap);
  },
};
