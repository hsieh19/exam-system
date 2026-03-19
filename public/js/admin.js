let editingQuestion = null;
let editingUserId = null; // 新增：用于标记当前正在编辑的用户
let selectedGroupId = null; // 当前选中的分组ID
let cachedData = { groups: [], users: [], questions: [], papers: [], categories: [] };
let groupAccordionOpen = true;
let currentPage = 'users';
let autoRefreshTimer = null;
let isRefreshing = false;

// ========== 版本控制 ==========
const AppConfig = {
    version: '1.5.6', // 当前版本
    githubRepo: 'hsieh19/exam-system' // GitHub 仓库
};

document.addEventListener('DOMContentLoaded', async function () {
    const user = Auth.checkAdmin();
    if (user) {
        Auth.updateUserInfo();
        initNavigation();
        checkPermissions();
        checkVersion(); // 检查版本
        await refreshCache();
        loadGroups();
        loadUsers();
        ensureQuestionsFab();
        updateQuestionFabVisibility();
        startAutoRefresh();
        window.addEventListener('focus', () => { if (document.visibilityState === 'visible') refreshActivePage(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshActivePage(); });
        initRealtime();
    }
});

function checkPermissions() {
    const user = Storage.getCurrentUser();
    if (user && user.role !== 'super_admin') {
        // 隐藏数据库设置
        const dbNavItem = document.querySelector('.nav-item[data-page="database"]');
        if (dbNavItem) dbNavItem.style.display = 'none';

        // 隐藏系统日志
        const logsNavItem = document.querySelector('.nav-item[data-page="logs"]');
        if (logsNavItem) logsNavItem.style.display = 'none';

        // 隐藏“设置专业”按钮
        const categoryBtn = document.querySelector('button[onclick="showCategorySettings()"]');
        if (categoryBtn) categoryBtn.style.display = 'none';

        // 分组管理按钮逻辑在 loadGroups 处理
    }
}

async function refreshCache() {
    cachedData.groups = await Storage.getGroups();
    cachedData.users = await Storage.getUsers();
    cachedData.questions = await Storage.getQuestions();
    cachedData.papers = await Storage.getPapers();
    cachedData.categories = await Storage.getCategories();
}

// 防止重复请求
let isNavigating = false;

function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
            refreshActivePage();
        }
    }, 5000);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

async function refreshActivePage() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
        await refreshCache();
        if (currentPage === 'users') { loadGroups(); loadUsers(); }
        else if (currentPage === 'questions') loadQuestions();
        else if (currentPage === 'papers') { loadPaperGroups(); loadPapers(); }
        else if (currentPage === 'logs') {
            loadSystemLogs(currentLogPage);
        }
    } finally {
        isRefreshing = false;
    }
}

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', async function () {
            if (this.classList.contains('active') || isNavigating) return;

            isNavigating = true;
            try {
                const page = this.dataset.page;
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                this.classList.add('active');
                document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
                document.getElementById(`page-${page}`).classList.remove('hidden');
                updateQuestionFabVisibility();
                currentPage = page;

                // 简单的防抖/节流：如果是快速切换，可能不需要每次都 refreshCache
                // 但为了数据实时性，这里每次请求。结合后端的 304 缓存，其实开销很小。
                // 重点是避免同一瞬间发两次。
                await refreshCache();
                if (page === 'users') { loadGroups(); loadUsers(); }
                else if (page === 'questions') loadQuestions();
                else if (page === 'papers') { loadPaperGroups(); loadPapers(); }
                else if (page === 'ranking') loadAdminRankingOptions();
                else if (page === 'analysis') loadAdminAnalysisOptions();
                else if (page === 'database') loadDbConfig();
                else if (page === 'logs') {
                    currentLogPage = 1;
                    initLogFilterOptions();
                    loadSystemLogs(1);
                }
                startAutoRefresh();
            } finally {
                isNavigating = false;
            }
        });
    });

    document.getElementById('admin-ranking-select').addEventListener('change', function () {
        if (this.value) loadAdminRanking(this.value);
    });

    document.getElementById('analysis-paper-select').addEventListener('change', function () {
        if (this.value) loadAdminAnalysis(this.value);
        else {
            document.getElementById('analysis-content').innerHTML = '<div class="empty-state"><h3>请选择试卷以生成分析报告</h3></div>';
            document.getElementById('btn-clear-records').style.display = 'none';
            const qaBtn = document.getElementById('btn-question-analysis');
            if (qaBtn) qaBtn.style.display = 'none';
        }
    });
}

let questionsFabRoot = null;

let es = null;
function initRealtime() {
    try {
        const token = SafeStorage.get('auth_token');
        if (!token) return;
        if (es) { es.close(); es = null; }
        es = new EventSource(`/events?token=${encodeURIComponent(token)}`);
        es.addEventListener('db_change', () => {
            refreshActivePage();
        });
    } catch (e) { }
}

function ensureQuestionsFab() {
    if (questionsFabRoot) return;
    questionsFabRoot = document.createElement('div');
    questionsFabRoot.className = 'questions-fab-root';
    questionsFabRoot.innerHTML = `
        <div class="questions-fab-menu" role="menu" aria-label="题库操作">
            <button type="button" class="questions-fab-item questions-fab-item--entry" data-action="add-single">录入单选题</button>
            <button type="button" class="questions-fab-item questions-fab-item--entry" data-action="add-multiple">录入多选题</button>
            <button type="button" class="questions-fab-item questions-fab-item--entry" data-action="add-judge">录入判断题</button>
            <button type="button" class="questions-fab-item questions-fab-item--settings" data-action="category">设置专业</button>
            <button type="button" class="questions-fab-item questions-fab-item--data" data-action="import">导入题库</button>
            <button type="button" class="questions-fab-item questions-fab-item--data" data-action="export">导出题库</button>
        </div>
        <button type="button" class="questions-fab" aria-label="题库操作">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        </button>
    `;
    document.body.appendChild(questionsFabRoot);

    const fabBtn = questionsFabRoot.querySelector('.questions-fab');
    fabBtn?.addEventListener('click', () => {
        questionsFabRoot.classList.toggle('open');
    });

    questionsFabRoot.addEventListener('click', (e) => {
        const btn = e.target.closest?.('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        questionsFabRoot.classList.remove('open');

        if (action === 'add-single') showAddQuestion('single');
        else if (action === 'add-multiple') showAddQuestion('multiple');
        else if (action === 'add-judge') showAddQuestion('judge');
        else if (action === 'category') showCategorySettings();
        else if (action === 'import') handleImportClick();
        else if (action === 'export') exportQuestions();
    });

    document.addEventListener('click', (e) => {
        if (!questionsFabRoot) return;
        if (questionsFabRoot.classList.contains('open') && !questionsFabRoot.contains(e.target)) {
            questionsFabRoot.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (!questionsFabRoot) return;
        if (e.key === 'Escape') questionsFabRoot.classList.remove('open');
    });

    window.addEventListener('resize', () => {
        updateQuestionFabVisibility();
    });
}

function updateQuestionFabVisibility() {
    if (!questionsFabRoot) return;
    const questionsPage = document.getElementById('page-questions');
    const isQuestionsActive = !!questionsPage && !questionsPage.classList.contains('hidden');
    const isMobile = window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : (window.innerWidth <= 768);
    if (isQuestionsActive && isMobile) questionsFabRoot.classList.add('visible');
    else {
        questionsFabRoot.classList.remove('visible');
        questionsFabRoot.classList.remove('open');
    }
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
    const user = Storage.getCurrentUser();
    let groups = cachedData.groups;

    // 分组管理员只能看自己组
    if (user.role === 'group_admin') {
        groups = groups.filter(g => g.id === user.groupId);
        // 如果当前没有选中，自动选中自己组
        if (!selectedGroupId && groups.length > 0) {
            selectedGroupId = groups[0].id;
        }
    }

    const listHtml = `
        <div id="group-accordion-content" class="group-accordion-content">
            <div class="group-list" style="display:flex; flex-direction:column; gap:0;">
                ${groups.length ? '' : '<div style="padding:15px;text-align:center;color:var(--text-muted);">暂无分组</div>'}
                ${groups.map(g => {
        const isActive = selectedGroupId === g.id;
        const activeStyle = isActive ? 'background-color: rgba(37, 99, 235, 0.1); border-left: 3px solid var(--primary);' : 'border-left: 3px solid transparent;';

        // 只有超管可以编辑和删除分组
        const editBtn = user.role === 'super_admin' ?
            `<button class="btn btn-sm btn-primary" style="margin-right: 5px;" data-id="${g.id}" data-name="${g.name}" onclick="event.stopPropagation();safeOnclick(this, 'showEditGroup', ['id', 'name'])">编辑</button>` : '';
        const deleteBtn = user.role === 'super_admin' ?
            `<button class="btn btn-sm btn-danger" data-id="${g.id}" onclick="event.stopPropagation();safeOnclick(this, 'deleteGroup', ['id'])">删除</button>` : '';

        return `
                    <div class="group-item" data-id="${g.id}" onclick="safeOnclick(this, 'selectGroup', ['id'])" 
                         style="padding:12px 15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); ${activeStyle} min-width: 0;">
                        <span style="font-weight:${isActive ? '600' : '400'}; color:${isActive ? 'var(--primary)' : 'inherit'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; margin-right: 12px;">${escapeHtml(g.name)}</span>
                        <div style="display: flex; align-items: center; flex-shrink: 0;">
                            ${editBtn}
                            ${deleteBtn}
                        </div>
                    </div>
                    `;
    }).join('')}
            </div>
        </div>
    `;

    document.getElementById('groups-list').innerHTML = listHtml;
    const content = document.getElementById('group-accordion-content');
    if (content) {
        content.style.maxHeight = groupAccordionOpen ? (content.scrollHeight + 'px') : '0px';
        content.dataset.open = groupAccordionOpen ? 'true' : 'false';
    }
    const badge = document.getElementById('groups-count-badge');
    if (badge) {
        badge.textContent = `${groups.length}个分组`;
        badge.style.display = groupAccordionOpen ? 'none' : 'inline-flex';
    }
    const header = document.getElementById('group-accordion-header');
    const icon = header ? header.querySelector('.chevron-icon') : null;
    if (icon) {
        icon.style.transform = groupAccordionOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
    }

    // 只有超管可以添加分组
    const addGroupBtn = document.querySelector('button[onclick="showAddGroup()"]');
    if (addGroupBtn) addGroupBtn.style.display = user.role === 'super_admin' ? 'block' : 'none';
}

function toggleGroupAccordion() {
    const content = document.getElementById('group-accordion-content');
    const header = document.getElementById('group-accordion-header');
    const icon = header ? header.querySelector('.chevron-icon') : null;
    const badge = document.getElementById('groups-count-badge');
    if (!content) return;
    const isOpen = content.dataset.open === 'true';
    if (isOpen) {
        content.style.maxHeight = '0px';
        content.dataset.open = 'false';
        groupAccordionOpen = false;
        if (icon) icon.style.transform = 'rotate(-90deg)';
        if (badge) badge.style.display = 'inline-flex';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        content.dataset.open = 'true';
        groupAccordionOpen = true;
        if (icon) icon.style.transform = 'rotate(0deg)';
        if (badge) badge.style.display = 'none';
    }
}

function selectGroup(id) {
    // 如果再次点击已选中的，取消选中？还是保持？
    // 用户需求是级联，通常保持。但为了能看“所有”，可以再次点击取消，或者有个“全部”按钮。
    // 这里实现：点击切换。如果想看全部，这里暂时没做“全部”选项，但可以视为 selectedGroupId = null 为全部。
    // 为了严格级联（必须先有分组），可能不需要“全部”视图，或者“全部”视图下禁止添加用户。
    // 让我们允许取消选中（Toggle）。

    if (selectedGroupId === id) {
        selectedGroupId = null; // 取消选中
    } else {
        selectedGroupId = id;
    }

    loadGroups(); // 刷新高亮
    loadUsers();  // 刷新用户
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

function showEditGroup(id, currentName) {
    openModal('编辑分组',
        `<div class="form-group"><label class="form-label">分组名称</label><input type="text" class="form-input" id="edit-group-name" value="${escapeHtml(currentName)}"></div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" data-id="${id}" onclick="safeOnclick(this, 'updateGroupName', ['id'])">更新</button>`);
}

async function updateGroupName(id) {
    const name = document.getElementById('edit-group-name').value.trim();
    if (name) {
        try {
            await Storage.updateGroup({ id, name });
            closeModal();
            await refreshCache();
            loadGroups();
            showToast('分组名称已更新');
        } catch (error) {
            console.error('Update group failed:', error);
            showToast('更新失败：' + error.message, 'error');
        }
    } else {
        showToast('请输入分组名称', 'warning');
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
    const currentUser = Storage.getCurrentUser();
    const isMobile = window.matchMedia ? window.matchMedia('(max-width: 768px)').matches : (window.innerWidth <= 768);
    const getGroupName = (gid) => {
        if (!gid) return '-';
        const ids = String(gid).split(',');
        return ids.map(id => groups.find(g => g.id === id)?.name || '-').join(', ');
    };

    // 优先处理搜索（全局搜索），若无搜索词则按分组过滤
    if (query) {
        users = users.filter(u => {
            const groupNameStr = getGroupName(u.groupId).toLowerCase();
            return u.username.toLowerCase().includes(query) || groupNameStr.includes(query);
        });
    } else if (selectedGroupId) {
        users = users.filter(u => {
            if (!u.groupId) return false;
            const ids = String(u.groupId).split(',');
            return ids.includes(selectedGroupId);
        });
    }

    const html = users.length ? (isMobile
        ? `<div class="user-cards">${users.map(u => {
            const isSuper = u.role === 'super_admin';
            const isGroupAdmin = u.role === 'group_admin';
            const nameStyle = (isSuper || isGroupAdmin) ? 'color: var(--primary); font-weight: bold;' : '';

            const roleBadge = isSuper ? '<span class="badge badge-primary" style="margin-left:5px;font-size:10px;">超管</span>' :
                isGroupAdmin ? '<span class="badge badge-warning" style="margin-left:5px;font-size:10px;">组管</span>' : '';

            const isSelf = currentUser && currentUser.id === u.id;

            // 权限判断
            const canManageRole = currentUser.role === 'super_admin' && !isSelf;
            const canEdit = currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && u.groupId === currentUser.groupId);
            const canDelete = !isSelf && (currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && u.groupId === currentUser.groupId && !isGroupAdmin));

            const actions = [];
            if (canManageRole) {
                actions.push(`<button class="btn btn-sm ${isGroupAdmin ? 'btn-danger' : 'btn-primary'}" data-id="${u.id}" data-role="group_admin" onclick="safeOnclick(this, 'toggleUserRole', ['id', 'role'])">${isGroupAdmin ? '取消组管' : '设为组管'}</button>`);
                actions.push(`<button class="btn btn-sm ${isSuper ? 'btn-danger' : 'btn-secondary'}" data-id="${u.id}" data-role="super_admin" onclick="safeOnclick(this, 'toggleUserRole', ['id', 'role'])">${isSuper ? '取消超管' : '设为超管'}</button>`);
            }
            if (canEdit) {
                actions.push(`<button class="btn btn-sm btn-secondary" data-id="${u.id}" onclick="safeOnclick(this, 'showEditUser', ['id'])">编辑</button>`);
            }
            if (canDelete) {
                actions.push(`<button class="btn btn-sm btn-danger" data-id="${u.id}" onclick="safeOnclick(this, 'deleteUser', ['id'])">删除</button>`);
            }

            const moreMenu = actions.length ? actions.map(a => `<div class="user-action-menu-item">${a}</div>`).join('') : `<div class="text-muted" style="padding:6px 10px;">无可用操作</div>`;
            const groupName = escapeHtml(getGroupName(u.groupId));

            return `
          <div class="user-card">
            <div class="user-card-header">
              <div class="user-name" style="${nameStyle}">${escapeHtml(u.username)} ${roleBadge}</div>
              <span class="user-group-tag">${groupName || '-'}</span>
            </div>
            <div class="user-card-actions">
              <div class="user-actions">${actions.join('') || '<span class="text-muted">无</span>'}</div>
            </div>
          </div>`;
        }).join('')}</div>`
        : `<div class="table-container"><table class="data-table"><thead><tr><th>用户名</th><th>分组</th><th class="user-actions-header" style="text-align: left; padding-left: 20px;">操作</th></tr></thead>
    <tbody>${users.map(u => {
            const isSuper = u.role === 'super_admin';
            const isGroupAdmin = u.role === 'group_admin';
            const nameStyle = (isSuper || isGroupAdmin) ? 'color: var(--primary); font-weight: bold;' : '';

            const roleBadge = isSuper ? '<span class="badge badge-primary" style="margin-left:5px;font-size:10px;">超管</span>' :
                isGroupAdmin ? '<span class="badge badge-warning" style="margin-left:5px;font-size:10px;">组管</span>' : '';

            const isSelf = currentUser && currentUser.id === u.id;

            // 权限判断
            const canManageRole = currentUser.role === 'super_admin' && !isSelf;
            const canEdit = currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && u.groupId === currentUser.groupId);
            const canDelete = !isSelf && (currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && u.groupId === currentUser.groupId && !isGroupAdmin));

            const actions = [];
            if (canManageRole) {
                actions.push(`<button class="btn btn-sm ${isGroupAdmin ? 'btn-danger' : 'btn-primary'}" data-id="${u.id}" data-role="group_admin" onclick="safeOnclick(this, 'toggleUserRole', ['id', 'role'])">${isGroupAdmin ? '取消组管' : '设为组管'}</button>`);
                actions.push(`<button class="btn btn-sm ${isSuper ? 'btn-danger' : 'btn-secondary'}" data-id="${u.id}" data-role="super_admin" onclick="safeOnclick(this, 'toggleUserRole', ['id', 'role'])">${isSuper ? '取消超管' : '设为超管'}</button>`);
            }
            if (canEdit) {
                actions.push(`<button class="btn btn-sm btn-secondary" data-id="${u.id}" onclick="safeOnclick(this, 'showEditUser', ['id'])">编辑</button>`);
            }
            if (canDelete) {
                actions.push(`<button class="btn btn-sm btn-danger" data-id="${u.id}" onclick="safeOnclick(this, 'deleteUser', ['id'])">删除</button>`);
            }

            if (isMobile) {
                const moreMenu = actions.length ? actions.map(a => `<div class="user-action-menu-item">${a}</div>`).join('') : `<div class="text-muted" style="padding:6px 10px;">无可用操作</div>`;
                return `<tr>
            <td style="${nameStyle}">
                ${escapeHtml(u.username)} 
                ${roleBadge}
                ${u.feishuUserId ? `<div style="font-size:10px; color:var(--text-muted); margin-top:2px; font-family:monospace;" title="飞书用户">ID: ${escapeHtml(u.feishuUserId)}</div>` : ''}
            </td>
            <td>${escapeHtml(getGroupName(u.groupId))}</td>
            <td class="text-center">
              <div class="user-actions">
                <div class="user-action-group" id="uag-${u.id}">
                  <button class="btn btn-sm btn-secondary user-action-more" data-id="${u.id}" onclick="safeOnclick(this, 'toggleUserActionMenu', ['id'])">⋯</button>
                  <div class="user-action-more-menu" id="uam-${u.id}">${moreMenu}</div>
                </div>
              </div>
            </td></tr>`;
            } else {
                const all = actions.join('');
                return `<tr>
            <td style="${nameStyle}">
                ${escapeHtml(u.username)} 
                ${roleBadge}
                ${u.feishuUserId ? `<div style="font-size:10px; color:var(--text-muted); margin-top:2px; font-family:monospace;" title="飞书用户">ID: ${escapeHtml(u.feishuUserId)}</div>` : ''}
            </td>
            <td>${escapeHtml(getGroupName(u.groupId))}</td>
            <td style="text-align: left; padding-left: 20px;"><div class="user-actions">${all || '<span class="text-muted">无</span>'}</div></td></tr>`;
            }
        }).join('')}</tbody></table></div>`) : '<p class="text-muted">暂无用户</p>';
    document.getElementById('users-list').innerHTML = html;
}

function toggleUserActionMenu(id) {
    const group = document.getElementById(`uag-${id}`);
    if (group) group.classList.toggle('open');
}

document.addEventListener('click', (e) => {
    const grp = e.target.closest('.user-action-group');
    if (!grp) {
        document.querySelectorAll('.user-action-group.open').forEach(g => g.classList.remove('open'));
    }
});

async function toggleUserRole(id, targetRole) {
    const user = cachedData.users.find(u => u.id === id);
    if (!user) return;

    // 如果已经是该角色，则取消（变回 student），否则设为该角色
    const newRole = user.role === targetRole ? 'student' : targetRole;

    // 二次确认，针对提权操作
    if (newRole === 'super_admin') {
        showConfirmModal({
            title: '设为超级管理员',
            message: `确定要将用户 <strong>${escapeHtml(user.username)}</strong> 设置为超级管理员吗？<br><br><span style="color:var(--danger);">超级管理员拥有系统的所有权限，包括管理其他管理员！</span>`,
            confirmText: '确认提权',
            confirmType: 'danger',
            isHtml: true,
            onConfirm: async () => {
                await executeToggleRole(user, newRole);
            }
        });
        return;
    }

    await executeToggleRole(user, newRole);
}

async function executeToggleRole(user, newRole) {
    await Storage.updateUser({ ...user, role: newRole });
    await refreshCache();
    loadUsers();
}


function showAddUser() {
    const currentUser = Storage.getCurrentUser();
    // 强制先选择分组
    if (!selectedGroupId) {
        showAlert('请先从左侧选择一个分组');
        return;
    }

    editingUserId = null;
    const groups = cachedData.groups;

    const groupOptions = groups.map(g =>
        `<option value="${g.id}" ${g.id === selectedGroupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
    ).join('');

    const roleOptions = `
        <option value="student" selected>考生</option>
        ${currentUser.role === 'super_admin' ? '<option value="group_admin">分组管理员</option>' : ''}
    `;

    openModal('添加用户',
        `<div class="form-row">
            <div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" id="user-name"></div>
            <div class="form-group"><label class="form-label">密码</label><input type="text" class="form-input" id="user-pwd" value="123456"></div>
         </div>
         <div class="form-row">
            <div class="form-group"><label class="form-label">角色</label>
                <select class="form-select" id="user-role" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
                    ${roleOptions}
                </select>
            </div>
            <div class="form-group"><label class="form-label">分组</label>
                <select class="form-select" id="user-group" onchange="document.getElementById('user-dept-id').textContent = this.value || '未分配'" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
                    ${groupOptions}
                </select>
            </div>
         </div>
         <div class="form-group" style="padding: 12px 16px; background: var(--bg-card-hover); border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;">
                <div style="display: flex; gap: 24px; align-items: center; flex: 1; min-width: 200px;">
                    <div style="display: flex; gap: 8px; align-items: center; font-size: 15px;">
                        <span style="color: var(--text-muted); white-space: nowrap;">飞书ID:</span>
                        <input type="text" id="user-feishu-id" class="form-input" style="height: 28px; padding: 0 8px; font-size: 13px; width: 120px;" placeholder="可选">
                    </div>
                    <div style="display: flex; gap: 8px; font-size: 15px;">
                        <span style="color: var(--text-muted); white-space: nowrap;">部门ID:</span>
                        <span id="user-dept-id" style="font-family: monospace; color: var(--text-primary);">${selectedGroupId || '未分配'}</span>
                    </div>
                </div>
                <div class="switch-group" style="padding: 0; flex-shrink: 0;">
                    <label class="form-label" style="margin-bottom:0; font-size: 15px; white-space: nowrap;">允许飞书登录</label>
                    <label class="switch">
                        <input type="checkbox" id="user-feishu-enabled" checked>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
         </div>`,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveUser()">保存</button>');
}

function showEditUser(id) {
    editingUserId = id;
    const user = cachedData.users.find(u => u.id === id);
    if (!user) return;

    const currentUser = Storage.getCurrentUser();
    const groups = cachedData.groups;
    const isFeishuUser = !!user.feishuUserId;
    const isSuperAdmin = currentUser.role === 'super_admin';
    const canEditSensitive = isSuperAdmin || !isFeishuUser;

    const roleOptions = `
        <option value="student" ${user.role === 'student' ? 'selected' : ''}>考生</option>
        <option value="group_admin" ${user.role === 'group_admin' ? 'selected' : ''}>分组管理员</option>
        ${user.role === 'super_admin' ? '<option value="super_admin" selected>超级管理员</option>' : ''}
    `;

    const userGroups = user.groupId ? String(user.groupId).split(',') : [];
    const groupOptions = groups.map(g => `
        <option value="${g.id}" ${userGroups.includes(g.id) ? 'selected' : ''}>${escapeHtml(g.name)}</option>
    `).join('');

    openModal('编辑用户',
        `<div class="form-row">
            <div class="form-group">
                <label class="form-label">用户名</label>
                <input type="text" class="form-input" id="user-name" value="${escapeHtml(user.username)}" ${isFeishuUser ? 'disabled' : ''}>
                ${isFeishuUser ? '<small style="color:var(--text-muted)">飞书用户用户名禁止修改</small>' : ''}
            </div>
            <div class="form-group">
                <label class="form-label">密码</label>
                <input type="text" class="form-input" id="user-pwd" placeholder="${isFeishuUser ? '禁止修改飞书用户密码' : '留空则不修改密码'}" ${isFeishuUser ? 'disabled' : ''}>
            </div>
         </div>
         <div class="form-row">
            <div class="form-group"><label class="form-label">角色</label>
                <select class="form-select" id="user-role" ${!canEditSensitive || currentUser.role !== 'super_admin' ? 'disabled' : ''}>
                    ${roleOptions}
                </select>
            </div>
            <div class="form-group"><label class="form-label">所属分组</label>
                <select class="form-select" id="user-group" onchange="document.getElementById('user-dept-id').textContent = this.value || '未分配'" ${!canEditSensitive || currentUser.role !== 'super_admin' ? 'disabled' : ''}>
                    <option value="">未分配分组</option>
                    ${groupOptions}
                </select>
            </div>
         </div>
         <div class="form-group" style="padding: 12px 16px; background: var(--bg-card-hover); border-radius: var(--radius-md); border: 1px solid var(--border); margin-bottom: 16px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;">
                <div style="display: flex; gap: 24px; align-items: center; flex: 1; min-width: 200px;">
                    <div style="display: flex; gap: 8px; align-items: center; font-size: 15px;">
                        <span style="color: var(--text-muted); white-space: nowrap;">飞书ID:</span>
                        ${user.feishuUserId ?
            `<span style="font-family: monospace; color: var(--text-primary);">${escapeHtml(user.feishuUserId)}</span>` :
            `<input type="text" id="user-feishu-id" class="form-input" style="height: 28px; padding: 0 8px; font-size: 13px; width: 120px;" placeholder="可选">`
        }
                    </div>
                    <div style="display: flex; gap: 8px; font-size: 15px;">
                        <span style="color: var(--text-muted); white-space: nowrap;">部门ID:</span>
                        <span id="user-dept-id" style="font-family: monospace; color: var(--text-primary);">${user.groupId ? escapeHtml(user.groupId) : '未分配'}</span>
                    </div>
                </div>
                <div class="switch-group" style="padding: 0; flex-shrink: 0;">
                    <label class="form-label" style="margin-bottom:0; font-size: 15px; white-space: nowrap;">允许飞书登录</label>
                    <label class="switch">
                        <input type="checkbox" id="user-feishu-enabled" ${user.feishuEnabled !== 0 ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
         </div>`,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveUser()">更新</button>');
}

async function saveUser() {
    const username = document.getElementById('user-name').value.trim();
    const password = document.getElementById('user-pwd').value;
    const role = document.getElementById('user-role')?.value || 'student';
    const groupId = document.getElementById('user-group')?.value || '';
    const feishuEnabled = document.getElementById('user-feishu-enabled').checked ? 1 : 0;
    const feishuUserId = document.getElementById('user-feishu-id')?.value.trim() || null;

    if (!username) { showAlert('请输入用户名'); return; }

    if (editingUserId) {
        // 编辑模式
        const oldUser = cachedData.users.find(u => u.id === editingUserId);
        if (oldUser) {
            const updateData = { ...oldUser, username, role, groupId, feishuEnabled };
            if (feishuUserId) updateData.feishuUserId = feishuUserId;
            if (password) updateData.password = password; // 只有输入了密码才更新
            await Storage.updateUser(updateData);
        }
    } else {
        // 新增模式
        await Storage.addUser({ username, password: password || '123456', role, groupId, feishuEnabled, feishuUserId });
    }

    closeModal();
    await refreshCache();
    loadUsers();
}



// ========== 专业分类管理 ==========
let selectedMajorId = null;

function showCategorySettings() {
    const user = Storage.getCurrentUser();
    if (user && user.role !== 'super_admin') {
        showAlert('权限不足，只有超级管理员可以设置专业');
        return;
    }
    const majors = cachedData.categories.filter(c => c.type === 'major');

    // 如果没有选中的专业，默认选中第一个
    if (!selectedMajorId && majors.length > 0) {
        selectedMajorId = majors[0].id;
    }

    // 隐藏其他可能打开的编辑器
    if (document.getElementById('question-editor')) {
        document.getElementById('question-editor').innerHTML = '';
        document.getElementById('question-editor').classList.add('hidden');
    }

    const html = `
        <div class="card" style="margin-bottom:24px;overflow:hidden;">
            <div class="card-header">
                <span class="card-title">专业与设备类型设置</span>
            </div>
            <div class="settings-panel">
                <!-- 左侧：专业列表 -->
                <div class="settings-sidebar">
                    <div class="settings-sidebar-header">
                        <div style="display:flex;gap:8px;">
                            <input type="text" class="form-input" id="new-major-name" placeholder="新专业名称" style="flex:1;">
                            <button class="btn btn-primary btn-sm" onclick="addMajor()">添加</button>
                        </div>
                    </div>
                    <div class="major-list" id="majors-list">
                        ${majors.length ? majors.map(m => `
                            <div class="major-item ${m.id === selectedMajorId ? 'active' : ''}" data-id="${m.id}" onclick="safeOnclick(this, 'selectMajor', ['id'])">
                                <span>${escapeHtml(m.name)}</span>
                                <div class="major-actions">
                                    <button class="btn-icon-xs edit" data-id="${m.id}" data-name="${m.name}" onclick="event.stopPropagation();safeOnclick(this, 'editMajor', ['id','name'])" title="重命名">✎</button>
                                    <button class="btn-icon-xs delete" data-id="${m.id}" onclick="event.stopPropagation();safeOnclick(this, 'deleteMajor', ['id'])" title="删除">🗑️</button>
                                </div>
                            </div>
                        `).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">暂无专业<br>请先添加</div>'}
                    </div>
                </div>
                
                <!-- 右侧：设备类型列表 -->
                <div class="settings-content">
                    <h3 style="font-size:15px;margin-bottom:16px;font-weight:600;display:flex;align-items:center;gap:8px;">
                        <span style="color:var(--text-secondary);">当前专业：</span>
                        <span style="color:var(--primary);">${selectedMajorId ? escapeHtml(majors.find(m => m.id === selectedMajorId)?.name || '') : '-'}</span>
                    </h3>
                    
                    <div id="devices-panel">
                        ${renderDevicesPanelContent()}
                    </div>
                </div>
            </div>
            <div style="padding:16px 24px;background:var(--bg-card);border-top:1px solid var(--border);">
                <button class="btn btn-secondary" onclick="closeCategorySettings()">完成设置</button>
            </div>
        </div>
    `;

    const container = document.getElementById('question-editor');
    container.innerHTML = html;
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth' });
}

function closeCategorySettings() {
    const container = document.getElementById('question-editor');
    container.classList.add('hidden');
    container.innerHTML = '';
}

function renderDevicesPanelContent() {
    if (!selectedMajorId) {
        return '<div style="padding:40px;text-align:center;color:var(--text-muted);background:var(--bg-body);border-radius:var(--radius-md);">请先在左侧选择或添加一个专业</div>';
    }

    const devices = cachedData.categories.filter(c => c.type === 'device' && c.parentId === selectedMajorId);

    return `
        <div style="display:flex;gap:12px;margin-bottom:20px;max-width:400px;">
            <input type="text" class="form-input" id="new-device-name" placeholder="输入设备类型名称" style="flex:1;">
            <button class="btn btn-primary" onclick="addDeviceType()">添加设备</button>
        </div>
        
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
            ${devices.length ? devices.map(d => `
                <div class="device-tag">
                    <span class="device-name">${escapeHtml(d.name)}</span>
                    <div class="device-actions">
                        <button class="btn-circle-xs edit" data-id="${d.id}" data-name="${d.name}" onclick="safeOnclick(this, 'editDevice', ['id','name'])" title="重命名">✎</button>
                        <button class="btn-circle-xs delete" data-id="${d.id}" onclick="safeOnclick(this, 'deleteDevice', ['id'])" title="删除">✕</button>
                    </div>
                </div>
            `).join('') : '<div style="width:100%;padding:30px;text-align:center;background:var(--bg-body);border-radius:var(--radius-md);border:1px dashed var(--border);color:var(--text-muted);">该专业下暂无设备类型，请添加</div>'}
        </div>
    `;
}

function renderDevicesPanel() {
    return renderDevicesPanelContent();
}

function selectMajor(majorId) {
    selectedMajorId = majorId;
    showCategorySettings(); // 刷新整个弹窗以更新选中状态
}

// 重命名相关的全局变量
let pendingRenameCallback = null;

function editMajor(id, currentName) {
    showRenameModal('修改专业名称', currentName, async (newName) => {
        if (newName !== currentName) {
            await updateCategoryName(id, newName);
        }
    });
}

function editDevice(id, currentName) {
    showRenameModal('修改设备类型名称', currentName, async (newName) => {
        if (newName !== currentName) {
            await updateCategoryName(id, newName, true);
        }
    });
}

function showRenameModal(title, currentName, onSave) {
    pendingRenameCallback = onSave;
    const isMajor = title.includes('专业');
    const labelPrefix = isMajor ? '专业' : '设备类型';

    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">原名称</label>
            <input type="text" class="form-input" value="${escapeHtml(currentName)}" disabled style="background:var(--bg-input);cursor:not-allowed;">
        </div>
        <div class="form-group">
            <label class="form-label">修改后名称</label>
            <input type="text" class="form-input" id="rename-input" value="${escapeHtml(currentName)}" placeholder="请输入新名称" onkeydown="if(event.key==='Enter') confirmRename()">
        </div>
    `;
    const footerHtml = `
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="confirmRename()">保存</button>
    `;
    openModal(title, bodyHtml, footerHtml);
    // 自动聚焦输入框
    setTimeout(() => {
        const input = document.getElementById('rename-input');
        if (input) {
            input.focus();
            input.select();
        }
    }, 100);
}

async function confirmRename() {
    const newName = document.getElementById('rename-input').value.trim();
    if (!newName) {
        showAlert('名称不能为空');
        return;
    }

    // 显示加载状态
    const btn = document.querySelector('#modal-footer .btn-primary');
    if (btn) {
        btn.textContent = '保存中...';
        btn.disabled = true;
    }

    try {
        if (pendingRenameCallback) {
            await pendingRenameCallback(newName);
        }
        closeModal();
    } catch (e) {
        console.error(e);
        showAlert('保存失败，请重试');
        if (btn) {
            btn.textContent = '保存';
            btn.disabled = false;
        }
    }
}

async function updateCategoryName(id, newName, isDevice = false) {
    await Storage.updateCategory({ id, name: newName });
    await refreshCache();
    if (isDevice) {
        document.getElementById('devices-panel').innerHTML = renderDevicesPanel();
    } else {
        showCategorySettings();
    }
}

async function addMajor() {
    const name = document.getElementById('new-major-name').value.trim();
    if (!name) { showAlert('请输入专业名称'); return; }

    const result = await Storage.addCategory({ name, type: 'major' });
    await refreshCache();
    selectedMajorId = result.id || cachedData.categories.find(c => c.name === name && c.type === 'major')?.id;
    showCategorySettings();
}

async function addDeviceType() {
    if (!selectedMajorId) { showAlert('请先选择一个专业'); return; }

    const name = document.getElementById('new-device-name').value.trim();
    if (!name) { showAlert('请输入设备类型名称'); return; }

    await Storage.addCategory({ name, type: 'device', parentId: selectedMajorId });
    await refreshCache();
    // 只刷新右侧面板
    document.getElementById('devices-panel').innerHTML = renderDevicesPanel();
}

async function deleteMajor(id) {
    showConfirmModal({
        title: '删除专业',
        message: '确定要删除该专业吗？<br>删除后，该专业下的所有设备类型也将被删除。',
        confirmText: '删除',
        confirmType: 'danger',
        isHtml: true,
        onConfirm: async () => {
            await Storage.deleteCategory(id);
            await refreshCache();
            if (selectedMajorId === id) selectedMajorId = null;
            showCategorySettings();
        }
    });
}

async function deleteDevice(id) {
    showConfirmModal({
        title: '删除设备类型',
        message: '确定要删除该设备类型吗？',
        confirmText: '删除',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deleteCategory(id);
            await refreshCache();
            document.getElementById('devices-panel').innerHTML = renderDevicesPanel();
        }
    });
}

// ========== 题库管理 ==========
// 筛选状态
let currentGroupFilter = 'all'; // 'all' | 'public' | groupId
let currentTypeFilter = 'all';  // 'all' | 'single' | 'multiple' | 'judge'
let currentMajorFilter = 'all'; // 'all' | majorId
let currentDeviceFilter = 'all'; // 'all' | deviceId
let currentMustFilter = 'all'; // 'all' | 'must' | 'not_must'

// 手动选题器的筛选状态
let selectorGroupFilter = 'all';
let selectorMajorFilter = 'all';
let selectorDeviceFilter = 'all';
let selectorMustFilter = 'all';
let selectorKeywordFilter = '';
let selectorAccuracyFilter = 'all';

// 通用下拉菜单控制
function toggleFilterDropdown(filterType) {
    // 设备筛选：如果专业是全部，则不允许打开
    if (filterType === 'device' && currentMajorFilter === 'all') {
        return;
    }

    // 先关闭所有其他下拉菜单
    ['group', 'type', 'must', 'major', 'device'].forEach(type => {
        if (type !== filterType) {
            const otherMenu = document.getElementById(`${type}-filter-menu`);
            if (otherMenu) otherMenu.style.display = 'none';
        }
    });

    const menu = document.getElementById(`${filterType}-filter-menu`);
    if (!menu) return;

    if (menu.style.display === 'none') {
        // 初始化对应的下拉菜单
        if (filterType === 'group') initGroupFilterDropdown();
        else if (filterType === 'type') initTypeFilterDropdown();
        else if (filterType === 'must') initMustFilterDropdown();
        else if (filterType === 'major') initMajorFilterDropdown();
        else if (filterType === 'device') initDeviceFilterDropdown();

        menu.style.display = 'block';
        // 点击其他地方关闭
        setTimeout(() => {
            document.addEventListener('click', (e) => closeFilterDropdown(e, filterType), { once: true });
        }, 0);
    } else {
        menu.style.display = 'none';
    }
}

function closeFilterDropdown(e, filterType) {
    const dropdown = document.getElementById(`${filterType}-filter-dropdown`);
    const menu = document.getElementById(`${filterType}-filter-menu`);
    if (dropdown && menu && !dropdown.contains(e.target)) {
        menu.style.display = 'none';
    }
}

// 题库归属筛选
function initGroupFilterDropdown() {
    const currentUser = Storage.getCurrentUser();
    const menu = document.getElementById('group-filter-menu');
    if (!menu) return;

    let options = [];

    if (currentUser.role === 'super_admin') {
        options.push({ id: 'all', name: '全部题库' });
        options.push({ id: 'public', name: '公共题库' });
        cachedData.groups.forEach(g => {
            options.push({ id: g.id, name: g.name });
        });
    } else {
        options.push({ id: 'all', name: '全部题库' });
        options.push({ id: 'public', name: '公共题库' });
        const myGroup = cachedData.groups.find(g => g.id === currentUser.groupId);
        if (myGroup) {
            options.push({ id: myGroup.id, name: myGroup.name });
        }
    }

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${currentGroupFilter === opt.id ? 'active' : ''}" 
             data-type="group" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, 'selectFilter', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    updateFilterLabel('group', options);
}

// 题型筛选
function initTypeFilterDropdown() {
    const menu = document.getElementById('type-filter-menu');
    if (!menu) return;

    const options = [
        { id: 'all', name: '全部题型' },
        { id: 'single', name: '单选题' },
        { id: 'multiple', name: '多选题' },
        { id: 'judge', name: '判断题' }
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${currentTypeFilter === opt.id ? 'active' : ''}" 
             data-type="type" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, 'selectFilter', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    updateFilterLabel('type', options);
}

function initMustFilterDropdown() {
    const menu = document.getElementById('must-filter-menu');
    if (!menu) return;

    const options = [
        { id: 'all', name: '全部题目' },
        { id: 'must', name: '必考题' },
        { id: 'not_must', name: '非必考题' }
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${currentMustFilter === opt.id ? 'active' : ''}" 
             data-type="must" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, 'selectFilter', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    updateFilterLabel('must', options);
}

// 专业筛选（通用渲染函数）
function renderMajorDropdown(menuId, groupFilterValue, activeMajorValue, onclickHandler) {
    const menu = document.getElementById(menuId);
    if (!menu) return [];

    const groupId = groupFilterValue === 'public' ? 'public' : (groupFilterValue || 'all');
    const majors = getGroupMajors(groupId);
    const options = [
        { id: 'all', name: '全部专业' },
        ...majors.map(m => ({ id: m.id, name: m.name }))
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${activeMajorValue === opt.id ? 'active' : ''}" 
             data-type="major" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, '${onclickHandler}', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    return options;
}

// 设备类型筛选（通用渲染函数）
function renderDeviceDropdown(menuId, majorFilterValue, activeDeviceValue, onclickHandler) {
    const menu = document.getElementById(menuId);
    if (!menu) return [];

    if (majorFilterValue === 'all') {
        menu.innerHTML = '';
        return [];
    }

    const devices = cachedData.categories.filter(c => c.type === 'device' && c.parentId === majorFilterValue);
    const options = [
        { id: 'all', name: '全部设备' },
        ...devices.map(d => ({ id: d.id, name: d.name }))
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${activeDeviceValue === opt.id ? 'active' : ''}" 
             data-type="device" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, '${onclickHandler}', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    return options;
}

// 设备按钮状态更新（通用函数）
function setDeviceButtonState(btnId, labelId, isMajorAll) {
    const btn = document.getElementById(btnId);
    const label = document.getElementById(labelId);
    if (!btn || !label) return;

    if (isMajorAll) {
        btn.disabled = true;
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        label.textContent = '全部设备';
    } else {
        btn.disabled = false;
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

// —— 题库列表筛选器的封装 ——
function initMajorFilterDropdown() {
    const options = renderMajorDropdown('major-filter-menu', currentGroupFilter, currentMajorFilter, 'selectFilter');
    updateFilterLabel('major', options);
}

// 更新筛选按钮标签
function updateFilterLabel(filterType, options) {
    const label = document.getElementById(`${filterType}-filter-label`);
    let currentValue;
    if (filterType === 'group') currentValue = currentGroupFilter;
    else if (filterType === 'type') currentValue = currentTypeFilter;
    else if (filterType === 'major') currentValue = currentMajorFilter;
    else if (filterType === 'device') currentValue = currentDeviceFilter;
    else if (filterType === 'must') currentValue = currentMustFilter;

    const selectedOpt = options.find(o => o.id === currentValue);
    if (label && selectedOpt) {
        label.textContent = selectedOpt.name;
    }
}

// 选择筛选条件
function selectFilter(filterType, value, name) {
    if (filterType === 'group') {
        currentGroupFilter = value;
        // 级联：切换题库时重置专业和设备类型筛选
        currentMajorFilter = 'all';
        currentDeviceFilter = 'all';
        updateDeviceFilterButton();
        const majorLabel = document.getElementById('major-filter-label');
        if (majorLabel) majorLabel.textContent = '全部专业';
    }
    else if (filterType === 'type') currentTypeFilter = value;
    else if (filterType === 'major') {
        currentMajorFilter = value;
        // 级联：切换专业时重置设备类型筛选
        currentDeviceFilter = 'all';
        updateDeviceFilterButton();
    }
    else if (filterType === 'device') currentDeviceFilter = value;
    else if (filterType === 'must') currentMustFilter = value;

    document.getElementById(`${filterType}-filter-label`).textContent = name;
    document.getElementById(`${filterType}-filter-menu`).style.display = 'none';
    loadQuestions();
}

// 更新设备类型筛选按钮状态
function updateDeviceFilterButton() {
    setDeviceButtonState('btn-device-filter', 'device-filter-label', currentMajorFilter === 'all');
    if (currentMajorFilter === 'all') currentDeviceFilter = 'all';
}

// ========== 选题器下拉菜单控制 ==========
function toggleSelectorFilterDropdown(filterType) {
    if (filterType === 'device' && selectorMajorFilter === 'all') return;

    // 关闭所有选题器下拉菜单
    ['group', 'major', 'device', 'must', 'accuracy'].forEach(type => {
        if (type !== filterType) {
            const menu = document.getElementById(`selector-${type}-filter-menu`);
            if (menu) menu.style.display = 'none';
        }
    });

    const menu = document.getElementById(`selector-${filterType}-filter-menu`);
    if (!menu) return;

    if (menu.style.display === 'none') {
        if (filterType === 'group') initSelectorGroupFilterDropdown();
        else if (filterType === 'major') initSelectorMajorFilterDropdown();
        else if (filterType === 'device') initSelectorDeviceFilterDropdown();
        else if (filterType === 'must') initSelectorMustFilterDropdown();
        else if (filterType === 'accuracy') initSelectorAccuracyFilterDropdown();

        menu.style.display = 'block';
        setTimeout(() => {
            document.addEventListener('click', (e) => closeSelectorFilterDropdown(e, filterType), { once: true });
        }, 0);
    } else {
        menu.style.display = 'none';
    }
}


function closeSelectorFilterDropdown(e, filterType) {
    const dropdown = document.getElementById(`selector-${filterType}-filter-dropdown`);
    const menu = document.getElementById(`selector-${filterType}-filter-menu`);
    if (dropdown && menu && !dropdown.contains(e.target)) {
        menu.style.display = 'none';
    }
}

function initSelectorGroupFilterDropdown() {
    const currentUser = Storage.getCurrentUser();
    const menu = document.getElementById('selector-group-filter-menu');
    if (!menu) return;

    let options = [{ id: 'all', name: '全部题库' }, { id: 'public', name: '公共题库' }];
    if (currentUser.role === 'super_admin') {
        cachedData.groups.forEach(g => options.push({ id: g.id, name: g.name }));
    } else {
        const myGroup = cachedData.groups.find(g => g.id === currentUser.groupId);
        if (myGroup) options.push({ id: myGroup.id, name: myGroup.name });
    }

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${selectorGroupFilter === opt.id ? 'active' : ''}" 
             data-type="group" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, 'selectSelectorFilter', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');
}

// —— 选题器筛选器的封装 ——
function initSelectorMajorFilterDropdown() {
    renderMajorDropdown('selector-major-filter-menu', selectorGroupFilter, selectorMajorFilter, 'selectSelectorFilter');
}

function initSelectorDeviceFilterDropdown() {
    renderDeviceDropdown('selector-device-filter-menu', selectorMajorFilter, selectorDeviceFilter, 'selectSelectorFilter');
}

function initSelectorMustFilterDropdown() {
    const menu = document.getElementById('selector-must-filter-menu');
    if (!menu) return;

    const options = [
        { id: 'all', name: '全部题目' },
        { id: 'must', name: '仅必考题' },
        { id: 'not_must', name: '仅非必考题' }
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${selectorMustFilter === opt.id ? 'active' : ''}" 
             data-type="must" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, 'selectSelectorFilter', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');
}

function initSelectorAccuracyFilterDropdown() {
    const menu = document.getElementById('selector-accuracy-filter-menu');
    if (!menu) return;

    const options = [
        { id: 'all', name: '全部正确率' },
        { id: 'lt50', name: '低于 50%' },
        { id: '50_80', name: '50%-80%' },
        { id: 'gt80', name: '高于 80%' }
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${selectorAccuracyFilter === opt.id ? 'active' : ''}" 
             data-type="accuracy" data-id="${opt.id}" data-name="${opt.name}"
             onclick="safeOnclick(this, 'selectSelectorFilter', ['type', 'id', 'name'])"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');
}

function selectSelectorFilter(filterType, value, name) {
    if (filterType === 'group') {
        selectorGroupFilter = value;
        // 级联：切换题库时重置专业和设备类型
        selectorMajorFilter = 'all';
        selectorDeviceFilter = 'all';
        updateSelectorDeviceFilterButton();
        const majorLabel = document.getElementById('selector-major-filter-label');
        if (majorLabel) majorLabel.textContent = '全部专业';
    }
    else if (filterType === 'major') {
        selectorMajorFilter = value;
        selectorDeviceFilter = 'all';
        updateSelectorDeviceFilterButton();
    }
    else if (filterType === 'device') selectorDeviceFilter = value;
    else if (filterType === 'must') selectorMustFilter = value;
    else if (filterType === 'accuracy') selectorAccuracyFilter = value;

    document.getElementById(`selector-${filterType}-filter-label`).textContent = name;
    document.getElementById(`selector-${filterType}-filter-menu`).style.display = 'none';
    applyQuestionFilters();
}

function updateSelectorDeviceFilterButton() {
    setDeviceButtonState('btn-selector-device-filter', 'selector-device-filter-label', selectorMajorFilter === 'all');
}

function initDeviceFilterDropdown() {
    const options = renderDeviceDropdown('device-filter-menu', currentMajorFilter, currentDeviceFilter, 'selectFilter');
    if (options.length) updateFilterLabel('device', options);
}

// 初始化所有筛选下拉菜单
function initAllFilterDropdowns() {
    initGroupFilterDropdown();
    initTypeFilterDropdown();
    initMustFilterDropdown();
    initMajorFilterDropdown();
    initDeviceFilterDropdown();
    updateDeviceFilterButton();
}

function loadQuestions() {
    let questions = cachedData.questions;
    const currentUser = Storage.getCurrentUser();

    // 初始化下拉菜单（首次加载时）
    initAllFilterDropdowns();

    // 按题库归属筛选
    if (currentGroupFilter === 'all') {
        // 全部：不额外过滤
    } else if (currentGroupFilter === 'public') {
        questions = questions.filter(q => !q.groupId);
    } else {
        questions = questions.filter(q => q.groupId === currentGroupFilter);
    }

    // 按题型筛选
    if (currentTypeFilter !== 'all') {
        questions = questions.filter(q => q.type === currentTypeFilter);
    }

    // 按专业筛选
    if (currentMajorFilter !== 'all') {
        questions = questions.filter(q => q.category === currentMajorFilter);
    }

    // 按设备类型筛选
    if (currentDeviceFilter !== 'all') {
        questions = questions.filter(q => q.deviceType === currentDeviceFilter);
    }

    if (currentMustFilter === 'must') {
        questions = questions.filter(q => q.must === 1);
    } else if (currentMustFilter === 'not_must') {
        questions = questions.filter(q => !q.must);
    }

    const typeMap = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const getMajorName = (id) => cachedData.categories.find(c => c.id === id)?.name || id || '-';
    const getDeviceName = (id) => cachedData.categories.find(c => c.id === id)?.name || '';
    const getGroupName = (id) => id ? (cachedData.groups.find(g => g.id === id)?.name || '未知分组') : '公共题库';

    const html = questions.length ? `<div class="table-container"><table class="data-table">
    <thead><tr><th>序号</th><th>专业</th><th>设备类型</th><th>题库归属</th><th>题目</th><th>类型</th><th>必考题</th><th>最后修改时间</th><th>最后修改人</th><th>操作</th></tr></thead>
    <tbody>${questions.map((q, index) => {
        const canEdit = currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && q.groupId === currentUser.groupId);
        const canDelete = canEdit;
        const isMust = q.must ? 1 : 0;

        return `<tr>
      <td style="text-align:center;">${index + 1}</td>
      <td>${escapeHtml(getMajorName(q.category))}</td>
      <td>${escapeHtml(getDeviceName(q.deviceType) || '-')}</td>
      <td><span class="badge ${q.groupId ? 'badge-warning' : 'badge-success'}">${escapeHtml(getGroupName(q.groupId))}</span></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(q.content)}</td>
      <td><span class="badge ${q.type === 'single' ? 'badge-primary' : (q.type === 'multiple' ? 'badge-warning' : 'badge-success')}">${typeMap[q.type]}</span></td>
      <td><span class="badge ${isMust ? 'badge-success' : 'badge-transparent'}">${isMust ? '是' : '否'}</span></td>
      <td style="white-space:nowrap;">${formatFullDateTime(q.updatedAt)}</td>
      <td>${escapeHtml(q.updatedBy || '-')}</td>
      <td>
        ${canEdit ? `<button class="btn btn-sm btn-secondary" data-id="${q.id}" onclick="safeOnclick(this, 'editQuestion', ['id'])">编辑</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger" data-id="${q.id}" onclick="safeOnclick(this, 'deleteQuestion', ['id'])">删除</button>` : ''}
      </td>
    </tr>`;
    }).join('')}</tbody></table></div>` : `<p class="text-muted">所选条件下暂无题目</p>`;
    const countEl = document.getElementById('questions-count');
    if (countEl) {
        countEl.textContent = '共' + questions.length + '题';
    }
    document.getElementById('questions-list').innerHTML = html;
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
    const majors = cachedData.categories.filter(c => c.type === 'major');
    const devices = cachedData.categories.filter(c => c.type === 'device');
    const editorContainer = document.getElementById('question-editor');
    const modalBody = document.getElementById('modal-body');

    // 每次显示编辑器前，先彻底清理两个潜在的容器，防止 ID 冲突
    if (editorContainer) editorContainer.innerHTML = '';
    if (modalBody) modalBody.innerHTML = '';

    const q = editingQuestion || { category: '', deviceType: '', content: '', options: type === 'judge' ? ['正确', '错误'] : ['', '', '', ''], answer: 'A', groupId: currentUser.role === 'group_admin' ? currentUser.groupId : null, must: 0 };

    // 找到当前专业对应的设备类型
    const currentMajorId = q.category || '';
    const currentDevices = devices.filter(d => d.parentId === currentMajorId);

    const mustVal = q.must ? '1' : '0';
    let optionsHtml = '';
    if (type === 'judge') {
        const currentAnswer = (q.answer === 'true' || q.answer === true)
            ? 'A'
            : (q.answer === 'false' || q.answer === false)
                ? 'B'
                : (Array.isArray(q.answer) ? (q.answer[0] || '') : (q.answer || ''));

        optionsHtml = `<div class="form-group"><label class="form-label">选项</label>
      <div id="options-container" class="options-grid">
        <div class="option-row"><span class="option-label">A.</span><input type="text" class="form-input" value="正确" disabled></div>
        <div class="option-row"><span class="option-label">B.</span><input type="text" class="form-input" value="错误" disabled></div>
      </div>
      </div>
      <div style="display:flex;gap:16px;">
        <div class="form-group" style="flex:1;">
          <label class="form-label">正确答案</label>
          <div id="q-answer-group" class="answer-checkbox-group" data-question-type="judge">
            <label class="answer-checkbox-label">
              <input type="checkbox" name="q-answer-option" value="A" ${currentAnswer === 'A' ? 'checked' : ''} onchange="onAnswerCheckboxChange('judge', this)">
              <span>A</span>
            </label>
            <label class="answer-checkbox-label">
              <input type="checkbox" name="q-answer-option" value="B" ${currentAnswer === 'B' ? 'checked' : ''} onchange="onAnswerCheckboxChange('judge', this)">
              <span>B</span>
            </label>
          </div>
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">必考题</label>
          <select class="form-select answer-checkbox-select" id="q-must">
            <option value="1" ${mustVal === '1' ? 'selected' : ''}>是</option>
            <option value="0" ${mustVal !== '1' ? 'selected' : ''}>否</option>
          </select>
        </div>
      </div>`;
    } else {
        const opts = q.options || ['', '', '', ''];
        const validLabels = 'ABCDEFGH'.substring(0, opts.length).split('');
        const currentAnswers = Array.isArray(q.answer)
            ? q.answer
            : (typeof q.answer === 'string'
                ? q.answer.split(/[,，]/).map(a => a.trim()).filter(a => a)
                : (q.answer ? [q.answer] : []));

        optionsHtml = `<div class="form-group"><label class="form-label">选项</label>
      <div id="options-container" class="options-grid">
        ${opts.map((o, i) => `<div class="option-row"><span class="option-label">${'ABCDEFGH'[i]}.</span>
          <input type="text" class="form-input" value="${escapeHtml(o)}" placeholder="选项内容">
          <button class="btn btn-sm btn-danger" onclick="safeOnclick(this, 'removeOption')" ${opts.length <= 2 ? 'disabled' : ''} style="padding:4px 8px;font-size:12px;">删除</button>
        </div>`).join('')}
      </div>
      <div class="add-option-btn" onclick="addOption()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        添加选项
      </div></div>
      <div style="display:flex;gap:16px;">
        <div class="form-group" style="flex:1;">
          <label class="form-label">正确答案${type === 'multiple' ? '（可多选）' : ''}</label>
          <div id="q-answer-group" class="answer-checkbox-group" data-question-type="${type}">
            ${validLabels.map((l, i) => `
              <label class="answer-checkbox-label">
                <input type="checkbox" name="q-answer-option" value="${l}" ${currentAnswers.includes(l) ? 'checked' : ''} onchange="onAnswerCheckboxChange('${type}', this)">
                <span>${l}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="form-group" style="flex:1;">
          <label class="form-label">必考题</label>
          <select class="form-select answer-checkbox-select" id="q-must">
            <option value="1" ${mustVal === '1' ? 'selected' : ''}>是</option>
            <option value="0" ${mustVal !== '1' ? 'selected' : ''}>否</option>
          </select>
        </div>
      </div>`;
    }

    const groupOptions = `
        <option value="" ${!q.groupId ? 'selected' : ''}>公共题库</option>
        ${cachedData.groups.map(g => `<option value="${g.id}" ${q.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
    `;

    const editorInnerHtml = `
      <div style="display:flex;gap:16px;margin-bottom:12px;">
        <div class="form-group" style="flex:1;margin-bottom:0;">
          <label class="form-label">专业</label>
          <select class="form-select" id="q-category" onchange="onMajorChange()">
            <option value="">请选择专业</option>
            ${majors.map(m => `<option value="${m.id}" ${m.id === q.category ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="flex:1;margin-bottom:0;">
          <label class="form-label">设备类型</label>
          <select class="form-select" id="q-deviceType">
            <option value="">请先选择专业</option>
            ${currentDevices.map(d => `<option value="${d.id}" ${d.id === q.deviceType ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label">题库归属</label>
        <select class="form-select" id="q-groupId" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
            ${groupOptions}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label">题目</label>
        <textarea class="form-input" id="q-content" rows="3" placeholder="请输入题目内容">${escapeHtml(q.content)}</textarea></div>
      ${optionsHtml}`;

    if (editingQuestion) {
        // 编辑模式使用弹窗
        const footerHtml = `
          <button class="btn btn-success" data-type="${type}" onclick="safeOnclick(this, 'saveQuestion', ['type'])">保存</button>
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
                <button class="btn btn-success" data-type="${type}" onclick="safeOnclick(this, 'saveQuestion', ['type'])">保存</button>
                <button class="btn btn-secondary" onclick="cancelQuestionEdit()">取消</button>
              </div>
            </div>
          </div>`;
        editorContainer.classList.remove('hidden');
        editorContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

function onMajorChange() {
    const majorId = document.getElementById('q-category').value;
    const deviceSelect = document.getElementById('q-deviceType');
    const devices = cachedData.categories.filter(c => c.type === 'device' && c.parentId === majorId);

    deviceSelect.innerHTML = majorId
        ? `<option value="">请选择设备类型</option>${devices.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}`
        : '<option value="">请先选择专业</option>';
}

function onAnswerCheckboxChange(type, checkbox) {
    if (type === 'multiple') return;
    if (!checkbox || !checkbox.checked) return;
    const group = checkbox.closest('#q-answer-group');
    if (!group) return;
    group.querySelectorAll('input[name="q-answer-option"]').forEach(cb => {
        if (cb !== checkbox) cb.checked = false;
    });
}


function addOption() {
    const container = document.getElementById('options-container');
    if (!container) return;
    const count = container.children.length;
    if (count >= 8) return;
    const label = 'ABCDEFGH'[count];
    container.insertAdjacentHTML('beforeend', `<div class="option-row">
        <span class="option-label">${label}.</span>
        <input type="text" class="form-input" placeholder="选项内容">
        <button class="btn btn-sm btn-danger" onclick="safeOnclick(this, 'removeOption')" style="padding:4px 8px;font-size:12px;">删除</button>
    </div>`);
    updateOptionLabels(container);
    syncAnswerCheckboxesWithOptions();
}

function removeOption(btn) {
    const container = btn.closest('#options-container');
    btn.closest('.option-row').remove();
    updateOptionLabels(container);
    syncAnswerCheckboxesWithOptions();
}

function updateOptionLabels(container) {
    if (!container) container = document.getElementById('options-container');
    if (!container) return;

    const rows = container.querySelectorAll('.option-row');
    rows.forEach((row, i) => {
        row.querySelector('.option-label').textContent = 'ABCDEFGH'[i] + '.';
        row.querySelector('.btn-danger').disabled = rows.length <= 2;
    });
}

function syncAnswerCheckboxesWithOptions() {
    const container = document.getElementById('options-container');
    const group = document.getElementById('q-answer-group');
    if (!container || !group) return;

    const type = group.getAttribute('data-question-type') || 'single';
    if (type === 'judge') return;

    const existingChecked = new Set(
        Array.from(group.querySelectorAll('input[name="q-answer-option"]:checked'))
            .map(cb => cb.value)
    );

    const optionInputs = Array.from(container.querySelectorAll('.option-row input'));
    const labels = 'ABCDEFGH';

    const items = optionInputs.map((input, index) => {
        const label = labels[index];
        const checked = existingChecked.has(label) ? 'checked' : '';
        return `
            <label class="answer-checkbox-label">
                <input type="checkbox" name="q-answer-option" value="${label}" ${checked} onchange="onAnswerCheckboxChange('${type}', this)">
                <span>${label}</span>
            </label>
        `;
    });

    group.innerHTML = items.join('');
}

async function saveQuestion(type) {
    try {
        const categoryEl = document.getElementById('q-category');
        const deviceTypeEl = document.getElementById('q-deviceType');
        const groupIdEl = document.getElementById('q-groupId');
        const contentEl = document.getElementById('q-content');
        const mustEl = document.getElementById('q-must');

        if (!categoryEl || !contentEl) {
            console.error('Missing form elements');
            showAlert('页面表单加载异常，请刷新重试');
            return;
        }

        const category = categoryEl.value;
        const deviceType = deviceTypeEl ? deviceTypeEl.value : '';
        const groupId = groupIdEl ? groupIdEl.value : null;
        const content = contentEl.value.trim();
        let options = [], answer;
        const must = mustEl ? (mustEl.value === '1' ? 1 : 0) : 0;
        const answerCheckboxes = Array.from(document.querySelectorAll('input[name="q-answer-option"]:checked'));

        if (type === 'judge') {
            options = ['正确', '错误'];

            if (answerCheckboxes.length !== 1) {
                showAlert('判断题必须且只能选择一个正确答案');
                return;
            }

            const answerVal = (answerCheckboxes[0].value || '').toUpperCase().trim();
            if (!['A', 'B'].includes(answerVal)) {
                showAlert('判断题正确答案无效');
                return;
            }
            answer = answerVal;
        } else {
            const container = document.getElementById('options-container');
            if (container) {
                container.querySelectorAll('.option-row input').forEach(input => options.push(input.value.trim()));
            }

            // 验证选项内容不为空
            if (options.some(o => !o)) {
                showAlert('选项内容不能为空');
                return;
            }

            const validLabels = 'ABCDEFGH'.substring(0, options.length).split('');

            if (type === 'multiple') {
                const answers = answerCheckboxes.map(cb => (cb.value || '').toUpperCase().trim()).filter(a => a);

                if (answers.length === 0) {
                    showAlert('多选题至少选择一个正确答案');
                    return;
                }

                // 检查是否有非法字符
                const invalid = answers.find(a => !validLabels.includes(a));
                if (invalid) {
                    showAlert(`正确答案中包含无效选项 "${invalid}"。<br>当前有效选项范围：${validLabels.join(', ')}`);
                    return;
                }
                answer = answers;
            } else {
                // 单选题
                if (answerCheckboxes.length !== 1) {
                    showAlert('单选题必须且只能选择一个正确答案');
                    return;
                }
                const answerVal = (answerCheckboxes[0].value || '').toUpperCase().trim();
                if (!answerVal) {
                    showAlert('请选择正确答案');
                    return;
                }
                if (!validLabels.includes(answerVal)) {
                    showAlert(`正确答案 "${answerVal}" 无效。<br>当前有效选项范围：${validLabels.join(', ')}`);
                    return;
                }
                answer = answerVal;
            }
        }

        if (!content) { showAlert('请输入题目内容'); return; }

        // 显示保存中状态
        const btn = document.querySelector('button[onclick^="saveQuestion"]');
        if (btn) {
            btn.textContent = '保存中...';
            btn.disabled = true;
        }

        const question = { type, category, deviceType, content, options, answer, must, groupId: groupId || null };
        if (editingQuestion) {
            await Storage.updateQuestion({ ...question, id: editingQuestion.id });
        } else {
            await Storage.addQuestion(question);
        }
        cancelQuestionEdit();
        await refreshCache();
        loadQuestions();
    } catch (e) {
        console.error('Save question failed', e);
        showAlert('保存失败：' + e.message);

        // 恢复按钮状态
        const btn = document.querySelector('button[onclick^="saveQuestion"]');
        if (btn) {
            btn.textContent = '保存';
            btn.disabled = false;
        }
    }
}


function cancelQuestionEdit() {
    editingQuestion = null;

    // 徹底清除内容，防止 ID 冲突
    const modalBody = document.getElementById('modal-body');
    if (modalBody) modalBody.innerHTML = '';

    closeModal();

    const editor = document.getElementById('question-editor');
    if (editor) {
        editor.innerHTML = '';
        editor.classList.add('hidden');
    }
}



// ========== 试卷管理 ==========
let paperRules = [];
let rulesValidated = false;
let selectedQuestions = {};
let currentEditingPaperId = null;
let autoGenerateConfig = {};

function loadPaperGroups() { }

function loadPapers() {
    const papers = cachedData.papers;
    const currentUser = Storage.getCurrentUser();
    const getCreatorName = (creatorId) => {
        if (!creatorId) return '-';
        const user = cachedData.users.find(u => u.id === creatorId);
        return user ? user.username : '未知用户';
    };
    const getPaperBelong = (creatorId) => {
        if (!creatorId) return '超级管理员';
        const user = cachedData.users.find(u => u.id === creatorId);
        if (!user) return '未知用户';
        if (!user.groupId) return '超级管理员';
        const group = cachedData.groups.find(g => g.id === user.groupId);
        return group ? group.name : '未知分组';
    };

    const html = papers.length ? `<table class="data-table"><thead><tr>
      <th style="width:60px;text-align:center;">序号</th>
      <th style="text-align:center;">试卷名称</th>
      <th style="text-align:center;">创建人</th>
      <th style="text-align:center;">试卷归属</th>
      <th style="width:180px;text-align:center;">创建日期</th>
      <th style="text-align:center;">状态</th>
      <th style="width:260px;text-align:center;">操作</th>
    </tr></thead>
    <tbody>${papers.map((p, index) => {
        const canManage = currentUser.role === 'super_admin' || p.creatorId === currentUser.id;
        return `<tr>
      <td style="text-align:center;">${index + 1}</td>
      <td style="text-align:center;">${escapeHtml(p.name)}</td>
      <td style="text-align:center;">${escapeHtml(getCreatorName(p.creatorId))}</td>
      <td style="text-align:center;">${escapeHtml(getPaperBelong(p.creatorId))}</td>
      <td style="white-space:nowrap;text-align:center;">${formatFullDateTime(p.createDate)}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-secondary" data-id="${p.id}" onclick="safeOnclick(this, 'showPushLogs', ['id'])">推送记录</button>
      </td>
      <td style="text-align:center;white-space:nowrap;">
        <div style="display:inline-flex;gap:8px;flex-wrap:nowrap;justify-content:center;">
            ${canManage ? `
                <button class="btn btn-sm btn-info" data-id="${p.id}" onclick="safeOnclick(this, 'editPaper', ['id'])">编辑</button>
                <button class="btn btn-sm btn-primary" data-id="${p.id}" onclick="safeOnclick(this, 'showPublishModal', ['id'])">推送</button>
                <button class="btn btn-sm btn-danger" data-id="${p.id}" onclick="safeOnclick(this, 'deletePaper', ['id'])">删除</button>
            ` : ''}
        </div>
      </td></tr>`;
    }).join('')}</tbody></table>` : '<p class="text-muted">暂无试卷</p>';
    document.getElementById('papers-list').innerHTML = html;
}

async function showPushLogs(paperId) {
    const paper = cachedData.papers.find(p => p.id === paperId);
    const logs = await Storage.getPushLogs(paperId);
    const groups = cachedData.groups;
    const users = cachedData.users;

    if (logs.length === 0) {
        openModal('推送记录 - ' + paper.name,
            '<div class="empty-state"><p>该试卷尚未推送过</p></div>',
            '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
        return;
    }

    const getGroupNames = (ids) => ids.map(id => groups.find(g => g.id === id)?.name || id).join('、') || '-';
    const getUserNames = (ids) => ids.map(id => users.find(u => u.id === id)?.username || id).join('、') || '-';

    const bodyHtml = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width:200px;">推送信息</th>
                        <th style="width:230px;">考试时间</th>
                        <th>目标分组</th>
                        <th>目标用户</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => {
        const startText = log.startTime ? formatFullDateTime(log.startTime) : '-';
        const endText = log.deadline ? formatFullDateTime(log.deadline) : '-';
        const pusherName = paper && paper.creatorId
            ? (users.find(u => u.id === paper.creatorId)?.username || '未知用户')
            : '未知用户';
        return `
                        <tr>
                            <td style="white-space:nowrap;width:200px;">
                                <div style="display:flex;flex-direction:column;gap:4px;">
                                    <div>推送时间：${formatFullDateTime(log.pushTime)}</div>
                                    <div>推送人：${pusherName}</div>
                                </div>
                            </td>
                            <td style="white-space:nowrap;width:230px;">
                                <div style="display:flex;flex-direction:column;gap:4px;">
                                    <div>开始时间：${startText}</div>
                                    <div>截止时间：${endText}</div>
                                </div>
                            </td>
                            <td style="word-break:break-all;vertical-align:top;">${getGroupNames(log.targetGroups)}</td>
                            <td style="word-break:break-all;vertical-align:top;">${getUserNames(log.targetUsers)}</td>
                        </tr>`;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    openModal('推送记录 - ' + paper.name, bodyHtml,
        '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
}


function showPaperEditor() {
    currentEditingPaperId = null; // 重置编辑 ID
    document.getElementById('btn-create-paper').classList.add('hidden');
    document.getElementById('paper-editor').classList.remove('hidden');
    document.getElementById('paper-editor-title').textContent = '创建试卷';
    document.getElementById('paper-name').value = '';
    paperRules = [];
    rulesValidated = false;
    selectedQuestions = {};
    updateRulesTable();
    disableGenerateButtons();
    document.getElementById('manual-select-area').classList.add('hidden');
    const autoArea = document.getElementById('auto-generate-area');
    if (autoArea) autoArea.classList.add('hidden');
    const sqEl = document.getElementById('paper-shuffle-questions');
    const soEl = document.getElementById('paper-shuffle-options');
    const passEl = document.getElementById('paper-pass-score');
    if (sqEl) sqEl.checked = false;
    if (soEl) soEl.checked = false;
    if (passEl) passEl.value = '';
}

function editPaper(paperId) {
    const paper = cachedData.papers.find(p => p.id === paperId);
    if (!paper) return;

    currentEditingPaperId = paperId;
    document.getElementById('btn-create-paper').classList.add('hidden');
    document.getElementById('paper-editor').classList.remove('hidden');
    document.getElementById('paper-editor-title').textContent = '编辑试卷';
    document.getElementById('paper-name').value = paper.name;

    // 回填规则
    paperRules = JSON.parse(JSON.stringify(paper.rules || []));

    // 回填已选题目
    selectedQuestions = JSON.parse(JSON.stringify(paper.questions || {}));

    updateRulesTable();
    rulesValidated = true;
    enableGenerateButtons();
    document.getElementById('manual-select-area').classList.add('hidden');
    const autoArea = document.getElementById('auto-generate-area');
    if (autoArea) autoArea.classList.add('hidden');
    const sqEl = document.getElementById('paper-shuffle-questions');
    const soEl = document.getElementById('paper-shuffle-options');
    const passEl = document.getElementById('paper-pass-score');
    if (sqEl) sqEl.checked = !!paper.shuffleQuestions;
    if (soEl) soEl.checked = !!paper.shuffleOptions;
    if (passEl) passEl.value = paper.passScore != null ? paper.passScore : '';

    // 滚动到编辑器
    document.getElementById('paper-editor').scrollIntoView({ behavior: 'smooth' });
}

function cancelPaperEdit() {
    document.getElementById('btn-create-paper').classList.remove('hidden');
    document.getElementById('paper-editor').classList.add('hidden');
    document.getElementById('paper-editor-title').textContent = '创建试卷';
    document.getElementById('paper-name').value = '';
    paperRules = [];
    selectedQuestions = {};
    rulesValidated = false;
    currentEditingPaperId = null;
    disableGenerateButtons();
    const autoArea = document.getElementById('auto-generate-area');
    if (autoArea) autoArea.classList.add('hidden');
}

function addRuleRow() {
    const usedTypes = paperRules.map(r => r.type);
    const allTypes = ['single', 'multiple', 'judge'];
    const availableTypes = allTypes.filter(t => !usedTypes.includes(t));

    if (availableTypes.length === 0) {
        showAlert('所有题型已添加');
        return;
    }

    const newType = availableTypes[0];
    const defaults = {
        single: { count: 10, score: 2, timeLimit: 15, mustCount: 0 },
        multiple: { count: 5, score: 4, timeLimit: 30, mustCount: 0 },
        judge: { count: 10, score: 2, timeLimit: 20, mustCount: 0 }
    };

    const id = Date.now();
    paperRules.push({
        id,
        type: newType,
        count: defaults[newType].count,
        score: defaults[newType].score,
        partialScore: 0,
        mustCount: defaults[newType].mustCount,
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
        if (rule.mustCount == null) {
            rule.mustCount = 0;
        }
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
            <td style="text-align:center;"><input type="number" class="form-input" style="width:80px;text-align:center;" value="${rule.mustCount}" min="0" onchange="updateRule(${rule.id}, 'mustCount', this.value)"></td>
            <td style="text-align:center;"><input type="number" class="form-input" style="width:70px;text-align:center;" value="${rule.timeLimit}" min="5" onchange="updateRule(${rule.id}, 'timeLimit', this.value)"></td>
            <td style="text-align:center;">${rule.count * rule.score}</td>
            <td style="text-align:center;"><button class="btn btn-sm btn-danger" data-id="${rule.id}" onclick="safeOnclick(this, 'removeRule', ['id'])">删除</button></td>
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
            if (field === 'count' && rule.mustCount > rule.count) {
                rule.mustCount = rule.count;
            }
            if (field === 'mustCount' && rule.mustCount > rule.count) {
                rule.mustCount = rule.count;
            }
        }
        updateRulesTable();
        rulesValidated = false;
        disableGenerateButtons();
    }
}

function removeRule(id) {
    const targetId = typeof id === 'string' ? Number(id) : id;
    paperRules = paperRules.filter(r => r.id !== targetId);
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
    if (!name) { showAlert('请输入试卷名称'); return; }
    if (paperRules.length === 0) { showAlert('请至少添加一个题型规则'); return; }

    const total = calculateTotalScore();
    if (total !== 100) {
        showAlert('总分需等于100分，当前总分：' + total + '分');
        return;
    }

    const questions = cachedData.questions;
    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
    for (const rule of paperRules) {
        const pool = questions.filter(q => q.type === rule.type);
        const available = pool.length;
        const mustCount = rule.mustCount || 0;

        if (available < rule.count) {
            showAlert(typeNames[rule.type] + '数量不足！需要' + rule.count + '题，题库仅有' + available + '题');
            return;
        }

        if (mustCount > rule.count) {
            showAlert(typeNames[rule.type] + '必考题数量不能超过该题型总题数(' + rule.count + ')');
            return;
        }

        if (mustCount > 0) {
            const mustAvailable = pool.filter(q => q.must === 1).length;
            if (mustAvailable < mustCount) {
                showAlert(typeNames[rule.type] + '必考题数量不足！需要' + mustCount + '题，题库仅有' + mustAvailable + '道必考题');
                return;
            }
        }
    }

    rulesValidated = true;
    enableGenerateButtons();
    showAlert('校验成功！请选择"手动选择题目"或"自动生成题目"');
}

function showManualSelect() {
    if (!rulesValidated) { showAlert('请先校验试卷规则'); return; }

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };

    let html = '<div class="flex gap-3 mb-4">';
    paperRules.forEach(rule => {
        if (!selectedQuestions[rule.type]) selectedQuestions[rule.type] = [];
        const selectedIds = selectedQuestions[rule.type];
        const currentCount = selectedIds.length;
        const mustCount = rule.mustCount || 0;
        const mustSelected = selectedIds.filter(id => {
            const q = cachedData.questions.find(item => item.id === id);
            return q && q.must === 1;
        }).length;

        html += `<button class="btn btn-secondary" data-type="${rule.type}" data-max="${rule.count}" onclick="safeOnclick(this, 'showQuestionSelector', ['type', 'max'])" style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;">
            <span>${typeNames[rule.type]} (已选 <span id="selected-count-${rule.type}">${currentCount}</span>/${rule.count})</span>
            <span style="font-size:12px;opacity:0.85;">必考题 (已选 <span id="selected-must-${rule.type}">${mustSelected}</span>/${mustCount})</span>
        </button>`;
    });
    html += '</div>';
    html += '<div id="question-selector-area"></div>';

    document.getElementById('manual-select-content').innerHTML = html;
    document.getElementById('manual-select-area').classList.remove('hidden');
    const autoArea = document.getElementById('auto-generate-area');
    if (autoArea) autoArea.classList.add('hidden');
}

let currentSelectorType = null;
let currentSelectorMaxCount = 0;

function showQuestionSelector(type, maxCount) {
    currentSelectorType = type;
    currentSelectorMaxCount = maxCount;

    // 重置选题器的筛选状态
    selectorGroupFilter = 'all';
    selectorMajorFilter = 'all';
    selectorDeviceFilter = 'all';
    selectorMustFilter = 'all';
    selectorKeywordFilter = '';
    selectorAccuracyFilter = 'all';

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };

    let html = `<div class="selector-header mb-4">
        <h4 class="mb-3">选择${typeNames[type]} (最多${maxCount}题)</h4>
        <div class="filter-bar flex gap-3 flex-wrap bg-body p-3 border-radius-md" style="align-items: center;">
            <div class="filter-item">
                <div class="dropdown-filter" id="selector-group-filter-dropdown" style="position:relative;">
                    <button class="btn btn-sm btn-primary" id="btn-selector-group-filter"
                        data-type="group" onclick="safeOnclick(this, 'toggleSelectorFilterDropdown', ['type'])"
                        style="min-width:110px;display:flex;align-items:center;gap:4px;justify-content:center;">
                        <span id="selector-group-filter-label">全部题库</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div class="dropdown-menu" id="selector-group-filter-menu"
                        style="display:none;position:absolute;top:100%;left:0;margin-top:4px;min-width:160px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);z-index:1000;max-height:300px;overflow-y:auto;">
                    </div>
                </div>
            </div>
            <div class="filter-item">
                <div class="dropdown-filter" id="selector-major-filter-dropdown" style="position:relative;">
                    <button class="btn btn-sm btn-primary" id="btn-selector-major-filter"
                        data-type="major" onclick="safeOnclick(this, 'toggleSelectorFilterDropdown', ['type'])"
                        style="min-width:110px;display:flex;align-items:center;gap:4px;justify-content:center;">
                        <span id="selector-major-filter-label">全部专业</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div class="dropdown-menu" id="selector-major-filter-menu"
                        style="display:none;position:absolute;top:100%;left:0;margin-top:4px;min-width:160px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);z-index:1000;max-height:300px;overflow-y:auto;">
                    </div>
                </div>
            </div>
            <div class="filter-item">
                <div class="dropdown-filter" id="selector-device-filter-dropdown" style="position:relative;">
                    <button class="btn btn-sm btn-secondary" id="btn-selector-device-filter"
                        data-type="device" onclick="safeOnclick(this, 'toggleSelectorFilterDropdown', ['type'])" disabled
                        style="min-width:110px;display:flex;align-items:center;gap:4px;justify-content:center;opacity:0.5;cursor:not-allowed;">
                        <span id="selector-device-filter-label">全部设备</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div class="dropdown-menu" id="selector-device-filter-menu"
                        style="display:none;position:absolute;top:100%;left:0;margin-top:4px;min-width:160px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);z-index:1000;max-height:300px;overflow-y:auto;">
                    </div>
                </div>
            </div>
            <div class="filter-item">
                <div class="dropdown-filter" id="selector-must-filter-dropdown" style="position:relative;">
                    <button class="btn btn-sm btn-primary" id="btn-selector-must-filter"
                        data-type="must" onclick="safeOnclick(this, 'toggleSelectorFilterDropdown', ['type'])"
                        style="min-width:110px;display:flex;align-items:center;gap:4px;justify-content:center;">
                        <span id="selector-must-filter-label">全部题目</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div class="dropdown-menu" id="selector-must-filter-menu"
                        style="display:none;position:absolute;top:100%;left:0;margin-top:4px;min-width:160px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);z-index:1000;max-height:300px;overflow-y:auto;">
                    </div>
                </div>
            </div>
            <div class="filter-item">
                <div class="dropdown-filter" id="selector-accuracy-filter-dropdown" style="position:relative;">
                    <button class="btn btn-sm btn-primary" id="btn-selector-accuracy-filter"
                        data-type="accuracy" onclick="safeOnclick(this, 'toggleSelectorFilterDropdown', ['type'])"
                        style="min-width:110px;display:flex;align-items:center;gap:4px;justify-content:center;">
                        <span id="selector-accuracy-filter-label">全部正确率</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </button>
                    <div class="dropdown-menu" id="selector-accuracy-filter-menu"
                        style="display:none;position:absolute;top:100%;left:0;margin-top:4px;min-width:160px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);z-index:1000;max-height:300px;overflow-y:auto;">
                    </div>
                </div>
            </div>
            <div class="filter-item">
                <input type="text" class="form-input-sm" id="selector-filter-keyword" 
                    placeholder="搜索题目内容..." 
                    style="height:32px;padding:4px 12px;"
                    onkeyup="selectorKeywordFilter = this.value; applyQuestionFilters()">
            </div>
        </div>
    </div>
    <div id="selector-table-container">
        ${renderQuestionSelectorTable(type, maxCount)}
    </div>`;

    document.getElementById('question-selector-area').innerHTML = html;
}

function applyQuestionFilters() {
    const type = currentSelectorType;
    const maxCount = currentSelectorMaxCount;
    const container = document.getElementById('selector-table-container');
    if (container) {
        container.innerHTML = renderQuestionSelectorTable(type, maxCount);
    }
}

function renderQuestionSelectorTable(type, maxCount) {
    let questions = cachedData.questions.filter(q => q.type === type);

    if (selectorGroupFilter !== 'all') {
        if (selectorGroupFilter === 'public') {
            questions = questions.filter(q => !q.groupId);
        } else {
            questions = questions.filter(q => q.groupId === selectorGroupFilter);
        }
    }

    if (selectorMajorFilter !== 'all') {
        questions = questions.filter(q => q.category === selectorMajorFilter);
    }

    if (selectorDeviceFilter !== 'all') {
        questions = questions.filter(q => q.deviceType === selectorDeviceFilter);
    }

    if (selectorMustFilter === 'must') {
        questions = questions.filter(q => q.must === 1);
    } else if (selectorMustFilter === 'not_must') {
        questions = questions.filter(q => !q.must);
    }

    if (selectorAccuracyFilter !== 'all') {
        questions = questions.filter(q => {
            const value = Number(q.accuracy);
            if (!Number.isFinite(value)) return false;
            if (selectorAccuracyFilter === 'lt50') return value < 50;
            if (selectorAccuracyFilter === '50_80') return value >= 50 && value <= 80;
            if (selectorAccuracyFilter === 'gt80') return value > 80;
            return true;
        });
    }

    if (selectorKeywordFilter) {
        const keyword = selectorKeywordFilter.toLowerCase();
        questions = questions.filter(q => q.content.toLowerCase().includes(keyword));
    }

    const selected = selectedQuestions[type] || [];
    const getMajorName = (id) => cachedData.categories.find(c => c.id === id)?.name || id || '-';
    const getDeviceName = (id) => cachedData.categories.find(c => c.id === id)?.name || '';
    const getGroupName = (id) => id ? (cachedData.groups.find(g => g.id === id)?.name || '未知分组') : '公共题库';
    const formatAccuracy = (q) => {
        const total = q.totalCount == null ? 0 : Number(q.totalCount);
        const correct = q.correctCount == null ? 0 : Number(q.correctCount);
        if (!Number.isFinite(total) || total <= 0) return '-';
        const value = Number.isFinite(Number(q.accuracy))
            ? Number(q.accuracy)
            : (Number.isFinite(correct) && correct >= 0 ? (correct * 100) / total : 0);
        if (!Number.isFinite(value) || value < 0) return '-';
        const rounded = Math.round(value * 10) / 10;
        return `${rounded}%`;
    };

    return `<div class="table-container"><table class="data-table">
    <thead><tr>
        <th style="width:60px;white-space:nowrap;text-align:center;">选择</th>
        <th style="width:120px;">专业/设备</th>
        <th style="width:100px;white-space:nowrap;">题库归属</th>
        <th>题目</th>
        <th style="width:90px;white-space:nowrap;text-align:center;">正确率</th>
        <th style="width:80px;white-space:nowrap;text-align:center;">必考题</th>
        <th style="width:80px;white-space:nowrap;text-align:center;">操作</th>
    </tr></thead>
    <tbody>${questions.length ? questions.map(q => `
        <tr>
            <td style="text-align:center;white-space:nowrap;"><input type="checkbox" ${selected.includes(q.id) ? 'checked' : ''} 
                onchange="toggleQuestion('${type}', '${q.id}', ${maxCount}, this.checked)"></td>
            <td style="font-size:12px;color:var(--text-secondary);">
                <div>${escapeHtml(getMajorName(q.category))}</div>
                <div style="opacity:0.7;">${escapeHtml(getDeviceName(q.deviceType) || '-')}</div>
            </td>
            <td style="white-space:nowrap;"><span class="badge ${q.groupId ? 'badge-warning' : 'badge-success'}">${escapeHtml(getGroupName(q.groupId))}</span></td>
            <td style="max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(q.content)}">${escapeHtml(q.content)}</td>
            <td style="text-align:center;white-space:nowrap;">${formatAccuracy(q)}</td>
            <td style="text-align:center;white-space:nowrap;">${q.must === 1 ? '<span class="badge badge-success">是</span>' : '<span class="badge badge-secondary">否</span>'}</td>
            <td style="text-align:center;white-space:nowrap;">
                <button class="btn btn-sm btn-secondary" data-id="${q.id}" onclick="safeOnclick(this, 'viewQuestionDetail', ['id'])">查看</button>
            </td>
        </tr>`).join('') : '<tr><td colspan="7" class="text-center p-4 text-muted">没有找到匹配的题目</td></tr>'}</tbody></table></div>`;
}

function toggleQuestion(type, questionId, maxCount, checked) {
    if (!selectedQuestions[type]) selectedQuestions[type] = [];

    if (checked) {
        if (selectedQuestions[type].length >= maxCount) {
            showAlert(`该题型最多选择${maxCount}题`);
            event.target.checked = false;
            return;
        }
        selectedQuestions[type].push(questionId);
    } else {
        selectedQuestions[type] = selectedQuestions[type].filter(id => id !== questionId);
    }

    document.getElementById(`selected-count-${type}`).textContent = selectedQuestions[type].length;

    const mustSpan = document.getElementById(`selected-must-${type}`);
    if (mustSpan) {
        const ids = selectedQuestions[type];
        const mustSelected = ids.filter(id => {
            const q = cachedData.questions.find(item => item.id === id);
            return q && q.must === 1;
        }).length;
        mustSpan.textContent = mustSelected;
    }
}

function showAutoConfig(type) {
    const container = document.getElementById('auto-config-area');
    if (!container) return;

    const questions = cachedData.questions.filter(q => q.type === type);
    const cfg = autoGenerateConfig[type] || { groups: {}, majors: {}, devices: {} };
    autoGenerateConfig[type] = cfg;

    const groupSet = new Set();
    const majorSet = new Set();
    const deviceSet = new Set();

    questions.forEach(q => {
        const gKey = q.groupId || 'public';
        groupSet.add(gKey);
        if (q.category) majorSet.add(q.category);
        if (q.deviceType) deviceSet.add(q.deviceType);
    });

    const groups = Array.from(groupSet).map(id => {
        const name = id === 'public'
            ? '公共题库'
            : (cachedData.groups.find(g => g.id === id)?.name || id);
        return { id, name };
    });

    const majors = Array.from(majorSet).map(id => {
        const name = cachedData.categories.find(c => c.id === id)?.name || id;
        return { id, name };
    });

    const devices = Array.from(deviceSet).map(id => {
        const name = cachedData.categories.find(c => c.id === id)?.name || id;
        return { id, name };
    });

    const renderRows = (items, dim, map) => {
        if (!items.length) {
            return '<tr><td colspan="2" class="text-muted" style="text-align:center;">无可用数据</td></tr>';
        }
        return items.map(item => {
            const val = map && map[item.id] != null ? map[item.id] : '';
            return `<tr>
                <td style="padding:6px 8px;">${escapeHtml(item.name)}</td>
                <td style="padding:6px 8px;width:120px;">
                    <input type="number" class="form-input" style="width:100%;text-align:center;"
                        min="0" step="1"
                        value="${val}"
                        onchange="updateAutoConfig('${type}','${dim}','${item.id}', this.value)">
                </td>
            </tr>`;
        }).join('');
    };

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };

    container.innerHTML = `
        <div class="auto-config-section">
            <h4 style="margin-bottom:12px;">${typeNames[type]}自动生成配置</h4>
            <div class="flex gap-4 flex-wrap">
                <div style="flex:1;min-width:260px;">
                    <h5 style="font-size:14px;margin-bottom:8px;">题库归属比例</h5>
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="text-align:left;">题库</th>
                                    <th style="text-align:center;">比例</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderRows(groups, 'groups', cfg.groups)}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div style="flex:1;min-width:260px;">
                    <h5 style="font-size:14px;margin-bottom:8px;">专业比例</h5>
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="text-align:left;">专业</th>
                                    <th style="text-align:center;">比例</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderRows(majors, 'majors', cfg.majors)}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div style="flex:1;min-width:260px;">
                    <h5 style="font-size:14px;margin-bottom:8px;">设备类型比例</h5>
                    <div class="table-container">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th style="text-align:left;">设备类型</th>
                                    <th style="text-align:center;">比例</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${renderRows(devices, 'devices', cfg.devices)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <p style="margin-top:8px;font-size:12px;color:var(--text-secondary);">
                比例为权重值，可为 0 或任意正整数；为空视为未设置，将按平均概率选择。
            </p>
        </div>
    `;
}

function updateAutoConfig(type, dim, id, value) {
    if (!autoGenerateConfig[type]) {
        autoGenerateConfig[type] = { groups: {}, majors: {}, devices: {} };
    }
    const cfg = autoGenerateConfig[type];
    const target = cfg[dim];
    if (!target) return;
    const v = parseInt(value, 10);
    if (isNaN(v) || v <= 0) {
        delete target[id];
    } else {
        target[id] = v;
    }
}

function viewQuestionDetail(id) {
    const q = cachedData.questions.find(item => item.id === id);
    if (!q) return;

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const getMajorName = (id) => cachedData.categories.find(c => c.id === id)?.name || id || '-';
    const getDeviceName = (id) => cachedData.categories.find(c => c.id === id)?.name || '-';
    const getGroupName = (id) => id ? (cachedData.groups.find(g => g.id === id)?.name || '未知分组') : '公共题库';

    let optionsHtml = '';
    if (q.type === 'judge') {
        const currentAnswer = (q.answer === 'true' || q.answer === true) ? 'A' : (q.answer === 'false' || q.answer === false) ? 'B' : q.answer;
        optionsHtml = `
            <div class="form-group"><label class="form-label">选项</label>
                <div class="options-grid">
                    <div class="option-row"><span class="option-label">A.</span><input type="text" class="form-input" value="正确" disabled></div>
                    <div class="option-row"><span class="option-label">B.</span><input type="text" class="form-input" value="错误" disabled></div>
                </div>
            </div>
            <div class="form-group"><label class="form-label">正确答案</label>
                <div class="p-2 bg-body border-radius-sm" style="font-weight:600;color:var(--primary);">${currentAnswer}</div>
            </div>`;
    } else {
        const opts = q.options || [];
        optionsHtml = `
            <div class="form-group"><label class="form-label">选项</label>
                <div class="options-grid">
                    ${opts.map((o, i) => `
                        <div class="option-row">
                            <span class="option-label">${'ABCDEFGH'[i]}.</span>
                            <div class="form-input bg-body" style="min-height:38px;height:auto;padding:8px 12px;opacity:0.8;">${escapeHtml(o)}</div>
                        </div>`).join('')}
                </div>
            </div>
            <div class="form-group"><label class="form-label">正确答案</label>
                <div class="p-2 bg-body border-radius-sm" style="font-weight:600;color:var(--primary);">${Array.isArray(q.answer) ? q.answer.join(',') : q.answer}</div>
            </div>`;
    }

    const html = `
        <div class="view-question-detail" style="max-height: 70vh; overflow-y: auto; padding-right: 8px;">
            <div style="display:flex;gap:16px;margin-bottom:12px;">
                <div class="form-group" style="flex:1;margin-bottom:0;">
                    <label class="form-label">专业</label>
                    <div class="p-2 bg-body border-radius-sm">${escapeHtml(getMajorName(q.category))}</div>
                </div>
                <div class="form-group" style="flex:1;margin-bottom:0;">
                    <label class="form-label">设备类型</label>
                    <div class="p-2 bg-body border-radius-sm">${escapeHtml(getDeviceName(q.deviceType))}</div>
                </div>
            </div>
            <div style="display:flex;gap:16px;margin-bottom:12px;">
                <div class="form-group" style="flex:1;margin-bottom:0;">
                    <label class="form-label">题库归属</label>
                    <div class="p-2 bg-body border-radius-sm">${escapeHtml(getGroupName(q.groupId))}</div>
                </div>
                <div class="form-group" style="flex:1;margin-bottom:0;">
                    <label class="form-label">题型</label>
                    <div class="p-2 bg-body border-radius-sm">${typeNames[q.type]}</div>
                </div>
            </div>
            <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label">题目内容</label>
                <div class="p-3 bg-body border-radius-sm" style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(q.content)}</div>
            </div>
            ${optionsHtml}
            <div class="form-group" style="margin-bottom:0;opacity:0.6;font-size:12px;">
                <label class="form-label">最后修改</label>
                <div>${formatFullDateTime(q.updatedAt)}</div>
            </div>
        </div>
    `;

    openModal('查看题目详情', html, '<button class="btn btn-primary" onclick="closeModal()">确定</button>');
}

async function generatePaperFromSelection() {
    const name = document.getElementById('paper-name').value.trim();
    const shuffleQuestions = document.getElementById('paper-shuffle-questions')?.checked || false;
    const shuffleOptions = document.getElementById('paper-shuffle-options')?.checked || false;
    const passScoreVal = document.getElementById('paper-pass-score')?.value;
    const passScore = passScoreVal === '' ? 0 : Number(passScoreVal);

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };

    for (const rule of paperRules) {
        const selectedIds = selectedQuestions[rule.type] || [];
        const count = selectedIds.length;
        if (count !== rule.count) {
            showAlert(`${typeNames[rule.type]}需要选择${rule.count}题，当前已选${count}题`);
            return;
        }

        const mustCount = rule.mustCount || 0;
        if (mustCount > 0) {
            const mustSelected = selectedIds.filter(id => {
                const q = cachedData.questions.find(item => item.id === id);
                return q && q.must === 1;
            }).length;
            if (mustSelected < mustCount) {
                showAlert(`${typeNames[rule.type]}至少需要选择${mustCount}道必考题，当前仅选择${mustSelected}道`);
                return;
            }
        }
    }

    const paper = {
        name,
        rules: paperRules,
        questions: selectedQuestions,
        published: false,
        shuffleQuestions,
        shuffleOptions,
        passScore
    };

    if (currentEditingPaperId) {
        await Storage.updatePaper({ ...paper, id: currentEditingPaperId });
        showAlert('试卷更新成功！');
    } else {
        await Storage.addPaper(paper);
        showAlert('试卷创建成功！');
    }
    cancelPaperEdit();
    await refreshCache();
    loadPapers();
}

function autoGeneratePaper() {
    if (!rulesValidated) { showAlert('请先校验试卷规则'); return; }

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };

    let html = '<div class="flex gap-3 mb-4">';
    paperRules.forEach(rule => {
        if (!autoGenerateConfig[rule.type]) {
            autoGenerateConfig[rule.type] = { groups: {}, majors: {}, devices: {} };
        }
        html += `<button class="btn btn-secondary" data-type="${rule.type}" onclick="safeOnclick(this, 'showAutoConfig', ['type'])">
            ${typeNames[rule.type]}
        </button>`;
    });
    html += '</div>';
    html += '<div id="auto-config-area"></div>';

    const container = document.getElementById('auto-generate-content');
    if (container) container.innerHTML = html;
    const area = document.getElementById('auto-generate-area');
    if (area) area.classList.remove('hidden');
    const manualArea = document.getElementById('manual-select-area');
    if (manualArea) manualArea.classList.add('hidden');
}

async function doAutoGeneratePaper() {
    if (!rulesValidated) { showAlert('请先校验试卷规则'); return; }

    const name = document.getElementById('paper-name').value.trim();
    if (!name) { showAlert('请输入试卷名称'); return; }
    const shuffleQuestions = document.getElementById('paper-shuffle-questions')?.checked || false;
    const shuffleOptions = document.getElementById('paper-shuffle-options')?.checked || false;
    const passScoreVal = document.getElementById('paper-pass-score')?.value;
    const passScore = passScoreVal === '' ? 0 : Number(passScoreVal);

    const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const allQuestionsPool = cachedData.questions;
    const autoSelected = {};

    const getDimWeight = (map, key) => {
        if (!map || Object.keys(map).length === 0) return 1;
        if (!key) return 1;
        const w = map[key];
        return typeof w === 'number' && w > 0 ? w : 1;
    };

    const pickWeighted = (list, cfg, count) => {
        if (!list.length || count <= 0) return [];
        if (list.length <= count) return list.map(q => q.id);
        const items = list.slice();
        const weights = items.map(q =>
            getDimWeight(cfg.groups, q.groupId || 'public') *
            getDimWeight(cfg.majors, q.category) *
            getDimWeight(cfg.devices, q.deviceType)
        );
        const selected = [];
        for (let n = 0; n < count && items.length; n++) {
            let total = 0;
            for (let i = 0; i < weights.length; i++) total += weights[i];
            let index = 0;
            if (total <= 0) {
                index = Math.floor(Math.random() * items.length);
            } else {
                let r = Math.random() * total;
                for (let i = 0; i < weights.length; i++) {
                    r -= weights[i];
                    if (r <= 0) {
                        index = i;
                        break;
                    }
                }
            }
            selected.push(items[index].id);
            items.splice(index, 1);
            weights.splice(index, 1);
        }
        return selected;
    };

    for (const rule of paperRules) {
        const pool = allQuestionsPool.filter(q => q.type === rule.type);
        const totalCount = rule.count || 0;
        const mustCount = rule.mustCount || 0;

        if (pool.length < totalCount) {
            showAlert(typeNames[rule.type] + '数量不足，无法自动生成');
            return;
        }

        const mustPool = pool.filter(q => q.must === 1);
        if (mustCount > mustPool.length) {
            showAlert(typeNames[rule.type] + '必考题数量不足，无法自动生成');
            return;
        }

        const cfg = autoGenerateConfig[rule.type] || { groups: {}, majors: {}, devices: {} };
        autoGenerateConfig[rule.type] = cfg;

        const selectedIds = [];
        if (mustCount > 0) {
            const mustSelected = pickWeighted(mustPool, cfg, mustCount);
            if (mustSelected.length < mustCount) {
                showAlert(typeNames[rule.type] + '必考题数量不足，无法自动生成');
                return;
            }
            selectedIds.push(...mustSelected);
        }

        const remaining = totalCount - selectedIds.length;
        if (remaining > 0) {
            const remainingPool = pool.filter(q => !selectedIds.includes(q.id));
            if (remainingPool.length < remaining) {
                showAlert(typeNames[rule.type] + '数量不足，无法自动生成');
                return;
            }
            const moreSelected = pickWeighted(remainingPool, cfg, remaining);
            if (moreSelected.length < remaining) {
                showAlert(typeNames[rule.type] + '数量不足，无法自动生成');
                return;
            }
            selectedIds.push(...moreSelected);
        }

        autoSelected[rule.type] = selectedIds;
    }

    selectedQuestions = autoSelected;

    const paper = {
        name,
        rules: paperRules,
        questions: autoSelected,
        published: false,
        shuffleQuestions,
        shuffleOptions,
        passScore
    };

    if (currentEditingPaperId) {
        await Storage.updatePaper({ ...paper, id: currentEditingPaperId });
        showAlert('试卷更新成功！');
    } else {
        await Storage.addPaper(paper);
        showAlert('试卷创建成功！');
    }
    cancelPaperEdit();
    await refreshCache();
    loadPapers();
}

async function publishPaper(paperId) {
    const groupItems = document.querySelectorAll('#selector-groups .selector-item.selected');
    const userItems = document.querySelectorAll('#selector-users .selector-item.selected');

    const targetGroups = Array.from(groupItems).map(item => item.dataset.id);
    const targetUsers = Array.from(userItems).map(item => item.dataset.id);
    const startVal = document.getElementById('publish-startTime').value;
    const deadlineVal = document.getElementById('publish-deadline').value;

    if (!targetGroups.length && !targetUsers.length) {
        showAlert('请至少选择一个目标分组或目标用户');
        return;
    }
    if (!startVal) {
        showAlert('请选择开始时间');
        return;
    }
    if (!deadlineVal) {
        showAlert('请选择截止时间');
        return;
    }

    const startTime = startVal.replace('T', ' ');
    const deadline = deadlineVal.replace('T', ' ');
    await Storage.publishPaper(paperId, targetGroups, targetUsers, startTime, deadline);
    closeModal();
    await refreshCache();
    loadPapers();
    showAlert('试卷推送成功！');
}

function showPublishModal(paperId) {
    const paper = cachedData.papers.find(p => p.id === paperId);
    let groups = cachedData.groups;
    let users = cachedData.users.filter(u => u.role === 'student');
    const currentUser = Storage.getCurrentUser();

    // 如果是分组管理员，只能推送给自己组
    if (currentUser.role === 'group_admin') {
        groups = groups.filter(g => g.id === currentUser.groupId);
        users = users.filter(u => u.groupId === currentUser.groupId);
    }

    // 预填充已选分组和截止时间
    const currentGroups = paper?.targetGroups || [];
    const currentUsers = paper?.targetUsers || [];

    // 默认开始时间为当前时间，截止时间为当前时间+3天
    let defaultStartTime = "";
    let defaultDeadline = "";
    const now = new Date();
    if (paper?.startTime) {
        defaultStartTime = paper.startTime.replace(' ', 'T');
    } else {
        defaultStartTime = now.toISOString().slice(0, 16);
    }
    if (paper?.deadline) {
        defaultDeadline = paper.deadline.replace(' ', 'T');
    } else {
        const future = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        defaultDeadline = future.toISOString().slice(0, 16);
    }

    const bodyHtml = `
        <div class="publish-grid">
            <div class="selector-column">
                <label class="form-label">推送到分组</label>
                <div class="selector-container" id="selector-groups">
                    <div class="selector-search">
                        <input type="text" class="form-input" placeholder="搜索分组..." onkeyup="filterSelectorItems('selector-groups', this.value)">
                    </div>
                    <div class="selector-list">
                        ${groups.map(g => `
                            <div class="selector-item ${currentGroups.includes(g.id) ? 'selected' : ''}" data-id="${g.id}" data-name="${g.name.toLowerCase()}" onclick="toggleSelectorItem(this)">
                                <div class="selector-checkbox"></div>
                                <div class="selector-item-info">
                                    <div class="selector-item-name">${escapeHtml(g.name)}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            <div class="selector-column">
                <label class="form-label">推送到特定用户</label>
                <div class="selector-container" id="selector-users">
                    <div class="selector-search">
                        <input type="text" class="form-input" placeholder="搜索用户..." onkeyup="filterSelectorItems('selector-users', this.value)">
                    </div>
                    <div class="selector-list">
                        ${users.map(u => {
        const groupName = groups.find(g => g.id === u.groupId)?.name || '未分组';
        return `
                                <div class="selector-item ${currentUsers.includes(u.id) ? 'selected' : ''}" data-id="${u.id}" data-name="${u.username.toLowerCase()} ${groupName.toLowerCase()}" onclick="toggleSelectorItem(this)">
                                    <div class="selector-checkbox"></div>
                                    <div class="selector-item-info">
                                        <div class="selector-item-name">${escapeHtml(u.username)}</div>
                                        <div class="selector-item-desc">${escapeHtml(groupName)}</div>
                                    </div>
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>
            </div>
        </div>
        <div class="form-group" style="margin-top:20px;">
            <div style="display:flex;gap:12px;">
                <div style="flex:1;">
                    <label class="form-label">开始时间 (日期+时间)</label>
                    <input type="datetime-local" class="form-input" id="publish-startTime" value="${defaultStartTime}">
                </div>
                <div style="flex:1;">
                    <label class="form-label">截止时间 (日期+时间)</label>
                    <input type="datetime-local" class="form-input" id="publish-deadline" value="${defaultDeadline}">
                </div>
            </div>
        </div>
    `;

    openModal('推送试卷 - ' + paper.name, bodyHtml, `
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" data-id="${paperId}" onclick="safeOnclick(this, 'publishPaper', ['id'])">确认推送</button>
    `);
}

function toggleSelectorItem(item) {
    item.classList.toggle('selected');
}

function filterSelectorItems(containerId, query) {
    const container = document.getElementById(containerId);
    const items = container.querySelectorAll('.selector-item');
    const lowerQuery = query.toLowerCase();

    items.forEach(item => {
        const name = item.dataset.name;
        if (name.includes(lowerQuery)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
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
    const passScore = data.passScore != null ? Number(data.passScore) : 0;
    const totalAssigned = data.totalAssigned || ranking.length || 0;

    if (!ranking.length) {
        container.innerHTML = '<div class="empty-state"><h3>暂无考试记录</h3></div>';
        return;
    }

    const headerHtml = `
    <div class="rank-header">
        <div class="rank-col-rank">排名</div>
        <div class="rank-col-name">答题用户</div>
        <div class="rank-col-score">得分</div>
        <div class="rank-col-result">成绩</div>
        <div class="rank-col-time">用时</div>
        <div class="rank-col-datetime">交卷时间</div>
        <div class="rank-col-action">阅卷查看</div>
    </div>`;

    const itemsHtml = ranking.map(r => {
        const passed = passScore > 0 ? r.score >= passScore : true;
        const label = passed ? '及格' : '不及格';
        const cls = passed ? 'text-success' : 'text-danger';
        const rankContent = r.rank <= 3
            ? `<span class="rank-badge rank-${r.rank}">${r.rank}</span>`
            : `${r.rank}/${totalAssigned}`;
        return `
    <div class="rank-item">
        <div class="rank-col-rank">${rankContent}</div>
        <div class="rank-col-name">${escapeHtml(r.username || '')}</div>
        <div class="rank-col-score"><strong>${r.score}</strong></div>
        <div class="rank-col-result"><span class="${cls}">${label}</span></div>
        <div class="rank-col-time">${formatDuration(r.totalTime, true)}</div>
        <div class="rank-col-datetime">${formatFullDateTime(r.submitDate)}</div>
        <div class="rank-col-action">
            <button class="btn btn-sm btn-secondary" data-record-id="${r.id}" onclick="safeOnclick(this, 'showExamRecordDetail', ['recordId'])">查看详情</button>
        </div>
    </div>`;
    }).join('');

    container.innerHTML = `<div class="ranking-list">${headerHtml}${itemsHtml}</div>`;
}

async function showExamRecordDetail(el, recordId) {
    if (!recordId) return;
    const btn = el;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '加载中...';
    try {
        const detail = await Storage.getExamRecord(recordId);
        if (!detail || !detail.questions || !detail.questions.length) {
            showAlert('未找到该次考试的详细记录');
            return;
        }

        const typeNames = {
            single: '单选题',
            multiple: '多选题',
            judge: '判断题'
        };

        const normalizeAnswerList = (value) => {
            if (value === null || value === undefined) return [];
            if (Array.isArray(value)) return value.map(String);
            const str = String(value).trim();
            if (!str) return [];
            const parts = str.split(/[,，]/).map(s => s.trim()).filter(Boolean);
            if (parts.length > 1) return parts;
            return [str];
        };

        const renderAnswerText = (value) => {
            const list = normalizeAnswerList(value);
            if (!list.length) return '未作答';
            return list.join('、');
        };

        const summary = detail.summary || {};
        const username = detail.user && detail.user.username ? detail.user.username : '';
        const paperName = detail.paper && detail.paper.name ? detail.paper.name : '';
        const passScore = summary.passScore != null
            ? Number(summary.passScore)
            : (detail.paper && detail.paper.passScore != null ? Number(detail.paper.passScore) : 0);
        const scoreValue = summary.score != null ? Number(summary.score) : null;
        let passedFlag = null;
        if (scoreValue != null) {
            if (passScore > 0) {
                passedFlag = scoreValue >= passScore;
            } else {
                passedFlag = true;
            }
        }

        let resultHtml = '';
        if (passedFlag === true) {
            resultHtml = `<span class="exam-detail-summary-result exam-detail-summary-result-pass">已及格</span>`;
        } else if (passedFlag === false) {
            resultHtml = `<span class="exam-detail-summary-result exam-detail-summary-result-fail">未及格</span>`;
        }

        const headerHtml = `
            <div class="exam-detail-summary">
                <div class="exam-detail-summary-main">
                    <div class="exam-detail-summary-title">
                        <span class="exam-detail-summary-paper">${escapeHtml(paperName)}</span>
                        <span class="exam-detail-summary-user">考生：${escapeHtml(username)}</span>
                        ${resultHtml}
                    </div>
                    <div class="exam-detail-summary-meta">
                        <span>总分：<strong>${summary.score != null ? summary.score : '-'}</strong></span>
                        <span>用时：${summary.totalTime != null ? formatDuration(summary.totalTime, true) : '-'}</span>
                        <span>交卷时间：${summary.submitDate ? formatFullDateTime(summary.submitDate) : '-'}</span>
                        <span>题目数：${summary.totalQuestions != null ? summary.totalQuestions : (detail.questions ? detail.questions.length : 0)}</span>
                    </div>
                </div>
            </div>
        `;

        const questionsHtml = detail.questions.map((q, index) => {
            const questionIndex = index + 1;
            const typeLabel = typeNames[q.type] || '';

            const correctList = normalizeAnswerList(q.correctAnswer);

            const optionsHtml = (q.options || []).map(opt => {
                const isCorrectOption = correctList.includes(String(opt.label));
                const optionClass = isCorrectOption ? 'exam-option exam-option-correct' : 'exam-option';
                return `
                    <div class="${optionClass}">
                        <span class="exam-option-label">${escapeHtml(opt.label || '')}</span>
                        <span class="exam-option-text">${escapeHtml(opt.text || '')}</span>
                    </div>
                `;
            }).join('');

            const studentText = renderAnswerText(q.studentAnswer);
            const correctText = renderAnswerText(q.correctAnswer);
            const isCorrect = !!q.isCorrect;
            const answerRowClass = isCorrect ? 'exam-answer-row exam-answer-correct' : 'exam-answer-row exam-answer-wrong';

            return `
                <div class="exam-question-block">
                    <div class="exam-question-row exam-question-title">
                        <span class="exam-question-index">${questionIndex}.</span>
                        <span class="exam-question-type">${typeLabel ? '【' + typeLabel + '】' : ''}</span>
                        <span class="exam-question-content">${escapeHtml(q.content || '')}</span>
                    </div>
                    <div class="exam-question-row exam-question-options">
                        ${optionsHtml || '<span class="exam-no-options">本题无选项</span>'}
                    </div>
                    <div class="${answerRowClass}">
                        <span class="exam-answer-text">考生答案：${escapeHtml(studentText)}</span>
                        <span class="exam-answer-text">正确答案：${escapeHtml(correctText)}</span>
                        <span class="exam-answer-score">本题得分：<strong>${q.score != null ? q.score : 0}</strong> / ${q.maxScore != null ? q.maxScore : '-'}</span>
                    </div>
                </div>
            `;
        }).join('');

        const bodyHtml = `
            <div class="exam-detail-container">
                ${headerHtml}
                <div class="exam-detail-questions">
                    ${questionsHtml}
                </div>
            </div>
        `;

        openModal('阅卷详情 - ' + escapeHtml(paperName || ''), bodyHtml, `
            <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
        `);
    } catch (e) {
        console.error('加载考试详情失败', e);
        showAlert('加载考试详情失败，请稍后重试');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}


// ========== 导入导出功能 ==========

// 根据所选题库，从题目数据中提取该题库下实际存在的专业列表
function getGroupMajors(groupId) {
    let questions = cachedData.questions;
    if (groupId === 'public') {
        questions = questions.filter(q => !q.groupId);
    } else if (groupId !== 'all') {
        questions = questions.filter(q => q.groupId === groupId);
    }
    // 提取该范围内所有不重复的 category ID
    const majorIds = [...new Set(questions.map(q => q.category).filter(Boolean))];
    // 从 categories 中过滤出对应的专业
    const allMajors = cachedData.categories.filter(c => c.type === 'major');
    if (groupId === 'all') return allMajors;
    return allMajors.filter(m => majorIds.includes(m.id));
}

// 通用：更新专业下拉框内容
function updateMajorSelect(majorSelectId, deviceSelectId, groupId) {
    const majorSelect = document.getElementById(majorSelectId);
    const deviceSelect = document.getElementById(deviceSelectId);
    if (!majorSelect) return;

    const majors = getGroupMajors(groupId);
    let optHtml = `<option value="all">全部专业</option>`;
    majors.forEach(m => {
        optHtml += `<option value="${m.id}">${escapeHtml(m.name)}</option>`;
    });
    majorSelect.innerHTML = optHtml;

    // 重置设备类型
    if (deviceSelect) {
        deviceSelect.innerHTML = `<option value="all">全部设备类型</option>`;
        deviceSelect.disabled = true;
        deviceSelect.style.opacity = '0.5';
    }
}

// 通用：更新设备类型下拉框内容
function updateDeviceSelect(deviceSelectId, majorId) {
    const deviceSelect = document.getElementById(deviceSelectId);
    if (!deviceSelect) return;

    if (majorId === 'all') {
        deviceSelect.innerHTML = `<option value="all">全部设备类型</option>`;
        deviceSelect.disabled = true;
        deviceSelect.style.opacity = '0.5';
    } else {
        const devices = cachedData.categories.filter(c => c.type === 'device' && c.parentId === majorId);
        let optHtml = `<option value="all">全部设备类型</option>`;
        devices.forEach(d => {
            optHtml += `<option value="${d.id}">${escapeHtml(d.name)}</option>`;
        });
        deviceSelect.innerHTML = optHtml;
        deviceSelect.disabled = false;
        deviceSelect.style.opacity = '1';
    }
}

// 导出弹窗：题库变更 → 级联更新专业
function onExportGroupChange() {
    const groupId = document.getElementById('export-group-select').value;
    updateMajorSelect('export-major-select', 'export-device-select', groupId);
}

// 导出弹窗：专业变更 → 级联更新设备类型
function onExportMajorChange() {
    const majorId = document.getElementById('export-major-select').value;
    updateDeviceSelect('export-device-select', majorId);
}

async function handleExportClick() {
    const user = Storage.getCurrentUser();
    const isSuper = user.role === 'super_admin';
    const groups = cachedData.groups;

    // 题库选择
    let groupOptionsHtml = '';
    if (isSuper) {
        groupOptionsHtml += `<option value="all">所有题库 (每个题库独立导出)</option>`;
        groupOptionsHtml += `<option value="public">公共题库</option>`;
        groups.forEach(g => {
            groupOptionsHtml += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
        });
    } else {
        const myGroup = groups.find(g => g.id === user.groupId);
        if (myGroup) {
            groupOptionsHtml += `<option value="${myGroup.id}">${escapeHtml(myGroup.name)}</option>`;
        }
    }

    // 专业选择
    const majors = cachedData.categories.filter(c => c.type === 'major');
    let majorOptionsHtml = `<option value="all">全部专业</option>`;
    majors.forEach(m => {
        majorOptionsHtml += `<option value="${m.id}">${escapeHtml(m.name)}</option>`;
    });

    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">请选择要导出的题库</label>
            <select id="export-group-select" class="form-input" onchange="onExportGroupChange()">
                ${groupOptionsHtml}
            </select>
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label class="form-label">专业筛选</label>
            <select id="export-major-select" class="form-input" onchange="onExportMajorChange()">
                ${majorOptionsHtml}
            </select>
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label class="form-label">设备类型筛选</label>
            <select id="export-device-select" class="form-input" disabled style="opacity:0.5;">
                <option value="all">全部设备类型</option>
            </select>
        </div>
        <div style="margin-top:16px;font-size:13px;color:var(--text-secondary);line-height:1.6;">
            * 选择"全部专业"或"全部设备类型"时将导出该范围下的所有题目。<br>
            * 导出文件将以"题库名_专业_设备_时间"格式命名，便于归档管理。<br>
            * 若导出结果为空，文件中仍保留标准表头与填写说明，可直接用于导入模板。
        </div>
    `;

    openModal('导出题库', bodyHtml, `
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="executeExport()">开始导出</button>
    `);
}

// 生成规范化的时间戳字符串：YYYYMMDD_HHmmss
function formatExportTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// 构建导出文件名
function buildExportFileName(groupName, majorName, deviceName) {
    const timeStr = formatExportTimestamp();
    let parts = [groupName];
    if (majorName && majorName !== '全部专业') parts.push(majorName);
    if (deviceName && deviceName !== '全部设备类型') parts.push(deviceName);
    parts.push(timeStr);
    // 清理文件名中的非法字符
    return parts.join('_').replace(/[\\/:*?"<>|]/g, '_') + '.xlsx';
}

async function executeExport() {
    const groupId = document.getElementById('export-group-select').value;
    const majorId = document.getElementById('export-major-select').value;
    const deviceId = document.getElementById('export-device-select').value;

    const majorSelect = document.getElementById('export-major-select');
    const deviceSelect = document.getElementById('export-device-select');
    const majorName = majorSelect.options[majorSelect.selectedIndex].text;
    const deviceName = deviceSelect.options[deviceSelect.selectedIndex].text;

    const btn = document.querySelector('#modal-footer .btn-primary');
    btn.disabled = true;
    btn.textContent = '导出中...';

    const filterOpts = { majorId, deviceId, majorName, deviceName };

    try {
        if (groupId === 'all') {
            const zip = new JSZip();
            // 导出所有，包括公共和每个分组
            await exportQuestionsByGroup('public', '公共题库', filterOpts, zip);
            for (const g of cachedData.groups) {
                await exportQuestionsByGroup(g.id, g.name, filterOpts, zip);
            }

            const content = await zip.generateAsync({ type: "blob" });
            const timeStr = formatExportTimestamp();
            let zipName = '全量题库备份';
            if (majorName !== '全部专业') zipName += '_' + majorName;
            if (deviceName !== '全部设备类型') zipName += '_' + deviceName;
            zipName += '_' + timeStr + '.zip';
            zipName = zipName.replace(/[\\/:*?"<>|]/g, '_');

            // 下载 ZIP 文件
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = zipName;
            link.click();
        } else if (groupId === 'public') {
            await exportQuestionsByGroup('public', '公共题库', filterOpts);
        } else {
            const g = cachedData.groups.find(group => group.id === groupId);
            await exportQuestionsByGroup(groupId, g ? g.name : '未知题库', filterOpts);
        }
        closeModal();
    } catch (e) {
        console.error(e);
        showAlert('导出失败: ' + e.message);
        btn.disabled = false;
        btn.textContent = '开始导出';
    }
}

// 为空模板的表头添加批注说明
function addHeaderComments(ws, headerRow, sheetType) {
    const comments = {
        '专业': '必填。填写系统中已存在的专业名称，例如"电气"。',
        '设备类型': '必填。填写该专业下已存在的设备类型名称，例如"变压器"。',
        '题库归属': '必填。填写题库名称，公共题库请填"公共题库"。',
        '是否必考': '选填。填“是”或“否”，默认为“否”。标记为必考的题目在组卷时会优先选入。',
        '题目': '必填。填写完整的题目内容。',
        '正确答案': sheetType === 'judge'
            ? '必填。判断题填 A（正确）或 B（错误）。'
            : sheetType === 'multiple'
                ? '必填。多选题用英文逗号分隔，例如 A,B,D。'
                : '必填。单选题填写选项字母，例如 A。',
        '选项A': sheetType === 'judge' ? '判断题固定为"正确"，无需修改。' : '必填。填写选项 A 的内容。',
        '选项B': sheetType === 'judge' ? '判断题固定为"错误"，无需修改。' : '必填。填写选项 B 的内容。',
        '选项C': '选填。如有第三个选项，填写选项 C 的内容。',
        '选项D': '选填。如有第四个选项，填写选项 D 的内容。'
    };

    headerRow.forEach((colName, colIdx) => {
        if (comments[colName]) {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c: colIdx });
            if (!ws[cellRef]) ws[cellRef] = { t: 's', v: colName };

            // hidden 属性设置在批注数组上（而非单个对象上），
            // 使 Excel 默认只显示红色小三角，鼠标悬停时才弹出批注。
            const c = [{ t: comments[colName], a: '系统' }];
            c.hidden = true;
            ws[cellRef].c = c;
        }
    });
}

async function exportQuestionsByGroup(groupId, groupName, filterOpts = {}, zip = null) {
    const { majorId = 'all', deviceId = 'all', majorName = '全部专业', deviceName = '全部设备类型' } = filterOpts;

    let questions = cachedData.questions;
    // 按题库筛选
    if (groupId === 'public') {
        questions = questions.filter(q => !q.groupId);
    } else {
        questions = questions.filter(q => q.groupId === groupId);
    }
    // 按专业筛选
    if (majorId !== 'all') {
        questions = questions.filter(q => q.category === majorId);
    }
    // 按设备类型筛选
    if (deviceId !== 'all') {
        questions = questions.filter(q => q.deviceType === deviceId);
    }

    const types = { 'single': '单选题', 'multiple': '多选题', 'judge': '判断题' };
    const wb = XLSX.utils.book_new();

    ['single', 'multiple', 'judge'].forEach(type => {
        const typeName = types[type];
        const data = questions.filter(q => q.type === type).map(q => {
            const getCatName = (id) => cachedData.categories.find(c => c.id === id)?.name || id || '';

            const row = {
                '专业': getCatName(q.category),
                '设备类型': getCatName(q.deviceType),
                '题库归属': groupName,
                '是否必考': q.must ? '是' : '否',
                '题目': q.content,
                '正确答案': Array.isArray(q.answer) ? q.answer.join(',') :
                    (type === 'judge' ? (q.answer === 'true' ? 'A' : 'B') : q.answer)
            };

            const opts = (type === 'judge') ? ['正确', '错误'] : (q.options || []);
            opts.forEach((opt, idx) => {
                const label = '选项' + String.fromCharCode(65 + idx);
                row[label] = opt;
            });
            return row;
        });

        if (data.length > 0) {
            let maxOptions = 0;
            if (type === 'judge') {
                maxOptions = 2;
            } else {
                data.forEach(r => {
                    const keys = Object.keys(r).filter(k => k.startsWith('选项'));
                    maxOptions = Math.max(maxOptions, keys.length);
                });
            }

            const header = ['专业', '设备类型', '题库归属', '是否必考', '题目', '正确答案'];
            for (let i = 0; i < maxOptions; i++) {
                header.push('选项' + String.fromCharCode(65 + i));
            }

            const ws = XLSX.utils.json_to_sheet(data, { header });
            XLSX.utils.book_append_sheet(wb, ws, typeName);
        } else {
            // 空模板：保留标准表头并添加批注说明
            const emptyHeader = ['专业', '设备类型', '题库归属', '是否必考', '题目', '正确答案', '选项A', '选项B'];
            if (type !== 'judge') {
                emptyHeader.push('选项C', '选项D');
            }
            const ws = XLSX.utils.json_to_sheet([], { header: emptyHeader });
            addHeaderComments(ws, emptyHeader, type);
            XLSX.utils.book_append_sheet(wb, ws, typeName);
        }
    });

    if (wb.SheetNames.length > 0) {
        const fileName = buildExportFileName(groupName, majorName, deviceName);

        if (zip) {
            const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            zip.file(fileName, excelBuffer);
        } else {
            XLSX.writeFile(wb, fileName);
        }
    }
}

function exportQuestions() {
    handleExportClick();
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
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                if (rows.length < 2) continue;

                const header = rows[0];
                const getColIdx = (name) => header.indexOf(name);
                const idxCategory = getColIdx('专业');
                const idxDeviceType = getColIdx('设备类型');
                const idxGroup = getColIdx('题库归属');
                const idxMust = getColIdx('是否必考');
                const idxContent = getColIdx('题目');
                const idxAnswer = getColIdx('正确答案');

                if (idxCategory === -1 || idxContent === -1 || idxAnswer === -1 || idxDeviceType === -1 || idxGroup === -1) {
                    errorMsg += `工作表"${sheetName}"缺少必要列字段(专业、设备类型、题库归属、题目、正确答案)\n`;
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
                    if (!row || row.length === 0) continue;

                    const categoryRaw = row[idxCategory];
                    const content = row[idxContent];
                    const answerRaw = row[idxAnswer];
                    const deviceTypeRaw = row[idxDeviceType];
                    const groupRaw = row[idxGroup];

                    if (!categoryRaw && !content && !answerRaw && !deviceTypeRaw && !groupRaw) continue;
                    if (!categoryRaw || !content || answerRaw === undefined || !deviceTypeRaw || !groupRaw) {
                        errorMsg += `工作表"${sheetName}"第${i + 1}行缺少必要信息(专业、设备类型、题库归属、题目、正确答案)\n`;
                        continue;
                    }

                    // Resolve Group ID (Strict)
                    const groupName = String(groupRaw).trim();
                    let rowGroupId = null;
                    if (groupName === '公共题库') {
                        rowGroupId = null;
                    } else {
                        const groupObj = cachedData.groups.find(g => g.name === groupName);
                        if (!groupObj) {
                            errorMsg += `工作表"${sheetName}"第${i + 1}行错误：系统中不存在题库 "${groupName}"。\n`;
                            continue;
                        }
                        rowGroupId = groupObj.id;
                    }

                    // Validate if it matches the import target (if not importing all)
                    if (importTargetGroupId !== 'all') {
                        if (importTargetGroupId === 'public' && rowGroupId !== null) {
                            errorMsg += `工作表"${sheetName}"第${i + 1}行错误：当前选择导入到公共题库，但题目归属为 "${groupName}"。\n`;
                            continue;
                        }
                        if (importTargetGroupId !== 'public' && rowGroupId !== importTargetGroupId) {
                            errorMsg += `工作表"${sheetName}"第${i + 1}行错误：当前选择导入到 "${importTargetGroupName}"，但题目归属为 "${groupName}"。\n`;
                            continue;
                        }
                    }

                    // 专业筛选校验
                    if (importTargetMajorId !== 'all') {
                        const categoryName = String(categoryRaw).trim();
                        const targetMajorObj = cachedData.categories.find(c => c.id === importTargetMajorId);
                        if (targetMajorObj && categoryName !== targetMajorObj.name) {
                            errorMsg += `工作表"${sheetName}"第${i + 1}行错误：当前选择导入专业为 "${targetMajorObj.name}"，但题目专业为 "${categoryName}"。\n`;
                            continue;
                        }
                    }

                    // 设备类型筛选校验
                    if (importTargetDeviceId !== 'all') {
                        const deviceTypeName = String(deviceTypeRaw).trim();
                        const targetDeviceObj = cachedData.categories.find(c => c.id === importTargetDeviceId);
                        if (targetDeviceObj && deviceTypeName !== targetDeviceObj.name) {
                            errorMsg += `工作表"${sheetName}"第${i + 1}行错误：当前选择导入设备类型为 "${targetDeviceObj.name}"，但题目设备类型为 "${deviceTypeName}"。\n`;
                            continue;
                        }
                    }

                    // Resolve Category ID (Strict)
                    const categoryName = String(categoryRaw).trim();
                    const majorObj = cachedData.categories.find(c => c.type === 'major' && c.name === categoryName);

                    if (!majorObj) {
                        errorMsg += `工作表"${sheetName}"第${i + 1}行错误：找不到专业 "${categoryName}"，请先在系统设置中添加。\n`;
                        continue;
                    }
                    const categoryId = majorObj.id;

                    // Resolve Device Type ID (Strict)
                    const deviceTypeName = String(deviceTypeRaw).trim();
                    const deviceObj = cachedData.categories.find(c => c.type === 'device' && c.parentId === majorObj.id && c.name === deviceTypeName);

                    if (!deviceObj) {
                        errorMsg += `工作表"${sheetName}"第${i + 1}行错误：在专业 "${categoryName}" 下找不到设备类型 "${deviceTypeName}"。\n`;
                        continue;
                    }
                    const deviceTypeId = deviceObj.id;

                    // Parse must field
                    let must = 0;
                    if (idxMust !== -1) {
                        const mustRaw = row[idxMust];
                        if (mustRaw !== undefined && mustRaw !== null) {
                            const mustStr = String(mustRaw).trim();
                            must = ['是', '1', 'true', 'yes'].includes(mustStr.toLowerCase()) ? 1 : 0;
                        }
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
                        if (['A', '正确', 'TRUE', 'T'].includes(answer.toUpperCase())) answer = 'true';
                        else if (['B', '错误', 'FALSE', 'F'].includes(answer.toUpperCase())) answer = 'false';
                        else answer = 'true';
                    } else {
                        answer = answer.toUpperCase();
                    }

                    newQuestions.push({
                        type: typeAlias,
                        category: categoryId,
                        deviceType: deviceTypeId,
                        content: String(content).trim(),
                        options: options,
                        answer: answer,
                        must: must,
                        groupId: rowGroupId
                    });
                }
            }

            if (errorMsg) {
                showAlert('校验发现以下问题：<br><div style="text-align:left;max-height:300px;overflow-y:auto;margin-top:10px;background:#fff;color:#333;padding:10px;border-radius:4px;border:1px solid #ddd;">' + errorMsg.replace(/\n/g, '<br>') + '</div><br>请修正后重试。');
                input.value = '';
                return;
            }

            if (newQuestions.length === 0) {
                showAlert('未从文件中读取到有效题目。<br>请检查Sheet名称是否为(单选题, 多选题, 判断题)。');
                input.value = '';
                return;
            }

            confirmImportQuestions(newQuestions);
            input.value = '';
        } catch (e) {
            console.error(e);
            showAlert('读取文件失败，请检查文件格式');
            input.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

let importTargetGroupId = null;
let importTargetGroupName = '';
let importTargetMajorId = 'all';
let importTargetDeviceId = 'all';
let importMode = 'append'; // 'append' | 'overwrite'

// 导入弹窗：题库变更 → 级联更新专业
function onImportGroupChange() {
    const groupId = document.getElementById('import-group-select').value;
    updateMajorSelect('import-major-select', 'import-device-select', groupId);
}

// 导入弹窗：专业变更 → 级联更新设备类型
function onImportMajorChange() {
    const majorId = document.getElementById('import-major-select').value;
    updateDeviceSelect('import-device-select', majorId);
}

// 导入模式切换时更新警告提示
function onImportModeChange() {
    const mode = document.getElementById('import-mode-select').value;
    const warningBox = document.getElementById('import-mode-warning');
    if (!warningBox) return;

    if (mode === 'overwrite') {
        warningBox.style.display = 'block';
    } else {
        warningBox.style.display = 'none';
    }
}

// 下载导入模板
function downloadImportTemplate() {
    const wb = XLSX.utils.book_new();
    const types = { 'single': '单选题', 'multiple': '多选题', 'judge': '判断题' };

    ['single', 'multiple', 'judge'].forEach(type => {
        const typeName = types[type];
        const emptyHeader = ['专业', '设备类型', '题库归属', '是否必考', '题目', '正确答案', '选项A', '选项B'];
        if (type !== 'judge') {
            emptyHeader.push('选项C', '选项D');
        }
        const ws = XLSX.utils.json_to_sheet([], { header: emptyHeader });
        addHeaderComments(ws, emptyHeader, type);
        XLSX.utils.book_append_sheet(wb, ws, typeName);
    });

    const fileName = `题库导入模板_${formatExportTimestamp()}.xlsx`;
    XLSX.writeFile(wb, fileName);
}

function handleImportClick() {
    const user = Storage.getCurrentUser();
    const isSuper = user.role === 'super_admin';
    const groups = cachedData.groups;

    // 题库选择
    let groupOptionsHtml = '';
    if (isSuper) {
        groupOptionsHtml += `<option value="all">所有题库 (导入到对应题库)</option>`;
        groupOptionsHtml += `<option value="public">公共题库</option>`;
        groups.forEach(g => {
            groupOptionsHtml += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
        });
    } else {
        const myGroup = groups.find(g => g.id === user.groupId);
        if (myGroup) {
            groupOptionsHtml += `<option value="${myGroup.id}">${escapeHtml(myGroup.name)}</option>`;
        }
    }

    // 专业选择
    const majors = cachedData.categories.filter(c => c.type === 'major');
    let majorOptionsHtml = `<option value="all">全部专业</option>`;
    majors.forEach(m => {
        majorOptionsHtml += `<option value="${m.id}">${escapeHtml(m.name)}</option>`;
    });

    const bodyHtml = `
        <div class="form-group">
            <label class="form-label">请选择导入的目标题库</label>
            <select id="import-group-select" class="form-input" onchange="onImportGroupChange()">
                ${groupOptionsHtml}
            </select>
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label class="form-label">专业筛选 <span style="font-size:12px;color:var(--text-secondary);font-weight:normal;">（仅允许匹配的专业通过校验）</span></label>
            <select id="import-major-select" class="form-input" onchange="onImportMajorChange()">
                ${majorOptionsHtml}
            </select>
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label class="form-label">设备类型筛选</label>
            <select id="import-device-select" class="form-input" disabled style="opacity:0.5;">
                <option value="all">全部设备类型</option>
            </select>
        </div>
        <div class="form-group" style="margin-top:12px;">
            <label class="form-label">导入模式</label>
            <select id="import-mode-select" class="form-input" onchange="onImportModeChange()">
                <option value="append" selected>追加模式（保留现有题目，追加新题目）</option>
                <option value="overwrite">覆盖模式（清空现有题目后重新导入）</option>
            </select>
        </div>
        <div id="import-mode-warning" style="display:none;margin-top:12px;padding:12px;background:var(--bg-input);border-radius:var(--radius-md);border:2px solid var(--danger);">
            <p style="color:var(--danger);font-weight:bold;margin-bottom:8px;">⚠️ 覆盖模式高危警告：</p>
            <p style="font-size:13px;line-height:1.6;">
                覆盖模式会<span style="color:var(--danger);font-weight:bold;">彻底清空所选题库</span>中的现有数据，然后重新导入。
                此操作<span style="color:var(--danger);font-weight:bold;">不可撤销</span>！建议在操作前先导出备份。
            </p>
        </div>
        <div style="margin-top:16px;font-size:13px;color:var(--text-secondary);line-height:1.6;">
            * 选择"全部专业"或"全部设备类型"时不做专业/设备类型限制。<br>
            * 文件中的 Sheet 名称必须为：单选题、多选题、判断题。<br>
            * 如果没有模板，请点击下方按钮下载标准导入模板。
        </div>
    `;

    openModal('导入题库', bodyHtml, `
        <button class="btn btn-secondary" onclick="downloadImportTemplate()" style="margin-right:auto;">📥 下载导入模板</button>
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="proceedToImportFile()">选择文件并导入</button>
    `);
}

function proceedToImportFile() {
    const select = document.getElementById('import-group-select');
    importTargetGroupId = select.value;
    importTargetGroupName = select.options[select.selectedIndex].text;

    const majorSelect = document.getElementById('import-major-select');
    importTargetMajorId = majorSelect.value;

    const deviceSelect = document.getElementById('import-device-select');
    importTargetDeviceId = deviceSelect.value;

    const modeSelect = document.getElementById('import-mode-select');
    importMode = modeSelect.value;

    closeModal();
    setTimeout(() => {
        document.getElementById('file-import').click();
    }, 200);
}

function confirmImportQuestions(newQuestions) {
    const isOverwrite = importMode === 'overwrite';

    let messageHtml;
    let confirmText;
    let confirmType;

    if (isOverwrite) {
        messageHtml = `解析成功，共${newQuestions.length}道题。<br>目标题库：<strong>${importTargetGroupName}</strong><br>导入模式：<span style="color:var(--danger);font-weight:bold;">覆盖模式</span><br><br><span style="color:var(--danger);font-weight:bold;">⚠️ 警告：这将彻底清空"${importTargetGroupName}"中的现有题目，然后重新导入！此操作不可撤销！</span>`;
        confirmText = '确认清空并导入';
        confirmType = 'danger';
    } else {
        messageHtml = `解析成功，共${newQuestions.length}道题。<br>目标题库：<strong>${importTargetGroupName}</strong><br>导入模式：<span style="color:var(--success);font-weight:bold;">追加模式</span><br><br>新题目将追加到现有题库中，不会删除任何现有题目。`;
        confirmText = '确认追加导入';
        confirmType = 'primary';
    }

    showConfirmModal({
        title: '确认导入',
        message: messageHtml,
        confirmText: confirmText,
        confirmType: confirmType,
        isHtml: true,
        onConfirm: async () => {
            try {
                // 覆盖模式：先清空目标题库
                if (isOverwrite) {
                    await Storage.deleteAllQuestions(importTargetGroupId);
                }

                // 批量添加
                const batchSize = 50;
                for (let i = 0; i < newQuestions.length; i += batchSize) {
                    const batch = newQuestions.slice(i, i + batchSize);
                    await Promise.all(batch.map(q => Storage.addQuestion(q)));
                }

                if (isOverwrite) {
                    showAlert(`已清空"${importTargetGroupName}"并成功导入 ${newQuestions.length} 道题目`);
                } else {
                    showAlert(`已成功追加导入 ${newQuestions.length} 道题目到"${importTargetGroupName}"`);
                }
                closeModal();
                await refreshCache();
                loadQuestions();
            } catch (err) {
                console.error(err);
                showAlert('导入出错：' + err.message);
            }
        }
    });
}

// ========== 考试分析 ==========
function loadAdminAnalysisOptions() {
    const papers = cachedData.papers.filter(p => p.published);
    document.getElementById('analysis-paper-select').innerHTML = '<option value="">请选择要分析的试卷</option>' +
        papers.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    document.getElementById('analysis-content').innerHTML = '<div class="empty-state"><h3>请选择试卷以生成分析报告</h3></div>';
    document.getElementById('btn-clear-records').style.display = 'none';
}

async function loadAdminAnalysis(paperId) {
    const data = await Storage.getRanking(paperId);
    const ranking = data.ranking || [];
    const passScore = data.passScore != null ? Number(data.passScore) : 0;
    const totalAssigned = data.totalAssigned || 0;
    const takenCount = ranking.length;
    const notTakenCount = Math.max(0, totalAssigned - takenCount);

    if (takenCount === 0) {
        document.getElementById('analysis-content').innerHTML = `
            <div class="empty-state">
                <p>该试卷暂无考试记录。推送总人数：${totalAssigned}</p>
            </div>`;
        document.getElementById('btn-clear-records').style.display = 'none';
        const qaBtn = document.getElementById('btn-question-analysis');
        if (qaBtn) qaBtn.style.display = 'none';
        return;
    }

    const qaBtn = document.getElementById('btn-question-analysis');
    if (qaBtn) qaBtn.style.display = 'inline-block';

    // 计算统计数据
    const scores = ranking.map(r => r.score);
    const times = ranking.map(r => r.totalTime);

    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const avgScore = (scores.reduce((a, b) => a + b, 0) / takenCount).toFixed(1);

    let passCount = 0;
    if (passScore > 0) {
        passCount = ranking.filter(r => r.score >= passScore).length;
    } else {
        passCount = takenCount;
    }
    const failCount = takenCount - passCount;
    const passRate = takenCount > 0 ? ((passCount * 100) / takenCount).toFixed(1) + '%' : '0%';

    const fastestTime = Math.min(...times);
    const slowestTime = Math.max(...times);
    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / takenCount);

    const html = `
    <div class="analysis-section">
        <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">人数统计</div>
        <div class="analysis-grid" style="display:grid;grid-template-columns:repeat(8, minmax(120px, 1fr));gap:16px;">
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
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">及格人数</div>
                <div style="font-size:24px;font-weight:700;color:var(--success);">${passCount}</div>
            </div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">不及格人数</div>
                <div style="font-size:24px;font-weight:700;color:var(--danger);">${failCount}</div>
            </div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">及格率</div>
                <div style="font-size:24px;font-weight:700;color:var(--primary);">${passRate}</div>
            </div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
        </div>
    </div>
    <div class="analysis-section" style="margin-top:24px;">
        <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">得分统计</div>
        <div class="analysis-grid" style="display:grid;grid-template-columns:repeat(8, minmax(120px, 1fr));gap:16px;">
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
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
        </div>
    </div>
    <div class="analysis-section" style="margin-top:24px;">
        <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">答题时间统计</div>
        <div class="analysis-grid" style="display:grid;grid-template-columns:repeat(8, minmax(120px, 1fr));gap:16px;">
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">最快答题时间</div>
                <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${formatDuration(fastestTime, true)}</div>
            </div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">最慢答题时间</div>
                <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${formatDuration(slowestTime, true)}</div>
            </div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);">
                <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px;">平均答题时间</div>
                <div style="font-size:20px;font-weight:700;color:var(--text-primary);">${formatDuration(avgTime, true)}</div>
            </div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
            <div class="analysis-card" style="padding:20px;background:var(--bg-input);border-radius:var(--radius-md);border:1px solid var(--border);visibility:hidden;"></div>
        </div>
    </div>`;

    document.getElementById('analysis-content').innerHTML = html;
    document.getElementById('btn-clear-records').style.display = 'block';
}

async function showQuestionAccuracy() {
    const examSelectEl = document.getElementById('examSelect');
    const analysisSelectEl = document.getElementById('analysis-paper-select');
    let paperId = '';

    if (examSelectEl && examSelectEl.value) {
        paperId = examSelectEl.value;
    } else if (analysisSelectEl && analysisSelectEl.value) {
        paperId = analysisSelectEl.value;
    }

    if (!paperId) {
        showAlert('请先选择试卷');
        return;
    }
    try {
        const res = await authFetch(`${API_BASE}/api/analysis/questions/${paperId}`);
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '服务器内部错误');
        }
        const list = Array.isArray(data.questions) ? data.questions : [];
        if (list.length === 0) {
            openModal('题目正确率分析', '<div class="empty-state"><p>该试卷暂无题目统计数据</p></div>', '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
            return;
        }
        const rowsHtml = list.map((q, index) => {
            const total = q.totalCount || 0;
            const correct = q.correctCount || 0;
            const rateValue = total === 0 ? 0 : (correct * 100) / total;
            const rateText = total === 0 ? '0%' : rateValue.toFixed(1) + '%';
            const barWidth = Math.max(0, Math.min(100, rateValue));
            const isLow = barWidth < 60;
            const typeLabel = q.type === 'single' ? '单选题' : q.type === 'multiple' ? '多选题' : q.type === 'judge' ? '判断题' : q.type || '';
            const fullContent = q.content || '';
            const trimmedContent = fullContent.length > 60 ? fullContent.slice(0, 60) + '...' : fullContent;
            const rateColor = isLow ? 'var(--danger)' : 'var(--primary)';
            return `
                <tr>
                    <td style="width:64px;text-align:center;">${index + 1}</td>
                    <td title="${escapeHtml(fullContent)}" style="max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(trimmedContent)}</td>
                    <td style="width:90px;text-align:center;">${typeLabel}</td>
                    <td style="width:140px;text-align:center;">${correct} / ${total}</td>
                    <td style="min-width:200px;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div class="accuracy-bar-bg">
                                <div class="accuracy-bar-fill" style="width:${barWidth}%;"></div>
                            </div>
                            <div style="min-width:60px;text-align:right;font-variant-numeric:tabular-nums;color:${rateColor};">${rateText}</div>
                        </div>
                    </td>
                </tr>`;
        }).join('');
        const tableHtml = `
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:64px;text-align:center;">序号</th>
                            <th>题目内容</th>
                            <th style="width:90px;text-align:center;">题型</th>
                            <th style="width:140px;text-align:center;">正确次数/总次数</th>
                            <th style="min-width:200px;">正确率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>`;
        const bodyHtml = `
            <div style="max-height:60vh;overflow:auto;">
                ${tableHtml}
            </div>`;
        const footerHtml = '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>';
        openModal('题目正确率分析', bodyHtml, footerHtml);
    } catch (e) {
        console.error(e);
        showAlert('获取题目分析数据失败');
    }
}

async function clearPaperRecords() {
    const paperId = document.getElementById('analysis-paper-select').value;
    if (!paperId) return;

    clearExamRecords(paperId);
}

// 全局确认回调
let pendingConfirmCallback = null;

function showConfirmModal({ title, message, onConfirm, confirmText = '确定', confirmType = 'danger', isHtml = false }) {
    pendingConfirmCallback = onConfirm;

    const content = isHtml ? message : escapeHtml(message).replace(/\n/g, '<br>');

    const bodyHtml = `
        <div style="padding:16px 0;font-size:15px;color:var(--text-primary);line-height:1.6;">
            ${content}
        </div>
    `;
    const btnClass = confirmType === 'danger' ? 'btn-danger' : 'btn-success';
    const footerHtml = `
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn ${btnClass}" onclick="executeConfirm()">${confirmText}</button>
    `;
    openModal(title, bodyHtml, footerHtml);
}

async function executeConfirm() {
    // 获取确认按钮以显示加载状态
    const btn = document.querySelector('#modal-footer .btn-danger, #modal-footer .btn-success, #modal-footer .btn-primary');
    const originalText = btn ? btn.textContent : '确定';

    if (btn) {
        btn.textContent = '处理中...';
        btn.disabled = true;
    }

    try {
        if (pendingConfirmCallback) {
            await pendingConfirmCallback();
        }
        closeModal();
    } catch (e) {
        console.error(e);
        showAlert('操作失败，请重试');
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

// 替换原 deleteMajor
function deleteMajor(id) {
    showConfirmModal({
        title: '删除专业',
        message: '删除此专业将同时删除其下所有设备类型，确定继续？',
        confirmText: '确定删除',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deleteCategory(id);
            await refreshCache();
            if (selectedMajorId === id) {
                const remaining = cachedData.categories.filter(c => c.type === 'major');
                selectedMajorId = remaining.length > 0 ? remaining[0].id : null;
            }
            showCategorySettings();
        }
    });
}

// 替换原 deleteDevice
function deleteDevice(id) {
    showConfirmModal({
        title: '删除设备类型',
        message: '确定删除此设备类型吗？',
        confirmText: '确定删除',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deleteCategory(id);
            await refreshCache();
            document.getElementById('devices-panel').innerHTML = renderDevicesPanel();
        }
    });
}

// 替换 deleteGroup 
async function deleteGroup(id) {
    const hasUsers = cachedData.users.some(u => u.groupId === id);
    if (hasUsers) {
        showAlert('无法删除：该分组下仍有用户。请先将用户移动到其他分组或删除用户。');
        return;
    }

    showConfirmModal({
        title: '删除分组',
        message: '确定删除此分组？',
        confirmText: '确定删除',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deleteGroup(id);
            await refreshCache();
            loadGroups();
        }
    });
}

// 替换 deleteUser
async function deleteUser(id) {
    const user = cachedData.users.find(u => u.id === id);
    if (!user) return;

    let message = `确定要删除用户 <strong>${escapeHtml(user.username)}</strong> 吗？`;

    // 如果是管理员，增加严重警告
    if (user.role === 'super_admin' || user.role === 'group_admin') {
        const roleName = user.role === 'super_admin' ? '超级管理员' : '分组管理员';
        message += `<br><br><span style="color:var(--danger);font-weight:bold;">警告：该用户是${roleName}！</span><br>删除后将无法恢复，且可能影响系统管理功能。`;
    } else {
        message += '<br>删除后无法恢复。';
    }

    showConfirmModal({
        title: '删除用户',
        message: message,
        confirmText: '确定删除',
        confirmType: 'danger',
        isHtml: true,
        onConfirm: async () => {
            await Storage.deleteUser(id);
            await refreshCache();
            loadUsers();
        }
    });
}

// 替换 deleteQuestion
async function deleteQuestion(id) {
    showConfirmModal({
        title: '删除题目',
        message: '确定删除此题目？',
        confirmText: '确定删除',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deleteQuestion(id);
            await refreshCache();
            loadQuestions();
        }
    });
}

// 替换 deletePaper
async function deletePaper(id) {
    showConfirmModal({
        title: '删除试卷',
        message: '确定删除此试卷？',
        confirmText: '确定删除',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deletePaper(id);
            await refreshCache();
            loadPapers();
        }
    });
}


// 替换 clearExamRecords
async function clearExamRecords(paperId) {
    showConfirmModal({
        title: '清空考试记录',
        message: '确定要清空该试卷的所有考试记录吗？\n此操作不可撤销，且会同时清空得分及排行榜统计。',
        confirmText: '确定清空',
        confirmType: 'danger',
        onConfirm: async () => {
            await Storage.deletePaperRecords(paperId); // Changed to deletePaperRecords as per original logic
            showAlert('记录已清空');
            loadAdminAnalysis(paperId); // 刷新分析页面
        }
    });
}

// ========== 数据库管理 ==========
const DB_TYPE_NAMES = {
    sqlite: 'SQLite',
    mysql: 'MySQL',
    postgres: 'PostgreSQL'
};

async function loadDbConfig() {
    try {
        const config = await Storage.getDbConfig();
        const activeDb = config.activeDb || 'sqlite';

        // 更新状态徽章和按钮
        ['sqlite', 'mysql', 'postgres'].forEach(db => {
            const status = document.getElementById(`${db}-status`);
            const switchBtn = document.getElementById(`btn-switch-${db}`);

            if (db === activeDb) {
                // 当前激活的数据库
                if (status) {
                    status.textContent = '已连接';
                    status.style.background = 'var(--success)';
                }
                if (switchBtn) switchBtn.style.display = 'none';

                // SQLite 特殊处理：显示导入导出按钮
                if (db === 'sqlite') {
                    const exportBtn = document.getElementById('btn-export-sqlite');
                    const importBtn = document.getElementById('btn-import-sqlite');
                    if (exportBtn) exportBtn.style.display = '';
                    if (importBtn) importBtn.style.display = '';
                }
            } else {
                // 未激活的数据库
                if (status) {
                    status.textContent = '未连接';
                    status.style.background = 'var(--text-muted)';
                }
                if (switchBtn) switchBtn.style.display = '';

                // SQLite 未激活时隐藏导入导出按钮
                if (db === 'sqlite') {
                    const exportBtn = document.getElementById('btn-export-sqlite');
                    const importBtn = document.getElementById('btn-import-sqlite');
                    if (exportBtn) exportBtn.style.display = 'none';
                    if (importBtn) importBtn.style.display = 'none';
                }
            }
        });
    } catch (e) {
        console.error('加载数据库配置失败:', e);
    }
}

async function testDbConnection(dbType) {
    if (dbType === 'sqlite') {
        showAlert('SQLite 无需测试连接');
        return;
    }

    try {
        showAlert('正在测试连接...');
        const result = await Storage.testDbConnection(dbType);
        if (result.success) {
            showAlert('连接成功！');
        } else {
            showAlert('连接失败: ' + (result.error || '未知错误'));
        }
    } catch (e) {
        showAlert('测试失败: ' + e.message);
    }
}

async function switchToDb(dbType) {
    const dbName = DB_TYPE_NAMES[dbType];

    showConfirmModal({
        title: '切换数据库',
        message: `确定要切换到 <strong>${dbName}</strong> 数据库吗？<br><br><span style="color:var(--danger);">自动初始化新库结构，并尝试迁移原数据库数据，完成后需要重新登录</span>`,
        confirmText: '确认切换',
        confirmType: 'danger',
        isHtml: true,
        onConfirm: async () => {
            try {
                const result = await Storage.switchDb(dbType);
                if (result.success) {
                    showAlert(result.message + '，即将重新登录...', () => {
                        Storage.logout();
                        window.location.href = 'index.html';
                    });
                } else {
                    showAlert('切换失败: ' + (result.error || '未知错误'));
                }
            } catch (e) {
                showAlert('切换失败: ' + e.message);
            }
        }
    });
}

async function exportSqliteDb() {
    try {
        const blob = await Storage.exportDb();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exam_backup_${new Date().toISOString().split('T')[0]}.db`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert('数据库导出成功');
    } catch (e) {
        showAlert('导出失败: ' + e.message);
    }
}

async function importSqliteDb(input) {
    const file = input.files[0];
    if (!file) return;

    showConfirmModal({
        title: '导入数据库',
        message: `确定要导入 <strong>${escapeHtml(file.name)}</strong> 吗？<br><br><span style="color:var(--danger);">警告：这将完全替换当前数据库，所有现有数据将丢失！</span>`,
        confirmText: '确认导入',
        confirmType: 'danger',
        isHtml: true,
        onConfirm: async () => {
            try {
                const result = await Storage.importDb(file);
                if (result.success) {
                    showAlert(result.message, () => {
                        Storage.logout();
                        window.location.href = 'index.html';
                    });
                } else {
                    showAlert('导入失败: ' + (result.error || '未知错误'));
                }
            } catch (e) {
                showAlert('导入失败: ' + e.message);
            }
        }
    });

    // 重置 input，以便再次选择同一文件
    input.value = '';
}

// ========== 系统日志 ==========
let currentLogPage = 1;
const LOG_PAGE_SIZE = 20;

// 级联筛选配置
const LOG_TARGET_ACTIONS = {
    '': [ // 全部对象
        { value: '', label: '全部操作' },
        { value: '登录成功', label: '登录' },
        { value: '登录失败', label: '登录失败' },
        { value: '创建', label: '创建' },
        { value: '更新', label: '更新' },
        { value: '删除', label: '删除' },
        { value: '发布', label: '发布' },
        { value: '切换', label: '切换' },
        { value: '清空', label: '清空' }
    ],
    'user': [
        { value: '', label: '全部操作' },
        { value: '登录成功', label: '登录' },
        { value: '登录失败', label: '登录失败' },
        { value: '创建用户', label: '创建用户' },
        { value: '更新用户', label: '更新用户' },
        { value: '删除用户', label: '删除用户' },
        { value: '修改密码', label: '修改密码' }
    ],
    'question': [
        { value: '', label: '全部操作' },
        { value: '创建题目', label: '创建题目' },
        { value: '更新题目', label: '更新题目' },
        { value: '删除题目', label: '删除题目' },
        { value: '删除所有题目', label: '清空题库' }
    ],
    'paper': [
        { value: '', label: '全部操作' },
        { value: '创建试卷', label: '创建试卷' },
        { value: '更新试卷', label: '更新试卷' },
        { value: '发布试卷', label: '发布试卷' },
        { value: '删除试卷', label: '删除试卷' }
    ],
    'database': [
        { value: '', label: '全部操作' },
        { value: '切换数据库', label: '切换数据库' }
    ],
    'logs': [
        { value: '', label: '全部操作' },
        { value: '清空日志', label: '清空日志' }
    ]
};

function initLogFilterOptions() {
    const targetFilter = document.getElementById('log-target-filter');
    if (!targetFilter) return;

    const targets = [
        { value: '', label: '全部对象' },
        { value: 'user', label: '用户' },
        { value: 'question', label: '题目' },
        { value: 'paper', label: '试卷' },
        { value: 'database', label: '数据库' },
        { value: 'logs', label: '日志' }
    ];

    targetFilter.innerHTML = targets.map(t =>
        `<option value="${t.value}">${t.label}</option>`
    ).join('');

    updateLogActionOptions();
}

function updateLogActionOptions() {
    const targetFilter = document.getElementById('log-target-filter');
    const actionFilter = document.getElementById('log-action-filter');
    const selectedTarget = targetFilter ? targetFilter.value : '';
    const currentAction = actionFilter ? actionFilter.value : '';

    if (!actionFilter) return;

    const options = LOG_TARGET_ACTIONS[selectedTarget] || LOG_TARGET_ACTIONS[''];

    // 保留当前选中的值（如果由于切换对象导致当前动作不可用，则重置为''）
    let newAction = '';
    const isAvailable = options.some(opt => opt.value === currentAction);
    if (isAvailable) newAction = currentAction;

    actionFilter.innerHTML = options.map(opt =>
        `<option value="${opt.value}">${opt.label}</option>`
    ).join('');

    actionFilter.value = newAction;
    loadSystemLogs(1); // 触发重新加载，重置页码为1
}

// 绑定级联事件
document.addEventListener('DOMContentLoaded', () => {
    const targetSelect = document.getElementById('log-target-filter');
    if (targetSelect) {
        // 移除原有的 onchange="loadSystemLogs()"，改为调用 updateLogActionOptions
        targetSelect.removeAttribute('onchange');
        targetSelect.addEventListener('change', updateLogActionOptions);
    }
});

async function loadSystemLogs(page = 1) {
    currentLogPage = page;

    const params = {
        page,
        pageSize: LOG_PAGE_SIZE
    };

    // 获取筛选条件
    const actionFilter = document.getElementById('log-action-filter')?.value;
    const targetFilter = document.getElementById('log-target-filter')?.value;

    if (actionFilter) params.action = actionFilter;
    if (targetFilter) params.target = targetFilter;

    try {
        const result = await Storage.getSystemLogs(params);
        renderSystemLogs(result.logs);
        renderLogsPagination(result);
    } catch (e) {
        console.error('加载日志失败:', e);
        document.getElementById('logs-list').innerHTML = '<div class="empty-state"><p>加载日志失败</p></div>';
    }
}

function renderSystemLogs(logs) {
    const container = document.getElementById('logs-list');

    if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>暂无日志记录</p></div>';
        return;
    }

    const actionLabels = {
        'login': '登录',
        '登录成功': '登录',
        'login_failed': '登录失败',
        '登录失败': '登录失败',
        'create': '创建',
        '创建': '创建',
        'update': '更新',
        '更新': '更新',
        'delete': '删除',
        '删除': '删除',
        'delete_all': '批量删除',
        '批量删除': '批量删除',
        'publish': '发布',
        '发布': '发布',
        'switch': '切换',
        '切换': '切换',
        'clear': '清空',
        '清空': '清空',
        '创建用户': '创建用户',
        '更新用户': '更新用户',
        '删除用户': '删除用户',
        '修改密码': '修改密码',
        '创建题目': '创建题目',
        '更新题目': '更新题目',
        '删除题目': '删除题目',
        '删除所有题目': '清空题库',
        '创建试卷': '创建试卷',
        '更新试卷': '更新试卷',
        '发布试卷': '发布试卷',
        '删除试卷': '删除试卷',
        '切换数据库': '切换数据库',
        '清空日志': '清空日志'
    };

    const targetLabels = {
        'user': '用户',
        'question': '题目',
        'paper': '试卷',
        'database': '数据库',
        'logs': '日志'
    };

    const actionStyles = {
        'login': 'background:#10b981;color:white;',
        '登录成功': 'background:#10b981;color:white;',
        'login_failed': 'background:#ef4444;color:white;',
        '登录失败': 'background:#ef4444;color:white;',
        'create': 'background:#3b82f6;color:white;',
        '创建': 'background:#3b82f6;color:white;',
        'update': 'background:#f59e0b;color:white;',
        '更新': 'background:#f59e0b;color:white;',
        'delete': 'background:#ef4444;color:white;',
        '删除': 'background:#ef4444;color:white;',
        'delete_all': 'background:#dc2626;color:white;',
        '批量删除': 'background:#dc2626;color:white;',
        'publish': 'background:#8b5cf6;color:white;',
        '发布': 'background:#8b5cf6;color:white;',
        'switch': 'background:#6366f1;color:white;',
        '切换': 'background:#6366f1;color:white;',
        'clear': 'background:#64748b;color:white;',
        '清空': 'background:#64748b;color:white;',
        '创建用户': 'background:#3b82f6;color:white;',
        '更新用户': 'background:#f59e0b;color:white;',
        '删除用户': 'background:#ef4444;color:white;',
        '修改密码': 'background:#8b5cf6;color:white;',
        '创建题目': 'background:#3b82f6;color:white;',
        '更新题目': 'background:#f59e0b;color:white;',
        '删除题目': 'background:#ef4444;color:white;',
        '删除所有题目': 'background:#dc2626;color:white;',
        '创建试卷': 'background:#3b82f6;color:white;',
        '更新试卷': 'background:#f59e0b;color:white;',
        '发布试卷': 'background:#8b5cf6;color:white;',
        '删除试卷': 'background:#ef4444;color:white;',
        '切换数据库': 'background:#6366f1;color:white;',
        '清空日志': 'background:#64748b;color:white;'
    };

    const targetStyles = {
        'user': 'background:rgba(59,130,246,0.1);color:#60a5fa;border:1px solid rgba(59,130,246,0.2);',
        'question': 'background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2);',
        'paper': 'background:rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2);',
        'database': 'background:rgba(99,102,241,0.1);color:#818cf8;border:1px solid rgba(99,102,241,0.2);',
        'logs': 'background:rgba(100,116,139,0.1);color:#94a3b8;border:1px solid rgba(100,116,139,0.2);'
    };

    const rows = logs.map(log => {
        const time = formatFullDateTime(log.createdAt);
        const actionLabel = actionLabels[log.action] || log.action;
        const targetLabel = targetLabels[log.target] || log.target;
        const actionStyle = actionStyles[log.action] || 'background:#94a3b8;color:white;';
        const targetStyle = targetStyles[log.target] || 'background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid rgba(255,255,255,0.1);';

        let detailsStr = '-';
        if (typeof log.details === 'string') {
            detailsStr = log.details.trim() || '-';
        } else if (log.details && typeof log.details === 'object') {
            const parts = [];
            
            // 特殊处理题目详情
            if (log.target === 'question') {
                const typeMap = { single: '单选题', multiple: '多选题', judge: '判断题' };
                if (log.details.type) parts.push('类型: ' + (typeMap[log.details.type] || log.details.type));
                
                if (log.details.category) {
                    const major = cachedData.categories.find(c => c.id === log.details.category);
                    parts.push('专业: ' + (major ? major.name : log.details.category));
                }
                
                if (log.details.deviceType) {
                    const device = cachedData.categories.find(c => c.id === log.details.deviceType);
                    parts.push('设备类型: ' + (device ? device.name : log.details.deviceType));
                }
                
                if (log.details.content) {
                    parts.push('题目: ' + log.details.content);
                }
            } else {
                // 通用详情解析
                if (log.details.username) parts.push('用户名: ' + log.details.username);
                if (log.details.name) {
                    const nameLabel = log.target === 'user' ? '用户名: ' : '名称: ';
                    parts.push(nameLabel + log.details.name);
                }
                if (log.details.type) {
                    const typeLabels = { single: '单选题', multiple: '多选题', judge: '判断题' };
                    parts.push('类型: ' + (typeLabels[log.details.type] || log.details.type));
                }
                if (log.details.role) {
                    const roleLabels = { super_admin: '超级管理员', group_admin: '分组管理员', student: '考生' };
                    parts.push('角色: ' + (roleLabels[log.details.role] || log.details.role));
                }
                if (log.details.fromDb && log.details.toDb) {
                    const dbNames = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' };
                    parts.push(`${dbNames[log.details.fromDb] || log.details.fromDb} → ${dbNames[log.details.toDb] || log.details.toDb}`);
                } else if (log.details.dbType) {
                    const dbNames = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' };
                    parts.push('数据库: ' + (dbNames[log.details.dbType] || log.details.dbType));
                }
                if (log.details.beforeDate) parts.push('清理日期: ' + formatFullDateTime(log.details.beforeDate));
            }
            detailsStr = parts.join(', ') || '-';
        } else if (log.details !== null && log.details !== undefined) {
            detailsStr = String(log.details);
        }

        const ip = log.ip || '-';
        const username = log.username || '-';

        return {
            time,
            actionLabel,
            targetLabel,
            actionStyle,
            targetStyle,
            detailsStr,
            ip,
            username
        };
    });

    const html = `
        <div class="logs-table">
            <div class="table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width:180px;">时间</th>
                            <th style="width:120px;">对象</th>
                            <th style="width:140px;">操作</th>
                            <th style="width:180px;">操作者</th>
                            <th>详情</th>
                            <th style="width:130px;">IP地址</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td style="font-size:13px;color:var(--text-secondary);white-space:nowrap;">${escapeHtml(r.time)}</td>
                                <td><span class="badge" style="${r.targetStyle}font-size:11px;padding:3px 8px;border-radius:4px;white-space:nowrap;display:inline-block;min-width:60px;text-align:center;">${escapeHtml(r.targetLabel)}</span></td>
                                <td><span class="badge" style="${r.actionStyle}font-size:11px;padding:3px 8px;border-radius:4px;white-space:nowrap;display:inline-block;min-width:60px;text-align:center;">${escapeHtml(r.actionLabel)}</span></td>
                                <td style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(r.username)}">${escapeHtml(r.username)}</td>
                                <td style="font-size:13px;color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(r.detailsStr)}">${escapeHtml(r.detailsStr)}</td>
                                <td style="font-size:12px;color:var(--text-muted);font-family:monospace;">${escapeHtml(r.ip)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="logs-cards">
            ${rows.map(r => `
                <div class="log-card">
                    <div class="log-card-top">
                        <span class="log-card-target" style="${r.targetStyle}font-size:11px;padding:2px 6px;border-radius:4px;margin-right:6px;white-space:nowrap;">${escapeHtml(r.targetLabel)}</span>
                        <span class="log-card-action" style="${r.actionStyle}font-size:11px;padding:2px 6px;border-radius:4px;white-space:nowrap;">${escapeHtml(r.actionLabel)}</span>
                        <span class="log-card-operator" style="margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px;">${escapeHtml(r.username)}</span>
                    </div>
                    <div class="log-card-middle">
                        <span class="log-card-details">${escapeHtml(r.detailsStr)}</span>
                    </div>
                    <div class="log-card-bottom">
                        <span>${escapeHtml(r.time)}</span>
                        <span>${escapeHtml(r.ip)}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    container.innerHTML = html;
}

function renderLogsPagination(result) {
    const container = document.getElementById('logs-pagination');
    const { total, page, totalPages } = result;

    if (totalPages <= 1) {
        container.innerHTML = `<span style="color:var(--text-secondary);font-size:13px;">共 ${total} 条记录</span><div></div>`;
        return;
    }

    let pagesHtml = '';
    const maxVisible = 5;
    let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
        pagesHtml += `<button class="btn btn-sm btn-secondary" data-page="1" onclick="safeOnclick(this, 'loadSystemLogs', ['page'])">1</button>`;
        if (startPage > 2) pagesHtml += `<span style="padding:0 8px;">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === page;
        pagesHtml += `<button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}" data-page="${i}" onclick="safeOnclick(this, 'loadSystemLogs', ['page'])">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pagesHtml += `<span style="padding:0 8px;">...</span>`;
        pagesHtml += `<button class="btn btn-sm btn-secondary" data-page="${totalPages}" onclick="safeOnclick(this, 'loadSystemLogs', ['page'])">${totalPages}</button>`;
    }

    container.innerHTML = `
        <span style="color:var(--text-secondary);font-size:13px;">共 ${total} 条记录，第 ${page}/${totalPages} 页</span>
        <div style="display:flex;gap:4px;align-items:center;">
            <button class="btn btn-sm btn-secondary" data-page="${page - 1}" onclick="safeOnclick(this, 'loadSystemLogs', ['page'])" ${page <= 1 ? 'disabled' : ''}>上一页</button>
            ${pagesHtml}
            <button class="btn btn-sm btn-secondary" data-page="${page + 1}" onclick="safeOnclick(this, 'loadSystemLogs', ['page'])" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>
    `;
}

function resetLogFilters() {
    document.getElementById('log-action-filter').value = '';
    document.getElementById('log-target-filter').value = '';
    loadSystemLogs(1);
}

function showClearLogsModal() {
    openModal('清空系统日志',
        `<div style="padding:16px; text-align:center;">
            <p style="font-size:16px; margin-bottom:12px;">确定要清空所有系统日志吗？</p>
            <div style="padding:12px;background:rgba(239,68,68,0.1);border-radius:var(--radius-md);">
                <p style="color:var(--danger);font-size:13px;margin:0;"><strong>警告：</strong>此操作将删除全部历史记录，且不可撤销！</p>
            </div>
        </div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">取消</button>
         <button class="btn btn-danger" onclick="confirmClearLogs()">确认清空</button>`
    );
}

async function confirmClearLogs() {
    try {
        await Storage.clearSystemLogs(null);
        closeModal();
        showAlert('日志清空成功');
        loadSystemLogs(1);
    } catch (e) {
        showAlert('清空失败: ' + e.message);
    }
}

// ========== 版本检查逻辑 ==========
// 比较版本号：v1 > v2 返回 1，v1 < v2 返回 -1，v1 == v2 返回 0
function compareVersions(v1, v2) {
    const cleanV1 = v1.replace(/^v/, '');
    const cleanV2 = v2.replace(/^v/, '');

    const parts1 = cleanV1.split('.').map(Number);
    const parts2 = cleanV2.split('.').map(Number);

    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}

// 检查版本
async function checkVersion() {
    const versionEl = document.getElementById('version-info');
    if (!versionEl) return;

    try {
        // 1. 先从后端获取当前实际运行的版本号
        try {
            const vRes = await fetch('/api/version');
            if (vRes.ok) {
                const vData = await vRes.json();
                if (vData.version) {
                    AppConfig.version = vData.version;
                }
            }
        } catch (verErr) {
            console.warn('获取后端版本失败，使用默认值:', verErr);
        }

        renderVersionInfo(AppConfig.version, false);

        // 2. 检查 GitHub 最新版本
        const response = await fetch(`https://api.github.com/repos/${AppConfig.githubRepo}/releases/latest`);

        if (response.ok) {
            const data = await response.json();
            const latestVersion = data.tag_name;
            const hasUpdate = compareVersions(latestVersion, AppConfig.version) > 0;

            renderVersionInfo(latestVersion, hasUpdate, data);
        }
    } catch (e) {
        console.warn('版本检查失败:', e);
        renderVersionInfo(AppConfig.version, false);
    }
}

// 渲染版本信息
function renderVersionInfo(displayVersion, hasUpdate, releaseData) {
    const versionEl = document.getElementById('version-info');
    if (!versionEl) return;

    const currentVerStr = AppConfig.version.startsWith('v') ? AppConfig.version : `v${AppConfig.version}`;
    const displayVerStr = typeof displayVersion === 'string' ? (displayVersion.startsWith('v') ? displayVersion : `v${displayVersion}`) : (releaseData?.tag_name || currentVerStr);

    if (hasUpdate) {
        versionEl.innerHTML = `
            <span style="display:flex;align-items:center;color:var(--warning);" title="发现新版本 ${displayVerStr}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; animation: pulse 2s infinite;">
                    <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                </svg>
                ${currentVerStr}
                <span class="badge badge-warning" style="margin-left:4px;font-size:10px;padding:2px 4px;">NEW</span>
            </span>
        `;
        versionEl.onclick = () => showVersionDetails(displayVerStr, releaseData, true);
    } else {
        versionEl.innerHTML = `
            <span style="display:flex;align-items:center;" title="当前版本 ${currentVerStr}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; opacity:0.6;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                ${currentVerStr}
            </span>
        `;
        versionEl.onclick = () => showVersionDetails(currentVerStr, { html_url: `https://github.com/${AppConfig.githubRepo}`, tag_name: currentVerStr }, false);
    }
}

// 显示版本详情
function showVersionDetails(version, releaseData, isUpdate) {
    const title = isUpdate ? '系统更新' : '版本信息';
    const currentVerStr = AppConfig.version.startsWith('v') ? AppConfig.version : `v${AppConfig.version}`;
    const latestVerStr = releaseData?.tag_name || version;
    const releaseUrl = releaseData?.html_url || `https://github.com/${AppConfig.githubRepo}`;

    let content = `
        <div style="padding: 8px 0;">
            <!-- 版本对比区 -->
            <div style="display:flex; align-items:center; justify-content:center; gap:0; margin-bottom:24px; background:var(--bg-input); padding:24px; border-radius:var(--radius-lg); border:1px solid var(--border);">
                <div style="text-align:center; min-width:140px;">
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.5px; opacity:0.8;">当前版本</div>
                    <div style="font-size:26px; font-weight:700; color:var(--text-primary); font-family:'Inter', sans-serif;">${currentVerStr}</div>
                </div>
                
                <div style="display:flex; align-items:center; padding:0 32px; color:var(--text-muted);">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity:0.3;">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                </div>

                <div style="text-align:center; min-width:140px;">
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px; letter-spacing:0.5px; opacity:0.8;">最新版本</div>
                    <div style="font-size:26px; font-weight:700; color:${isUpdate ? 'var(--warning)' : 'var(--success)'}; font-family:'Inter', sans-serif;">
                        ${latestVerStr}
                    </div>
                </div>
            </div>
            
            <div style="text-align:center; padding:0 10px;">
                ${isUpdate ? `
                    <div style="font-size:14px; color:var(--text-secondary);">发现新版本，建议立即更新以体验最新功能与优化。</div>
                ` : `
                    <div style="font-size:14px; color:var(--text-secondary);">已是最新版本，当前系统版本状态良好，无需更新。</div>
                `}
            </div>
        </div>
    `;

    const footer = `
        <button class="btn btn-secondary" style="padding:8px 20px; font-size:14px; height:38px;" onclick="closeModal()">${isUpdate ? '暂不升级' : '关闭'}</button>
        <a href="${releaseUrl}" target="_blank" class="btn btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-width:100px; padding:8px 22px; font-size:14px; height:38px;">
             ${isUpdate ? '立即获取' : '查看项目主页'}
        </a>
    `;

    openModal(title, content, footer);
}

