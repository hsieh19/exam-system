const crypto = require('crypto');

// 获取客户端IP
const getClientIp = (req) => {
    const trustProxy = process.env.TRUST_PROXY === 'true';
    if (trustProxy) {
        const xff = req.headers['x-forwarded-for'];
        const first = typeof xff === 'string' ? xff.split(',')[0]?.trim() : null;
        if (first) return first;
    }
    return req.ip ||
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
