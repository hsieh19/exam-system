/**
 * 数据库配置模块 - 使用环境变量（安全最佳实践）
 * 
 * 敏感信息通过环境变量配置，不通过前端传递
 * 支持 .env 文件或系统环境变量
 */
require('dotenv').config();

// 获取当前活动数据库类型
function getActiveDb() {
    return process.env.DB_TYPE || 'sqlite';
}

// 设置活动数据库（修改环境变量需要重启服务）
// 注意：运行时修改只影响当前进程，持久化需修改 .env 文件
let runtimeDbType = null;

function setActiveDb(dbType) {
    runtimeDbType = dbType;
    return true;
}

function getCurrentDbType() {
    return runtimeDbType || getActiveDb();
}

// 获取 MySQL 配置（从环境变量）
function getMysqlConfig() {
    return {
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'exam_system',
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10
    };
}

// 获取 PostgreSQL 配置（从环境变量）
function getPostgresConfig() {
    return {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT) || 5432,
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || '',
        database: process.env.POSTGRES_DATABASE || 'exam_system',
        max: parseInt(process.env.DB_CONNECTION_LIMIT) || 10
    };
}

// 获取特定数据库的连接配置
function getDbConfig(dbType) {
    switch (dbType) {
        case 'mysql': return getMysqlConfig();
        case 'postgres': return getPostgresConfig();
        default: return { path: 'db/exam.db' };
    }
}

// 获取安全的配置信息（用于前端显示，隐藏密码）
function getDbConfigSafe(dbType) {
    const config = getDbConfig(dbType);
    if (!config) return null;

    const safe = { ...config };
    if (safe.password) {
        safe.password = safe.password ? '********' : '';
        safe.hasPassword = true;
    } else {
        safe.hasPassword = false;
    }
    return safe;
}

// 获取完整配置（安全版本，用于前端展示）
function getFullConfigSafe() {
    return {
        activeDb: getCurrentDbType(),
        sqlite: { path: 'db/exam.db' },
        mysql: getDbConfigSafe('mysql'),
        postgres: getDbConfigSafe('postgres'),
        // 提示：配置来源
        configSource: 'environment',
        note: '数据库连接配置通过环境变量设置，前端仅能切换已配置的数据库'
    };
}

// 检查特定数据库是否已配置
function isDbConfigured(dbType) {
    if (dbType === 'sqlite') return true;

    const config = getDbConfig(dbType);
    if (dbType === 'mysql') {
        return !!(config.host && config.user && config.database);
    }
    if (dbType === 'postgres') {
        return !!(config.host && config.user && config.database);
    }
    return false;
}

module.exports = {
    getActiveDb,
    setActiveDb,
    getCurrentDbType,
    getDbConfig,
    getDbConfigSafe,
    getFullConfigSafe,
    getMysqlConfig,
    getPostgresConfig,
    isDbConfigured
};
