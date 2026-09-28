#!/usr/bin/env python3
"""把一段动画的关键帧拼成「节拍表」，用来肉眼/多模态检查动作节拍与首尾衔接。

    unset PYTHONPATH && ~/.venvs/idle-art/bin/python tools/clip_beat_sheet.py win-chest
    ... [--beats 12] [--out assets/gugugaga/_reviews/win-chest-beats.png]

产出：接触表 PNG（每格标帧号）+ 打印首/尾帧与站立锚点的差异（外接框、重心、非透明面积占比）。
首尾帧由锚点图钉死，所以这两个数应该很小；中间帧才是动作本身。
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ANCHOR = ROOT / "assets/gugugaga/anchor-front-standing.png"
FONTS = ["/System/Library/Fonts/Supplemental/Songti.ttc",
         "/System/Library/Fonts/Hiragino Sans GB.ttc"]


def stats(path, background=None):
    """background='white' 时按「非白像素」估剪影（锚点图是 960×960 不透明白底，没有 alpha）。"""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    if background == "white":
        rgb = im.convert("RGB")
        mask = [1 if min(px) < 240 else 0 for px in rgb.getdata()]
    else:
        mask = [1 if v > 40 else 0 for v in im.getchannel("A").tobytes()]
    xs = [i % w for i, v in enumerate(mask) if v]
    ys = [i // w for i, v in enumerate(mask) if v]
    if not xs:
        return {"size": [w, h], "bbox": None, "cx": None, "foot_y": None, "cover": 0.0}
    bbox = [min(xs), min(ys), max(xs) + 1, max(ys) + 1]
    return {"size": [w, h], "bbox": bbox, "cx": round((bbox[0] + bbox[2]) / 2 / w, 4),
            "foot_y": round(bbox[3] / h, 4), "cover": round(sum(mask) / len(mask), 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--beats", type=int, default=12)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    frames = sorted((ROOT / "assets/gugugaga" / a.clip / "frames").glob("frame_*.png"))
    assert frames, f"没有找到 {a.clip} 的帧"
    n = len(frames)
    picks = [round(i * (n - 1) / (a.beats - 1)) for i in range(a.beats)]
    cell, bar, gap, cols = 300, 34, 8, 4
    rows = (len(picks) + cols - 1) // cols
    font = next((ImageFont.truetype(p, 20) for p in FONTS if Path(p).exists()), ImageFont.load_default())
    sheet = Image.new("RGB", (cols * cell + (cols + 1) * gap, rows * (cell + bar) + (rows + 1) * gap), "#dcd9d2")
    draw = ImageDraw.Draw(sheet)
    for i, idx in enumerate(picks):
        im = Image.open(frames[idx]).convert("RGBA")
        tile = Image.new("RGB", im.size, "white")
        tile.paste(im, (0, 0), im)
        tile.thumbnail((cell, cell), Image.LANCZOS)
        x = gap + (i % cols) * (cell + gap)
        y = gap + (i // cols) * (cell + bar + gap)
        sheet.paste(tile, (x + (cell - tile.width) // 2, y + (cell - tile.height) // 2))
        draw.rectangle([x, y + cell, x + cell, y + cell + bar], fill="#141414")
        draw.text((x + 10, y + cell + 6), f"f{idx:03d}", fill="white", font=font)
    out = Path(a.out) if a.out else ROOT / f"assets/gugugaga/_reviews/{a.clip}-beats.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)

    report = {"clip": a.clip, "frames": n, "sheet": str(out.relative_to(ROOT)), "beats": {}}
    for idx in sorted(set(picks + [0, n - 1])):
        report["beats"][f"f{idx:03d}"] = stats(frames[idx])
    if ANCHOR.exists():
        base = stats(ANCHOR, background="white")
        report["anchor"] = base
        for key in ("f000", f"f{n - 1:03d}"):
            s = report["beats"][key]
            report.setdefault("vs_anchor", {})[key] = {
                "cx_delta": round((s["cx"] or 0) - (base["cx"] or 0), 4),
                "foot_delta": round((s["foot_y"] or 0) - (base["foot_y"] or 0), 4),
                "cover_delta": round(s["cover"] - base["cover"], 4),
            }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
