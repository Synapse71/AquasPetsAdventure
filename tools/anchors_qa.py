#!/usr/bin/env python3
"""衔接落点体检：把每条「上一段末帧 → 下一段首帧」的接缝量一遍。

为什么要有这个：桌宠在十几段之间任意切换，只要接缝两侧的躯干/脚底对不上，
切换那一帧就会横向或纵向跳一下——2026-09 的三段行进彩蛋就是这么漏出去的
（walk 被原地对齐，彩蛋没跟着走，接了 26 个绘制像素的跳）。

用法（不需要渲染器，直接读 public/pet-sprites）：
    ~/.venvs/idle-art/bin/python tools/anchors_qa.py
    ~/.venvs/idle-art/bin/python tools/anchors_qa.py --verbose

判据：
  - 横向：接缝两侧躯干中心差 ≤ 2 母版像素（960 画布）
  - 纵向：接缝两侧脚底差 ≤ 7 母版像素（沿用 ASSETS-HANDOFF §2 的口径）
对齐后仍差超过判据就退出码 1，可用于门禁。
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / 'public' / 'pet-sprites'
CANVAS_W = 960
X_TOLERANCE = 2
Y_TOLERANCE = 7

# start-explore 的横向落点靠运行时根位移补正（src/ui/petFrameAlignment.ts），
# 补正表在末帧累计 +39 绘制像素（= +124.8 母版像素）。这里按同一口径加上，
# 才是玩家真正看到的位置；改那张表就要同步改这个值。
RUNTIME_DX_DRAW_PX = {('start-explore', 'last'): 39}

# 每条衔接：上一段/下一段/说明。'walk' 两侧都要接三段行进彩蛋。
SEAMS = [
    ('start-explore', 'last', 'walk', 'first', '出发段走到左侧 → 行走循环'),
    ('walk', 'first', 'travel-map', 'first', '行走循环 → 看图彩蛋'),
    ('travel-map', 'last', 'walk', 'first', '看图彩蛋 → 行走循环'),
    ('walk', 'first', 'travel-rest', 'first', '行走循环 → 歇脚彩蛋'),
    ('travel-rest', 'last', 'walk', 'first', '歇脚彩蛋 → 行走循环'),
    ('walk', 'first', 'travel-alert', 'first', '行走循环 → 警觉彩蛋'),
    ('travel-alert', 'last', 'walk', 'first', '警觉彩蛋 → 行走循环'),
    ('walk', 'last', 'walk', 'first', '行走循环自闭环（原地）'),
    ('sleep-start', 'last', 'sleep-loop', 'first', '入睡 → 睡眠循环'),
    ('sleep-loop', 'last', 'sleep-end', 'first', '睡眠循环 → 醒来'),
    ('idle-magnifier', 'last', 'idle-magnifier', 'first', '待机段自闭环'),
    ('idle-digging', 'last', 'idle-digging', 'first', '待机段自闭环'),
    ('blink-plain', 'last', 'blink-plain', 'first', '待机段自闭环'),
]

# 站立自闭环段的落点（母版像素），sleep 链的末端回到站立。
STANDING_CX = 480


def load_sheet(clip, manifest):
    meta = manifest[clip]
    with Image.open(SHEETS / meta['file']) as image:
        return image.convert('RGBA'), meta


def frame_at(sheet, meta, index):
    w, h, cols = meta['width'], meta['height'], meta['columns']
    return sheet.crop(((index % cols) * w, (index // cols) * h, (index % cols) * w + w, (index // cols) * h + h))


def torso_center(frame):
    """55%~85% 画布高的透明带里，内容左右边界的中心（= 躯干水平中心，避开道具）。"""
    alpha = np.asarray(frame)[..., 3]
    band = alpha[int(0.55 * alpha.shape[0]):int(0.85 * alpha.shape[0])] > 60
    cols = np.where(band.any(0))[0]
    if not len(cols):
        return None
    return (cols[0] + cols[-1]) / 2 * (CANVAS_W / frame.width)


def foot_bottom(frame):
    alpha = np.asarray(frame)[..., 3]
    rows = np.where((alpha > 60).any(1))[0]
    return None if not len(rows) else int(rows[-1]) * (CANVAS_W / frame.width)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verbose', action='store_true', help='打印每条接缝的实测值')
    args = parser.parse_args()
    manifest = json.loads((SHEETS / 'manifest.json').read_text())
    cache = {}

    def probe(clip, side):
        if clip not in cache:
            sheet, meta = load_sheet(clip, manifest)
            first = frame_at(sheet, meta, 0)
            last = frame_at(sheet, meta, meta['frames'] - 1)
            cache[clip] = dict(first=first, last=last, frames=meta['frames'])
        entry = cache[clip]
        frame = entry[side]
        offset = RUNTIME_DX_DRAW_PX.get((clip, side), 0) * (CANVAS_W / 300)
        return torso_center(frame), foot_bottom(frame), offset

    failures = []
    for from_clip, from_side, to_clip, to_side, note in SEAMS:
        x1, y1, dx1 = probe(from_clip, from_side)
        x2, y2, dx2 = probe(to_clip, to_side)
        if x1 is None or x2 is None:
            failures.append(f'{from_clip}→{to_clip}: 取不到躯干中心')
            continue
        gap_x = abs((x1 + dx1) - x2)
        gap_y = abs(y1 - y2)
        state = '✓' if gap_x <= X_TOLERANCE and gap_y <= Y_TOLERANCE else '✗'
        if state == '✗':
            failures.append(f'{from_clip}({from_side})→{to_clip}({to_side}) 横向差 {gap_x:.1f}px、脚底差 {gap_y}px')
        if args.verbose or state == '✗':
            print(f'  {state} {from_clip:14s} {from_side:5s} → {to_clip:14s} {to_side:5s} '
                  f'横向差 {gap_x:5.1f}px（判据 ≤{X_TOLERANCE}）  脚底差 {gap_y:5.1f}px（判据 ≤{Y_TOLERANCE}）  {note}')

    # 站立自闭环与睡眠链两端：末帧必须回到站立落点。
    for clip, side, expected, note in [
        ('idle-magnifier', 'last', STANDING_CX, '待机段回到站立落点'),
        ('idle-digging', 'last', STANDING_CX, '待机段回到站立落点'),
        ('blink-plain', 'last', STANDING_CX, '待机段回到站立落点'),
        ('sleep-end', 'last', STANDING_CX, '醒来回到站立落点'),
    ]:
        x, _, offset = probe(clip, side)
        if x is None:
            failures.append(f'{clip}({side}): 取不到躯干中心')
            continue
        gap = abs(x + offset - expected)
        state = '✓' if gap <= X_TOLERANCE else '✗'
        if state == '✗':
            failures.append(f'{clip}({side}) 距站立落点 {gap:.1f}px')
        if args.verbose or state == '✗':
            print(f'  {state} {clip:14s} {side:5s} → 站立 {expected}  差 {gap:5.1f}px  {note}')

    print(f'衔接落点体检：{len(SEAMS) + 4} 项，失败 {len(failures)} 项')
    for line in failures:
        print(f'  ✗ {line}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
