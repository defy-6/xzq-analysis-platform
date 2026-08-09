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
  print "✗ 未找到 git，请先安装 Xcode Command Line Tools（xcode-select --install）。"
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
  print ""
  print "✗ 拉取失败。可能原因：网络无法连接 GitHub、存在合并冲突或未提交的改动。"
  print "  请重试；若提示冲突，可先提交或暂存本地改动后再运行。"
  read -k 1 "?按回车退出……"
  exit 1
fi

print ""
print "========================================"
print "  拉取完成 ✓"
print "========================================"
print ""
read -k 1 "?按回车退出……"
