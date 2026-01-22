const { v4: uuidv4 } = require('uuid');

/**
 * 生成统一格式的 ID
 * @param {string} prefix - ID 前缀 (如 'u_', 'p_')
 * @returns {string} 16位唯一 ID
 */
const generateId = (prefix = '') => {
    return prefix + uuidv4().replace(/-/g, '').substring(0, 16);
};

module.exports = { generateId };
