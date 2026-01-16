
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
