const path = require('path');
require('dotenv').config();

const useRedis = process.env.USE_REDIS === 'true';

module.exports = {
    apps: [{
        name: 'exam-system',
        script: 'src/server.js',
        instances: useRedis ? 'max' : 1,
        exec_mode: 'cluster',
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
        // Log files
        error_file: 'logs/err.log',
        out_file: 'logs/out.log',
        merge_logs: true,
        time: true
    }]
};
