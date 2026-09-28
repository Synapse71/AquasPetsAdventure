#!/usr/bin/env python3
"""把两段（或多段）动画段并排拼成一个可播放的 MP4，用于评审动画本身（静止图看不出节奏）。

    unset PYTHONPATH && ~/.venvs/idle-art/bin/python tools/clip_ab_video.py win-chest win-chest-v2/seedance-2-5/take-1 \
        --out assets/gugugaga/win-chest-v2/old-vs-new.mp4 --width 420

每段取 assets/gugugaga/<段名>/frames/frame_*.png（透明 PNG），铺白底、等比缩到 --width，
再横向并排。24fps 与母版一致；输出 H.264 yuv420p，体积小、能直接在聊天窗口里播。
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def to_white_mp4(clip, width, out, fps):
    frames = ROOT / "assets/gugugaga" / clip / "frames"
    assert frames.exists(), f"{clip} 没有 frames/"
    n = len(list(frames.glob("frame_*.png")))
    # ⚠️ lavfi 的 color 是无源头：必须给它有限时长（d=），
    # 只加 -shortest 不管用——overlay 会一直向它要帧，编码永不结束（踩过：600s 超时）。
    subprocess.run([
        "ffmpeg", "-v", "error", "-framerate", str(fps), "-i", str(frames / "frame_%03d.png"),
        "-f", "lavfi", "-i", f"color=c=white:s={width}x{int(width * 902 / 960)}:r={fps}:d={n / fps:.3f}",
        "-filter_complex", f"[0:v]scale={width}:-1[fg];[1:v][fg]overlay=format=auto,format=yuv420p[out]",
        "-map", "[out]", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-y", str(out)], check=True)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=420, help="每段的宽度（像素）")
    ap.add_argument("--fps", type=int, default=24)
    a = ap.parse_args()
    out = Path(a.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, clip in enumerate(a.clips):
            p = Path(tmp) / f"part{i}.mp4"
            to_white_mp4(clip, a.width, p, a.fps)
            parts.append(p)
        inputs = []
        for p in parts:
            inputs += ["-i", str(p)]
        n = len(parts)
        subprocess.run(["ffmpeg", "-v", "error", *inputs, "-filter_complex",
                        "".join(f"[{i}:v]" for i in range(n)) + f"hstack=inputs={n}[out]",
                        "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                        "-pix_fmt", "yuv420p", "-y", str(out)], check=True)
    size = out.stat().st_size / 1024
    print(f"SAVED {out}  {a.width * len(a.clips)}×{int(a.width * 902 / 960)}  {size:.0f} KB")
    print("并排顺序：", " | ".join(a.clips))


if __name__ == "__main__":
    main()
