#!/usr/bin/env python3
"""检查一段「首尾帧由锚点钉死」的视频，是否真的回到站立锚点姿势。

    unset PYTHONPATH && ~/.venvs/idle-art/bin/python tools/video_anchor_check.py a.mp4 b.mp4

对每个视频取首帧/尾帧，按「非白像素」提出剪影，与 assets/gugugaga/anchor-front-standing.png
的剪影做 IoU 与重心/脚底偏移对比。管线要求首尾两帧与锚点一致（否则段与段切换会跳），
所以 IoU 越高越好；经验上 ≥0.85 算对得上，<0.7 说明模型没回到原姿势、不能直接进管线。
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ANCHOR = ROOT / "assets/gugugaga/anchor-front-standing.png"
RES = 512


def silhouette(path):
    im = Image.open(path).convert("RGB").resize((RES, RES))
    return [1 if min(px) < 240 else 0 for px in im.getdata()]


def stats(mask):
    xs = [i % RES for i, v in enumerate(mask) if v]
    ys = [i // RES for i, v in enumerate(mask) if v]
    if not xs:
        return {"cx": None, "foot_y": None, "cover": 0.0}
    return {"cx": round((min(xs) + max(xs)) / 2 / RES, 4),
            "foot_y": round(max(ys) / RES, 4),
            "cover": round(sum(mask) / len(mask), 4)}


def iou(a, b):
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y)
    return round(inter / union, 4) if union else 0.0


def frame_at(video, t, target):
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video),
                    "-frames:v", "1", "-y", str(target)], check=False)
    return target.exists()


def duration(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(video)], capture_output=True, text=True).stdout
    return float(out.strip() or 0)


def main():
    base = silhouette(ANCHOR)
    bs = stats(base)
    print(f"锚点: cx={bs['cx']} foot_y={bs['foot_y']} cover={bs['cover']}")
    for video in sys.argv[1:]:
        video = Path(video).resolve()
        dur = duration(video)
        with tempfile.TemporaryDirectory() as tmp:
            first, last = Path(tmp) / "f.png", Path(tmp) / "l.png"
            ok1 = frame_at(video, 0.0, first)
            ok2 = frame_at(video, max(0, dur - 0.05), last)
            # 绝对路径用相对仓库根的短名，仓库外的就用原路径
            name = str(video.relative_to(ROOT)) if ROOT in video.parents else str(video)
            row = {"video": name, "duration": round(dur, 2)}
            for tag, path, ok in (("first", first, ok1), ("last", last, ok2)):
                if not ok:
                    row[tag] = "抽帧失败"
                    continue
                m = silhouette(path)
                s = stats(m)
                row[tag] = {"iou_vs_anchor": iou(m, base),
                            "cx_delta": round((s["cx"] or 0) - (bs["cx"] or 0), 4),
                            "foot_delta": round((s["foot_y"] or 0) - (bs["foot_y"] or 0), 4),
                            "cover_delta": round(s["cover"] - bs["cover"], 4)}
            print(f"{row['video']}  {row['duration']}s")
            for tag in ("first", "last"):
                print(f"   {tag}: {row[tag]}")


if __name__ == "__main__":
    main()
