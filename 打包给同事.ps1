# ============================================================
# 厦漳泉都市圈综合分析平台：打包给同事（Windows 完整包）
# 在 Windows 上双击「打包给同事.bat」运行（需中文系统，中文排除项依赖代码页）。
#
# 为什么必须在 Windows 上打包：apps\web\node_modules 是平台相关二进制
# （Mac 装的依赖到 Windows 不可用），本脚本打包的是本机（Windows）的依赖。
#
# 产出：单文件 .tar.gz，含 代码 + .git + Windows 版 node_modules + 已入库数据。
# 同事拿到后：解压 → 配置 2 个 API Key → 双击「启动平台.bat」即可使用，
# 无需安装任何依赖。
#
# 参数：
#   -IncludeRaw   同时包含 data\raw（约 821MB 构建源数据；仅当同事需要重新构建数据时用）
#   -NoGit        剔除 .git（剔除后同事无法用 git 同步更新，只能等新包）
# ============================================================

param(
  [switch]$IncludeRaw,
  [switch]$NoGit
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

Write-Host ""
Write-Host "========================================"
Write-Host "  打包给同事（Windows 完整包）"
Write-Host "========================================"
Write-Host ""

# 1) 校验依赖已安装（Windows 版）
if (-not (Test-Path "apps\web\node_modules\.bin\vinext.cmd")) {
  Write-Host "X  依赖未安装：请先在 Windows 上运行「一键拉取.bat」或「启动平台.bat」"
  Write-Host "  完成依赖安装后再打包（Mac 的 node_modules 不能用于 Windows）。"
  Read-Host "按回车退出"
  exit 1
}

Write-Host "o  提示：打包前建议先运行「一键拉取.bat」，确保代码与依赖为最新版本。"
Write-Host "o  正在复制项目（排除运行时产物）……"

$stamp = Get-Date -Format "yyyyMMdd"
$outDir = Split-Path -Parent $ProjectDir
$out = Join-Path $outDir "xzq-platform-win-$stamp.tar.gz"
$tmp = Join-Path $env:TEMP ("xzq-pack-" + [guid]::NewGuid().ToString("N"))
$stage = Join-Path $tmp "xzq-platform"
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# robocopy 排除项（精确相对路径；不能裸名排除 dist，避免误删 node_modules 内部 dist）
$excludeDirs = @(
  "运行日志",
  ".pnpm-store",
  ".reasonix",
  "迁移打包",
  "apps\web\.wrangler",
  "apps\web\.vinext",
  "apps\web\dist",
  "apps\web\.next",
  "node_modules\.vite"
)
if (-not $IncludeRaw) { $excludeDirs += "data\raw" }
if ($NoGit) { $excludeDirs += ".git" }

& robocopy.exe $ProjectDir $stage /E "/XD" ($excludeDirs -join " ") "/XF" ".DS_Store" "Thumbs.db" /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) {
  Write-Host "X  复制失败（robocopy 退出码 $rc）"
  Remove-Item -Recurse -Force $tmp
  Read-Host "按回车退出"
  exit 1
}

Write-Host "o  正在压缩（大文件约需数分钟）……"
& tar.exe -czf $out -C $tmp xzq-platform
if ($LASTEXITCODE -ne 0) {
  Write-Host "X  压缩失败"
  Remove-Item -Recurse -Force $tmp
  Read-Host "按回车退出"
  exit 1
}
Remove-Item -Recurse -Force $tmp

if ($IncludeRaw) { $rawNote = "已包含" } else { $rawNote = "未包含（默认，平台运行不需要）" }
if ($NoGit) { $gitNote = "已剔除（同事无法 git 同步）" } else { $gitNote = "已保留（同事可 git 同步更新）" }
$sizeMB = [math]::Round((Get-Item $out).Length / 1MB, 1)

Write-Host ""
Write-Host "========================================"
Write-Host "  打包完成 ✓"
Write-Host "  文件：$out"
Write-Host "  大小：$sizeMB MB"
Write-Host "  内容：代码 + .git（$gitNote）+ Windows 版 node_modules + 已入库数据"
Write-Host "        data\raw：$rawNote"
Write-Host "  交付：把该文件发给同事，解压后用「请先阅读_同事电脑使用说明.md」"
Write-Host "========================================"
Write-Host ""
Read-Host "按回车退出"
