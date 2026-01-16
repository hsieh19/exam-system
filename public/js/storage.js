// Storage API - 使用后端 SQLite 数据库
const API_BASE = '';

// 当前用户缓存
let currentUser = null;


// 统一的带鉴权请求
async function authFetch(url, options = {}) {
  options.headers = options.headers || {};
  options.headers['Content-Type'] = 'application/json';

  const token = sessionStorage.getItem('auth_token');
  if (token) {
    options.headers['Authorization'] = 'Bearer ' + token;
  }

  try {
    // Use window.fetch to avoid getting replaced
    const res = await window.fetch(url, options);
    if (res.status === 401) {
      Storage.logout();
      if (!window.location.pathname.endsWith('index.html')) {
        window.location.href = 'index.html';
      }
      return Promise.reject('Unauthorized');
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
        sessionStorage.setItem('current_user', JSON.stringify(data.user));
        sessionStorage.setItem('auth_token', data.token);
        return data.user;
      }
      return null;
    }).catch(err => {
      console.error('Login error:', err);
      return null;
    });
  },

  getCurrentUser() {
    if (currentUser) return currentUser;
    const saved = sessionStorage.getItem('current_user');
    if (saved) {
      currentUser = JSON.parse(saved);
      return currentUser;
    }
    return null;
  },

  setCurrentUser(user) {
    currentUser = user;
    if (user) {
      sessionStorage.setItem('current_user', JSON.stringify(user));
    } else {
      sessionStorage.removeItem('current_user');
    }
  },

  logout() {
    currentUser = null;
    sessionStorage.removeItem('current_user');
    sessionStorage.removeItem('auth_token');
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

  deleteAllQuestions() {
    return authFetch(`${API_BASE}/api/questions/all`, { method: 'DELETE' });
  },

  // ==================== 试卷相关 ====================
  getPapers() {
    return authFetch(`${API_BASE}/api/papers`).then(r => r.json());
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
  }
};
