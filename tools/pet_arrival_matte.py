"""Clip-specific enclosed white-background cleanup, before generic edge unmixing.

These gates are reviewed for the two 960x902 arrival clips only. They are not
a general white-object remover: eyes, belly, hat and tool highlights stay intact.
Source frames and their alignment are never overwritten.
"""
import numpy as np
from PIL import Image
from scipy import ndimage


def clean_arrival_pockets(image):
    if image.size != (960, 902):
        raise ValueError('Arrival matte requires original 960x902 frames')
    pixels = np.array(image.convert('RGBA'))
    rgb = pixels[..., :3].astype(float)
    white = (rgb.min(2) > 220) & (np.ptp(rgb, axis=2) < 20) & (pixels[..., 3] == 255)
    labels, _ = ndimage.label(white)
    for label, box in enumerate(ndimage.find_objects(labels), 1):
        if box is None:
            continue
        region = labels[box] == label
        yy, xx = np.nonzero(region)
        x, y = xx.mean() + box[1].start, yy.mean() + box[0].start
        # Spatial gates exclude the face and belly, and the pickaxe at left.
        if (region.sum() >= 12 and
                ((260 < x < 380 and 380 < y < 545 and box[0].stop < 580)
                 or (600 < x < 710 and 380 < y < 600 and box[0].stop < 610))):
            pixels[box][region, 3] = 0
    return Image.fromarray(pixels)
