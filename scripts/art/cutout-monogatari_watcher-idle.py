import numpy as np, sys
from PIL import Image
from scipy import ndimage as ndi
def cutout(im, tol=10, erode=1, feather=0.8, protect=None):
    a=np.asarray(im.convert('RGB')).astype(float)
    bg=np.median(np.concatenate([a[:8].reshape(-1,3),a[-8:].reshape(-1,3),a[:,:8].reshape(-1,3),a[:,-8:].reshape(-1,3)]),axis=0)
    d=np.abs(a-bg).max(axis=2)
    lab,n=ndi.label(d<=tol)
    edge=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
    keep_px=np.zeros(lab.shape,bool)
    if protect:
        px0,py0,px1,py1=protect
        for i in range(1,n+1):
            if i in edge: continue
            ys,xs=np.where(lab==i)
            if len(ys)>0 and px0<=xs.mean()<=px1 and py0<=ys.mean()<=py1: keep_px|=(lab==i)
    cms=ndi.center_of_mass(np.ones(lab.shape),lab,range(1,n+1))
    for i,sz in enumerate(ndi.sum(np.ones(lab.shape),lab,range(1,n+1)),1):
        if i in edge or keep_px[lab==i].any(): continue
        if sz>=12 or (sz>3 and cms[i-1][0]<330): edge.add(i)
    fg=~np.isin(lab,list(edge))
    # source has a bright halo ring around dark outlines: drop near-white, unsaturated fringe pixels touching the background
    rgb=a; mn=rgb.min(axis=2); mx=rgb.max(axis=2)
    halo=(mn>=244)&((mx-mn)<7)
    for _ in range(3):
        touch=ndi.binary_dilation(~fg,iterations=1)
        fg=fg&~(touch&halo)
    lab2,n2=ndi.label(fg); sizes=ndi.sum(fg,lab2,range(1,n2+1))
    keep=np.zeros(n2+1,bool); keep[1:]=sizes>200; fg=keep[lab2]
    fg=ndi.binary_closing(fg,iterations=1)|fg
    core=ndi.binary_erosion(fg,iterations=erode+1) if erode else fg
    # nearest core colour for everything outside core
    idx=ndi.distance_transform_edt(~core,return_distances=False,return_indices=True)
    col=a[idx[0],idx[1]]
    m=ndi.binary_erosion(fg,iterations=erode) if erode else fg
    al=ndi.gaussian_filter(m.astype(float),feather)
    al=np.clip((al-0.15)/0.7,0,1)
    out=np.dstack([col,al*255]).clip(0,255).astype(np.uint8)
    return Image.fromarray(out,'RGBA')
if __name__=='__main__':
    im=Image.open(sys.argv[1]); o=cutout(im,float(sys.argv[3]) if len(sys.argv)>3 else 10,protect=(478,130,572,212))
    o.save(sys.argv[2])
