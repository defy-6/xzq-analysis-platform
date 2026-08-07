# ============================================================
# 厦漳泉都市圈综合分析平台：一键推送（本地 → GitHub）
# 流程：git add -A → 输入提交说明 → commit → 先 pull 合并远程 → push
# 由「一键推送.bat」双击调用；也可手动执行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\git-push.ps1
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

Write-Host ""
Write-Host "========================================"
Write-Host "  一键推送：本地改动提交并推送到 GitHub"
Write-Host "========================================"
Write-Host ""

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Host "X  未找到 git，请先安装 Git for Windows：https://git-scm.com/"
  Read-Host "按回车退出"
  exit 1
}

$branch = git rev-parse --abbrev-ref HEAD 2>$null
if (-not $branch) {
  Write-Host "X  当前目录不是有效的 git 仓库（或不在分支上）。"
  Read-Host "按回车退出"
  exit 1
}
Write-Host "o  当前分支：$branch"

# 1) 检查是否有改动
$changes = (git status --porcelain) | Out-String
if ([string]::IsNullOrWhiteSpace($changes)) {
  Write-Host "o  没有未提交的改动，无需推送。"
  Read-Host "按回车退出"
  exit 0
}
Write-Host "o  检测到以下改动："
Write-Host ($changes.Trim())
Write-Host ""

# 2) 暂存并提交
Write-Host "o  正在暂存全部改动……"
git add -A
if ($LASTEXITCODE -ne 0) {
  Write-Host "X  暂存失败。"
  Read-Host "按回车退出"
  exit 1
}

$msg = Read-Host "请输入提交说明（直接回车使用默认）"
if ([string]::IsNullOrWhiteSpace($msg)) {
  $msg = "自动提交 $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
  Write-Host "X  提交失败。"
  Read-Host "按回车退出"
  exit 1
}

# 3) 先拉取合并远程更新，避免推送被拒
Write-Host "o  先拉取远程更新（自动合并）……"
git pull
if ($LASTEXITCODE -ne 0) {
  Write-Host "X  与远程合并失败，可能产生冲突。请处理冲突后重新运行一键推送。"
  Read-Host "按回车退出"
  exit 1
}

# 4) 推送
Write-Host "o  正在推送到 GitHub……"
git push
if ($LASTEXITCODE -ne 0) {
  Write-Host "X  推送失败。若是登录问题，请完成 GitHub 登录窗口后再试。"
  Read-Host "按回车退出"
  exit 1
}

Write-Host ""
Write-Host "========================================"
Write-Host "  推送完成 ✓"
Write-Host "========================================"
Write-Host ""
Read-Host "按回车退出"
