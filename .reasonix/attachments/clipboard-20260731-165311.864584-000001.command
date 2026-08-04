#!/bin/zsh

# 福建省城乡融合评估系统：macOS 双击启动入口

set -u

PROJECT_DIR="${0:A:h}"
FRONTEND_DIR="$PROJECT_DIR/frontend"
LOG_DIR="$PROJECT_DIR/运行日志"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/anaconda3/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR" || exit 1

print ""
print "========================================"
print "  福建省城乡融合评估系统"
print "  正在检查并启动平台……"
print "========================================"
print ""

url_ready() {
  /usr/bin/curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

wait_for_url() {
  local target_url="$1"
  local max_checks="$2"
  local check_no=0
  while (( check_no < max_checks )); do
    if url_ready "$target_url"; then
      return 0
    fi
    /bin/sleep 1
    (( check_no += 1 ))
  done
  return 1
}

pause_before_exit() {
  if [[ -t 0 ]]; then
    read -k 1 "?按任意键关闭此窗口……"
    print ""
  fi
}

find_python() {
  local candidate
  for candidate in \
    "$PROJECT_DIR/.venv/bin/python" \
    "/opt/anaconda3/bin/python3" \
    "/opt/homebrew/bin/python3" \
    "/usr/local/bin/python3" \
    "/usr/bin/python3"; do
    if [[ -x "$candidate" ]] && "$candidate" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
      print -r -- "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(find_python)"
if [[ -z "$PYTHON_BIN" ]]; then
  print "✗ 未找到已安装 FastAPI 和 Uvicorn 的 Python 环境。"
  print "  请先按照项目 README 安装后端依赖。"
  print ""
  pause_before_exit
  exit 1
fi

NPM_BIN="$(command -v npm 2>/dev/null || true)"
if [[ -z "$NPM_BIN" ]]; then
  print "✗ 未找到 Node.js/npm，无法启动前端。"
  print ""
  pause_before_exit
  exit 1
fi

if url_ready "http://127.0.0.1:8000/api/health"; then
  print "✓ 后端服务已经运行"
else
  print "• 正在启动后端服务……"
  nohup "$PYTHON_BIN" -m uvicorn backend.app.main:app \
    --host 127.0.0.1 --port 8000 >>"$BACKEND_LOG" 2>&1 &
  print -r -- "$!" >"$LOG_DIR/backend.pid"
  if wait_for_url "http://127.0.0.1:8000/api/health" 30; then
    print "✓ 后端服务启动成功"
  else
    print "✗ 后端启动失败，请查看：$BACKEND_LOG"
    print ""
    pause_before_exit
    exit 1
  fi
fi

if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vinext" ]]; then
  print "• 首次运行，正在安装前端依赖……"
  (cd "$FRONTEND_DIR" && "$NPM_BIN" install) >>"$FRONTEND_LOG" 2>&1
  if [[ $? -ne 0 ]]; then
    print "✗ 前端依赖安装失败，请查看：$FRONTEND_LOG"
    print ""
    pause_before_exit
    exit 1
  fi
fi

if url_ready "http://localhost:3000/"; then
  print "✓ 前端页面已经运行"
else
  print "• 正在启动前端页面……"
  (cd "$FRONTEND_DIR" && nohup "$NPM_BIN" run dev >>"$FRONTEND_LOG" 2>&1 & print -r -- "$!" >"$LOG_DIR/frontend.pid")
  if wait_for_url "http://localhost:3000/" 45; then
    print "✓ 前端页面启动成功"
  else
    print "✗ 前端启动失败，请查看：$FRONTEND_LOG"
    print ""
    pause_before_exit
    exit 1
  fi
fi

open "http://localhost:3000/"

print ""
print "========================================"
print "  平台已启动：http://localhost:3000/"
print "  运行日志保存在：运行日志/"
print "  此窗口关闭后平台仍会继续运行。"
print "========================================"
print ""
pause_before_exit
