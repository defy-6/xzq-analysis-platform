#!/bin/zsh

# 厦漳泉都市圈综合分析平台：一键推送（本地 → GitHub）
# 流程：git add -A → 输入提交说明 → commit → 先 pull 合并远程 → push
# macOS 双击运行；若双击无反应，先执行一次：chmod +x "一键推送.command"

set -u

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

print ""
print "========================================"
print "  一键推送：本地改动提交并推送到 GitHub"
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

# 1) 检查是否有改动
changes="$(git status --porcelain)"
if [[ -z "$changes" ]]; then
  print "• 没有未提交的改动，无需推送。"
  read -k 1 "?按回车退出……"
  exit 0
fi
print "• 检测到以下改动："
print "$changes"
print ""

# 2) 暂存并提交
print "• 正在暂存全部改动……"
git add -A || {
  print "✗ 暂存失败。"
  read -k 1 "?按回车退出……"
  exit 1
}

print -n "请输入提交说明（直接回车使用默认）："
read msg
if [[ -z "$msg" ]]; then
  msg="自动提交 $(date '+%Y-%m-%d %H:%M')"
fi
git commit -m "$msg" || {
  print "✗ 提交失败。"
  read -k 1 "?按回车退出……"
  exit 1
}

# 3) 先拉取合并远程更新，避免推送被拒
print "• 先拉取远程更新（自动合并）……"
git pull || {
  print "✗ 与远程合并失败，可能产生冲突。请处理冲突后重新运行一键推送。"
  read -k 1 "?按回车退出……"
  exit 1
}

# 4) 推送
print "• 正在推送到 GitHub……"
git push || {
  print "✗ 推送失败。若是登录问题，请完成 GitHub 登录窗口后再试。"
  read -k 1 "?按回车退出……"
  exit 1
}

print ""
print "========================================"
print "  推送完成 ✓"
print "========================================"
print ""
read -k 1 "?按回车退出……"
