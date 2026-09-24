#!/usr/bin/env python3
"""Compile existing transparent frames into controllable runtime sheets (no source edits)."""
import json
import math
import argparse
import hashlib
import shutil
from pathlib import Path
from PIL import Image
from pet_clip import align_dx
from pet_matte import clean_edges
from pet_arrival_matte import clean_arrival_pockets
from pet_standing import export_standing

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public' / 'pet-sprites'
CLIPS = ['idle-magnifier', 'idle-digging', 'idle-selfie', 'blink-plain', 'blink-breath',
         'blink-tilt', 'walk', 'travel-map', 'travel-rest', 'travel-alert',
         'sleep-start', 'sleep-loop', 'sleep-end',
         'win-chest', 'lose-bag', 'bulb-hint', 'start-explore', 'arrive-a', 'arrive-b']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clean-edges', action='store_true', help='Opt-in white-matte removal; writes a separate candidate directory by default')
    parser.add_argument('--output', type=Path, help='Explicit output directory (must not be a source frames directory)')
    parser.add_argument('--clips', nargs='+', choices=CLIPS, default=CLIPS)
    parser.add_argument('--review-package', action='store_true', help='Also export source-size frames, provenance and an offline visual review page; requires a separate output directory')
    args = parser.parse_args()
    dest = args.output or (ROOT / 'artifacts/pet-sprites-clean' if args.clean_edges else DEST)
    if args.review_package and (dest.resolve() == DEST.resolve() or DEST.resolve() in dest.resolve().parents):
        raise ValueError('Review packages must not be written to live game resources')
    if (ROOT / 'assets').resolve() == dest.resolve() or (ROOT / 'assets').resolve() in dest.resolve().parents:
        raise ValueError('Runtime output must not overwrite source assets')
    dest.mkdir(parents=True, exist_ok=True)
    export_standing(dest / 'standing.png', clean=args.clean_edges)
    manifest = {}
    provenance = []
    width, height, columns = 300, 282, 10
    for clip in args.clips:
        files = sorted((ROOT / 'assets' / 'gugugaga' / clip / 'frames').glob('frame_*.png'))
        if not files:
            raise RuntimeError(f'Missing frames: {clip}')
        # Only the in-place walk is aligned; preserve the source poses of other clips.
        dx = align_dx(clip, [str(f) for f in files])[0] if clip == 'walk' else 0
        rows = math.ceil(len(files) / columns)
        sheet = Image.new('RGBA', (width * columns, height * rows))
        for i, file in enumerate(files):
            with Image.open(file) as source:
                frame = source.convert('RGBA')
                if frame.size != (960, 902):
                    raise RuntimeError(f'Unexpected frame size: {file}')
                if args.clean_edges:
                    if clip in ('arrive-a', 'arrive-b'):
                        frame = clean_arrival_pockets(frame)
                    frame = clean_edges(frame)
                if args.review_package:
                    # Export before runtime-only walk alignment and resizing.
                    target_frame = dest / 'frames-960' / clip / file.name
                    target_frame.parent.mkdir(parents=True, exist_ok=True)
                    unchanged = frame.tobytes() == source.convert('RGBA').tobytes()
                    if unchanged:
                        shutil.copyfile(file, target_frame)
                    else:
                        frame.save(target_frame)
                    provenance.append(dict(clip=clip, frame=file.name,
                        source_sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
                        output_sha256=hashlib.sha256(target_frame.read_bytes()).hexdigest(),
                        pixels_unchanged=unchanged))
                if dx:
                    shifted = Image.new('RGBA', frame.size)
                    shifted.paste(frame, (dx, 0))
                    frame = shifted
                frame = frame.resize((width, height), Image.Resampling.LANCZOS)
                sheet.paste(frame, ((i % columns) * width, (i // columns) * height))
        target = dest / f'{clip}.webp'
        sheet.save(target, quality=70, method=6)
        with Image.open(target) as result:
            assert result.mode == 'RGBA' and result.size == sheet.size
        manifest[clip] = dict(file=target.name, frames=len(files), width=width,
                              height=height, columns=columns, fps=24,
                              loop=clip in ['walk', 'sleep-loop'])
        print(f'{clip}: {len(files)} frames, {target.stat().st_size // 1024} KiB', flush=True)
    (dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if args.review_package:
        (dest / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
        from pet_cut_review import package_review
        package_review(dest, manifest, DEST)

if __name__ == '__main__':
    main()
