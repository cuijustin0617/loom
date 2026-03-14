/* Right sidebar: 3 modules + drag-and-drop */

const Sidebar = {
  currentTopicId: null,
  currentData: null,

  init() {
    this._initStatusEdit();
    this._initStatusDrag();
    this._initStatusUpdate();
    this._initMergeDialog();
    this._initShuffle();
    this._initModuleCollapse();
  },

  show(topicId) {
    if (STUDY_CONDITION === 'baseline') return;
    this.currentTopicId = topicId;
    StudyLog.event('module1_viewed', { topicId });
    document.getElementById('sidebarEmpty').style.display = 'none';
    document.getElementById('moduleStatus').style.display = 'block';
    document.getElementById('moduleDirections').style.display = 'block';

    const topic = Storage.getTopic(topicId);
    if (topic) {
      document.getElementById('statusTopicName').textContent = topic.name;
      const badge = document.getElementById('topicBadge');
      const tc = Utils.getTopicColor(topic);
      badge.style.display = 'inline-block';
      badge.textContent = topic.name;
      badge.style.background = tc.light;
      badge.style.color = tc.color;

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
    if (details.length > 0) {
      App._renderBaselineDetails(details);
    }
  },

  hide() {
    this.currentTopicId = null;
    document.getElementById('moduleStatus').style.display = 'none';
    document.getElementById('moduleConnections').style.display = 'none';
    document.getElementById('moduleDirections').style.display = 'none';
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

    this._showLoading();

    try {
      const allChats = Storage.getAllChatSummariesForTopic(topic.id)
        .filter(c => c.id !== chatId);
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
          allConcepts: allConcepts.map(c => ({
            id: c.id, title: c.title, preview: c.preview,
          })),
          model: Storage.getSidebarModel(),
        }),
      });

      const data = await resp.json();
      this.currentData = data;
      this.render(data, topic);

      // Cache sidebar data on the topic
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

    // Module 1: Status
    let statusData = data.statusUpdate || topic.statusSummary || null;
    if (data.statusUpdate && data.statusUpdate !== topic.statusSummary) {
      topic.statusSummary = data.statusUpdate;
      topic.statusLastUpdated = Utils.timestamp();
      Storage.saveTopic(topic);
    }
    this._renderStatus(statusData);

    // Module 3: Directions
    const dirContainer = document.getElementById('directionCards');
    dirContainer.innerHTML = '';
    const dirs = data.newDirections || [];
    if (dirs.length === 0) {
      dirContainer.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Keep chatting for suggestions.</p>';
    }
    dirs.forEach(dir => {
      dirContainer.appendChild(this._createDirectionCard(dir));
    });
  },

  _createDirectionCard(dir) {
    const el = document.createElement('div');
    const dirType = dir.type || 'extend';
    el.className = `direction-card type-${dirType}`;
    el.draggable = true;
    const threadLabel = dir.threadLabel ? Utils.escapeHtml(dir.threadLabel) : '';
    const typeLabels = { strengthen: 'strengthen', bridge: 'bridge', extend: 'extend' };
    const typeLabel = typeLabels[dirType] || 'explore';
    const tagHtml = threadLabel
      ? `<div class="direction-tag tag-${dirType}"><span class="direction-tag-type">${typeLabel}</span><span class="direction-tag-sep">&middot;</span><span class="direction-tag-thread">${threadLabel}</span></div>`
      : '';
    const reasonHtml = dir.reason
      ? `<div class="direction-reason">${Utils.escapeHtml(dir.reason)}</div>`
      : '';
    el.innerHTML = `
      ${tagHtml}
      <div class="card-header">
        <span class="card-title">${Utils.escapeHtml(dir.title || '')}</span>
      </div>
      <div class="card-question">${Utils.escapeHtml(dir.question || '')}</div>
      ${reasonHtml}
      <div class="card-actions-row">
        <div class="card-drag-hint">⟶ Drag to chat</div>
        <button class="card-new-chat-btn" title="Ask in new chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New chat
        </button>
      </div>
    `;
    this._setupDrag(el, dir.question || '', dir.title || '');
    el.querySelector('.card-new-chat-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      StudyLog.event('module3_direction_new_chat', { topicId: this.currentTopicId, directionTitle: dir.title || '' });
      this._startDirectionInNewChat(dir);
    });
    return el;
  },

  _startDirectionInNewChat(dir) {
    const topicId = this.currentTopicId;
    App.newChat();
    
    // Select the topic so it gets grouped and context is injected by App.sendMessage()
    if (topicId) {
      App.selectedTopicId = topicId;
      const topicSel = document.getElementById('topicSelect');
      if (topicSel) topicSel.value = topicId;
    }
    
    // Enable search by default
    App.useSearch = true;
    const searchBtn = document.getElementById('searchToggleBtn');
    if (searchBtn) {
      searchBtn.classList.add('active');
      searchBtn.title = 'Google Search ON';
    }
    
    document.getElementById('chatInput').value = dir.question || '';
    App.sendMessage();
  },

  _setupDrag(el, fullText, label) {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', fullText);
      e.dataTransfer.setData('application/loom-label', label);
      el.classList.add('dragging');
      StudyLog.event('module3_direction_dragged', { topicId: this.currentTopicId, directionTitle: label });
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    el.addEventListener('click', () => {
      StudyLog.event('module3_direction_clicked', { topicId: this.currentTopicId, directionTitle: label });
      App.setContextBlock(fullText, label);
    });
  },

  _getStatusContainer() {
    return document.getElementById('statusStructured') || document.getElementById('statusText');
  },

  _showLoading() {
    const sc = this._getStatusContainer();
    if (sc) sc.innerHTML = `
      <div class="skeleton skeleton-line" style="width:90%"></div>
      <div class="skeleton skeleton-line" style="width:70%"></div>
    `;
    document.getElementById('directionCards').innerHTML = `
      <div class="skeleton skeleton-card"></div>
    `;
  },

  _renderStatus(statusData) {
    const container = this._getStatusContainer();
    if (!container) return;
    if (!statusData) {
      container.innerHTML = '<p class="status-empty">No status yet. Chat more to build your profile.</p>';
      return;
    }
    if (container.id === 'statusText') {
      container.textContent = this._serializeStatus(statusData);
      return;
    }
    if (typeof statusData === 'string') {
      container.innerHTML = `<div class="status-section"><div class="status-section-label">Overview</div><div class="status-item"><span class="status-item-text">${Utils.escapeHtml(statusData)}</span></div></div>`;
      return;
    }
    const overview = statusData.overview || [];
    const threads = statusData.threads || [];
    const specifics = statusData.specifics || [];
    let html = '';

    if (overview.length > 0) {
      const overviewCollapsed = localStorage.getItem('loom_overviewCollapsed') === 'true';
      html += '<div class="status-section"><div class="status-section-label collapsible' + (overviewCollapsed ? ' section-collapsed' : '') + '" data-section-toggle="overview"><span class="section-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="8" height="8"><polyline points="6 9 12 15 18 9"/></svg></span>Overview</div><div class="status-section-items' + (overviewCollapsed ? ' section-collapsed' : '') + '" data-section-items="overview">';
      overview.forEach((pt, i) => {
        html += `<div class="status-item" data-section="overview" data-idx="${i}">
          <span class="status-item-text">${Utils.escapeHtml(pt)}</span>
          <span class="status-item-actions">
            <button class="status-item-btn status-item-del" title="Remove">×</button>
          </span></div>`;
      });
      html += '</div></div>';
    }

    if (threads.length > 0) {
      html += '<div class="status-section"><div class="status-section-label">Learning Threads</div>';
      threads.forEach((thread, ti) => {
        const label = thread.label || 'Thread';
        const steps = thread.steps || [];
        const dotsHtml = steps.map((s, si) => {
          const level = (typeof s === 'object' ? s.level : '') || 'brief';
          const text = typeof s === 'object' ? s.text || '' : String(s);
          return `<span class="thread-dot thread-dot-${level}" data-thread="${ti}" data-step="${si}" title="${Utils.escapeHtml(text)}"></span>`;
        }).join('<span class="thread-connector"></span>');

        html += `<div class="thread-row" data-thread-idx="${ti}">
          <div class="thread-header">
            <button class="thread-toggle" data-thread="${ti}">
              <svg class="thread-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <span class="thread-label">${Utils.escapeHtml(label)}</span>
            <span class="thread-chain">${dotsHtml}</span>
            <span class="status-item-actions">
              <button class="status-item-btn thread-del-btn" data-thread="${ti}" title="Remove thread">×</button>
            </span>
          </div>
          <div class="thread-steps" data-thread="${ti}" style="display:none;">
            ${steps.map((s, si) => {
          const text = typeof s === 'object' ? s.text || '' : String(s);
          const level = (typeof s === 'object' ? s.level : '') || 'brief';
          return `<div class="thread-step" data-thread="${ti}" data-step="${si}">
                <span class="thread-step-dot thread-dot-${level}"></span>
                <span class="thread-step-text">${Utils.escapeHtml(text)}</span>
                <span class="status-level level-${level}">${Utils.escapeHtml(level)}</span>
                <span class="status-item-actions">
                  <button class="status-item-btn status-item-del" title="Remove step">×</button>
                </span>
              </div>`;
        }).join('')}
          </div>
        </div>`;
      });
      html += '</div>';
    }

    // Legacy specifics fallback
    if (specifics.length > 0 && threads.length === 0) {
      html += '<div class="status-section"><div class="status-section-label">Specifics</div>';
      specifics.forEach((item, i) => {
        const text = typeof item === 'string' ? item : item.text || '';
        const level = typeof item === 'object' ? item.level || '' : '';
        const levelClass = level ? ` level-${level}` : '';
        html += `<div class="status-item" data-section="specifics" data-idx="${i}">
          <span class="status-item-text">${Utils.escapeHtml(text)}</span>
          ${level ? `<span class="status-level${levelClass}">${Utils.escapeHtml(level)}</span>` : ''}
          <span class="status-item-actions">
            <button class="status-item-btn status-item-del" title="Remove">×</button>
          </span></div>`;
      });
      html += '</div>';
    }

    if (!html) {
      html = '<p class="status-empty">No status yet. Chat more to build your profile.</p>';
    }
    container.innerHTML = html;
    this._bindStatusItemActions();
  },

  _bindStatusItemActions() {
    const container = this._getStatusContainer();
    if (!container || container.id !== 'statusStructured') return;

    // Overview and legacy specifics delete
    container.querySelectorAll('.status-item .status-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.status-item');
        const section = item.dataset.section;
        const idx = parseInt(item.dataset.idx);
        this._deleteStatusItem(section, idx);
      });
    });

    // Overview and legacy specifics inline edit
    container.querySelectorAll('.status-item[data-section]').forEach(item => {
      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const section = item.dataset.section;
        const idx = parseInt(item.dataset.idx);
        this._startInlineEdit(item, section, idx);
      });
    });

    // Thread toggle expand/collapse
    container.querySelectorAll('.thread-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ti = btn.dataset.thread;
        const stepsEl = container.querySelector(`.thread-steps[data-thread="${ti}"]`);
        const chevron = btn.querySelector('.thread-chevron');
        if (stepsEl) {
          const open = stepsEl.style.display !== 'none';
          stepsEl.style.display = open ? 'none' : 'block';
          chevron?.classList.toggle('expanded', !open);
        }
      });
    });

    // Thread delete
    container.querySelectorAll('.thread-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ti = parseInt(btn.dataset.thread);
        this._deleteThread(ti);
      });
    });

    // Thread step delete
    container.querySelectorAll('.thread-step .status-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const step = btn.closest('.thread-step');
        const ti = parseInt(step.dataset.thread);
        const si = parseInt(step.dataset.step);
        this._deleteThreadStep(ti, si);
      });
    });

    // Thread step inline edit on double-click
    container.querySelectorAll('.thread-step').forEach(step => {
      step.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const ti = parseInt(step.dataset.thread);
        const si = parseInt(step.dataset.step);
        this._startThreadStepEdit(step, ti, si);
      });
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

  _startThreadStepEdit(stepEl, ti, si) {
    const textEl = stepEl.querySelector('.thread-step-text');
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
      if (val && val !== original) this._editThreadStep(ti, si, val);
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
    const oldValue = typeof arr[idx] === 'object' ? arr[idx].text : arr[idx];
    arr.splice(idx, 1);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('summary_edited', { topicId: this.currentTopicId, section, editType: 'delete', oldValue });
  },

  _editStatusItem(section, idx, newText) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    const oldValue = typeof arr[idx] === 'object' ? arr[idx].text : arr[idx];
    if (section === 'overview') {
      arr[idx] = newText;
    } else {
      if (typeof arr[idx] === 'object') arr[idx].text = newText;
      else arr[idx] = newText;
    }
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('summary_edited', { topicId: this.currentTopicId, section, editType: 'edit', oldValue, newValue: newText });
  },

  _deleteThread(threadIdx) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const threads = topic.statusSummary.threads;
    if (!threads || threadIdx < 0 || threadIdx >= threads.length) return;
    const oldLabel = threads[threadIdx].label;
    threads.splice(threadIdx, 1);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('summary_edited', { topicId: this.currentTopicId, section: 'threads', editType: 'delete_thread', oldValue: oldLabel });
  },

  _deleteThreadStep(threadIdx, stepIdx) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const threads = topic.statusSummary.threads;
    if (!threads || threadIdx < 0 || threadIdx >= threads.length) return;
    const steps = threads[threadIdx].steps;
    if (!steps || stepIdx < 0 || stepIdx >= steps.length) return;
    const oldValue = typeof steps[stepIdx] === 'object' ? steps[stepIdx].text : steps[stepIdx];
    steps.splice(stepIdx, 1);
    if (steps.length === 0) threads.splice(threadIdx, 1);
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('summary_edited', { topicId: this.currentTopicId, section: 'threads', editType: 'delete_step', oldValue });
  },

  _editThreadStep(threadIdx, stepIdx, newText) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const threads = topic.statusSummary.threads;
    if (!threads || threadIdx < 0 || threadIdx >= threads.length) return;
    const steps = threads[threadIdx].steps;
    if (!steps || stepIdx < 0 || stepIdx >= steps.length) return;
    const oldValue = typeof steps[stepIdx] === 'object' ? steps[stepIdx].text : steps[stepIdx];
    if (typeof steps[stepIdx] === 'object') steps[stepIdx].text = newText;
    else steps[stepIdx] = newText;
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
    StudyLog.event('summary_edited', { topicId: this.currentTopicId, section: 'threads', editType: 'edit_step', oldValue, newValue: newText });
  },

  _serializeStatus(statusSummary) {
    if (!statusSummary) return '';
    if (typeof statusSummary === 'string') return statusSummary;
    const parts = [];
    if (statusSummary.overview) {
      parts.push('Overview: ' + statusSummary.overview.join('; '));
    }
    if (statusSummary.threads) {
      statusSummary.threads.forEach(t => {
        const stepStrs = (t.steps || []).map(s =>
          typeof s === 'object' ? `${s.text} (${s.level || 'unknown'})` : s
        );
        parts.push(`Thread "${t.label}": ${stepStrs.join(' → ')}`);
      });
    }
    if (statusSummary.specifics) {
      const items = statusSummary.specifics.map(s =>
        typeof s === 'object' ? `${s.text} (${s.level || 'unknown'})` : s
      );
      parts.push('Specifics: ' + items.join('; '));
    }
    return parts.join('\n');
  },

  _initStatusEdit() {
    // Legacy edit button removed — editing is now inline per-item
  },

  _initStatusDrag() {
    const el = this._getStatusContainer();
    if (!el) return;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', this._serializeStatus(this._getCurrentStatus()));
      e.dataTransfer.setData('application/loom-label', 'Status Summary');
    });
  },

  _initStatusUpdate() {
    document.getElementById('statusUpdateHeaderBtn').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!this.currentTopicId) return;
      const topic = Storage.getTopic(this.currentTopicId);
      if (!topic) return;

      const btn = document.getElementById('statusUpdateHeaderBtn');
      btn.classList.add('loading');
      btn.disabled = true;

      try {
        const summaries = Storage.getAllChatSummariesForTopic(topic.id);
        const resp = await fetch('/api/topic/status/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topicName: topic.name,
            currentStatus: this._serializeStatus(topic.statusSummary),
            recentSummaries: summaries.map(s => s.summary),
            model: Storage.getSidebarModel(),
          }),
        });
        const data = await resp.json();
        let newStatus;
        if (data.overview || data.threads) {
          newStatus = { overview: data.overview || [], threads: data.threads || [] };
        } else {
          newStatus = data.status || topic.statusSummary;
        }
        topic.statusSummary = newStatus;
        topic.statusLastUpdated = Utils.timestamp();
        if (topic.sidebarCache) topic.sidebarCache.statusUpdate = newStatus;
        Storage.saveTopic(topic);
        this._renderStatus(newStatus);
        Utils.showToast('Status updated', 'success');
        StudyLog.event('summary_updated', { topicId: this.currentTopicId, trigger: 'manual' });
      } catch (err) {
        console.error('Status update failed:', err);
        Utils.showToast('Status update failed', 'error');
      }
      btn.classList.remove('loading');
      btn.disabled = false;
    });
  },

  showConnections(connectionsJson) {
    const module = document.getElementById('moduleConnections');
    const container = document.getElementById('connectionSidebarCards');
    if (!connectionsJson || connectionsJson.length === 0) {
      module.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    module.style.display = 'block';
    container.innerHTML = '';
    const chatId = Storage.getCurrentChatId();
    connectionsJson.forEach(conn => {
      StudyLog.event('module2_connection_shown', { chatId, connectionChatId: conn.chatId });
      const card = document.createElement('div');
      card.className = 'conn-sidebar-card';
      card.dataset.connId = conn.id;
      const title = Utils.escapeHtml(conn.chatTitle || 'Past chat');
      const userAsked = conn.userAsked ? Utils.escapeHtml(conn.userAsked) : '';
      const aiCovered = conn.aiCovered ? Utils.escapeHtml(conn.aiCovered) : '';
      const insight = Utils.escapeHtml(conn.text || '');
      let summaryHtml = '';
      if (userAsked) summaryHtml += `<div class="conn-sb-row"><span class="conn-sb-label">Asked</span><span class="conn-sb-value">${userAsked}</span></div>`;
      if (aiCovered) summaryHtml += `<div class="conn-sb-row"><span class="conn-sb-label">Learned</span><span class="conn-sb-value">${aiCovered}</span></div>`;
      card.innerHTML = `
        <div class="conn-sb-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <span class="conn-sb-title">${title}</span>
        </div>
        ${summaryHtml ? `<div class="conn-sb-summary">${summaryHtml}</div>` : ''}
        <div class="conn-sb-insight">${insight}</div>
      `;

      card.addEventListener('mouseenter', () => {
        this._highlightMarker(conn.id, true);
      });
      card.addEventListener('mouseleave', () => {
        this._highlightMarker(conn.id, false);
      });
      card.addEventListener('click', () => {
        const marker = document.querySelector(`.conn-marker.resolved[data-conn-id="${conn.id}"]`);
        if (marker) {
          marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
          App._showConnCard(marker);
        }
      });

      container.appendChild(card);
    });
  },

  clearConnections() {
    const module = document.getElementById('moduleConnections');
    if (module) module.style.display = 'none';
    const container = document.getElementById('connectionSidebarCards');
    if (container) container.innerHTML = '';
  },

  _highlightMarker(connId, active) {
    const marker = document.querySelector(`.conn-marker.resolved[data-conn-id="${connId}"]`);
    if (marker) {
      marker.classList.toggle('highlighted', active);
    }
  },

  highlightSidebarCard(connId, active) {
    const card = document.querySelector(`.conn-sidebar-card[data-conn-id="${connId}"]`);
    if (card) {
      card.classList.toggle('highlighted', active);
    }
  },

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

    try {
      const resp = await fetch('/api/sidebar/directions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicName: topic.name,
          topicStatus: this._serializeStatus(topic.statusSummary),
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

      // Update cache
      const freshTopic = Storage.getTopic(topic.id);
      if (freshTopic) {
        if (!freshTopic.sidebarCache) freshTopic.sidebarCache = {};
        freshTopic.sidebarCache.newDirections = newDirs;
        Storage.saveTopic(freshTopic);
      }
      
      if (location === 'sidebar' && topicId === this.currentTopicId) {
        // Update UI
        const dirContainer = document.getElementById('directionCards');
        if (dirContainer) {
          dirContainer.innerHTML = '';
          if (newDirs.length === 0) {
            dirContainer.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">Keep chatting for suggestions.</p>';
          }
          newDirs.forEach(dir => dirContainer.appendChild(this._createDirectionCard(dir)));
        }
        if (this.currentData) this.currentData.newDirections = newDirs;
      }

      StudyLog.event('module3_shuffled', {
        topicId: topicId,
        location,
        oldDirections: oldDirs,
        newDirections: newDirs.map(d => d.title),
      });
    } catch (err) {
      console.error('Shuffle directions failed:', err);
      if (location === 'sidebar') Utils.showToast('Failed to shuffle suggestions', 'error');
    }

    if (btn) btn.classList.remove('loading');
  },

  _initMergeDialog() {
    document.getElementById('mergeCancelBtn').addEventListener('click', () => {
      document.getElementById('mergeTopicDialog').style.display = 'none';
    });

    document.getElementById('mergeConfirmBtn').addEventListener('click', async () => {
      const targetId = document.getElementById('mergeTargetSelect').value;
      const sourceTopicId = App._mergeSourceTopicId;
      if (!targetId || !sourceTopicId) return;
      document.getElementById('mergeTopicDialog').style.display = 'none';
      await App._mergeTopics(targetId, sourceTopicId);
    });
  },

  _initModuleCollapse() {
    // Module collapse: clicking header or collapse button toggles module body
    document.querySelectorAll('.module-collapse-btn').forEach(btn => {
      const moduleId = btn.dataset.module;
      // Restore persisted state
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

    document.querySelectorAll('.module-header[data-module]').forEach(header => {
      header.addEventListener('click', (e) => {
        // Don't toggle if clicking the update or shuffle button
        if (e.target.closest('.status-update-btn') || e.target.closest('.shuffle-btn')) return;
        const moduleId = header.dataset.module;
        this._toggleModuleCollapse(moduleId);
      });
    });

    // Overview section collapse within Module 1
    document.addEventListener('click', (e) => {
      const label = e.target.closest('.status-section-label.collapsible');
      if (!label) return;
      const sectionKey = label.dataset.sectionToggle;
      const itemsEl = label.parentElement.querySelector('[data-section-items="' + sectionKey + '"]');
      if (!itemsEl) return;
      const isCollapsed = label.classList.toggle('section-collapsed');
      itemsEl.classList.toggle('section-collapsed', isCollapsed);
      localStorage.setItem('loom_overviewCollapsed', isCollapsed);
    });
  },

  _toggleModuleCollapse(moduleId) {
    const body = document.getElementById(moduleId + 'Body');
    const btn = document.querySelector('.module-collapse-btn[data-module="' + moduleId + '"]');
    if (!body) return;
    const collapsed = body.classList.toggle('collapsed');
    if (btn) btn.classList.toggle('collapsed', collapsed);
    localStorage.setItem('loom_moduleCollapse_' + moduleId, collapsed);
  },
};
