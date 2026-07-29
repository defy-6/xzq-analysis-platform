# 厦漳泉都市圈综合分析平台

本目录集中管理网站、原始数据、处理成果和后续专题模块。“区域联系网络”下包含企业关系、人口流动、交通可达性和联系象限，后续可继续增加用地、公共服务设施等板块。

## 目录结构

```text
厦漳泉都市圈综合分析平台/
├── apps/
│   └── web/                         # 可视化网站
│       └── app/features/
│           ├── contact-network/     # 企业、人口流动与联系象限
│           └── transport-accessibility/ # 区县政府驾车可达性
├── data/
│   ├── raw/                         # 原始数据，只作为输入
│   │   ├── enterprise/
│   │   ├── population/
│   │   ├── spatial/
│   │   └── transport/               # 区县与后续镇街交通OD
│   ├── reference/                   # 行业、汇率、行政区名称等口径表
│   └── processed/                   # 模型结果和可复用处理成果
├── modules/                         # 后续专题的数据、方法与说明
│   ├── land-use/
│   ├── transport-accessibility/
│   └── public-services/
├── docs/                            # 项目级文档
└── 启动平台.command                 # 双击启动网站
```

## 使用方式

双击 `启动平台.command`。启动完成后，打开终端中显示的 Local 地址。

## 架构约定

- 原始数据只存放在 `data/raw/`，不与网页代码混放。
- 分类、汇率和行政区映射存放在 `data/reference/`。
- 模型结果及导出成果存放在 `data/processed/`。
- 每个新专题先在 `modules/` 建立自己的数据和方法说明，再在 `apps/web/app/features/` 建立对应网页功能。
- 网站可直接发布的数据继续生成到 `apps/web/public/data/`。
