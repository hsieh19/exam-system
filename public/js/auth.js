/**
 * 用户认证模块 - 异步API版本
 */

const Auth = {
    // 检查是否已登录
    checkAuth() {
        const user = Storage.getCurrentUser();
        if (!user) {
            window.location.href = 'index.html';
            return null;
        }
        // 如果需要修改密码且不在登录页，跳转回登录页处理
        if (user.isFirstLogin && !window.location.pathname.endsWith('index.html')) {
            window.location.href = 'index.html';
            return null;
        }
        return user;
    },

    // 检查是否是管理员
    checkAdmin() {
        const user = this.checkAuth();
        if (user && user.role !== 'super_admin' && user.role !== 'group_admin') {
            window.location.href = 'student.html';
            return null;
        }
        return user;
    },

    // 检查是否是考生
    checkStudent() {
        const user = this.checkAuth();
        if (user && (user.role === 'super_admin' || user.role === 'group_admin')) {
            window.location.href = 'admin.html';
            return null;
        }
        return user;
    },

    // 登录 - 异步版本
    async login(username, password) {
        const user = await Storage.login(username, password);
        if (user) {
            // 如果是首次登录，返回特定状态让页面处理，而不直接跳转
            if (user.isFirstLogin) {
                return { success: true, mustChangePassword: true };
            }
            // 根据角色跳转
            if (user.role === 'super_admin' || user.role === 'group_admin') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'student.html';
            }
            return { success: true, mustChangePassword: false };
        }
        return { success: false };
    },

    // 登出
    logout() {
        Storage.logout();
        window.location.href = 'index.html';
    },

    // 更新侧边栏用户信息
    updateUserInfo(containerId = 'user-info') {
        const user = Storage.getCurrentUser();
        const container = document.getElementById(containerId);
        if (!container || !user) return;

        const avatar = user.username.charAt(0).toUpperCase();
        let roleText = '考生';
        if (user.role === 'super_admin') roleText = '超级管理员';
        else if (user.role === 'group_admin') roleText = '分组管理员';

        container.innerHTML = `
      <div class="user-avatar">${avatar}</div>
      <div class="user-details">
        <div class="user-name">${user.username}</div>
        <div class="user-role">${roleText}</div>
      </div>
      <div class="logout-btn" onclick="Auth.logout()" title="退出登录">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
      </div>
    `;
    }
};
