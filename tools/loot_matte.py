"""抠图：外部背景 + 真孔洞 → 透明；物体内部的浅色高光 → 保留。

主判据是**中位明度与背景的差**，实测区分度最大：
  真孔洞 Δ 在 ±1.3 以内（它就是透过物体看到的背景），
  浅色高光是画上去的，Δ 在 ±3.7 以上（银手镯高光 +4.7）。
边界深色占比只当兜底，不能当主判据——真孔洞 0.20~0.28、高光 0.11，两者挨得太近，
阈值设在 0.25 会把玩具无人机保护圈的孔洞切成一半抠一半不抠（实际发生过）。
"""
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

def matte(q, near_bg=14, lum_tol=2, border_dark=0.15, dark_lum=120, min_px=80):
    W,H=q.size
    m=q.copy()
    for c in [(1,1),(W-2,1),(1,H-2),(W-2,H-2)]:
        ImageDraw.floodfill(m,c,(255,0,255),thresh=26)
    a=np.asarray(m)
    outer=(a[:,:,0]==255)&(a[:,:,1]==0)&(a[:,:,2]==255)
    o=np.asarray(q).astype(int); bg=o[2,2]; bglum=bg.mean(); lum=o[:,:,:3].mean(2)
    cand=(np.abs(o-bg).max(2)<=near_bg)&~outer
    lab,n=ndimage.label(cand)
    holes=np.zeros_like(outer)
    for i in range(1,n+1):
        r=lab==i
        if r.sum()<min_px: continue
        if abs(np.median(lum[r])-bglum)>lum_tol: continue
        b=ndimage.binary_dilation(r)&~r
        if b.sum() and (lum[b]<dark_lum).mean()>=border_dark:
            holes|=r
    alpha=np.where(outer|holes,0,255).astype('uint8')
    r=q.convert("RGBA"); r.putalpha(Image.fromarray(alpha))
    return r.crop(r.getbbox())

def quads(path):
    im=Image.open(path).convert("RGB"); w,h=im.size; hw,hh=w//2,h//2
    return [im.crop(b) for b in [(0,0,hw,hh),(hw,0,w,hh),(0,hh,hw,h),(hw,hh,w,h)]]
