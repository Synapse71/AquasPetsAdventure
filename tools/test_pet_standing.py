import hashlib
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from pet_standing import SOURCE, ROOT, export_standing, standing_frame


class StandingFrameTests(unittest.TestCase):
    def test_runtime_frame_is_single_downsample_from_master(self):
        expected = Image.open(SOURCE).convert('RGBA').resize((300, 282), Image.Resampling.LANCZOS)
        actual = standing_frame(clean=False)
        self.assertEqual(actual.mode, 'RGBA')
        self.assertEqual(actual.size, (300, 282))
        self.assertEqual(actual.tobytes(), expected.tobytes())

    def test_export_is_lossless_and_preserves_source(self):
        before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        with tempfile.TemporaryDirectory(prefix='idle-standing-test-') as directory:
            target = Path(directory) / 'standing.png'
            export_standing(target)
            with Image.open(target) as actual:
                self.assertEqual(actual.tobytes(), standing_frame().tobytes())
                self.assertEqual(actual.getpixel((0, 0))[3], 0)
        self.assertEqual(hashlib.sha256(SOURCE.read_bytes()).hexdigest(), before)

    def test_source_art_cannot_be_overwritten(self):
        with self.assertRaises(ValueError):
            export_standing(ROOT / 'assets/gugugaga/still-standing-240.png')


if __name__ == '__main__':
    unittest.main()
