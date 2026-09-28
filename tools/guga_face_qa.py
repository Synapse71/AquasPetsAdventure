#!/usr/bin/env python3
"""咕嘎头像构图体检：用角色专属色块（黄色尖喙 / 白色眼圈 / 黑色头套）定位脸，
量化「脸是不是画面主体、有没有居中」。Vision 人脸检测在戴墨镜或眯眼时会检不到，
所以用喙的色块兜底——喙永远长在脸上，它的重心可以当脸的锚点。

用法: unset PYTHONPATH && ~/.venvs/idle-art/bin/python tools/guga_face_qa.py <图片...>
"""
import json
import sys

from PIL import Image

BEAK = lambda r, g, b: r > 170 and g > 140 and b < 130 and r >= g and (r - b) > 60
PATCH = lambda r, g, b: r > 215 and g > 215 and b > 215


def stats(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    step = max(1, w // 512)  # 抽样，2048 图也够快
    beak, patch = [], []
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if BEAK(r, g, b):
                beak.append((x, y))
            elif PATCH(r, g, b):
                patch.append((x, y))
    out = {"file": path.split("/")[-1], "size": [w, h]}
    for name, pts in (("beak", beak), ("whitepatch", patch)):
        if not pts:
            out[name] = None
            continue
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        out[name] = {
            "cx_offset_pct": (cx / w - 0.5) * 100,
            "cy_offset_down_pct": (cy / h - 0.5) * 100,
            "w_pct": (max(xs) - min(xs)) / w * 100,
            "h_pct": (max(ys) - min(ys)) / h * 100,
            "area_pct": len(pts) / (len(range(0, w, step)) * len(range(0, h, step))) * 100,
            "centroid_px": [round(cx), round(cy)],
        }
    return out


if __name__ == "__main__":
    print(json.dumps([stats(p) for p in sys.argv[1:]], ensure_ascii=False, indent=2))
