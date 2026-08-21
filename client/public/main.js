const STORAGE_KEY = 'ai-demo-sessions-v1';
const ACTIVE_SESSION_KEY = 'ai-demo-active-session-v1';
const MODEL_STORAGE_KEY = 'ai-demo-model-v1';
const DEFAULT_PROMPTS = [
  '帮我总结这个项目的要点',
  '用中文解释这个代码的作用',
  '给我写一个简洁的产品说明',
  '帮我生成一段 Python 示例代码'
];

const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const messages = document.getElementById('messages');
const sendButton = document.getElementById('send-button');
const clearButton = document.getElementById('clear-button');
const newSessionButton = document.getElementById('new-session-button');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sessionSearchInput = document.getElementById('session-search');
const sessionList = document.getElementById('session-list');
const fileInput = document.getElementById('file-input');
const uploadTrigger = document.getElementById('upload-trigger');
const fileNameLabel = document.getElementById('file-name');
const modelSelect = document.getElementById('model-select');
const exportButton = document.getElementById('export-button');
const continueButton = document.getElementById('continue-button');
const themeToggle = document.getElementById('theme-toggle');
const userAvatarButton = document.getElementById('user-avatar-button');

const defaultMessages = [{ role: 'bot', text: '你好，我是 AI 助手。' }];
const SIDEBAR_COLLAPSED_KEY = 'ai-demo-sidebar-collapsed-v1';
const USER_AVATAR_KEY = 'ai-demo-user-avatar-v1';
let sessions = [];
let activeSessionId = null;
let uploadedFile = null;
let availableModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'deepseek-chat'];
let editingSessionId = null;
let multiSelectMode = false;
let sessionSearchTerm = '';
const selectedSessionIds = new Set();

function setUploadedFile(file) {
  uploadedFile = file || null;
  if (!uploadedFile) {
    fileNameLabel.textContent = '未上传文件';
    if (fileInput) fileInput.value = '';
    return;
  }
  fileNameLabel.textContent = uploadedFile.name;
}

function handleFileSelection(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    setUploadedFile(null);
    return;
  }

  if (file.size > 1024 * 1024 * 2) {
    window.alert('文件大小不能超过 2MB');
    setUploadedFile(null);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    uploadedFile = { name: file.name, content: result };
    fileNameLabel.textContent = uploadedFile.name;
  };
  reader.onerror = () => {
    window.alert('读取文件失败，请重试');
    setUploadedFile(null);
  };
  reader.readAsText(file);
}

function getSelectedModel() {
  const savedChoice = localStorage.getItem(MODEL_STORAGE_KEY);
  if (savedChoice && availableModels.includes(savedChoice)) return savedChoice;
  return availableModels[0];
}

function populateModelOptions() {
  if (!modelSelect) return;

  modelSelect.innerHTML = '';
  availableModels.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  });

  const selected = getSelectedModel();
  modelSelect.value = selected;
  modelSelect.addEventListener('change', () => {
    localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);
  });
}

function loadAvailableModels() {
  fetch('/api/models')
    .then((res) => res.ok ? res.json() : Promise.resolve({ models: [] }))
    .then((data) => {
      if (Array.isArray(data.models) && data.models.length) {
        availableModels = [...new Set([...data.models, ...availableModels])];
      }
      populateModelOptions();
    })
    .catch(() => populateModelOptions());
}

marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false
});

function createSession() {
  return {
    id: `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: '新对话',
    messages: [...defaultMessages],
    summary: '',
    pinned: false,
    group: '默认',
    tags: [],
    metadata: {
      latestIntent: '',
      intentHistory: [],
      suggestions: []
    }
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return createSession();
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const intentHistory = Array.isArray(metadata.intentHistory) ? metadata.intentHistory.map((entry) => ({
    intent: typeof entry?.intent === 'string' ? entry.intent : '',
    confidence: Number(entry?.confidence || 0),
    at: typeof entry?.at === 'string' ? entry.at : new Date().toISOString()
  })).filter((entry) => entry.intent) : [];
  const tags = Array.isArray(session.tags) ? session.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean) : [];

  return {
    id: session.id || `session-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: session.title || '新对话',
    messages: Array.isArray(session.messages) && session.messages.length ? session.messages : [...defaultMessages],
    summary: typeof session.summary === 'string' ? session.summary : '',
    pinned: Boolean(session.pinned),
    group: typeof session.group === 'string' && session.group.trim() ? session.group.trim() : '默认',
    tags,
    metadata: {
      latestIntent: typeof metadata.latestIntent === 'string' ? metadata.latestIntent : '',
      intentHistory,
      suggestions: Array.isArray(metadata.suggestions) ? metadata.suggestions.filter((item) => typeof item === 'string').slice(0, 4) : []
    }
  };
}

function buildSuggestionsForIntent(intent) {
  const cleaned = (intent || '').toString().trim();
  if (!cleaned) {
    return ['请继续展开说明', '给我一个具体例子', '帮我总结要点'];
  }

  const normalized = cleaned.toLowerCase();
  const map = {
    总结: ['帮我总结核心要点', '提炼关键风险', '用一句话概括'],
    代码: ['帮我写示例代码', '解释这段代码', '给我优化建议'],
    产品: ['帮我写产品说明', '生成用户故事', '提炼功能亮点'],
    分析: ['请展开分析过程', '给出优缺点', '给我一份结论清单'],
    规划: ['帮我列出执行步骤', '给出时间安排', '制定优先级'],
    写作: ['帮我扩写内容', '润色这段文案', '给我几个版本'],
    比较: ['对比优缺点', '给出推荐方案', '列出选择标准']
  };

  const hit = Object.entries(map).find(([key]) => normalized.includes(key.toLowerCase()));
  return hit ? hit[1] : ['请继续展开说明', '给我一个具体例子', '帮我总结要点'];
}

function applyIntentMetadata(session, intentData) {
  if (!session || !intentData) return;
  const intent = String(intentData.intent || '').trim();
  if (!intent) return;

  session.metadata = session.metadata || {
    latestIntent: '',
    intentHistory: [],
    suggestions: []
  };

  session.metadata.latestIntent = intent;
  session.metadata.intentHistory = Array.isArray(session.metadata.intentHistory) ? session.metadata.intentHistory : [];
  session.metadata.intentHistory.push({
    intent,
    confidence: Number(intentData.confidence || 0),
    at: new Date().toISOString()
  });
  if (session.metadata.intentHistory.length > 6) {
    session.metadata.intentHistory = session.metadata.intentHistory.slice(-6);
  }
  session.metadata.suggestions = buildSuggestionsForIntent(intent);

  persistSessions();
  renderSessionList();
  renderSuggestionChips();
}

function persistSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
}

function loadSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      sessions = saved.map(normalizeSession);
    } else {
      sessions = [createSession()];
    }
  } catch (err) {
    console.warn('读取会话失败:', err);
    sessions = [createSession()];
  }

  const savedActiveId = localStorage.getItem(ACTIVE_SESSION_KEY);
  activeSessionId = sessions.some((session) => session.id === savedActiveId) ? savedActiveId : sessions[0].id;
  persistSessions();
}

function getActiveSession() {
  return sessions.find((session) => session.id === activeSessionId) || sessions[0];
}

function setActiveSession(sessionId) {
  if (!sessionId || !sessions.some((session) => session.id === sessionId)) return;
  activeSessionId = sessionId;
  persistSessions();
  renderSessionList();
  renderMessages();
  renderSuggestionChips();
  syncIntentLabelFromSession();
}

function getSessionTitle(session) {
  const title = typeof session?.title === 'string' ? session.title.trim() : '';
  if (title) return title;

  const userMessages = session.messages.filter((item) => item.role === 'user');
  if (userMessages.length === 0) return '新对话';
  const firstUserText = userMessages[0].text.trim();
  if (!firstUserText) return '新对话';
  return firstUserText.length > 18 ? `${firstUserText.slice(0, 18)}...` : firstUserText;
}

function renderMarkdown(text) {
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  const wrapper = document.createElement('div');
  wrapper.className = 'markdown-body';
  wrapper.innerHTML = html;
  wrapper.querySelectorAll('pre code').forEach((block) => {
    if (typeof window.hljs !== 'undefined') {
      window.hljs.highlightElement(block);
    }
  });
  return wrapper;
}

function formatMessageTime(dateLike) {
  const date = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function renderMessages() {
  const session = getActiveSession();
  messages.innerHTML = '';
  session.messages.forEach(({ role, text, time }) => {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'user' ? getUserAvatarLabel() : 'AI';

    const content = document.createElement('div');
    content.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (role === 'bot' && text === '正在思考...') {
      const dots = document.createElement('div');
      dots.className = 'typing-dots';
      dots.innerHTML = '<span></span><span></span><span></span>';
      bubble.appendChild(dots);
    } else if (role === 'bot') {
      bubble.appendChild(renderMarkdown(text));
    } else {
      bubble.textContent = text;
    }

    const stamp = document.createElement('div');
    stamp.className = 'message-time';
    stamp.textContent = formatMessageTime(time || new Date());

    content.appendChild(bubble);
    content.appendChild(stamp);
    wrapper.appendChild(avatar);
    wrapper.appendChild(content);
    messages.appendChild(wrapper);
  });
  messages.scrollTop = messages.scrollHeight;
}

function renderSuggestionChips() {
  const panel = document.getElementById('suggestion-list');
  if (!panel) return;

  const session = getActiveSession();
  if (!session) {
    panel.innerHTML = '';
    return;
  }

  const suggestions = Array.isArray(session.metadata?.suggestions) && session.metadata.suggestions.length
    ? session.metadata.suggestions
    : buildSuggestionsForIntent(session.metadata?.latestIntent || '');

  panel.innerHTML = '';
  suggestions.slice(0, 4).forEach((text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion-chip';
    button.textContent = text;
    button.addEventListener('click', () => {
      input.value = text;
      input.focus();
    });
    panel.appendChild(button);
  });
}

function shareSession(session) {
  const text = [session.title || '新对话', '', ...session.messages.map((item) => `${item.role === 'user' ? '用户' : 'AI'}：${item.text}`)].join('\n');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => window.alert('会话内容已复制到剪贴板'))
      .catch(() => window.alert('分享失败，请手动复制'));
    return;
  }
  window.prompt('复制会话内容', text);
}

function toggleSessionPin(session) {
  session.pinned = !session.pinned;
  persistSessions();
  renderAll();
}

function getSessionGroupName(session) {
  return session?.group || '默认';
}

function getSessionTags(session) {
  if (!Array.isArray(session?.tags)) return [];
  return session.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean);
}

function assignSessionGroup(session, groupName) {
  const next = (groupName || '').trim();
  session.group = next || '默认';
  persistSessions();
  renderAll();
}

function assignSessionTags(session, tagsInput) {
  const nextTags = (tagsInput || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5);
  session.tags = nextTags;
  persistSessions();
  renderAll();
}

function toggleSessionSelection(sessionId) {
  if (selectedSessionIds.has(sessionId)) {
    selectedSessionIds.delete(sessionId);
  } else {
    selectedSessionIds.add(sessionId);
  }
  renderSessionList();
}

function beginInlineRename(sessionId) {
  editingSessionId = sessionId;
  renderSessionList();
  requestAnimationFrame(() => {
    const input = document.querySelector(`.session-title-input[data-session-id="${sessionId}"]`);
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function finishInlineRename(session, value) {
  const trimmed = value.trim();
  if (trimmed) {
    session.title = trimmed;
  } else {
    session.title = '新对话';
  }
  editingSessionId = null;
  persistSessions();
  renderAll();
}

function getFilteredSessions() {
  const query = sessionSearchTerm.trim().toLowerCase();
  const baseSessions = [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  if (!query) return baseSessions;

  return baseSessions.filter((session) => {
    const haystack = [
      getSessionTitle(session),
      session.summary || '',
      getSessionGroupName(session),
      ...(getSessionTags(session)),
      ...session.messages.map((item) => item.text || '')
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

function renderSessionList() {
  const orderedSessions = getFilteredSessions();
  sessionList.innerHTML = '';

  if (!orderedSessions.length) {
    const empty = document.createElement('div');
    empty.className = 'session-empty';
    empty.textContent = '没有匹配的会话';
    sessionList.appendChild(empty);
    return;
  }

  const groups = {};
  orderedSessions.forEach((session) => {
    const groupName = getSessionGroupName(session);
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(session);
  });

  const groupOrder = Object.keys(groups).sort((a, b) => {
    if (a === '默认') return -1;
    if (b === '默认') return 1;
    return a.localeCompare(b, 'zh-CN');
  });

  groupOrder.forEach((groupName) => {
    const group = document.createElement('div');
    group.className = 'session-group';

    const header = document.createElement('div');
    header.className = 'session-group-header';
    header.textContent = groupName;
    group.appendChild(header);

    groups[groupName].forEach((session) => {
    const item = document.createElement('div');
    item.className = `session-item ${session.id === activeSessionId ? 'active' : ''} ${session.pinned ? 'pinned' : ''} ${selectedSessionIds.has(session.id) ? 'selected' : ''}`;

    const selectionToggle = document.createElement('label');
    selectionToggle.className = 'session-select-toggle';
    selectionToggle.style.display = multiSelectMode ? 'inline-flex' : 'none';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedSessionIds.has(session.id);
    checkbox.addEventListener('change', () => toggleSessionSelection(session.id));
    selectionToggle.appendChild(checkbox);

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'session-select';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'session-title-wrap';

    if (session.id === editingSessionId) {
      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'session-title-input';
      titleInput.dataset.sessionId = session.id;
      titleInput.value = getSessionTitle(session);
      titleInput.addEventListener('blur', () => finishInlineRename(session, titleInput.value));
      titleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finishInlineRename(session, titleInput.value);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          editingSessionId = null;
          renderSessionList();
        }
      });
      titleWrap.appendChild(titleInput);
    } else {
      const title = document.createElement('span');
      title.className = 'session-title';
      title.textContent = getSessionTitle(session);
      title.title = '双击编辑会话名称';
      title.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        beginInlineRename(session.id);
      });
      titleWrap.appendChild(title);
    }

    const meta = document.createElement('span');
    meta.className = 'session-meta';
    const summaryLabel = session.summary ? '已总结' : '未总结';
    const intentText = session.metadata?.latestIntent ? ` · ${session.metadata.latestIntent}` : '';
    const pinText = session.pinned ? ' · 置顶' : '';
    const tagsText = getSessionTags(session).length ? ` · ${getSessionTags(session).slice(0, 2).join(' / ')}` : '';
    meta.textContent = `${session.messages.filter((msg) => msg.role === 'user').length} 条消息 · ${summaryLabel}${pinText}${tagsText}${intentText}`;
    select.appendChild(titleWrap);
    select.appendChild(meta);
    select.addEventListener('click', () => setActiveSession(session.id));

    const menuWrap = document.createElement('div');
    menuWrap.className = 'session-menu-wrap';

    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'session-menu-button';
    menuButton.setAttribute('aria-label', '会话操作');
    menuButton.innerHTML = '<span></span><span></span><span></span>';
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = menuWrap.classList.contains('open');
      document.querySelectorAll('.session-menu-wrap').forEach((wrap) => wrap.classList.remove('open'));
      if (!isOpen) menuWrap.classList.add('open');
    });

    const menu = document.createElement('div');
    menu.className = 'session-menu';

    const menuActions = [
      { type: 'rename', label: '重命名', icon: '✏️', action: () => { menuWrap.classList.remove('open'); beginInlineRename(session.id); } },
      { type: 'pin', label: session.pinned ? '取消置顶' : '置顶', icon: session.pinned ? '📍' : '📌', action: () => { menuWrap.classList.remove('open'); toggleSessionPin(session); } },
      { type: 'group', label: '分组', icon: '🗂️', action: () => { menuWrap.classList.remove('open'); const value = window.prompt('设置分组（如：项目、客户、任务）', getSessionGroupName(session)); assignSessionGroup(session, value); } },
      { type: 'tag', label: '标签', icon: '🏷️', action: () => { menuWrap.classList.remove('open'); const value = window.prompt('设置标签（多个用逗号分隔）', getSessionTags(session).join(', ')); assignSessionTags(session, value); } },
      { type: 'share', label: '分享', icon: '🔗', action: () => { menuWrap.classList.remove('open'); shareSession(session); } },
      { type: 'multi', label: '多选', icon: '☑️', action: () => { menuWrap.classList.remove('open'); multiSelectMode = !multiSelectMode; if (!multiSelectMode) selectedSessionIds.clear(); renderSessionList(); } },
      { type: 'delete', label: '删除', icon: '🗑️', className: 'delete-action', action: () => { menuWrap.classList.remove('open'); if (sessions.length === 1) { sessions[0] = createSession(); activeSessionId = sessions[0].id; } else { const index = sessions.findIndex((itemSession) => itemSession.id === session.id); if (index >= 0) sessions.splice(index, 1); activeSessionId = sessions[0]?.id || null; } selectedSessionIds.delete(session.id); persistSessions(); renderAll(); } }
    ];

    menuActions.forEach(({ label, icon, className, action }) => {
      const actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = `menu-action ${className || ''}`.trim();
      actionButton.innerHTML = `<span class="menu-icon">${icon}</span><span>${label}</span>`;
      actionButton.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
      });
      menu.appendChild(actionButton);
    });

      menuWrap.appendChild(menuButton);
      menuWrap.appendChild(menu);

      item.appendChild(selectionToggle);
      item.appendChild(select);
      item.appendChild(menuWrap);
      group.appendChild(item);
    });

    sessionList.appendChild(group);
  });
}

function renderAll() {
  renderSessionList();
  renderMessages();
  renderSuggestionChips();
  syncIntentLabelFromSession();
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-mode', isDark);
  if (themeToggle) {
    themeToggle.textContent = isDark ? '☀️' : '🌙';
    themeToggle.title = isDark ? '切换为浅色模式' : '切换为深色模式';
  }
  localStorage.setItem('ai-demo-theme', theme);
}

function getUserAvatarLabel() {
  const userAvatar = localStorage.getItem(USER_AVATAR_KEY);
  if (userAvatar && userAvatar.trim()) return userAvatar.trim();
  return 'U';
}

function applyUserAvatar() {
  const avatarButton = document.getElementById('user-avatar-button');
  const avatarPreview = document.querySelector('.user-avatar-preview');
  const label = getUserAvatarLabel();
  if (avatarPreview) avatarPreview.textContent = label.slice(0, 1).toUpperCase();
  if (avatarButton) avatarButton.title = '点击修改用户头像';
}

function setUserAvatar() {
  const next = window.prompt('设置用户头像字符（建议 1 个字母或 emoji）', getUserAvatarLabel());
  if (next === null) return;
  const cleaned = next.trim();
  const value = cleaned || 'U';
  localStorage.setItem(USER_AVATAR_KEY, value);
  applyUserAvatar();
  renderMessages();
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  if (sidebarToggle) {
    sidebarToggle.innerHTML = '<span class="sidebar-toggle-glyph"></span>';
    sidebarToggle.classList.toggle('collapsed', collapsed);
    sidebarToggle.setAttribute('aria-label', collapsed ? '展开会话列表' : '收起会话列表');
    sidebarToggle.title = collapsed ? '展开会话列表' : '收起会话列表';
  }
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('ai-demo-theme') || 'light';
  applyTheme(savedTheme);
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const nextTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
      applyTheme(nextTheme);
    });
  }
}

function createNewSession() {
  const current = getActiveSession();
  const hasContent = Array.isArray(current?.messages) && current.messages.some((item) => item.role === 'user' || (item.role === 'bot' && item.text && item.text !== '正在思考...'));
  if (current && hasContent) {
    const session = createSession();
    sessions.push(session);
    activeSessionId = session.id;
  } else if (!current) {
    const session = createSession();
    sessions.push(session);
    activeSessionId = session.id;
  }
  persistSessions();
  renderAll();
  input.focus();
}

function resetCurrentSession() {
  const session = getActiveSession();
  session.title = '新对话';
  session.messages = [...defaultMessages];
  session.summary = '';
  session.metadata = {
    latestIntent: '',
    intentHistory: [],
    suggestions: []
  };
  persistSessions();
  renderAll();
}

function continuePreviousContext() {
  const session = getActiveSession();
  const lastUser = [...session.messages].reverse().find((item) => item.role === 'user');
  if (!lastUser) {
    input.value = '请继续我们的上文，并进一步展开。';
    input.focus();
    return;
  }
  input.value = `继续上文：${lastUser.text}`;
  input.focus();
}

async function autoSummarizeSession(session) {
  if (!session || session.messages.length < 6) return;
  if (session.summary && session.summary.length > 0) return;

  try {
    const history = session.messages
      .filter((item) => item.role === 'user' || item.role === 'bot')
      .slice(-12)
      .map((item) => ({
        role: item.role === 'user' ? 'user' : 'assistant',
        content: item.text
      }));

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '请给这段对话生成一段简短的中文总结，不超过 100 字。',
        model: getSelectedModel(),
        history,
        stream: false
      })
    });

    if (!res.ok) return;
    const data = await res.json();
    const summary = (data.reply || '').trim();
    if (summary) {
      session.summary = summary;
      persistSessions();
      renderSessionList();
    }
  } catch (err) {
    console.warn('Auto summary failed:', err);
  }
}

if (sessionSearchInput) {
  sessionSearchInput.addEventListener('input', (event) => {
    sessionSearchTerm = event.target.value || '';
    renderSessionList();
  });
}

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    setSidebarCollapsed(collapsed);
  });
}

if (userAvatarButton) {
  userAvatarButton.addEventListener('click', setUserAvatar);
}

const sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
setSidebarCollapsed(sidebarCollapsed);
applyUserAvatar();

input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  const session = getActiveSession();
  const timestamp = new Date().toISOString();
  const userMessage = { role: 'user', text: uploadedFile ? `${text}\n\n[附件: ${uploadedFile.name}]` : text, time: timestamp };
  const botPlaceholder = { role: 'bot', text: '正在思考...', time: timestamp, isTyping: true };
  session.messages = [...session.messages, userMessage, botPlaceholder];
  session.title = getSessionTitle(session);
  persistSessions();
  renderAll();
  input.value = '';
  sendButton.disabled = true;

  try {
    const history = session.messages
      .filter((item) => item.role === 'user' || item.role === 'bot')
      .slice(-12)
      .map((item) => ({
        role: item.role === 'user' ? 'user' : 'assistant',
        content: item.text
      }));

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        stream: true,
        model: getSelectedModel(),
        history,
        summary: session.summary || '',
        fileName: uploadedFile ? uploadedFile.name : '',
        fileContent: uploadedFile ? uploadedFile.content : ''
      })
    });

    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '请求失败');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let streamedText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = chunk.split(/\n\n+/);

      for (const event of events) {
        if (!event.trim()) continue;
        const lines = event.split(/\r?\n/);
        let payload = '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            payload += line.slice(5).trim();
          }
        }

        if (!payload) continue;

        try {
          const data = JSON.parse(payload);
          if (data.type === 'content' && data.text) {
            streamedText += data.text;
            session.messages[session.messages.length - 1] = { role: 'bot', text: streamedText, time: new Date().toISOString(), isTyping: false };
            renderMessages();
          }

          if (data.type === 'error') {
            throw new Error(data.text || '流式输出失败');
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }

    session.messages[session.messages.length - 1] = { role: 'bot', text: streamedText || 'AI 未返回有效内容', time: new Date().toISOString(), isTyping: false };
  } catch (err) {
    session.messages[session.messages.length - 1] = { role: 'bot', text: err.message || '请求失败', time: new Date().toISOString(), isTyping: false };
  } finally {
    session.title = getSessionTitle(session);
    if (session.messages.length >= 6) {
      autoSummarizeSession(session);
    }
    persistSessions();
    renderAll();
    sendButton.disabled = false;
    setUploadedFile(null);
    input.focus();
  }
});

clearButton.addEventListener('click', () => {
  const confirmed = window.confirm('确定要清空当前会话吗？');
  if (!confirmed) return;
  resetCurrentSession();
  input.focus();
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.session-menu-button') && !target.closest('.session-menu')) {
    document.querySelectorAll('.session-menu-wrap').forEach((wrap) => wrap.classList.remove('open'));
  }
});

newSessionButton.addEventListener('click', createNewSession);
if (uploadTrigger) {
  uploadTrigger.addEventListener('click', () => fileInput.click());
}
fileInput.addEventListener('change', handleFileSelection);
continueButton.addEventListener('click', continuePreviousContext);
exportButton.addEventListener('click', () => {
  const session = getActiveSession();
  const content = session.messages
    .map((item) => {
      const label = item.role === 'user' ? '用户' : 'AI';
      return `## ${label}\n${item.text}\n`;
    })
    .join('\n---\n\n');

  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(session.title || 'chat').replace(/\s+/g, '-').toLowerCase()}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

// Voice I/O: Speech Recognition and Speech Synthesis
const micButton = document.getElementById('mic-button');
const ttsToggle = document.getElementById('tts-toggle');
let recognition = null;
let isRecording = false;

function speakText(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
  } catch (e) {}
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = 1.0;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}

function speakIfEnabled(text) {
  if (!ttsToggle) return;
  if (ttsToggle.checked && text && text.trim()) {
    speakText(text);
  }
}

async function normalizeText(text) {
  try {
    const res = await fetch('/api/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: getSelectedModel() })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (err) {
    console.warn('normalizeText error', err);
    return null;
  }
}

function syncIntentLabelFromSession() {
  const session = getActiveSession();
  const label = document.getElementById('intent-label');
  if (!label) return;
  label.textContent = session?.metadata?.latestIntent ? `意图：${session.metadata.latestIntent}` : '';
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  if (!SpeechRecognition) {
    if (micButton) micButton.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    if (micButton) micButton.textContent = '■ 结束';
  };
  recognition.onend = async () => {
    isRecording = false;
    if (micButton) micButton.textContent = '🎤 语音输入';
    // After recognition ends, send text to backend for normalization/intent
    const text = input.value && input.value.trim();
    if (text) {
      try {
        const norm = await normalizeText(text);
        if (norm && norm.normalized) {
          input.value = norm.normalized;
        }
        const intentLabel = document.getElementById('intent-label');
        if (norm && norm.intent) {
          const session = getActiveSession();
          applyIntentMetadata(session, norm);
          if (intentLabel) intentLabel.textContent = `意图：${norm.intent}`;
        } else if (intentLabel) {
          intentLabel.textContent = '';
        }
      } catch (err) {
        console.warn('Normalization failed', err);
      }
    }
  };
  let interim = '';
  recognition.onresult = (ev) => {
    let finalTranscript = '';
    interim = '';
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalTranscript += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = finalTranscript + interim;
  };
  recognition.onerror = (e) => {
    console.warn('Recognition error', e);
  };
}

function toggleRecording() {
  if (!recognition) return;
  if (isRecording) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

if (micButton) micButton.addEventListener('click', toggleRecording);
setupSpeechRecognition();

// Hook TTS to run when bot finishes responding
const originalRenderMessages = renderMessages;
renderMessages = function() {
  originalRenderMessages();
  const session = getActiveSession();
  const last = session.messages[session.messages.length - 1];
  if (last && last.role === 'bot') {
    speakIfEnabled(last.text);
  }
};

initializeTheme();
loadAvailableModels();
loadSessions();
renderAll();
