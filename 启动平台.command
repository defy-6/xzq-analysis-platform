#!/bin/zsh

cd "$(dirname "$0")/apps/web" || exit 1

NODE_DIR="/Users/defy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
export PATH="$NODE_DIR:$PATH"

echo "正在启动厦漳泉都市圈综合分析平台……"
echo "启动成功后，请打开终端中显示的 Local 地址（通常是 http://localhost:3000/）"
echo "停止网站请按 Control + C"
echo

pnpm web

echo
echo "网站已停止。按回车键关闭窗口。"
read
