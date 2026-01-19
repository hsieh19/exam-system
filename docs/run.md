# Linux 服务器部署指南

本文档介绍如何将 `examination_system.tar.gz` 部署到 Linux 服务器并运行。

## 1. 准备工作

### 1.1 上传文件
将压缩包 `examination_system.tar.gz` 上传到服务器的指定目录（如 `/opt/exam`）。

```bash
# 1. 创建目录并进入
mkdir -p /opt/exam
cd /opt/exam

# 2. 上传文件到此目录
# ...上传操作...

# 3. 解压文件
tar -xzvf examination_system.tar.gz
```

### 1.2 修复格式 (重要)
由于脚本可能是在 Windows 下生成的，建议先修复换行符格式以及赋予执行权限。
```bash
sed -i 's/\r$//' run.sh
chmod +x run.sh
```

## 2. 运行与管理

我们提供了一个全能的交互式管理脚本 `run.sh`。

### 启动菜单
直接运行脚本即可进入管理菜单：

```bash
./run.sh
```

您将看到如下界面：

```text
===== 企业考试系统管理菜单 =====
 1. 启动服务 (Start)
 2. 停止服务 (Stop)
 3. 重启服务 (Restart)
 4. 查看状态 (Status)
 5. 查看日志 (Logs)
 6. 环境部署 (Install Env)
 7. 卸载清理 (Uninstall)
 8. 初始化数据库 (Init DB)
 0. 退出 (Exit)
================================
请输入选项数字 [0-8]: 
```

### 常见操作流程

1.  **首次运行**：输入 `1` (启动服务) 或 `6` (环境部署)。脚本会自动检测并安装 Node.js 和项目依赖。
2.  **日常维护**：使用 `4` 查看状态，使用 `5` 实时查看日志。
3.  **停止/重启**：使用 `2` 或 `3`。
4.  **重置数据库**：使用 `8` 初始化数据库（⚠️ 会清空所有数据，需二次确认）。

## 3. 初始化数据库

选项 `8` 提供数据库重置功能，适用于以下场景：
- 系统首次部署后需要清空演示数据
- 数据库损坏需要重建
- 需要完全重置系统

**安全机制**：
1. 第一次确认：输入 `y`
2. 第二次确认：输入 `INIT`
3. 操作前自动备份旧数据库到 `db/exam_backup_日期时间.db`

初始化后，系统会创建默认管理员账号：
- **用户名**: `admin`
- **密码**: `admin123`

## 4. 防火墙设置

如果需要从外部访问，请确保服务器防火墙开放了 **3000** 端口。

```bash
# 示例：CentOS / firewalld
sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent
sudo firewall-cmd --reload

# 示例：Ubuntu / ufw
sudo ufw allow 3000
```

## 5. 目录结构

```
/opt/exam/
├── run.sh              # 管理脚本
├── package.json        # 项目配置
├── .env.example        # 环境变量模板
├── src/                # 后端源码
├── public/             # 前端资源
├── db/                 # 数据库目录 (运行后自动生成 exam.db)
├── docs/               # 文档
├── node_modules/       # 依赖 (首次运行自动安装)
└── out.log             # 运行日志
```
