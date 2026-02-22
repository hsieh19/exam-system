# 南区运维考试系统 (Enterprise Examination System)

一个安全、高效、可扩展的企业级在线考试系统。基于 HTML5/CSS3/JS + Node.js (Express) 构建，支持多数据库适配与三方平台集成。

## ✨ 核心特性

### 🔐 飞书集成与体验
- **免登与免确认**：飞书环境内支持静默登录（免登），大幅提升用户进入系统的便捷性。
- **状态感知**：登录页实时展示飞书集成状态，增强交互透明度。
- **JSSDK 优化**：采用动态按需加载策略，彻底解决非飞书环境下的兼容性报错。

### 🛡️ 深度安全加固
- **XSS 漏洞封堵**：全系统采用安全交互模式（data 属性 + 事件委托），彻底消除 DOM-based XSS 风险。
- **单点登录 (SSO)**：支持单账号单设备登录限制。新设备登录将自动“踢掉”旧设备。
- **实时下线通知**：基于 **SSE (Server-Sent Events)** 技术，当账号在别处登录时，原设备将立即收到通知并强制退出。
- **会话主动防御**：支持服务端 Token 吊销，实现真正的会话生命周期管理。
- **内容加固**：强制执行 HTML 实体转义，并配置严格的 **CSP (Content Security Policy)** 策略。

### 考生功能
- **在线答题**：适配单选、多选、判断三种标准题型。
- **智能计时**：支持考试总时长限制，支持累计用时统计。
- **成绩与回顾**：考试结束后自动评分，支持多选题“漏选得部分分”机制。
- **排行榜**：实时查看个人排名与交卷耗时。

### 🛠️ 管理员功能
- **题库管理**：支持专业分类、批量题目导入导出（Excel）。
- **用户与分组**：精细化的用户权限管理与部门分组隔离。
- **系统安全与审计**：
  - **实时日志**：完整记录登录、操作、数据库切换等关键行为。
  - **操作回溯**：支持多维度日志筛选与审计。
- **试卷编排**：支持规则组卷、手动选题、自动生成等多种组卷策略。
- **考试发布**：定向推送至指定分组，支持重复推送与成绩保留策略。
- **多数据库热切换**：支持 SQLite、MySQL、PostgreSQL 之间的一键切换和热迁移。

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

###  方式二：Linux 一键脚本部署（推荐用于生产）

使用 `run.sh` 脚本可以全面管理项目生命周期。脚本现在已支持 **PM2** 自动检测与集成。

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
    
    在出现的菜单中选择 **`1. 启动服务`**。
    - **自动 PM2 集成**：脚本会自动检测系统是否安装了 PM2。如果已安装，将优先调用 `pm2 start ecosystem.config.js` 以**集群模式**启动，并自动执行 `pm2 save` 保持自启。
    - **传统模式回退**：若未检测到 PM2，脚本将回退到使用 `nohup` 的传统后台进程模式运行。

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
- **自动配置 (Linux)**：运行 `./run.sh` 并选择 **`11. 一键配置 Redis & PM2`**，脚本将自动完成环境安装与 `.env` 修改。

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

- **前端**：Vanilla JavaScript (ES6+), CSS3 (Flexbox), HTML5, **SSE (Server-Sent Events)**
- **后端**：Node.js + Express
- **身份验证**：基于 Token 的无状态验证，支持 Redis 集中式会话管理。
- **数据库自适应层**：
  - **SQLite**：小型部署，零配置运行。
  - **MySQL / PostgreSQL**：适用于中大型企业级生产部署。

## 📂 目录结构

```text
├── .github/            # GitHub Actions 自动化流程
├── public/             # 前端静态资源
│   ├── index.html      # 登录页
│   ├── admin.html      # 管理端主页
│   ├── student.html    # 考生主页
│   ├── exam.html       # 考试练习页
│   ├── css/            # 样式文件 (style.css)
│   └── js/             # 前端业务逻辑 (utils, admin, student, auth 等)
├── src/                # 后端控制逻辑
│   ├── server.js       # Express 服务启动入口 (包含安全中间件与 CSP)
│   ├── routes/         # 路由定义 (API 接口)
│   ├── db/             # 数据库适配层 (db-adapter.js)
│   ├── config/         # 后端配置 (数据库连接、环境配置)
│   └── utils/          # 工具类 (Feishu SDK 集成, Session, Logger 等)
├── .env.example        # 环境变量模板
├── CHANGELOG.md        # 更新日志
├── README.md           # 项目说明文档
├── ecosystem.config.js # PM2 集群配置文件
├── package.json        # 项目依赖与版本配置
└── run.sh              # 综合管理脚本 (部署、启动、更新、Redis/PM2安装等)
```

## 🔒 考试评分规则

1.  **单选题**：选中正确选项得全分，否则0分。
2.  **判断题**：判断正确得全分，否则0分。
3.  **多选题**：
    *   全对：得该题设定满分。
    *   漏选：得设定部分分。
    *   错选/多选：0分。

## 📱 移动端适配
本项目针对移动端（尤其是飞书内置浏览器）进行了深度优化：
- **原生 App 交互**: 底部固定导航栏，关键操作按钮（如“继续考试”）采用高对比度渐变设计。
- **布局重构**: 针对小屏幕优化了答题页 Header，题号进度与计时信息并行显示，节省垂直空间。
- **响应式栅格**: 题库与试卷列表在移动端自动切换为卡片流式布局。
- **极速访问**: 轻量化资源加载，确保在移动网络下依然流畅。

## 📱 兼容性
适配现代浏览器（Chrome/Edge/Firefox/Safari）及主流移动端系统。
