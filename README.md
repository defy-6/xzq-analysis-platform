# 厦漳泉都市圈综合分析平台

本目录集中管理网站、原始数据、处理成果和专题模块。现已包含"区域联系网络""联系象限""用地分析""公共服务设施"和"智能分析"五个一级板块；区域联系网络下包含企业关系、人口流动和交通可达性。

## 目录结构

```text
厦漳泉都市圈综合分析平台/
├── apps/
│   └── web/                         # 可视化网站
│       └── app/features/
│           ├── contact-network/     # 区域联系网络（企业关系、人口流动）
│           ├── contact-quadrants/   # 联系象限（引力模型四象限）
│           ├── transport-accessibility/ # 区县政府驾车可达性
│           ├── land-use/            # 区县用地结构与指标
│           ├── public-services/     # 区县POI中类设施
│           ├── ai-analysis/         # 智能分析（DeepSeek/通义千问 报告生成与数据问答）
│           └── mapkit/              # 共享地图基础设施（投影/标签/导出/底图）
├── data/
│   ├── raw/                         # 原始数据，只作为输入（不入库，需手动拷贝）
│   │   ├── enterprise/
│   │   ├── population/
│   │   ├── spatial/
│   │   ├── transport/               # 区县与后续镇街交通OD
│   │   ├── land-use/
│   │   └── public-services/
│   ├── reference/                   # 行业、汇率、行政区名称等口径表
│   └── processed/                   # 模型结果和可复用处理成果
├── modules/                         # 后续专题的数据、方法与说明
│   ├── ai-analysis/                 # 智能分析模块说明（数据摘要、API、Key 配置）
│   ├── land-use/
│   ├── transport-accessibility/
│   └── public-services/
├── docs/                            # 项目级文档
├── 启动平台.command                 # macOS 双击启动网站
├── 启动平台.bat                     # Windows 双击启动网站
└── start-platform.ps1               # Windows 实际启动逻辑（被 .bat 调用）
```

## 环境要求

> **首次将项目整体拷贝到新电脑（含原始数据）？请看 [docs/新电脑迁移指南.md](docs/新电脑迁移指南.md)。**

- **Node.js >= 22.13**（https://nodejs.org/）
- **pnpm**（`npm install -g pnpm`）
- Git（Windows 建议安装 Git for Windows）

## 使用方式

### macOS

双击 `启动平台.command`。启动完成后，打开终端中显示的 Local 地址。

### Windows

1. 安装 Node.js（>= 22.13）和 pnpm。
2. 双击 `启动平台.bat`，首次运行会自动安装前端依赖并启动平台。
3. 启动完成后会自动打开浏览器中的 Local 地址；窗口关闭后平台仍会在后台运行，停止方式见窗口内提示。

## Git 协作开发（GitHub）

仓库地址：`https://github.com/defy-6/xzq-analysis-platform.git`

### 一键 Git 同步（免命令行）

- **Windows**：双击 `一键拉取.bat`（GitHub → 本地，`git pull`）或 `一键推送.bat`（本地 → GitHub，自动 `git add -A` → 输入提交说明 → `git commit` → 先 `git pull` 合并远程 → `git push`）。
- **macOS**：双击 `一键拉取.command` / `一键推送.command`，行为与 Windows 版一致。首次双击无反应时先执行 `chmod +x 一键拉取.command 一键推送.command`。

```bash
# 克隆（首次）
git clone https://github.com/defy-6/xzq-analysis-platform.git

# 新功能在独立分支上开发
git checkout -b feature/xxx

# 提交并推送
git add .
git commit -m "描述改动"
git push -u origin feature/xxx

# 合回主分支（在 GitHub 上发起 Pull Request，或直接）
git checkout main
git pull
git merge feature/xxx
git push
```

协作约定：

- **换行符**：仓库已配置 `.gitattributes` 统一为 LF，Windows 上无需任何额外设置；请勿改动该文件。
- **包管理器**：统一使用 **pnpm**，锁文件为 `pnpm-lock.yaml`。不要提交 `package-lock.json` 等 npm 产物。
- **原始数据不入库**：`data/raw/`（约 800MB）被 `.gitignore` 排除，需要各人自行从数据持有者处拷贝到本机对应位置；`data/processed/`、`data/reference/` 及网页数据随仓库共享。
- **启动脚本**：`启动平台.command`（macOS）与 `启动平台.bat`/`start-platform.ps1`（Windows）行为一致：后台守护运行、重复双击不重复启动、运行日志写入 `运行日志/`（该目录不入库）。
- `.reasonix/`、`reasonix.toml` 是本地工具状态，不入库、不提交。

## 架构约定

- 原始数据只存放在 `data/raw/`，不与网页代码混放。
- 分类、汇率和行政区映射存放在 `data/reference/`。
- 模型结果及导出成果存放在 `data/processed/`。
- 每个新专题先在 `modules/` 建立自己的数据和方法说明，再在 `apps/web/app/features/` 建立对应网页功能。
- 网站可直接发布的数据继续生成到 `apps/web/public/data/`。

## 智能分析模块

- 平台第二大模块：基于五类数据与引力模型四象限，调用 DeepSeek / 通义千问 生成分析报告并支持追问；详见 [modules/ai-analysis/README.md](modules/ai-analysis/README.md)。
- AI 数据上下文由 `apps/web/scripts/build/build_ai_summary.mjs` 从各模块汇总 JSON 聚合生成（`apps/web/public/data/ai/summary.json`），数据更新后运行 `pnpm --dir apps/web build:ai-summary` 重新生成。
- API Key 仅存服务端：本地开发由系统环境变量（`DASHSCOPE_API_KEY` / `DEEPSEEK_API_KEY`）透传，生产部署在平台上配置同名 Secret。
