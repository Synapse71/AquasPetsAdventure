"""Export app icon sizes from an approved transparent RGBA master; no background editing."""
from pathlib import Path
from PIL import Image
import sys
root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'assets/app-icon/aquamarine-master.png'
im = Image.open(source)
assert im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] == 0 and im.getchannel('A').getextrema()[1] >= 250, 'A true transparent RGBA master is required'
out = root / 'public/icons'
out.mkdir(parents=True, exist_ok=True)
for size in (16, 32, 48, 64, 128, 180, 192, 256, 512, 1024):
    im.resize((size, size), Image.Resampling.LANCZOS).save(out / f'aquamarine-{size}.png')
im.save(out / 'aquamarine.ico', sizes=[(s,s) for s in (16,32,48,64,128,256)])
im.save(root / 'assets/app-icon/aquamarine.icns', format='ICNS')
print('Exported 10 PNG sizes, ICO and ICNS')
