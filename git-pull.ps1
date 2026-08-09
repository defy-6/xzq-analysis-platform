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

# git 检查：缺失时自动下载便携版 MinGit 到项目内 .runtime\git（免安装、免管理员、不污染系统）
# 下载源：GitHub releases 官方优先，ghproxy 国内代理兜底（GitHub 直连慢时用）
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  $rt = Join-Path $ProjectDir '.runtime'
  $gitDir = Join-Path $rt 'git'
  $gitExe = Join-Path $gitDir 'cmd\git.exe'
  if (-not (Test-Path $gitExe)) {
    Write-Host "o  未找到 git，正在自动下载便携版（MinGit，约 45MB）……"
    $ver = '2.47.1'
    $zip = Join-Path $env:TEMP "MinGit-$ver.zip"
    $ok = $false
    foreach ($prefix in @('https://github.com/git-for-windows/git/releases/download', 'https://mirror.ghproxy.com/https://github.com/git-for-windows/git/releases/download')) {
      $url = "$prefix/v$ver/MinGit-$ver-64-bit.zip"
      Write-Host "o  下载 $url"
      & curl.exe -L --fail --silent --show-error -o $zip $url
      if ($LASTEXITCODE -eq 0 -and (Test-Path $zip) -and (Get-Item $zip).Length -gt 1MB) { $ok = $true; break }
    }
    if (-not $ok) {
      Write-Host "X  自动下载 git 失败（网络不通？）。请手动安装 Git for Windows：https://git-scm.com/ 后重试。"
      Read-Host "按回车退出"
      exit 1
    }
    New-Item -ItemType Directory -Force -Path $rt | Out-Null
    Expand-Archive -Path $zip -DestinationPath $gitDir -Force
    Remove-Item -Force $zip
  }
  if (Test-Path $gitExe) {
    Write-Host "o  已就绪 git（便携版，位于 $gitDir）"
    $env:Path = "$gitDir\cmd;$env:Path"
    $git = Get-Command git -ErrorAction SilentlyContinue
  }
}
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
  # pnpm 检查：项目 lockfile 为 v9.0，需 pnpm >= 9；缺失或过旧时自动安装新版
  function Get-UsablePnpm {
    $p = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($p) {
      $v = (& $p.Source --version 2>$null | Select-Object -First 1)
      if ($v -match '^(\d+)' -and [int]$matches[1] -ge 9) { return $p }
    }
    return $null
  }
  $pnpm = Get-UsablePnpm
  if (-not $pnpm) {
    $oldPnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($oldPnpm) {
      $oldV = (& $oldPnpm.Source --version 2>$null | Select-Object -First 1)
      Write-Host "o  系统 pnpm 版本过旧（$oldV，需 >= 9），正在安装新版……"
    } else {
      Write-Host "o  未找到 pnpm，正在安装……"
    }
    Write-Host "o  尝试 npm install -g pnpm@latest（国内镜像）……"
    & npm install -g pnpm@latest --registry=https://registry.npmmirror.com/
    $pnpm = Get-UsablePnpm
    if (-not $pnpm) {
      Write-Host "o  npm 安装未生效，尝试 corepack……"
      $env:COREPACK_NPM_REGISTRY = 'https://registry.npmmirror.com/'
      & corepack enable pnpm
      $pnpm = Get-UsablePnpm
    }
    if (-not $pnpm) {
      Write-Host "X  自动安装 pnpm 失败。可手动执行：npm install -g pnpm 后重试。"
      Read-Host "按回车退出"
      exit 1
    }
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
