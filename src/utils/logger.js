const db = require('../db/db-adapter');

// 记录系统日志
const logAction = async (action, target, targetId, user, details, ip) => {
    try {
        await db.addSystemLog({
            action,
            target,
            targetId,
            userId: user?.id || null,
            username: user?.username || null,
            details,
            ip
        });
    } catch (e) {
        console.error('记录日志失败:', e.message);
    }
};

module.exports = { logAction };
