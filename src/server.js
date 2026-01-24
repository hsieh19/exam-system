const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const { version: APP_VERSION } = require('../package.json');

const db = require('./db/db-adapter');
const { createSessionStore } = require('./utils/session-store');
const initRoutes = require('./routes/index');
const { getClientIp } = require('./utils/common');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 默认监听所有网络接口

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

const isPkg = typeof process.pkg !== 'undefined';
const baseDir = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
const TEMP_UPLOADS = path.join(baseDir, 'temp_uploads');
// 启动时确保存储目录存在
try {
    if (!fs.existsSync(TEMP_UPLOADS)) {
        fs.mkdirSync(TEMP_UPLOADS, { recursive: true });
    }
} catch (e) {
    console.error('无法创建临时上传目录:', e);
}
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
const upload = multer({
    dest: TEMP_UPLOADS,
    limits: {
        files: 1,
        fileSize: Number.isFinite(MAX_UPLOAD_BYTES) && MAX_UPLOAD_BYTES > 0 ? MAX_UPLOAD_BYTES : 25 * 1024 * 1024
    }
});

const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const corsOptions = {
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (corsOrigins.length === 0) return cb(null, false);
        return cb(null, corsOrigins.includes(origin));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// limit 调整为 1mb 以防止 DoS 攻击
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const ua = String(req.headers['user-agent'] || '');
    const isFeishuUa = /Lark|Feishu|LarkWebView|FeishuWebView/i.test(ua);
    const isLoginPage = req.path === '/' || req.path === '/index.html';
    const scriptSrcParts = [
        "'self'",
        "'unsafe-inline'",
        "https://lf1-cdn-tos.bytegoofy.com",
        "https://lf-scm-cn.feishucdn.com",
        "https://cdnjs.cloudflare.com"
    ];
    if (isLoginPage && isFeishuUa) scriptSrcParts.splice(2, 0, "'unsafe-eval'");
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "img-src 'self' data: https:",
            "style-src 'self' https: 'unsafe-inline'",
            `script-src ${scriptSrcParts.join(' ')}`,
            "connect-src 'self' https://open.feishu.cn https://open.larksuite.com https://*.feishu.cn https://*.larksuite.com https://lf1-cdn-tos.bytegoofy.com https://lf-scm-cn.feishucdn.com",
            "font-src 'self' https: data:"
        ].join('; ')
    );
    next();
});

// 获取系统版本号
app.get('/api/version', (req, res) => {
    res.json({ version: APP_VERSION });
});

app.use(express.static(path.join(__dirname, '../public')));

// 启动服务器
async function startServer() {
    // 检查 .env 状态
    if (!fs.existsSync(path.join(__dirname, '../.env'))) {
        console.warn('\x1b[33m%s\x1b[0m', '警告: 未检测到 .env 配置文件，系统将以默认(SQLite)模式运行');
    }

    // 初始化数据库
    await db.initDatabase();
    console.log('数据库初始化完成');

    // 初始化 Session Store
    const sessionStore = await createSessionStore();
    const sseClients = new Set();
    const broadcast = (event, payload) => {
        const data = JSON.stringify({ event, payload, ts: Date.now() });
        sseClients.forEach(res => {
            try {
                res.write(`event: ${event}\n`);
                res.write(`data: ${data}\n\n`);
            } catch (e) {
                console.error(`SSE Broadcast error (Client IP: ${getClientIp(res.req)}):`, e.message);
                sseClients.delete(res);
            }
        });
    };

    // 初始化路由
    initRoutes(app, { sessionStore, sseClients, broadcast, upload });

    // ==================== 全局错误处理 ====================
    app.use((err, req, res, next) => {
        console.error('Unhandled Error:', err);
        const status = err.status || 500;
        const message = status === 500 ? '服务器内部错误' : err.message;
        res.status(status).json({
            error: message,
            timestamp: new Date().toISOString()
        });
    });

    app.listen(PORT, HOST, () => {
        console.log(`考试系统服务器已启动: http://${HOST === '0.0.0.0' ? '服务器IP' : HOST}:${PORT}`);
        if (HOST === '0.0.0.0') {
            console.log('提示: 服务已绑定到所有网络接口，可从外部访问');
        }
    });
}

startServer().catch(err => {
    console.error('系统启动失败:', err);
});
