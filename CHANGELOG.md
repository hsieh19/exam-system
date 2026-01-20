# Changelog

## [1.0.9] - 2026-01-20

### 🔥 High Concurrency Optimization (高并发优化)
- **Session Architecture**:
  - Implemented `SessionStore` interface supporting both Memory and Redis.
  - Added support for Redis-based distributed sessions via `USE_REDIS` env.
  - Refactored authentication middleware to support async session retrieval.
- **Database Performance**:
  - Configurable connection pool limits via `DB_CONNECTION_LIMIT` (MySQL/PostgreSQL).
  - Optimized database adapter initialization.
- **File Upload Stability**:
  - Switched from Memory Storage to Disk Storage for file uploads to prevent OOM.
  - Implemented automatic cleanup of temporary upload files.
- **Process Management**:
  - Added `ecosystem.config.js` for PM2 cluster mode support (`instances: 'max'`).

### 🛠️ System Tools (系统工具)
- **Auto-Provisioning**:
  - Added `install_redis` function to `run.sh` (Menu Option 11).
  - Supports one-click Redis installation and configuration on Linux (Ubuntu/Debian/CentOS).
  - Includes OS detection, connection health checks (`redis-cli ping`), and safe config updates.

### ⚡ Improvements (改进)
- **Admin UI**:
  - Added request locking (`isNavigating`) in navigation to prevent duplicate API calls.
  - Optimized tab switching performance.
- **Configuration**:
  - Updated `.env.example` with new high-performance configuration options.

### 📖 Documentation
- Added `docs/implementation_plan_1000_users.md` detailing the scaling strategy.
