# 1000人并发支持实施方案 (High Concurrency Optimization Plan)

## 目标
确保考试系统能够稳定支持 1000 人同时在线考试，重点解决高并发下的数据库锁定、单点性能瓶颈和会话丢失问题。

## 核心改造点

### 1. 数据库升级 (Database Upgrade)
- **从 SQLite 迁移至 MySQL/PostgreSQL**
  - **现状**: 使用 SQLite (文件锁)，并发写入时易锁库。
  - **方案**: 切换至 MySQL 8.0+ 或 PostgreSQL 14+。
  - **配置**: 调整连接池 (Connection Pool) 大小，从默认 10 提升至 100+。

### 2. 会话管理优化 (Session Management)
- **引入 Redis 存储 Session**
  - **现状**: 使用内存 `Map` 存储，不支持多进程，重启丢失。
  - **方案**: 使用 Redis 集中存储 Session (`connect-redis` 或手写 Redis Adapter)。
  - **收益**: 支持多进程水平扩展 (Cluster Mode)，提升容灾能力。

### 3. 应用服务扩展 (Application Scaling)
- **引入 PM2 进程管理**
  - **现状**: `node server.js` 单线程运行，无法利用多核 CPU。
  - **方案**: 创建 `ecosystem.config.js`，使用 PM2 Cluster 模式启动 (`instances: 'max'`)。

### 4. 静态资源与文件上传优化
- **静态资源分离** (可选): 使用 Nginx 前置处理静态文件。
- **文件上传优化**: 避免 `multer.memoryStorage()` 在高并发上传时耗尽内存，改为流式上传或从本地磁盘中转。

## 实施步骤

1. [x] 创建功能分支 `feature/scale-1000-users`
2. [x] **依赖配置**:
    - 安装 `redis`, `mysql2` (或 `pg`) 等必要驱动。
    - 安装 `pm2` (作为开发依赖或全局工具说明)。
3. [x] **代码重构**:
    - 修改 `src/db/db-adapter.js`: 优化连接池配置。
    - 修改 `src/server.js`: 集成 Redis Session。
    - 创建 `ecosystem.config.js`.
4. [ ] **压力测试**:
    - 编写简单的压测脚本 (e.g. 使用 `autocannon` 或 `k6`) 验证并发能力。

## 环境变量示例 (.env)
```ini
DB_TYPE=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=admin
MYSQL_PASSWORD=secure_password
MYSQL_DATABASE=exam_system
MYSQL_CONNECTION_LIMIT=100

REDIS_HOST=localhost
REDIS_PORT=6379
```
