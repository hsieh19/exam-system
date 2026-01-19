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
# 辅助函数
# -------------------------------------------------------

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
    
    sleep 1
    if ps -p "$new_pid" > /dev/null 2>&1; then
        echo -e "${GREEN}服务启动成功!${NC}"
        echo -e "PID: ${GREEN}$new_pid${NC}"
        echo -e "访问地址: http://localhost:$APP_PORT"
        echo -e "日志文件: $LOG_FILE"
    else
        echo -e "${RED}启动失败，请查看日志: $LOG_FILE${NC}"
    fi
}

stop_app() {
    if [ ! -f "$PID_FILE" ]; then
        echo -e "${YELLOW}未检测到运行中的服务${NC}"
        return
    fi
    
    target_pid=$(cat "$PID_FILE")
    if ps -p "$target_pid" > /dev/null 2>&1; then
        echo "正在停止服务 (PID: $target_pid)..."
        kill "$target_pid"
        rm "$PID_FILE"
        echo -e "${GREEN}服务已停止${NC}"
    else
        echo "清理无效的 PID 文件"
        rm "$PID_FILE"
    fi
}

restart_app() {
    stop_app
    sleep 1
    start_app
}

status_app() {
    if [ -f "$PID_FILE" ]; then
        target_pid=$(cat "$PID_FILE")
        if ps -p "$target_pid" > /dev/null 2>&1; then
            echo -e "${GREEN}● 服务运行中${NC}"
            echo "   PID: $target_pid"
            echo "   端口: $APP_PORT"
            return
        fi
    fi
    echo -e "${RED}● 服务未运行${NC}"
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
    
    echo -e "${YELLOW}>>> 启动服务...${NC}"
    start_app
    
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  系统更新完成! 新版本: ${LATEST_VERSION}${NC}"
    echo -e "${GREEN}  之前的代码已备份至: ${BACKUP_DIR}${NC}"
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
    echo " 0. 退出 (Exit)"
    echo -e "${BLUE}================================${NC}"
}

# 主循环
while true; do
    show_menu
    read -p "请输入选项数字 [0-9]: " choice
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
        0) echo "再见!"; exit 0 ;;
        *) echo -e "${RED}无效选项，请重新输入${NC}" ;;
    esac
    
    echo ""
    read -p "按回车键继续..."
done
