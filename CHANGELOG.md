# 更新日志 (Changelog)

## [1.0.10] - 2026-01-20

### 🐛 问题修复
- **部署脚本**:
  - 修复了系统更新时 `run.sh` 未能同步更新 `.env.example` 文件的问题。
  - 现在执行更新操作将自动刷新 `.env.example`，方便用户参考最新的配置项（如 `USE_REDIS`, `DB_CONNECTION_LIMIT`）。

## [1.0.9] - 2026-01-20

### 🔥 高并发架构优化
- **会话架构 (Session)**:
  - 实现了通用的 `SessionStore` 接口，支持内存和 Redis 两种模式。
  - 引入 `USE_REDIS` 环境变量，支持基于 Redis 的分布式会话管理。
  - 重构了认证中间件，支持异步会话读取。
- **数据库性能**:
  - 支持通过 `DB_CONNECTION_LIMIT` 环境变量配置 MySQL/PostgreSQL 的连接池大小。
  - 优化了数据库适配器的初始化逻辑。
- **文件上传稳定性**:
  - 将文件上传方式从内存存储 (Memory Storage) 切换为磁盘暂存 (Disk Storage)，防止高并发下内存溢出 (OOM)。
  - 实现了临时上传文件的自动清理机制。
- **进程管理**:
  - 新增 `ecosystem.config.js` 配置文件，支持 PM2 集群模式 (`instances: 'max'`) 启动。

### 🛠️ 系统工具
- **自动配置**:
  - 在 `run.sh` 中新增了 `install_redis` 功能 (菜单选项 11)。
  - 支持在 Linux (Ubuntu/Debian/CentOS) 上一键安装并配置 Redis。
  - 包含自动检测操作系统、连接健康检查 (`redis-cli ping`) 和安全的配置更新。

### ⚡ 改进
- **管理后台 UI**:
  - 在导航切换时增加了请求锁 (`isNavigating`)，防止重复触发 API 请求。
  - 优化了标签页切换的性能。
- **配置**:
  - 更新了 `.env.example`，补充了高性能模式相关的配置项。

### 📖 文档
- 新增 `docs/implementation_plan_1000_users.md`，详细记录了高并发扩展策略。
