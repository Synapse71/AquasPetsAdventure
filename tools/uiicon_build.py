#!/usr/bin/env python3
"""桌宠 UI 按钮图标：抠图 → 归一化 → 验收图。

两个关键点，改之前先读：

1) 模型会把每个图标画在**各自的浅灰面板上、面板间留白缝**。
   抠图必须先按面板边界裁进去，否则四角 flood fill 只吃掉白缝，把灰面板当成物体。

2) 圆形按钮里"看起来多满"由**离重心的最远半径**决定，不是外接框。
   按外接框归一化会让细长形状（三角旗）显小、方形显大；
   而且按重心居中时若画布不够大会把图形裁掉一角。
   这里统一按"外接圆"归一化：每个图标缩放到最远半径 = R×k，画布边长恒为 2R，
   于是所有图标共用同一个外接圆，CSS 里的百分比才是真的百分比。
   k 是视觉体量补偿：齿轮这类密实形状略微收一点，免得比别人重。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loot_matte import matte
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from scipy import ndimage

D = "assets/ui-prototype/icons"
NAMES = ["status", "bag", "flag", "gear"]
CN = ["状态·信息卡", "背包", "行动·三角旗", "设置·齿轮"]
R = 256                      # 外接圆半径 → 画布 512
K = {"status": 1.00, "bag": 1.00, "flag": 1.00, "gear": 0.94}   # 密实形状收一点


def panel_crop(q):
    a = np.asarray(q).astype(int)
    ys, xs = np.where(~(a > 246).all(2))
    return q.crop((xs.min() + 6, ys.min() + 6, xs.max() - 5, ys.max() - 5))


def norm(ic, k):
    ic = ic.crop(ic.getbbox())
    m = np.asarray(ic)[:, :, 3] > 128
    cy, cx = ndimage.center_of_mass(m)
    ys, xs = np.where(m)
    rad = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2).max()
    s = (R * k) / rad
    w, h = max(1, int(ic.width * s)), max(1, int(ic.height * s))
    n = ic.resize((w, h), Image.LANCZOS)
    out = Image.new("RGBA", (2 * R, 2 * R), (0, 0, 0, 0))
    out.alpha_composite(n, (int(R - cx * s), int(R - cy * s)))
    return out


def bubble(ic, bs, ratio):
    S = bs * 8
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([0, 0, S - 1, S - 1], fill=(255, 255, 255, 255), outline=(25, 28, 34, 30), width=max(1, S // 64))
    t = ic.copy(); t.thumbnail((int(S * ratio),) * 2, Image.LANCZOS)
    im.alpha_composite(t, ((S - t.width) // 2, (S - t.height) // 2))
    return im


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else "v2"
    sheet = Image.open(f"{D}/sheet-{ver}.png").convert("RGB")
    W, H = sheet.size; hw, hh = W // 2, H // 2
    quads = [sheet.crop(b) for b in [(0, 0, hw, hh), (hw, 0, W, hh), (0, hh, hw, H), (hw, hh, W, H)]]
    ics = []
    for n, q in zip(NAMES, quads):
        ic = norm(matte(panel_crop(q)), K[n])
        ic.save(f"{D}/{n}.png"); ics.append(ic)

    print("%-8s %-9s %s" % ("图标", "外接圆", "被裁?"))
    for n, ic in zip(NAMES, ics):
        a = np.asarray(ic)[:, :, 3] > 128
        ys, xs = np.where(a)
        rad = np.sqrt((xs - R) ** 2 + (ys - R) ** 2).max()
        clipped = xs.min() <= 0 or ys.min() <= 0 or xs.max() >= 2 * R - 1 or ys.max() >= 2 * R - 1
        print("%-8s %6.1f%%   %s" % (n, rad / R * 100, "是！" if clipped else "否"))

    f = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 17)
    RS = [0.82, 0.92, 1.00]; G = 22; CELL = 32 * 8
    Wd = 110 + G + (CELL + G) * 4; Ht = G + len(RS) * (32 * 8 + G) + 10
    sh = Image.new("RGB", (Wd, Ht), (236, 238, 242)); d = ImageDraw.Draw(sh); y = G
    for r in RS:
        d.text((14, y + 32 * 4), f"{int(r*100)}%", font=f, fill=(90, 90, 90), anchor="lm")
        for j, ic in enumerate(ics):
            b = bubble(ic, 32, r); sh.paste(b, (110 + G + j * (CELL + G), y), b)
        y += 32 * 8 + G
    sh.save(f"{D}/_图标占比对比-32px.png")
    print("对比图", sh.size)


if __name__ == "__main__":
    main()
