const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config();

const useRedis = process.env.USE_REDIS === 'true';
const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
const shouldCluster = useRedis && dbType !== 'sqlite';
const instances = shouldCluster ? 'max' : 1;
const execMode = instances === 1 ? 'fork' : 'cluster';

function ensureWritableDir(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            const st = fs.statSync(dirPath);
            if (!st.isDirectory()) return false;
        } else {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    } catch (_) {
        return false;
    }
}

const projectDir = path.resolve(__dirname);
const preferredLogsDir = path.join(projectDir, 'logs');
const legacyLogDir = path.join(projectDir, 'log');

let activeLogsDir = null;
if (ensureWritableDir(preferredLogsDir)) {
    activeLogsDir = preferredLogsDir;
} else if (ensureWritableDir(legacyLogDir)) {
    activeLogsDir = legacyLogDir;
} else {
    const fallbackLogsDir = path.join(os.homedir(), '.pm2', 'logs');
    if (ensureWritableDir(fallbackLogsDir)) activeLogsDir = fallbackLogsDir;
}

const appConfig = {
    name: 'exam-system',
    cwd: projectDir,
    script: 'src/server.js',
    instances,
    exec_mode: execMode,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
    },
    env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000
    },
    merge_logs: true,
    time: true
};

if (activeLogsDir) {
    appConfig.error_file = path.join(activeLogsDir, 'err.log');
    appConfig.out_file = path.join(activeLogsDir, 'out.log');
}

module.exports = {
    apps: [appConfig]
};
