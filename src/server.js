const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/database');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
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

    // 对 /api 下的所有请求应用鉴权（除了在中间件里排除的）
    app.use('/api', authMiddleware);

    // ==================== 用户接口 ====================
    app.get('/api/users', (req, res) => {
        res.json(db.getUsers());
    });

    app.post('/api/users', (req, res) => {
        const user = { id: 'u_' + Date.now(), ...req.body };
        res.json(db.addUser(user));
    });

    app.delete('/api/users/:id', (req, res) => {
        db.deleteUser(req.params.id);
        res.json({ success: true });
    });

    app.put('/api/users/:id', (req, res) => {
        const user = { ...req.body, id: req.params.id };
        res.json(db.updateUser(user));
    });

    app.post('/api/login', (req, res) => {
        const { username, password } = req.body;
        const user = db.login(username, password);
        if (user) {
            // 生成 Token
            const token = 'tk_' + Date.now() + '_' + Math.random().toString(36).substr(2);
            sessions.set(token, user);
            res.json({ token, user });
        } else {
            res.status(401).json({ error: '用户名或密码错误' });
        }
    });

    app.get('/api/currentUser', (req, res) => {
        // 中间件已注入 req.user
        if (req.user) {
            const latest = db.getUserById(req.user.id);
            if (latest) res.json(latest);
            else res.status(401).json({ error: 'User not found' });
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    });

    // ==================== 分组接口 ====================
    app.get('/api/groups', (req, res) => {
        res.json(db.getGroups());
    });

    app.post('/api/groups', (req, res) => {
        const group = { id: 'g_' + Date.now(), ...req.body };
        res.json(db.addGroup(group));
    });

    app.delete('/api/groups/:id', (req, res) => {
        db.deleteGroup(req.params.id);
        res.json({ success: true });
    });

    // ==================== 题目接口 ====================
    app.get('/api/questions', (req, res) => {
        res.json(db.getQuestions());
    });

    app.post('/api/questions', (req, res) => {
        const question = { id: 'q_' + Date.now(), ...req.body };
        res.json(db.addQuestion(question));
    });

    app.put('/api/questions/:id', (req, res) => {
        const question = { ...req.body, id: req.params.id };
        res.json(db.updateQuestion(question));
    });

    app.delete('/api/questions/all', (req, res) => {
        db.deleteAllQuestions();
        res.json({ success: true });
    });

    app.delete('/api/questions/:id', (req, res) => {
        db.deleteQuestion(req.params.id);
        res.json({ success: true });
    });

    // ==================== 专业分类接口 ====================
    app.get('/api/categories', (req, res) => {
        res.json(db.getCategories());
    });

    app.get('/api/categories/majors', (req, res) => {
        res.json(db.getMajors());
    });

    app.get('/api/categories/devices/:majorId', (req, res) => {
        res.json(db.getDeviceTypes(req.params.majorId));
    });

    app.post('/api/categories', (req, res) => {
        const cat = { id: 'cat_' + Date.now(), ...req.body };
        res.json(db.addCategory(cat));
    });

    app.put('/api/categories/:id', (req, res) => {
        const cat = { ...req.body, id: req.params.id };
        res.json(db.updateCategory(cat));
    });

    app.delete('/api/categories/:id', (req, res) => {
        db.deleteCategory(req.params.id);
        res.json({ success: true });
    });

    // ==================== 试卷接口 ====================
    app.get('/api/papers', (req, res) => {
        res.json(db.getPapers());
    });

    app.get('/api/papers/:id', (req, res) => {
        const paper = db.getPaperById(req.params.id);
        if (paper) {
            res.json(paper);
        } else {
            res.status(404).json({ error: '试卷不存在' });
        }
    });

    app.post('/api/papers', (req, res) => {
        const paper = {
            id: 'p_' + Date.now(),
            createDate: new Date().toISOString().split('T')[0],
            ...req.body
        };
        res.json(db.addPaper(paper));
    });

    app.put('/api/papers/:id', (req, res) => {
        const paper = { ...req.body, id: req.params.id };
        res.json(db.updatePaper(paper));
    });

    app.put('/api/papers/:id/publish', (req, res) => {
        const existing = db.getPaperById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: '试卷不存在' });
        }

        const targetGroups = req.body.targetGroups || [];
        const targetUsers = req.body.targetUsers || [];
        const deadline = req.body.deadline;
        const pushTime = new Date().toISOString();

        // 更新试卷的最新推送信息
        const paper = {
            ...existing,
            published: true,
            targetGroups,
            targetUsers,
            deadline,
            publishDate: pushTime.split('T')[0]
        };
        db.updatePaper(paper);

        // 记录推送日志
        db.addPushLog({
            id: 'pl_' + Date.now(),
            paperId: req.params.id,
            pushTime,
            targetGroups,
            targetUsers,
            deadline
        });

        res.json(paper);
    });

    app.get('/api/papers/:id/push-logs', (req, res) => {
        const logs = db.getPushLogsByPaper(req.params.id);
        res.json(logs);
    });

    app.delete('/api/papers/:id', (req, res) => {
        db.deletePaper(req.params.id);
        res.json({ success: true });
    });

    app.get('/api/papers/user/:userId', (req, res) => {
        const user = db.getUserById(req.params.userId);
        if (!user) return res.json([]);

        const papers = db.getPapers();
        const available = papers.filter(p => {
            if (!p.published) return false;

            // 检查是否在目标组或目标用户中
            const isInGroup = p.targetGroups && p.targetGroups.includes(user.groupId);
            const isTargetUser = p.targetUsers && p.targetUsers.includes(user.id);
            if (!isInGroup && !isTargetUser) return false;

            // 如果有截止日期，检查是否过期
            if (p.deadline) {
                const now = new Date();
                const deadline = new Date(p.deadline.replace(' ', 'T'));
                if (deadline < now) return false;
            }

            if (db.hasUserTakenExam(user.id, p.id)) return false;
            return true;
        });

        res.json(available);
    });

    // ==================== 记录接口 ====================
    app.get('/api/records', (req, res) => {
        res.json(db.getRecords());
    });

    app.get('/api/records/paper/:paperId', (req, res) => {
        res.json(db.getRecordsByPaper(req.params.paperId));
    });

    app.delete('/api/records/paper/:paperId', (req, res) => {
        db.deleteRecordsByPaper(req.params.paperId);
        res.json({ success: true });
    });

    app.post('/api/records', (req, res) => {
        const record = { id: 'r_' + Date.now(), ...req.body };
        res.json(db.addRecord(record));
    });

    app.get('/api/ranking/:paperId', (req, res) => {
        const paperId = req.params.paperId;
        const records = db.getRecordsByPaper(paperId);
        const users = db.getUsers();
        const paper = db.getPaperById(paperId);

        // 计算该试卷总共推送给了多少人
        let totalAssigned = 0;
        if (paper && paper.targetGroups && paper.targetGroups.length > 0) {
            totalAssigned = users.filter(u => paper.targetGroups.includes(u.groupId)).length;
        } else if (paper && paper.published) {
            // 如果已发布但没有目标组（可能逻辑上不应该，但作为保底），或者是全员推送
            totalAssigned = users.filter(u => u.role === 'student').length;
        }

        const ranking = records.map(r => {
            const user = users.find(u => u.id === r.userId) || db.getUserById(r.userId);
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
