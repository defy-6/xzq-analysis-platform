# 网站应用

这里是“厦漳泉都市圈综合分析平台”的网页应用。

当前“区域联系网络”正式功能包含：

- 企业关系：投资、分支、专利；
- 人口流动：区县、镇街两级 OD；
- 联系象限：人口流动联系与企业联系协同类型。
- 交通可达性：区县与乡镇街政府驻地驾车时间、距离、过路费和双向联系。

其他一级模块：

- 用地分析：28区县开发强度、功能结构、混合度与区位熵；
- 公共服务设施：230个POI中类的区县数量分布与结构比较。

网页读取 `public/data/` 下的接口文件。原始数据不放入网页目录，由 `scripts/` 中的数据生成程序从平台根目录的 `data/` 读取。

## 启动

可直接双击平台根目录的 `启动平台.command`，也可以进入本目录后运行：

```bash
pnpm web
```

## 重建数据

依次运行：

```bash
python3 scripts/build_data.py
python3 scripts/build_population_data.py
python3 scripts/build_transport_data.py
python3 scripts/rebuild_quadrant_with_driving_distance.py
python3 scripts/build_quadrant_data.py
python3 scripts/build_land_public_data.py
```
