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

# Node.js 检查：需 >= 22.13（项目 engines 要求）。
# 优先使用系统 Node；缺失或版本过旧时，自动下载便携版到项目内 .runtime/node（免安装）。
NODE_BIN="$(command -v node 2>/dev/null || true)"
node_ok=0
if [[ -n "$NODE_BIN" ]]; then
  nv="$("$NODE_BIN" --version 2>/dev/null)"
  if [[ "$nv" =~ ^v([0-9]+)\.([0-9]+) ]]; then
    if (( ${match[1]} > 22 )) || (( ${match[1]} == 22 && ${match[2]} >= 13 )); then
      node_ok=1
    fi
  fi
  if [[ $node_ok -eq 0 ]]; then
    print "• 系统 Node.js 版本过旧（$nv，需 >= 22.13），改用便携版……"
  fi
fi
# 旧版本地缓存路径回退（仅系统缺失时）
if [[ -z "$NODE_BIN" ]] && [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  export PATH="$(dirname "$NODE_BIN"):$PATH"
  node_ok=1
fi
if [[ $node_ok -eq 0 ]]; then
  RT_DIR="$PROJECT_DIR/.runtime"
  NODE_DIR="$RT_DIR/node"
  PORTABLE_NODE="$NODE_DIR/bin/node"
  if [[ ! -x "$PORTABLE_NODE" ]]; then
    print "• 正在自动下载便携版 Node.js（约 25MB）……"
    NODE_VER="v22.14.0"
    TARBALL="$RT_DIR/node-$NODE_VER.tar.gz"
    mkdir -p "$RT_DIR"
    ok=0
    for base in "https://nodejs.org/dist" "https://npmmirror.com/mirrors/node"; do
      url="$base/$NODE_VER/node-$NODE_VER-darwin-arm64.tar.gz"
      print "• 下载 $url"
      if /usr/bin/curl -fsSL --max-time 300 -o "$TARBALL" "$url"; then
        ok=1
        break
      fi
    done
    if [[ $ok -eq 1 ]]; then
      tar -xzf "$TARBALL" -C "$RT_DIR"
      rm -f "$TARBALL"
      unpacked="$(ls -d "$RT_DIR"/node-v*-darwin-arm64 2>/dev/null | head -n 1)"
      if [[ -n "$unpacked" ]]; then
        rm -rf "$NODE_DIR"
        mv "$unpacked" "$NODE_DIR"
      fi
    else
      print "✗ 自动下载 Node.js 失败（网络不通？）。请手动安装 Node.js（>= 22.13）：https://nodejs.org/"
      print ""
      pause_before_exit
      exit 1
    fi
  fi
  if [[ -x "$PORTABLE_NODE" ]]; then
    NODE_BIN="$PORTABLE_NODE"
    export PATH="$(dirname "$NODE_BIN"):$PATH"
    node_ok=1
    # 永久加入 shell 配置：新终端也能直接用 node/npm/pnpm（pnpm 依赖 node，故连 node 目录一起加）
    bin_dir="$(dirname "$NODE_BIN")"
    if ! grep -qF "$bin_dir" "$HOME/.zshrc" 2>/dev/null; then
      echo "export PATH=\"$bin_dir:\$PATH\"" >>"$HOME/.zshrc"
      print "• 已把便携运行时目录加入 ~/.zshrc（$bin_dir，新终端生效）"
    fi
  fi
fi
if [[ $node_ok -eq 0 ]]; then
  print "✗ 未找到可用的 Node.js（>= 22.13）。请手动安装：https://nodejs.org/"
  print ""
  pause_before_exit
  exit 1
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
  # localhost 可能解析到 IPv6(::1)而 vite 只绑定 IPv4;依次探测原样/127.0.0.1
  /usr/bin/curl -fsS --max-time 3 "$1" >/dev/null 2>&1 && return 0
  if [[ "$1" == *localhost* ]]; then
    /usr/bin/curl -fsS --max-time 3 "${1/localhost/127.0.0.1}" >/dev/null 2>&1
  else
    return 1
  fi
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

# pnpm 检查：项目 lockfile 为 v9.0，需 pnpm >= 9；缺失或过旧时自动安装新版
# （corepack 优先，npm -g 兜底）。
pnpm_ok=0
PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
if [[ -n "$PNPM_BIN" ]]; then
  pv="$("$PNPM_BIN" --version 2>/dev/null)"
  if [[ "$pv" =~ ^([0-9]+) ]] && (( ${match[1]} >= 9 )); then
    pnpm_ok=1
  fi
  if [[ $pnpm_ok -eq 0 ]]; then
    print "• 系统 pnpm 版本过旧（$pv，需 >= 9 才能读取项目 lockfile），正在安装新版……"
  fi
fi
if [[ $pnpm_ok -eq 0 ]]; then
  [[ -z "$PNPM_BIN" ]] && print "• 未找到 pnpm，正在安装……"
  print "• 尝试 npm install -g pnpm@latest（国内镜像）……"
  npm install -g pnpm@latest --registry=https://registry.npmmirror.com/ >/dev/null 2>&1 || true
  PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
  if [[ -n "$PNPM_BIN" ]]; then
    pv="$("$PNPM_BIN" --version 2>/dev/null)"
    if [[ "$pv" =~ ^([0-9]+) ]] && (( ${match[1]} >= 9 )); then pnpm_ok=1; fi
  fi
fi
if [[ $pnpm_ok -eq 0 ]]; then
  print "• npm 安装未生效，尝试 corepack……"
  export COREPACK_NPM_REGISTRY="https://registry.npmmirror.com/"
  corepack enable pnpm >/dev/null 2>&1 || true
  PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
  if [[ -n "$PNPM_BIN" ]]; then
    pv="$("$PNPM_BIN" --version 2>/dev/null)"
    if [[ "$pv" =~ ^([0-9]+) ]] && (( ${match[1]} >= 9 )); then pnpm_ok=1; fi
  fi
fi
if [[ $pnpm_ok -eq 0 ]]; then
  print "✗ 自动安装 pnpm 失败。请手动执行：npm install -g pnpm 后重试。"
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
  print "• 依赖需安装/更新（首次约 2~5 分钟，已配国内镜像加速；请勿关闭窗口，耐心等待）……"
  # --reporter=append-only：逐行显示下载/安装进度（实时可见，不再像"卡住"）
  (cd "$WEB_DIR" && "$PNPM_BIN" install --reporter=append-only) 2>&1 | tee -a "$FRONTEND_LOG"
  if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
    print "✗ 前端依赖安装失败（网络中断？可关闭重试，已下载部分会缓存复用）。"
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

# 等待服务就绪：从日志解析真实地址并探测（首次启动 vite 需扫描依赖+冷编译，可能超过 1 分钟，故等 120 秒）
URL=""
for i in {1..120}; do
  URL="$(platform_local_url)"
  if [[ -n "$URL" ]] && url_ready "$URL"; then
    break
  fi
  if (( i % 10 == 0 )); then
    print "• 等待服务就绪（已 $i 秒，首次启动较慢，请耐心）……"
  fi
  /bin/sleep 1
done

if [[ -z "$URL" ]] || ! url_ready "$URL"; then
  print "✗ 平台启动失败（120 秒内未就绪），请查看：$FRONTEND_LOG"
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
