"""Offline review artifacts built from the actual encoded runtime sheets."""
import json
import shutil
from pathlib import Path
from PIL import Image, ImageDraw

NAMES = {'idle-magnifier': '放大镜待机', 'idle-digging': '挖掘待机',
         'blink-plain': '眨眼', 'blink-breath': '呼吸眨眼', 'blink-tilt': '歪头眨眼',
         'walk': '行走', 'sleep-start': '入睡', 'sleep-loop': '熟睡',
         'sleep-end': '醒来', 'win-chest': '胜利宝箱', 'lose-bag': '溃败行囊',
         'bulb-hint': '灯泡提示', 'start-explore': '出发'}


def package_review(dest, manifest, live):
    dest = Path(dest)
    (dest / 'before').mkdir(exist_ok=True)
    (dest / 'animated').mkdir(exist_ok=True)
    overview = Image.new('RGB', (1200, 330 * 4), '#181b21')
    draw = ImageDraw.Draw(overview)
    for index, (clip, meta) in enumerate(manifest.items()):
        shutil.copyfile(live / meta['file'], dest / 'before' / meta['file'])
        frames = []
        with Image.open(dest / meta['file']) as sheet:
            sheet = sheet.convert('RGBA')
            for f in range(meta['frames']):
                x, y = f % meta['columns'] * 300, f // meta['columns'] * 282
                frames.append(sheet.crop((x, y, x + 300, y + 282)))
        durations = [round((f+1)*1000/24)-round(f*1000/24) for f in range(len(frames))]
        target = dest / 'animated' / f'{clip}.webp'
        # Lossless reassembly preserves the already-encoded runtime pixels.
        frames[0].save(target, save_all=True, append_images=frames[1:],
                       duration=durations, loop=0, lossless=True, method=4)
        with Image.open(target) as result:
            assert result.mode == 'RGBA' and result.size == (300, 282)
        x, y = index % 4 * 300, index // 4 * 330
        base = Image.new('RGBA', (300, 282), (24, 27, 33, 255))
        # Mid-action makes the overview more useful than 13 similar first frames.
        overview.paste(Image.alpha_composite(base, frames[len(frames)//2]).convert('RGB'), (x, y+28))
        draw.text((x+10, y+10), clip, fill='white')
    overview.save(dest / 'overview.jpg', quality=94)
    template = Path(__file__).with_name('pet_cut_review.html').read_text()
    html = template.replace('__MANIFEST__', json.dumps(manifest)).replace('__NAMES__', json.dumps(NAMES))
    (dest / 'preview.html').write_text(html)
    print(f'Review package ready: {dest / "preview.html"}', flush=True)
