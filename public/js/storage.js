const API_BASE = '';
let currentUser = null;
const SafeStorage = {
  get(key) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null && v !== undefined) return v;
    } catch (e) {}
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch (e) {}
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
    try { sessionStorage.removeItem(key); } catch (e) {}
  }
};

async function authFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['Content-Type'] = 'application/json';
  const token = SafeStorage.get('auth_token');
  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }
  try {
    const res = await window.fetch(url, options);
    if (res.status === 401) {
      const clone = res.clone();
      try {
        const data = await clone.json();
        if (data && data.error) {
          SafeStorage.set('logout_reason', data.error);
        }
      } catch (e) {}
      Storage.logout();
      if (!window.location.pathname.endsWith('index.html')) {
        window.location.href = 'index.html';
      }
      return Promise.reject('Unauthorized');
    }
    if (res.status === 403) {
      // 检查是否是强制修改密码
      const clone = res.clone();
      try {
        const data = await clone.json();
        if (data.forcePasswordChange) {
          if (!window.location.pathname.endsWith('index.html')) {
            window.location.href = 'index.html';
          }
          return Promise.reject('ForcePasswordChange');
        }
      } catch (e) {
        // 解析失败则忽略
      }
    }
    return res;
  } catch (e) {
    console.error('Network error', e);
    throw e;
  }
}

const Storage = {
  // ==================== 用户相关 ====================
  getUsers() {
    return authFetch(`${API_BASE}/api/users`).then(r => r.json());
  },

  addUser(user) {
    return authFetch(`${API_BASE}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    }).then(r => r.json());
  },

  deleteUser(id) {
    return authFetch(`${API_BASE}/api/users/${id}`, { method: 'DELETE' });
  },

  updateUser(user) {
    return authFetch(`${API_BASE}/api/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    }).then(r => r.json());
  },

  login(username, password) {
    return window.fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(r => {
      if (r.ok) return r.json();
      return null;
    }).then(data => {
      if (data && data.token && data.user) {
        currentUser = data.user;
        SafeStorage.set('current_user', JSON.stringify(data.user));
        SafeStorage.set('auth_token', data.token);
        return data.user;
      }
      return null;
    }).catch(err => {
      console.error('Login error:', err);
      return null;
    });
  },

  feishuLogin(code) {
    return window.fetch(`${API_BASE}/api/feishu/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }).then(r => {
      if (r.ok) return r.json();
      return r.json().then(data => { throw new Error(data.error || '飞书登录失败'); });
    }).then(data => {
      if (data && data.token && data.user) {
        currentUser = data.user;
        SafeStorage.set('current_user', JSON.stringify(data.user));
        SafeStorage.set('auth_token', data.token);
        return data.user;
      }
      return null;
    });
  },

  getFeishuConfig() {
    return window.fetch(`${API_BASE}/api/feishu/config`).then(r => r.json());
  },

  changePassword(oldPassword, newPassword) {
    return authFetch(`${API_BASE}/api/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword })
    }).then(async r => {
      const data = await r.json();
      if (r.ok) {
        // 更新本地存储的 isFirstLogin 状态
        if (currentUser) {
          currentUser.isFirstLogin = 0;
          SafeStorage.set('current_user', JSON.stringify(currentUser));
        }
        return data;
      }
      throw new Error(data.error || '修改密码失败');
    });
  },

  getCurrentUser() {
    if (currentUser) return currentUser;
    const saved = SafeStorage.get('current_user');
    if (saved) {
      try {
        currentUser = JSON.parse(saved);
        return currentUser;
      } catch (e) {
        SafeStorage.remove('current_user');
      }
    }
    return null;
  },

  setCurrentUser(user) {
    currentUser = user;
    if (user) {
      SafeStorage.set('current_user', JSON.stringify(user));
    } else {
      SafeStorage.remove('current_user');
    }
  },

  logout() {
    currentUser = null;
    SafeStorage.remove('current_user');
    SafeStorage.remove('auth_token');
  },

  // ==================== 分组相关 ====================
  getGroups() {
    return authFetch(`${API_BASE}/api/groups`).then(r => r.json());
  },

  addGroup(group) {
    return authFetch(`${API_BASE}/api/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group)
    }).then(r => r.json());
  },

  deleteGroup(id) {
    return authFetch(`${API_BASE}/api/groups/${id}`, { method: 'DELETE' });
  },

  updateGroup(group) {
    return authFetch(`${API_BASE}/api/groups/${group.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(group)
    }).then(r => r.json());
  },

  // ==================== 专业分类相关 ====================
  getCategories() {
    return authFetch(`${API_BASE}/api/categories`).then(r => r.json());
  },

  getMajors() {
    return authFetch(`${API_BASE}/api/categories/majors`).then(r => r.json());
  },

  getDeviceTypes(majorId) {
    return authFetch(`${API_BASE}/api/categories/devices/${majorId}`).then(r => r.json());
  },

  addCategory(cat) {
    return authFetch(`${API_BASE}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cat)
    }).then(r => r.json());
  },

  updateCategory(cat) {
    return authFetch(`${API_BASE}/api/categories/${cat.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cat)
    }).then(r => r.json());
  },

  deleteCategory(id) {
    return authFetch(`${API_BASE}/api/categories/${id}`, { method: 'DELETE' });
  },

  // ==================== 题目相关 ====================
  getQuestions() {
    return authFetch(`${API_BASE}/api/questions`).then(r => r.json());
  },

  addQuestion(question) {
    return authFetch(`${API_BASE}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(question)
    }).then(r => r.json());
  },

  updateQuestion(question) {
    return authFetch(`${API_BASE}/api/questions/${question.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(question)
    }).then(r => r.json());
  },

  deleteQuestion(id) {
    return authFetch(`${API_BASE}/api/questions/${id}`, { method: 'DELETE' });
  },

  deleteAllQuestions(groupId) {
    let url = `${API_BASE}/api/questions/all`;
    if (groupId) {
      url += `?groupId=${groupId}`;
    }
    return authFetch(url, { method: 'DELETE' });
  },

  // ==================== 试卷相关 ====================
  getPapers() {
    return authFetch(`${API_BASE}/api/papers`).then(r => r.json());
  },

  getRankingPapers() {
    return authFetch(`${API_BASE}/api/papers/ranking-list`).then(r => r.json());
  },

  getPaperById(id) {
    return authFetch(`${API_BASE}/api/papers/${id}`).then(r => r.json());
  },

  addPaper(paper) {
    return authFetch(`${API_BASE}/api/papers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paper)
    }).then(r => r.json());
  },

  addPaperWithRules(paper) {
    return this.addPaper(paper);
  },

  updatePaper(paper) {
    return authFetch(`${API_BASE}/api/papers/${paper.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paper)
    }).then(r => r.json());
  },

  publishPaper(paperId, targetGroups, targetUsers, deadline) {
    return authFetch(`${API_BASE}/api/papers/${paperId}/publish`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetGroups, targetUsers, deadline })
    }).then(r => r.json());
  },

  deletePaper(id) {
    return authFetch(`${API_BASE}/api/papers/${id}`, { method: 'DELETE' });
  },

  getPushLogs(paperId) {
    return authFetch(`${API_BASE}/api/papers/${paperId}/push-logs`).then(r => r.json());
  },

  getPapersForUser(userId) {
    return authFetch(`${API_BASE}/api/papers/user/${userId}`).then(r => r.json());
  },

  getExamPaper(paperId) {
    return authFetch(`${API_BASE}/api/exam/${paperId}`).then(r => r.json());
  },

  updateExamSession(paperId, answers, lastQuestionStartTime) {
    return authFetch(`${API_BASE}/api/exam/${paperId}/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers, lastQuestionStartTime })
    }).then(r => r.json());
  },

  // ==================== 记录相关 ====================
  getRecords() {
    return authFetch(`${API_BASE}/api/records`).then(r => r.json());
  },

  saveRecord(record) {
    return authFetch(`${API_BASE}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    }).then(r => r.json());
  },

  getRanking(paperId) {
    return authFetch(`${API_BASE}/api/ranking/${paperId}`).then(r => r.json());
  },
  deletePaperRecords(paperId) {
    return authFetch(`${API_BASE}/api/records/paper/${paperId}`, {
      method: 'DELETE'
    }).then(r => r.json());
  },

  // ==================== 数据库管理 ====================
  getDbConfig() {
    return authFetch(`${API_BASE}/api/db/config`).then(r => r.json());
  },

  testDbConnection(dbType) {
    return authFetch(`${API_BASE}/api/db/test`, {
      method: 'POST',
      body: JSON.stringify({ dbType })
    }).then(r => r.json());
  },

  switchDb(dbType) {
    return authFetch(`${API_BASE}/api/db/switch`, {
      method: 'POST',
      body: JSON.stringify({ dbType })
    }).then(r => r.json());
  },

  exportDb() {
    return authFetch(`${API_BASE}/api/db/export`).then(r => r.blob());
  },

  importDb(file) {
    const formData = new FormData();
    formData.append('file', file);

    const token = SafeStorage.get('auth_token');
    return window.fetch(`${API_BASE}/api/db/import`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      },
      body: formData
    }).then(r => r.json());
  },

  // ==================== 系统日志相关 ====================
  getSystemLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.action) query.set('action', params.action);
    if (params.target) query.set('target', params.target);
    if (params.userId) query.set('userId', params.userId);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (params.page) query.set('page', params.page);
    if (params.pageSize) query.set('pageSize', params.pageSize);

    const queryStr = query.toString();
    const url = `${API_BASE}/api/logs${queryStr ? '?' + queryStr : ''}`;
    return authFetch(url).then(r => r.json());
  },

  clearSystemLogs() {
    return authFetch(`${API_BASE}/api/logs`, {
      method: 'DELETE'
    }).then(r => r.json());
  }
};
