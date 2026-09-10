#!/usr/bin/env python3
"""桌宠动画中间帧体检：找跳变、循环缝、抠图碎片。

    ~/.venvs/idle-art/bin/python tools/anim_qa.py            # 全部九段
    ~/.venvs/idle-art/bin/python tools/anim_qa.py walk --sheet

生成手法是「固定首尾帧」：首尾帧由锚点图钉死，模型只补中间。
所以首尾帧一定是对的，**要查的只有中间帧**。

### 四项检查

  跳变    相邻帧的重心位移 / 面积变化 / 脚底位移超过阈值。
  循环缝  循环段（walk / sleep-loop）首尾帧必须咬得上，否则播起来一顿一顿。
  碎片    面积占比 >0.5% 的独立连通域，**只报数不判失败**（理由见下）。

### 阈值是怎么定的（重要，别当成绝对标准）

**没有已知的坏样本。** 现存九段全部通过过人工验收，所以阈值只能按
「已知好样本的上界 + 余量」来定：实测九段的逐帧最大值是
位移 5.2% / 面积 5.4% / 脚底 2.4%，阈值取约 1.5 倍。

这意味着：**这个脚本只能抓比现有最差情况还差得多的崩坏，抓不了轻微瑕疵。**
轻微的还得靠 `--sheet` 出接触表用眼睛看。等哪天真出现一段崩掉的动画，
把它的数值填回来重新标定，检出力才会真正上去。

### 为什么碎片只报数不判失败

`sleep-loop` 全部 110 帧都有 5 个连通域——那不是 rembg 残留，
是画面上方的 Zzz 睡眠气泡；win-chest / lose-bag 右上角那块是特效符号。
**设计元素和抠图残留在几何上分不开**，硬判会满屏假警报。
真正的 rembg 残留特征是逐帧闪烁、位置飘忽，看接触表比看数字快。

### 为什么判据是「不连续」而不是「偏离基线」

第一版用「躯干宽相对首尾基线的比例」测形变，九段里报了七段——全是假警报。
原因：动作本身就会改变躯干带的内容。win-chest 开箱要弯腰，
躯干带 55%~85% 那一条测到的是手臂和箱子，算出 105% 的「形变」，
可它是验收过的成品。

**动作是平滑地偏离基线，模型画崩才是跳变。** 所以只看逐帧一阶差分。
24fps 下相邻帧变化极小（实测九段位移中位数都在 0.22% 画布宽以内），
一旦某两帧之间蹦出个大台阶，那里就是崩的地方。

报出来的帧要重出，改不了——中间帧是模型生成的，本地没法修。
"""
import argparse, glob, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = "idle-magnifier idle-digging start-explore walk sleep-start sleep-loop sleep-end win-chest lose-bag".split()
LOOPING = {"walk", "sleep-loop"}          # 首尾必须无缝相接的段

# 阈值 = 现存九段实测上界（位移 5.2 / 面积 5.4 / 脚底 2.4）× 约 1.5 倍余量。
# 改这几个数之前先读上面「阈值是怎么定的」。
HARD_MOVE, HARD_AREA, HARD_FEET = 8.0, 8.0, 4.0
FRAG_MIN = 0.005                          # 连通域面积占比下限，低于此算噪点不计
SEAM_MOVE, SEAM_AREA = 1.0, 3.0           # 循环缝容差


def measure(path):
    a = np.asarray(Image.open(path).convert("RGBA"))[..., 3]
    m = a > 60
    if not m.any():
        return None
    rows, cols = np.where(m.any(1))[0], np.where(m.any(0))[0]
    return dict(cx=(cols[0] + cols[-1]) / 2, area=float(m.sum()),
                feet=rows[-1], mask=m)


def fragments(m):
    """面积占比 >FRAG_MIN 的连通域个数。只作参考，不判失败——见模块头。"""
    try:
        from scipy import ndimage
    except ImportError:
        return None
    lab, n = ndimage.label(m)
    if n <= 1:
        return n
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    return int((sizes / m.sum() > FRAG_MIN).sum())


def check(clip, sheet=False):
    files = sorted(glob.glob(os.path.join(ROOT, "assets/gugugaga", clip, "frames/frame_*.png")))
    if not files:
        print(f"✗ {clip:<16} 没有帧")
        return 1
    ms = [measure(f) for f in files]
    if any(m is None for m in ms):
        print(f"✗ {clip:<16} 有全透明的空帧")
        return 1

    W, H = Image.open(files[0]).size
    cx = np.array([m["cx"] for m in ms])
    ar = np.array([m["area"] for m in ms])
    ft = np.array([m["feet"] for m in ms])

    dmove = np.diff(cx) / W * 100
    darea = np.diff(ar) / np.maximum(ar[:-1], 1) * 100
    dfeet = np.diff(ft) / H * 100

    problems = []
    for name, d, hard in [("位移跳变", dmove, HARD_MOVE), ("面积跳变", darea, HARD_AREA),
                          ("脚底跳变", dfeet, HARD_FEET)]:
        idx = np.where(np.abs(d) > hard)[0]
        if len(idx):
            worst = idx[np.argmax(np.abs(d[idx]))]
            problems.append(f"{name} {len(idx)} 处，最差在 frame_{worst:03d}→{worst+1:03d} "
                            f"（{d[worst]:+.1f}%）")

    # 碎片只报数：设计元素（Zzz、特效）和 rembg 残留在几何上分不开
    frag = [i for i, m in enumerate(ms) if (f := fragments(m["mask"])) and f > 1]

    if clip in LOOPING:
        seam_m = abs(cx[-1] - cx[0]) / W * 100
        seam_a = abs(ar[-1] - ar[0]) / max(ar[0], 1) * 100
        if seam_m > SEAM_MOVE or seam_a > SEAM_AREA:
            problems.append(f"循环缝：首尾差 位移 {seam_m:.1f}% / 面积 {seam_a:.1f}%")

    tag = "✓" if not problems else "✗"
    extra = f"  碎片 {len(frag)}/{len(files)} 帧" if frag else ""
    if clip in LOOPING:
        extra += f"  循环缝 {abs(cx[-1]-cx[0])/W*100:.2f}%"
    print(f"{tag} {clip:<16} {len(files):>3} 帧  "
          f"位移 max {np.abs(dmove).max():>4.1f}%  面积 max {np.abs(darea).max():>4.1f}%  "
          f"脚底 max {np.abs(dfeet).max():>4.1f}%{extra}")
    for p in problems:
        print(f"    · {p}")

    if sheet:
        step = max(1, len(files) // 12)
        picks = list(range(0, len(files), step))[:12]
        cw = 200
        ch = cw * H // W
        out = Image.new("RGB", (cw * 6, ch * 2), (255, 0, 255))   # 品红底，破洞和碎片一眼可见
        for i, fi in enumerate(picks):
            im = Image.open(files[fi]).convert("RGBA").resize((cw, ch))
            bg = Image.new("RGB", (cw, ch), (255, 0, 255))
            bg.paste(im, mask=im.split()[3])
            out.paste(bg, ((i % 6) * cw, (i // 6) * ch))
        p = os.path.join(ROOT, "assets/gugugaga", clip, "_qa-sheet.png")
        out.save(p)
        print(f"    接触表 → {os.path.relpath(p, ROOT)}")
    return 1 if problems else 0


# ── 眨眼检测 ────────────────────────────────────────────────
# 眼部 ROI（960×902 帧坐标），虹膜是蓝灰色，闭眼被眼睑盖住时暗色像素骤减。
# ⚠️ 固定 ROI 只对「角色基本不动」的待机段有效。低头 / 转头时虹膜也会离开 ROI，
#    看起来和闭眼一样——所以靠**持续时长**区分：眨眼极短，遮挡会持续。
EYE_ROI = (385, 320, 580, 400)
EYE_DROP = 0.40         # 虹膜占比掉到中位数的这个比例以下算「眼睛没了」
BLINK_MAX_FRAMES = 8    # 24fps 下 8 帧 = 0.33s，比这更久就不是眨眼


def iris_ratio(path):
    a = np.asarray(Image.open(path).convert("RGBA").crop(EYE_ROI)).astype(int)
    rgb, al = a[..., :3], a[..., 3]
    lum = rgb.mean(2)
    return float(((al > 100) & (lum > 55) & (lum < 150)).mean())


def blinks(clip):
    files = sorted(glob.glob(os.path.join(ROOT, "assets/gugugaga", clip, "frames/frame_*.png")))
    v = np.array([iris_ratio(p) for p in files])
    med = np.median(v)
    if med <= 0:
        return None
    low = v < med * EYE_DROP
    runs, i = [], 0
    while i < len(low):
        if low[i]:
            j = i
            while j + 1 < len(low) and low[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    quick = [r for r in runs if r[1] - r[0] + 1 <= BLINK_MAX_FRAMES]
    slow = [r for r in runs if r[1] - r[0] + 1 > BLINK_MAX_FRAMES]
    return dict(med=med, runs=runs, blink=quick, held=slow, n=len(files))


def report_blinks(clip):
    b = blinks(clip)
    if not b:
        print(f"  {clip}: 眼部区域测不到")
        return
    print(f"{clip:<16} {b['n']} 帧  虹膜中位 {b['med']:.3f}  "
          f"眨眼 {len(b['blink'])} 次" + (f"  长时间遮挡 {len(b['held'])} 段" if b['held'] else ""))
    for s, e in b["blink"]:
        print(f"    · f{s:03d}~f{e:03d}（{e-s+1} 帧 / {(e-s+1)/24*1000:.0f}ms）")
    for s, e in b["held"]:
        print(f"    · 遮挡 f{s:03d}~f{e:03d}（{e-s+1} 帧）——可能是低头或闭眼过久，不算眨眼")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="*")
    ap.add_argument("--sheet", action="store_true", help="额外输出品红底接触表")
    ap.add_argument("--eyes", action="store_true", help="额外报告眨眼次数与时长（仅对待机段有意义）")
    a = ap.parse_args()
    clips = a.clips or CLIPS
    bad = sum(check(c, a.sheet) for c in clips)
    if a.eyes:
        print()
        for c in clips:
            report_blinks(c)
    print(f"\n{'✓ 全部通过' if not bad else f'✗ {bad} 段有可疑中间帧'}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
