#!/bin/zsh

# ============================================================
# 厦漳泉都市圈综合分析平台：打包给同事（Mac 版，无依赖包）
# macOS 双击运行；若双击无反应，先执行一次：chmod +x "打包给同事.command"
#
# 为什么包内不含 node_modules：Mac 安装的依赖（esbuild/workerd/sharp 等）
# 是 Mac 专用二进制，Windows 上无法使用。本包由 Mac 打包，因此排除依赖；
# 同事首次双击「启动平台.bat」时，脚本检测到依赖缺失会自动执行
# pnpm install（需联网，约 2~5 分钟），之后即开箱即用。
#
# 参数（在终端运行时）：
#   ./打包给同事.command -IncludeRaw   同时包含 data/raw（约 821MB 构建源数据）
#   ./打包给同事.command -NoGit        剔除 .git（剔除后同事无法 git 同步更新）
# ============================================================

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

INCLUDE_RAW=0
NO_GIT=0
for arg in "$@"; do
  case "$arg" in
    -IncludeRaw) INCLUDE_RAW=1 ;;
    -NoGit) NO_GIT=1 ;;
  esac
done

print ""
print "========================================"
print "  打包给同事（Mac 版，无依赖包）"
print "========================================"
print ""

[[ -d "apps/web" ]] || { print "✗ 当前目录不是项目根目录。"; read -k 1 "?按回车退出……"; exit 1; }

print "• 说明：本包不含 node_modules（Mac 依赖与 Windows 不兼容）。"
print "  同事需安装 Node.js + pnpm，首次双击启动平台.bat 会自动安装依赖（联网 2~5 分钟）。"
print ""

stamp="$(date +%Y%m%d)"
out_dir="$PROJECT_DIR/迁移打包"
mkdir -p "$out_dir"
out="$out_dir/xzq-platform-macpack-$stamp.tar.gz"

tmp="$(mktemp -d)"
stage="$tmp/xzq-platform"
mkdir -p "$stage"
trap 'rm -rf "$tmp"' EXIT

rsync_args=(-a --exclude='node_modules' --exclude='运行日志' --exclude='.pnpm-store' --exclude='.reasonix' --exclude='reasonix.toml' --exclude='迁移打包' --exclude='.wrangler' --exclude='.vinext' --exclude='.next' --exclude='.DS_Store' --exclude='Thumbs.db')
# 精确排除 dist（避免误伤 apps/web/dist 之外的包内 dist）与 data/raw
rsync_args+=(--exclude='apps/web/dist' --exclude='node_modules/.vite')
if [[ "$INCLUDE_RAW" -eq 0 ]]; then
  rsync_args+=(--exclude='data/raw')
fi
if [[ "$NO_GIT" -eq 1 ]]; then
  rsync_args+=(--exclude='.git')
fi

print "• 正在复制项目（排除运行时产物）……"
rsync "${rsync_args[@]}" "$PROJECT_DIR/" "$stage/"
if [[ $? -ne 0 ]]; then
  print "✗ 复制失败。"
  read -k 1 "?按回车退出……"
  exit 1
fi

print "• 正在压缩（大文件约需数分钟）……"
tar -czf "$out" -C "$tmp" xzq-platform
if [[ $? -ne 0 ]]; then
  print "✗ 压缩失败。"
  read -k 1 "?按回车退出……"
  exit 1
fi

size_mb="$(du -m "$out" | awk '{print $1}')"
[[ "$INCLUDE_RAW" -eq 1 ]] && raw_note="已包含" || raw_note="未包含（默认，平台运行不需要）"
[[ "$NO_GIT" -eq 1 ]] && git_note="已剔除（同事无法 git 同步）" || git_note="已保留（同事可 git 同步更新）"

print ""
print "========================================"
print "  打包完成 ✓"
print "  文件：$out"
print "  大小：约 ${size_mb} MB"
print "  内容：代码 + .git（$git_note）+ 已入库数据（不含 node_modules）"
print "        data/raw：$raw_note"
print "  交付：把该文件发给同事，解压后用「请先阅读_同事电脑使用说明.md」"
print "========================================"
print ""
read -k 1 "?按回车退出……"
