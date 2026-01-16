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
    echo " 0. 退出 (Exit)"
    echo -e "${BLUE}==============================${NC}"
}

# 主循环
while true; do
    show_menu
    read -p "请输入选项数字 [0-7]: " choice
    case "$choice" in
        1) start_app ;;
        2) stop_app ;;
        3) restart_app ;;
        4) status_app ;;
        5) view_logs ;;
        6) install_env ;;
        7) uninstall_app ;;
        0) echo "再见!"; exit 0 ;;
        *) echo -e "${RED}无效选项，请重新输入${NC}" ;;
    esac
    
    echo ""
    read -p "按回车键继续..."
done
