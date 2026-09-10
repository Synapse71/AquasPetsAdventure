#!/usr/bin/env python
"""从 GPT Image 2 的原图重建两套骰面素材。

    ~/.venvs/idle-art/bin/python tools/dice_build.py

输入 assets/ui-prototype/dice/raw/：
    grid-A.png      四宫格，左上→右下依次是 1/2/3/4 点
    face-5.png      单面 5 点
    face-6.png      单面 6 点
输出：
    dice/face-{1..6}.png    512×512 透明 PNG，给平面切面动画用
    dice/cube/cube-{1..6}.png  240×240 不透明，给 CSS 立方体贴面用

两条必须守住的规矩：
1. 六个面**各自**归一化到同一输出边长——不能共用一个缩放系数。face-1..4 来自
   1024 的半图、face-5/6 来自 2048 全图，共用系数会让骰身大小差一倍。
2. 立方体贴图要把圆角外的透明区填成描边色。否则六个面拼起来棱边会露出背景。
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets/ui-prototype/dice/raw"
OUT = ROOT / "assets/ui-prototype/dice"

CANVAS = 512          # 平面素材画布
SIDE = int(CANVAS * 0.88)   # 骰身边长，六面完全一致
CUBE_PX = 240         # 立方体贴图边长
BG_TOL = 14           # 与背景色的欧氏距离阈值


def cut_background(path: Path) -> Image.Image:
    """抠掉纯色背景。只从画布四边 flood fill，骰面内部万一有同色浅块也不会被误伤。"""
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    bg = np.median(a[:8].reshape(-1, 3), axis=0)
    near = np.sqrt(((a - bg) ** 2).sum(2)) < BG_TOL

    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    alpha = np.where(seen, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([np.asarray(im), alpha]), "RGBA")


def build_faces() -> None:
    """1..4 从四宫格切，5/6 是单张；各自归一化到同一骰身尺寸。"""
    sources = {}
    grid = cut_background(RAW / "grid-A.png")
    gw, gh = grid.width // 2, grid.height // 2
    for i, (c, r) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)], start=1):
        sources[i] = grid.crop((c * gw, r * gh, (c + 1) * gw, (r + 1) * gh))
    for f in (5, 6):
        sources[f] = cut_background(RAW / f"face-{f}.png")

    for f in range(1, 7):
        im = sources[f]
        box = im.split()[3].getbbox()
        # 骰子本就是正方形，直接压成正方形，消掉模型画不方的那 1-2px 误差
        body = im.crop(box).resize((SIDE, SIDE), Image.LANCZOS)
        canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        canvas.paste(body, ((CANVAS - SIDE) // 2, (CANVAS - SIDE) // 2), body)
        canvas.save(OUT / f"face-{f}.png")
        print(f"face-{f}.png  源框 {box[2]-box[0]}×{box[3]-box[1]} → 外接框 {canvas.split()[3].getbbox()}")


def edge_color() -> tuple:
    """从描边上采样棱边色，别硬编码。"""
    a = np.asarray(Image.open(OUT / "face-1.png").convert("RGBA"))
    strip = a[34:44, 200:250]
    opaque = strip[strip[:, :, 3] > 200][:, :3]
    return tuple(int(v) for v in np.median(opaque, axis=0))


def build_cube_faces() -> None:
    edge = edge_color()
    (OUT / "cube").mkdir(exist_ok=True)
    inset = (CANVAS - SIDE) // 2
    for f in range(1, 7):
        im = Image.open(OUT / f"face-{f}.png").convert("RGBA")
        body = im.crop((inset, inset, inset + SIDE, inset + SIDE))
        # 圆角外的透明区填成描边色，六面拼立方体时棱边才不露背景
        filled = Image.alpha_composite(Image.new("RGBA", body.size, edge + (255,)), body)
        filled.convert("RGB").resize((CUBE_PX, CUBE_PX), Image.LANCZOS).save(
            OUT / "cube" / f"cube-{f}.png")
    print(f"cube/cube-1..6.png  棱边色 #{edge[0]:02x}{edge[1]:02x}{edge[2]:02x}")


def qa_sheet() -> None:
    """品红印样：白边和被挖穿的洞在浅灰底上看不出来，必须用品红。"""
    cell = 300
    sheet = Image.new("RGB", (cell * 6, cell), (255, 0, 255))
    bad = 0
    for f in range(1, 7):
        im = Image.open(OUT / f"face-{f}.png").resize((cell, cell), Image.LANCZOS)
        sheet.paste(im, ((f - 1) * cell, 0), im)
        center = np.asarray(im)[110:190, 110:190, 3]
        if center.min() != 255:
            print(f"  ✗ face-{f} 骰面中心被抠穿了（最小 alpha {center.min()}）")
            bad += 1
    path = ROOT / "assets/loot/style-explore/dice-QA-magenta.png"
    sheet.save(path)
    print(f"品红印样 → {path.relative_to(ROOT)}" + ("" if not bad else f"  （{bad} 面有问题）"))


if __name__ == "__main__":
    build_faces()
    build_cube_faces()
    qa_sheet()
