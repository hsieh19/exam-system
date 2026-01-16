const CATEGORIES = ['电气专业', '暖通专业', '弱电专业', '消防专业', '公共题目'];
let editingQuestion = null;
let editingUserId = null; // 新增：用于标记当前正在编辑的用户
let cachedData = { groups: [], users: [], questions: [], papers: [] };

document.addEventListener('DOMContentLoaded', async function () {
    const user = Auth.checkAdmin();
    if (user) {
        Auth.updateUserInfo();
        initNavigation();
        await refreshCache();
        loadGroups();
        loadUsers();
    }
});

async function refreshCache() {
    cachedData.groups = await Storage.getGroups();
    cachedData.users = await Storage.getUsers();
    cachedData.questions = await Storage.getQuestions();
    cachedData.papers = await Storage.getPapers();
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', async function () {
            const page = this.dataset.page;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
            document.getElementById(`page-${page}`).classList.remove('hidden');

            await refreshCache();
            if (page === 'users') { loadGroups(); loadUsers(); }
            else if (page === 'questions') loadQuestions();
            else if (page === 'papers') { loadPaperGroups(); loadPapers(); }
            else if (page === 'ranking') loadAdminRankingOptions();
            else if (page === 'analysis') loadAdminAnalysisOptions();
        });
    });

    document.getElementById('admin-ranking-select').addEventListener('change', function () {
        if (this.value) loadAdminRanking(this.value);
    });

    document.getElementById('analysis-paper-select').addEventListener('change', function () {
        if (this.value) loadAdminAnalysis(this.value);
        else {
            document.getElementById('analysis-content').innerHTML = '<div class="empty-state"><p>请选择试卷以生成分析报告</p></div>';
            document.getElementById('btn-clear-records').style.display = 'none';
        }
    });
}

// ========== 模态框 ==========
function openModal(title, bodyHtml, footerHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-footer').innerHTML = footerHtml;
    document.getElementById('modal-overlay').classList.add('active');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    editingUserId = null; // 关闭时重置编辑状态
}

// ========== 分组管理 ==========
function loadGroups() {
    const groups = cachedData.groups;
    const html = groups.length ? `<table class="data-table"><thead><tr><th>分组名称</th><th style="text-align:center;width:100px;">操作</th></tr></thead>
    <tbody>${groups.map(g => `<tr><td>${escapeHtml(g.name)}</td><td style="text-align:center;">
      <button class="btn btn-sm btn-danger" onclick="deleteGroup('${g.id}')">删除</button>
    </td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">暂无分组</p>';
    document.getElementById('groups-list').innerHTML = html;
}

function showAddGroup() {
    openModal('添加分组',
        '<div class="form-group"><label class="form-label">分组名称</label><input type="text" class="form-input" id="group-name"></div>',
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveGroup()">保存</button>');
}

async function saveGroup() {
    const name = document.getElementById('group-name').value.trim();
    if (name) {
        await Storage.addGroup({ name });
        closeModal();
        await refreshCache();
        loadGroups();
    }
}

async function deleteGroup(id) {
    // 检查该分组下是否有用户
    const hasUsers = cachedData.users.some(u => u.groupId === id);
    if (hasUsers) {
        alert('无法删除：该分组下仍有用户。请先将用户移动到其他分组或删除用户。');
        return;
    }

    if (confirm('确定删除此分组？')) {
        await Storage.deleteGroup(id);
        await refreshCache();
        loadGroups();
    }
}

// ========== 用户管理 ==========
function loadUsers() {
    renderUsers();
}

function filterUsers() {
    renderUsers();
}

function renderUsers() {
    let users = cachedData.users;
    const query = document.getElementById('user-search-input')?.value.trim().toLowerCase();
    const groups = cachedData.groups;
    const getGroupName = (gid) => groups.find(g => g.id === gid)?.name || '-';

    if (query) {
        users = users.filter(u => {
            const groupName = getGroupName(u.groupId).toLowerCase();
            return u.username.toLowerCase().includes(query) || groupName.includes(query);
        });
    }

    const html = users.length ? `<table class="data-table"><thead><tr><th>用户名</th><th>分组</th><th style="text-align:center;width:280px;">操作</th></tr></thead>
    <tbody>${users.map(u => {
        const isAdmin = u.role === 'admin';
        const nameStyle = isAdmin ? 'color: #2563eb; font-weight: bold;' : '';
        const adminBtnClass = isAdmin ? 'btn-primary' : 'btn-secondary';
        const adminBtnText = isAdmin ? '取消管理' : '设为管理';
        const mySelf = Storage.getCurrentUser();
        // 如果是自己，禁用删除和取消管理，或者只禁用删除？通常不建议删自己。
        const isSelf = mySelf && mySelf.id === u.id;

        return `<tr>
        <td style="${nameStyle}">
            ${escapeHtml(u.username)} 
            ${isAdmin ? '<span class="badge badge-primary" style="margin-left:5px;font-size:10px;">ADMIN</span>' : ''}
        </td>
        <td>${escapeHtml(getGroupName(u.groupId))}</td>
        <td style="text-align:center;">
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:nowrap;">
            <button class="btn btn-sm ${adminBtnClass}" onclick="toggleAdmin('${u.id}')" style="white-space:nowrap;">${adminBtnText}</button>
            <button class="btn btn-sm btn-secondary" onclick="showEditUser('${u.id}')" style="white-space:nowrap;">编辑</button>
            <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')" ${isSelf ? 'disabled title="不能删除自己"' : ''} style="white-space:nowrap;">删除</button>
          </div>
        </td></tr>`;
    }).join('')}</tbody></table>` : '<p class="text-muted">暂无用户</p>';
    document.getElementById('users-list').innerHTML = html;
}

async function toggleAdmin(id) {
    const user = cachedData.users.find(u => u.id === id);
    if (!user) return;

    const mySelf = Storage.getCurrentUser();
    if (mySelf && mySelf.id === user.id && user.role === 'admin') {
        alert('无法取消自己的管理员权限');
        return;
    }

    const newRole = user.role === 'admin' ? 'student' : 'admin';
    const action = newRole === 'admin' ? '设为管理员' : '取消管理员';

    // 无需弹窗确认，直接切换，体验更丝滑（因为有按钮颜色反馈）
    // 但用户描述“再次点击即可取消”，有点开关的意思。为了安全还是弹个窗？
    // 用户没明确说要确认。但为了防止误点，还是加个简单的 confirm 比较好，或者不加。
    // 很多后台系统设为管理员是敏感操作。
    // 但是为了满足用户“点击可将...再次点击即可取消”的流畅描述，我决定不加 confirm，因为按钮状态很明显。
    // 或者加一个轻量级的。

    await Storage.updateUser({ ...user, role: newRole });
    await refreshCache(); // 属性变了，刷新缓存
    loadUsers(); // 重新渲染
}

function showAddUser() {
    editingUserId = null; // 重置为新增模式
    const groups = cachedData.groups;
    openModal('添加用户',
        `<div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" id="user-name"></div>
         <div class="form-group"><label class="form-label">密码</label><input type="text" class="form-input" id="user-pwd" value="123456"></div>
         <div class="form-group"><label class="form-label">分组</label><select class="form-select" id="user-group">
           <option value="">未分组</option>
           ${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}</select></div>`,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveUser()">保存</button>');
}

function showEditUser(id) {
    editingUserId = id;
    const user = cachedData.users.find(u => u.id === id);
    if (!user) return;

    const groups = cachedData.groups;
    openModal('编辑用户',
        `<div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" id="user-name" value="${escapeHtml(user.username)}"></div>
         <div class="form-group"><label class="form-label">密码</label><input type="text" class="form-input" id="user-pwd" placeholder="留空则不修改密码"></div>
         <div class="form-group"><label class="form-label">分组</label><select class="form-select" id="user-group">
           <option value="">未分组</option>
           ${groups.map(g => `<option value="${g.id}" ${g.id === user.groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</select></div>`,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveUser()">更新</button>');
}

async function saveUser() {
    const username = document.getElementById('user-name').value.trim();
    const password = document.getElementById('user-pwd').value;
    const groupId = document.getElementById('user-group').value;

    if (!username) { alert('请输入用户名'); return; }

    if (editingUserId) {
        // 编辑模式
        const oldUser = cachedData.users.find(u => u.id === editingUserId);
        if (oldUser) {
            const updateData = { ...oldUser, username, groupId };
            if (password) updateData.password = password; // 只有输入了密码才更新
            await Storage.updateUser(updateData);
        }
    } else {
        // 新增模式
        await Storage.addUser({ username, password: password || '123456', role: 'student', groupId });
    }

    closeModal();
    await refreshCache();
    loadUsers();
}

async function deleteUser(id) {
    if (confirm('确定删除此用户？')) {
        await Storage.deleteUser(id);
        await refreshCache();
        loadUsers();
    }
}

// ========== 题库管理 ==========
let currentQuestionFilters = ['single', 'multiple', 'judge'];

function loadQuestions() {
    let questions = cachedData.questions;
    // 过滤出选中的题型
    questions = questions.filter(q => currentQuestionFilters.includes(q.type));

    const typeMap = { single: '单选题', multiple: '多选题', judge: '判断题' };

    const html = questions.length ? `<div class="table-container"><table class="data-table">
    <thead><tr><th>专业</th><th>题目</th><th>类型</th><th>操作</th></tr></thead>
    <tbody>${questions.map(q => `<tr>
      <td>${escapeHtml(q.category || '-')}</td>
      <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(q.content)}</td>
      <td><span class="badge badge-primary">${typeMap[q.type]}</span></td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editQuestion('${q.id}')">编辑</button>
        <button class="btn btn-sm btn-danger" onclick="deleteQuestion('${q.id}')">删除</button>
      </td>
    </tr>`).join('')}</tbody></table></div>` : `<p class="text-muted">所选题型中暂无题目</p>`;
    document.getElementById('questions-list').innerHTML = html;
}

function toggleQuestionFilter(btn) {
    const type = btn.dataset.type;

    if (btn.classList.contains('active')) {
        // 如果至少剩下一个，才允许取消
        if (currentQuestionFilters.length <= 1) {
            alert('至少需保留一个题型。');
            return;
        }
        btn.classList.remove('active', 'btn-primary');
        btn.classList.add('btn-secondary');
        currentQuestionFilters = currentQuestionFilters.filter(t => t !== type);
    } else {
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-secondary');
        currentQuestionFilters.push(type);
    }

    loadQuestions();
}

function showAddQuestion(type) {
    editingQuestion = null;
    showQuestionEditor(type);
}

function editQuestion(id) {
    editingQuestion = cachedData.questions.find(q => q.id === id);
    showQuestionEditor(editingQuestion.type);
}

function showQuestionEditor(type) {
    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const q = editingQuestion || { category: CATEGORIES[0], content: '', options: type === 'judge' ? ['正确', '错误'] : ['', '', '', ''], answer: 'A' };

    let optionsHtml = '';
    if (type === 'judge') {
        const currentAnswer = (q.answer === 'true' || q.answer === true) ? 'A' : (q.answer === 'false' || q.answer === false) ? 'B' : q.answer;
        optionsHtml = `<div class="form-group"><label class="form-label">选项</label>
      <div class="option-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:24px;font-weight:bold;">A.</span><input type="text" class="form-input" value="正确" disabled style="background:var(--bg-input);margin:0;"></div>
      <div class="option-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:24px;font-weight:bold;">B.</span><input type="text" class="form-input" value="错误" disabled style="background:var(--bg-input);margin:0;"></div>
      </div>
      <div class="form-group"><label class="form-label">正确答案</label>
      <select class="form-select" id="q-answer">
        <option value="A" ${currentAnswer === 'A' ? 'selected' : ''}>A</option>
        <option value="B" ${currentAnswer === 'B' ? 'selected' : ''}>B</option>
      </select></div>`;
    } else {
        const opts = q.options || ['', '', '', ''];
        optionsHtml = `<div class="form-group"><label class="form-label">选项</label><div id="options-container">
      ${opts.map((o, i) => `<div class="option-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="width:24px;font-weight:bold;">${'ABCDEFGH'[i]}.</span>
        <input type="text" class="form-input" value="${o}" placeholder="选项内容" style="margin:0;">
        <button class="btn btn-sm btn-danger" onclick="removeOption(this)" ${opts.length <= 2 ? 'disabled' : ''}>删除</button>
      </div>`).join('')}</div>
      <div class="add-option-btn" onclick="addOption()" style="color:var(--primary);cursor:pointer;font-size:14px;font-weight:500;margin-top:8px;">+ 添加选项</div></div>
      <div class="form-group"><label class="form-label">正确答案 ${type === 'multiple' ? '(多选用逗号分隔，如A,C)' : ''}</label>
        <input type="text" class="form-input" id="q-answer" value="${Array.isArray(q.answer) ? q.answer.join(',') : q.answer}" placeholder="${type === 'multiple' ? '如：A,C' : '如：A'}"></div>`;
    }

    const editorInnerHtml = `
      <div class="form-group"><label class="form-label">专业</label>
        <select class="form-select" id="q-category">${CATEGORIES.map(c => `<option value="${c}" ${c === q.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">题目</label>
        <textarea class="form-input" id="q-content" rows="3" placeholder="请输入题目内容">${q.content}</textarea></div>
      ${optionsHtml}`;

    if (editingQuestion) {
        // 编辑模式使用弹窗
        const footerHtml = `
          <button class="btn btn-success" onclick="saveQuestion('${type}')">保存</button>
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>`;
        openModal(`${editingQuestion ? '编辑' : '新增'}${typeNames[type]}`, editorInnerHtml, footerHtml);
    } else {
        // 新增模式使用页面顶部内嵌卡片
        const editorContainer = document.getElementById('question-editor');
        editorContainer.innerHTML = `
          <div class="card" style="margin-bottom:24px;">
            <div class="card-header"><span class="card-title">新增${typeNames[type]}</span></div>
            <div class="card-body">
              ${editorInnerHtml}
              <div class="flex gap-3" style="margin-top:20px;">
                <button class="btn btn-success" onclick="saveQuestion('${type}')">保存</button>
                <button class="btn btn-secondary" onclick="cancelQuestionEdit()">取消</button>
              </div>
            </div>
          </div>`;
        editorContainer.classList.remove('hidden');
        editorContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

function addOption() {
    const container = document.getElementById('options-container');
    const count = container.children.length;
    if (count >= 8) return;
    const label = 'ABCDEFGH'[count];
    container.insertAdjacentHTML('beforeend', `<div class="option-row" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="width:24px;font-weight:bold;">${label}.</span>
        <input type="text" class="form-input" placeholder="选项内容" style="margin:0;">
        <button class="btn btn-sm btn-danger" onclick="removeOption(this)">删除</button>
    </div>`);
    updateOptionLabels();
}

function removeOption(btn) {
    btn.closest('.option-row').remove();
    updateOptionLabels();
}

function updateOptionLabels() {
    document.querySelectorAll('#options-container .option-row').forEach((row, i) => {
        row.querySelector('span').textContent = 'ABCDEFGH'[i] + '.';
        row.querySelector('.btn-danger').disabled = document.querySelectorAll('#options-container .option-row').length <= 2;
    });
}

async function saveQuestion(type) {
    const category = document.getElementById('q-category').value;
    const content = document.getElementById('q-content').value.trim();
    let options = [], answer;

    if (type === 'judge') {
        options = ['正确', '错误'];
        answer = document.getElementById('q-answer').value;
    } else {
        document.querySelectorAll('#options-container .option-row input').forEach(input => options.push(input.value.trim()));
        const answerVal = document.getElementById('q-answer').value.toUpperCase().trim();
        answer = type === 'multiple' ? answerVal.split(',').map(a => a.trim()) : answerVal;
    }

    if (!content) { alert('请输入题目内容'); return; }

    const question = { type, category, content, options, answer };
    if (editingQuestion) {
        await Storage.updateQuestion({ ...question, id: editingQuestion.id });
    } else {
        await Storage.addQuestion(question);
    }
    cancelQuestionEdit();
    await refreshCache();
    loadQuestions();
}

function cancelQuestionEdit() {
    editingQuestion = null;
    closeModal(); // 尝试关闭弹窗
    const editor = document.getElementById('question-editor');
    if (editor) editor.classList.add('hidden'); // 隐藏内嵌编辑器
}

async function deleteQuestion(id) {
    if (confirm('确定删除此题目？')) {
        await Storage.deleteQuestion(id);
        await refreshCache();
        loadQuestions();
    }
}

// ========== 试卷管理 ==========
let paperRules = [];
let rulesValidated = false;
let selectedQuestions = {};

function loadPaperGroups() { }

function loadPapers() {
    const papers = cachedData.papers;
    const groups = cachedData.groups;
    const html = papers.length ? `<table class="data-table"><thead><tr><th>试卷名称</th><th>创建日期</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${papers.map(p => `<tr><td>${p.name}</td><td>${p.publishDate || p.createDate || '-'}</td>
      <td>${p.published ? `<span class="badge badge-success">已推送</span>` : `<span class="badge badge-warning">未推送</span>`}</td>
      <td>
        ${!p.published ? `<button class="btn btn-sm btn-primary" onclick="showPublishModal('${p.id}')">推送</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="deletePaper('${p.id}')">删除</button>
      </td></tr>`).join('')}</tbody></table>` : '<p class="text-muted">暂无试卷</p>';
    document.getElementById('papers-list').innerHTML = html;
}

function showPaperEditor() {
    document.getElementById('btn-create-paper').classList.add('hidden');
    document.getElementById('paper-editor').classList.remove('hidden');
    document.getElementById('paper-name').value = '';
    paperRules = [];
    rulesValidated = false;
    selectedQuestions = {};
    updateRulesTable();
    disableGenerateButtons();
    document.getElementById('manual-select-area').classList.add('hidden');
}

function cancelPaperEdit() {
    document.getElementById('btn-create-paper').classList.remove('hidden');
    document.getElementById('paper-editor').classList.add('hidden');
    paperRules = [];
    rulesValidated = false;
}

function addRuleRow() {
    const usedTypes = paperRules.map(r => r.type);
    const allTypes = ['single', 'multiple', 'judge'];
    const availableTypes = allTypes.filter(t => !usedTypes.includes(t));

    if (availableTypes.length === 0) {
        alert('所有题型已添加');
        return;
    }

    const newType = availableTypes[0];
    const defaults = {
        single: { count: 10, score: 2, timeLimit: 15 },
        multiple: { count: 5, score: 4, timeLimit: 30 },
        judge: { count: 10, score: 2, timeLimit: 20 }
    };

    const id = Date.now();
    paperRules.push({
        id,
        type: newType,
        count: defaults[newType].count,
        score: defaults[newType].score,
        partialScore: 0,
        timeLimit: defaults[newType].timeLimit
    });
    updateRulesTable();
    rulesValidated = false;
    disableGenerateButtons();
}

function updateRulesTable() {
    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const tbody = document.getElementById('rules-body');
    const usedTypes = paperRules.map(r => r.type);

    tbody.innerHTML = paperRules.map((rule, idx) => {
        const availableForThis = ['single', 'multiple', 'judge'].filter(t =>
            t === rule.type || !usedTypes.includes(t)
        );

        return `
        <tr data-id="${rule.id}">
            <td style="text-align:center;">
                <select class="form-select" style="width:120px;" onchange="updateRule(${rule.id}, 'type', this.value)">
                    ${availableForThis.map(t => `<option value="${t}" ${rule.type === t ? 'selected' : ''}>${typeNames[t]}</option>`).join('')}
                </select>
            </td>
            <td style="text-align:center;"><input type="number" class="form-input" style="width:70px;text-align:center;" value="${rule.count}" min="1" onchange="updateRule(${rule.id}, 'count', this.value)"></td>
            <td style="text-align:center;"><input type="number" class="form-input" style="width:70px;text-align:center;" value="${rule.score}" min="1" onchange="updateRule(${rule.id}, 'score', this.value)"></td>
            <td style="text-align:center;">${rule.type === 'multiple'
                ? `<input type="number" class="form-input" style="width:70px;text-align:center;" value="${rule.partialScore}" min="0" max="${rule.score}" onchange="updateRule(${rule.id}, 'partialScore', this.value)">`
                : '<span class="text-muted">-</span>'}</td>
            <td style="text-align:center;"><input type="number" class="form-input" style="width:70px;text-align:center;" value="${rule.timeLimit}" min="5" onchange="updateRule(${rule.id}, 'timeLimit', this.value)"></td>
            <td style="text-align:center;">${rule.count * rule.score}</td>
            <td style="text-align:center;"><button class="btn btn-sm btn-danger" onclick="removeRule(${rule.id})">删除</button></td>
        </tr>
    `}).join('');

    const addBtn = document.getElementById('btn-add-rule');
    if (addBtn) {
        const availableTypes = ['single', 'multiple', 'judge'].filter(t => !usedTypes.includes(t));
        if (availableTypes.length === 0) {
            addBtn.style.display = 'none';
        } else {
            addBtn.style.display = '';
            addBtn.textContent = '+ 添加题型';
        }
    }

    calculateTotalScore();
}

function updateRule(id, field, value) {
    const rule = paperRules.find(r => r.id === id);
    if (rule) {
        if (field === 'type') {
            rule[field] = value;
            if (value !== 'multiple') rule.partialScore = 0;
        } else {
            rule[field] = parseInt(value) || 0;
            if (field === 'score' && rule.partialScore > rule.score) {
                rule.partialScore = rule.score;
            }
        }
        updateRulesTable();
        rulesValidated = false;
        disableGenerateButtons();
    }
}

function removeRule(id) {
    paperRules = paperRules.filter(r => r.id !== id);
    updateRulesTable();
    rulesValidated = false;
    disableGenerateButtons();
}

function calculateTotalScore() {
    const total = paperRules.reduce((sum, r) => sum + r.count * r.score, 0);
    document.getElementById('total-score').textContent = total;
    return total;
}

function disableGenerateButtons() {
    document.getElementById('btn-manual-select').disabled = true;
    document.getElementById('btn-auto-generate').disabled = true;
}

function enableGenerateButtons() {
    document.getElementById('btn-manual-select').disabled = false;
    document.getElementById('btn-auto-generate').disabled = false;
}

function validateRules() {
    const name = document.getElementById('paper-name').value.trim();
    if (!name) { alert('请输入试卷名称'); return; }
    if (paperRules.length === 0) { alert('请至少添加一个题型规则'); return; }

    const total = calculateTotalScore();
    if (total !== 100) {
        alert('总分需等于100分，当前总分：' + total + '分');
        return;
    }

    const questions = cachedData.questions;
    for (const rule of paperRules) {
        const available = questions.filter(q => q.type === rule.type).length;
        if (available < rule.count) {
            const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
            alert(typeNames[rule.type] + '数量不足！需要' + rule.count + '题，题库仅有' + available + '题');
            return;
        }
    }

    rulesValidated = true;
    enableGenerateButtons();
    alert('校验成功！请选择"手动选择题目"或"自动生成题目"');
}

function showManualSelect() {
    if (!rulesValidated) { alert('请先校验试卷规则'); return; }

    selectedQuestions = {};
    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };

    let html = '<div class="flex gap-3 mb-4">';
    paperRules.forEach(rule => {
        selectedQuestions[rule.type] = [];
        html += `<button class="btn btn-secondary" onclick="showQuestionSelector('${rule.type}', ${rule.count})">
            ${typeNames[rule.type]} (已选 <span id="selected-count-${rule.type}">0</span>/${rule.count})
        </button>`;
    });
    html += '</div>';
    html += '<div id="question-selector-area"></div>';

    document.getElementById('manual-select-content').innerHTML = html;
    document.getElementById('manual-select-area').classList.remove('hidden');
}

function showQuestionSelector(type, maxCount) {
    const questions = cachedData.questions.filter(q => q.type === type);
    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const selected = selectedQuestions[type] || [];

    let html = `<h4 class="mb-4">选择${typeNames[type]} (最多${maxCount}题)</h4>
    <div class="table-container"><table class="data-table">
    <thead><tr><th style="width:50px;">选择</th><th>专业</th><th>题目</th></tr></thead>
    <tbody>${questions.map(q => `
        <tr>
            <td><input type="checkbox" ${selected.includes(q.id) ? 'checked' : ''} 
                onchange="toggleQuestion('${type}', '${q.id}', ${maxCount}, this.checked)"></td>
            <td>${q.category || '-'}</td>
            <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${q.content}</td>
        </tr>`).join('')}</tbody></table></div>`;

    document.getElementById('question-selector-area').innerHTML = html;
}

function toggleQuestion(type, questionId, maxCount, checked) {
    if (!selectedQuestions[type]) selectedQuestions[type] = [];

    if (checked) {
        if (selectedQuestions[type].length >= maxCount) {
            alert(`该题型最多选择${maxCount}题`);
            event.target.checked = false;
            return;
        }
        selectedQuestions[type].push(questionId);
    } else {
        selectedQuestions[type] = selectedQuestions[type].filter(id => id !== questionId);
    }

    document.getElementById(`selected-count-${type}`).textContent = selectedQuestions[type].length;
}

async function generatePaperFromSelection() {
    const name = document.getElementById('paper-name').value.trim();

    for (const rule of paperRules) {
        const count = (selectedQuestions[rule.type] || []).length;
        if (count !== rule.count) {
            const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
            alert(`${typeNames[rule.type]}需要选择${rule.count}题，当前已选${count}题`);
            return;
        }
    }

    const paper = {
        name,
        rules: paperRules,
        questions: selectedQuestions,
        published: false
    };

    await Storage.addPaper(paper);
    alert('试卷创建成功！');
    cancelPaperEdit();
    await refreshCache();
    loadPapers();
}

async function autoGeneratePaper() {
    if (!rulesValidated) { alert('请先校验试卷规则'); return; }

    const name = document.getElementById('paper-name').value.trim();
    const questions = cachedData.questions;
    const generatedQuestions = {};

    for (const rule of paperRules) {
        const pool = questions.filter(q => q.type === rule.type);
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        generatedQuestions[rule.type] = shuffled.slice(0, rule.count).map(q => q.id);
    }

    const paper = {
        name,
        rules: paperRules,
        questions: generatedQuestions,
        published: false
    };

    await Storage.addPaper(paper);
    alert('试卷自动生成成功！');
    cancelPaperEdit();
    await refreshCache();
    loadPapers();
}

function showPublishModal(paperId) {
    const groups = cachedData.groups;
    openModal('推送试卷',
        `<div class="form-group"><label class="form-label">目标分组</label>
         <select class="form-select" id="publish-groups" multiple style="height:120px;">
           ${groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
         </select></div>
         <div class="form-group"><label class="form-label">截止日期</label>
           <input type="date" class="form-input" id="publish-deadline"></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">取消</button>
         <button class="btn btn-primary" onclick="publishPaper('${paperId}')">确认推送</button>`);
}

async function publishPaper(paperId) {
    const select = document.getElementById('publish-groups');
    const targetGroups = Array.from(select.selectedOptions).map(o => o.value);
    const deadline = document.getElementById('publish-deadline').value;

    if (!targetGroups.length || !deadline) { alert('请选择分组和截止日期'); return; }

    await Storage.publishPaper(paperId, targetGroups, deadline);
    closeModal();
    await refreshCache();
    loadPapers();
    alert('试卷推送成功！');
}

async function deletePaper(id) {
    if (confirm('确定删除此试卷？')) {
        await Storage.deletePaper(id);
        await refreshCache();
        loadPapers();
    }
}

// ========== 管理员排行榜 ==========
function loadAdminRankingOptions() {
    const papers = cachedData.papers;
    document.getElementById('admin-ranking-select').innerHTML = '<option value="">请选择试卷</option>' +
        papers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

async function loadAdminRanking(paperId) {
    const data = await Storage.getRanking(paperId);
    const container = document.getElementById('admin-ranking-content');

    const ranking = data.ranking || [];
    const totalAssigned = data.totalAssigned || ranking.length || 0;

    if (!ranking.length) {
        container.innerHTML = '<div class="empty-state"><h3>暂无考试记录</h3></div>';
        return;
    }

    const formatTime = (s) => `${Math.floor(s / 60)}分${s % 60}秒`;
    container.innerHTML = `<table class="data-table"><thead><tr><th>排名</th><th>答题用户</th><th>得分</th><th>用时</th></tr></thead>
    <tbody>${ranking.map(r => `<tr><td>${r.rank <= 3 ? `<span class="rank-badge rank-${r.rank}">${r.rank}</span>` : `${r.rank}/${totalAssigned}`}</td>
      <td>${r.username}</td><td><strong>${r.score}</strong></td><td>${formatTime(r.totalTime)}</td></tr>`).join('')}</tbody></table>`;
}


// ========== 导入导出功能 ==========
function exportQuestions() {
    const questions = cachedData.questions;
    const types = { 'single': '单选题', 'multiple': '多选题', 'judge': '判断题' };
    const wb = XLSX.utils.book_new();

    ['single', 'multiple', 'judge'].forEach(type => {
        const typeName = types[type];
        const data = questions.filter(q => q.type === type).map(q => {
            const row = {
                '专业': q.category,
                '题目': q.content,
                '正确答案': Array.isArray(q.answer) ? q.answer.join(',') :
                    (type === 'judge' ? (q.answer === 'true' ? 'A' : 'B') : q.answer)
            };

            // Judge type: force display options
            const opts = (type === 'judge') ? ['正确', '错误'] : (q.options || []);
            opts.forEach((opt, idx) => {
                const label = '选项' + String.fromCharCode(65 + idx);
                row[label] = opt;
            });
            return row;
        });

        if (data.length > 0) {
            // Calculate max cols
            let maxOptions = 0;
            data.forEach(r => {
                const keys = Object.keys(r).filter(k => k.startsWith('选项'));
                maxOptions = Math.max(maxOptions, keys.length);
            });

            // Ensure headers
            const header = ['专业', '题目', '正确答案'];
            for (let i = 0; i < maxOptions; i++) {
                header.push('选项' + String.fromCharCode(65 + i));
            }

            const ws = XLSX.utils.json_to_sheet(data, { header });
            XLSX.utils.book_append_sheet(wb, ws, typeName);
        } else {
            // Create empty sheet with header
            const ws = XLSX.utils.json_to_sheet([], { header: ['专业', '题目', '正确答案', '选项A', '选项B'] });
            XLSX.utils.book_append_sheet(wb, ws, typeName);
        }
    });

    XLSX.writeFile(wb, `题库导出_${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}.xlsx`);
}

async function importQuestions(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = async function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });

            const typeMap = { '单选题': 'single', '多选题': 'multiple', '判断题': 'judge' };
            let newQuestions = [];
            let errorMsg = '';

            for (const [sheetName, typeAlias] of Object.entries(typeMap)) {
                if (!wb.SheetNames.includes(sheetName)) {
                    continue;
                }

                const ws = wb.Sheets[sheetName];
                // header:1 returns array of arrays
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                if (rows.length < 2) continue;

                const header = rows[0];
                const getColIdx = (name) => header.indexOf(name);
                const idxCategory = getColIdx('专业');
                const idxContent = getColIdx('题目');
                const idxAnswer = getColIdx('正确答案');

                if (idxCategory === -1 || idxContent === -1 || idxAnswer === -1) {
                    errorMsg += `工作表"${sheetName}"缺少必要列字段(专业、题目、正确答案)\n`;
                    continue;
                }

                const optionIndices = [];
                header.forEach((h, i) => {
                    if (h && typeof h === 'string' && h.startsWith('选项')) {
                        optionIndices.push({ index: i, label: h });
                    }
                });
                optionIndices.sort((a, b) => a.label.localeCompare(b.label));

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    // Skip empty rows
                    if (!row || row.length === 0) continue;

                    const category = row[idxCategory];
                    const content = row[idxContent];
                    const answerRaw = row[idxAnswer];

                    if (!category || !content || answerRaw === undefined) {
                        // Skip rows that might be calculated as empty but have some format
                        if (!category && !content && !answerRaw) continue;
                        errorMsg += `工作表"${sheetName}"第${i + 1}行缺少必要信息\n`;
                        continue;
                    }

                    let options = [];
                    if (typeAlias === 'judge') {
                        options = ['正确', '错误'];
                    } else {
                        optionIndices.forEach(opt => {
                            const val = row[opt.index];
                            if (val !== undefined && val !== null && String(val).trim() !== '') {
                                options.push(String(val).trim());
                            }
                        });
                    }

                    // Parse Answer
                    let answer = String(answerRaw).trim();
                    if (typeAlias === 'multiple') {
                        answer = answer.replace(/，/g, ',').split(',').map(s => s.trim().toUpperCase());
                    } else if (typeAlias === 'judge') {
                        // Map A/正确 -> true, B/错误 -> false
                        if (['A', '正确', 'TRUE', 'T'].includes(answer.toUpperCase())) answer = 'true';
                        else if (['B', '错误', 'FALSE', 'F'].includes(answer.toUpperCase())) answer = 'false';
                        else answer = 'true'; // Default? Or Error. Let's default true but maybe safer to flag.
                    } else {
                        answer = answer.toUpperCase();
                    }

                    newQuestions.push({
                        type: typeAlias,
                        category: String(category).trim(),
                        content: String(content).trim(),
                        options: options,
                        answer: answer
                    });
                }
            }

            if (errorMsg) {
                alert('校验发现以下问题：\n' + errorMsg + '\n请修正后重试。');
                input.value = '';
                return;
            }

            if (newQuestions.length === 0) {
                alert('未从文件中读取到有效题目。请检查Sheet名称是否为(单选题, 多选题, 判断题)。');
                input.value = '';
                return;
            }

            if (confirm(`解析成功，共${newQuestions.length}道题。是否确认导入？`)) {
                let successCount = 0;
                for (const q of newQuestions) {
                    try {
                        await Storage.addQuestion(q);
                        successCount++;
                    } catch (err) {
                        console.error('Add question failed', err);
                    }
                }
                alert(`导入完成，成功导入 ${successCount} 道题目`);
                input.value = '';
                await refreshCache();
                loadQuestions();
            } else {
                input.value = '';
            }

        } catch (e) {
            console.error(e);
            alert('读取文件失败，请检查文件格式');
            input.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function handleImportClick() {
    alert('请导出题库进行备份');
    document.getElementById('file-import').click();
}

// ========== 考试分析 ==========
function loadAdminAnalysisOptions() {
    const papers = cachedData.papers.filter(p => p.published);
    document.getElementById('analysis-paper-select').innerHTML = '<option value="">请选择要分析的试卷</option>' +
        papers.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    document.getElementById('analysis-content').innerHTML = '<div class="empty-state"><p>请选择试卷以生成分析报告</p></div>';
    document.getElementById('btn-clear-records').style.display = 'none';
}

async function loadAdminAnalysis(paperId) {
    const data = await Storage.getRanking(paperId);
    const ranking = data.ranking || [];
    const totalAssigned = data.totalAssigned || 0;
    const takenCount = ranking.length;
    const notTakenCount = Math.max(0, totalAssigned - takenCount);

    if (takenCount === 0) {
        document.getElementById('analysis-content').innerHTML = `
            <div class="empty-state">
                <p>该试卷暂无考试记录。推送总人数：${totalAssigned}</p>
            </div>`;
        document.getElementById('btn-clear-records').style.display = 'none';
        return;
    }

    // 计算统计数据
    const scores = ranking.map(r => r.score);
    const times = ranking.map(r => r.totalTime);

    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const avgScore = (scores.reduce((a, b) => a + b, 0) / takenCount).toFixed(1);

    const fastestTime = Math.min(...times);
    const slowestTime = Math.max(...times);

    const formatTime = (s) => `${Math.floor(s / 60)}分${s % 60}秒`;

    const html = `
    <div class="analysis-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:20px;">
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">需考试人数</div>
            <div style="font-size:24px;font-weight:700;color:var(--text-primary);">${totalAssigned}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">已考试人数</div>
            <div style="font-size:24px;font-weight:700;color:var(--success);">${takenCount}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">未考试人数</div>
            <div style="font-size:24px;font-weight:700;color:var(--warning);">${notTakenCount}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">最高分</div>
            <div style="font-size:24px;font-weight:700;color:var(--primary);">${maxScore}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">最低分</div>
            <div style="font-size:24px;font-weight:700;color:var(--danger);">${minScore}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">平均分</div>
            <div style="font-size:24px;font-weight:700;color:var(--text-primary);">${avgScore}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">最快答题时间</div>
            <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${formatTime(fastestTime)}</div>
        </div>
        <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
            <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">最慢答题时间</div>
            <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${formatTime(slowestTime)}</div>
        </div>
    </div>`;

    document.getElementById('analysis-content').innerHTML = html;
    document.getElementById('btn-clear-records').style.display = 'block';
}

async function clearPaperRecords() {
    const paperId = document.getElementById('analysis-paper-select').value;
    if (!paperId) return;

    if (confirm('确定要清空该试卷的所有考试记录吗？此操作不可撤销，且会同时清空得分及排行榜统计。')) {
        await Storage.deletePaperRecords(paperId);
        alert('记录已清空');
        loadAdminAnalysis(paperId);
    }
}
