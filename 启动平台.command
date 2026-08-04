#!/bin/zsh

# 厦漳泉都市圈综合分析平台：macOS 双击启动入口
# 参考「福建省城乡融合评估系统」启动脚本的写法：
#   后台守护运行、重复双击不重复启动、运行日志持久化、失败时展示日志。

set -u

PROJECT_DIR="${0:A:h}"
WEB_DIR="$PROJECT_DIR/apps/web"
LOG_DIR="$PROJECT_DIR/运行日志"
FRONTEND_LOG="$LOG_DIR/frontend.log"
PID_FILE="$LOG_DIR/frontend.pid"

NODE_DIR="/Users/defy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
export PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$LOG_DIR"

print ""
print "========================================"
print "  厦漳泉都市圈综合分析平台"
print "  正在检查并启动平台……"
print "========================================"
print ""

url_ready() {
  /usr/bin/curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

# vinext 启动时会输出 Local 地址；端口 3000 被占用时它会自动改用下一端口，
# 因此必须从本项目的日志解析真实地址，而不是写死 3000。
platform_local_url() {
  grep -Eo 'http://localhost:[0-9]+/' "$FRONTEND_LOG" 2>/dev/null | tail -n 1
}

pause_before_exit() {
  if [[ -t 0 ]]; then
    read -k 1 "?按任意键关闭此窗口……"
    print ""
  fi
}

# 已在运行则直接打开浏览器（后台守护，窗口关闭后平台仍运行）
if pgrep -f "scripts/start_web.mjs" >/dev/null 2>&1; then
  URL="$(platform_local_url)"
  if [[ -z "$URL" ]]; then
    URL="http://localhost:3000/"
  fi
  print "✓ 平台已在运行，直接打开：$URL"
  open "$URL"
  print ""
  pause_before_exit
  exit 0
fi

NPM_BIN="$(command -v npm 2>/dev/null || true)"
if [[ -z "$NPM_BIN" ]]; then
  print "✗ 未找到 Node.js/npm，无法启动平台。"
  print ""
  pause_before_exit
  exit 1
fi

# 首次运行或依赖缺失时安装前端依赖
if [[ ! -x "$WEB_DIR/node_modules/.bin/vinext" ]]; then
  print "• 首次运行，正在安装前端依赖……"
  (cd "$WEB_DIR" && "$NPM_BIN" install) >>"$FRONTEND_LOG" 2>&1
  if [[ $? -ne 0 ]]; then
    print "✗ 前端依赖安装失败，请查看：$FRONTEND_LOG"
    print ""
    pause_before_exit
    exit 1
  fi
fi

# 启动平台（后台守护，日志落盘）
print "• 正在启动平台……"
cd "$WEB_DIR" || exit 1
nohup "$NODE_DIR/node" scripts/start_web.mjs >>"$FRONTEND_LOG" 2>&1 &
print -r -- "$!" >"$PID_FILE"

# 等待服务就绪：从日志解析真实地址并探测
URL=""
for i in {1..60}; do
  URL="$(platform_local_url)"
  if [[ -n "$URL" ]] && url_ready "$URL"; then
    break
  fi
  /bin/sleep 1
done

if [[ -z "$URL" ]] || ! url_ready "$URL"; then
  print "✗ 平台启动失败（60 秒内未就绪），请查看：$FRONTEND_LOG"
  print ""
  print "---------------- 日志末尾 ----------------"
  tail -n 30 "$FRONTEND_LOG"
  print "------------------------------------------"
  print ""
  pause_before_exit
  exit 1
fi

open "$URL"

print ""
print "========================================"
print "  平台已启动：$URL"
print "  运行日志：$LOG_DIR"
print "  此窗口关闭后平台仍会继续运行。"
print "  如需停止：kill \$(cat $PID_FILE)"
print "========================================"
print ""
pause_before_exit
