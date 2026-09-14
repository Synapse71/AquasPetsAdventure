#!/usr/bin/env python3
"""白底视频 → 对齐到 960×902 的透明帧。`video2sprite.py` 的轻量替代。

    ~/.venvs/idle-art/bin/python tools/video2frames.py <输入.mp4> <段名>
    ... <输入.mp4> <段名> --strip x0,y0,x1,y1      # 先抹掉画面里的道具

### 什么时候用这个，什么时候用 video2sprite

`video2sprite.py` 走 rembg（通用抠图模型，几百 MB + 模型下载），
是为背景不干净的早期素材写的。**如果视频背景本来就是纯白/浅灰**——
现在用固定首尾帧 + 「背景纯白」提示词生成的都是——那用不着模型：
四角 floodfill 吃掉外部背景，再取主连通域即可，快且没有 alpha 薄雾问题。

rembg 不在 `~/.venvs/idle-art` 里（venv 重建过）。装它之前先想想需不需要。

### --strip：把生成时当参照物的道具抹掉

灯泡这类「必须纹丝不动、而且要能点」的元素要做成 UI 组件叠在画布上，
但**生成视频时得把它画进锚点图**——模型需要视觉参照，
否则「让角色看向右上方的空气」出来的动作会飘（见 skill）。

所以生成完要把它抹回背景色。`--strip` 接原始视频坐标系里的矩形，
在缩放裁切之前处理：用首帧在该矩形内取最大非白连通域当 mask，逐帧抹白。

抹之前会自动验两件事并打印：
  - **mask 内有没有角色像素**：有就说明角色会走到道具前面，整块抹会挖掉角色
  - **每帧与首帧在 mask 内的差异**：道具自己变形/位移时这个值会跳
    （`bulb-point` 原片 f54 灯泡缩到约 75%，差异 58%——但因为要整块抹掉，不影响）

### 画布对齐（这条最容易做错）

九段成品是 **960×902**，而生成出来的视频是正方形。缩放 + 裁切必须让新段和
九段落在同一个画布坐标系里，否则切换动画角色会跳。

对齐基准是**九段成品帧的脚底**（`idle-magnifier` 首帧实测 y=852），不是锚点图：
锚点 960×960 里角色 y 82~898，而成品首帧 y 45~852——角色高度差了 9px（约 1%），
那是模型生成的正常波动。照搬锚点的裁切参数会偏 9px。

所以：等比缩到 960 宽 → 量出本段首帧的脚底 → 反推 top 使脚底落在 852。
"""
import argparse, glob, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from pet_matte import clean_edges

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 960, 902
FEET_Y = 852            # 九段成品帧的脚底基准，实测自 idle-magnifier/frames/frame_000.png
BG_TOL = 26             # floodfill 容差；背景是纯白/极浅灰，给足余量吃掉抗锯齿
SHADOW_BAND = 90        # 从最低点往上多少像素内找地面阴影
SHADOW_LUM = (150, 252)  # 阴影明度区间：比黑衣亮得多，比纯白暗一点
SHADOW_NEUTRAL = 22     # 通道极差小于此视为中性灰（企鹅脚是黄色，不会中招）


def build_prop_mask(first_path, rect):
    """在给定矩形内，用首帧取最大非白连通域当道具 mask。膨胀几像素吃掉抗锯齿边。"""
    a = np.asarray(Image.open(first_path).convert("RGB")).astype(int)
    sub = a[rect[1]:rect[3], rect[0]:rect[2]]
    nw = (255 - sub).max(2) > 26
    if not nw.any():
        sys.exit(f"✗ --strip 矩形内是空的：{rect}")
    lab, n = ndimage.label(nw)
    sizes = ndimage.sum(nw, lab, range(1, n + 1))
    mask = lab == (int(np.argmax(sizes)) + 1)
    return ndimage.binary_dilation(mask, iterations=3)


def audit_prop_mask(files, rect, mask, outdir):
    """抹之前先看清楚：角色会不会进 mask、道具自己动没动。

    **只报告，不自动终止。** 「mask 内的深色像素」这个判据分不开
    「角色的黑衣」和「道具自身的深色描边」——灯泡那次，被标出来的 3.23%
    全是螺纹灯头的深灰描边，真按 2% 阈值硬退出，正确的用法也被挡了。
    所以这里把可疑帧渲成一张标记图（品红 = 判为角色），交给人看一眼。
    """
    ref = np.asarray(Image.open(files[0]).convert("RGB")).astype(int)[rect[1]:rect[3], rect[0]:rect[2]]
    worst_char, worst_frame, worst_diff = 0, 0, 0
    for i, p in enumerate(files):
        sub = np.asarray(Image.open(p).convert("RGB")).astype(int)[rect[1]:rect[3], rect[0]:rect[2]]
        r, b = sub[..., 0], sub[..., 2]
        charcoal = (sub.max(2) < 95) & ((r - b) < 45) & mask
        if charcoal.sum() > worst_char:
            worst_char, worst_frame = int(charcoal.sum()), i
        worst_diff = max(worst_diff, int(((np.abs(sub - ref).max(2) > 60) & mask).sum()))
    tot = int(mask.sum())
    print(f"  道具 mask {tot} px：疑似角色侵入最多 {worst_char} px（{worst_char/tot*100:.2f}%，f{worst_frame}）、"
          f"道具自身最大变化 {worst_diff/tot*100:.1f}%")

    if worst_char > tot * 0.005:
        sub = np.asarray(Image.open(files[worst_frame]).convert("RGB")).astype(int)
        crop = sub[rect[1]:rect[3], rect[0]:rect[2]].copy()
        r, b = crop[..., 0], crop[..., 2]
        crop[(crop.max(2) < 95) & ((r - b) < 45) & mask] = [255, 0, 255]
        os.makedirs(outdir, exist_ok=True)
        p = os.path.join(outdir, "_strip-audit.png")
        Image.fromarray(crop.astype("uint8")).save(p)
        print(f"  ⚠️ 看一眼 {os.path.relpath(p, ROOT)}：品红标的是判为角色的像素。")
        print(f"     如果那些其实是道具自己的深色描边（灯泡的螺纹灯头就是），可以放心抹；")
        print(f"     如果真是角色的翅膀/头发伸进来了，整块抹会挖掉角色，得换逐帧处理。")


def content_rows(im):
    a = np.asarray(im.convert("RGB")).astype(int)
    m = (255 - a).max(2) > 26
    r = np.where(m.any(1))[0]
    return r[0], r[-1]


def drop_shadow(rgba):
    """清掉脚下那块烘焙的地面椭圆阴影。

    floodfill + 主连通域去不掉它——阴影跟脚是连通的，会被当成角色的一部分留下。
    九段成品脚下是干净的（实测脚底带残留 17%，新段不处理是 30%），必须补这一步。

    判据是「贴着脚底 + 中性灰 + 中高明度」：角色的黑衣太暗、企鹅脚是黄色、
    白肚皮离脚底远超这个带，三者都不会误伤。
    """
    a = np.asarray(rgba).astype(int)
    al = a[..., 3]
    soli = al > 60
    if not soli.any():
        return rgba
    feet = np.where(soli.any(1))[0][-1]
    top = max(0, feet - SHADOW_BAND)
    band = a[top:feet + 1, :, :3]
    r, g, b = band[..., 0], band[..., 1], band[..., 2]
    lum = band.mean(2)
    neutral = (band.max(2) - band.min(2)) < SHADOW_NEUTRAL
    shadow = neutral & (lum > SHADOW_LUM[0]) & (lum < SHADOW_LUM[1])
    new_al = al.copy()
    sub = new_al[top:feet + 1, :]
    sub[shadow] = 0
    new_al[top:feet + 1, :] = sub
    out = rgba.copy()
    out.putalpha(Image.fromarray(new_al.astype("uint8")))
    return out


def matte(im):
    """四角 floodfill 去外部背景 → 主连通域隔离（掉落的碎片、残留一并去掉）。"""
    q = im.convert("RGB")
    w, h = q.size
    f = q.copy()
    for c in [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2)]:
        ImageDraw.floodfill(f, c, (255, 0, 255), thresh=BG_TOL)
    a = np.asarray(f)
    outer = (a[..., 0] == 255) & (a[..., 1] == 0) & (a[..., 2] == 255)
    solid = ~outer
    lab, n = ndimage.label(solid)
    if n > 1:                                   # 只留最大的一块，碎片丢掉
        sizes = ndimage.sum(solid, lab, range(1, n + 1))
        solid = lab == (np.argmax(sizes) + 1)
    out = q.convert("RGBA")
    out.putalpha(Image.fromarray(np.where(solid, 255, 0).astype("uint8")))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("clip", help="段名，产出到 assets/gugugaga/<段名>/frames/")
    ap.add_argument("--feet", type=int, default=FEET_Y)
    ap.add_argument("--crop-top", type=int, help="固定裁切起点（缩到 960 宽后）；用于已按现用帧补白的首尾锚点，避免再次按脚底重定位")
    ap.add_argument("--keep-shadow", action="store_true", help="保留脚下地面阴影（默认清除）")
    ap.add_argument('--clean-edges', action='store_true', help='抠图后恢复边缘透明过渡与去白底残色；另存 frames-clean，不覆盖 frames')
    ap.add_argument("--strip", metavar="x0,y0,x1,y1",
                    help="先抹掉画面里的道具（原始视频坐标系），用于灯泡这类要做成 UI 组件的元素")
    a = ap.parse_args()

    outdir = os.path.join(ROOT, "assets/gugugaga", a.clip, "frames-clean" if a.clean_edges else "frames")
    os.makedirs(outdir, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        subprocess.run(["ffmpeg", "-v", "error", "-i", a.video, f"{td}/f_%04d.png", "-y"],
                       check=True)
        raw = sorted(glob.glob(f"{td}/f_*.png"))
        if not raw:
            sys.exit("✗ ffmpeg 没拆出帧")

        mask = None
        if a.strip:
            rect = tuple(int(v) for v in a.strip.split(","))
            if len(rect) != 4:
                sys.exit("✗ --strip 需要 x0,y0,x1,y1")
            mask = build_prop_mask(raw[0], rect)
            audit_prop_mask(raw, rect, mask, os.path.dirname(outdir))
            for p in raw:                       # 就地抹白，后面照常缩放裁切
                im = Image.open(p).convert("RGB")
                arr = np.asarray(im).copy()
                sub = arr[rect[1]:rect[3], rect[0]:rect[2]]
                sub[mask] = 255
                arr[rect[1]:rect[3], rect[0]:rect[2]] = sub
                Image.fromarray(arr).save(p)
            print(f"  已抹掉 {rect} 内的道具")

        # 先按首帧定裁切：等比缩到 960 宽，让脚底落在基准线上。
        # ⚠️ 脚底必须用**处理完**（抠图 + 去地面阴影）的首帧来量。
        #    早先直接量原始像素的最低点，那个点是地面阴影的底边，
        #    去掉阴影后角色整体比基准高了 6px——和老九段并排播会看到跳动。
        first = Image.open(raw[0])
        scaled_h = round(first.height * W / first.width)
        probe = first.resize((W, scaled_h), Image.LANCZOS)
        probe = matte(probe)
        if not a.keep_shadow:
            probe = drop_shadow(probe)
        pa = np.asarray(probe)[..., 3] > 60
        if not pa.any():
            sys.exit("✗ 首帧抠完是空的")
        bot_c = int(np.where(pa.any(1))[0][-1])
        top = a.crop_top if a.crop_top is not None else bot_c - a.feet
        if top < 0 or top + H > scaled_h:
            sys.exit(f"✗ 裁切越界：脚底 {bot_c} 需要 top={top}，但缩放后只有 {scaled_h}px 高")
        print(f"缩放 {first.width}→{W}，首帧脚底 {bot_c} → 裁 crop(0,{top},{W},{top+H})，输出脚底={bot_c-top}")

        for i, p in enumerate(raw):
            im = Image.open(p).resize((W, scaled_h), Image.LANCZOS).crop((0, top, W, top + H))
            out = matte(im)
            if not a.keep_shadow:
                out = drop_shadow(out)
            if a.clean_edges:
                out = clean_edges(out)
            out.save(os.path.join(outdir, f"frame_{i:03d}.png"))

    fs = sorted(glob.glob(os.path.join(outdir, "frame_*.png")))
    chk = Image.open(fs[0])
    assert chk.mode == "RGBA" and chk.size == (W, H), f"产出规格不对：{chk.mode} {chk.size}"
    al = np.asarray(chk)[..., 3] > 60
    rows, cols = np.where(al.any(1))[0], np.where(al.any(0))[0]
    print(f"✓ {len(fs)} 帧 → {os.path.relpath(outdir, ROOT)}")
    print(f"  首帧角色 y {rows[0]}~{rows[-1]}（脚底基准 {a.feet}）  x {cols[0]}~{cols[-1]}")


if __name__ == "__main__":
    main()
