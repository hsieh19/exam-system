const crypto = require('crypto');

// 获取客户端IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.connection?.remoteAddress ||
        req.socket?.remoteAddress ||
        'unknown';
};

// 生成安全 Token
const generateSecureToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

module.exports = {
    getClientIp,
    generateSecureToken
};
