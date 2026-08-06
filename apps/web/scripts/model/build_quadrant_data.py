from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


PLATFORM_ROOT = Path(__file__).resolve().parents[4]
SOURCE = PLATFORM_ROOT / "data" / "processed" / "contact-quadrants" / "current-model" / "model-results.json"
OUT = Path(__file__).resolve().parents[2] / "public" / "data" / "quadrant-analysis.json"


def main():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    rows = source["rows"]
    quadrant_counts = {
        str(quadrant): sum(row["quadrant"] == quadrant for row in rows)
        for quadrant in range(1, 5)
    }
    payload = {
        "meta": {
            "source": SOURCE.name,
            "sourceFolder": SOURCE.parent.name,
            "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "pairCount": len(rows),
            "highAbsoluteCount": sum(row["absolute_level"] == "高" for row in rows),
            "crossCityCount": sum(row["flow_type"] == "跨市区县流动" for row in rows),
            "withinCityCount": sum(row["flow_type"] == "市内流动" for row in rows),
            "quadrantCounts": quadrant_counts,
            "populationSourceRows": source.get("meta", {}).get("population_source_rows"),
            "distanceSource": source.get("meta", {}).get("distance_source"),
            "distanceDefinition": source.get("meta", {}).get("distance_definition"),
            "method": "优化引力模型标准化残差四象限；距离采用区县政府驻地双向驾车平均里程，企业综合残差按分支、投资、专利子模型R²归一化加权；企业三类子模型额外引入区县对级「功能强度指数」（商业用地占比、中心功能指数、建设用地POI密度 z-score 合成），人口流动子模型保持原口径。",
            "extensionVariables": source.get("meta", {}).get("extension_variables"),
        },
        "weights": source["weights"],
        "params": source["params"],
        "rows": rows,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        json.dumps(
            {
                "output": str(OUT),
                "size": OUT.stat().st_size,
                **payload["meta"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
