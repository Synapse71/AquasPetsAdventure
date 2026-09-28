#!/usr/bin/env python3
"""两段（或多段）动画的「同刻度」对照接触表：一行一段，一列一个时间点。

    unset PYTHONPATH && ~/.venvs/idle-art/bin/python tools/clip_compare_sheet.py win-chest win-chest-v2
    ... --beats 8 --out assets/gugugaga/_reviews/win-chest-vs-v2.png

为什么要按时间刻度对齐：动画改动往往是「节拍重排」（哪一拍占多久），
按帧号并排会看不出差别，按时间百分比对齐才能一眼看出前后半段各占多少。
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ["/System/Library/Fonts/Supplemental/Songti.ttc",
         "/System/Library/Fonts/Hiragino Sans GB.ttc"]


def pick_frames(clip, beats):
    frames = sorted((ROOT / "assets/gugugaga" / clip / "frames").glob("frame_*.png"))
    assert frames, f"{clip} 没有帧"
    n = len(frames)
    return [frames[round(i * (n - 1) / (beats - 1))] for i in range(beats)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+")
    ap.add_argument("--beats", type=int, default=8)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cell", type=int, default=260)
    a = ap.parse_args()

    font = next((ImageFont.truetype(p, 20) for p in FONTS if Path(p).exists()), ImageFont.load_default())
    big = next((ImageFont.truetype(p, 26) for p in FONTS if Path(p).exists()), font)
    rows = [pick_frames(c, a.beats) for c in a.clips]
    cell, bar, gap, name_w = a.cell, 34, 8, 170
    width = name_w + gap + a.beats * (cell + gap)
    height = gap + len(rows) * (cell + bar + gap)
    sheet = Image.new("RGB", (width, height), "#dcd9d2")
    draw = ImageDraw.Draw(sheet)
    for r, (clip, frames) in enumerate(zip(a.clips, rows)):
        y = gap + r * (cell + bar + gap)
        draw.rectangle([gap, y, gap + name_w - gap, y + cell], fill="#141414")
        draw.text((gap + 10, y + 10), clip, fill="white", font=big)
        draw.text((gap + 10, y + 46), f"{len(frames)} 抽样 / 全片{len(list((ROOT / 'assets/gugugaga' / clip / 'frames').glob('frame_*.png')))}帧",
                  fill="#9be0a0", font=font)
        for c, path in enumerate(frames):
            im = Image.open(path).convert("RGBA")
            tile = Image.new("RGB", im.size, "white")
            tile.paste(im, (0, 0), im)
            tile.thumbnail((cell, cell), Image.LANCZOS)
            x = name_w + c * (cell + gap)
            sheet.paste(tile, (x + (cell - tile.width) // 2, y + (cell - tile.height) // 2))
            draw.rectangle([x, y + cell, x + cell, y + cell + bar], fill="#141414")
            draw.text((x + 8, y + cell + 6), f"{path.stem.split('_')[-1]}  第{c + 1}/{a.beats}拍",
                      fill="white", font=font)
    out = Path(a.out) if Path(a.out).is_absolute() else ROOT / a.out
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print("SAVED", out, sheet.size)


if __name__ == "__main__":
    main()
