"""Generate a placeholder paywall review screenshot for App Store Connect.
Matches the app's actual paywall UI (app/billing/paywall.tsx, dark teal
theme) and uses an App-Store-accepted iPhone 6.5" resolution (1242x2688)
so ASC accepts the upload.

Products: Starter $79.99 / Pro $149.99 / Enterprise $299.99 — one 'pro'
entitlement unlocks the whole app.
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1242, 2688  # iPhone 6.5" — accepted IAP review screenshot size

# dark palette (lib/theme.ts designPalettes.dark)
BG = (7, 16, 21)
SURFACE = (16, 30, 39)
BORDER = (30, 58, 64)
PRIMARY = (85, 240, 222)
CHARCOAL = (242, 250, 249)
MUTED = (157, 179, 184)
BTN_TEXT = (5, 28, 26)

FONTS = "C:/Windows/Fonts/"
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

f_head = font("arialbd.ttf", 92)
f_sub = font("arial.ttf", 38)
f_title = font("arialbd.ttf", 54)
f_price = font("arialbd.ttf", 80)
f_perm = font("arial.ttf", 34)
f_desc = font("arial.ttf", 36)
f_btn = font("arialbd.ttf", 46)
f_link = font("arialbd.ttf", 38)
f_disc = font("arial.ttf", 30)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
PAD = 64

def wrap(text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def ctext(y, text, fnt, fill):
    w = d.textlength(text, font=fnt)
    d.text((W/2 - w/2, y), text, font=fnt, fill=fill)

# Header
d.text((PAD, 96), "Choose your plan", font=f_head, fill=PRIMARY)
sy = 224
for line in wrap("Start a 3-day free trial. Cancel anytime in your Apple account settings.", f_sub, W - 2*PAD):
    d.text((PAD, sy), line, font=f_sub, fill=MUTED); sy += 50

tiers = [("Starter", "$79.99"), ("Pro", "$149.99"), ("Enterprise", "$299.99")]
DESC = "Full access: scheduling, time clock, floor plan, reservations, bar stock, reports, and team chat."

cx0, cx1 = PAD, W - PAD
inner = cx1 - cx0 - 2*48
y = 400
card_gap = 56
for name, price in tiers:
    desc_lines = wrap(DESC, f_desc, inner)
    ch = 48 + 64 + 16 + 96 + 18 + len(desc_lines)*48 + 28 + 104 + 48
    d.rounded_rectangle([cx0, y, cx1, y + ch], radius=28, fill=SURFACE, outline=BORDER, width=3)
    tx, ty = cx0 + 48, y + 48
    d.text((tx, ty), name, font=f_title, fill=PRIMARY); ty += 80
    d.text((tx, ty), price, font=f_price, fill=CHARCOAL)
    pw = d.textlength(price, font=f_price)
    d.text((tx + pw + 16, ty + 38), "/ month", font=f_perm, fill=MUTED); ty += 114
    for line in desc_lines:
        d.text((tx, ty), line, font=f_desc, fill=MUTED); ty += 48
    ty += 28
    bx0, bx1, by0, by1 = tx, cx1 - 48, ty, ty + 104
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=22, fill=PRIMARY)
    lbl = "Start free trial"; lw = d.textlength(lbl, font=f_btn)
    d.text(((bx0+bx1)/2 - lw/2, by0 + 28), lbl, font=f_btn, fill=BTN_TEXT)
    y += ch + card_gap

ctext(y + 16, "Restore purchases", f_link, PRIMARY)
y += 120
disc = "Subscriptions auto-renew monthly until cancelled. Payment is charged to your Apple ID; manage or cancel in Settings > Apple ID > Subscriptions."
for line in wrap(disc, f_disc, W - 2*PAD):
    ctext(y, line, f_disc, MUTED); y += 40
y += 20
ctext(y, "Terms (EULA)        Privacy", f_link, MUTED)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "screenshots", "review-paywall.png"))
img.save(out, "PNG")
print(out, img.size)
