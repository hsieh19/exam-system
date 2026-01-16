
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
        // 自动将换行符转为 <br>，同时支持传入 HTML
        msgDiv.innerHTML = message.includes('<') ? message : message.replace(/\n/g, '<br>');
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
