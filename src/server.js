const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const db = require('./db/db-adapter');
const dbConfig = require('./config/db-config');

const app = express();
const PORT = 3000;

// 文件上传配置
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// 启动服务器
async function startServer() {
    // 初始化数据库
    await db.initDatabase();
    console.log('数据库初始化完成');

    // ==================== 认证中间件 ====================
    const sessions = new Map(); // token -> user

    const authMiddleware = (req, res, next) => {
        // 白名单
        if (req.path === '/login') return next();

        const authHeader = req.headers['authorization'];
        if (!authHeader) return res.status(401).json({ error: '未登录或登录已过期' });

        const token = authHeader.split(' ')[1];
        if (!token || !sessions.has(token)) return res.status(401).json({ error: '无效的令牌' });

        req.user = sessions.get(token);
        next();
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
            sessions.clear();
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
            await db.importSqliteDb(req.file.buffer);
            // 清除所有会话，强制重新登录
            sessions.clear();
            res.json({ success: true, message: '数据库导入成功，请重新登录' });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ==================== 用户接口 ====================
    app.get('/api/users', adminMiddleware, async (req, res) => {
        const filter = {};
        if (req.user.role !== 'super_admin') {
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
        const user = { id: 'u_' + Date.now(), ...userData };
        res.json(await db.addUser(user));
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
        res.json(await db.updateUser(user));
    });

    app.post('/api/login', async (req, res) => {
        const { username, password } = req.body;
        const user = await db.login(username, password);
        if (user) {
            // 生成 Token
            const token = 'tk_' + Date.now() + '_' + Math.random().toString(36).substr(2);
            sessions.set(token, user);
            res.json({ token, user });
        } else {
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
        const group = { id: 'g_' + Date.now(), ...req.body };
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
            filter.groupId = req.user.groupId;
            filter.includePublic = true;
        }
        res.json(await db.getQuestions(filter));
    });

    app.post('/api/questions', adminMiddleware, async (req, res) => {
        const questionData = req.body;
        // 分组管理员只能创建本组题库
        if (req.user.role !== 'super_admin') {
            questionData.groupId = req.user.groupId;
        }
        const question = { id: 'q_' + Date.now(), ...questionData };
        res.json(await db.addQuestion(question));
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
        res.json(await db.updateQuestion(question));
    });

    app.delete('/api/questions/all', superAdminMiddleware, async (req, res) => {
        await db.deleteAllQuestions();
        res.json({ success: true });
    });

    app.delete('/api/questions/:id', adminMiddleware, async (req, res) => {
        const existing = (await db.getQuestions()).find(q => q.id === req.params.id);
        if (!existing) return res.status(404).json({ error: '题目不存在' });

        if (req.user.role !== 'super_admin' && existing.groupId !== req.user.groupId) {
            return res.status(403).json({ error: '无权删除' });
        }

        await db.deleteQuestion(req.params.id);
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
        const cat = { id: 'cat_' + Date.now(), ...req.body };
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
            id: 'p_' + Date.now(),
            createDate: new Date().toISOString().split('T')[0],
            creatorId: req.user.id,
            groupId: req.user.groupId,
            ...req.body
        };
        // 分组管理员强制创建本组试卷
        if (req.user.role !== 'super_admin') {
            paper.groupId = req.user.groupId;
        }
        res.json(await db.addPaper(paper));
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
            id: 'pl_' + Date.now(),
            paperId: req.params.id,
            pushTime,
            targetGroups,
            targetUsers,
            deadline
        });

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
    app.get('/api/records', async (req, res) => {
        res.json(await db.getRecords());
    });

    app.get('/api/records/paper/:paperId', async (req, res) => {
        res.json(await db.getRecordsByPaper(req.params.paperId));
    });

    app.delete('/api/records/paper/:paperId', async (req, res) => {
        await db.deleteRecordsByPaper(req.params.paperId);
        res.json({ success: true });
    });

    app.post('/api/records', async (req, res) => {
        const record = { id: 'r_' + Date.now(), ...req.body };
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

    app.listen(PORT, () => {
        console.log(`考试系统服务器已启动: http://localhost:${PORT}`);
    });
}

startServer().catch(err => {
    console.error('启动失败:', err);
});
