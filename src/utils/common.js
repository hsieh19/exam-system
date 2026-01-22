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

// 验证密码强度
// 必须包含大小写、数字、字符，且不低于8位
const validatePasswordStrength = (password) => {
    if (!password || password.length < 8) return false;
    
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    
    return hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar;
};

module.exports = {
    getClientIp,
    generateSecureToken,
    validatePasswordStrength
};
