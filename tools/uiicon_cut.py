#!/usr/bin/env python3
"""四宫格图标切分 + 抠图 + 外接圆归一化 + 多尺寸验收图。

坑位见 ASSETS-HANDOFF.md 第 4、5 节：
- 模型有时把每个图标画在各自的浅灰面板上、面板间留白缝，必须先裁进面板再抠；
- 圆形/小尺寸场景下按**外接圆**归一化，不是外接框，否则细长形状显小、方形显大；
- 按重心居中时画布必须由外接圆半径反推，否则会裁掉一角。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loot_matte import matte
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy import ndimage

R = 256
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

def panel_crop(q):
    a = np.asarray(q).astype(int)
    m = ~(a > 246).all(2)
    if m.sum() == 0: return q
    ys, xs = np.where(m)
    if (xs.max() - xs.min()) < q.width * 0.95:
        return q.crop((xs.min() + 6, ys.min() + 6, xs.max() - 5, ys.max() - 5))
    return q

def norm(ic, k=1.0):
    ic = ic.crop(ic.getbbox())
    m = np.asarray(ic)[:, :, 3] > 128
    cy, cx = ndimage.center_of_mass(m)
    ys, xs = np.where(m)
    rad = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max()
    s = R * 0.99 * k / rad
    n = ic.resize((max(1, int(ic.width * s)), max(1, int(ic.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (2 * R, 2 * R), (0, 0, 0, 0))
    out.alpha_composite(n, (int(R - cx * s), int(R - cy * s)))
    return out

def cut_sheet(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size; hw, hh = w // 2, h // 2
    boxes = [(0, 0, hw, hh), (hw, 0, w, hh), (0, hh, hw, h), (hw, hh, w, h)]
    return [norm(matte(panel_crop(im.crop(b)))) for b in boxes]

def contact(items, out, sizes=(18, 26, 40), zoom=9):
    f = ImageFont.truetype(FONT, 17)
    G = 20; CELL = max(sizes) * zoom
    W = 90 + G + (CELL + G) * len(items)
    H = G + sum(s * zoom + G for s in sizes) + 32
    sh = Image.new("RGB", (W, H), (240, 241, 245)); d = ImageDraw.Draw(sh); y = G
    for s in sizes:
        d.text((14, y + s * zoom // 2), f"{s}px", font=f, fill=(90, 90, 90), anchor="lm")
        for j, (_, ic) in enumerate(items):
            c = ic.copy(); c.thumbnail((s, s), Image.LANCZOS)
            big = c.resize((c.width * zoom, c.height * zoom), Image.NEAREST)
            sh.paste(big, (90 + G + j * (CELL + G) + (CELL - big.width) // 2, y), big)
        y += s * zoom + G
    for j, (t, _) in enumerate(items):
        d.text((90 + G + j * (CELL + G) + CELL // 2, y + 2), t, font=f, fill=(40, 40, 40), anchor="ma")
    sh.save(out); print("saved", out, sh.size)
