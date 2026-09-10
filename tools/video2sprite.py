#!/usr/bin/env python3
"""咕咕嘎嘎素材流水线：AI 生成视频 → 透明无缝循环动画

用法:
    python3 video2sprite.py <输入视频.mp4> <输出目录> [--no-loop-scan]

依赖: ffmpeg (brew), rembg + pillow + numpy (建议 venv, isnet-anime 模型)
流程: 拆帧 → PSNR 扫循环点 → rembg 抠底 → 主连通域隔离 →
      地面层阴影按列清除 → alpha 并集裁边 → 全分辨率帧 + 动画 WebP
坑位记录:
  - rembg 全画面有 alpha 1~8 薄雾，连通域必须用强掩膜 (alpha>=100) 做种子
  - rembg 会部分保留脚下烘焙阴影且逐帧程度不同 (闪烁来源)，靠空间规则清除,
    颜色指纹会误伤深色服装/道具
  - 交叉淡入缝循环会重影，依赖"模型步态天然闭环" (PSNR 扫描找回归帧)
"""
import subprocess, sys, os, glob, tempfile

def sh(cmd):
    subprocess.run(cmd, shell=True, check=True)

def psnr(a, b):
    out = subprocess.run(
        f'ffmpeg -i "{a}" -i "{b}" -lavfi psnr -f null - 2>&1',
        shell=True, capture_output=True, text=True).stdout
    for tok in out.split():
        if tok.startswith('average:'):
            return float(tok.split(':')[1])
    return 0.0

def find_loop(small_dir):
    """返回与第 1 帧最相似的后续帧号 (>= 桌宠最短周期 12 帧)"""
    frames = sorted(glob.glob(f'{small_dir}/f*.png'))
    best, best_p = None, 0
    for i in range(12, len(frames)):
        p = psnr(frames[0], frames[i])
        if p > best_p:
            best, best_p = i, p
    return best, best_p

def main():
    video, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(f'{outdir}/frames', exist_ok=True)
    tmp = tempfile.mkdtemp()

    # 1) 小图拆帧扫循环点
    sh(f'ffmpeg -y -v error -i "{video}" -vf scale=120:120 {tmp}/f%03d.png')
    loop_end, p = find_loop(tmp)
    print(f'循环点: 第{loop_end + 1}帧 ≈ 第1帧 (PSNR {p:.1f})，周期 {loop_end} 帧')
    if p < 17:
        print('!! PSNR < 17，循环可能有跳变，建议肉眼确认首尾帧')

    # 2) 全分辨率拆循环段
    sh(f'ffmpeg -y -v error -i "{video}" -vf "select=\'lt(n,{loop_end})\'" '
       f'-vsync vfr {tmp}/full%03d.png')

    # 3) rembg + 清理（延迟 import，rembg 首次加载慢）
    from rembg import remove, new_session
    from PIL import Image
    import numpy as np

    def dilate(m, it=1):
        for _ in range(it):
            d = m.copy()
            for ax, sh_ in ((0, 1), (0, -1), (1, 1), (1, -1)):
                d |= np.roll(m, sh_, axis=ax)
            m = d
        return m

    def main_component(strong):
        small = strong[::4, ::4]
        seed = np.zeros_like(small)
        sr = int(small.sum(1).argmax()); seed[sr] = small[sr]
        grown = seed
        for _ in range(600):
            nxt = dilate(grown) & small
            if (nxt == grown).all(): break
            grown = nxt
        big = np.zeros_like(strong)
        big[::4, ::4] = grown
        return dilate(big, 4)

    session = new_session('isnet-anime')
    cleaned = []
    for pth in sorted(glob.glob(f'{tmp}/full*.png')):
        arr = np.asarray(remove(Image.open(pth).convert('RGBA'),
                                session=session)).copy()
        alpha = arr[:, :, 3]
        arr[~main_component(alpha >= 100), 3] = 0
        alpha = arr[:, :, 3]
        h, w = arr.shape[:2]
        y_band = int(h * 0.80)
        rgb = arr[:, :, :3].astype(int)
        sat = rgb.max(2) - rgb.min(2)
        lum = rgb.mean(2)
        solid = (alpha > 200) & ((lum < 50) | (sat > 50))
        # 阴影灰的实测亮度 47~102；上限 140 防止贴到画面底边的白色部位
        # (如特写构图的白肚子) 被整列误清
        gray = (alpha > 0) & (sat < 25) & (lum >= 55) & (lum <= 140)
        for x in range(w):
            cs = np.where(solid[y_band:, x])[0]
            floor = (y_band + cs.max() + 2) if cs.size else y_band
            g = np.where(gray[floor:, x])[0]
            if g.size:
                arr[floor + g, x, 3] = 0
        cleaned.append(Image.fromarray(arr))

    # 4) 统一裁边 + 输出
    alphas = [np.asarray(f)[:, :, 3] for f in cleaned]
    union = np.zeros_like(alphas[0], dtype=bool)
    for a in alphas: union |= (a > 8)
    ys, xs = np.where(union)
    m = 12
    box = (max(0, xs.min() - m), max(0, ys.min() - m),
           min(union.shape[1], xs.max() + m), min(union.shape[0], ys.max() + m))
    webp = []
    for i, f in enumerate(cleaned):
        c = f.crop(box)
        c.save(f'{outdir}/frames/frame_{i:03d}.png')
        webp.append(c.resize((380, c.height * 380 // c.width), Image.LANCZOS))
    webp[0].save(f'{outdir}/anim.webp', save_all=True, append_images=webp[1:],
                 duration=1000 // 24, loop=0, quality=85, method=4)
    print(f'完成: {len(cleaned)} 帧 → {outdir}/anim.webp + frames/')

if __name__ == '__main__':
    main()
