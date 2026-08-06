from __future__ import annotations

import json
import sqlite3

from build_data import GPKG, OUT, gpkg_wkb, parse_geom, simplify, txt


def main():
    connection = sqlite3.connect(GPKG)
    features = []
    for code, name, blob in connection.execute('select XZQDM,XZQMC,geom from [设区市调查界线] order by XZQDM'):
        polygons = [[simplify(ring, 0.001) for ring in polygon] for polygon in parse_geom(gpkg_wkb(blob))]
        features.append({
            "type": "Feature",
            "properties": {"code": txt(code), "name": txt(name)},
            "geometry": {"type": "MultiPolygon", "coordinates": polygons},
        })
    connection.close()
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / "fujian-prefecture-boundaries.json"
    target.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("输出福建设区市背景", len(features), "个设区市", target)


if __name__ == "__main__":
    main()
