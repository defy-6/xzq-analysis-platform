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

# 双击一键启动 = 重启到最新代码：若平台已在运行，先停止旧进程（含子进程树）再启动新实例
if (Test-PlatformRunning) {
  $p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.CommandLine -match 'start_web\.mjs' } |
       Select-Object -First 1
  Write-Host "o  检测到平台正在运行（PID $($p.ProcessId)），正在停止旧进程并重新启动……"
  # /T 连子进程树一起结束，避免端口残留；/F 强制
  & taskkill /PID $p.ProcessId /T /F 2>$null
  Start-Sleep -Seconds 2
}

# Node.js 检查：缺失时自动下载便携版到项目内 .runtime\node（免安装、免管理员、不污染系统）
# 下载源：官方 nodejs.org 优先，npmmirror 镜像兜底（国内更快）
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  $rt = Join-Path $ProjectDir '.runtime'
  $nodeDir = Join-Path $rt 'node'
  $nodeExe = Join-Path $nodeDir 'node.exe'
  if (-not (Test-Path $nodeExe)) {
    Write-Host "o  未找到 Node.js，正在自动下载便携版（约 30MB）……"
    $ver = 'v22.14.0'
    $zip = Join-Path $env:TEMP "node-$ver-win-x64.zip"
    $ok = $false
    foreach ($base in @('https://nodejs.org/dist', 'https://npmmirror.com/mirrors/node')) {
      $url = "$base/$ver/node-$ver-win-x64.zip"
      Write-Host "o  下载 $url"
      & curl.exe -L --fail --silent --show-error -o $zip $url
      if ($LASTEXITCODE -eq 0 -and (Test-Path $zip)) { $ok = $true; break }
    }
    if (-not $ok) {
      Write-Host "X  自动下载 Node.js 失败（网络不通？）。"
      Write-Host "   请手动安装 Node.js（>= 22.13）：https://nodejs.org/ 后重试。"
      Write-Host ""
      exit 1
    }
    New-Item -ItemType Directory -Force -Path $rt | Out-Null
    Expand-Archive -Path $zip -DestinationPath $rt -Force
    Remove-Item -Force $zip
    $unpacked = Get-ChildItem $rt -Directory | Where-Object { $_.Name -like 'node-v*-win-x64' } | Select-Object -First 1
    if ($unpacked) {
      if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
      Move-Item $unpacked.FullName $nodeDir
    }
  }
  if (Test-Path $nodeExe) {
    Write-Host "o  已就绪 Node.js（便携版，位于 $nodeDir）"
    $env:Path = "$nodeDir;$env:Path"
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
}
if (-not $node) {
  Write-Host "X  未找到 Node.js，请先安装 Node.js（>= 22.13）：https://nodejs.org/"
  Write-Host ""
  exit 1
}

# 包管理器检查：统一使用 pnpm（与仓库锁文件 pnpm-lock.yaml 一致）。
# 缺失时自动安装（corepack 优先，npm -g 兜底），让同事只需装 Node.js。
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Host "o  未找到 pnpm，正在自动安装（corepack）……"
  & corepack enable pnpm 2>$null
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
}
if (-not $pnpm) {
  Write-Host "o  corepack 不可用，尝试 npm install -g pnpm……"
  & npm install -g pnpm 2>$null
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
}
if (-not $pnpm) {
  Write-Host "X  自动安装 pnpm 失败。请先安装 Node.js（https://nodejs.org/）后重试，"
  Write-Host "   或手动执行：npm install -g pnpm"
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
