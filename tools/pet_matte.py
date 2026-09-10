"""Conservative white-matte decontamination for existing transparent pet frames.

The input RGBA is never modified. Geometry/canvas/pose are preserved. Only a
narrow silhouette band and small near-silhouette matte pockets are eligible for
color unmixing. This is not a general-purpose background remover.
"""
import numpy as np
from PIL import Image
from scipy import ndimage


def _matte_pockets(rgb, alpha, inside, components):
    """Find narrow neutral-white remnants, not broad artwork highlights.

    Work in source pixels. Whole bright components are judged before dilation,
    so a large white object cannot become eligible just at its boundary.
    References must be dark pixels in the same foreground component.
    """
    bright = ((rgb.min(2) > 175) & (np.ptp(rgb, axis=2) < 30)
              & (alpha >= .94))
    labels, _ = ndimage.label(bright)
    thickness = ndimage.distance_transform_edt(bright)
    seeds = np.zeros(alpha.shape, dtype=bool)
    for label, box in enumerate(ndimage.find_objects(labels), 1):
        if box is None:
            continue
        region = labels[box] == label
        if (region.sum() <= 300
                and thickness[box][region].max() <= 4
                and inside[box][region].max() <= 32):
            seeds[box] |= region
    dark = (rgb.mean(2) < 100) & (alpha >= .94) & (inside > 1)
    if not dark.any() or not seeds.any():
        return np.zeros(alpha.shape, bool), rgb
    distance, nearest = ndimage.distance_transform_edt(~dark, return_indices=True)
    same = (components > 0) & (components == components[nearest[0], nearest[1]])
    # Include the gray antialiasing immediately surrounding each white pocket.
    band = ndimage.binary_dilation(seeds, iterations=3)
    eligible = band & same & (distance <= 8) & (alpha > 0)
    return eligible, rgb[nearest[0], nearest[1]]


def clean_edges(image, radius=6.0, background=(255, 255, 255), include_soft=False):
    """Estimate white coverage from a nearby opaque interior color.

    C = t*F + (1-t)*B. The existing alpha is an upper bound, not a second
    coverage to multiply (multiplication would double-erode rembg edges).
    Uncertain/bright references and colors not explained by white mixing are
    left unchanged. Existing soft mattes are preserved by default: legacy rembg
    clips need different treatment and their pillow/highlight edges can worsen.
    include_soft is an experimental opt-in, not used by the packaging CLI.
    """
    source = np.asarray(image.convert('RGBA'))
    out = source.copy()
    if not include_soft and np.any((source[..., 3] > 0) & (source[..., 3] < 255)):
        return Image.fromarray(out)
    rgb = source[..., :3].astype(np.float32)
    alpha = source[..., 3].astype(np.float32) / 255
    strong = alpha >= .5
    if not strong.any() or radius <= 0:
        return Image.fromarray(out)
    inside = ndimage.distance_transform_edt(strong)
    outside = ndimage.distance_transform_edt(~strong)
    core = (inside > radius) & (alpha >= .94)
    if not core.any():
        return Image.fromarray(out)
    distance, nearest = ndimage.distance_transform_edt(~core, return_indices=True)
    components, _ = ndimage.label(alpha > 8 / 255)
    same_component = (components > 0) & (components == components[nearest[0], nearest[1]])
    foreground = rgb[nearest[0], nearest[1]]
    pocket_band, pocket_reference = _matte_pockets(rgb, alpha, inside, components)
    foreground = np.where(pocket_band[..., None], pocket_reference, foreground)
    bg = np.array(background, dtype=np.float32)
    direction = bg - foreground
    denom = np.sum(direction * direction, axis=2)
    coverage = np.clip(np.sum((bg - rgb) * direction, axis=2) / np.maximum(denom, 1), 0, 1)
    predicted = coverage[..., None] * foreground + (1 - coverage[..., None]) * bg
    residual = np.sqrt(np.mean((rgb - predicted) ** 2, axis=2))
    band = (inside <= radius) & (outside <= radius) & (distance <= radius * 2 + 1)
    eligible = (((band & same_component) | pocket_band) & (alpha > 0) & (foreground.mean(2) < 180)
                & ((rgb - foreground).mean(2) > 6) & (residual < 12)
                & (coverage < .98))
    recovered = np.clip((rgb - (1 - coverage[..., None]) * bg)
                        / np.maximum(coverage[..., None], .02), 0, 255)
    out[eligible, :3] = np.rint(recovered[eligible]).astype(np.uint8)
    out[eligible, 3] = np.rint(np.minimum(alpha[eligible], coverage[eligible]) * 255).astype(np.uint8)
    # Remove nearly invisible exterior rembg mist, not semitransparent artwork.
    out[(alpha <= 8 / 255) & ~strong, 3] = 0
    return Image.fromarray(out)


def edge_metrics(before, after):
    """Signals for review, not a claim that every bright edge pixel is a defect."""
    a = np.asarray(before.convert('RGBA'))
    b = np.asarray(after.convert('RGBA'))
    strong = a[..., 3] >= 128
    interior = ndimage.distance_transform_edt(strong) > 6
    def centroid(arr):
        y, x = np.where(arr[..., 3] > 60)
        return (float(x.mean()), float(y.mean())) if len(x) else (0., 0.)
    def bright_rim(arr):
        mask = arr[..., 3] > 60
        rim = mask & ~ndimage.binary_erosion(mask, iterations=2)
        return int(((arr[..., :3].min(2) > 180) & rim).sum())
    ac, bc = centroid(a), centroid(b)
    return {
        'changed_pixels': int(np.any(a != b, axis=2).sum()),
        'interior_changed_pixels': int((np.any(a != b, axis=2) & interior).sum()),
        'deep_interior_changed_pixels': int((np.any(a != b, axis=2) & (ndimage.distance_transform_edt(strong) > 35)).sum()),
        'visible_area_change_percent': round(((b[..., 3] > 60).sum() / max(1, (a[..., 3] > 60).sum()) - 1) * 100, 4),
        'centroid_shift_px': round(float(np.hypot(ac[0] - bc[0], ac[1] - bc[1])), 4),
        'bright_rim_before': bright_rim(a), 'bright_rim_after': bright_rim(b),
    }
