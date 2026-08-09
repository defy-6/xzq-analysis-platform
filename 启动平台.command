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

# 优先使用系统 Node.js；仅在系统缺失时回退到旧版本地缓存路径
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" ]] && [[ -x "/Users/defy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="/Users/defy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  export PATH="$(dirname "$NODE_BIN"):$PATH"
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

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
# -a：日志可能含 NUL 等控制字符被 grep 判为二进制，导致输出 "Binary file ... matches" 而非 URL。
platform_local_url() {
  grep -aEo 'http://localhost:[0-9]+/' "$FRONTEND_LOG" 2>/dev/null | tail -n 1
}

pause_before_exit() {
  if [[ -t 0 ]]; then
    read -k 1 "?按任意键关闭此窗口……"
    print ""
  fi
}

# 已在运行则直接打开浏览器（后台守护，窗口关闭后平台仍运行）
# 判断依据：本项目记录在 PID 文件的进程存活且其工作目录为本项目 apps/web。
# 不能用 pgrep -f "scripts/start_web.mjs"——其他项目（如城乡融合评估系统）也用
# 同样的相对路径启动命令，会跨项目误判。
platform_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
running=""
if [[ -n "$platform_pid" ]] && kill -0 "$platform_pid" 2>/dev/null; then
  raw_cwd="$(lsof -a -p "$platform_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  cwd="$(printf '%b' "$raw_cwd")"
  if [[ "$cwd" == "$WEB_DIR" ]]; then
    running=1
  fi
fi

# 递归结束进程树：先杀子进程再杀自身（vinext dev 会 fork 子进程监听端口，
# 只杀主进程会导致端口残留、每次双击端口递增；默认 SIGTERM，可传 KILL 强杀）
kill_tree() {
  local pid=$1 sig=${2:-TERM}
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_tree "$child" "$sig"
    done
  fi
  kill -s "$sig" "$pid" 2>/dev/null || true
}

# 双击一键启动 = 重启到最新代码：若平台已在运行，先停止旧进程再启动新实例
if [[ -n "$running" ]]; then
  print "• 检测到平台正在运行（PID $platform_pid），正在停止旧进程并重新启动……"
  kill_tree "$platform_pid"
  for _ in {1..10}; do
    kill -0 "$platform_pid" 2>/dev/null || break
    /bin/sleep 1
  done
  if kill -0 "$platform_pid" 2>/dev/null; then
    print "⚠ 旧进程未正常退出，强制结束……"
    kill_tree "$platform_pid" KILL
    kill -9 "$platform_pid" 2>/dev/null || true
    /bin/sleep 1
  fi
fi

PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
if [[ -z "$PNPM_BIN" ]]; then
  print "✗ 未找到 pnpm，无法启动平台。请先安装：npm install -g pnpm"
  print ""
  pause_before_exit
  exit 1
fi

# 首次运行、依赖缺失、或 git pull 更新了 lockfile 时安装/同步前端依赖。
# 跨系统协作：mac 与 Windows 各自维护 node_modules，lockfile 变化时必须重装，
# 否则 vite 优化缓存会引用旧的 pnpm 哈希路径，启动后页面报 Failed to resolve import。
needs_install() {
  [[ -x "$WEB_DIR/node_modules/.bin/vinext" ]] || return 0
  [[ -f "$WEB_DIR/pnpm-lock.yaml" && -f "$WEB_DIR/node_modules/.modules.yaml" ]] || return 0
  [[ "$WEB_DIR/pnpm-lock.yaml" -nt "$WEB_DIR/node_modules/.modules.yaml" ]] && return 0
  return 1
}

if needs_install; then
  print "• 依赖需安装/更新（首次运行或 lockfile 已变化），正在 pnpm install……"
  (cd "$WEB_DIR" && "$PNPM_BIN" install) >>"$FRONTEND_LOG" 2>&1
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
nohup "$NODE_BIN" scripts/start_web.mjs >>"$FRONTEND_LOG" 2>&1 &
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
