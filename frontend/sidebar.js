/* Right sidebar: 3 modules + drag-and-drop */

const Sidebar = {
  currentTopicId: null,
  currentData: null,

  init() {
    document.getElementById('sidebarRefreshBtn').addEventListener('click', () => {
      this.refresh();
    });
    this._initStatusEdit();
    this._initStatusDrag();
    this._initStatusUpdate();
    this._initMergeDialog();
  },

  show(topicId) {
    this.currentTopicId = topicId;
    document.getElementById('sidebarEmpty').style.display = 'none';
    document.getElementById('moduleStatus').style.display = 'block';
    document.getElementById('moduleRelated').style.display = 'block';
    document.getElementById('moduleDirections').style.display = 'block';
    document.getElementById('sidebarRefreshBtn').style.display = 'flex';

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

  hide() {
    this.currentTopicId = null;
    document.getElementById('sidebarEmpty').style.display = 'block';
    document.getElementById('moduleStatus').style.display = 'none';
    document.getElementById('moduleRelated').style.display = 'none';
    document.getElementById('moduleDirections').style.display = 'none';
    document.getElementById('sidebarRefreshBtn').style.display = 'none';
    document.getElementById('topicBadge').style.display = 'none';
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

    // Module 2: Related cards (with fallback to raw past chats)
    const relatedContainer = document.getElementById('relatedCards');
    relatedContainer.innerHTML = '';
    let cards = data.relatedCards || [];
    if (cards.length === 0 && topic) {
      const currentChatId = Storage.getCurrentChatId();
      const pastChats = Storage.getAllChatSummariesForTopic(topic.id)
        .filter(c => c.id !== currentChatId)
        .slice(0, 4);
      cards = pastChats.map(c => ({
        sourceType: 'chat',
        sourceId: c.id,
        sourceTitle: c.title,
        sourceSummary: c.summary || '',
        bridgeQuestion: '',
      }));
    }
    if (cards.length === 0) {
      relatedContainer.innerHTML = '<p style="font-size:12px;color:var(--text-muted);">No related content yet.</p>';
    }
    cards.forEach(card => {
      relatedContainer.appendChild(this._createRelatedCard(card));
    });

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

  _createRelatedCard(card) {
    const el = document.createElement('div');
    el.className = 'related-card';
    el.draggable = true;
    const isChat = card.sourceType === 'chat';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-type-icon ${isChat ? 'chat-icon' : 'concept-icon'}">${isChat ? '💬' : '💡'}</span>
        <span class="card-title">${Utils.escapeHtml(card.sourceTitle || '')}</span>
        ${!isChat && card.sourceId ? `<button class="card-remove-btn" data-concept-id="${Utils.escapeHtml(card.sourceId)}" title="Remove concept">&times;</button>` : ''}
      </div>
      ${card.sourceSummary ? `<div class="card-meta">${Utils.escapeHtml(Utils.truncate(card.sourceSummary, 60))}</div>` : ''}
      <div class="card-question">${Utils.escapeHtml(card.bridgeQuestion || '')}</div>
      <div class="card-drag-hint">⟶ Drag to chat</div>
    `;

    const removeBtn = el.querySelector('.card-remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const conceptId = removeBtn.dataset.conceptId;
        Storage.deleteConcept(conceptId);
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(() => el.remove(), 200);
        Utils.showToast('Concept removed', 'info');
      });
    }

    this._setupDrag(el, card.bridgeQuestion || '', card.sourceTitle || '');
    return el;
  },

  _createDirectionCard(dir) {
    const el = document.createElement('div');
    el.className = 'direction-card';
    el.draggable = true;
    el.innerHTML = `
      <div class="card-header">
        <span class="card-type-icon direction-icon">✨</span>
        <span class="card-title">${Utils.escapeHtml(dir.title || '')}</span>
      </div>
      <div class="card-question">${Utils.escapeHtml(dir.question || '')}</div>
      <div class="card-drag-hint">⟶ Drag to chat</div>
    `;
    this._setupDrag(el, dir.question || '', dir.title || '');
    return el;
  },

  _setupDrag(el, fullText, label) {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', fullText);
      e.dataTransfer.setData('application/loom-label', label);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    // Also allow click-to-add
    el.addEventListener('click', () => {
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
    document.getElementById('relatedCards').innerHTML = `
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
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
    // Fallback for old HTML that only has a <p> element
    if (container.id === 'statusText') {
      container.textContent = this._serializeStatus(statusData);
      return;
    }
    if (typeof statusData === 'string') {
      container.innerHTML = `<div class="status-section"><div class="status-section-label">Overview</div><div class="status-item"><span class="status-item-text">${Utils.escapeHtml(statusData)}</span></div></div>`;
      return;
    }
    const overview = statusData.overview || [];
    const specifics = statusData.specifics || [];
    let html = '';
    if (overview.length > 0) {
      html += '<div class="status-section"><div class="status-section-label">Overview</div>';
      overview.forEach((pt, i) => {
        html += `<div class="status-item" data-section="overview" data-idx="${i}">
          <span class="status-item-text">${Utils.escapeHtml(pt)}</span>
          <span class="status-item-actions">
            <button class="status-item-btn status-item-edit" title="Edit">✎</button>
            <button class="status-item-btn status-item-del" title="Remove">×</button>
          </span></div>`;
      });
      html += '</div>';
    }
    if (specifics.length > 0) {
      html += '<div class="status-section"><div class="status-section-label">Specifics</div>';
      specifics.forEach((item, i) => {
        const text = typeof item === 'string' ? item : item.text || '';
        const level = typeof item === 'object' ? item.level || '' : '';
        const levelClass = level ? ` level-${level}` : '';
        html += `<div class="status-item" data-section="specifics" data-idx="${i}">
          <span class="status-item-text">${Utils.escapeHtml(text)}</span>
          ${level ? `<span class="status-level${levelClass}">${Utils.escapeHtml(level)}</span>` : ''}
          <span class="status-item-actions">
            <button class="status-item-btn status-item-edit" title="Edit">✎</button>
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
    container.querySelectorAll('.status-item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.status-item');
        const section = item.dataset.section;
        const idx = parseInt(item.dataset.idx);
        this._deleteStatusItem(section, idx);
      });
    });
    container.querySelectorAll('.status-item-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.status-item');
        const section = item.dataset.section;
        const idx = parseInt(item.dataset.idx);
        const textEl = item.querySelector('.status-item-text');
        const original = textEl.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'status-inline-edit';
        input.value = original;
        textEl.replaceWith(input);
        input.focus();
        input.select();
        const save = () => {
          const val = input.value.trim();
          if (val && val !== original) this._editStatusItem(section, idx, val);
          else this._renderStatus(this._getCurrentStatus());
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') input.blur();
          if (ev.key === 'Escape') { input.value = original; input.blur(); }
        });
      });
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
  },

  _editStatusItem(section, idx, newText) {
    const topic = Storage.getTopic(this.currentTopicId);
    if (!topic || typeof topic.statusSummary !== 'object') return;
    const arr = topic.statusSummary[section];
    if (!arr || idx < 0 || idx >= arr.length) return;
    if (section === 'overview') {
      arr[idx] = newText;
    } else {
      if (typeof arr[idx] === 'object') arr[idx].text = newText;
      else arr[idx] = newText;
    }
    topic.statusLastUpdated = Utils.timestamp();
    Storage.saveTopic(topic);
    this._renderStatus(topic.statusSummary);
  },

  _serializeStatus(statusSummary) {
    if (!statusSummary) return '';
    if (typeof statusSummary === 'string') return statusSummary;
    const parts = [];
    if (statusSummary.overview) {
      parts.push('Overview: ' + statusSummary.overview.join('; '));
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
    document.getElementById('statusUpdateBtn').addEventListener('click', async () => {
      if (!this.currentTopicId) return;
      const topic = Storage.getTopic(this.currentTopicId);
      if (!topic) return;

      const btn = document.getElementById('statusUpdateBtn');
      btn.textContent = 'Updating…';
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
        if (data.overview) {
          newStatus = { overview: data.overview, specifics: data.specifics || [] };
        } else {
          newStatus = data.status || topic.statusSummary;
        }
        topic.statusSummary = newStatus;
        topic.statusLastUpdated = Utils.timestamp();
        if (topic.sidebarCache) topic.sidebarCache.statusUpdate = newStatus;
        Storage.saveTopic(topic);
        this._renderStatus(newStatus);
        Utils.showToast('Status updated', 'success');
      } catch (err) {
        console.error('Status update failed:', err);
        Utils.showToast('Status update failed', 'error');
      }
      btn.textContent = 'Update';
      btn.disabled = false;
    });
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
};
