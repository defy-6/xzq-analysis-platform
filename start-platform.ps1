# ============================================================
# 厦漳泉都市圈综合分析平台：Windows 启动程序
# 由 启动平台.bat 双击调用，行为与 macOS 版 启动平台.command 一致：
#   后台守护运行（窗口关闭后平台仍运行）、重复双击不重复启动、
#   运行日志持久化、端口被占用时自动解析真实地址并打开浏览器。
# ============================================================

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir     = Join-Path $ProjectDir 'apps\web'
$LogDir     = Join-Path $ProjectDir '运行日志'
$FrontendLog = Join-Path $LogDir 'frontend.log'
$FrontendErr = Join-Path $LogDir 'frontend.err.log'
$PidFile    = Join-Path $LogDir 'frontend.pid'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Write-Host ""
Write-Host "========================================"
Write-Host "  厦漳泉都市圈综合分析平台"
Write-Host "  正在检查并启动平台……"
Write-Host "========================================"
Write-Host ""

function Test-Url([string]$url) {
  # Windows 10 1803+ 自带 curl.exe；老系统退回 Invoke-WebRequest
  try {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      & curl.exe -fsS --max-time 2 $url *> $null
      return ($LASTEXITCODE -eq 0)
    } else {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      return ($r.StatusCode -eq 200)
    }
  } catch {
    return $false
  }
}

# vinext 启动时会输出 Local 地址；端口 3000 被占用时它会自动改用下一端口，
# 因此必须从本项目日志解析真实地址，而不是写死 3000。
function Get-PlatformUrl {
  if (-not (Test-Path $FrontendLog)) { return $null }
  return (Select-String -Path $FrontendLog -Pattern 'http://localhost:\d+/' -AllMatches |
          ForEach-Object { $_.Matches.Value } |
          Select-Object -Last 1)
}

# 通过命令行匹配判断本平台是否已在运行（避免误判其他项目的 node 服务）
function Test-PlatformRunning {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.CommandLine -match 'start_web\.mjs' } |
       Select-Object -First 1
  return ($null -ne $p)
}

# 已在运行则直接打开浏览器
if (Test-PlatformRunning) {
  $url = Get-PlatformUrl
  if (-not $url) { $url = 'http://localhost:3000/' }
  Write-Host "OK  平台已在运行，直接打开：$url"
  Start-Process $url
  Write-Host ""
  exit 0
}

# Node.js 检查
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "X  未找到 Node.js，请先安装 Node.js（>= 22.13）：https://nodejs.org/"
  Write-Host ""
  exit 1
}

# 包管理器检查：统一使用 pnpm（与仓库锁文件 pnpm-lock.yaml 一致）
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Host "X  未找到 pnpm，请先安装：npm install -g pnpm"
  Write-Host ""
  exit 1
}

# 首次运行、依赖缺失、或 git pull 更新了 lockfile 时安装/同步前端依赖。
# 跨系统协作：mac 与 Windows 各自维护 node_modules，lockfile 变化时必须重装，
# 否则 vite 优化缓存会引用旧的 pnpm 哈希路径，启动后页面报 Failed to resolve import。
function Test-NeedsInstall {
  if (-not (Test-Path (Join-Path $WebDir 'node_modules\.bin\vinext.cmd'))) { return $true }
  $lock      = Join-Path $WebDir 'pnpm-lock.yaml'
  $installed = Join-Path $WebDir 'node_modules\.modules.yaml'
  if (-not (Test-Path $lock) -or -not (Test-Path $installed)) { return $true }
  return ((Get-Item $lock).LastWriteTime -gt (Get-Item $installed).LastWriteTime)
}

if (Test-NeedsInstall) {
  Write-Host "o  依赖需安装/更新（首次运行或 lockfile 已变化），正在 pnpm install……"
  Push-Location $WebDir
  & $pnpm.Source install 2>&1 | Out-File -Append -Encoding utf8 $FrontendLog
  $installExit = $LASTEXITCODE
  Pop-Location
  if ($installExit -ne 0) {
    Write-Host "X  前端依赖安装失败，请查看：$FrontendLog"
    Write-Host ""
    exit 1
  }
}

# 启动平台（后台守护，窗口关闭后仍运行；日志落盘）
Write-Host "o  正在启动平台……"
$proc = Start-Process -FilePath $node.Source `
  -ArgumentList 'scripts/start_web.mjs' `
  -WorkingDirectory $WebDir `
  -RedirectStandardOutput $FrontendLog `
  -RedirectStandardError $FrontendErr `
  -WindowStyle Hidden -PassThru
$proc.Id | Out-File -Encoding ascii $PidFile

# 等待服务就绪：从日志解析真实地址并探测
$url = $null
for ($i = 0; $i -lt 60; $i++) {
  $candidate = Get-PlatformUrl
  if ($candidate -and (Test-Url $candidate)) { $url = $candidate; break }
  Start-Sleep -Seconds 1
}

if (-not $url) {
  Write-Host "X  平台启动失败（60 秒内未就绪），请查看：$FrontendLog"
  if (Test-Path $FrontendLog) { Get-Content $FrontendLog -Tail 30 | ForEach-Object { Write-Host $_ } }
  if (Test-Path $FrontendErr)  { Get-Content $FrontendErr  -Tail 30 | ForEach-Object { Write-Host $_ } }
  Write-Host ""
  exit 1
}

Start-Process $url

Write-Host ""
Write-Host "========================================"
Write-Host "  平台已启动：$url"
Write-Host "  运行日志：$LogDir"
Write-Host "  此窗口关闭后平台仍会继续运行。"
Write-Host "  如需停止：taskkill /PID $(Get-Content $PidFile) /F"
Write-Host "========================================"
Write-Host ""
