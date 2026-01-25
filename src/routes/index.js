const fs = require('fs');
const path = require('path');
const db = require('../db/db-adapter');
const dbConfig = require('../config/db-config');
const { generateId } = require('../utils/id-generator');
const { getClientIp, generateSecureToken, validatePasswordStrength } = require('../utils/common');
const { logAction } = require('../utils/logger');
const feishuService = require('../utils/feishu');

// Session 配置
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时过期
const TOKEN_REGEX = /^[a-f0-9]{64}$/i;

const parseBearerToken = (authHeader) => {
    if (!authHeader || typeof authHeader !== 'string') return null;
    if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
    const token = authHeader.slice(7).trim();
    if (!TOKEN_REGEX.test(token)) return null;
    return token;
};

const createRateLimiter = ({ windowMs, max, keyFn }) => {
    const buckets = new Map();
    const ttlMs = windowMs;

    const cleanup = () => {
        const now = Date.now();
        for (const [key, bucket] of buckets.entries()) {
            if (!bucket || bucket.resetAt <= now) buckets.delete(key);
        }
    };

    return (req, res, next) => {
        cleanup();
        const key = keyFn(req);
        if (!key) return next();

        const now = Date.now();
        const bucket = buckets.get(key) || { count: 0, resetAt: now + ttlMs };
        if (bucket.resetAt <= now) {
            bucket.count = 0;
            bucket.resetAt = now + ttlMs;
        }

        bucket.count += 1;
        buckets.set(key, bucket);

        if (bucket.count > max) {
            res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
            return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
        }

        next();
    };
};

module.exports = function initRoutes(app, context) {
    const { sessionStore, sseClients, broadcast, upload } = context;
    const loginLimiter = createRateLimiter({
        windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS || 5 * 60 * 1000),
        max: Number(process.env.LOGIN_RATE_MAX || 30),
        keyFn: (req) => `login:${getClientIp(req)}`
    });
    const feishuLoginLimiter = createRateLimiter({
        windowMs: Number(process.env.FEISHU_LOGIN_RATE_WINDOW_MS || 5 * 60 * 1000),
        max: Number(process.env.FEISHU_LOGIN_RATE_MAX || 60),
        keyFn: (req) => `feishu_login:${getClientIp(req)}`
    });
    const sseLimiter = createRateLimiter({
        windowMs: Number(process.env.SSE_RATE_WINDOW_MS || 60 * 1000),
        max: Number(process.env.SSE_RATE_MAX || 10),
        keyFn: (req) => `sse:${getClientIp(req)}`
    });
    const dbImportLimiter = createRateLimiter({
        windowMs: Number(process.env.DB_IMPORT_RATE_WINDOW_MS || 10 * 60 * 1000),
        max: Number(process.env.DB_IMPORT_RATE_MAX || 3),
        keyFn: (req) => `db_import:${getClientIp(req)}`
    });

    // ==================== 认证中间件 ====================
    const authMiddleware = async (req, res, next) => {
        // 白名单
        const whiteList = ['/login', '/feishu/login', '/feishu/config'];
        if (whiteList.includes(req.path)) return next();

        const token = parseBearerToken(req.headers['authorization']);
        if (!token) return res.status(401).json({ error: '未登录或登录已过期' });

        try {
            const session = await sessionStore.get(token);

            if (!token || !session) {
                // 如果 Token 还在但 Session 没了 (比如 Redis 丢失或过期)，尝试清理客户端可能的无效 Token
                if (token) await sessionStore.delete(token); // 确保清理
                return res.status(401).json({ error: '无效的令牌或会话已过期' });
            }

            req.user = session.user;
            req.token = token; // 保存 token 以便续期

            const currentToken = await sessionStore.getUserToken(req.user.id);
            if (currentToken && currentToken !== token) {
                await sessionStore.delete(token);
                return res.status(401).json({ error: '账号已在其他设备登录，您已被强制下线' });
            }

            // 强制修改密码检查：如果需要修改密码且当前请求不是修改密码接口，则拦截
            // 默认管理员账号不受此逻辑限制
            const adminUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';
            if (req.user.isFirstLogin && 
                req.user.username !== adminUsername && 
                req.path !== '/change-password' && 
                req.path !== '/currentUser') {
                return res.status(403).json({ 
                    error: '需要修改密码', 
                    forcePasswordChange: true 
                });
            }

            next();
        } catch (err) {
            console.error('Auth Error:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    };

    // 权限检查中间件
    const roleMiddleware = (allowedRoles) => (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: '权限不足' });
        }
        next();
    };

    const adminMiddleware = roleMiddleware(['super_admin', 'group_admin']);
    const superAdminMiddleware = roleMiddleware(['super_admin']);

    const closeSseForUser = (userId) => {
        if (!userId) return;
        for (const res of sseClients) {
            if (!res) continue;
            if (res.__userId !== userId) continue;
            try {
                res.end();
            } catch (e) {
            }
            sseClients.delete(res);
        }
    };

    app.get('/events', sseLimiter, async (req, res) => {
        const tokenFromHeader = parseBearerToken(req.headers['authorization']);
        const tokenFromQuery = typeof req.query.token === 'string' && TOKEN_REGEX.test(req.query.token) ? req.query.token : null;
        const token = tokenFromHeader || tokenFromQuery;
        if (!token) return res.status(401).end();
        try {
            const session = await sessionStore.get(token);
            if (!session) return res.status(401).end();
            const currentToken = await sessionStore.getUserToken(session.user.id);
            if (currentToken && currentToken !== token) {
                await sessionStore.delete(token);
                return res.status(401).end();
            }
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (res.flushHeaders) res.flushHeaders();
            res.write('retry: 5000\n\n');
            res.__userId = session.user.id;
            res.__token = token;
            sseClients.add(res);
            req.on('close', () => {
                sseClients.delete(res);
            });
        } catch (e) {
            console.error('SSE Error:', e);
            res.status(500).end();
        }
    });

    // 对 /api 下的所有请求应用鉴权
    app.use('/api', authMiddleware);

    // ==================== 数据库配置接口 ====================
    // 获取当前数据库配置（敏感信息已脱敏）
    app.get('/api/db/config', adminMiddleware, (req, res) => {
        res.json(dbConfig.getFullConfigSafe());
    });

    // 测试数据库连接（使用环境变量中的配置）
    app.post('/api/db/test', adminMiddleware, async (req, res) => {
        const { dbType } = req.body;
        if (!['sqlite', 'mysql', 'postgres'].includes(dbType)) {
            return res.status(400).json({ error: '不支持的数据库类型' });
        }

        // 使用环境变量中的配置进行测试
        const config = dbConfig.getDbConfig(dbType);
        const result = await db.testConnection(dbType, config);
        res.json(result);
    });

    // 切换数据库（仅切换，不接受配置参数）
    app.post('/api/db/switch', adminMiddleware, async (req, res) => {
        const { dbType } = req.body;
        if (!['sqlite', 'mysql', 'postgres'].includes(dbType)) {
            return res.status(400).json({ error: '不支持的数据库类型' });
        }

        // 检查目标数据库是否已在环境变量中配置
        if (!dbConfig.isDbConfigured(dbType)) {
            return res.status(400).json({
                error: `${dbType} 数据库未配置，请在服务器端 .env 文件中配置连接信息`
            });
        }

        try {
            await db.switchDatabase(dbType);
            // 清除所有会话，强制重新登录
            await sessionStore.clear();
            // 记录日志
            await logAction('切换数据库', 'database', dbType, req.user, { dbType }, getClientIp(req));
            res.json({ success: true, message: `已切换到 ${dbType} 数据库` });
        } catch (e) {
            console.error('切换数据库失败:', e);
            res.status(500).json({ error: '切换数据库失败，请检查配置' });
        }
    });

    app.get('/api/db/export', adminMiddleware, (req, res) => {
        if (db.getActiveDbType() !== 'sqlite') {
            return res.status(400).json({ error: '只有 SQLite 数据库支持导出' });
        }
        const data = db.exportSqliteDb();
        if (!data) {
            return res.status(500).json({ error: '导出失败' });
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="exam.db"');
        res.send(Buffer.from(data));
    });

    app.post('/api/db/import', adminMiddleware, dbImportLimiter, upload.single('file'), async (req, res) => {
        if (db.getActiveDbType() !== 'sqlite') {
            return res.status(400).json({ error: '只有 SQLite 数据库支持导入' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '请上传文件' });
        }
        try {
            const fileData = fs.readFileSync(req.file.path);
            await db.importSqliteDb(fileData);

            await sessionStore.clear();
            res.json({ success: true, message: '数据库导入成功，请重新登录' });
            broadcast('db_change', { resource: 'all' });
        } catch (e) {
            console.error('数据库导入失败:', e);
            res.status(500).json({ error: '数据库导入失败，请检查文件' });
        } finally {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {
                console.error('临时文件清理失败:', req.file.path, e.message);
            }
        }
    });

    // ==================== 用户接口 ====================
    app.get('/api/users', adminMiddleware, async (req, res) => {
        const filter = {};
        if (req.user.role !== 'super_admin') {
            // 如无分组ID，则不应看到任何用户（防止数据泄漏）
            if (!req.user.groupId) return res.json([]);
            filter.groupId = req.user.groupId;
        }
        res.json(await db.getUsers(filter));
    });

    app.post('/api/users', adminMiddleware, async (req, res) => {
        const userData = req.body;
        // 分组管理员只能创建本组成员且角色只能是学生
        if (req.user.role !== 'super_admin') {
            userData.role = 'student';
            userData.groupId = req.user.groupId;
        }
        const user = { ...userData, id: generateId('u_') };
        const result = await db.addUser(user);
        // 记录日志
        await logAction('创建用户', 'user', user.id, req.user, { username: userData.username, role: userData.role }, getClientIp(req));
        res.json(result);
        broadcast('db_change', { resource: 'users' });
    });

    app.delete('/api/users/:id', adminMiddleware, async (req, res) => {
        const targetUser = await db.getUserById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: '用户不存在' });

        // 权限检查：
        // 1. 不能删除自己 (前端已做限制，后端兜底)
        if (req.user.id === targetUser.id) {
            return res.status(403).json({ error: '不能删除自己' });
        }
        // 2. 只有超管能删除超管
        if (targetUser.role === 'super_admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: '无权删除超级管理员' });
        }
        // 2.1 不能删除最后一个超级管理员（防止系统无人可管）
        if (targetUser.role === 'super_admin' && req.user.role === 'super_admin') {
            const allUsers = await db.getUsers();
            const superAdminCount = allUsers.filter(u => u.role === 'super_admin').length;
            if (superAdminCount <= 1) {
                return res.status(403).json({ error: '不能删除最后一个超级管理员' });
            }
        }
        // 3. 非超管只能删除本组成员
        if (req.user.role !== 'super_admin' && targetUser.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权操作该用户' });
        }

        await db.deleteUser(req.params.id);
        // 记录日志
        await logAction('删除用户', 'user', req.params.id, req.user, { username: targetUser.username }, getClientIp(req));
        res.json({ success: true });
        broadcast('db_change', { resource: 'users' });
    });

    app.put('/api/users/:id', adminMiddleware, async (req, res) => {
        const targetUser = await db.getUserById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: '用户不存在' });

        const updateData = req.body;

        // 新增逻辑：如果是飞书用户，禁止任何人（包括超管）修改用户名和密码
        if (targetUser.feishuUserId) {
            delete updateData.username;
            delete updateData.password;
        }

        // 权限检查
        if (req.user.role !== 'super_admin') {
            // 不能修改超管
            if (targetUser.role === 'super_admin') {
                return res.status(403).json({ error: '无权操作超级管理员' });
            }
            if (targetUser.groupId !== req.user.groupId) {
                return res.status(403).json({ error: '无权操作该用户' });
            }

            // 非超管禁止修改角色和分组
            delete updateData.role;
            delete updateData.groupId;
        }

        // 核心保护：防止超管修改自己的角色导致权限丢失
        if (req.user.id === targetUser.id) {
            delete updateData.role;
        }

        // 修复：将现有用户信息与更新信息合并，确保缺失字段（如被 delete 的 role）能从原数据中补齐
        const user = { ...targetUser, ...updateData, id: req.params.id };
        const result = await db.updateUser(user);
        // 记录日志
        await logAction('更新用户', 'user', req.params.id, req.user, { username: updateData.username }, getClientIp(req));
        res.json(result);
        broadcast('db_change', { resource: 'users' });
    });

    app.post('/api/change-password', async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        const userId = req.user.id;

        // 禁止飞书用户（且非超管）修改自己的密码
        if (req.user.feishuUserId && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: '飞书用户请通过飞书账号登录，无需修改密码' });
        }

        const adminUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';

        // 验证新密码强度 (默认管理员跳过强度校验)
        if (req.user.username !== adminUsername && !validatePasswordStrength(newPassword)) {
            return res.status(400).json({ 
                error: '密码强度不足：必须包含大小写字母、数字和特殊字符，且长度不少于8位' 
            });
        }

        try {
            const user = await db.getUserByUsername(req.user.username);
            // 验证旧密码
            const isValid = await db.verifyPassword(oldPassword, user.password);
            if (!isValid) {
                return res.status(400).json({ error: '原密码错误' });
            }

            await db.changePassword(userId, newPassword);
            
            // 更新当前 session 中的用户信息
            const session = await sessionStore.get(req.token);
            if (session && session.user) {
                session.user.isFirstLogin = 0;
                await sessionStore.set(req.token, session.user, SESSION_EXPIRY_MS);
                await sessionStore.setUserToken(userId, req.token, SESSION_EXPIRY_MS);
            }

            await logAction('修改密码', 'user', userId, req.user, {}, getClientIp(req));
            res.json({ success: true, message: '密码修改成功' });
        } catch (e) {
            console.error('修改密码失败:', e);
            res.status(500).json({ error: '修改密码失败' });
        }
    });

    app.post('/api/logout', async (req, res) => {
        const token = req.token;
        const userId = req.user?.id;
        try {
            if (token) await sessionStore.delete(token);
            if (userId) {
                const currentToken = await sessionStore.getUserToken(userId);
                if (currentToken && currentToken === token) {
                    await sessionStore.deleteUserToken(userId);
                }
                closeSseForUser(userId);
                await logAction('退出登录', 'user', userId, req.user, {}, getClientIp(req));
            }
            res.json({ success: true });
        } catch (e) {
            console.error('Logout error:', e);
            res.status(500).json({ error: '退出登录失败' });
        }
    });

    // ==================== 飞书集成接口 ====================
    app.get('/api/feishu/config', (req, res) => {
        res.json({
            appId: process.env.FEISHU_APP_ID,
            redirectUri: process.env.FEISHU_REDIRECT_URI
        });
    });

    app.post('/api/feishu/login', feishuLoginLimiter, async (req, res) => {
        const { code } = req.body;
        const clientIp = getClientIp(req);
        const userAgent = String(req.headers['user-agent'] || '');

        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        try {
            // 1. 获取 app_access_token
            const appAccessToken = await feishuService.getAppAccessToken();
            
            // 2. 获取用户信息
            const feishuUser = await feishuService.getUserInfo(code, appAccessToken);
            const { open_id, user_id, name } = feishuUser;

            // --- 部门同步逻辑开始 ---
            let groupIds = [];
            try {
                if (user_id) {
                    const userDetails = await feishuService.getUserDetails(user_id, appAccessToken);
                    if (userDetails.department_ids && userDetails.department_ids.length > 0) {
                        for (const deptId of userDetails.department_ids) {
                            const deptInfo = await feishuService.getDepartmentInfo(deptId, appAccessToken);
                            if (deptInfo && deptInfo.name) {
                                const deptName = deptInfo.name;
                                // 查找或创建分组
                                let group = await db.getGroupByName(deptName);
                                if (!group) {
                                    group = await db.addGroup({ name: deptName });
                                    await logAction('飞书部门自动同步分组', 'group', group.id, group, { name: deptName }, clientIp);
                                }
                                if (!groupIds.includes(group.id)) {
                                    groupIds.push(group.id);
                                }
                            }
                        }
                    }
                }
            } catch (deptErr) {
                console.warn('Failed to sync Feishu department:', deptErr.message);
                // 部门同步失败不应阻断登录流程
            }
            const finalGroupIdStr = groupIds.length > 0 ? groupIds.join(',') : null;
            // --- 部门同步逻辑结束 ---

            // 3. 在数据库中查找用户
            let user = await db.getUserByFeishuId(user_id, open_id);

            // 检查飞书登录权限
            if (user && user.feishuEnabled === 0) {
                await logAction('飞书登录被拦截', 'user', user.id, user, { username: user.username, reason: '飞书登录权限已关闭' }, clientIp);
                return res.status(403).json({ error: '您的账号已被禁止通过飞书登录，请联系管理员' });
            }

            // 4. 如果没找到，则创建一个新用户（考生角色）
            if (!user) {
                const newUserId = generateId('u_fs_');
                user = await db.addUser({
                    id: newUserId,
                    username: name || `feishu_${open_id.substring(0, 8)}`,
                    password: generateSecureToken().substring(0, 16), // 随机密码
                    role: 'student',
                    groupId: finalGroupIdStr, // 绑定同步的多个分组
                    isFirstLogin: 0,
                    feishuUserId: user_id,
                    feishuOpenId: open_id
                });
                await logAction('飞书自动注册', 'user', user.id, user, { username: name, open_id, groups: finalGroupIdStr }, clientIp);
            } else {
                // 更新飞书信息
                const needsUpdate = user.feishuUserId !== user_id || 
                                   user.feishuOpenId !== open_id || 
                                   user.isFirstLogin === 1 ||
                                   (finalGroupIdStr && user.groupId !== finalGroupIdStr); // 同时也同步多分组变更

                if (needsUpdate) {
                    user.feishuUserId = user_id;
                    user.feishuOpenId = open_id;
                    user.isFirstLogin = 0;
                    if (finalGroupIdStr) user.groupId = finalGroupIdStr;
                    
                    await db.updateUser(user);
                    await logAction('飞书登录同步用户信息', 'user', user.id, user, { username: name, open_id, groups: finalGroupIdStr }, clientIp);
                }
            }

            // 5. 生成 Session
            const existingEntry = sessionStore.getUserTokenEntry ? await sessionStore.getUserTokenEntry(user.id) : null;
            const existingToken = existingEntry ? existingEntry.token : await sessionStore.getUserToken(user.id);
            if (existingToken) {
                await sessionStore.delete(existingToken);
                closeSseForUser(user.id);
                const isRemote = !!(existingEntry && existingEntry.ip && existingEntry.ua && (existingEntry.ip !== clientIp || existingEntry.ua !== userAgent));
                if (isRemote) {
                    await logAction('账号异地登录踢下线', 'user', user.id, user, { username: user.username }, clientIp);
                } else {
                    await logAction('账号重新登录刷新会话', 'user', user.id, user, { username: user.username }, clientIp);
                }
            }
            const token = generateSecureToken();
            await sessionStore.set(token, user, SESSION_EXPIRY_MS);
            await sessionStore.setUserToken(user.id, token, SESSION_EXPIRY_MS, { ip: clientIp, ua: userAgent });
            
            await logAction('飞书登录成功', 'user', user.id, user, { username: user.username }, clientIp);
            
            res.json({ token, user, expiresIn: SESSION_EXPIRY_MS });
        } catch (err) {
            console.error('Feishu Login Error:', err);
            await logAction('飞书登录失败', 'user', null, null, { error: err.message }, clientIp);
            res.status(500).json({ error: '飞书认证失败' });
        }
    });

    app.post('/api/login', loginLimiter, async (req, res) => {
        const { username, password } = req.body;
        const clientIp = getClientIp(req);
        const userAgent = String(req.headers['user-agent'] || '');
        const user = await db.login(username, password);
        if (user) {
            // 生成安全 Token
            const existingEntry = sessionStore.getUserTokenEntry ? await sessionStore.getUserTokenEntry(user.id) : null;
            const existingToken = existingEntry ? existingEntry.token : await sessionStore.getUserToken(user.id);
            if (existingToken) {
                await sessionStore.delete(existingToken);
                closeSseForUser(user.id);
                const isRemote = !!(existingEntry && existingEntry.ip && existingEntry.ua && (existingEntry.ip !== clientIp || existingEntry.ua !== userAgent));
                if (isRemote) {
                    await logAction('账号异地登录踢下线', 'user', user.id, user, { username }, clientIp);
                } else {
                    await logAction('账号重新登录刷新会话', 'user', user.id, user, { username }, clientIp);
                }
            }
            const token = generateSecureToken();
            await sessionStore.set(token, user, SESSION_EXPIRY_MS);
            await sessionStore.setUserToken(user.id, token, SESSION_EXPIRY_MS, { ip: clientIp, ua: userAgent });
            // 记录登录成功日志
            await logAction('登录成功', 'user', user.id, user, { username }, clientIp);
            res.json({ token, user, expiresIn: SESSION_EXPIRY_MS });
        } else {
            // 记录登录失败日志
            await logAction('登录失败', 'user', null, null, { username }, clientIp);
            res.status(401).json({ error: '用户名或密码错误' });
        }
    });

    app.get('/api/currentUser', async (req, res) => {
        // 中间件已注入 req.user
        if (req.user) {
            try {
                const latest = await db.getUserById(req.user.id);
                if (latest) {
                    // 如果用户需要强制改密，且当前请求不是允许的白名单，则在 authMiddleware 已经拦截了
                    // 这里返回用户信息
                    res.json({ user: latest });
                } else {
                    console.error(`User not found in DB for ID: ${req.user.id}, Username: ${req.user.username}`);
                    res.status(401).json({ error: 'User not found' });
                }
            } catch (err) {
                console.error(`Error getting user ${req.user.id}:`, err);
                res.status(500).json({ error: 'Internal Server Error' });
            }
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    });

    // ==================== 分组接口 ====================
    app.get('/api/groups', adminMiddleware, async (req, res) => {
        res.json(await db.getGroups());
    });

    app.post('/api/groups', superAdminMiddleware, async (req, res) => {
        const group = { ...(req.body || {}), id: generateId('g_') };
        const result = await db.addGroup(group);
        res.json(result);
        broadcast('db_change', { resource: 'groups' });
    });

    app.put('/api/groups/:id', superAdminMiddleware, async (req, res) => {
        const group = { ...req.body, id: req.params.id };
        const result = await db.updateGroup(group);
        res.json(result);
        broadcast('db_change', { resource: 'groups' });
    });

    app.delete('/api/groups/:id', superAdminMiddleware, async (req, res) => {
        await db.deleteGroup(req.params.id);
        res.json({ success: true });
        broadcast('db_change', { resource: 'groups' });
    });

    // ==================== 题目接口 ====================
    app.get('/api/questions', adminMiddleware, async (req, res) => {
        const filter = {};
        if (req.user.role !== 'super_admin') {
            // 严格检查：如果有分组，只能看本组+公共；如果没有分组（异常情况），只能看公共
            if (req.user.groupId) {
                filter.groupId = req.user.groupId;
                filter.includePublic = true;
            } else {
                filter.onlyPublic = true;
            }
        }
        res.json(await db.getQuestions(filter));
    });

    app.post('/api/questions', adminMiddleware, async (req, res) => {
        const questionData = req.body;
        // 分组管理员只能创建本组题库
        if (req.user.role !== 'super_admin') {
            questionData.groupId = req.user.groupId;
        }
        const question = { ...questionData, id: generateId('q_') };
        const result = await db.addQuestion(question);
        // 记录日志
        await logAction('创建题目', 'question', question.id, req.user, { type: questionData.type }, getClientIp(req));
        res.json(result);
        broadcast('db_change', { resource: 'questions' });
    });

    app.put('/api/questions/:id', adminMiddleware, async (req, res) => {
        const existing = (await db.getQuestions()).find(q => q.id === req.params.id);
        if (!existing) return res.status(404).json({ error: '题目不存在' });

        // 权限检查
        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权修改公共题库或其他分组题库' });
        }

        const question = { ...req.body, id: req.params.id };
        if (req.user.role !== 'super_admin') {
            question.groupId = req.user.groupId; // 强制保持本组
        }
        const result = await db.updateQuestion(question);
        // 记录日志
        await logAction('更新题目', 'question', req.params.id, req.user, { type: question.type }, getClientIp(req));
        res.json(result);
        broadcast('db_change', { resource: 'questions' });
    });

    app.delete('/api/questions/all', adminMiddleware, async (req, res) => {
        const { groupId } = req.query;
        
        // 权限检查
        if (req.user.role !== 'super_admin') {
            // 组管只能删除本组题库，不能删除全部或公共
            if (!groupId || groupId === 'all' || groupId === 'public' || groupId !== req.user.groupId) {
                return res.status(403).json({ error: '无权执行此操作' });
            }
        }

        await db.deleteQuestions(groupId);
        // 记录日志
        await logAction('删除题库', 'question', null, req.user, { groupId: groupId || 'all' }, getClientIp(req));
        res.json({ success: true });
        broadcast('db_change', { resource: 'questions' });
    });

    app.delete('/api/questions/:id', adminMiddleware, async (req, res) => {
        const existing = (await db.getQuestions()).find(q => q.id === req.params.id);
        if (!existing) return res.status(404).json({ error: '题目不存在' });

        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权删除' });
        }

    await db.deleteQuestion(req.params.id);
        // 记录日志
        await logAction('删除题目', 'question', req.params.id, req.user, {}, getClientIp(req));
        res.json({ success: true });
        broadcast('db_change', { resource: 'questions' });
    });

    // ==================== 专业分类接口 ====================
    app.get('/api/categories', adminMiddleware, async (req, res) => {
        res.json(await db.getCategories());
    });

    app.get('/api/categories/majors', adminMiddleware, async (req, res) => {
        res.json(await db.getMajors());
    });

    app.get('/api/categories/devices/:majorId', adminMiddleware, async (req, res) => {
        res.json(await db.getDeviceTypes(req.params.majorId));
    });

    app.post('/api/categories', superAdminMiddleware, async (req, res) => {
        const cat = { ...(req.body || {}), id: generateId('cat_') };
        const result = await db.addCategory(cat);
        res.json(result);
        broadcast('db_change', { resource: 'categories' });
    });

    app.put('/api/categories/:id', superAdminMiddleware, async (req, res) => {
        const cat = { ...req.body, id: req.params.id };
        const result = await db.updateCategory(cat);
        res.json(result);
        broadcast('db_change', { resource: 'categories' });
    });

    app.delete('/api/categories/:id', superAdminMiddleware, async (req, res) => {
        await db.deleteCategory(req.params.id);
        res.json({ success: true });
        broadcast('db_change', { resource: 'categories' });
    });

    // ==================== 试卷接口 ====================
    // 获取排行榜可选试卷列表
    app.get('/api/papers/ranking-list', async (req, res) => {
        try {
            const user = req.user;
            const papers = await db.getPapers();

            if (user.role === 'super_admin') {
                return res.json(papers);
            }

            // 对于分组管理员，返回本组创建的试卷
            if (user.role === 'group_admin') {
                return res.json(papers.filter(p => p.groupId === user.groupId));
            }

            // 对于学生，返回已发布的、且目标包含该学生或其分组的试卷
            const visiblePapers = papers.filter(p => {
                if (!p.published) return false;
                const inGroup = p.targetGroups && p.targetGroups.includes(user.groupId);
                const inUsers = p.targetUsers && p.targetUsers.includes(user.id);
                return inGroup || inUsers;
            });

            res.json(visiblePapers);
        } catch (error) {
            console.error('Error fetching ranking papers:', error);
            res.status(500).json({ error: '获取试卷列表失败' });
        }
    });

    app.get('/api/papers', adminMiddleware, async (req, res) => {
        const filter = {};
        if (req.user.role !== 'super_admin') {
            filter.creatorId = req.user.id;
        }
        res.json(await db.getPapers(filter));
    });

    app.get('/api/papers/:id', adminMiddleware, async (req, res) => {
        const paper = await db.getPaperById(req.params.id);
        if (paper) {
            if (req.user.role !== 'super_admin' && paper.creatorId !== req.user.id) {
                return res.status(403).json({ error: '无权访问该试卷' });
            }
            res.json(paper);
        } else {
            res.status(404).json({ error: '试卷不存在' });
        }
    });

    app.post('/api/papers', adminMiddleware, async (req, res) => {
        const body = req.body || {};
        const paper = {
            ...body,
            id: generateId('p_'),
            createDate: new Date().toISOString().split('T')[0],
            creatorId: req.user.id,
            groupId: req.user.groupId,
        };
        // 分组管理员强制创建本组试卷
        if (req.user.role !== 'super_admin') {
            paper.groupId = req.user.groupId;
        }
        const result = await db.addPaper(paper);
        // 记录日志
        await logAction('创建试卷', 'paper', paper.id, req.user, { name: paper.name }, getClientIp(req));
        res.json(result);
        broadcast('db_change', { resource: 'papers' });
    });

    app.put('/api/papers/:id', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) return res.status(404).json({ error: '试卷不存在' });

        if (req.user.role !== 'super_admin' && existing.creatorId !== req.user.id) {
            return res.status(403).json({ error: '无权修改' });
        }

        const paper = { 
            ...req.body, 
            id: req.params.id,
            createDate: new Date().toISOString() // 编辑保存时更新创建时间
        };
        
        if (req.user.role !== 'super_admin') {
            paper.groupId = req.user.groupId;
        }
        
        const result = await db.updatePaper(paper);
        // 记录日志
        await logAction('更新试卷', 'paper', paper.id, req.user, { name: paper.name }, getClientIp(req));
        res.json(result);
        broadcast('db_change', { resource: 'papers' });
    });

    app.put('/api/papers/:id/publish', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: '试卷不存在' });
        }

        // 权限检查
        if (req.user.role !== 'super_admin' && existing.creatorId !== req.user.id) {
            return res.status(403).json({ error: '无权发布该试卷' });
        }

        let targetGroups = req.body.targetGroups || [];
        const targetUsers = req.body.targetUsers || [];
        const deadline = req.body.deadline;
        const pushTime = new Date().toISOString();

        // 分组管理员只能推送到本组
        if (req.user.role !== 'super_admin') {
            targetGroups = [req.user.groupId];
        }

        // 更新试卷的最新推送信息
        const paper = {
            ...existing,
            published: true,
            targetGroups,
            targetUsers,
            deadline,
            publishDate: pushTime
        };
        await db.updatePaper(paper);

        // 记录推送日志
        await db.addPushLog({
            id: generateId('pl_'),
            paperId: req.params.id,
            pushTime,
            targetGroups,
            targetUsers,
            deadline
        });

        // 记录系统日志
        await logAction('发布试卷', 'paper', req.params.id, req.user, { name: existing.name, targetGroups }, getClientIp(req));

        res.json(paper);
        broadcast('db_change', { resource: 'papers' });
    });

    app.get('/api/papers/:id/push-logs', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) return res.status(404).json({ error: '试卷不存在' });

        if (req.user.role !== 'super_admin' && existing.creatorId !== req.user.id) {
            return res.status(403).json({ error: '无权查看' });
        }

        const logs = await db.getPushLogsByPaper(req.params.id);
        res.json(logs);
    });

    app.delete('/api/papers/:id', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) return res.status(404).json({ error: '试卷不存在' });

        if (req.user.role !== 'super_admin' && existing.creatorId !== req.user.id) {
            return res.status(403).json({ error: '无权删除' });
        }

    await db.deletePaper(req.params.id);
        // 记录日志
        await logAction('删除试卷', 'paper', req.params.id, req.user, { name: existing.name }, getClientIp(req));
        res.json({ success: true });
        broadcast('db_change', { resource: 'papers' });
    });

    app.get('/api/papers/user/:userId', async (req, res) => {
        const requestedUserId = req.params.userId;
        const requester = req.user;
        const user = await db.getUserById(requestedUserId);
        if (!user) return res.json([]);

        if (requester.role === 'student' && user.id !== requester.id) {
            return res.status(403).json({ error: '无权访问' });
        }
        if (requester.role === 'group_admin' && requester.groupId && user.groupId !== requester.groupId) {
            return res.status(403).json({ error: '无权访问' });
        }

        const papers = await db.getPapers();
        const availablePromises = papers.map(async p => {
            if (!p.published) return null;

            // 检查是否在目标组或目标用户中
            const isInGroup = p.targetGroups && p.targetGroups.includes(user.groupId);
            const isTargetUser = p.targetUsers && p.targetUsers.includes(user.id);
            if (!isInGroup && !isTargetUser) return null;

            // 如果有截止日期，检查是否过期
            if (p.deadline) {
                const now = new Date();
                const deadline = new Date(p.deadline.replace(' ', 'T'));
                if (deadline < now) return null;
            }

            // 检查用户是否已参加过考试
            const record = await db.getRecordByUserAndPaper(user.id, p.id);
            if (record) {
                // 如果已提交过，检查最后提交时间是否早于最新发布时间
                // 如果是，说明是重新推送的，应该允许再次考试
                if (p.publishDate && record.submitDate) {
                    const submitDate = new Date(record.submitDate);
                    const publishDate = new Date(p.publishDate);
                    // 如果最后提交时间晚于发布时间，说明已经考过了最新推送的版本
                    if (submitDate >= publishDate) return null;
                } else {
                    // 如果没有发布时间（旧数据）且有记录，则按原逻辑隐藏
                    return null;
                }
            }

            // 检查是否有进行中的会话
            const session = await db.getExamSession(user.id, p.id);
            return { ...p, isOngoing: !!session };
        });

        const results = await Promise.all(availablePromises);
        res.json(results.filter(p => p !== null));
    });

    // ==================== 记录接口 ====================
    app.get('/api/records', adminMiddleware, async (req, res) => {
        res.json(await db.getRecords());
    });

    app.get('/api/records/paper/:paperId', adminMiddleware, async (req, res) => {
        res.json(await db.getRecordsByPaper(req.params.paperId));
    });

    app.delete('/api/records/paper/:paperId', adminMiddleware, async (req, res) => {
        await db.deleteRecordsByPaper(req.params.paperId);
        res.json({ success: true });
    });

    app.post('/api/records', async (req, res) => {
        try {
            const { paperId } = req.body || {};
            if (!paperId) return res.status(400).json({ error: '缺少试卷ID' });

            const userId = req.user.id;
            const user = await db.getUserById(userId);
            if (!user) return res.status(401).json({ error: '用户不存在' });

            const paper = await db.getPaperById(paperId);
            if (!paper || !paper.published) return res.status(404).json({ error: '试卷不存在或未发布' });

            const inGroup = paper.targetGroups && paper.targetGroups.length > 0
                ? paper.targetGroups.includes(user.groupId)
                : false;
            const inUsers = paper.targetUsers && paper.targetUsers.length > 0
                ? paper.targetUsers.includes(user.id)
                : false;
            if (!inGroup && !inUsers) return res.status(403).json({ error: '无权提交该试卷成绩' });

            if (paper.deadline) {
                const now = new Date();
                const deadline = new Date(paper.deadline.replace(' ', 'T'));
                if (deadline < now) return res.status(400).json({ error: '考试已截止' });
            }

            const existing = await db.getRecordByUserAndPaper(user.id, paper.id);
            if (existing) {
                if (paper.publishDate && existing.submitDate) {
                    const submitDate = new Date(existing.submitDate);
                    const publishDate = new Date(paper.publishDate);
                    if (submitDate >= publishDate) return res.status(400).json({ error: '您已提交过该考试' });
                } else {
                    return res.status(400).json({ error: '您已提交过该考试' });
                }
            }

            const session = await db.getExamSession(user.id, paper.id);
            if (!session) return res.status(400).json({ error: '考试会话不存在或已结束，请重新进入考试后提交' });

            const record = { ...(req.body || {}), id: generateId('r_'), userId };
            const result = await db.addRecord(record);

            await db.deleteExamSession(userId, paper.id);
            res.json(result);
        } catch (e) {
            console.error('提交考试记录失败:', e);
            res.status(500).json({ error: '提交考试记录失败' });
        }
    });

    app.get('/api/ranking/:paperId', async (req, res) => {
        const paperId = req.params.paperId;
        const requester = req.user;
        const paper = await db.getPaperById(paperId);
        if (!paper || !paper.published) return res.status(404).json({ error: '试卷不存在或未发布' });

        if (requester.role !== 'super_admin') {
            const targetGroups = Array.isArray(paper.targetGroups) ? paper.targetGroups : [];
            const targetUsers = Array.isArray(paper.targetUsers) ? paper.targetUsers : [];
            const inGroup = requester.groupId ? targetGroups.includes(requester.groupId) : false;
            const inUsers = targetUsers.includes(requester.id);

            if (requester.role === 'group_admin') {
                const canSee = paper.creatorId === requester.id || inGroup || inUsers;
                if (!canSee) return res.status(403).json({ error: '无权查看排行榜' });
            } else {
                if (!inGroup && !inUsers) return res.status(403).json({ error: '无权查看排行榜' });
            }
        }

        const records = await db.getRecordsByPaper(paperId);
        const users = await db.getUsers();

        // 计算该试卷总共推送给了多少人
        let totalAssigned = 0;
        if (paper && paper.targetGroups && paper.targetGroups.length > 0) {
            totalAssigned = users.filter(u => u.role === 'student' && paper.targetGroups.includes(u.groupId)).length;
        } else if (paper && paper.published) {
            // 如果已发布但没有目标组（可能逻辑上不应该，但作为保底），或者是全员推送
            totalAssigned = users.filter(u => u.role === 'student').length;
        }

        const ranking = records.map(r => {
            const user = users.find(u => u.id === r.userId);
            return { ...r, username: user ? user.username : '未知用户' };
        });

        ranking.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.totalTime - b.totalTime;
        });

        const rankedList = ranking.map((r, i) => ({ ...r, rank: i + 1 }));
        res.json({
            totalAssigned: totalAssigned || rankedList.length, // 至少是参与人数
            ranking: rankedList
        });
    });

    // ==================== 考试数据接口（考生端） ====================
    app.get('/api/exam/:paperId', async (req, res) => {
        try {
            const paperId = req.params.paperId;
            const userId = req.user.id;
            const user = await db.getUserById(userId);

            if (!user) {
                return res.status(401).json({ error: '用户不存在' });
            }

            const paper = await db.getPaperById(paperId);
            if (!paper || !paper.published) {
                return res.status(404).json({ error: '试卷不存在或未发布' });
            }

            // 检查是否在推送范围内
            const inGroup = paper.targetGroups && paper.targetGroups.length > 0
                ? paper.targetGroups.includes(user.groupId)
                : false;
            const inUsers = paper.targetUsers && paper.targetUsers.length > 0
                ? paper.targetUsers.includes(user.id)
                : false;

            if (!inGroup && !inUsers) {
                return res.status(403).json({ error: '无权参加该考试' });
            }

            // 截止时间检查
            if (paper.deadline) {
                const now = new Date();
                const deadline = new Date(paper.deadline.replace(' ', 'T'));
                if (deadline < now) {
                    return res.status(400).json({ error: '考试已截止' });
                }
            }

            // 是否已参加
            const record = await db.getRecordByUserAndPaper(user.id, paper.id);
            if (record) {
                // 如果已提交过，检查最后提交时间是否早于最新发布时间
                if (paper.publishDate && record.submitDate) {
                    const submitDate = new Date(record.submitDate);
                    const publishDate = new Date(paper.publishDate);
                    // 如果最后提交时间晚于发布时间，说明已经考过了最新推送的版本
                    if (submitDate >= publishDate) {
                        return res.status(400).json({ error: '您已参加过该考试' });
                    }
                } else {
                    return res.status(400).json({ error: '您已参加过该考试' });
                }
            }

            // 检查或创建会话
            let session = await db.getExamSession(user.id, paper.id);
            if (!session) {
                session = await db.createExamSession({
                    userId: user.id,
                    paperId: paper.id,
                    startTime: new Date().toISOString(),
                    answers: {}
                });
            }

            // 组装试题列表（只返回当前试卷包含的题目）
            const allQuestions = await db.getQuestions();
            const qMap = new Map();
            allQuestions.forEach(q => qMap.set(q.id, q));

            const selectedQuestions = [];
            if (paper.questions) {
                const types = ['single', 'multiple', 'judge'];
                types.forEach(type => {
                    const ids = paper.questions[type] || [];
                    ids.forEach(id => {
                        const q = qMap.get(id);
                        if (q) selectedQuestions.push(q);
                    });
                });
            }

            res.json({
                paper: {
                    id: paper.id,
                    name: paper.name,
                    rules: paper.rules || [],
                    questions: paper.questions || {},
                    deadline: paper.deadline || null
                },
                questions: selectedQuestions,
                session: {
                    startTime: session.startTime,
                    lastQuestionStartTime: session.lastQuestionStartTime,
                    answers: session.answers
                }
            });
        } catch (e) {
            console.error('获取考试数据失败:', e);
            res.status(500).json({ error: '获取考试数据失败' });
        }
    });

    app.put('/api/exam/:paperId/session', async (req, res) => {
        try {
            const paperId = req.params.paperId;
            const userId = req.user.id;
            const { answers, lastQuestionStartTime } = req.body;

            await db.updateExamSession(userId, paperId, answers, lastQuestionStartTime);
            res.json({ success: true });
        } catch (e) {
            console.error('更新考试进度失败:', e);
            res.status(500).json({ error: '更新考试进度失败' });
        }
    });

    // ==================== 系统日志接口 ====================
    app.get('/api/logs', superAdminMiddleware, async (req, res) => {
        const filter = {};

        // 筛选参数
        if (req.query.action) filter.action = req.query.action;
        if (req.query.target) filter.target = req.query.target;
        if (req.query.userId) filter.userId = req.query.userId;
        if (req.query.startDate) filter.startDate = req.query.startDate;
        if (req.query.endDate) filter.endDate = req.query.endDate;

        // 分页参数
        const page = parseInt(req.query.page) || 1;
        const pageSize = Math.min(200, parseInt(req.query.pageSize) || 20);
        filter.limit = pageSize;
        filter.offset = (page - 1) * pageSize;

        const [logs, total] = await Promise.all([
            db.getSystemLogs(filter),
            db.getSystemLogsCount(filter)
        ]);

        res.json({
            logs,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize)
        });
    });

    app.delete('/api/logs', superAdminMiddleware, async (req, res) => {
        try {
            await db.clearSystemLogs(null);
            // 记录日志
            await logAction('清空日志', 'logs', null, req.user, { all: true }, getClientIp(req));
            res.json({ success: true });
        } catch (e) {
            console.error('清空日志失败:', e);
            res.status(500).json({ error: '服务内部错误' });
        }
    });
};
