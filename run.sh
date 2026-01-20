#!/bin/bash

# =======================================================
# 企业考试系统 - 综合管理脚本 (run.sh)
# 功能: 环境部署、服务管理、卸载清理
# =======================================================

# 配置
APP_MAIN="src/server.js"
APP_PORT=3000
LOG_FILE="out.log"
PID_FILE="server.pid"
GITHUB_REPO="hsieh19/exam-system"

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m' # No Color

# -------------------------------------------------------
# 命令行参数解析 (支持非交互式调用)
# -------------------------------------------------------
if [ $# -gt 0 ]; then
    # 提前定义部分基础函数以供调用 (或直接跳转到逻辑段)
    case "$1" in
        start)
            # 这里需要跳转到 start_app，但函数定义在后面
            # 所以我们将参数处理放在文件末尾或封装逻辑
            ACTION="start"
            [[ "$2" == "--no-persist" ]] && PERSIST_FLAG="--no-persist"
            ;;
        stop)
            ACTION="stop"
            [[ "$2" == "--no-persist" ]] && PERSIST_FLAG="--no-persist"
            ;;
        restart) ACTION="restart" ;;
        status)  ACTION="status" ;;
        logs)    ACTION="logs" ;;
        *)       echo "用法: $0 {start|stop|restart|status|logs} [--no-persist]"; exit 1 ;;
    esac
fi

# -------------------------------------------------------
# 辅助函数
# -------------------------------------------------------

# 检查 crontab 是否可用
check_cron_exists() {
    if ! command_exists crontab; then
        return 1
    fi
    return 0
}

# 管理开机自启
# action: enable | disable
manage_autostart() {
    local action=$1
    if ! check_cron_exists; then
        return
    fi

    local script_path=$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null)
    if [ -z "$script_path" ]; then
        # 降级方案：如果无法获取绝对路径，使用当前目录
        script_path="$(pwd)/run.sh"
    fi
    local work_dir=$(dirname "$script_path")
    local cron_job="@reboot cd \"$work_dir\" && bash \"$script_path\" start --no-persist > /dev/null 2>&1"

    if [ "$action" == "enable" ]; then
        # 先清除旧的，再添加新的 (防止重复)
        (crontab -l 2>/dev/null | grep -E -v "run.sh.*start"; echo "$cron_job") | crontab -
    elif [ "$action" == "disable" ]; then
        (crontab -l 2>/dev/null | grep -E -v "run.sh.*start") | crontab -
    fi
}

# 检查当前是否已开启自启
is_autostart_enabled() {
    if ! check_cron_exists; then return 1; fi
    crontab -l 2>/dev/null | grep -E -q "run.sh.*start"
    return $?
}

check_user_perm() {
    # 部分操作需要 root 权限 (如安装环境)
    if [ "$EUID" -ne 0 ]; then
        echo -e "${YELLOW}提示: 当前非 root 用户，安装环境可能受限，建议使用 sudo 运行${NC}"
    fi
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# -------------------------------------------------------
# 环境管理功能
# -------------------------------------------------------

install_redis() {
    echo -e "${BLUE}>>> 检查 Redis 环境...${NC}"

    # 0. 检查 OS
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_NAME=$ID
    else
        echo -e "${RED}无法检测操作系统版本${NC}"
        return 1
    fi

    # Windows 环境检测
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OS_NAME" == "" ]]; then
        echo -e "${YELLOW}提示: 检测到当前可能为 Windows 环境或非标准 Linux 环境。${NC}"
        echo -e "Windows 用户请手动安装 Redis 或使用 Docker Desktop。"
        echo -e "推荐安装 Redis for Windows: https://github.com/tporadowski/redis/releases"
        return 0
    fi
    
    # 风险提示
    echo -e "${YELLOW}⚠️  警告: 切换到 Redis 存储模式后，需要重启服务。${NC}"
    echo -e "${YELLOW}      重启服务将导致【当前所有在线用户】强制登出。${NC}"
    read -p "是否继续? (y/n): " confirm_install
    if [[ "$confirm_install" != "y" ]]; then
        echo "操作已取消"
        return 0
    fi

    # 1. 检查 Redis 是否已安装
    if command_exists redis-server; then
        echo -e "${GREEN}Redis 已安装: $(redis-server --version | head -n 1)${NC}"
    else
        echo -e "${YELLOW}未检测到 Redis，准备自动安装...${NC}"
        if [[ "$OS_NAME" == "ubuntu" ]] || [[ "$OS_NAME" == "debian" ]]; then
            sudo apt-get update
            sudo apt-get install -y redis-server
        elif [[ "$OS_NAME" == "centos" ]] || [[ "$OS_NAME" == "rhel" ]]; then
            # CentOS 需要 EPEL 源
            if ! rpm -qa | grep -q epel-release; then
                sudo yum install -y epel-release
            fi
            sudo yum install -y redis
        else
            echo -e "${RED}不支持的自动安装系统: $OS_NAME，请手动安装 Redis${NC}"
            return 1
        fi
    fi

    # 2. 启动服务 & 健康检查
    echo -e "${BLUE}>>> 正在启动 Redis 服务...${NC}"
    if command_exists systemctl; then
        sudo systemctl enable redis
        sudo systemctl start redis
    else
        redis-server --daemonize yes
    fi
    
    # 等待几秒让服务启动
    sleep 2
    
    # 关键：检查 Redis 是否真的活着
    echo "正在检查 Redis 连接..."
    if ! command_exists redis-cli; then
        # 尝试安装 redis-tools (如果 redis-server 安装了但没有 cli)
        if [[ "$OS_NAME" == "ubuntu" ]] || [[ "$OS_NAME" == "debian" ]]; then
            sudo apt-get install -y redis-tools
        fi
    fi

    if command_exists redis-cli; then
        if redis-cli ping | grep -q "PONG"; then
             echo -e "${GREEN}Redis 连接测试通过 (PONG)${NC}"
        else
             echo -e "${RED}错误: Redis 服务启动失败或无法连接。${NC}"
             echo -e "${RED}为了保护系统稳定性，将中止配置修改。请检查 Redis 日志。${NC}"
             return 1
        fi
    else
        echo -e "${YELLOW}警告: 未找到 redis-cli，跳过连接测试 (假设安装成功)${NC}"
    fi

    # 3. 修改项目配置 (.env)
    echo -e "${BLUE}>>> 正在配置项目环境变量...${NC}"
    ENV_FILE=".env"
    if [ ! -f "$ENV_FILE" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env
        else
            echo -e "${RED}错误: 未找到 .env 或 .env.example 文件${NC}"
            return 1
        fi
    fi

    # 备份
    cp "$ENV_FILE" "${ENV_FILE}.bak_$(date +%Y%m%d%H%M%S)"
    
    # 智能更新配置
    # 1. 处理 USE_REDIS
    if grep -q "USE_REDIS=" "$ENV_FILE"; then
        # 存在则替换
        if echo "$OSTYPE" | grep -q "darwin"; then
            sed -i '' 's/USE_REDIS=.*/USE_REDIS=true/g' "$ENV_FILE"
        else
            sed -i 's/USE_REDIS=.*/USE_REDIS=true/g' "$ENV_FILE"
        fi
    else
        # 不存在则追加
        echo "USE_REDIS=true" >> "$ENV_FILE"
    fi

    # 2. 处理 REDIS_URL
    if ! grep -q "REDIS_URL=" "$ENV_FILE"; then
         echo "REDIS_URL=redis://localhost:6379" >> "$ENV_FILE"
    fi

    echo -e "${GREEN}配置已更新: 已启用 Redis 模式${NC}"
    
    # 4. 询问是否立即重启
    echo ""
    read -p "是否立即重启服务以应用更改? (y/n): " confirm_restart
    if [[ "$confirm_restart" == "y" ]]; then
        restart_app
    else
        echo -e "${YELLOW}>>> 请稍后手动选择菜单 3 重启服务。${NC}"
    fi
}
install_env() {
    echo -e "${BLUE}>>> 开始检查与部署运行环境...${NC}"

    # 1. 检查 curl
    if ! command_exists curl; then
        echo "未检测到 curl，尝试安装..."
        if command_exists apt-get; then
            sudo apt-get update && sudo apt-get install -y curl
        elif command_exists yum; then
            sudo yum install -y curl
        else
            echo -e "${RED}无法自动安装 curl，请手动安装后重试${NC}"
            return 1
        fi
    fi

    # 2. 检查 Node.js
    if command_exists node; then
        echo -e "${GREEN}Node.js 已安装: $(node -v)${NC}"
    else
        echo -e "${YELLOW}未检测到 Node.js，准备自动安装 (v18 LTS)...${NC}"
        
        # 检测OS
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS_NAME=$ID
        else
            echo -e "${RED}无法检测操作系统版本${NC}"
            return 1
        fi

        if [[ "$OS_NAME" == "ubuntu" ]] || [[ "$OS_NAME" == "debian" ]]; then
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
            sudo apt-get install -y nodejs
        elif [[ "$OS_NAME" == "centos" ]] || [[ "$OS_NAME" == "rhel" ]] || [[ "$OS_NAME" == "fedora" ]]; then
            curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
            sudo yum install -y nodejs
        else
            echo -e "${RED}不支持的自动安装系统: $OS_NAME，请手动安装 Node.js${NC}"
            return 1
        fi
        
        if command_exists node; then
            echo -e "${GREEN}Node.js 安装成功!版本: $(node -v)${NC}"
        else
            echo -e "${RED}Node.js 安装失败${NC}"
            return 1
        fi
    fi

    # 3. 检查 npm
    if ! command_exists npm; then
        echo -e "${YELLOW}正在安装 npm...${NC}"
        if [[ "$OS_NAME" == "ubuntu" ]] || [[ "$OS_NAME" == "debian" ]]; then
            sudo apt-get install -y npm
        elif [[ "$OS_NAME" == "centos" ]]; then
            sudo yum install -y npm
        fi
    fi

    # 4. 安装项目依赖
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}>>> 正在安装项目依赖 (npm install)...${NC}"
        npm install --registry=https://registry.npmmirror.com
        if [ $? -ne 0 ]; then
            echo -e "${RED}依赖安装失败${NC}"
            return 1
        fi
    else
        echo -e "${GREEN}项目依赖已存在${NC}"
    fi

    echo -e "${GREEN}>>> 环境部署完成${NC}"
}

# -------------------------------------------------------
# 服务管理功能
# -------------------------------------------------------

start_app() {
    local persist=true
    if [[ "$1" == "--no-persist" ]]; then
        persist=false
    fi

    # 每次启动前先尝试安装依赖(如果不存在)
    if [ ! -d "node_modules" ]; then
        install_env
    fi

    if [ -f "$PID_FILE" ]; then
        current_pid=$(cat "$PID_FILE")
        if ps -p "$current_pid" > /dev/null 2>&1; then
            echo -e "${YELLOW}服务已在运行中 (PID: $current_pid)${NC}"
            return
        else
            rm "$PID_FILE"
        fi
    fi

    echo -e "${GREEN}>>> 正在启动服务...${NC}"
    nohup node "$APP_MAIN" > "$LOG_FILE" 2>&1 &
    new_pid=$!
    echo "$new_pid" > "$PID_FILE"
    
    # 启用开机自启
    if [ "$persist" = true ]; then
        manage_autostart enable
        echo -e "${BLUE}已开启开机自动启动${NC}"
    fi

    # 循环检查服务状态 (最多等待 10 秒)
    echo "正在等待服务启动..."
    for i in {1..10}; do
        sleep 1
        # 1. 检查进程是否存活
        if ! ps -p "$new_pid" > /dev/null 2>&1; then
            echo -e "${RED}启动失败: 进程已退出${NC}"
            echo -e "请查看日志: cat $LOG_FILE"
            rm "$PID_FILE"
            return 1
        fi
        
        # 2. 检查日志是否有报错 (可选)
        if grep -q "Error:" "$LOG_FILE"; then
             echo -e "${RED}启动检测到错误日志${NC}"
        fi

        # 3. 检查端口是否被监听
        if command_exists netstat; then
             if netstat -tulpn 2>/dev/null | grep -q ":$APP_PORT "; then
                 echo -e "${GREEN}服务启动成功! (端口 $APP_PORT 已监听)${NC}"
                 echo -e "访问地址: http://localhost:$APP_PORT"
                 return 0
             fi
        fi
    done
    
    echo -e "${GREEN}服务已启动 (PID: $new_pid)${NC}"
    echo -e "日志文件: $LOG_FILE"
}

stop_app() {
    local persist=true
    if [[ "$1" == "--no-persist" ]]; then
        persist=false
    fi

    local pid=""
    if [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
    fi
    
    if [ -z "$pid" ] || ! ps -p "$pid" > /dev/null 2>&1; then
        if command_exists lsof; then
            pid=$(lsof -t -i:$APP_PORT)
        fi
    fi
    
    if [ -z "$pid" ]; then
        echo -e "${YELLOW}未检测到运行中的服务${NC}"
        [ -f "$PID_FILE" ] && rm "$PID_FILE"
        # 即使进程不在，也根据要求取消自启
        if [ "$persist" = true ]; then manage_autostart disable; fi
        return
    fi
    
    echo "正在停止服务 (PID: $pid)..."
    kill "$pid" 2>/dev/null
    
    for i in {1..5}; do
        if ! ps -p "$pid" > /dev/null 2>&1; then break; fi
        sleep 1
    done
    
    if ps -p "$pid" > /dev/null 2>&1; then
        kill -9 "$pid" 2>/dev/null
    fi

    [ -f "$PID_FILE" ] && rm "$PID_FILE"
    
    # 取消开机自启
    if [ "$persist" = true ]; then
        manage_autostart disable
        echo -e "${BLUE}已取消开机自动启动${NC}"
    fi

    echo -e "${GREEN}服务已停止${NC}"
}

restart_app() {
    # 记录当前状态
    local was_autostart=false
    if is_autostart_enabled; then
        was_autostart=true
    fi

    echo "正在重启服务..."
    # 停止时不改变自启配置
    stop_app --no-persist
    sleep 1
    # 启动时恢复之前的自启配置
    if [ "$was_autostart" = true ]; then
        start_app
    else
        start_app --no-persist
    fi
}

status_app() {
    local is_running=false
    local pid=""
    
    # 1. 端口检测 (最准确)
    if command_exists netstat; then
        if netstat -tulpn 2>/dev/null | grep -q ":$APP_PORT "; then
            is_running=true
        fi
    elif command_exists ss; then
        if ss -tulpn 2>/dev/null | grep -q ":$APP_PORT "; then
            is_running=true
        fi
    elif command_exists lsof; then
        if lsof -i:$APP_PORT >/dev/null 2>&1; then
            is_running=true
        fi
    fi
    
    # 2. PID 文件辅助检查
    if [ "$is_running" = false ] && [ -f "$PID_FILE" ]; then
        pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            is_running=true
        fi
    fi

    if [ "$is_running" = true ]; then
        echo -e "${GREEN}● 服务运行中${NC}"
        echo "   端口: $APP_PORT"
        [ -n "$pid" ] && echo "   PID: $pid"
    else
        echo -e "${RED}● 服务未运行${NC}"
    fi

    # 检查开机自启状态
    if is_autostart_enabled; then
        echo -e "   开机自启: ${GREEN}已开启${NC}"
    else
        echo -e "   开机自启: ${RED}已关闭${NC}"
    fi
}

view_logs() {
    if [ ! -f "$LOG_FILE" ]; then
        echo "暂无日志文件"
        return
    fi
    echo -e "${BLUE}正在追踪日志 (按 Ctrl+C 退出)...${NC}"
    tail -f "$LOG_FILE"
}

# -------------------------------------------------------
# 卸载清理功能
# -------------------------------------------------------

uninstall_app() {
    echo -e "${RED}警告: 此操作将执行以下清理:${NC}"
    echo " 1. 停止运行中的服务"
    echo " 2. 删除 node_modules (依赖库)"
    echo " 3. 删除运行日志 ($LOG_FILE)"
    echo " 4. 删除 PID 文件"
    echo -e "${YELLOW}注意: 为了数据安全，数据库文件 (db/exam.db) 不会被删除。${NC}"
    
    read -p "确定要继续吗? (y/n): " confirm
    if [[ "$confirm" != "y" ]]; then
        echo "操作已取消"
        return
    fi

    echo ">>> 开始卸载..."
    stop_app
    
    if [ -d "node_modules" ]; then
        echo "正在删除依赖库..."
        rm -rf node_modules
    fi
    
    if [ -f "$LOG_FILE" ]; then
        echo "正在删除日志..."
        rm "$LOG_FILE"
    fi

    echo -e "${GREEN}>>> 卸载清理完成${NC}"
}

# -------------------------------------------------------
# 数据库初始化功能
# -------------------------------------------------------

init_sqlite_db() {
    echo -e "${RED}╔═══════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║           ⚠️  警告: 危险操作 ⚠️                       ║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "此操作将${RED}删除现有的 SQLite 数据库${NC}并重新初始化。"
    echo -e "以下数据将${RED}永久丢失${NC}:"
    echo "  • 所有用户账号"
    echo "  • 所有题库数据"
    echo "  • 所有试卷配置"
    echo "  • 所有考试记录"
    echo "  • 所有系统日志"
    echo ""
    
    # 第一次确认
    read -p "确定要初始化数据库吗? (输入 y 继续): " confirm1
    if [[ "$confirm1" != "y" ]]; then
        echo -e "${GREEN}操作已取消${NC}"
        return
    fi
    
    # 第二次确认 (要求输入特定文字)
    echo ""
    echo -e "${YELLOW}【二次确认】请输入 'INIT' 以确认初始化操作:${NC}"
    read -p "> " confirm2
    if [[ "$confirm2" != "INIT" ]]; then
        echo -e "${GREEN}输入不匹配，操作已取消${NC}"
        return
    fi
    
    echo ""
    echo -e "${YELLOW}>>> 正在初始化数据库...${NC}"
    
    # 检查数据库文件是否存在
    DB_FILE="db/exam.db"
    if [ -f "$DB_FILE" ]; then
        # 备份旧数据库
        BACKUP_FILE="db/exam_backup_$(date +%Y%m%d_%H%M%S).db"
        echo "正在备份现有数据库到: $BACKUP_FILE"
        cp "$DB_FILE" "$BACKUP_FILE"
        
        # 删除现有数据库
        echo "正在删除现有数据库..."
        rm "$DB_FILE"
    fi
    
    # 重启服务以重新初始化数据库
    if [ -f "$PID_FILE" ]; then
        echo "正在重启服务以初始化新数据库..."
        stop_app
        sleep 1
        start_app
        echo ""
        echo -e "${GREEN}>>> 数据库初始化完成!${NC}"
        echo -e "${GREEN}默认管理员账号: admin / admin123${NC}"
    else
        echo -e "${GREEN}>>> 数据库文件已清除${NC}"
        echo -e "${YELLOW}请启动服务以自动初始化新数据库${NC}"
        echo -e "启动后默认管理员账号: admin / admin123"
    fi
}

# -------------------------------------------------------
# 系统更新功能
# -------------------------------------------------------

get_local_version() {
    if [ -f "package.json" ]; then
        grep '"version"' package.json | head -1 | awk -F'"' '{print $4}'
    else
        echo "0.0.0"
    fi
}

update_app() {
    echo -e "${BLUE}>>> 检查系统更新...${NC}"
    
    # 检查 curl
    if ! command_exists curl; then
        echo -e "${RED}错误: 未安装 curl，无法检查更新${NC}"
        return 1
    fi
    
    # 获取最新版本信息
    echo "正在获取最新版本信息..."
    RELEASE_INFO=$(curl -s "https://api.github.com/repos/${GITHUB_REPO}/releases/latest")
    
    if [ -z "$RELEASE_INFO" ] || echo "$RELEASE_INFO" | grep -q "Not Found" || echo "$RELEASE_INFO" | grep -q "message"; then
        if echo "$RELEASE_INFO" | grep -q "rate limit"; then
            echo -e "${RED}错误: GitHub API 请求频率触发限制，请稍后再试${NC}"
        else
            echo -e "${RED}错误: 无法获取版本信息，请检查网络连接或仓库配置${NC}"
        fi
        return 1
    fi
    
    # 解析版本号
    LATEST_VERSION=$(echo "$RELEASE_INFO" | grep '"tag_name"' | head -1 | awk -F'"' '{print $4}')
    LOCAL_VERSION=$(get_local_version)
    
    echo -e "当前版本: ${YELLOW}v${LOCAL_VERSION}${NC}"
    echo -e "最新版本: ${GREEN}${LATEST_VERSION}${NC}"
    
    LATEST_CLEAN=$(echo "$LATEST_VERSION" | sed 's/^v//')
    if [ "$LOCAL_VERSION" = "$LATEST_CLEAN" ]; then
        echo -e "${GREEN}当前已是最新版本，无需更新${NC}"
        return 0
    fi
    
    echo ""
    echo -e "${YELLOW}发现新版本！是否立即更新？${NC}"
    echo -e "${RED}警告: 更新将会覆盖现有程序文件 (public/, src/, package.json, run.sh)${NC}"
    echo -e "${YELLOW}数据库 (db/) 和配置 (.env) 将被保留${NC}"
    read -p "确认更新? (y/n): " confirm
    if [[ "$confirm" != "y" ]]; then
        echo "更新已取消"
        return 0
    fi
    
    TARBALL_URL=$(echo "$RELEASE_INFO" | grep '"tarball_url"' | head -1 | awk -F'"' '{print $4}')
    
    if [ -z "$TARBALL_URL" ]; then
        echo -e "${RED}错误: 无法获取下载链接${NC}"
        return 1
    fi
    
    echo -e "${YELLOW}>>> 停止服务...${NC}"
    stop_app
    
    BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
    echo -e "${YELLOW}>>> 备份当前版本到 ${BACKUP_DIR}...${NC}"
    mkdir -p "$BACKUP_DIR"
    [ -d "public" ] && cp -r public "$BACKUP_DIR/"
    [ -d "src" ] && cp -r src "$BACKUP_DIR/"
    [ -f "package.json" ] && cp package.json "$BACKUP_DIR/"
    [ -f "run.sh" ] && cp run.sh "$BACKUP_DIR/"
    
    # 清理旧备份 (只保留最近 1 个)
    # 列出所有backup_开头目录，按时间排序，跳过最新的1个，删除其余的
    ls -dt backup_* 2>/dev/null | tail -n +2 | xargs rm -rf
    
    echo -e "${YELLOW}>>> 下载新版本...${NC}"
    TEMP_DIR=$(mktemp -d)
    curl -L -o "$TEMP_DIR/release.tar.gz" "$TARBALL_URL"
    
    if [ ! -f "$TEMP_DIR/release.tar.gz" ]; then
        echo -e "${RED}下载失败${NC}"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    echo -e "${YELLOW}>>> 解压更新包...${NC}"
    tar -xzf "$TEMP_DIR/release.tar.gz" -C "$TEMP_DIR"
    EXTRACTED_DIR=$(ls -d "$TEMP_DIR"/*/ | head -1)
    
    if [ -z "$EXTRACTED_DIR" ]; then
        echo -e "${RED}解压失败${NC}"
        rm -rf "$TEMP_DIR"
        return 1
    fi
    
    echo -e "${YELLOW}>>> 更新文件...${NC}"
    cp -rf "${EXTRACTED_DIR}public" ./
    cp -rf "${EXTRACTED_DIR}src" ./
    cp -f "${EXTRACTED_DIR}package.json" ./
    cp -f "${EXTRACTED_DIR}run.sh" ./
    
    rm -rf "$TEMP_DIR"
    
    echo -e "${YELLOW}>>> 更新依赖...${NC}"
    if [ -d "node_modules" ]; then
        rm -rf node_modules
    fi
    npm install --registry=https://registry.npmmirror.com
    if [ $? -ne 0 ]; then
        echo -e "${RED}依赖安装失败，尝试恢复备份...${NC}"
        echo -e "${YELLOW}请检查网络或配置，然后尝试手动运行: npm install${NC}"
        echo -e "${YELLOW}之前的代码备份在: ${BACKUP_DIR}${NC}"
        return 1
    fi
    echo -e "${YELLOW}>>> 启动服务并检查自启配置...${NC}"
    if ! is_autostart_enabled; then
        echo -e "${BLUE}检测到未开启开机自启，系统更新后将自动为您补全配置...${NC}"
    fi
    start_app
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  系统更新完成! 新版本: ${LATEST_VERSION}${NC}"
    echo -e "${GREEN}  之前的代码已备份至: ${BACKUP_DIR}${NC}"
    echo -e "${GREEN}========================================${NC}"
}

restore_app() {
    echo -e "${BLUE}>>> 准备系统还原...${NC}"
    
    # 查找最近的备份目录
    LATEST_BACKUP=$(ls -td backup_* 2>/dev/null | head -1)
    
    if [ -z "$LATEST_BACKUP" ]; then
        echo -e "${RED}错误: 未找到任何备份目录 (backup_*)${NC}"
        return 1
    fi
    
    echo -e "发现最近备份: ${YELLOW}${LATEST_BACKUP}${NC}"
    echo -e "${RED}警告: 此操作将用备份文件覆盖当前系统！${NC}"
    echo -e "${YELLOW}数据库 (db/) 和配置 (.env) 不会受到影响。${NC}"
    
    read -p "确认还原? (y/n): " confirm
    if [[ "$confirm" != "y" ]]; then
        echo "还原已取消"
        return 0
    fi
    
    echo -e "${YELLOW}>>> 停止服务...${NC}"
    stop_app
    
    echo -e "${YELLOW}>>> 正在从 ${LATEST_BACKUP} 恢复文件...${NC}"
    
    # 恢复文件
    if [ -d "${LATEST_BACKUP}/public" ]; then
        rm -rf public
        cp -r "${LATEST_BACKUP}/public" ./
    fi
    
    if [ -d "${LATEST_BACKUP}/src" ]; then
        rm -rf src
        cp -r "${LATEST_BACKUP}/src" ./
    fi
    
    if [ -f "${LATEST_BACKUP}/package.json" ]; then
        cp "${LATEST_BACKUP}/package.json" ./
    fi
    
    # 注意：通常还原功能本身就在 run.sh 中运行，直接覆盖运行中的脚本可能有风险。
    # 但由于是 shell 脚本，通常只要不修改正在执行的函数段就没事。
    if [ -f "${LATEST_BACKUP}/run.sh" ]; then
        cp "${LATEST_BACKUP}/run.sh" ./
    fi
    
    echo -e "${YELLOW}>>> 还原依赖...${NC}"
    if [ -d "node_modules" ]; then
        rm -rf node_modules
    fi
    npm install --registry=https://registry.npmmirror.com
    
    echo -e "${YELLOW}>>> 启动服务...${NC}"
    start_app
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  系统已还原至备份状态!${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# -------------------------------------------------------
# 主菜单
# -------------------------------------------------------

show_menu() {
    echo -e "\n${BLUE}===== 企业考试系统管理菜单 =====${NC}"
    echo " 1. 启动服务 (Start)"
    echo " 2. 停止服务 (Stop)"
    echo " 3. 重启服务 (Restart)"
    echo " 4. 查看状态 (Status)"
    echo " 5. 查看日志 (Logs)"
    echo " 6. 环境部署 (Install Env)"
    echo " 7. 卸载清理 (Uninstall)"
    echo -e " 8. ${YELLOW}初始化数据库 (Init DB)${NC}"
    echo -e " 9. ${GREEN}系统更新 (Update)${NC}"
    echo -e " 10. ${BLUE}系统还原 (Restore)${NC}"
    echo " 0. 退出 (Exit)"
    echo -e "${BLUE}================================${NC}"
}

# 执行逻辑
if [ -z "$ACTION" ]; then
    while true; do
        show_menu
        read -p "请输入选项数字: " choice
        case "$choice" in
            1) start_app ;;
            2) stop_app ;;
            3) restart_app ;;
            4) status_app ;;
            5) view_logs ;;
            6) install_env ;;
            7) uninstall_app ;;
            8) init_sqlite_db ;;
            9) update_app ;;
            10) restore_app ;;
            0) echo "再见!"; exit 0 ;;
            *) echo -e "${RED}无效选项，请重新输入${NC}" ;;
        esac
        
        echo ""
        read -p "按回车键继续..."
    done
elif [ -n "$ACTION" ]; then
    case "$ACTION" in
        start)   start_app $PERSIST_FLAG ;;
        stop)    stop_app $PERSIST_FLAG ;;
        restart) restart_app ;;
        status)  status_app ;;
        logs)    view_logs ;;
    esac
    exit 0
fi
