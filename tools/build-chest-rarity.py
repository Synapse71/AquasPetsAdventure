#!/usr/bin/env python3
"""稀有度开箱视频 → 探险面板能直接用的素材。

    "${IDLE_ART_PYTHON:-$HOME/.venvs/idle-art/bin/python}" tools/build-chest-rarity.py

输入是 6 段原片（assets/ui-prototype/chest/rarity-v1/<档>/take-1.mp4）：
HEVC 10bit、1142×1816、5.04s、合计约 25.5 MB，**背景是纯白**。
原片的画幅就是按开箱区做的（1142:1816 ≈ 0.629，开箱区约 0.60），
所以这里不裁切，整幅输出，由 CSS 拉伸铺满 `.ap-chest-stage`。

### 为什么不抠成透明

原片背景是纯白，探险面板底色也是白的，整幅铺上去就行，不需要抠图。

（试过抠成 alpha，记一笔免得以后再试一遍：数学上 α 只要 ≥「1 − min(RGB)/255」
就能在白底上逐像素还原原图，所以抠图本身不难；难的是光柱——它的芯是纯白的，
白等于 α=0，抠完在非白底上会变成一条**黑缝**。实测 512px 画布上白芯宽 40~60px，
靠邻域模糊去填要 σ>40，那已经把整段特效糊掉了。白底特效板的正确合成算子是
multiply 而不是 alpha over，所以哪天面板要做深色，也该走 multiply + 垫光池，
而不是抠图。）

### 输出规格

760×1208 是开箱区（约 372×592）的 2 倍余量，给高 DPI 用；比例照抄原片，
形变交给 CSS 的 `object-fit:fill`。

首帧和末帧各另存一张静帧：
- `closed-still.webp`（首帧）是**没点开之前**显示的闭合宝箱。必须来自这段视频本身，
  用通用木箱当闭合图的话，点下去宝箱会当场换一只、还会跳尺寸（通用箱上屏 142.8px，
  视频里的箱 130.7px）。同一套画布出来的首帧，点击瞬间是无缝的。
- `open-still.webp`（末帧）是播完停住的那一帧。靠 `<video>` 挂着不卸载也能停在末帧，
  但刷新页面还得重新 seek，不如直接换图。
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/ui-prototype/chest/rarity-v1"
TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]

OUT = (760, 1208)      # 比例照抄原片 1142×1816
LAST_FRAME = 120       # 121 帧 @24fps
STAGE_W = 372          # 开箱区实测宽度，只用于打印核对，不写进素材
STATIC_CHEST_PX = 142.8  # 现有静态宝箱上屏宽度：221px 箱体 / 260px 画布 × 168px 槽位


def run(args):
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode:
        sys.exit(f"✗ {' '.join(args[:4])} … 失败：{done.stderr.strip() or done.returncode}")


def chest_box(png):
    """量首帧里箱体的包围盒。阈值 215 避开淡色光晕，只圈住箱体本身。"""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(png).convert("RGB")).astype(int)
    m = a.min(2) < 215
    xs, ys = np.where(m.any(0))[0], np.where(m.any(1))[0]
    return int(xs[0]), int(ys[0]), int(xs[-1] - xs[0] + 1), int(ys[-1] - ys[0] + 1)


def build(tier, crf, report):
    src = SRC / tier / "take-1.mp4"
    if not src.exists():
        sys.exit(f"✗ 缺少原片 {src.relative_to(ROOT)}")
    clip = SRC / tier / "open-anim.mp4"
    run(["ffmpeg", "-v", "error", "-i", str(src),
         "-vf", f"scale={OUT[0]}:{OUT[1]}:flags=lanczos,format=yuv420p",
         "-c:v", "libx264", "-profile:v", "high", "-crf", str(crf),
         "-preset", "slow", "-movflags", "+faststart", "-an", "-y", str(clip)])
    closed = SRC / tier / "closed-still.webp"
    still = SRC / tier / "open-still.webp"
    with tempfile.TemporaryDirectory() as td:
        run(["ffmpeg", "-v", "error", "-i", str(clip), "-frames:v", "1", "-y", f"{td}/first.png"])
        box = chest_box(f"{td}/first.png")
        # 本机 ffmpeg 没编进 libwebp，首尾帧交给 PIL 存。
        run(["ffmpeg", "-v", "error", "-i", str(clip), "-vf", f"select=eq(n\\,{LAST_FRAME})",
             "-vsync", "0", "-frames:v", "1", "-y", f"{td}/last.png"])
        from PIL import Image
        Image.open(f"{td}/first.png").convert("RGB").save(closed, quality=82, method=6)
        Image.open(f"{td}/last.png").convert("RGB").save(still, quality=82, method=6)
    share = box[2] / OUT[0]
    report[tier] = {
        "clipKB": round(clip.stat().st_size / 1024),
        "closedKB": round(closed.stat().st_size / 1024),
        "stillKB": round(still.stat().st_size / 1024),
        "chestBox": box,
        "chestShare": round(share, 4),
        "chestOnStagePx": round(share * STAGE_W, 1),
    }
    print(f"  {tier:<10} {report[tier]['clipKB']:>4} KB + 首尾静帧 {report[tier]['closedKB']}/{report[tier]['stillKB']} KB"
          f"   箱体占画幅 {share*100:.1f}% → {STAGE_W}px 开箱区里上屏 {share*STAGE_W:.1f}px")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crf", type=int, default=26, help="x264 质量，越小越大越清晰")
    ap.add_argument("tiers", nargs="*", default=TIERS)
    a = ap.parse_args()
    print(f"整幅输出 {OUT[0]}×{OUT[1]}（不裁切，CSS 拉伸铺满开箱区）")
    report = {}
    for tier in a.tiers:
        build(tier, a.crf, report)
    total = sum(v["clipKB"] + v["closedKB"] + v["stillKB"] for v in report.values())
    print(f"✓ {len(report)} 档，合计 {total/1024:.2f} MB（原片 24.6 MB）")
    # 各档必须同构图，否则不同稀有度之间宝箱会忽大忽小、忽左忽右。
    # 逐像素相等是要求不了的——原片是生成出来的，1~2px 的抖动属于正常。
    # 这里卡的是「上屏之后看得出来」的量：760 画布上 8px ≈ 372px 开箱区里 4px。
    if len(a.tiers) == len(TIERS):
        centers = {t: v["chestBox"][0] + v["chestBox"][2] / 2 for t, v in report.items()}
        widths = {t: v["chestBox"][2] for t, v in report.items()}
        spread = max(max(centers.values()) - min(centers.values()),
                     max(widths.values()) - min(widths.values()))
        if spread > 8:
            sys.exit(f"✗ 各档箱体构图差得太多（{spread:.1f}px > 8px），切换档位会跳\n"
                     f"   中心 {centers}\n   宽度 {widths}")
        print(f"  各档构图一致，最大偏差 {spread:.1f}px（760 画布，阈值 8px）")
    on_stage = next(iter(report.values()))["chestOnStagePx"]
    print(f"  闭合图 / 视频 / 末帧同属一套画布，宝箱上屏一律 {on_stage}px，点击瞬间不换外观也不跳尺寸")
    print(f"  （六档齐全，开箱演出已全部走这套素材；老的通用木箱 {STATIC_CHEST_PX}px 只剩缺素材时的兜底）")
    (ROOT / "artifacts/chest-rarity").mkdir(parents=True, exist_ok=True)
    (ROOT / "artifacts/chest-rarity/build.json").write_text(
        json.dumps({"out": OUT, "stageWidth": STAGE_W, "tiers": report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
