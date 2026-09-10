#!/usr/bin/env python3
"""Generate before/after sheets and looping comparisons, without replacing assets."""
import argparse
import json
import hashlib
from pathlib import Path
from PIL import Image, ImageDraw
from pet_matte import clean_edges, edge_metrics

ROOT = Path(__file__).resolve().parents[1]
BACKGROUNDS = [('dark', (24, 27, 33)), ('gray', (104, 108, 116)), ('magenta', (191, 23, 157))]


def composite(image, color, size=(300, 282)):
    frame = image.resize(size, Image.Resampling.LANCZOS)
    base = Image.new('RGBA', size, (*color, 255))
    return Image.alpha_composite(base, frame).convert('RGB')


def runtime_comparison(before_path, after_path, dest):
    """Check the first encoded sprite frame, not just the source PNG preview."""
    sheet = Image.new('RGB', (600, 282), BACKGROUNDS[0][1])
    for side, path in enumerate([before_path, after_path]):
        with Image.open(path) as image:
            if image.width < 300 or image.height < 282:
                raise ValueError(f'Not a 300x282 pet sprite sheet: {path}')
            first = image.convert('RGBA').crop((0, 0, 300, 282))
        sheet.paste(composite(first, BACKGROUNDS[0][1]), (side * 300, 0))
    sheet.save(dest / 'runtime-webp-comparison.png')


def review(clip, indices, dest, animate):
    files = sorted((ROOT / 'assets/gugugaga' / clip / 'frames').glob('frame_*.png'))
    if not files:
        raise ValueError(f'No source frames: {clip}')
    picks = sorted(set(min(i, len(files) - 1) for i in indices))
    sheet = Image.new('RGB', (1800, 318 * len(picks)), '#202127')
    draw = ImageDraw.Draw(sheet)
    results = []
    for row, index in enumerate(picks):
        original = Image.open(files[index]).convert('RGBA')
        cleaned = clean_edges(original)
        metrics = edge_metrics(original, cleaned)
        results.append({'frame': index, 'source_sha256': hashlib.sha256(files[index].read_bytes()).hexdigest(), **metrics})
        cleaned.save(dest / f'{clip}-{index:03d}-candidate.png')
        for col, (name, color) in enumerate(BACKGROUNDS):
            for side, frame in enumerate([original, cleaned]):
                x, y = (col * 2 + side) * 300, row * 318
                draw.text((x + 8, y + 8), f'{clip} f{index:03d} / {name} / {"BEFORE" if side == 0 else "AFTER"}', fill='white')
                sheet.paste(composite(frame, color), (x, y + 30))
    sheet.save(dest / f'{clip}-comparison.jpg', quality=94)
    sheet.crop((0, 0, 600, 318)).save(dest / f'{clip}-preview.png')
    # 2x nearest-neighbor edge crop, so smoothing in the preview cannot hide defects.
    original = Image.open(files[picks[0]]).convert('RGBA')
    cleaned = clean_edges(original)
    detail = Image.new('RGB', (1200, 272), '#202127')
    box = (330, 35, 630, 155) if not clip.startswith('sleep') else (70, 410, 370, 530)
    d = ImageDraw.Draw(detail)
    for side, frame in enumerate([original, cleaned]):
        d.text((side * 600 + 10, 8), 'BEFORE' if side == 0 else 'AFTER', fill='white')
        crop = composite(frame.crop(box), BACKGROUNDS[0][1], (300, 120)).resize((600, 240), Image.Resampling.NEAREST)
        detail.paste(crop, (side * 600, 32))
    detail.save(dest / f'{clip}-edge-detail.png')
    # Hair-tip gaps on both sides; use saturated backing to reveal real alpha.
    if clip in ['blink-plain', 'blink-breath', 'blink-tilt', 'bulb-hint']:
        hair = Image.new('RGB', (1500, 504), '#202127')
        for row, (_, color) in enumerate([BACKGROUNDS[0], BACKGROUNDS[2]]):
            for side, frame in enumerate([original, cleaned]):
                crop = frame.crop((230, 325, 730, 470))
                tile = composite(crop, color, (500, 145)).resize((750, 218), Image.Resampling.NEAREST)
                hair.paste(tile, (side * 750, row * 252 + 30))
                ImageDraw.Draw(hair).text((side * 750 + 8, row * 252 + 8), 'SOURCE' if side == 0 else 'CLEANED', fill='white')
        hair.save(dest / f'{clip}-hair-detail.png')
    if animate:
        frames, temporal = [], []
        for i, path in enumerate(files):
            original = Image.open(path).convert('RGBA')
            cleaned = clean_edges(original)
            temporal.append({'frame': i, **edge_metrics(original, cleaned)})
            frame = Image.new('RGB', (600, 312), '#202127')
            ImageDraw.Draw(frame).text((8, 8), f'{clip} / BEFORE                         AFTER', fill='white')
            frame.paste(composite(original, BACKGROUNDS[0][1]), (0, 30))
            frame.paste(composite(cleaned, BACKGROUNDS[0][1]), (300, 30))
            frames.append(frame)
        durations = [round((i + 1) * 1000 / 24) - round(i * 1000 / 24) for i in range(len(frames))]
        frames[0].save(dest / f'{clip}-motion.webp', save_all=True, append_images=frames[1:], duration=durations, loop=0, quality=90, method=4)
        (dest / f'{clip}-temporal.json').write_text(json.dumps(temporal, indent=2) + '\n')
    return {'clip': clip, 'samples': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('clips', nargs='*', default=['blink-plain', 'idle-magnifier', 'walk', 'sleep-loop'])
    parser.add_argument('--frames', nargs='+', type=int, default=[0, 40, 80, 120])
    parser.add_argument('--animate', action='store_true')
    parser.add_argument('--runtime-before', type=Path, help='Optional original 300x282 sprite sheet')
    parser.add_argument('--runtime-after', type=Path, help='Optional candidate sprite sheet, paired with --runtime-before')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/gugugaga/_reviews/edge-cleanup-v2')
    args = parser.parse_args()
    if any(index < 0 for index in args.frames):
        parser.error('Frame indices must be nonnegative')
    if bool(args.runtime_before) != bool(args.runtime_after):
        parser.error('Runtime before/after paths must be supplied together')
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for clip in args.clips:
        result = review(clip, args.frames, args.output, args.animate)
        results.append(result)
        print(json.dumps(result), flush=True)
    (args.output / 'report.json').write_text(json.dumps(results, indent=2) + '\n')
    if args.runtime_before:
        runtime_comparison(args.runtime_before, args.runtime_after, args.output)


if __name__ == '__main__':
    main()
