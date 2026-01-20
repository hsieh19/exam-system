const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const db = require('./db/db-adapter');
const dbConfig = require('./config/db-config');
const fs = require('fs');
const { createSessionStore } = require('./utils/session-store');

// 统一 ID 生成函数
const generateId = (prefix = '') => {
    return prefix + uuidv4().replace(/-/g, '').substring(0, 16);
};

// Session 配置
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24小时过期
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // 每小时清理一次

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 默认监听所有网络接口

// 文件上传配置
// 文件上传配置 (使用磁盘缓存，避免内存溢出)
const TEMP_UPLOADS = path.join(__dirname, '../temp_uploads');
// 启动时确保存储目录存在
try {
    if (!fs.existsSync(TEMP_UPLOADS)) {
        fs.mkdirSync(TEMP_UPLOADS, { recursive: true });
    }
} catch (e) {
    console.error('无法创建临时上传目录:', e);
}
const upload = multer({ dest: TEMP_UPLOADS });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// 启动服务器
async function startServer() {
    // 初始化数据库
    await db.initDatabase();
    console.log('数据库初始化完成');

    // ==================== 认证中间件 ====================
    // 初始化 Session Store (支持 Redis/Memory)
    const sessionStore = await createSessionStore();

    // ==================== 认证中间件 ====================

    // 生成安全 Token
    const generateSecureToken = () => {
        return crypto.randomBytes(32).toString('hex');
    };

    // Session 清理已由 Store 内部自动管理 (Redis TTL 或 Memory Interval)

    const authMiddleware = async (req, res, next) => {
        // 白名单
        if (req.path === '/login') return next();

        const authHeader = req.headers['authorization'];
        if (!authHeader) return res.status(401).json({ error: '未登录或登录已过期' });

        const token = authHeader.split(' ')[1];

        try {
            const session = await sessionStore.get(token);

            if (!token || !session) {
                // 如果 Token 还在但 Session 没了 (比如 Redis 丢失或过期)，尝试清理客户端可能的无效 Token
                // 但这里 server 端能做的就是返回 401
                if (token) await sessionStore.delete(token); // 确保清理
                return res.status(401).json({ error: '无效的令牌或会话已过期' });
            }

            req.user = session.user;
            req.token = token; // 保存 token 以便续期
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

    // 获取客户端IP
    const getClientIp = (req) => {
        return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.connection?.remoteAddress ||
            req.socket?.remoteAddress ||
            'unknown';
    };

    // 记录系统日志辅助函数
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

    // 对 /api 下的所有请求应用鉴权（除了在中间件里排除的）
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
            await logAction('switch', 'database', dbType, req.user, { dbType }, getClientIp(req));
            res.json({ success: true, message: `已切换到 ${dbType} 数据库` });
        } catch (e) {
            res.status(500).json({ error: e.message });
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

    app.post('/api/db/import', adminMiddleware, upload.single('file'), async (req, res) => {
        if (db.getActiveDbType() !== 'sqlite') {
            return res.status(400).json({ error: '只有 SQLite 数据库支持导入' });
        }
        if (!req.file) {
            return res.status(400).json({ error: '请上传文件' });
        }
        try {
            // 读取文件 buffer
            const fileData = fs.readFileSync(req.file.path);

            await db.importSqliteDb(fileData);

            // 清理临时文件
            try { fs.unlinkSync(req.file.path); } catch (e) { }

            // 清除所有会话，强制重新登录
            await sessionStore.clear();
            res.json({ success: true, message: '数据库导入成功，请重新登录' });
        } catch (e) {
            res.status(500).json({ error: e.message });
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
        const user = { id: generateId('u_'), ...userData };
        const result = await db.addUser(user);
        // 记录日志
        await logAction('create', 'user', user.id, req.user, { username: userData.username, role: userData.role }, getClientIp(req));
        res.json(result);
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
        // 3. 非超管只能删除本组成员
        if (req.user.role !== 'super_admin' && targetUser.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权操作该用户' });
        }

        await db.deleteUser(req.params.id);
        // 记录日志
        await logAction('delete', 'user', req.params.id, req.user, { username: targetUser.username }, getClientIp(req));
        res.json({ success: true });
    });

    app.put('/api/users/:id', adminMiddleware, async (req, res) => {
        const targetUser = await db.getUserById(req.params.id);
        if (!targetUser) return res.status(404).json({ error: '用户不存在' });

        const updateData = req.body;
        // 权限检查
        if (req.user.role !== 'super_admin') {
            // 不能修改超管
            if (targetUser.role === 'super_admin') {
                return res.status(403).json({ error: '无权操作超级管理员' });
            }
            if (targetUser.groupId !== req.user.groupId) {
                return res.status(403).json({ error: '无权操作该用户' });
            }
            // 分组管理员不能修改角色和分组
            delete updateData.role;
            delete updateData.groupId;
        }

        // 核心保护：防止超管修改自己的角色导致权限丢失
        if (req.user.id === targetUser.id) {
            delete updateData.role;
        }

        const user = { ...updateData, id: req.params.id };
        const result = await db.updateUser(user);
        // 记录日志
        await logAction('update', 'user', req.params.id, req.user, { username: updateData.username }, getClientIp(req));
        res.json(result);
    });

    app.post('/api/login', async (req, res) => {
        const { username, password } = req.body;
        const clientIp = getClientIp(req);
        const user = await db.login(username, password);
        if (user) {
            // 生成安全 Token
            const token = generateSecureToken();
            // Redis Store 不需要在 value 中存 expiresAt，因为它由 TTL 控制
            // 但为了兼容 currentUser 接口可能的逻辑，我们保留它
            const expiresAt = Date.now() + SESSION_EXPIRY_MS;
            await sessionStore.set(token, { ...user, expiresAt }, SESSION_EXPIRY_MS);
            // 记录登录成功日志
            await logAction('login', 'user', user.id, user, { username }, clientIp);
            res.json({ token, user, expiresIn: SESSION_EXPIRY_MS });
        } else {
            // 记录登录失败日志
            await logAction('login_failed', 'user', null, null, { username }, clientIp);
            res.status(401).json({ error: '用户名或密码错误' });
        }
    });

    app.get('/api/currentUser', async (req, res) => {
        // 中间件已注入 req.user
        if (req.user) {
            const latest = await db.getUserById(req.user.id);
            if (latest) res.json(latest);
            else res.status(401).json({ error: 'User not found' });
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    });

    // ==================== 分组接口 ====================
    app.get('/api/groups', async (req, res) => {
        res.json(await db.getGroups());
    });

    app.post('/api/groups', superAdminMiddleware, async (req, res) => {
        const group = { id: generateId('g_'), ...req.body };
        res.json(await db.addGroup(group));
    });

    app.delete('/api/groups/:id', superAdminMiddleware, async (req, res) => {
        await db.deleteGroup(req.params.id);
        res.json({ success: true });
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
        const question = { id: generateId('q_'), ...questionData };
        const result = await db.addQuestion(question);
        await logAction('create', 'question', question.id, req.user, { type: questionData.type }, getClientIp(req));
        res.json(result);
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
        await logAction('update', 'question', req.params.id, req.user, { type: question.type }, getClientIp(req));
        res.json(result);
    });

    app.delete('/api/questions/all', superAdminMiddleware, async (req, res) => {
        await db.deleteAllQuestions();
        await logAction('delete_all', 'question', null, req.user, {}, getClientIp(req));
        res.json({ success: true });
    });

    app.delete('/api/questions/:id', adminMiddleware, async (req, res) => {
        const existing = (await db.getQuestions()).find(q => q.id === req.params.id);
        if (!existing) return res.status(404).json({ error: '题目不存在' });

        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权删除' });
        }

        await db.deleteQuestion(req.params.id);
        await logAction('delete', 'question', req.params.id, req.user, {}, getClientIp(req));
        res.json({ success: true });
    });

    // ==================== 专业分类接口 ====================
    app.get('/api/categories', async (req, res) => {
        res.json(await db.getCategories());
    });

    app.get('/api/categories/majors', async (req, res) => {
        res.json(await db.getMajors());
    });

    app.get('/api/categories/devices/:majorId', async (req, res) => {
        res.json(await db.getDeviceTypes(req.params.majorId));
    });

    app.post('/api/categories', superAdminMiddleware, async (req, res) => {
        const cat = { id: generateId('cat_'), ...req.body };
        res.json(await db.addCategory(cat));
    });

    app.put('/api/categories/:id', superAdminMiddleware, async (req, res) => {
        const cat = { ...req.body, id: req.params.id };
        res.json(await db.updateCategory(cat));
    });

    app.delete('/api/categories/:id', superAdminMiddleware, async (req, res) => {
        await db.deleteCategory(req.params.id);
        res.json({ success: true });
    });

    // ==================== 试卷接口 ====================
    app.get('/api/papers', adminMiddleware, async (req, res) => {
        const filter = {};
        if (req.user.role !== 'super_admin') {
            // 如无分组ID，视为无权限查看试卷
            if (!req.user.groupId) return res.json([]);
            filter.groupId = req.user.groupId;
        }
        res.json(await db.getPapers(filter));
    });

    app.get('/api/papers/:id', adminMiddleware, async (req, res) => {
        const paper = await db.getPaperById(req.params.id);
        if (paper) {
            if (req.user.role !== 'super_admin' && paper.groupId !== req.user.groupId) {
                return res.status(403).json({ error: '无权访问该试卷' });
            }
            res.json(paper);
        } else {
            res.status(404).json({ error: '试卷不存在' });
        }
    });

    app.post('/api/papers', adminMiddleware, async (req, res) => {
        const paper = {
            id: generateId('p_'),
            createDate: new Date().toISOString().split('T')[0],
            creatorId: req.user.id,
            groupId: req.user.groupId,
            ...req.body
        };
        // 分组管理员强制创建本组试卷
        if (req.user.role !== 'super_admin') {
            paper.groupId = req.user.groupId;
        }
        const result = await db.addPaper(paper);
        await logAction('create', 'paper', paper.id, req.user, { name: paper.name }, getClientIp(req));
        res.json(result);
    });

    app.put('/api/papers/:id', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) return res.status(404).json({ error: '试卷不存在' });

        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权修改' });
        }

        const paper = { ...req.body, id: req.params.id };
        if (req.user.role !== 'super_admin') {
            paper.groupId = req.user.groupId;
        }
        res.json(await db.updatePaper(paper));
    });

    app.put('/api/papers/:id/publish', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: '试卷不存在' });
        }

        // 权限检查
        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
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
            publishDate: pushTime.split('T')[0]
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
        await logAction('publish', 'paper', req.params.id, req.user, { name: existing.name, targetGroups }, getClientIp(req));

        res.json(paper);
    });

    app.get('/api/papers/:id/push-logs', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) return res.status(404).json({ error: '试卷不存在' });

        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权查看' });
        }

        const logs = await db.getPushLogsByPaper(req.params.id);
        res.json(logs);
    });

    app.delete('/api/papers/:id', adminMiddleware, async (req, res) => {
        const existing = await db.getPaperById(req.params.id);
        if (!existing) return res.status(404).json({ error: '试卷不存在' });

        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权删除' });
        }

        await db.deletePaper(req.params.id);
        await logAction('delete', 'paper', req.params.id, req.user, { name: existing.name }, getClientIp(req));
        res.json({ success: true });
    });

    app.get('/api/papers/user/:userId', async (req, res) => {
        const user = await db.getUserById(req.params.userId);
        if (!user) return res.json([]);

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

            if (await db.hasUserTakenExam(user.id, p.id)) return null;
            return p;
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
        // 确保用户只能为自己提交记录
        const record = { id: generateId('r_'), ...req.body, userId: req.user.id };
        res.json(await db.addRecord(record));
    });

    app.get('/api/ranking/:paperId', async (req, res) => {
        const paperId = req.params.paperId;
        const records = await db.getRecordsByPaper(paperId);
        const users = await db.getUsers();
        const paper = await db.getPaperById(paperId);

        // 计算该试卷总共推送给了多少人
        let totalAssigned = 0;
        if (paper && paper.targetGroups && paper.targetGroups.length > 0) {
            totalAssigned = users.filter(u => paper.targetGroups.includes(u.groupId)).length;
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
        const pageSize = parseInt(req.query.pageSize) || 20;
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
        const { beforeDate } = req.body;
        await db.clearSystemLogs(beforeDate);
        await logAction('clear', 'logs', null, req.user, { beforeDate }, getClientIp(req));
        res.json({ success: true });
    });

    app.listen(PORT, HOST, () => {
        console.log(`考试系统服务器已启动: http://${HOST === '0.0.0.0' ? '服务器IP' : HOST}:${PORT}`);
        if (HOST === '0.0.0.0') {
            console.log('提示: 服务已绑定到所有网络接口，可从外部访问');
        }
    });
}

startServer().catch(err => {
    console.error('启动失败:', err);
});
