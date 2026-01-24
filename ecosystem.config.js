const path = require('path');
const fs = require('fs');
require('dotenv').config();

const useRedis = process.env.USE_REDIS === 'true';
const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
const shouldCluster = useRedis && dbType !== 'sqlite';
const instances = shouldCluster ? 'max' : 1;
const execMode = instances === 1 ? 'fork' : 'cluster';
const logsDir = path.join(__dirname, 'logs');
try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch (_) {}

module.exports = {
    apps: [{
        name: 'exam-system',
        cwd: path.resolve(__dirname),
        script: 'src/server.js',
        instances,
        exec_mode: execMode,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'development',
            PORT: process.env.PORT || 3000
        },
        env_production: {
            NODE_ENV: 'production',
            PORT: process.env.PORT || 3000
        },
        error_file: path.join(logsDir, 'err.log'),
        out_file: path.join(logsDir, 'out.log'),
        merge_logs: true,
        time: true
    }]
};
