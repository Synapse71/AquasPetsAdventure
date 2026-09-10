#!/usr/bin/env python3
"""战利品图标抠图验收：把所有图标铺在品红底上，9 个一组输出接触印样。

为什么必须用品红：抠图挖穿的洞在浅灰底或成品稀有度底色上，
和物体自身的浅色高光长得一模一样，肉眼分辨不出来。
品红不会出现在任何物品的固有色里，破洞会立刻跳出来。

用法: python3 tools/loot_qa_sheets.py
依赖: pillow (venv)
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets/loot")
IC, OUT = os.path.join(ROOT, "icons"), os.path.join(ROOT, "style-explore")
MAGENTA, CELL, COLS, PER = (255, 0, 255), 340, 3, 9
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"

NAMES = {
 "cloth-strip":"布条","paper":"纸张","glass-shard":"玻璃碎片","rubber-block":"橡胶块",
 "wood-strip":"木条","hemp-rope":"麻绳","fur":"毛皮","iron-sheet":"铁片","keycap":"键帽",
 "bulb":"灯泡","spring":"弹簧","screw":"螺丝","nail":"钉子","battery":"电池","magnet":"磁铁",
 "bearing":"轴承","gear":"齿轮","wire-cable":"电线","scissors":"剪刀","screwdriver":"螺丝刀",
 "tape-measure":"卷尺","duct-tape":"胶带","wrench":"扳手","hammer":"锤子","plastic-cup":"塑料杯子",
 "soda-can":"易拉罐","empty-bottle":"空塑料瓶","poop":"便便","old-newspaper":"旧报纸","ceramic-shard":"碎瓷片",
 "chocolate":"巧克力","canned-food":"罐头","coffee-beans":"咖啡豆","honey":"蜂蜜","red-wine":"红酒",
 "thermos":"保温杯","electric-razor":"电动剃须刀","umbrella":"雨伞","hair-dryer":"电吹风",
 "desk-lamp":"台灯","cast-iron-pan":"铸铁锅","f1-model":"F1赛车模型","plush-toy":"毛绒玩偶",
 "jigsaw-puzzle":"拼图","toy-drone":"玩具无人机","fishing-rod":"专业钓竿","rugby-ball":"橄榄球",
 "skateboard":"滑板","dumbbell":"哑铃","car-tire":"汽车轮胎",
 "smartwatch":"智能手表","noise-cancelling-headphones":"降噪耳机","game-controller":"游戏手柄",
 "digital-camera":"数码相机","tablet":"平板电脑","portable-speaker":"便携音箱","camera-drone":"航拍无人机",
 "mechanical-keyboard":"机械键盘","black-truffle":"黑松露","caviar":"鱼子酱","red-velvet-cake":"红丝绒蛋糕",
 "whisky":"威士忌","bluefin-tuna":"蓝鳍金枪鱼块","titanium-ring":"钛合金戒指","enamel-brooch":"珐琅胸针",
 "silver-bracelet":"银手镯","cloisonne-ornament":"景泰蓝摆件","fountain-pen":"精品钢笔",
 "mechanical-watch":"机械腕表","binoculars":"望远镜","cracked-core":"碎裂核心",
 "gold-necklace":"黄金项链","violin":"小提琴","graphics-card":"游戏显卡","turntable":"黑胶唱机",
 "diamond-earrings":"钻石耳钉","leather-handbag":"真皮手袋","aged-whisky":"陈年威士忌",
 "telephoto-lens":"单反长焦镜头","laptop":"笔记本电脑","telescope":"天文望远镜",
}
TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]


def collect():
    out = []
    for t in TIERS:
        d = os.path.join(IC, t)
        if os.path.isdir(d):
            out += [(t, f[:-4]) for f in sorted(os.listdir(d)) if f.endswith(".png")]
    return out


def white_border_scan(items):
    """检出"深色描边外面又套一圈白色模切边"的图标。

    这个缺陷按整张四宫格随机发生，正常图标该指标 <10%，中招的是 100%。
    在浅灰底或成品底色上极难用肉眼发现，必须靠这个指标。
    """
    bad = []
    for tier, iid in items:
        a = np.asarray(Image.open(os.path.join(IC, tier, iid + ".png")).convert("RGBA")).astype(int)
        al = a[:, :, 3] > 128
        ring = al & ~ndimage.binary_erosion(al, iterations=6)
        if ring.sum() < 200:
            continue
        ratio = (a[:, :, :3].mean(2)[ring] > 235).mean()
        if ratio > 0.5:
            bad.append((tier, iid, ratio))
    return bad


def main():
    items = collect()
    bad = white_border_scan(items)
    if bad:
        print("!! 检出白色模切边，需重出所在的整张四宫格：")
        for t, i, r in bad:
            print("     %-10s %-28s 外缘近白占比 %.0f%%" % (t, i, r * 100))
    else:
        print("白边检测：通过")
    f_name, f_tier = ImageFont.truetype(FONT, 17), ImageFont.truetype(FONT, 13)
    G, LH = 14, 40
    rows = PER // COLS
    W = G + (CELL + G) * COLS
    H = G + (CELL + LH + G) * rows
    n = 0
    for s in range(0, len(items), PER):
        n += 1
        sheet = Image.new("RGB", (W, H), (247, 247, 247))
        d = ImageDraw.Draw(sheet)
        for i, (tier, iid) in enumerate(items[s:s + PER]):
            r, c = divmod(i, COLS)
            x, y = G + c * (CELL + G), G + r * (CELL + LH + G)
            d.rectangle([x, y, x + CELL - 1, y + CELL - 1], fill=MAGENTA)
            ic = Image.open(os.path.join(IC, tier, iid + ".png"))
            ic.thumbnail((int(CELL * 0.82),) * 2, Image.LANCZOS)
            sheet.paste(ic, (x + (CELL - ic.width) // 2, y + (CELL - ic.height) // 2), ic)
            d.text((x + CELL // 2, y + CELL + 4), NAMES.get(iid, iid), font=f_name,
                   fill=(40, 40, 40), anchor="ma")
            d.text((x + CELL // 2, y + CELL + 24), f"{tier} / {iid}", font=f_tier,
                   fill=(130, 130, 130), anchor="ma")
        p = os.path.join(OUT, f"_品红验收-{n:02d}.png")
        sheet.save(p)
        print("saved", os.path.basename(p))
    print(f"{len(items)} 件 / {n} 张")


if __name__ == "__main__":
    main()
