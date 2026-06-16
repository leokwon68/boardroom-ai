import sys
from PIL import Image, ImageDraw, ImageFont
out,h1,h2,sub = sys.argv[1:5]
W,H=1080,1920
IMP="/System/Library/Fonts/Supplemental/Impact.ttf"; ARI="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
img=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(img)
d.rectangle([0,0,W,430],fill=(7,8,12,235))
d.rectangle([0,1180,W,H],fill=(7,8,12,235))
def c(y,t,f,fill):
    b=d.textbbox((0,0),t,font=f); d.text(((W-(b[2]-b[0]))/2,y),t,font=f,fill=fill)
GOLD=(255,206,77,255); WHITE=(245,248,252,255); DIM=(176,184,201,255)
c(60,h1,ImageFont.truetype(IMP,104),WHITE)
c(178,h2,ImageFont.truetype(IMP,120),GOLD)
c(322,"an AI board that runs itself",ImageFont.truetype(ARI,34),DIM)
c(1240,sub,ImageFont.truetype(ARI,46),WHITE)
url="boardroom-cloud.vercel.app"; fu=ImageFont.truetype(ARI,46)
ub=d.textbbox((0,0),url,font=fu); uw=ub[2]-ub[0]; px=(W-uw)/2-32; py=1340
d.rounded_rectangle([px,py,px+uw+64,py+86],radius=43,fill=GOLD)
d.text(((W-uw)/2,py+18),url,font=fu,fill=(20,21,16,255))
img.save(out); print("ok")
