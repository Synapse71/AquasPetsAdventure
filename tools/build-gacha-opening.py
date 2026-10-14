#!/usr/bin/env python3
"""扭蛋开蛋视频 → 抽奖页能直接用的素材。

    "${IDLE_ART_PYTHON:-$HOME/.venvs/idle-art/bin/python}" tools/build-gacha-opening.py [档 ...]

输入：assets/ui-prototype/gacha/opening-v1/<档>/ 里选定的原片。选哪一条写在同目录的
`chosen.txt`（例如 `take-2.mp4`），没有就用 take-1.mp4。原片由 opening-v1/gen_videos.py
以 first-frame/machine-d.png 为首帧生成，**背景纯白**。

### 各档只换颜色

各档开蛋动画除了扭蛋、光效、星星的颜色，其他必须完全一致（用户要求）。分档单独生成做不到这一点，
所以只有稀有档有原片（母版），其余档位按 RECOLOR 从母版逐帧换色得到：
- 扭蛋机以外的像素整体绕灰轴旋转色相（RGB 空间的线性旋转，白、灰、黑不变，和羽化到白底可交换）；
- 扭蛋机剪影（第 0 帧漫水算出）以内，只在罩子以下、和第 0 帧不同、色相落在光效色带里的像素上换色——
  也就是压在机身上的光晕和刚滚出出蛋口的扭蛋。罩子里的彩色扭蛋、转动的金色把手、机身的青绿色都不动。
目标色相取自 assets/loot/RARITY-PALETTE.md 的稀有度色。

输出（同目录）：
- `open-anim.mp4`：768×1024，H.264，抽奖页直接 <video> 播放。
- `open-still.webp`：末帧。播完停在这一帧，刷新页面也不用重新 seek。

另外把首帧原图转成 `first-frame/machine-d.webp`，作为没抽之前显示的待机图。所有档位的
视频都以同一张首帧起播，所以待机图对任何档位都通用；脚本会核对每段视频的首帧和待机图
差多少，差太多（生成时机器动了位置）就报错，免得点下去画面一跳。

和宝箱一样不抠图：白底视频直接铺在白底的抽奖舞台上。

### 边缘羽化

开壳时的淡蓝光晕会扩散到画面边缘（稀有档 take-4 在约 3.5~4.3 秒碰到底边，被硬切成一条
淡蓝边）。转码时把四边 EDGE_FEATHER 宽的一圈按 smoothstep 渐变到纯白，光晕就在画面内自然
淡出。扭蛋机和扭蛋离边缘很远，不受影响。

转完逐帧检查四边最外 1% 的条带：任何一帧条带的平均偏白程度超过 MAX_EDGE_MEAN 就报错——
说明有实心的东西（不是淡光晕）压到了边上，羽化救不了，得换原片或重出。
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GACHA = ROOT / "assets/ui-prototype/gacha"
SRC = GACHA / "opening-v1"
FIRST_FRAME = GACHA / "first-frame/machine-d.png"
TIERS = ["uncommon", "rare", "epic"]   # 传说、神话开放后再补
# 从母版换色得到的档位：目标色相（度）取自稀有度色板；chroma 是换色后的饱和度倍数，
# 草绿直接转过去偏荧光，压一点。
RECOLOR = {
    "uncommon": {"from": "rare", "hue": 95, "chroma": 0.8},   # #A8DC82
    "epic": {"from": "rare", "hue": 268, "chroma": 1.0},      # #B98BEE
}
# 母版（稀有档 take-4）里扭蛋和光效的色相，实测集中在 190~210。
MASTER_HUE = 200
# 扭蛋机内部只给这个色相范围里的像素换色；机身青绿色约 170~180，不能碰。
EFFECT_BAND = (182, 260)
OUT = (768, 1024)                      # 首帧 3:4；抽奖舞台约 377px 宽，留 2 倍余量
# 视频首帧与待机图的平均逐像素差（0~255）。生成出来的首帧会有轻微编码噪声，
# 超过这个值通常是机器整体挪了位置或变了颜色，点下去会看得出来。
MAX_FIRST_FRAME_DIFF = 6.0
# 四边羽化带宽度，按各自方向的画幅比例。
EDGE_FEATHER = 0.04
# 羽化后四边最外 1% 条带的平均偏白程度上限（0~255）。3 以下肉眼看不出。
MAX_EDGE_MEAN = 3.0


def run(args):
    done = subprocess.run(args, capture_output=True, text=True)
    if done.returncode:
        sys.exit(f"✗ {' '.join(map(str, args[:4]))} … 失败：{done.stderr.strip() or done.returncode}")


def mean_diff(a_path, b_path):
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(a_path).convert("RGB").resize(OUT)).astype(int)
    b = np.asarray(Image.open(b_path).convert("RGB").resize(OUT)).astype(int)
    return float(np.abs(a - b).mean())


def feather_mask(path):
    """白→黑的羽化遮罩：中间 255 保留原画，四边渐变到 0（即纯白底）。"""
    import numpy as np
    from PIL import Image
    w, h = OUT
    def ramp(n, band):
        x = np.minimum(np.arange(n), np.arange(n)[::-1]) / max(1, band)
        x = np.clip(x, 0, 1)
        return x * x * (3 - 2 * x)
    m = np.outer(ramp(h, int(h * EDGE_FEATHER)), ramp(w, int(w * EDGE_FEATHER)))
    Image.fromarray((m * 255).round().astype("uint8")).convert("RGB").save(path)


def edge_report(clip, td):
    """逐帧量四边最外 1% 条带的平均偏白程度，返回最差的一帧。"""
    import glob
    import numpy as np
    from PIL import Image
    run(["ffmpeg", "-v", "error", "-i", str(clip), f"{td}/f%03d.png"])
    worst = (-1.0, -1, "")   # 从 -1 起，全白的视频也能报出具体是哪一帧
    for index, frame in enumerate(sorted(glob.glob(f"{td}/f*.png"))):
        dev = 255 - np.asarray(Image.open(frame).convert("RGB")).astype(int).min(2)
        h, w = dev.shape
        bx, by = max(1, w // 100), max(1, h // 100)
        strips = {"左": dev[:, :bx], "右": dev[:, -bx:], "顶": dev[:by, :], "底": dev[-by:, :]}
        for side, strip in strips.items():
            mean = float(strip.mean())
            if mean > worst[0]:
                worst = (mean, index, side)
    return worst


def probe(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,r_frame_rate:format=duration", "-of", "default=nw=1:nk=1", str(src)],
                         capture_output=True, text=True).stdout.split()
    return int(out[0]), int(out[1]), out[2], out[3]


def hue_rotation(degrees):
    """绕 RGB 灰轴旋转的矩阵：白、灰、黑不动，彩色按色相转过去。"""
    import numpy as np
    t = np.radians(degrees)
    k = np.ones(3) / np.sqrt(3)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(t) * K + (1 - np.cos(t)) * K @ K


def machine_mask(f0):
    """第 0 帧扭蛋机的实心剪影，以及罩子以下（机身）那部分。"""
    import numpy as np
    from scipy import ndimage
    luma = f0 @ np.array([0.299, 0.587, 0.114])
    labels, _ = ndimage.label(~ndimage.binary_dilation(luma < 190, iterations=1))
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    machine = ndimage.binary_fill_holes(~np.isin(labels, border[border > 0]))
    rows = np.nonzero(machine.any(1))[0]
    top, bottom = rows[0], rows[-1]
    # 罩子和机身之间最窄的那一行是罩子的底，在机器高度 35%~65% 之间找。
    lo, hi = top + (bottom - top) * 35 // 100, top + (bottom - top) * 65 // 100
    neck = lo + int(np.argmin(machine.sum(1)[lo:hi]))
    body = np.zeros_like(machine)
    body[neck:] = True
    return machine, body


def recolor(master, target, spec):
    """把母版逐帧换色成另一档，写到 target（输出尺寸的无损 RGB 中间文件，后面照常羽化、转码）。"""
    import numpy as np
    from scipy import ndimage
    _, _, fps, _ = probe(master)
    w, h = OUT
    # 解码走和稀有档直接转码同一条路（缩放 + 转 gbrp）。直接让 ffmpeg 转 rgb24 用的是另一套低精度换算，
    # 白底只有 252（gbrp 是 254），首帧和待机图会多差 1.4 左右。
    decode = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(master), "-vf", f"scale={w}:{h}:flags=lanczos,format=gbrp",
                               "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    encode = subprocess.Popen(["ffmpeg", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
                               "-r", fps, "-i", "-", "-c:v", "libx264rgb", "-qp", "0", "-preset", "ultrafast",
                               "-pix_fmt", "rgb24", "-y", str(target)], stdin=subprocess.PIPE)
    rotation = hue_rotation(spec["hue"] - MASTER_HUE).T
    f0 = None
    while True:
        raw = decode.stdout.read(w * h * 3)
        if len(raw) < w * h * 3:
            break
        f = np.frombuffer(raw, np.uint8).reshape(h, w, 3).astype(float)
        if f0 is None:
            f0 = f
            machine, body = machine_mask(f0)
            # 外扩 2px 把描边的抗锯齿也算进机器，否则机身的青绿描边会被一起转色。
            inside = ndimage.binary_dilation(machine, iterations=2).astype(float)
        r, g, b = f[..., 0], f[..., 1], f[..., 2]
        hue = np.degrees(np.arctan2(np.sqrt(3) * (g - b), 2 * r - g - b)) % 360
        chroma = f.max(2) - f.min(2)
        lo, hi = EFFECT_BAND
        band = np.clip((hue - lo) / 8, 0, 1) * np.clip((hi - hue) / 10, 0, 1) * np.clip((chroma - 10) / 20, 0, 1)
        changed = np.clip((np.abs(f - f0).max(2) - 8) / 16, 0, 1)
        # 几乎不带颜色的像素不动：白底本身带一点点偏色，转过去首帧就和待机图对不上了。
        colorful = np.clip((chroma - 8) / 12, 0, 1)
        weight = (colorful * ((1 - inside) + inside * band * changed * body))[..., None]
        gray = f.mean(2, keepdims=True)
        turned = gray + (f - gray) @ rotation * spec["chroma"]
        encode.stdin.write(np.clip(f * (1 - weight) + turned * weight, 0, 255).round().astype(np.uint8).tobytes())
    encode.stdin.close()
    if decode.wait() or encode.wait():
        sys.exit(f"✗ 换色 {target.name} 失败")


def build_idle():
    from PIL import Image
    target = FIRST_FRAME.with_suffix(".webp")
    Image.open(FIRST_FRAME).convert("RGB").resize(OUT, Image.LANCZOS).save(target, quality=86, method=6)
    return target


def master_of(tier):
    d = SRC / tier
    chosen = (d / "chosen.txt").read_text().strip() if (d / "chosen.txt").exists() else "take-1.mp4"
    src = d / chosen
    if not src.exists():
        sys.exit(f"✗ 缺少原片 {src.relative_to(ROOT)}")
    return src, f"{tier}/{chosen}"


def build(tier, crf, report):
    d = SRC / tier
    d.mkdir(exist_ok=True)
    clip = d / "open-anim.mp4"
    still = d / "open-still.webp"
    with tempfile.TemporaryDirectory() as td:
        if tier in RECOLOR:
            spec = RECOLOR[tier]
            master, label = master_of(spec["from"])
            src = Path(td) / "recolored.mp4"
            recolor(master, src, spec)
            chosen = f"{label} 换色 {spec['hue']}°"
        else:
            src, chosen = master_of(tier)
        feather_mask(f"{td}/mask.png")
        _, _, fps, duration = probe(src)
        # maskedmerge：输出 = 白底 + (视频 − 白底) × 遮罩。三路都转成 gbrp，逐通道线性混合。
        # 白底和遮罩本身是无限长的源，这里把它们截到和原片一样长，输出才会跟着视频结束。
        graph = (f"[0:v]scale={OUT[0]}:{OUT[1]}:flags=lanczos,format=gbrp[v];"
                 f"color=white:s={OUT[0]}x{OUT[1]}:r={fps}:d={duration},format=gbrp[w];"
                 f"[1:v]format=gbrp[m];"
                 f"[w][v][m]maskedmerge,format=yuv420p")
        run(["ffmpeg", "-v", "error", "-i", str(src), "-loop", "1", "-t", duration, "-i", f"{td}/mask.png",
             "-filter_complex", graph,
             "-c:v", "libx264", "-profile:v", "high", "-crf", str(crf),
             "-preset", "slow", "-movflags", "+faststart", "-an", "-y", str(clip)])
        run(["ffmpeg", "-v", "error", "-i", str(clip), "-frames:v", "1", "-y", f"{td}/first.png"])
        # 末帧：从结尾往回 seek 0.1 秒取最后一帧，不依赖固定帧数。
        run(["ffmpeg", "-v", "error", "-sseof", "-0.1", "-i", str(clip), "-update", "1", "-y", f"{td}/last.png"])
        from PIL import Image
        Image.open(f"{td}/last.png").convert("RGB").save(still, quality=82, method=6)
        diff = mean_diff(f"{td}/first.png", FIRST_FRAME)
        edge_mean, edge_frame, edge_side = edge_report(clip, td)
    report[tier] = {
        "source": chosen,
        "clipKB": round(clip.stat().st_size / 1024),
        "stillKB": round(still.stat().st_size / 1024),
        "firstFrameDiff": round(diff, 2),
        "worstEdge": {"mean": round(edge_mean, 2), "frame": edge_frame, "side": edge_side},
    }
    print(f"  {tier:<9} {chosen:<24} {report[tier]['clipKB']:>4} KB + 末帧 {report[tier]['stillKB']} KB"
          f"   首帧与待机图平均差 {diff:.2f}   边缘最深 {edge_mean:.2f}（第 {edge_frame} 帧{edge_side}边）")
    if diff > MAX_FIRST_FRAME_DIFF:
        sys.exit(f"✗ {tier} 的视频首帧和待机图差 {diff:.2f} > {MAX_FIRST_FRAME_DIFF}，点下去画面会跳；换一条原片再试")
    if edge_mean > MAX_EDGE_MEAN:
        sys.exit(f"✗ {tier} 第 {edge_frame} 帧{edge_side}边条带平均偏白 {edge_mean:.2f} > {MAX_EDGE_MEAN}，"
                 f"有实心内容压到画面边缘，羽化救不了；换一条原片或重出")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crf", type=int, default=26, help="x264 质量，越小越大越清晰")
    ap.add_argument("tiers", nargs="*")
    a = ap.parse_args()
    tiers = a.tiers or [t for t in TIERS if (SRC / t).is_dir()]
    idle = build_idle()
    print(f"待机图 {idle.relative_to(ROOT)} {round(idle.stat().st_size / 1024)} KB；视频整幅输出 {OUT[0]}×{OUT[1]}")
    report = {}
    for tier in tiers:
        build(tier, a.crf, report)
    (ROOT / "artifacts/gacha-opening").mkdir(parents=True, exist_ok=True)
    (ROOT / "artifacts/gacha-opening/build.json").write_text(
        json.dumps({"out": OUT, "tiers": report}, ensure_ascii=False, indent=2))
    print(f"✓ {len(report)} 档")


if __name__ == "__main__":
    main()
