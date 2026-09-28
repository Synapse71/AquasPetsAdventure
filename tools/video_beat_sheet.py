#!/usr/bin/env python3
"""多个 MP4 的同刻度节拍对照表（不用先抠图）：一行一个视频，一列一个时间点。

    unset PYTHONPATH && ~/.venvs/idle-art/bin/python tools/video_beat_sheet.py a.mp4 b.mp4 \
        --beats 8 --out assets/gugugaga/_reviews/takes.png

用 ffmpeg 按时间百分比抽帧到临时目录，再拼表；行标签写文件名与时长。
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ["/System/Library/Fonts/Supplemental/Songti.ttc",
         "/System/Library/Fonts/Hiragino Sans GB.ttc"]


def duration(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(video)], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def extract(video, beats, outdir, window=None):
    dur = duration(video)
    lo, hi = (0.0, dur) if not window else window
    span = max(0.001, hi - lo)
    files = []
    for i in range(beats):
        t = lo + span * i / max(1, beats - 1)
        if window:                      # 只截取窗口时，末点不要越过总时长
            t = min(t, max(0.0, dur - 0.03))
        else:
            t = t * 0.995
        target = outdir / f"{video.stem}-{i:02d}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video),
                        "-frames:v", "1", "-y", str(target)], check=False)
        if target.exists():
            files.append((target, t))
    return dur, files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--beats", type=int, default=8)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cell", type=int, default=260)
    ap.add_argument("--window", default=None,
                    help="只取一段窗口，格式 起点:终点（秒），如 3.6:5.05；用于盯尾部的收纳动作")
    a = ap.parse_args()
    window = tuple(float(x) for x in a.window.split(":")) if a.window else None
    font = next((ImageFont.truetype(p, 19) for p in FONTS if Path(p).exists()), ImageFont.load_default())
    big = next((ImageFont.truetype(p, 24) for p in FONTS if Path(p).exists()), font)
    cell, bar, gap, name_w = a.cell, 32, 8, 210
    sheet_w = name_w + gap + a.beats * (cell + gap)
    sheet_h = gap + len(a.videos) * (cell + bar + gap)
    sheet = Image.new("RGB", (sheet_w, sheet_h), "#dcd9d2")
    draw = ImageDraw.Draw(sheet)
    with tempfile.TemporaryDirectory() as tmp:
        for r, video in enumerate(a.videos):
            video = Path(video)
            dur, frames = extract(video, a.beats, Path(tmp), window)
            y = gap + r * (cell + bar + gap)
            draw.rectangle([gap, y, gap + name_w - gap, y + cell], fill="#141414")
            label = str(video.relative_to(ROOT)) if video.is_absolute() and ROOT in video.parents else str(video)
            parts = label.split("/")
            draw.text((gap + 10, y + 10), parts[-1], fill="white", font=big)
            draw.text((gap + 10, y + 44), "/".join(parts[-3:-1]), fill="#9be0a0", font=font)
            draw.text((gap + 10, y + 70), f"{dur:.2f}s", fill="#f0c674", font=font)
            for c, (path, t) in enumerate(frames):
                im = Image.open(path).convert("RGB")
                im.thumbnail((cell, cell), Image.LANCZOS)
                x = name_w + c * (cell + gap)
                sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
                draw.rectangle([x, y + cell, x + cell, y + cell + bar], fill="#141414")
                draw.text((x + 8, y + cell + 5), f"{t:.2f}s", fill="white", font=font)
    out = Path(a.out)
    if not out.is_absolute():
        out = ROOT / out
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print("SAVED", out, sheet.size)


if __name__ == "__main__":
    main()
