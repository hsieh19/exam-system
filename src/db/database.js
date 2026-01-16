const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // 引入 crypto

// 数据库路径：在打包环境下，__dirname 是虚拟的快照目录，
// 我们需要将数据库存在程序运行的实际目录下
const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : __dirname;
const DB_PATH = isPkg ? path.join(baseDir, 'exam.db') : path.resolve(__dirname, '../../db/exam.db');

let db = null;

// 简单的 SHA-256 哈希辅助函数
function hashPassword(password) {
    if (!password) return '';
    return crypto.createHash('sha256').update(password).digest('hex');
}

// 验证密码（支持明文兼容：如果库里是明文，尝试匹配；如果是哈希，匹配哈希）
function verifyPassword(inputPassword, storedPassword) {
    if (!inputPassword || !storedPassword) return false;
    // 1. 尝试匹配哈希
    const hashed = hashPassword(inputPassword);
    if (hashed === storedPassword) return true;
    // 2. 尝试匹配明文 (兼容旧数据)
    if (inputPassword === storedPassword) return true;
    return false;
}

// 移除敏感字段
function sanitizeUser(user) {
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser;
}
function sanitizeUsers(users) {
    return users.map(u => sanitizeUser(u));
}

async function initDatabase() {
    const SQL = await initSqlJs();

    // 尝试加载已有数据库
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // 初始化表结构
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'student',
      groupId TEXT
    );
  `);
    // ... (其他表结构保持不变，省略以节省 token，但实际操作需谨慎。这里因为是工具调用，我必须包含上下文或确保不破坏文件)
    // 为了安全，我将只替换受影响的函数部分，而不是整个 initDatabase，
    // 但 initDatabase 里有初始数据插入，那里也要改密码。
    // 让我们分块替换。

    // ... groups table
    db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      options TEXT,
      answer TEXT NOT NULL,
      category TEXT
    );
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rules TEXT,
      questions TEXT,
      published INTEGER DEFAULT 0,
      targetGroups TEXT,
      deadline TEXT,
      publishDate TEXT,
      createDate TEXT
    );
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      paperId TEXT,
      userId TEXT,
      score INTEGER,
      totalTime INTEGER,
      answers TEXT,
      submitTime TEXT
    );
  `);

    // 初始化默认数据
    const adminExists = db.exec("SELECT id FROM users WHERE username = 'admin'");
    if (adminExists.length === 0 || adminExists[0].values.length === 0) {
        db.run("INSERT INTO users (id, username, password, role, groupId) VALUES (?, ?, ?, ?, ?)",
            ['u_admin', 'admin', hashPassword('admin123'), 'admin', null]);
    }

    const groupExists = db.exec("SELECT id FROM groups WHERE name = '默认分组'");
    if (groupExists.length === 0 || groupExists[0].values.length === 0) {
        db.run("INSERT INTO groups (id, name) VALUES (?, ?)", ['g_default', '默认分组']);
    }

    const studentExists = db.exec("SELECT id FROM users WHERE username = '张三'");
    if (studentExists.length === 0 || studentExists[0].values.length === 0) {
        db.run("INSERT INTO users (id, username, password, role, groupId) VALUES (?, ?, ?, ?, ?)",
            ['u_zhangsan', '张三', hashPassword('123456'), 'student', 'g_default']);
    }

    saveDatabase();
    return db;
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

function execQuery(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function runQuery(sql, params = []) {
    db.run(sql, params);
    saveDatabase();
}

module.exports = {
    initDatabase,

    getUsers() {
        // 返回所有用户，以便管理管理员权限
        const users = execQuery("SELECT * FROM users");
        return sanitizeUsers(users);
    },

    getUserById(id) {
        const results = execQuery("SELECT * FROM users WHERE id = ?", [id]);
        return sanitizeUser(results[0] || null);
    },

    getUserByUsername(username) {
        const results = execQuery("SELECT * FROM users WHERE username = ?", [username]);
        return sanitizeUser(results[0] || null);
    },

    addUser(user) {
        // 存储时加密
        const pwd = hashPassword(user.password || '123456');
        runQuery("INSERT INTO users (id, username, password, role, groupId) VALUES (?, ?, ?, ?, ?)",
            [user.id, user.username, pwd, user.role || 'student', user.groupId]);
        return sanitizeUser(user);
    },

    deleteUser(id) {
        runQuery("DELETE FROM users WHERE id = ?", [id]);
    },

    updateUser(user) {
        if (user.password) {
            const pwd = hashPassword(user.password);
            runQuery("UPDATE users SET username = ?, password = ?, role = ?, groupId = ? WHERE id = ?",
                [user.username, pwd, user.role, user.groupId, user.id]);
        } else {
            runQuery("UPDATE users SET username = ?, role = ?, groupId = ? WHERE id = ?",
                [user.username, user.role, user.groupId, user.id]);
        }
        return sanitizeUser(user);
    },

    login(username, password) {
        // 先查出带密码的用户记录
        const results = execQuery("SELECT * FROM users WHERE username = ?", [username]);
        const user = results[0];

        if (user && verifyPassword(password, user.password)) {
            return sanitizeUser(user);
        }
        return null;
    },

    getGroups() {
        return execQuery("SELECT * FROM groups");
    },

    addGroup(group) {
        runQuery("INSERT INTO groups (id, name) VALUES (?, ?)", [group.id, group.name]);
        return group;
    },

    deleteGroup(id) {
        runQuery("DELETE FROM groups WHERE id = ?", [id]);
        runQuery("UPDATE users SET groupId = NULL WHERE groupId = ?", [id]);
    },

    getQuestions() {
        const rows = execQuery("SELECT * FROM questions");
        return rows.map(r => ({
            ...r,
            options: r.options ? JSON.parse(r.options) : null,
            answer: r.type === 'multiple' && r.answer ? JSON.parse(r.answer) : r.answer
        }));
    },

    addQuestion(q) {
        runQuery("INSERT INTO questions (id, type, content, options, answer, category) VALUES (?, ?, ?, ?, ?, ?)",
            [q.id, q.type, q.content, JSON.stringify(q.options), JSON.stringify(q.answer), q.category || '']);
        return q;
    },

    updateQuestion(q) {
        runQuery("UPDATE questions SET type = ?, content = ?, options = ?, answer = ?, category = ? WHERE id = ?",
            [q.type, q.content, JSON.stringify(q.options), JSON.stringify(q.answer), q.category || '', q.id]);
        return q;
    },

    deleteQuestion(id) {
        runQuery("DELETE FROM questions WHERE id = ?", [id]);
    },

    getPapers() {
        const rows = execQuery("SELECT * FROM papers");
        return rows.map(r => ({
            ...r,
            rules: r.rules ? JSON.parse(r.rules) : [],
            questions: r.questions ? JSON.parse(r.questions) : {},
            targetGroups: r.targetGroups ? JSON.parse(r.targetGroups) : [],
            published: !!r.published
        }));
    },

    getPaperById(id) {
        const results = execQuery("SELECT * FROM papers WHERE id = ?", [id]);
        const r = results[0];
        if (!r) return null;
        return {
            ...r,
            rules: r.rules ? JSON.parse(r.rules) : [],
            questions: r.questions ? JSON.parse(r.questions) : {},
            targetGroups: r.targetGroups ? JSON.parse(r.targetGroups) : [],
            published: !!r.published
        };
    },

    addPaper(paper) {
        runQuery("INSERT INTO papers (id, name, rules, questions, published, targetGroups, deadline, publishDate, createDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [paper.id, paper.name,
            JSON.stringify(paper.rules || []),
            JSON.stringify(paper.questions || {}),
            paper.published ? 1 : 0,
            JSON.stringify(paper.targetGroups || []),
            paper.deadline || null,
            paper.publishDate || null,
            paper.createDate || new Date().toISOString().split('T')[0]]);
        return paper;
    },

    updatePaper(paper) {
        runQuery("UPDATE papers SET name = ?, rules = ?, questions = ?, published = ?, targetGroups = ?, deadline = ?, publishDate = ? WHERE id = ?",
            [paper.name,
            JSON.stringify(paper.rules || []),
            JSON.stringify(paper.questions || {}),
            paper.published ? 1 : 0,
            JSON.stringify(paper.targetGroups || []),
            paper.deadline || null,
            paper.publishDate || null,
            paper.id]);
        return paper;
    },

    deletePaper(id) {
        runQuery("DELETE FROM papers WHERE id = ?", [id]);
    },

    deleteRecordsByPaper(paperId) {
        runQuery("DELETE FROM records WHERE paperId = ?", [paperId]);
    },

    getRecords() {
        const rows = execQuery("SELECT * FROM records");
        return rows.map(r => ({
            ...r,
            answers: r.answers ? JSON.parse(r.answers) : {}
        }));
    },

    getRecordsByPaper(paperId) {
        const rows = execQuery("SELECT * FROM records WHERE paperId = ?", [paperId]);
        return rows.map(r => ({
            ...r,
            answers: r.answers ? JSON.parse(r.answers) : {}
        }));
    },

    addRecord(record) {
        runQuery("INSERT INTO records (id, paperId, userId, score, totalTime, answers, submitTime) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [record.id || 'r_' + Date.now(),
            record.paperId, record.userId, record.score, record.totalTime,
            JSON.stringify(record.answers || {}),
            record.submitTime || new Date().toISOString()]);
        return record;
    },

    hasUserTakenExam(userId, paperId) {
        const results = execQuery("SELECT id FROM records WHERE userId = ? AND paperId = ?", [userId, paperId]);
        return results.length > 0;
    }
};
