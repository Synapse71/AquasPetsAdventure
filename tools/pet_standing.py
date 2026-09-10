#!/usr/bin/env python3
"""Extract the fixed pose from the same high-resolution master as idle animation."""
import argparse
from pathlib import Path
from PIL import Image
from pet_matte import clean_edges

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/gugugaga/idle-magnifier/frames/frame_000.png'
RUNTIME_SIZE = (300, 282)


def standing_frame(clean=True):
    with Image.open(SOURCE) as source:
        if source.size != (960, 902):
            raise ValueError('Standing master must retain the common 960 × 902 canvas')
        frame = source.convert('RGBA')
    if clean:
        frame = clean_edges(frame)
    # Same canvas and single downsample as build-pet-sprites; no alpha crop,
    # upscaling of the old 240px thumbnail, sharpening or anchor adjustment.
    return frame.resize(RUNTIME_SIZE, Image.Resampling.LANCZOS)


def export_standing(target, clean=True):
    target = Path(target)
    if target.resolve() == SOURCE.resolve() or (ROOT / 'assets').resolve() in target.resolve().parents:
        raise ValueError('Do not overwrite source art')
    target.parent.mkdir(parents=True, exist_ok=True)
    standing_frame(clean).save(target, format='PNG')
    print(f'standing: {RUNTIME_SIZE[0]} × {RUNTIME_SIZE[1]}, RGBA PNG → {target}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/pet-sprites/standing.png')
    args = parser.parse_args()
    export_standing(args.output)
