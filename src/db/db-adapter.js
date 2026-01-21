/**
 * 多数据库适配器 - 统一接口
 * 支持 SQLite, MySQL, PostgreSQL
 */
const initSqlJs = require('sql.js');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const dbConfig = require('../config/db-config');

// 统一 ID 生成函数（使用 UUID v4 确保唯一性）
const generateId = (prefix = '') => {
    return prefix + uuidv4().replace(/-/g, '').substring(0, 16);
};

// 数据库路径
const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : path.resolve(__dirname, '../..');
const SQLITE_PATH = path.join(baseDir, 'db', 'exam.db');

// 当前数据库连接
let currentDb = null;
let currentDbType = null;

// ==================== 辅助函数 ====================

async function hashPassword(password) {
    if (!password) return '';
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
}

async function verifyPassword(inputPassword, storedPassword) {
    if (!storedPassword) return !inputPassword;
    // 兼容旧的 sha256 哈希 (64位十六进制)
    if (storedPassword.length === 64 && /^[a-f0-9]+$/.test(storedPassword)) {
        const oldHash = crypto.createHash('sha256').update(inputPassword).digest('hex');
        return oldHash === storedPassword;
    }
    // 使用 bcrypt 验证
    try {
        return await bcrypt.compare(inputPassword, storedPassword);
    } catch (e) {
        return inputPassword === storedPassword; // 最后的兜底：明文对比（仅限极早期数据）
    }
}

function sanitizeUser(user) {
    if (!user) return null;
    const { password, ...safe } = user;
    return safe;
}

function sanitizeUsers(users) {
    return users.map(sanitizeUser);
}

// ==================== SQLite 实现 ====================

const sqliteAdapter = {
    db: null,

    async init() {
        const SQL = await initSqlJs();

        // 确保目录存在
        const dbDir = path.dirname(SQLITE_PATH);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        if (fs.existsSync(SQLITE_PATH)) {
            const buffer = fs.readFileSync(SQLITE_PATH);
            this.db = new SQL.Database(buffer);
        } else {
            this.db = new SQL.Database();
        }

        await this.createTables();
        console.log('SQLite 数据库初始化完成');
        return this.db;
    },

    async createTables() {
        const tables = `
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'student',
                groupId TEXT
            );
            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS questions (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                options TEXT,
                answer TEXT NOT NULL,
                category TEXT,
                deviceType TEXT,
                groupId TEXT,
                updatedAt TEXT
            );
            CREATE TABLE IF NOT EXISTS papers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                questions TEXT,
                rules TEXT,
                published INTEGER DEFAULT 0,
                createDate TEXT,
                targetGroups TEXT,
                targetUsers TEXT,
                deadline TEXT,
                groupId TEXT,
                creatorId TEXT
            );
            CREATE TABLE IF NOT EXISTS records (
                id TEXT PRIMARY KEY,
                paperId TEXT NOT NULL,
                userId TEXT NOT NULL,
                score INTEGER,
                totalTime INTEGER,
                answers TEXT,
                submitDate TEXT
            );
            CREATE TABLE IF NOT EXISTS push_logs (
                id TEXT PRIMARY KEY,
                paperId TEXT NOT NULL,
                targetGroups TEXT,
                targetUsers TEXT,
                deadline TEXT,
                pushDate TEXT
            );
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                parentId TEXT
            );
            CREATE TABLE IF NOT EXISTS system_logs (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                targetId TEXT,
                userId TEXT,
                username TEXT,
                details TEXT,
                ip TEXT,
                createdAt TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_users_groupId ON users(groupId);
            CREATE INDEX IF NOT EXISTS idx_questions_groupId ON questions(groupId);
            CREATE INDEX IF NOT EXISTS idx_papers_groupId ON papers(groupId);
            CREATE INDEX IF NOT EXISTS idx_records_paperId ON records(paperId);
            CREATE INDEX IF NOT EXISTS idx_records_userId ON records(userId);
        `;
        this.db.run(tables);

        // 数据库迁移：为现有表添加新字段（如果不存在）
        try {
            this.db.run("ALTER TABLE questions ADD COLUMN updatedAt TEXT");
        } catch (e) {
            if (!e.message.includes('duplicate column')) {
                console.log('Migration: updatedAt column already exists or error:', e.message);
            }
        }
        try {
            this.db.run("ALTER TABLE papers ADD COLUMN published INTEGER DEFAULT 0");
        } catch (e) {
            if (!e.message.includes('duplicate column')) {
                console.log('Migration: published column already exists or error:', e.message);
            }
        }

        // 确保有管理员账号
        const admin = this.db.exec("SELECT * FROM users WHERE username = 'admin'");
        if (!admin.length || !admin[0].values.length) {
            const hashedPwd = await hashPassword('admin123');
            this.db.run("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
                ['admin-001', 'admin', hashedPwd, 'super_admin']);
        }

        // 确保有演示学生账号
        const student = this.db.exec("SELECT * FROM users WHERE username = 'student'");
        if (!student.length || !student[0].values.length) {
            const hashedPwd = await hashPassword('123456');
            this.db.run("INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
                ['student-001', 'student', hashedPwd, 'student']);
        }

        this.save();
    },

    save() {
        const data = this.db.export();
        fs.writeFileSync(SQLITE_PATH, Buffer.from(data));
    },

    query(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            stmt.bind(params);
            const results = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            stmt.free();
            return results;
        } catch (e) {
            console.error('SQLite query error:', e.message);
            return [];
        }
    },

    run(sql, params = []) {
        try {
            this.db.run(sql, params);
            this.save();
        } catch (e) {
            console.error('SQLite run error:', e.message);
        }
    },

    async close() {
        if (this.db) {
            this.save();
            this.db.close();
            this.db = null;
        }
    },

    // 导出数据库文件
    exportDb() {
        if (!this.db) return null;
        return this.db.export();
    },

    // 导入数据库文件
    async importDb(buffer) {
        const SQL = await initSqlJs();
        this.db = new SQL.Database(buffer);
        this.save();
        return true;
    }
};

// ==================== MySQL 实现 ====================

const mysqlAdapter = {
    pool: null,

    async init() {
        const config = dbConfig.getDbConfig('mysql');
        if (!config) throw new Error('MySQL 配置不存在');

        this.pool = mysql.createPool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            waitForConnections: true,
            connectionLimit: config.connectionLimit || 10
        });

        await this.createTables();
        console.log('MySQL 数据库初始化完成');
        return this.pool;
    },

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'student',
                groupId VARCHAR(255)
            )`,
            `CREATE TABLE IF NOT EXISTS \`groups\` (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS questions (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                options TEXT,
                answer TEXT NOT NULL,
                category VARCHAR(255),
                deviceType VARCHAR(255),
                groupId VARCHAR(255),
                updatedAt VARCHAR(50)
            )`,
            `CREATE TABLE IF NOT EXISTS papers (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                questions TEXT,
                rules TEXT,
                published TINYINT DEFAULT 0,
                createDate VARCHAR(50),
                targetGroups TEXT,
                targetUsers TEXT,
                deadline VARCHAR(50),
                groupId VARCHAR(255),
                creatorId VARCHAR(255)
            )`,
            `CREATE TABLE IF NOT EXISTS records (
                id VARCHAR(255) PRIMARY KEY,
                paperId VARCHAR(255) NOT NULL,
                userId VARCHAR(255) NOT NULL,
                score INT,
                totalTime INT,
                answers TEXT,
                submitDate VARCHAR(50)
            )`,
            `CREATE TABLE IF NOT EXISTS push_logs (
                id VARCHAR(255) PRIMARY KEY,
                paperId VARCHAR(255) NOT NULL,
                targetGroups TEXT,
                targetUsers TEXT,
                deadline VARCHAR(50),
                pushDate VARCHAR(50)
            )`,
            `CREATE TABLE IF NOT EXISTS categories (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                parentId VARCHAR(255)
            )`,
            `CREATE TABLE IF NOT EXISTS system_logs (
                id VARCHAR(255) PRIMARY KEY,
                action VARCHAR(50) NOT NULL,
                target VARCHAR(50) NOT NULL,
                targetId VARCHAR(255),
                userId VARCHAR(255),
                username VARCHAR(255),
                details TEXT,
                ip VARCHAR(100),
                createdAt VARCHAR(50) NOT NULL
            )`,
            `CREATE INDEX idx_users_groupId ON users(groupId)`,
            `CREATE INDEX idx_questions_groupId ON questions(groupId)`,
            `CREATE INDEX idx_papers_groupId ON papers(groupId)`,
            `CREATE INDEX idx_records_paperId ON records(paperId)`,
            `CREATE INDEX idx_records_userId ON records(userId)`
        ];

        for (const sql of tables) {
            try {
                await this.pool.execute(sql);
            } catch (e) {
                // Ignore error if index already exists
                if (!e.message.includes('already exists') && !e.message.includes('Duplicate key name')) {
                    console.error('Error creating table/index:', e.message);
                }
            }
        }

        // 确保有管理员账号
        const [rows] = await this.pool.execute("SELECT * FROM users WHERE username = 'admin'");
        if (rows.length === 0) {
            const hashedPwd = await hashPassword('admin123');
            await this.pool.execute(
                "INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
                ['admin-001', 'admin', hashedPwd, 'super_admin']
            );
        }

        // 确保有演示学生账号
        const [studentRows] = await this.pool.execute("SELECT * FROM users WHERE username = 'student'");
        if (studentRows.length === 0) {
            const hashedPwd = await hashPassword('123456');
            await this.pool.execute(
                "INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)",
                ['student-001', 'student', hashedPwd, 'student']
            );
        }
    },

    async query(sql, params = []) {
        try {
            const [rows] = await this.pool.execute(sql, params);
            return rows;
        } catch (e) {
            console.error('MySQL query error:', e.message);
            return [];
        }
    },

    async run(sql, params = []) {
        try {
            await this.pool.execute(sql, params);
        } catch (e) {
            console.error('MySQL run error:', e.message);
        }
    },

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    },

    save() { /* MySQL 自动持久化 */ },
    exportDb() { return null; },
    async importDb() { return false; }
};

// ==================== PostgreSQL 实现 ====================

const postgresAdapter = {
    pool: null,

    async init() {
        const config = dbConfig.getDbConfig('postgres');
        if (!config) throw new Error('PostgreSQL 配置不存在');

        this.pool = new Pool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            max: config.max || 10
        });

        await this.createTables();
        console.log('PostgreSQL 数据库初始化完成');
        return this.pool;
    },

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'student',
                groupId VARCHAR(255)
            )`,
            `CREATE TABLE IF NOT EXISTS groups (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS questions (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(50) NOT NULL,
                content TEXT NOT NULL,
                options TEXT,
                answer TEXT NOT NULL,
                category VARCHAR(255),
                "deviceType" VARCHAR(255),
                "groupId" VARCHAR(255),
                "updatedAt" VARCHAR(50)
            )`,
            `CREATE TABLE IF NOT EXISTS papers (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                questions TEXT,
                rules TEXT,
                published INTEGER DEFAULT 0,
                "createDate" VARCHAR(50),
                "targetGroups" TEXT,
                "targetUsers" TEXT,
                deadline VARCHAR(50),
                "groupId" VARCHAR(255),
                "creatorId" VARCHAR(255)
            )`,
            `CREATE TABLE IF NOT EXISTS records (
                id VARCHAR(255) PRIMARY KEY,
                "paperId" VARCHAR(255) NOT NULL,
                "userId" VARCHAR(255) NOT NULL,
                score INT,
                "totalTime" INT,
                answers TEXT,
                "submitDate" VARCHAR(50)
            )`,
            `CREATE TABLE IF NOT EXISTS push_logs (
                id VARCHAR(255) PRIMARY KEY,
                "paperId" VARCHAR(255) NOT NULL,
                "targetGroups" TEXT,
                "targetUsers" TEXT,
                deadline VARCHAR(50),
                "pushDate" VARCHAR(50)
            )`,
            `CREATE TABLE IF NOT EXISTS categories (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(50) NOT NULL,
                "parentId" VARCHAR(255)
            )`,
            `CREATE TABLE IF NOT EXISTS system_logs (
                id VARCHAR(255) PRIMARY KEY,
                action VARCHAR(50) NOT NULL,
                target VARCHAR(50) NOT NULL,
                "targetId" VARCHAR(255),
                "userId" VARCHAR(255),
                username VARCHAR(255),
                details TEXT,
                ip VARCHAR(100),
                "createdAt" VARCHAR(50) NOT NULL
            )`,
            `CREATE INDEX IF NOT EXISTS idx_users_groupId ON users("groupId")`,
            `CREATE INDEX IF NOT EXISTS idx_questions_groupId ON questions("groupId")`,
            `CREATE INDEX IF NOT EXISTS idx_papers_groupId ON papers("groupId")`,
            `CREATE INDEX IF NOT EXISTS idx_records_paperId ON records("paperId")`,
            `CREATE INDEX IF NOT EXISTS idx_records_userId ON records("userId")`
        ];

        for (const sql of tables) {
            await this.pool.query(sql);
        }

        // 确保有管理员账号
        const result = await this.pool.query("SELECT * FROM users WHERE username = 'admin'");
        if (result.rows.length === 0) {
            const hashedPwd = await hashPassword('admin123');
            await this.pool.query(
                "INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4)",
                ['admin-001', 'admin', hashedPwd, 'super_admin']
            );
        }

        // 确保有演示学生账号
        const studentResult = await this.pool.query("SELECT * FROM users WHERE username = 'student'");
        if (studentResult.rows.length === 0) {
            const hashedPwd = await hashPassword('123456');
            await this.pool.query(
                "INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4)",
                ['student-001', 'student', hashedPwd, 'student']
            );
        }
    },

    async query(sql, params = []) {
        try {
            // 将 ? 占位符转换为 $1, $2 格式
            let pgSql = sql;
            let idx = 0;
            pgSql = pgSql.replace(/\?/g, () => `$${++idx}`);

            const result = await this.pool.query(pgSql, params);
            return result.rows;
        } catch (e) {
            console.error('PostgreSQL query error:', e.message);
            return [];
        }
    },

    async run(sql, params = []) {
        try {
            let pgSql = sql;
            let idx = 0;
            pgSql = pgSql.replace(/\?/g, () => `$${++idx}`);

            await this.pool.query(pgSql, params);
        } catch (e) {
            console.error('PostgreSQL run error:', e.message);
        }
    },

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    },

    save() { /* PostgreSQL 自动持久化 */ },
    exportDb() { return null; },
    async importDb() { return false; }
};

// ==================== 统一接口 ====================

function getAdapter(dbType) {
    switch (dbType) {
        case 'mysql': return mysqlAdapter;
        case 'postgres': return postgresAdapter;
        default: return sqliteAdapter;
    }
}

async function initDatabase() {
    const dbType = dbConfig.getActiveDb();
    currentDbType = dbType;
    currentDb = getAdapter(dbType);
    await currentDb.init();
    return currentDb;
}

async function switchDatabase(newDbType) {
    // 关闭当前连接
    if (currentDb) {
        await currentDb.close();
    }

    // 更新配置
    dbConfig.setActiveDb(newDbType);

    // 初始化新数据库
    currentDbType = newDbType;
    currentDb = getAdapter(newDbType);
    await currentDb.init();

    return true;
}

async function testConnection(dbType, config) {
    try {
        if (dbType === 'mysql') {
            const conn = await mysql.createConnection({
                host: config.host,
                port: config.port,
                user: config.user,
                password: config.password,
                database: config.database
            });
            await conn.ping();
            await conn.end();
            return { success: true };
        } else if (dbType === 'postgres') {
            const pool = new Pool({
                host: config.host,
                port: config.port,
                user: config.user,
                password: config.password,
                database: config.database,
                max: 1
            });
            await pool.query('SELECT 1');
            await pool.end();
            return { success: true };
        } else {
            return { success: true };
        }
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ==================== 业务方法（统一封装） ====================

function saveDatabase() {
    if (currentDb && currentDb.save) {
        currentDb.save();
    }
}

async function query(sql, params = []) {
    if (!currentDb) throw new Error('数据库未初始化');
    return await currentDb.query(sql, params);
}

async function run(sql, params = []) {
    if (!currentDb) throw new Error('数据库未初始化');
    await currentDb.run(sql, params);
}

// 导出模块
module.exports = {
    initDatabase,
    switchDatabase,
    testConnection,
    saveDatabase,
    getActiveDbType: () => currentDbType,

    // SQLite 导入导出
    exportSqliteDb: () => currentDbType === 'sqlite' ? sqliteAdapter.exportDb() : null,
    importSqliteDb: async (buffer) => {
        if (currentDbType !== 'sqlite') return false;
        return await sqliteAdapter.importDb(buffer);
    },

    // ==================== 用户相关 ====================
    getUsers: async (filter = {}) => {
        let sql = "SELECT * FROM users";
        const params = [];
        const conditions = [];

        if (filter.groupId !== undefined) {
            conditions.push("groupId = ?");
            params.push(filter.groupId);
        }

        if (conditions.length > 0) {
            sql += " WHERE " + conditions.join(" AND ");
        }

        return sanitizeUsers(await query(sql, params));
    },
    getUserById: async (id) => {
        const rows = await query("SELECT * FROM users WHERE id = ?", [id]);
        return sanitizeUser(rows[0]);
    },
    getUserByUsername: async (username) => {
        const rows = await query("SELECT * FROM users WHERE username = ?", [username]);
        return rows[0];
    },
    addUser: async (user) => {
        const id = user.id || generateId('u_');
        const hashedPwd = await hashPassword(user.password);
        await run("INSERT INTO users (id, username, password, role, groupId) VALUES (?, ?, ?, ?, ?)",
            [id, user.username, hashedPwd, user.role || 'student', user.groupId || null]);
        return { id, ...user, password: undefined };
    },
    deleteUser: async (id) => {
        await run("DELETE FROM users WHERE id = ?", [id]);
    },
    updateUser: async (user) => {
        if (user.password) {
            const hashedPwd = await hashPassword(user.password);
            await run("UPDATE users SET username=?, password=?, role=?, groupId=? WHERE id=?",
                [user.username, hashedPwd, user.role, user.groupId, user.id]);
        } else {
            await run("UPDATE users SET username=?, role=?, groupId=? WHERE id=?",
                [user.username, user.role, user.groupId, user.id]);
        }
        return sanitizeUser(user);
    },
    login: async (username, password) => {
        const rows = await query("SELECT * FROM users WHERE username = ?", [username]);
        if (rows.length === 0) return null;
        const user = rows[0];
        if (await verifyPassword(password, user.password)) {
            return sanitizeUser(user);
        }
        return null;
    },

    // ==================== 分组相关 ====================
    getGroups: async () => await query("SELECT * FROM groups"),
    addGroup: async (group) => {
        const id = group.id || generateId('g_');
        await run("INSERT INTO groups (id, name) VALUES (?, ?)", [id, group.name]);
        return { id, ...group };
    },
    deleteGroup: async (id) => {
        await run("DELETE FROM groups WHERE id = ?", [id]);
    },

    // ==================== 题目相关 ====================
    getQuestions: async (filter = {}) => {
        let sql = "SELECT * FROM questions";
        const params = [];
        const conditions = [];

        if (filter.groupId !== undefined) {
            if (filter.includePublic) {
                conditions.push("(groupId = ? OR groupId IS NULL)");
            } else {
                conditions.push("groupId = ?");
            }
            params.push(filter.groupId);
        } else if (filter.onlyPublic) {
            conditions.push("groupId IS NULL");
        }

        if (conditions.length > 0) {
            sql += " WHERE " + conditions.join(" AND ");
        }

        const rows = await query(sql, params);
        return rows.map(q => ({
            ...q,
            options: q.options ? JSON.parse(q.options) : [],
            answer: q.answer ? JSON.parse(q.answer) : ''
        }));
    },
    addQuestion: async (q) => {
        const id = q.id || generateId('q_');
        const now = new Date().toISOString();
        await run("INSERT INTO questions (id, type, content, options, answer, category, deviceType, groupId, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [id, q.type, q.content, JSON.stringify(q.options || []), JSON.stringify(q.answer), q.category || null, q.deviceType || null, q.groupId || null, now]);
        return { id, ...q, updatedAt: now };
    },
    updateQuestion: async (q) => {
        const now = new Date().toISOString();
        await run("UPDATE questions SET type=?, content=?, options=?, answer=?, category=?, deviceType=?, groupId=?, updatedAt=? WHERE id=?",
            [q.type, q.content, JSON.stringify(q.options || []), JSON.stringify(q.answer), q.category || null, q.deviceType || null, q.groupId || null, now, q.id]);
        return { ...q, updatedAt: now };
    },
    deleteQuestion: async (id) => {
        await run("DELETE FROM questions WHERE id = ?", [id]);
    },
    deleteAllQuestions: async () => {
        await run("DELETE FROM questions");
    },

    // ==================== 试卷相关 ====================
    getPapers: async (filter = {}) => {
        let sql = "SELECT * FROM papers";
        const params = [];
        const conditions = [];

        if (filter.groupId !== undefined) {
            conditions.push("groupId = ?");
            params.push(filter.groupId);
        }

        if (conditions.length > 0) {
            sql += " WHERE " + conditions.join(" AND ");
        }

        const rows = await query(sql, params);
        return rows.map(p => ({
            ...p,
            questions: p.questions ? JSON.parse(p.questions) : {},
            rules: p.rules ? JSON.parse(p.rules) : [],
            targetGroups: p.targetGroups ? JSON.parse(p.targetGroups) : [],
            targetUsers: p.targetUsers ? JSON.parse(p.targetUsers) : []
        }));
    },
    getPaperById: async (id) => {
        const rows = await query("SELECT * FROM papers WHERE id = ?", [id]);
        if (rows.length === 0) return null;
        const p = rows[0];
        return {
            ...p,
            questions: p.questions ? JSON.parse(p.questions) : {},
            rules: p.rules ? JSON.parse(p.rules) : [],
            targetGroups: p.targetGroups ? JSON.parse(p.targetGroups) : [],
            targetUsers: p.targetUsers ? JSON.parse(p.targetUsers) : []
        };
    },
    addPaper: async (paper) => {
        const id = paper.id || generateId('p_');
        await run("INSERT INTO papers (id, name, questions, rules, createDate, targetGroups, targetUsers, deadline, groupId, creatorId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [id, paper.name, JSON.stringify(paper.questions || {}), JSON.stringify(paper.rules || []),
                paper.createDate || new Date().toISOString().split('T')[0],
                JSON.stringify(paper.targetGroups || []), JSON.stringify(paper.targetUsers || []),
                paper.deadline || null, paper.groupId || null, paper.creatorId || null]);
        return { id, ...paper };
    },
    updatePaper: async (paper) => {
        await run("UPDATE papers SET name=?, questions=?, rules=?, targetGroups=?, targetUsers=?, deadline=?, groupId=?, creatorId=? WHERE id=?",
            [paper.name, JSON.stringify(paper.questions || {}), JSON.stringify(paper.rules || []),
            JSON.stringify(paper.targetGroups || []), JSON.stringify(paper.targetUsers || []),
            paper.deadline || null, paper.groupId || null, paper.creatorId || null, paper.id]);
        return paper;
    },
    deletePaper: async (id) => {
        await run("DELETE FROM papers WHERE id = ?", [id]);
    },
    deleteRecordsByPaper: async (paperId) => {
        await run("DELETE FROM records WHERE paperId = ?", [paperId]);
    },

    // ==================== 记录相关 ====================
    getRecords: async () => {
        const rows = await query("SELECT * FROM records");
        return rows.map(r => ({
            ...r,
            answers: r.answers ? JSON.parse(r.answers) : {}
        }));
    },
    getRecordsByPaper: async (paperId) => {
        const rows = await query("SELECT * FROM records WHERE paperId = ?", [paperId]);
        return rows.map(r => ({
            ...r,
            answers: r.answers ? JSON.parse(r.answers) : {}
        }));
    },
    addRecord: async (record) => {
        const id = record.id || generateId('r_');
        await run("INSERT INTO records (id, paperId, userId, score, totalTime, answers, submitDate) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [id, record.paperId, record.userId, record.score, record.totalTime,
                JSON.stringify(record.answers || {}), new Date().toISOString()]);
        return { id, ...record };
    },
    hasUserTakenExam: async (userId, paperId) => {
        const rows = await query("SELECT id FROM records WHERE userId = ? AND paperId = ?", [userId, paperId]);
        return rows.length > 0;
    },

    // ==================== 推送记录相关 ====================
    addPushLog: async (log) => {
        const id = log.id || generateId('pl_');
        await run("INSERT INTO push_logs (id, paperId, targetGroups, targetUsers, deadline, pushDate) VALUES (?, ?, ?, ?, ?, ?)",
            [id, log.paperId, JSON.stringify(log.targetGroups || []), JSON.stringify(log.targetUsers || []),
                log.deadline || null, new Date().toISOString()]);
        return { id, ...log };
    },
    getPushLogsByPaper: async (paperId) => {
        const rows = await query("SELECT * FROM push_logs WHERE paperId = ?", [paperId]);
        return rows.map(l => ({
            ...l,
            targetGroups: l.targetGroups ? JSON.parse(l.targetGroups) : [],
            targetUsers: l.targetUsers ? JSON.parse(l.targetUsers) : []
        }));
    },

    // ==================== 专业分类相关 ====================
    getCategories: async () => await query("SELECT * FROM categories"),
    getMajors: async () => await query("SELECT * FROM categories WHERE type = 'major'"),
    getDeviceTypes: async (majorId) => await query("SELECT * FROM categories WHERE type = 'device' AND parentId = ?", [majorId]),
    addCategory: async (cat) => {
        const id = cat.id || generateId('cat_');
        await run("INSERT INTO categories (id, name, type, parentId) VALUES (?, ?, ?, ?)",
            [id, cat.name, cat.type, cat.parentId || null]);
        return { id, ...cat };
    },
    updateCategory: async (cat) => {
        await run("UPDATE categories SET name=?, type=?, parentId=? WHERE id=?",
            [cat.name, cat.type, cat.parentId || null, cat.id]);
        return cat;
    },
    deleteCategory: async (id) => {
        await run("DELETE FROM categories WHERE id = ? OR parentId = ?", [id, id]);
    },

    // ==================== 系统日志相关 ====================
    addSystemLog: async (log) => {
        const id = log.id || generateId('log_');
        const createdAt = new Date().toISOString();
        await run(
            "INSERT INTO system_logs (id, action, target, targetId, userId, username, details, ip, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [id, log.action, log.target, log.targetId || null, log.userId || null, log.username || null,
                JSON.stringify(log.details || {}), log.ip || null, createdAt]
        );
        return { id, ...log, createdAt };
    },

    getSystemLogs: async (filter = {}) => {
        let sql = "SELECT * FROM system_logs";
        const params = [];
        const conditions = [];

        // 操作类型筛选
        if (filter.action) {
            conditions.push("action = ?");
            params.push(filter.action);
        }

        // 操作对象筛选
        if (filter.target) {
            conditions.push("target = ?");
            params.push(filter.target);
        }

        // 用户筛选
        if (filter.userId) {
            conditions.push("userId = ?");
            params.push(filter.userId);
        }

        // 时间范围筛选
        if (filter.startDate) {
            conditions.push("createdAt >= ?");
            params.push(filter.startDate);
        }
        if (filter.endDate) {
            conditions.push("createdAt <= ?");
            params.push(filter.endDate);
        }

        if (conditions.length > 0) {
            sql += " WHERE " + conditions.join(" AND ");
        }

        // 按时间倒序
        sql += " ORDER BY createdAt DESC";

        // 分页
        if (filter.limit) {
            sql += " LIMIT ?";
            params.push(filter.limit);
            if (filter.offset) {
                sql += " OFFSET ?";
                params.push(filter.offset);
            }
        }

        const rows = await query(sql, params);
        return rows.map(log => ({
            ...log,
            details: log.details ? JSON.parse(log.details) : {}
        }));
    },

    getSystemLogsCount: async (filter = {}) => {
        let sql = "SELECT COUNT(*) as count FROM system_logs";
        const params = [];
        const conditions = [];

        if (filter.action) {
            conditions.push("action = ?");
            params.push(filter.action);
        }
        if (filter.target) {
            conditions.push("target = ?");
            params.push(filter.target);
        }
        if (filter.userId) {
            conditions.push("userId = ?");
            params.push(filter.userId);
        }
        if (filter.startDate) {
            conditions.push("createdAt >= ?");
            params.push(filter.startDate);
        }
        if (filter.endDate) {
            conditions.push("createdAt <= ?");
            params.push(filter.endDate);
        }

        if (conditions.length > 0) {
            sql += " WHERE " + conditions.join(" AND ");
        }

        const rows = await query(sql, params);
        return rows[0]?.count || 0;
    },

    clearSystemLogs: async (beforeDate) => {
        if (beforeDate) {
            await run("DELETE FROM system_logs WHERE createdAt < ?", [beforeDate]);
        } else {
            await run("DELETE FROM system_logs");
        }
    }
};
