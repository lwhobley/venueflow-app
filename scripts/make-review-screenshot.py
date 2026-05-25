"""Generate a placeholder paywall review screenshot for App Store Connect
that matches the app's ACTUAL paywall UI (app/billing/paywall.tsx), which
uses the dark teal theme (lib/theme.ts designPalettes.dark).

Accurate to configured products: Starter $79.99 / Pro $149.99 /
Enterprise $299.99 — one 'pro' entitlement unlocks the whole app.
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 1920

# dark palette (lib/theme.ts designPalettes.dark)
BG = (7, 16, 21)            # #071015
SURFACE = (16, 30, 39)      # ~surface/#101E27
BORDER = (30, 58, 64)       # faint teal border
PRIMARY = (85, 240, 222)    # #55F0DE
CHARCOAL = (242, 250, 249)  # #F2FAF9
MUTED = (157, 179, 184)     # #9DB3B8
BTN_TEXT = (5, 28, 26)      # dark label on teal button

FONTS = "C:/Windows/Fonts/"
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

f_head = font("arialbd.ttf", 74)
f_sub = font("arial.ttf", 32)
f_title = font("arialbd.ttf", 44)
f_price = font("arialbd.ttf", 64)
f_desc = font("arial.ttf", 30)
f_btn = font("arialbd.ttf", 38)
f_link = font("arialbd.ttf", 32)
f_disc = font("arial.ttf", 26)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

PAD = 48  # screen padding (spacing.lg scaled)

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

# Header (left-aligned, like the real screen)
d.text((PAD, 64), "Choose your plan", font=f_head, fill=PRIMARY)
for i, line in enumerate(wrap("Start a 3-day free trial. Cancel anytime in your Apple account settings.", f_sub, W - 2*PAD)):
    d.text((PAD, 164 + i*42), line, font=f_sub, fill=MUTED)

tiers = [
    ("Starter", "$79.99"),
    ("Pro", "$149.99"),
    ("Enterprise", "$299.99"),
]
DESC = "Full access: scheduling, time clock, floor plan, reservations, bar stock, reports, and team chat."

cx0, cx1 = PAD, W - PAD
inner = cx1 - cx0 - 2*40  # card inner width (Card.Content padding ~40)
y = 300
card_gap = 36
for name, price in tiers:
    desc_lines = wrap(DESC, f_desc, inner)
    # card height: padding + title + price + desc lines + button + paddings
    ch = 40 + 56 + 12 + 74 + 16 + len(desc_lines)*40 + 20 + 90 + 40
    d.rounded_rectangle([cx0, y, cx1, y + ch], radius=20, fill=SURFACE, outline=BORDER, width=2)
    ty = y + 40
    tx = cx0 + 40
    d.text((tx, ty), name, font=f_title, fill=PRIMARY); ty += 64
    d.text((tx, ty), price, font=f_price, fill=CHARCOAL); ty += 84
    for line in desc_lines:
        d.text((tx, ty), line, font=f_desc, fill=MUTED); ty += 40
    ty += 18
    # contained button (teal pill, dark label)
    bx0, bx1 = tx, cx1 - 40
    by0, by1 = ty, ty + 84
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=18, fill=PRIMARY)
    lbl = "Start free trial"
    lw = d.textlength(lbl, font=f_btn)
    d.text(((bx0+bx1)/2 - lw/2, by0 + 22), lbl, font=f_btn, fill=BTN_TEXT)
    y += ch + card_gap

# Restore purchases (text button, primary)
ctext(y + 8, "Restore purchases", f_link, PRIMARY)
y += 90

# Auto-renew disclosure (muted, centered, wraps)
disc = "Subscriptions auto-renew monthly until cancelled. Payment is charged to your Apple ID; manage or cancel in Settings > Apple ID > Subscriptions."
for line in wrap(disc, f_disc, W - 2*PAD):
    ctext(y, line, f_disc, MUTED); y += 34
y += 14
ctext(y, "Terms (EULA)        Privacy", f_link, MUTED); y += 56
ctext(y, "Back", f_link, PRIMARY)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "screenshots", "review-paywall.png"))
img.save(out, "PNG")
print(out)
