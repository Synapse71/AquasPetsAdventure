#!/usr/bin/env python3
"""轮询 liclick 任务并把成品下载到本地。

用法:
    ~/.venvs/idle-art/bin/python tools/liclick_fetch.py <task_id> <输出路径不含扩展名> [image|video]
    ... <task_id> <out> image --min-width 900

**要用 venv 的 python**（需要 pillow）。写成 `python3` 会 ModuleNotFoundError。

为什么单独抽出来：get_task_status 的响应里混着缩略图 URL（720×402 一类），
只按正则抓 https 会把缩略图也下下来。

两类产物的挑选方式完全不同，不要混：
  image  下下来用 pillow 读宽度，小于 --min-width 的丢弃。
         默认 900：既挡得住 720 宽的缩略图，又放得过 1K（1024）出图。
         **旧版硬编码 1500**，那是当初只出 2K 的假设，出 1K 时会把成品全丢掉、
         空转到超时。
  video  mp4 用 pillow 打不开，**旧版对视频是彻底坏的**——每个 URL 都抛异常被跳过，
         一条也存不下来。改成验 mp4 文件头的 'ftyp' 盒子。

放在 tools/ 而不是 /tmp——/tmp 会被系统清空，这个脚本已经因此丢过一次。
"""
import argparse, os, re, subprocess, sys, time


def is_mp4(path):
    """mp4/mov 的前 12 字节里有 ftyp 盒子。比看后缀可靠——URL 带一长串签名参数。"""
    try:
        with open(path, "rb") as f:
            return b"ftyp" in f.read(12)
    except OSError:
        return False


def keep_image(path, min_width):
    from PIL import Image
    try:
        return Image.open(path).size[0] >= min_width
    except Exception:
        return False


def fetch(task_id, out_base, task_type="image", tries=80, interval=15, min_width=900):
    ext = ".mp4" if task_type == "video" else ".png"
    for _ in range(tries):
        r = subprocess.run(
            ["atlas-skillhub", "gateway", "call-tool", "--service", "liclick",
             "--tool", "get_task_status", f"task_id={task_id}", f"task_type={task_type}"],
            capture_output=True, text=True).stdout
        saved = []
        for u in sorted(set(re.findall(r'https://[^"\s\\]+', r))):
            tmp = out_base + ".part"
            subprocess.run(["curl", "-sL", u, "-o", tmp])
            ok = is_mp4(tmp) if task_type == "video" else keep_image(tmp, min_width)
            if not ok:
                os.path.exists(tmp) and os.remove(tmp)
                continue
            path = f"{out_base}{ext}" if not saved else f"{out_base}-{len(saved)+1}{ext}"
            os.replace(tmp, path)
            saved.append(path)
        if saved:
            for p in saved:
                print("SAVED", p, f"{os.path.getsize(p)/1024/1024:.1f} MB")
            return saved
        if '"Failed"' in r or "Failed" in r[:200]:
            print("FAILED", r[:300])
            return []
        time.sleep(interval)
    print("TIMEOUT")
    return []


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("task_id")
    ap.add_argument("out_base")
    ap.add_argument("task_type", nargs="?", default="image", choices=["image", "video"])
    ap.add_argument("--min-width", type=int, default=900, help="仅 image：小于此宽度视为缩略图")
    ap.add_argument("--interval", type=int, default=15)
    a = ap.parse_args()
    ok = fetch(a.task_id, a.out_base, a.task_type, interval=a.interval, min_width=a.min_width)
    sys.exit(0 if ok else 1)
