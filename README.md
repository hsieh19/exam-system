# 企业考试系统 (Enterprise Examination System)

一个简洁、高效的企业内部在线考试系统。基于 HTML5/CSS3/JS + Node.js (Express) + SQLite (sql.js) 构建。

## ✨ 核心特性

###  考生功能
- **在线考试**：支持单选、多选、判断三种标准题型。
- **智能计时**：支持考试总时长倒计时限制。
- **成绩与回顾**：考试结束后自动评分，支持多选题漏选得部分分机制。
- **排行榜**：查看针对特定试卷的成绩排行榜。

### 🛠️ 管理员功能
- **题库管理**：
  - 专业分类管理。
  - 题目的增删改查。
- **用户与分组**：
  - 用户管理：增删改查用户，支持重置密码和修改分组。
  - 分组管理：创建和管理用户部门/分组。
- **系统安全与审计**：
  - **系统日志**：记录用户登录、数据库切换、题目和试卷操作等关键日志。
  - **操作回溯**：超级管理员可以按操作类型、操作对象、日期等维度筛选和检索日志。
- **试卷编排**：
  - **规则组卷**：设定不同题型数量、分值、漏选分和答题时限。
  - **手动选题**：支持从题库中手动挑选题目。
  - **自动生成**：根据规则随机从题库中抽取题目。
- **考试发布**：
  - 将试卷定向推送到指定的分组。
  - 设定考试截止时间。
- **多数据库切换**：支持 SQLite、MySQL、PostgreSQL 之间的一键切换和热迁移。

## 🚀 安装与部署

本项目支持 Windows 本地开发及 Linux 生产环境部署。

### � 方式一：下载预编译版本（极速部署）

如果你不想配置 Node.js 环境，可以直接从 [GitHub Releases](https://github.com/hsieh19/exam-system/releases) 下载对应平台的压缩包。

1.  **下载压缩包**：
    - Windows: `exam-system-windows-x64.zip`
    - Linux: `exam-system-linux-x64.tar.gz`
    - macOS: `exam-system-macos-x64.tar.gz`
2.  **解压文件**：
    - 解压后你会看到可执行文件（如 `exam-system.exe`）和 `.env.example`。
3.  **配置环境**：
    - 将 `.env.example` 重命名为 `.env`。
    - 根据需要修改数据库、端口等配置。
4.  **直接运行**：
    - Windows: 双击 `exam-system.exe`。
    - Linux/macOS: 执行 `./exam-system`。

### � 方式二：Linux 一键脚本部署（推荐用于生产）

使用 `run.sh` 脚本可以全面管理项目生命周期。

1.  **下载项目**：
    ```bash
    git clone https://github.com/hsieh19/exam-system.git
    cd exam-system
    ```

2.  **初始化与运行**：
    ```bash
    # 如果脚本无法运行或报错 /bin/bash^M: bad interpreter，请先执行：
    sed -i 's/\r$//' run.sh
    
    chmod +x run.sh   # 赋予脚本执行权限
    ./run.sh
    ```
    
    在出现的菜单中选择 **`1. 启动服务`**。脚本将自动检测环境、安装 Node.js（如果缺失）、安装 npm 依赖并启动服务。

3.  **系统更新**：
    运行 `./run.sh` 并选择 **`9. 系统更新`**。
    *   脚本会自动检测 GitHub 最新 Release。
    *   自动备份当前数据和配置。
    *   下载并应用更新包。
    *   保留原有数据库和配置文件。

4.  **其他管理功能**：
    *   `2. 停止服务`：优雅停止后台进程。
    *   `3. 重启服务`：应用配置更改后使用。
    *   `4. 查看状态`：检查服务运行健康度。
    *   `5. 查看日志`：实时追踪系统运行日志。
    *   `7. 初始化数据库`：首次部署时可选，重置数据库状态。

### 🛠️ 方式三：源码运行（本地开发）

1.  **环境要求**：Node.js v14.0+
2.  **安装依赖**：
    ```bash
    npm install
    # 推荐使用淘宝镜像: npm install --registry=https://registry.npmmirror.com
    ```
3.  **配置环境**：
    复制 `.env.example` 为 `.env`，根据需要配置数据库连接信息。
4.  **运行服务**：
    ```bash
    npm start
    ```
5.  **访问**：打开浏览器访问 `http://localhost:3000`

## ⚡ 高并发优化配置

在企业级大规模并发场景（如数百人同时在线考试）下，建议进行以下优化配置：

### 1. 切换高性能数据库
SQLite 在高并发写入（如同时提交试卷）时可能出现锁竞争。请在 `.env` 中切换为 MySQL 或 PostgreSQL：
```env
DB_TYPE=mysql
MYSQL_HOST=127.0.0.1
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=exam_system
DB_CONNECTION_LIMIT=50  # 增大连接池
```

### 2. 启用 Redis 会话与集群模式
当使用 `PM2` 启动多个实例（Cluster Mode）时，必须使用 Redis 共享 Session：
- **手动配置**：设置 `USE_REDIS=true` 并指定 `REDIS_URL`。
- **自动配置 (Linux)**：运行 `./run.sh` 并选择 **`11. 一键配置 Redis`**，脚本将自动完成环境安装与 `.env` 修改。

### 3. 环境变量参考
| 变量名 | 说明 | 推荐值 |
|------|----|----|
| `NODE_ENV` | 运行模式 | `production` |
| `USE_REDIS` | 是否启用 Redis 存储 Session | `true` |
| `DB_CONNECTION_LIMIT` | 数据库连接池上限 | `50+` |

---

## ⚙️ 账号说明

> ⚠️ **生产环境安全提示**：请在首次登录后立即修改默认管理员密码。

| 角色 | 默认用户名 | 默认密码 | 说明 |
|------|--------|----------|----------|
| **超级管理员** | `admin` | `admin123` | 系统首次启动时，若数据库为空，将从环境变量 `INITIAL_ADMIN_USERNAME` 和 `INITIAL_ADMIN_PASSWORD` 初始化此账号。 |
| **考生/其它管理员** | - | - | 需由超级管理员在后台手动创建，不再提供默认演示账号。 |

## 🏗️ 技术架构

- **前端**：Vanilla JavaScript (ES6+), CSS3 (Flexbox), HTML5
- **后端**：Node.js + Express
- **数据库自适应层**：
  - **SQLite**：小型部署，本地文件持久化 (`exam.db`)。
  - **MySQL**：适用于中型企业级部署。
  - **PostgreSQL**：适用于对数据一致性要求高的场景。

## 📂 目录结构

```text
├── CHANGELOG.md        # 更新日志
├── README.md           # 项目说明文档
├── ecosystem.config.js # PM2 集群配置文件
├── run.sh              # 综合管理脚本 (部署、启动、更新、Redis安装等)
├── .env.example        # 环境变量模板
├── .env                # 运行时环境变量 (数据库连接、Redis配置等)
├── package.json        # 项目依赖与版本配置
├── public/             # 前端静态资源
│   ├── index.html      # 登录页
│   ├── admin.html      # 管理管理员主页
│   ├── student.html    # 考生主页
│   ├── exam.html       # 考试练习页
│   ├── css/            # 样式文件
│   └── js/             # 前端业务逻辑 (Auth, Storage, API 等)
├── src/                # 后端控制逻辑
│   ├── server.js       # Express 服务启动入口
│   ├── routes/         # 路由定义 (API 接口)
│   ├── db/             # 数据库适配层 (支持 SQLite/MySQL/PG)
│   ├── config/         # 后端配置 (数据库连接、环境配置)
│   └── utils/          # 工具类 (Session, Logger, ID生成等)
├── db/                 # 默认 SQLite 数据库存储目录
├── temp_uploads/       # 临时文件上传目录 (高并发优化)
└── docs/               # 项目辅助文档
```

## 🔒 考试评分规则

1.  **单选题**：选中正确选项得全分，否则0分。
2.  **判断题**：判断正确得全分，否则0分。
3.  **多选题**：
    *   全对：得该题设定满分。
    *   漏选：得设定部分分。
    *   错选/多选：0分。

## 📱 移动端适配
本项目已针对移动端进行深度优化：
- **原生 App 体验**: 底部固定导航栏，操作触手可及。
- **响应式设计**: 自动适配各种屏幕尺寸（手机、平板、桌面）。
- **极速访问**: 轻量化资源加载，弱网环境下亦能流畅使用。

## 📱 兼容性
适配现代浏览器（Chrome/Edge/Firefox/Safari）及主流移动端系统。
