#!/usr/bin/env python3
"""把 assets/gugugaga/<段>/frames/ 打包成原型能直接内嵌的动画 WebP。

用法:
    ~/.venvs/idle-art/bin/python tools/pet_clip.py walk [更多段名...]
    ~/.venvs/idle-art/bin/python tools/pet_clip.py walk --width 240 --step 3

为什么要有这个：九段动画的母版是 960×902 的 PNG 帧（每段约 40 MB），
原型里塞不下，得抽帧 + 缩放 + 编码。参数必须和已经内嵌进原型的那份对齐，
否则同一个桌宠在不同状态下会忽大忽小。

对齐口径（改之前先想清楚）：
  - 宽 240px。九段共用 960×902 画布，缩放系数一律 240/960 = 0.25，高恒为 226px。
    **绝不能按各自的 alpha 包围盒归一化**——那样切换动画角色会跳。
  - 横向对位默认**不做**，母版的落点是设计的一部分（见下面 ANCHOR_CX）。
    只有把某段单独拿来原地播放时才加 --align。
  - 每 3 帧取 1，帧时长 125ms。母版 24fps，抽完等于 8fps，
    和 pet-menu.html 里那份待机动画速度一致。
  - RGBA 无损关闭 + quality 60。透明通道必须留住，桌宠是悬浮在桌面上的。

产出写到 assets/gugugaga/<段>/clip-<宽>.webp，并打印 base64 体积，
方便估算内嵌进原型后的页面大小。
"""
import argparse, base64, glob, io, os, sys
import numpy as np
from PIL import Image
from pet_matte import clean_edges

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANVAS_W = 960          # 九段母版共用的画布宽，缩放系数由它算，不看单帧内容

# 横向对位基准 = idle-magnifier 的躯干中心中位数（实测 476/960）。
#
# ⚠️ 各段落点不同**多数是设计，不是缺陷**。九段用「固定首尾帧」生成，
#    首尾帧钉在哪，那一段就落在哪：
#      start-explore  首 480 → 尾 358   角色从画面中心走向左侧
#      walk           首尾都是 400      接着 start-explore 的落点在左侧循环
#    把 walk 平移回中心，这条衔接链就断了。
#
# 所以 --align 默认关闭。只有在「把某段单独拿出来原地播放」时才需要——
# 比如桌宠头顶进度条那个场景，行进中角色应当待在原位，这时才用对齐版。
# lose-bag 是另一回事：首尾帧都在 480，中间帧漂到 553，那是真漂移。
ANCHOR_CX = 476
DEADZONE = 24           # 偏移小于这个值就不动——躺姿等情况下躯干带测量本身不可靠


def torso_center(path):
    """躯干带的水平中心。只取 55%~85% 画布高，避开镐子、旗子这类伸出去的道具。"""
    a = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    m = a > 60
    band = m[int(.55 * m.shape[0]):int(.85 * m.shape[0])]
    c = np.where(band.any(0))[0]
    return (c[0] + c[-1]) / 2


def content_bounds(files):
    """整段动画所有帧的内容左右边界，平移量要 clamp 在这个范围内才不裁掉东西。"""
    lo, hi = CANVAS_W, 0
    for p in files:
        a = np.asarray(Image.open(p).convert("RGBA"))[..., 3]
        c = np.where((a > 20).any(0))[0]
        lo, hi = min(lo, c[0]), max(hi, c[-1])
    return lo, hi


def align_dx(clip, files):
    cx = float(np.median([torso_center(p) for p in files[::5]]))
    dx = ANCHOR_CX - cx
    if abs(dx) < DEADZONE:
        return 0, cx
    lo, hi = content_bounds(files)
    clamped = int(round(max(-lo, min(CANVAS_W - 1 - hi, dx))))
    if clamped != round(dx):
        print(f"  · {clip}: 需右移 {dx:+.0f}px，但画布余量只够 {clamped:+d}px，"
              f"按余量取（残差 {dx - clamped:+.0f}px）")
    return clamped, cx


def build(clip, width, step, quality, align=False, clean=False):
    src = os.path.join(ROOT, "assets/gugugaga", clip, "frames")
    files = sorted(glob.glob(os.path.join(src, "frame_*.png")))
    if not files:
        sys.exit(f"✗ {clip}: {src} 下没有帧")

    dx, cx = align_dx(clip, files) if align else (0, float("nan"))

    picked = files[::step]
    frames = []
    for p in picked:
        im = Image.open(p)
        if im.mode != "RGBA":                      # PIL 会把 alpha 优化掉，显式转
            im = im.convert("RGBA")
        if im.width != CANVAS_W:
            sys.exit(f"✗ {clip}: {os.path.basename(p)} 宽 {im.width} ≠ 母版 {CANVAS_W}，"
                     "画布不一致就不能共用缩放系数")
        if clean:
            im = clean_edges(im)
        if dx:
            shifted = Image.new("RGBA", im.size, (0, 0, 0, 0))
            shifted.paste(im, (dx, 0))             # 画布尺寸不变，只挪内容
            im = shifted
        h = round(im.height * width / CANVAS_W)
        frames.append(im.resize((width, h), Image.LANCZOS))

    if frames[0].mode != "RGBA":
        sys.exit(f"✗ {clip}: 缩放后 alpha 丢了")

    suffix = "-aligned" if dx else ""
    if clean:
        suffix += "-clean"
    out = os.path.join(ROOT, "assets/gugugaga", clip, f"clip-{width}{suffix}.webp")
    frames[0].save(out, save_all=True, append_images=frames[1:],
                   duration=round(1000 * step / 24), loop=0,
                   quality=quality, lossless=False, method=6)

    # 存完立刻读回验 alpha——PIL 有把 RGBA 存成 RGB 的前科
    back = Image.open(out)
    if back.mode not in ("RGBA", "P"):
        sys.exit(f"✗ {clip}: 存出来是 {back.mode}，透明通道没了")
    if back.size != frames[0].size:
        sys.exit(f"✗ {clip}: 存出来 {back.size} ≠ {frames[0].size}")

    n = len(frames)
    note = f"  对位 {dx:+d}px" if dx else ("  无需对位" if align else "  原样落点")
    kb = os.path.getsize(out) / 1024
    print(f"✓ {clip:<16} {n:>3} 帧  {frames[0].size[0]}×{frames[0].size[1]}  "
          f"{round(1000 * step / 24)}ms/帧  {kb:>6.0f} KB{note}  → {os.path.relpath(out, ROOT)}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+", help="段名，如 walk idle-digging")
    ap.add_argument("--width", type=int, default=240)
    ap.add_argument("--step", type=int, default=3, help="每 N 帧取 1")
    ap.add_argument("--quality", type=int, default=60)
    ap.add_argument("--align", action="store_true",
                    help="横向对位到基准，产物带 -aligned 后缀。"
                         "只在把该段单独原地播放时用，会破坏与相邻段的衔接")
    ap.add_argument('--clean-edges', action='store_true', help='清除白底边缘残色；写到 -clean.webp，不覆盖已有 clip')
    a = ap.parse_args()
    for c in a.clips:
        build(c, a.width, a.step, a.quality, align=a.align, clean=a.clean_edges)


if __name__ == "__main__":
    main()
