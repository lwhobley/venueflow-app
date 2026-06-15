"""Generate 1024x1024 subscription images for App Store Connect."""
from PIL import Image, ImageDraw, ImageFont
import os

W = H = 1024
BG = (255, 255, 255)
SURF = (247, 249, 245)
BORDER = (229, 224, 214)
PRIMARY = (49, 132, 75)
SECOND = (189, 126, 43)
CHAR = (31, 36, 30)
MUTED = (107, 115, 104)

import sys
if sys.platform == "win32":
    FONTS = "C:/Windows/Fonts"
elif sys.platform == "darwin":
    FONTS = "/System/Library/Fonts/Supplemental"
else:
    FONTS = "/usr/share/fonts/truetype"

def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

f_brand = font("arialbd.ttf", 62)
f_tier = font("arialbd.ttf", 92)
f_price = font("arialbd.ttf", 84)
f_body = font("arial.ttf", 36)
f_small = font("arialbd.ttf", 28)

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "screenshots", "subscriptions"))
os.makedirs(OUT, exist_ok=True)

tiers = [
    ("team", "Team", "$99", "1-50 people", "One flat plan for your whole venue team."),
]

def center(draw, y, text, fnt, fill):
    draw.text(((W - draw.textlength(text, font=fnt)) / 2, y), text, font=fnt, fill=fill)

for slug, tier, price, users, desc in tiers:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([64, 64, W - 64, H - 64], radius=58, fill=SURF, outline=BORDER, width=4)
    d.rounded_rectangle([116, 120, W - 116, 296], radius=36, fill=PRIMARY)
    center(d, 164, "Venue Wrangler", f_brand, (255, 255, 255))

    center(d, 382, tier, f_tier, PRIMARY)
    center(d, 500, price, f_price, CHAR)
    center(d, 620, users, f_body, SECOND)
    center(d, 694, desc, f_body, MUTED)

    d.rounded_rectangle([230, 812, W - 230, 892], radius=30, fill=PRIMARY)
    center(d, 834, "Full access subscription", f_small, (255, 255, 255))

    out = os.path.join(OUT, f"{slug}.png")
    img.save(out, "PNG")
    print(out, img.size, img.mode)
