#!/bin/zsh

# 厦漳泉都市圈综合分析平台：一键拉取（GitHub → 本地）
# macOS 双击运行；若双击无反应，先执行一次：chmod +x "一键拉取.command"

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

print ""
print "========================================"
print "  一键拉取：从 GitHub 同步最新代码到本地"
print "========================================"
print ""

command -v git >/dev/null 2>&1 || {
  print "✗ 未找到 git，请先安装：Xcode Command Line Tools（xcode-select --install）"
  print "  或 Homebrew（brew install git）。"
  read -k 1 "?按回车退出……"
  exit 1
}

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
if [[ -z "$branch" ]]; then
  print "✗ 当前目录不是有效的 git 仓库（或不在分支上）。"
  read -k 1 "?按回车退出……"
  exit 1
fi
print "• 当前分支：$branch"

print "• 正在从 origin 拉取……"
git pull
code=$?
if [[ $code -ne 0 ]]; then
  # 拉取失败且存在本地改动（多为解压包旧版本/运行时自动写入的日志，无个人内容）：
  # 自动暂存 → 重拉 → 尝试恢复；恢复冲突则放弃本地改动，以仓库版本为准。
  dirty="$(git status --porcelain 2>/dev/null)"
  if [[ -n "$dirty" ]]; then
    print "• 拉取因本地改动冲突失败，自动暂存后重试……"
    git stash push -m "一键拉取-冲突自动暂存" >/dev/null 2>&1
    git pull
    code=$?
    if [[ $code -eq 0 ]]; then
      print "• 尝试恢复本地改动……"
      git stash pop 2>&1 | head -5
      # 注意：pop 冲突时退出码也是 0，须用 unmerged 状态判断
      unmerged="$(git ls-files -u 2>/dev/null)"
      if [[ -n "$unmerged" ]]; then
        print "• 本地改动与更新冲突（多为解压旧版本/运行时日志），已放弃本地改动，以仓库版本为准。"
        git reset --hard >/dev/null 2>&1
        git stash drop >/dev/null 2>&1
      fi
    else
      print "• 拉取仍失败，恢复本地改动。"
      git stash pop >/dev/null 2>&1
    fi
  fi
  git pull >/dev/null 2>&1
  code=$?
  if [[ $code -ne 0 ]]; then
    print ""
    print "✗ 拉取失败。可能原因：网络无法连接 GitHub 或存在无法自动处理的冲突。"
    print "  请重试；若仍失败，检查网络或联系打包方。"
    read -k 1 "?按回车退出……"
    exit 1
  fi
fi

# 跨系统协作：mac 与 Windows 各自维护 node_modules，
# pull 后若 lockfile 变化则自动重装依赖，避免启动时依赖不同步报错。
WEB_DIR="$PROJECT_DIR/apps/web"
needs_install() {
  [[ -x "$WEB_DIR/node_modules/.bin/vinext" ]] || return 0
  [[ -f "$WEB_DIR/pnpm-lock.yaml" && -f "$WEB_DIR/node_modules/.modules.yaml" ]] || return 0
  [[ "$WEB_DIR/pnpm-lock.yaml" -nt "$WEB_DIR/node_modules/.modules.yaml" ]] && return 0
  return 1
}

if needs_install; then
  print "• 依赖有更新（lockfile 已变化），正在安装前端依赖（已配国内镜像加速，约 2~5 分钟）……"
  # pnpm 检查：项目 lockfile 为 v9.0，需 pnpm >= 9；缺失或过旧时自动安装新版
  pnpm_ok=0
  PNPM_BIN="$(command -v pnpm 2>/dev/null || true)"
  if [[ -n "$PNPM_BIN" ]]; then
    pv="$("$PNPM_BIN" --version 2>/dev/null)"
    if [[ "$pv" =~ ^([0-9]+) ]] && (( ${match[1]} >= 9 )); then pnpm_ok=1; fi
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
    read -k 1 "?按回车退出……"
    exit 1
  fi
  (cd "$WEB_DIR" && pnpm install --reporter=append-only)
  if [[ $? -ne 0 ]]; then
    print "✗ 依赖安装失败（网络中断？可重试，已下载部分会缓存复用）。"
    read -k 1 "?按回车退出……"
    exit 1
  fi
  print "• 依赖安装完成 ✓"
else
  print "• 依赖无变化，无需安装 ✓"
fi

print ""
print "========================================"
print "  拉取完成 ✓"
print "========================================"
print ""
read -k 1 "?按回车退出……"
