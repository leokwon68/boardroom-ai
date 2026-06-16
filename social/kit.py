from PIL import Image, ImageDraw, ImageFont
IMP="/System/Library/Fonts/Supplemental/Impact.ttf"; ARI="/System/Library/Fonts/Supplemental/Arial Bold.ttf"
GOLD=(255,206,77,255); WHITE=(245,248,252,255); DIM=(150,160,180,255); BG=(10,11,16,255)
def ctext(d,W,y,t,f,fill):
    b=d.textbbox((0,0),t,font=f); d.text(((W-(b[2]-b[0]))/2,y),t,font=f,fill=fill)
# ---- avatar 1080 ----
img=Image.new("RGB",(1080,1080),BG[:3]); d=ImageDraw.Draw(img)
d.rounded_rectangle([300,300,780,780],radius=70,fill=GOLD)
d.text((360,300),"▦",font=ImageFont.truetype(IMP,360),fill=(12,13,18))
ctext(d,1080,820,"BOARDROOM",ImageFont.truetype(IMP,96),WHITE)
ctext(d,1080,940,"an AI board for your decisions",ImageFont.truetype(ARI,40),DIM)
img.save("avatar.png")
# ---- 3 post cards 1080 ----
posts=[("STOP DECIDING","ALONE.","A full AI board debates your call — then runs the plan."),
       ("$300/HR","CONSULTANT?","Your AI board. Unlimited. $39/mo."),
       ("ONE CHATBOT?","GET A BOARD.","Five AI execs argue it out, then execute.")]
for i,(h1,h2,sub) in enumerate(posts,1):
    im=Image.new("RGB",(1080,1080),BG[:3]); dd=ImageDraw.Draw(im)
    dd.rectangle([0,0,1080,14],fill=GOLD[:3])
    ctext(dd,1080,210,h1,ImageFont.truetype(IMP,130),WHITE)
    ctext(dd,1080,360,h2,ImageFont.truetype(IMP,150),GOLD)
    ctext(dd,1080,620,sub,ImageFont.truetype(ARI,48),WHITE)
    url="runboardroom.com"; fu=ImageFont.truetype(ARI,52)
    b=dd.textbbox((0,0),url,font=fu); uw=b[2]-b[0]; px=(1080-uw)/2-34; py=820
    dd.rounded_rectangle([px,py,px+uw+68,py+92],radius=46,fill=GOLD[:3])
    dd.text(((1080-uw)/2,py+20),url,font=fu,fill=(15,16,12))
    im.save(f"post{i}.png")
print("kit built")
