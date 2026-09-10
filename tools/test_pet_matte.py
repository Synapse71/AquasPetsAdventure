"""Synthetic known-ground-truth tests; run with the art venv's Python."""
import unittest
import numpy as np
from PIL import Image
from pet_matte import clean_edges, edge_metrics


def sample(soft=False):
    # A dark block with a white interior detail, rendered on white before matting.
    rgba = np.zeros((64, 64, 4), dtype=np.uint8)
    rgba[12:52, 12:52] = [40, 45, 50, 255]
    rgba[24:40, 24:40] = [245, 240, 235, 255]
    rgba[11, 12:52] = [148, 150, 153, 128 if soft else 255]
    return Image.fromarray(rgba)


class EdgeTests(unittest.TestCase):
    def test_hard_white_fringe_recovers_coverage_and_dark_color(self):
        original = sample()
        result = np.asarray(clean_edges(original))
        self.assertTrue(120 <= result[11, 30, 3] <= 136)
        self.assertLess(np.max(result[11, 30, :3]), 60)
        # On black, the known ground truth is approximately .5*(40,45,50).
        composed = result[11, 30, :3] * (result[11, 30, 3] / 255)
        self.assertLess(np.max(np.abs(composed - [20, 22.5, 25])), 4)

    def test_existing_soft_alpha_is_not_multiplied_twice(self):
        result = np.asarray(clean_edges(sample(soft=True), include_soft=True))
        self.assertGreater(result[11, 30, 3], 120)  # not 64!
        self.assertLessEqual(result[11, 30, 3], 128)

    def test_interior_white_is_bit_exact_and_source_is_unchanged(self):
        original = sample()
        snapshot = np.asarray(original).copy()
        result = clean_edges(original)
        np.testing.assert_array_equal(np.asarray(original), snapshot)
        np.testing.assert_array_equal(np.asarray(result)[24:40, 24:40], snapshot[24:40, 24:40])
        self.assertEqual(edge_metrics(original, result)['interior_changed_pixels'], 0)

    def test_does_not_remove_thin_isolated_features(self):
        original = np.asarray(sample()).copy()
        original[3:5, 20:40] = [110, 115, 120, 255]
        result = np.asarray(clean_edges(Image.fromarray(original)))
        np.testing.assert_array_equal(result[3:5, 20:40], original[3:5, 20:40])

    def test_genuine_light_object_is_protected(self):
        original = np.zeros((64, 64, 4), dtype=np.uint8)
        original[12:52, 12:52] = [240, 240, 240, 255]
        result = np.asarray(clean_edges(Image.fromarray(original)))
        np.testing.assert_array_equal(result, original)

    def test_transparent_pixels_never_become_visible(self):
        original = sample()
        a, b = np.asarray(original), np.asarray(clean_edges(original))
        self.assertTrue(np.all(b[a[..., 3] == 0, 3] == 0))
        self.assertTrue(np.all(b[..., 3] <= a[..., 3]))

    def test_empty_or_no_core_input_is_safe(self):
        for size in [(64, 64), (3, 3)]:
            original = Image.new('RGBA', size, (255, 255, 255, 0))
            np.testing.assert_array_equal(clean_edges(original), original)

    def test_alpha_fog_removed_outside_only(self):
        original = np.asarray(sample()).copy()
        original[0, 0] = [240, 240, 240, 5]
        self.assertEqual(np.asarray(clean_edges(Image.fromarray(original), include_soft=True))[0, 0, 3], 0)

    def test_soft_mattes_are_byte_exact_by_default(self):
        original = sample(soft=True)
        np.testing.assert_array_equal(clean_edges(original), original)

    def test_closed_narrow_white_gap_becomes_transparent_not_black_paint(self):
        a = np.zeros((100, 100, 4), dtype=np.uint8)
        a[10:90, 10:90] = [40, 45, 50, 255]
        # Diagonal gap: bounding box is wide, but the actual pocket is thin.
        for y in range(20, 40):
            a[y, y:y+3] = [245, 245, 245, 255]
        b = np.asarray(clean_edges(Image.fromarray(a)))
        self.assertTrue(np.all(b[25, 25:28, 3] < 30))
        self.assertLess(b[35, 36, 3], 30)
        np.testing.assert_array_equal(b[60:80, 60:80], a[60:80, 60:80])

    def test_deep_thin_white_highlight_is_protected(self):
        a = np.zeros((160, 160, 4), dtype=np.uint8)
        a[10:150, 10:150] = [40, 45, 50, 255]
        a[70:80, 75:78] = [245, 245, 245, 255]
        np.testing.assert_array_equal(clean_edges(Image.fromarray(a)), a)

    def test_separate_bright_thin_symbol_is_protected(self):
        a = np.asarray(sample()).copy()
        a[3:5, 20:40] = [240, 240, 240, 255]
        b = np.asarray(clean_edges(Image.fromarray(a)))
        np.testing.assert_array_equal(b[3:5, 20:40], a[3:5, 20:40])


if __name__ == '__main__':
    unittest.main()
