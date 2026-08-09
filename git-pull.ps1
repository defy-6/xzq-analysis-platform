# ============================================================
# 厦漳泉都市圈综合分析平台：一键拉取（GitHub → 本地）
# 由「一键拉取.bat」双击调用；也可手动执行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\git-pull.ps1
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

Write-Host ""
Write-Host "========================================"
Write-Host "  一键拉取：从 GitHub 同步最新代码到本地"
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

Write-Host "o  正在从 origin 拉取……"
git pull
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "X  拉取失败。可能原因：网络无法连接 GitHub、存在合并冲突或未提交的改动。"
  Write-Host "   请重试；若提示冲突，可先提交或暂存本地改动后再运行。"
  Read-Host "按回车退出"
  exit 1
}

# 跨系统协作：mac 与 Windows 各自维护 node_modules，
# pull 后若 lockfile 变化则自动重装依赖，避免启动时依赖不同步报错。
$WebDir = Join-Path $ProjectDir 'apps\web'
function Test-NeedsInstall {
  if (-not (Test-Path (Join-Path $WebDir 'node_modules\.bin\vinext.cmd'))) { return $true }
  $lock      = Join-Path $WebDir 'pnpm-lock.yaml'
  $installed = Join-Path $WebDir 'node_modules\.modules.yaml'
  if (-not (Test-Path $lock) -or -not (Test-Path $installed)) { return $true }
  return ((Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime)
}

if (Test-NeedsInstall) {
  Write-Host "o  依赖有更新（lockfile 已变化），正在安装前端依赖……"
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $pnpm) {
    Write-Host "X  未找到 pnpm，请先安装：npm install -g pnpm"
    Read-Host "按回车退出"
    exit 1
  }
  Push-Location $WebDir
  & $pnpm.Source install
  $installExit = $LASTEXITCODE
  Pop-Location
  if ($installExit -ne 0) {
    Write-Host "X  依赖安装失败，请重试或检查网络。"
    Read-Host "按回车退出"
    exit 1
  }
  Write-Host "o  依赖安装完成"
} else {
  Write-Host "o  依赖无变化，无需安装"
}

Write-Host ""
Write-Host "========================================"
Write-Host "  拉取完成 ✓"
Write-Host "========================================"
Write-Host ""
Read-Host "按回车退出"
