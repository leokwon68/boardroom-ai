import sys
from PIL import Image, ImageDraw, ImageFont
out, h1, h2, sub = sys.argv[1:5]
W, H = 1080, 1920
IMP = "/System/Library/Fonts/Supplemental/Impact.ttf"
ARI = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# top hook band + bottom CTA band (debate bubbles show through the middle)
top = Image.new("RGBA", (W, 430), (0, 0, 0, 0)); dt = ImageDraw.Draw(top)
dt.rectangle([0, 0, W, 430], fill=(7, 8, 12, 205)); img.alpha_composite(top, (0, 0))
d.rectangle([0, 1560, W, H], fill=(7, 8, 12, 215))

def c(y, text, font, fill):
    b = d.textbbox((0, 0), text, font=font); w = b[2] - b[0]
    d.text(((W - w) / 2, y), text, font=font, fill=fill)

GOLD = (255, 206, 77, 255); WHITE = (245, 248, 252, 255)
c(70, h1, ImageFont.truetype(IMP, 108), WHITE)
c(195, h2, ImageFont.truetype(IMP, 124), GOLD)
# tiny kicker under hook
c(345, "an AI board that runs itself", ImageFont.truetype(ARI, 36), (180, 188, 205, 255))
# bottom: emphasis + url pill
c(1615, sub, ImageFont.truetype(ARI, 46), WHITE)
url = "boardroom-cloud.vercel.app"; fu = ImageFont.truetype(ARI, 44)
ub = d.textbbox((0, 0), url, font=fu); uw = ub[2] - ub[0]
px, py = (W - uw) / 2 - 30, 1715
d.rounded_rectangle([px, py, px + uw + 60, py + 80], radius=40, fill=GOLD)
d.text(((W - uw) / 2, py + 17), url, font=fu, fill=(20, 21, 16, 255))
img.save(out); print("saved", out)
