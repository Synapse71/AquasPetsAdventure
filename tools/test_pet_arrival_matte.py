"""Run with: python -m unittest discover -s tools -p 'test_pet*matte.py'."""
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from pet_arrival_matte import clean_arrival_pockets
from pet_matte import clean_edges


class ArrivalMatteTests(unittest.TestCase):
    def test_enclosed_background_and_protected_white_details(self):
        a = np.zeros((902, 960, 4), dtype=np.uint8)
        a[100:800, 150:750] = [40, 42, 45, 255]
        for y, x in [(430, 310), (420, 650), (350, 440), (550, 450), (420, 180)]:
            a[y:y+25, x:x+25] = [255, 255, 255, 255]
        source = Image.fromarray(a)
        b = np.asarray(clean_arrival_pockets(source))
        self.assertEqual(b[440, 320, 3], 0)
        self.assertEqual(b[430, 660, 3], 0)
        for y, x in [(350, 440), (550, 450), (420, 180)]:
            np.testing.assert_array_equal(b[y:y+25, x:x+25], a[y:y+25, x:x+25])
        np.testing.assert_array_equal(np.asarray(source), a)
        np.testing.assert_array_equal(b[..., :3], a[..., :3])
        self.assertTrue(np.all(b[..., 3] <= a[..., 3]))

    def test_wrong_canvas_rejected(self):
        with self.assertRaises(ValueError):
            clean_arrival_pockets(Image.new('RGBA', (300, 282)))

    def test_real_arrival_regression_when_source_assets_present(self):
        root = Path(__file__).resolve().parents[1] / 'assets/gugugaga'
        for clip in ['arrive-a', 'arrive-b']:
            files = sorted((root / clip / 'frames').glob('frame_*.png'))
            if not files:
                self.skipTest('Source art is intentionally not committed')
            original = Image.open(files[10]).convert('RGBA')
            legacy = np.asarray(clean_edges(original))
            result = np.asarray(clean_edges(clean_arrival_pockets(original)))
            # Central pixel in the enclosed white gap, not a silhouette edge.
            y, x = 475, 310
            self.assertEqual(legacy[y, x, 3], 255)
            self.assertEqual(result[y, x, 3], 0)
            np.testing.assert_array_equal(result[560:620, 420:490], legacy[560:620, 420:490])
            if clip == 'arrive-b':
                # Low head poses move the gap left/down; these were missed by
                # the first candidate's conservative bounding-box gate.
                for index in (28, 29, 30):
                    frame = Image.open(files[index]).convert('RGBA')
                    fixed = np.asarray(clean_edges(clean_arrival_pockets(frame)))
                    self.assertEqual(np.asarray(frame)[500, 270, 3], 255)
                    self.assertEqual(fixed[500, 270, 3], 0)


if __name__ == '__main__':
    unittest.main()
