
// 通用工具函数

/**
 * HTML 转义，防止 XSS 攻击
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

window.params = {};
window.escapeHtml = escapeHtml;

// 全局 Alert 组件
let alertCallback = null;

function ensureAlertModal() {
    if (!document.getElementById('alert-modal-overlay')) {
        const div = document.createElement('div');
        div.id = 'alert-modal-overlay';
        div.className = 'modal-overlay';
        div.style.zIndex = '9999'; // 确保在最顶层
        div.innerHTML = `
            <div class="modal" style="max-width: 360px; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                <div class="modal-header">
                    <span class="modal-title">提示</span>
                    <button class="modal-close" onclick="closeAlertModal()">×</button>
                </div>
                <div class="modal-body" style="padding: 24px 20px; text-align: center; font-size: 15px; line-height: 1.6; color: var(--text-primary);">
                    <div id="alert-message"></div>
                </div>
                <div class="modal-footer" style="justify-content: center;">
                    <button class="btn btn-primary" onclick="closeAlertModal()" style="min-width: 100px;">知道了</button>
                </div>
            </div>
        `;
        document.body.appendChild(div);
    }
}

function showAlert(message, callback) {
    ensureAlertModal();
    alertCallback = callback;
    const msgDiv = document.getElementById('alert-message');
    if (msgDiv) {
        // 自动将换行符转为 <br>，使用 escapeHtml 防止 XSS
        msgDiv.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
    }
    const overlay = document.getElementById('alert-modal-overlay');
    if (overlay) {
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });
    }
}

function closeAlertModal() {
    const el = document.getElementById('alert-modal-overlay');
    if (el) el.classList.remove('active');
    if (alertCallback) {
        alertCallback();
        alertCallback = null;
    }
}

window.showAlert = showAlert;
window.closeAlertModal = closeAlertModal;

function initMobileDrawerNavigation() {
    const sidebar = document.querySelector('.sidebar');
    const appLayout = document.querySelector('.app-layout');
    if (!sidebar || !appLayout) return;

    if (!document.querySelector('.drawer-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'drawer-overlay';
        overlay.addEventListener('click', () => {
            document.body.classList.remove('drawer-open');
        });
        document.body.appendChild(overlay);
    }

    if (!document.querySelector('.mobile-header')) {
        const header = document.createElement('header');
        header.className = 'mobile-header';
        header.innerHTML = `
            <button type="button" class="mobile-header-menu-btn" aria-label="打开菜单">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                    <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
            </button>
            <div class="mobile-header-title" id="mobile-header-title"></div>
            <div class="mobile-header-actions" id="mobile-header-actions"></div>
        `;
        document.body.prepend(header);

        const btn = header.querySelector('.mobile-header-menu-btn');
        btn?.addEventListener('click', () => {
            document.body.classList.toggle('drawer-open');
        });

        const actions = header.querySelector('#mobile-header-actions');
        if (actions && !document.getElementById('mobile-refresh-btn')) {
            const refreshBtn = document.createElement('button');
            refreshBtn.type = 'button';
            refreshBtn.id = 'mobile-refresh-btn';
            refreshBtn.className = 'mobile-header-icon-btn';
            refreshBtn.setAttribute('aria-label', '刷新');
            refreshBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 12a9 9 0 1 1-3-6.7"></path>
                    <polyline points="21 3 21 9 15 9"></polyline>
                </svg>
            `;
            refreshBtn.addEventListener('click', () => window.location.reload());
            actions.appendChild(refreshBtn);
        }
    }

    const updateTitle = () => {
        const titleEl = document.getElementById('mobile-header-title');
        if (!titleEl) return;
        const pageTitle = document.querySelector('.page-content:not(.hidden) .page-title');
        const text = (pageTitle?.textContent || document.title || '').trim();
        titleEl.textContent = text;
    };

    updateTitle();

    const moveThemeSwitcherIntoHeader = () => {
        const headerActions = document.getElementById('mobile-header-actions');
        const switcher = document.getElementById('theme-switcher') || document.querySelector('.theme-switcher');
        if (!headerActions || !switcher) return;
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
            if (switcher.parentElement !== headerActions) headerActions.appendChild(switcher);
        } else {
            if (switcher.parentElement !== document.body) document.body.appendChild(switcher);
        }
    };

    moveThemeSwitcherIntoHeader();

    sidebar.addEventListener('click', (e) => {
        const navItem = e.target.closest?.('.nav-item');
        if (!navItem) return;
        document.body.classList.remove('drawer-open');
        setTimeout(updateTitle, 0);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.body.classList.remove('drawer-open');
    });

    if (window.matchMedia) {
        const mql = window.matchMedia('(max-width: 768px)');
        const handleChange = () => {
            if (!mql.matches) document.body.classList.remove('drawer-open');
            moveThemeSwitcherIntoHeader();
            updateTitle();
        };
        if (mql.addEventListener) mql.addEventListener('change', handleChange);
        else mql.addListener(handleChange);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMobileDrawerNavigation();
});
