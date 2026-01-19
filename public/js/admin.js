let editingQuestion = null;
let editingUserId = null; // 新增：用于标记当前正在编辑的用户
let selectedGroupId = null; // 当前选中的分组ID
let cachedData = { groups: [], users: [], questions: [], papers: [], categories: [] };

// ========== 版本控制 ==========
const AppConfig = {
    version: '1.0.0', // 当前版本
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
            else if (page === 'database') loadDbConfig();
            else if (page === 'logs') {
                initLogDateFilters();
                loadSystemLogs();
            }
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

    // 渲染为列表形式以便选择
    const listHtml = `
        <div class="group-list" style="display:flex; flex-direction:column; gap:0;">
            ${groups.length ? '' : '<div style="padding:15px;text-align:center;color:var(--text-muted);">暂无分组</div>'}
            ${groups.map(g => {
        const isActive = selectedGroupId === g.id;
        const activeStyle = isActive ? 'background-color: rgba(37, 99, 235, 0.1); border-left: 3px solid var(--primary);' : 'border-left: 3px solid transparent;';

        // 只有超管可以删除分组
        const deleteBtn = user.role === 'super_admin' ?
            `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteGroup('${g.id}')">删除</button>` : '';

        return `
                <div class="group-item" onclick="selectGroup('${g.id}')" 
                     style="padding:12px 15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); ${activeStyle}">
                    <span style="font-weight:${isActive ? '600' : '400'}; color:${isActive ? 'var(--primary)' : 'inherit'}">${escapeHtml(g.name)}</span>
                    ${deleteBtn}
                </div>
                `;
    }).join('')}
        </div>
    `;

    document.getElementById('groups-list').innerHTML = listHtml;

    // 只有超管可以添加分组
    const addGroupBtn = document.querySelector('button[onclick="showAddGroup()"]');
    if (addGroupBtn) addGroupBtn.style.display = user.role === 'super_admin' ? 'block' : 'none';
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
    const getGroupName = (gid) => groups.find(g => g.id === gid)?.name || '-';

    // 优先处理搜索（全局搜索），若无搜索词则按分组过滤
    if (query) {
        users = users.filter(u => {
            const groupName = getGroupName(u.groupId).toLowerCase();
            return u.username.toLowerCase().includes(query) || groupName.includes(query);
        });
    } else if (selectedGroupId) {
        users = users.filter(u => u.groupId === selectedGroupId);
    }

    const html = users.length ? `<table class="data-table"><thead><tr><th>用户名</th><th>分组</th><th style="text-align:center;width:340px;">操作</th></tr></thead>
    <tbody>${users.map(u => {
        const isSuper = u.role === 'super_admin';
        const isGroupAdmin = u.role === 'group_admin';
        const nameStyle = (isSuper || isGroupAdmin) ? 'color: #2563eb; font-weight: bold;' : '';

        const roleBadge = isSuper ? '<span class="badge badge-primary" style="margin-left:5px;font-size:10px;">超管</span>' :
            isGroupAdmin ? '<span class="badge badge-warning" style="margin-left:5px;font-size:10px;">组管</span>' : '';

        const isSelf = currentUser && currentUser.id === u.id;

        // 权限判断
        const canManageRole = currentUser.role === 'super_admin' && !isSelf;
        const canEdit = currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && u.groupId === currentUser.groupId);
        const canDelete = !isSelf && (currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && u.groupId === currentUser.groupId && !isGroupAdmin));

        return `<tr>
        <td style="${nameStyle}">
            ${escapeHtml(u.username)} 
            ${roleBadge}
        </td>
        <td>${escapeHtml(getGroupName(u.groupId))}</td>
        <td style="text-align:center;">
          <div style="display:flex;gap:4px;justify-content:center;align-items:center;flex-wrap:nowrap;white-space:nowrap;">
            ${canManageRole ? `
                <button class="btn btn-sm ${isGroupAdmin ? 'btn-danger' : 'btn-primary'}" onclick="toggleUserRole('${u.id}', 'group_admin')">${isGroupAdmin ? '取消组管' : '设为组管'}</button>
                <button class="btn btn-sm ${isSuper ? 'btn-danger' : 'btn-secondary'}" onclick="toggleUserRole('${u.id}', 'super_admin')">${isSuper ? '取消超管' : '设为超管'}</button>
            ` : ''}
            ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="showEditUser('${u.id}')">编辑</button>` : ''}
            ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">删除</button>` : ''}
          </div>
        </td></tr>`;
    }).join('')}</tbody></table>` : '<p class="text-muted">暂无用户</p>';
    document.getElementById('users-list').innerHTML = html;
}

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
        `<div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" id="user-name"></div>
         <div class="form-group"><label class="form-label">密码</label><input type="text" class="form-input" id="user-pwd" value="123456"></div>
         <div class="form-group"><label class="form-label">角色</label>
            <select class="form-select" id="user-role" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
                ${roleOptions}
            </select>
         </div>
         <div class="form-group"><label class="form-label">分组</label>
            <select class="form-select" id="user-group" disabled style="background-color: var(--bg-light); opacity: 0.7;">
                ${groupOptions}
            </select>
         </div>
         <p style="font-size:12px; color:var(--text-muted); margin-top:-10px;">将在当前选中的分组下创建用户</p>`,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveUser()">保存</button>');
}

function showEditUser(id) {
    editingUserId = id;
    const user = cachedData.users.find(u => u.id === id);
    if (!user) return;

    const currentUser = Storage.getCurrentUser();
    const groups = cachedData.groups;

    const roleOptions = `
        <option value="student" ${user.role === 'student' ? 'selected' : ''}>考生</option>
        <option value="group_admin" ${user.role === 'group_admin' ? 'selected' : ''}>分组管理员</option>
        ${user.role === 'super_admin' ? '<option value="super_admin" selected>超级管理员</option>' : ''}
    `;

    openModal('编辑用户',
        `<div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" id="user-name" value="${escapeHtml(user.username)}"></div>
         <div class="form-group"><label class="form-label">密码</label><input type="text" class="form-input" id="user-pwd" placeholder="留空则不修改密码"></div>
         <div class="form-group"><label class="form-label">角色</label>
            <select class="form-select" id="user-role" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
                ${roleOptions}
            </select>
         </div>
         <div class="form-group"><label class="form-label">分组</label><select class="form-select" id="user-group" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
           <option value="">未分组</option>
           ${groups.map(g => `<option value="${g.id}" ${g.id === user.groupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</select></div>`,
        '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveUser()">更新</button>');
}

async function saveUser() {
    const username = document.getElementById('user-name').value.trim();
    const password = document.getElementById('user-pwd').value;
    const role = document.getElementById('user-role')?.value || 'student';
    const groupId = document.getElementById('user-group').value;

    if (!username) { showAlert('请输入用户名'); return; }

    if (editingUserId) {
        // 编辑模式
        const oldUser = cachedData.users.find(u => u.id === editingUserId);
        if (oldUser) {
            const updateData = { ...oldUser, username, role, groupId };
            if (password) updateData.password = password; // 只有输入了密码才更新
            await Storage.updateUser(updateData);
        }
    } else {
        // 新增模式
        await Storage.addUser({ username, password: password || '123456', role, groupId });
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
                            <div class="major-item ${m.id === selectedMajorId ? 'active' : ''}" onclick="selectMajor('${m.id}')">
                                <span>${escapeHtml(m.name)}</span>
                                <div class="major-actions">
                                    <button class="btn-icon-xs edit" onclick="event.stopPropagation();editMajor('${m.id}','${escapeHtml(m.name)}')" title="重命名">✎</button>
                                    <button class="btn-icon-xs delete" onclick="event.stopPropagation();deleteMajor('${m.id}')" title="删除">🗑️</button>
                                </div>
                            </div>
                        `).join('') : '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">暂无专业<br>请先添加</div>'}
                    </div>
                </div>
                
                <!-- 右侧：设备类型列表 -->
                <div class="settings-content">
                    <h3 style="font-size:15px;margin-bottom:16px;font-weight:600;display:flex;align-items:center;gap:8px;">
                        <span style="color:var(--text-secondary);">当前专业：</span>
                        <span style="color:var(--primary);">${selectedMajorId ? (majors.find(m => m.id === selectedMajorId)?.name || '') : '-'}</span>
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
                        <button class="btn-circle-xs edit" onclick="editDevice('${d.id}','${escapeHtml(d.name)}')" title="重命名">✎</button>
                        <button class="btn-circle-xs delete" onclick="deleteDevice('${d.id}')" title="删除">✕</button>
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

// 通用下拉菜单控制
function toggleFilterDropdown(filterType) {
    // 设备筛选：如果专业是全部，则不允许打开
    if (filterType === 'device' && currentMajorFilter === 'all') {
        return;
    }

    // 先关闭所有其他下拉菜单
    ['group', 'type', 'major', 'device'].forEach(type => {
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
             onclick="selectFilter('group', '${opt.id}', '${escapeHtml(opt.name)}')"
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
             onclick="selectFilter('type', '${opt.id}', '${escapeHtml(opt.name)}')"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    updateFilterLabel('type', options);
}

// 专业筛选
function initMajorFilterDropdown() {
    const menu = document.getElementById('major-filter-menu');
    if (!menu) return;

    const majors = cachedData.categories.filter(c => c.type === 'major');
    const options = [
        { id: 'all', name: '全部专业' },
        ...majors.map(m => ({ id: m.id, name: m.name }))
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${currentMajorFilter === opt.id ? 'active' : ''}" 
             onclick="selectFilter('major', '${opt.id}', '${escapeHtml(opt.name)}')"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

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

    const selectedOpt = options.find(o => o.id === currentValue);
    if (label && selectedOpt) {
        label.textContent = selectedOpt.name;
    }
}

// 选择筛选条件
function selectFilter(filterType, value, name) {
    if (filterType === 'group') currentGroupFilter = value;
    else if (filterType === 'type') currentTypeFilter = value;
    else if (filterType === 'major') {
        currentMajorFilter = value;
        // 级联：切换专业时重置设备类型筛选
        currentDeviceFilter = 'all';
        updateDeviceFilterButton();
    }
    else if (filterType === 'device') currentDeviceFilter = value;

    document.getElementById(`${filterType}-filter-label`).textContent = name;
    document.getElementById(`${filterType}-filter-menu`).style.display = 'none';
    loadQuestions();
}

// 更新设备类型筛选按钮状态
function updateDeviceFilterButton() {
    const btn = document.getElementById('btn-device-filter');
    const label = document.getElementById('device-filter-label');
    if (!btn || !label) return;

    if (currentMajorFilter === 'all') {
        // 禁用设备筛选
        btn.disabled = true;
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-secondary');
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        label.textContent = '全部设备';
        currentDeviceFilter = 'all';
    } else {
        // 启用设备筛选
        btn.disabled = false;
        btn.classList.remove('btn-secondary');
        btn.classList.add('btn-primary');
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    }
}

// 设备类型筛选
function initDeviceFilterDropdown() {
    const menu = document.getElementById('device-filter-menu');
    if (!menu) return;

    // 如果没有选择专业，不初始化
    if (currentMajorFilter === 'all') {
        menu.innerHTML = '';
        return;
    }

    const devices = cachedData.categories.filter(c => c.type === 'device' && c.parentId === currentMajorFilter);
    const options = [
        { id: 'all', name: '全部设备' },
        ...devices.map(d => ({ id: d.id, name: d.name }))
    ];

    menu.innerHTML = options.map(opt => `
        <div class="dropdown-item ${currentDeviceFilter === opt.id ? 'active' : ''}" 
             onclick="selectFilter('device', '${opt.id}', '${escapeHtml(opt.name)}')"
             style="padding:10px 14px;cursor:pointer;font-size:13px;transition:background 0.15s;">
            ${escapeHtml(opt.name)}
        </div>
    `).join('');

    updateFilterLabel('device', options);
}

// 初始化所有筛选下拉菜单
function initAllFilterDropdowns() {
    initGroupFilterDropdown();
    initTypeFilterDropdown();
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

    const typeMap = { single: '单选题', multiple: '多选题', judge: '判断题' };
    const getMajorName = (id) => cachedData.categories.find(c => c.id === id)?.name || id || '-';
    const getDeviceName = (id) => cachedData.categories.find(c => c.id === id)?.name || '';
    const getGroupName = (id) => id ? (cachedData.groups.find(g => g.id === id)?.name || '未知分组') : '公共题库';

    // 格式化时间显示
    const formatDateTime = (isoStr) => {
        if (!isoStr) return '-';
        const d = new Date(isoStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const html = questions.length ? `<div class="table-container"><table class="data-table">
    <thead><tr><th>专业</th><th>设备类型</th><th>题库归属</th><th>题目</th><th>类型</th><th>最后修改</th><th>操作</th></tr></thead>
    <tbody>${questions.map(q => {
        const canEdit = currentUser.role === 'super_admin' || (currentUser.role === 'group_admin' && q.groupId === currentUser.groupId);
        const canDelete = canEdit;

        return `<tr>
      <td>${escapeHtml(getMajorName(q.category))}</td>
      <td>${escapeHtml(getDeviceName(q.deviceType) || '-')}</td>
      <td><span class="badge ${q.groupId ? 'badge-warning' : 'badge-success'}">${escapeHtml(getGroupName(q.groupId))}</span></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(q.content)}</td>
      <td><span class="badge badge-primary">${typeMap[q.type]}</span></td>
      <td style="white-space:nowrap;">${formatDateTime(q.updatedAt)}</td>
      <td>
        ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="editQuestion('${q.id}')">编辑</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteQuestion('${q.id}')">删除</button>` : ''}
      </td>
    </tr>`;
    }).join('')}</tbody></table></div>` : `<p class="text-muted">所选条件下暂无题目</p>`;
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
    const currentUser = Storage.getCurrentUser();

    const q = editingQuestion || { category: '', deviceType: '', content: '', options: type === 'judge' ? ['正确', '错误'] : ['', '', '', ''], answer: 'A', groupId: currentUser.role === 'group_admin' ? currentUser.groupId : null };

    // 找到当前专业对应的设备类型
    const currentMajorId = q.category || '';
    const currentDevices = devices.filter(d => d.parentId === currentMajorId);

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
        <input type="text" class="form-input" value="${escapeHtml(o)}" placeholder="选项内容" style="margin:0;">
        <button class="btn btn-sm btn-danger" onclick="removeOption(this)" ${opts.length <= 2 ? 'disabled' : ''}>删除</button>
      </div>`).join('')}</div>
      <div class="add-option-btn" onclick="addOption()" style="color:var(--primary);cursor:pointer;font-size:14px;font-weight:500;margin-top:8px;">+ 添加选项</div></div>
      <div class="form-group"><label class="form-label">正确答案 ${type === 'multiple' ? '(多选用逗号分隔，如A,C)' : ''}</label>
        <input type="text" class="form-input" id="q-answer" value="${Array.isArray(q.answer) ? q.answer.join(',') : q.answer}" placeholder="${type === 'multiple' ? '如：A,C' : '如：A'}"></div>`;
    }

    const groupOptions = `
        <option value="" ${!q.groupId ? 'selected' : ''}>公共题库</option>
        ${cachedData.groups.map(g => `<option value="${g.id}" ${q.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
    `;

    const editorInnerHtml = `
      <div style="display:flex;gap:16px;margin-bottom:16px;">
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
      <div class="form-group">
        <label class="form-label">题库归属</label>
        <select class="form-select" id="q-groupId" ${currentUser.role !== 'super_admin' ? 'disabled' : ''}>
            ${groupOptions}
        </select>
      </div>
      <div class="form-group"><label class="form-label">题目</label>
        <textarea class="form-input" id="q-content" rows="3" placeholder="请输入题目内容">${q.content}</textarea></div>
      ${optionsHtml}`;

    if (editingQuestion) {
        // 编辑模式使用弹窗
        // 先清除页面上可能存在的内嵌编辑器，防止 ID 冲突
        const editorContainer = document.getElementById('question-editor');
        if (editorContainer) {
            editorContainer.innerHTML = '';
            editorContainer.classList.add('hidden');
        }

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

function onMajorChange() {
    const majorId = document.getElementById('q-category').value;
    const deviceSelect = document.getElementById('q-deviceType');
    const devices = cachedData.categories.filter(c => c.type === 'device' && c.parentId === majorId);

    deviceSelect.innerHTML = majorId
        ? `<option value="">请选择设备类型</option>${devices.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}`
        : '<option value="">请先选择专业</option>';
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
    try {
        const categoryEl = document.getElementById('q-category');
        const deviceTypeEl = document.getElementById('q-deviceType');
        const groupIdEl = document.getElementById('q-groupId');
        const contentEl = document.getElementById('q-content');
        const answerEl = document.getElementById('q-answer');

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

        if (type === 'judge') {
            options = ['正确', '错误'];
            answer = answerEl.value;
        } else {
            document.querySelectorAll('#options-container .option-row input').forEach(input => options.push(input.value.trim()));

            // 验证选项内容不为空
            if (options.some(o => !o)) {
                showAlert('选项内容不能为空');
                return;
            }

            const answerVal = answerEl.value.toUpperCase().trim();
            const validLabels = 'ABCDEFGH'.substring(0, options.length).split('');

            if (type === 'multiple') {
                // 支持中英文逗号
                const answers = answerVal.split(/[,，]/).map(a => a.trim()).filter(a => a);

                if (answers.length === 0) {
                    showAlert('请输入正确答案');
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
                if (!answerVal) {
                    showAlert('请输入正确答案');
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

        const question = { type, category, deviceType, content, options, answer, groupId: groupId || null };
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
    closeModal(); // 尝试关闭弹窗
    const editor = document.getElementById('question-editor');
    if (editor) editor.classList.add('hidden'); // 隐藏内嵌编辑器
}



// ========== 试卷管理 ==========
let paperRules = [];
let rulesValidated = false;
let selectedQuestions = {};

function loadPaperGroups() { }

function loadPapers() {
    const papers = cachedData.papers;
    const currentUser = Storage.getCurrentUser();
    const getGroupName = (id) => cachedData.groups.find(g => g.id === id)?.name || '公共/全员';

    const html = papers.length ? `<table class="data-table"><thead><tr><th>试卷名称</th><th>归属分组</th><th>创建日期</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${papers.map(p => {
        const canManage = currentUser.role === 'super_admin' || p.groupId === currentUser.groupId;
        return `<tr>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(getGroupName(p.groupId))}</td>
      <td>${p.createDate || '-'}</td>
      <td><span class="badge ${p.published ? 'badge-success' : 'badge-warning'}">${p.published ? '已发布' : '草稿'}</span></td>
      <td>
        <div style="display:flex;gap:8px;">
            <button class="btn btn-sm btn-secondary" onclick="showPushLogs('${p.id}')">推送记录</button>
            ${canManage ? `
                <button class="btn btn-sm btn-primary" onclick="showPublishModal('${p.id}')">推送</button>
                <button class="btn btn-sm btn-danger" onclick="deletePaper('${p.id}')">删除</button>
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

    const formatTime = (isoStr) => {
        const d = new Date(isoStr);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const getGroupNames = (ids) => ids.map(id => groups.find(g => g.id === id)?.name || id).join('、') || '-';
    const getUserNames = (ids) => ids.map(id => users.find(u => u.id === id)?.username || id).join('、') || '-';

    const bodyHtml = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>推送时间</th>
                        <th>目标分组</th>
                        <th>目标用户</th>
                        <th>截止时间</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => `
                        <tr>
                            <td>${formatTime(log.pushTime)}</td>
                            <td>${getGroupNames(log.targetGroups)}</td>
                            <td>${getUserNames(log.targetUsers)}</td>
                            <td>${log.deadline || '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    openModal('推送记录 - ' + paper.name, bodyHtml,
        '<button class="btn btn-secondary" onclick="closeModal()">关闭</button>');
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
        showAlert('所有题型已添加');
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
    if (!name) { showAlert('请输入试卷名称'); return; }
    if (paperRules.length === 0) { showAlert('请至少添加一个题型规则'); return; }

    const total = calculateTotalScore();
    if (total !== 100) {
        showAlert('总分需等于100分，当前总分：' + total + '分');
        return;
    }

    const questions = cachedData.questions;
    for (const rule of paperRules) {
        const available = questions.filter(q => q.type === rule.type).length;
        if (available < rule.count) {
            const typeNames = { single: '单选题', multiple: '多选题', judge: '判断题' };
            showAlert(typeNames[rule.type] + '数量不足！需要' + rule.count + '题，题库仅有' + available + '题');
            return;
        }
    }

    rulesValidated = true;
    enableGenerateButtons();
    showAlert('校验成功！请选择"手动选择题目"或"自动生成题目"');
}

function showManualSelect() {
    if (!rulesValidated) { showAlert('请先校验试卷规则'); return; }

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
            showAlert(`该题型最多选择${maxCount}题`);
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
            showAlert(`${typeNames[rule.type]}需要选择${rule.count}题，当前已选${count}题`);
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
    showAlert('试卷创建成功！');
    cancelPaperEdit();
    await refreshCache();
    loadPapers();
}

async function autoGeneratePaper() {
    if (!rulesValidated) { showAlert('请先校验试卷规则'); return; }

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
    showAlert('试卷自动生成成功！');
    cancelPaperEdit();
    await refreshCache();
    loadPapers();
}

async function publishPaper(paperId) {
    const groupItems = document.querySelectorAll('#selector-groups .selector-item.selected');
    const userItems = document.querySelectorAll('#selector-users .selector-item.selected');

    const targetGroups = Array.from(groupItems).map(item => item.dataset.id);
    const targetUsers = Array.from(userItems).map(item => item.dataset.id);
    const deadlineVal = document.getElementById('publish-deadline').value;

    if (!targetGroups.length && !targetUsers.length) {
        showAlert('请至少选择一个目标分组或目标用户');
        return;
    }
    if (!deadlineVal) {
        showAlert('请选择截止时间');
        return;
    }

    const deadline = deadlineVal.replace('T', ' ');
    await Storage.publishPaper(paperId, targetGroups, targetUsers, deadline);
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

    // 默认截止时间为当前时间+3天
    let defaultDeadline = "";
    if (paper?.deadline) {
        defaultDeadline = paper.deadline.replace(' ', 'T');
    } else {
        const now = new Date();
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
            <label class="form-label">截止时间 (日期+时间)</label>
            <input type="datetime-local" class="form-input" id="publish-deadline" value="${defaultDeadline}">
        </div>
    `;

    openModal('推送试卷 - ' + paper.name, bodyHtml, `
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="publishPaper('${paperId}')">确认推送</button>
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
            // Helper to get name from ID
            const getCatName = (id) => cachedData.categories.find(c => c.id === id)?.name || id || '';

            const row = {
                '专业': getCatName(q.category),
                '设备类型': getCatName(q.deviceType),
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
            const header = ['专业', '设备类型', '题目', '正确答案'];
            for (let i = 0; i < maxOptions; i++) {
                header.push('选项' + String.fromCharCode(65 + i));
            }

            const ws = XLSX.utils.json_to_sheet(data, { header });
            XLSX.utils.book_append_sheet(wb, ws, typeName);
        } else {
            // Create empty sheet with header
            const ws = XLSX.utils.json_to_sheet([], { header: ['专业', '设备类型', '题目', '正确答案', '选项A', '选项B', '选项C', '选项D'] });
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
                const idxDeviceType = getColIdx('设备类型');
                const idxContent = getColIdx('题目');
                const idxAnswer = getColIdx('正确答案');

                if (idxCategory === -1 || idxContent === -1 || idxAnswer === -1 || idxDeviceType === -1) {
                    errorMsg += `工作表"${sheetName}"缺少必要列字段(专业、设备类型、题目、正确答案)\n`;
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

                    const categoryRaw = row[idxCategory];
                    const content = row[idxContent];
                    const answerRaw = row[idxAnswer];
                    const deviceTypeRaw = row[idxDeviceType];

                    if (!categoryRaw && !content && !answerRaw && !deviceTypeRaw) continue;
                    if (!categoryRaw || !content || answerRaw === undefined || !deviceTypeRaw) {
                        errorMsg += `工作表"${sheetName}"第${i + 1}行缺少必要信息(专业、设备类型、题目、正确答案)\n`;
                        continue;
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
                        category: categoryId,
                        deviceType: deviceTypeId,
                        content: String(content).trim(),
                        options: options,
                        answer: answer,
                        groupId: currentUser.role === 'group_admin' ? currentUser.groupId : null
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
            input.value = ''; // Reset
        } catch (e) {
            console.error(e);
            showAlert('读取文件失败，请检查文件格式');
            input.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function handleImportClick() {
    const user = Storage.getCurrentUser();
    const isSuper = user.role === 'super_admin';

    showConfirmModal({
        title: '导入提醒',
        message: isSuper
            ? '导入操作会<span style="color:var(--danger);font-weight:bold;">彻底清空所有</span>现有题库数据（包括各分组题库），强烈建议您在操作前先导出题库进行备份。是否确认为继续导入？'
            : '导入操作会将题目直接<span style="color:var(--primary);font-weight:bold;">追加到您的机房题库</span>中。确认是否继续导入？',
        confirmText: isSuper ? '继续清空导入' : '继续追加导入',
        confirmType: isSuper ? 'danger' : 'primary',
        isHtml: true,
        onConfirm: async () => {
            closeModal();
            setTimeout(() => {
                document.getElementById('file-import').click();
            }, 200);
        }
    });
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

// 替换 importQuestions 中的 confirm
function confirmImportQuestions(newQuestions) {
    const user = Storage.getCurrentUser();
    const isSuper = user.role === 'super_admin';

    showConfirmModal({
        title: '确认导入',
        message: `解析成功，共${newQuestions.length}道题。<br>确认导入吗？${isSuper ? '这将<span style="color:var(--danger);font-weight:bold;">彻底清空所有</span>现有题库。' : '题目将追加到您的机房题库中。'}`,
        confirmText: isSuper ? '确认清空并导入' : '确认导入',
        confirmType: isSuper ? 'danger' : 'primary',
        isHtml: true,
        onConfirm: async () => {
            try {
                // 1. 如果是超管且确认清空
                if (isSuper) {
                    await Storage.deleteAllQuestions();
                }

                // 2. 添加
                // 批量添加，为了防止并发过大，可以分批或者串行
                // 这里暂时保持 Promise.all
                await Promise.all(newQuestions.map(q => Storage.addQuestion(q)));

                showAlert(isSuper ? `已清空旧数据并成功导入 ${newQuestions.length} 道题目` : `成功追加导入 ${newQuestions.length} 道题目`);
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
        message: `确定要切换到 <strong>${dbName}</strong> 数据库吗？<br><br><span style="color:var(--danger);">注意：切换后将使用新数据库，原数据不会迁移，且需要重新登录。</span>`,
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
        { value: 'login', label: '登录' },
        { value: 'login_failed', label: '登录失败' },
        { value: 'create', label: '创建' },
        { value: 'update', label: '更新' },
        { value: 'delete', label: '删除' },
        { value: 'delete_all', label: '批量删除' },
        { value: 'publish', label: '发布' },
        { value: 'switch', label: '切换' },
        { value: 'clear', label: '清理' }
    ],
    'user': [
        { value: '', label: '全部操作' },
        { value: 'login', label: '登录' },
        { value: 'login_failed', label: '登录失败' },
        { value: 'create', label: '创建用户' },
        { value: 'update', label: '更新用户' },
        { value: 'delete', label: '删除用户' }
    ],
    'question': [
        { value: '', label: '全部操作' },
        { value: 'create', label: '创建题目' },
        { value: 'update', label: '更新题目' },
        { value: 'delete', label: '删除题目' },
        { value: 'delete_all', label: '清空题库' }
    ],
    'paper': [
        { value: '', label: '全部操作' },
        { value: 'create', label: '创建试卷' },
        { value: 'update', label: '更新试卷' },
        { value: 'publish', label: '发布试卷' },
        { value: 'delete', label: '删除试卷' }
    ],
    'database': [
        { value: '', label: '全部操作' },
        { value: 'switch', label: '切换数据库' }
    ],
    'logs': [
        { value: '', label: '全部操作' },
        { value: 'clear', label: '清理日志' }
    ]
};

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
    const startDate = document.getElementById('log-start-date')?.value;
    const endDate = document.getElementById('log-end-date')?.value;

    if (actionFilter) params.action = actionFilter;
    if (targetFilter) params.target = targetFilter;
    if (startDate) params.startDate = startDate + 'T00:00:00.000Z';
    if (endDate) params.endDate = endDate + 'T23:59:59.999Z';

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
        'login_failed': '登录失败',
        'create': '创建',
        'update': '更新',
        'delete': '删除',
        'delete_all': '批量删除',
        'publish': '发布',
        'switch': '切换',
        'clear': '清理'
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
        'login_failed': 'background:#ef4444;color:white;',
        'create': 'background:#3b82f6;color:white;',
        'update': 'background:#f59e0b;color:white;',
        'delete': 'background:#ef4444;color:white;',
        'delete_all': 'background:#dc2626;color:white;',
        'publish': 'background:#8b5cf6;color:white;',
        'switch': 'background:#6366f1;color:white;',
        'clear': 'background:#64748b;color:white;'
    };

    const html = `
        <div class="table-container">
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width:160px;">时间</th>
                        <th style="width:100px;">操作</th>
                        <th style="width:80px;">对象</th>
                        <th style="width:120px;">操作者</th>
                        <th>详情</th>
                        <th style="width:120px;">IP地址</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.map(log => {
        const time = new Date(log.createdAt).toLocaleString('zh-CN');
        const actionLabel = actionLabels[log.action] || log.action;
        const targetLabel = targetLabels[log.target] || log.target;
        const actionStyle = actionStyles[log.action] || 'background:#94a3b8;color:white;';

        let detailsStr = '';
        if (log.details && typeof log.details === 'object') {
            const parts = [];
            if (log.details.username) parts.push('用户名: ' + log.details.username);
            if (log.details.name) parts.push('名称: ' + log.details.name);
            if (log.details.type) parts.push('类型: ' + log.details.type);
            if (log.details.role) parts.push('角色: ' + log.details.role);
            if (log.details.dbType) parts.push('数据库: ' + log.details.dbType);
            if (log.details.beforeDate) parts.push('清理日期: ' + log.details.beforeDate);
            detailsStr = parts.join(', ') || '-';
        }

        return `
                            <tr>
                                <td style="font-size:13px;color:var(--text-secondary);">${time}</td>
                                <td><span class="badge" style="${actionStyle}font-size:11px;padding:3px 8px;border-radius:4px;">${escapeHtml(actionLabel)}</span></td>
                                <td style="font-size:13px;">${escapeHtml(targetLabel)}</td>
                                <td style="font-size:13px;">${escapeHtml(log.username || '-')}</td>
                                <td style="font-size:13px;color:var(--text-secondary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(detailsStr)}">${escapeHtml(detailsStr)}</td>
                                <td style="font-size:12px;color:var(--text-muted);font-family:monospace;">${escapeHtml(log.ip || '-')}</td>
                            </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
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
        pagesHtml += `<button class="btn btn-sm btn-secondary" onclick="loadSystemLogs(1)">1</button>`;
        if (startPage > 2) pagesHtml += `<span style="padding:0 8px;">...</span>`;
    }

    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === page;
        pagesHtml += `<button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}" onclick="loadSystemLogs(${i})">${i}</button>`;
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pagesHtml += `<span style="padding:0 8px;">...</span>`;
        pagesHtml += `<button class="btn btn-sm btn-secondary" onclick="loadSystemLogs(${totalPages})">${totalPages}</button>`;
    }

    container.innerHTML = `
        <span style="color:var(--text-secondary);font-size:13px;">共 ${total} 条记录，第 ${page}/${totalPages} 页</span>
        <div style="display:flex;gap:4px;align-items:center;">
            <button class="btn btn-sm btn-secondary" onclick="loadSystemLogs(${page - 1})" ${page <= 1 ? 'disabled' : ''}>上一页</button>
            ${pagesHtml}
            <button class="btn btn-sm btn-secondary" onclick="loadSystemLogs(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
        </div>
    `;
}

function initLogDateFilters() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 2); //最近3天（含今天）

    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const startEl = document.getElementById('log-start-date');
    const endEl = document.getElementById('log-end-date');
    if (startEl) startEl.value = formatDate(start);
    if (endEl) endEl.value = formatDate(end);
}

function resetLogFilters() {
    document.getElementById('log-action-filter').value = '';
    document.getElementById('log-target-filter').value = '';
    initLogDateFilters();
    loadSystemLogs(1);
}

function showClearLogsModal() {
    // 计算30天前的日期作为默认值
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const defaultDate = thirtyDaysAgo.toISOString().split('T')[0];

    openModal('清理历史日志',
        `<div class="form-group">
            <label class="form-label">清理此日期之前的日志</label>
            <input type="date" class="form-input" id="clear-logs-date" value="${defaultDate}">
            <p style="font-size:12px;color:var(--text-muted);margin-top:8px;">留空则清理所有日志</p>
        </div>
        <div style="padding:12px;background:rgba(239,68,68,0.1);border-radius:var(--radius-md);margin-top:12px;">
            <p style="color:var(--danger);font-size:13px;margin:0;"><strong>警告：</strong>此操作不可撤销！</p>
        </div>`,
        `<button class="btn btn-secondary" onclick="closeModal()">取消</button>
         <button class="btn btn-danger" onclick="confirmClearLogs()">确认清理</button>`
    );
}

async function confirmClearLogs() {
    const dateInput = document.getElementById('clear-logs-date');
    const beforeDate = dateInput?.value ? dateInput.value + 'T23:59:59.999Z' : null;

    try {
        await Storage.clearSystemLogs(beforeDate);
        closeModal();
        showAlert('日志清理成功');
        loadSystemLogs(1);
    } catch (e) {
        showAlert('清理失败: ' + e.message);
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
        renderVersionInfo(AppConfig.version, false);

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
// 显示版本详情
function showVersionDetails(version, releaseData, isUpdate) {
    const title = isUpdate ? '系统更新' : '版本信息';
    const currentVerStr = AppConfig.version.startsWith('v') ? AppConfig.version : `v${AppConfig.version}`;
    const latestVerStr = releaseData?.tag_name || version;
    const releaseUrl = releaseData?.html_url || `https://github.com/${AppConfig.githubRepo}`;

    let content = `
        <div style="padding: 10px 0;">
            <!-- 版本对比区 -->
            <div style="display:flex; align-items:stretch; gap:20px; margin-bottom:12px; background:var(--bg-input); padding:24px; border-radius:var(--radius-lg); border:1px solid var(--border);">
                <div style="flex:1; text-align:center; padding-right:20px; border-right:1px solid var(--border);">
                    <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; letter-spacing:1px;">当前版本</div>
                    <div style="font-size:24px; font-weight:700; color:var(--text-primary);">${currentVerStr}</div>
                </div>
                <div style="display:flex; align-items:center; justify-content:center; color:var(--text-muted);">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
                <div style="flex:1; text-align:center; padding-left:20px;">
                    <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; letter-spacing:1px;">最新版本</div>
                    <div style="font-size:24px; font-weight:700; color:${isUpdate ? 'var(--warning)' : 'var(--success)'};">
                        ${latestVerStr}
                    </div>
                </div>
            </div>
            
            <div style="margin-top:20px; text-align:center;">
                ${isUpdate ? `
                    <p style="font-size:14px; color:var(--text-secondary); margin-bottom:12px;">发现新版本，建议立即更新以获得最新功能。</p>
                    <div style="font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; justify-content:center;">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                        <span>提示：点击下方按钮跳转 GitHub 下载安装包</span>
                    </div>
                ` : `
                    <p style="font-size:14px; color:var(--text-secondary);">您当前已是最新版本，无需更新。</p>
                `}
            </div>
        </div>
    `;

    const footer = `
        <button class="btn btn-secondary" onclick="closeModal()">${isUpdate ? '暂不升级' : '关闭'}</button>
        <a href="${releaseUrl}" target="_blank" class="btn btn-primary" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-width:120px;">
             ${isUpdate ? '立即获取' : '查看项目主页'}
        </a>
    `;

    openModal(title, content, footer);
}

