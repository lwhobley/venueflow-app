"""Generate App Store screenshots that show Venue Wrangler in use.

Apple rejected the previous set because they were promotional panels rather
than app UI. These images are full-screen, app-like captures with navigation,
cards, controls, and realistic in-app data.
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1284, 2778
BG = (255, 255, 255)
SURFACE = (255, 255, 255)
SOFT = (247, 248, 245)
BORDER = (229, 224, 214)
PRIMARY = (47, 125, 70)
SECONDARY = (183, 117, 42)
CHARCOAL = (35, 36, 31)
MUTED = (111, 106, 95)
SUCCESS = (47, 125, 70)
WARNING = (152, 106, 34)
DANGER = (184, 80, 71)
INFO = (73, 122, 120)

FONTS = "C:/Windows/Fonts"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


f_brand = font("arialbd.ttf", 42)
f_h1 = font("arialbd.ttf", 64)
f_h2 = font("arialbd.ttf", 42)
f_h3 = font("arialbd.ttf", 32)
f_body = font("arial.ttf", 30)
f_body_b = font("arialbd.ttf", 30)
f_small = font("arial.ttf", 24)
f_small_b = font("arialbd.ttf", 24)
f_kpi = font("arialbd.ttf", 58)
f_tab = font("arialbd.ttf", 22)

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "screenshots", "appstore"))
os.makedirs(OUT, exist_ok=True)


def wrap(draw, text, fnt, width):
    words, lines, current = text.split(), [], ""
    for word in words:
        trial = (current + " " + word).strip()
        if draw.textlength(trial, font=fnt) <= width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def card(draw, xy, radius=18, fill=SURFACE, outline=BORDER, width=2):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def pill(draw, x, y, text, fill, fg=CHARCOAL):
    tw = draw.textlength(text, font=f_small_b)
    draw.rounded_rectangle([x, y, x + tw + 34, y + 42], radius=21, fill=fill)
    draw.text((x + 17, y + 9), text, font=f_small_b, fill=fg)
    return tw + 34


def app_screen(title, subtitle, active_tab):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # Status bar
    d.text((74, 34), "9:41", font=f_body_b, fill=(0, 0, 0))
    d.rounded_rectangle([1090, 48, 1162, 78], radius=7, outline=(0, 0, 0), width=3)
    d.rectangle([1164, 58, 1172, 68], fill=(0, 0, 0))
    d.rounded_rectangle([1096, 54, 1148, 72], radius=5, fill=(0, 0, 0))
    # Header
    d.text((64, 128), "Venue Wrangler", font=f_brand, fill=PRIMARY)
    d.text((64, 194), title, font=f_h1, fill=PRIMARY)
    for i, line in enumerate(wrap(d, subtitle, f_body, W - 128)):
        d.text((64, 274 + i * 40), line, font=f_body, fill=MUTED)
    # Bottom tab bar
    d.line([0, H - 176, W, H - 176], fill=BORDER, width=2)
    tabs = ["Home", "Schedule", "Clock", "Floor", "Chat"]
    tab_w = W / len(tabs)
    for i, tab in enumerate(tabs):
        cx = int(i * tab_w + tab_w / 2)
        color = PRIMARY if tab == active_tab else MUTED
        d.ellipse([cx - 16, H - 136, cx + 16, H - 104], fill=color)
        label_w = d.textlength(tab, font=f_tab)
        d.text((cx - label_w / 2, H - 88), tab, font=f_tab, fill=color)
    return img, d


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    return path


paths = []

# 1. Dashboard
img, d = app_screen("Today", "Live operations for The Green Room.", "Home")
y = 390
kpis = [
    ("Clocked in", "12", "3 late alerts", PRIMARY),
    ("Covers today", "184", "42 upcoming", SECONDARY),
    ("Open shifts", "3", "2 pending swaps", WARNING),
    ("Labor target", "27%", "on pace", INFO),
]
for idx, (label, value, sub, color) in enumerate(kpis):
    x = 64 + (idx % 2) * 588
    yy = y + (idx // 2) * 258
    card(d, [x, yy, x + 540, yy + 220])
    d.text((x + 34, yy + 28), label, font=f_small_b, fill=MUTED)
    d.text((x + 34, yy + 72), value, font=f_kpi, fill=color)
    d.text((x + 34, yy + 154), sub, font=f_body, fill=MUTED)

y = 940
card(d, [64, y, W - 64, y + 390], fill=SOFT)
d.text((98, y + 36), "Manager insights", font=f_h2, fill=CHARCOAL)
insights = [
    ("Reservation due", "12-top arrives at 8:30 PM. Prep table 5."),
    ("Clock alert", "Devon R. is approaching 10 hours on shift."),
    ("Sales note", "Patio sales are up 18% vs last Thursday."),
]
yy = y + 110
for title, body in insights:
    d.ellipse([98, yy + 8, 122, yy + 32], fill=PRIMARY)
    d.text((142, yy), title, font=f_body_b, fill=CHARCOAL)
    d.text((142, yy + 42), body, font=f_body, fill=MUTED)
    yy += 88

y = 1400
card(d, [64, y, W - 64, y + 520])
d.text((98, y + 36), "Upcoming schedule", font=f_h2, fill=CHARCOAL)
for i, row in enumerate([("5:00 PM", "Maria G.", "Server"), ("6:00 PM", "Sam P.", "Bar"), ("7:30 PM", "Open shift", "Patio")]):
    yy = y + 120 + i * 116
    d.line([98, yy - 26, W - 98, yy - 26], fill=BORDER, width=1)
    d.text((98, yy), row[0], font=f_body_b, fill=PRIMARY)
    d.text((270, yy), row[1], font=f_body_b, fill=CHARCOAL)
    d.text((270, yy + 38), row[2], font=f_body, fill=MUTED)
paths.append(save(img, "01-dashboard.png"))

# 2. Schedule
img, d = app_screen("Schedule", "Build and publish the weekly roster.", "Schedule")
y = 390
days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
col_w = (W - 128) / 5
for i, day in enumerate(days):
    x = 64 + int(i * col_w)
    d.text((x + 18, y), day, font=f_small_b, fill=MUTED)
y += 58
shifts = [
    (0, 0, "Server", "5p-11p", PRIMARY),
    (1, 0, "Bar", "4p-10p", SECONDARY),
    (3, 0, "Host", "5p-9p", INFO),
    (4, 0, "Open", "7p-12a", WARNING),
    (0, 1, "Patio", "6p-10p", INFO),
    (2, 1, "Server", "5p-11p", PRIMARY),
    (3, 1, "Runner", "6p-10p", SUCCESS),
    (1, 2, "Server", "5p-11p", PRIMARY),
    (2, 2, "Bar", "6p-12a", SECONDARY),
    (4, 2, "Server", "5p-11p", PRIMARY),
]
for col, row, role, time, color in shifts:
    x = 64 + int(col * col_w) + 10
    yy = y + row * 178
    card(d, [x, yy, x + int(col_w) - 20, yy + 142], radius=15, outline=color, width=3)
    d.rounded_rectangle([x, yy, x + 10, yy + 142], radius=5, fill=color)
    d.text((x + 24, yy + 24), role, font=f_small_b, fill=CHARCOAL)
    d.text((x + 24, yy + 66), time, font=f_small, fill=MUTED)

y = 1040
card(d, [64, y, W - 64, y + 430], fill=SOFT)
d.text((98, y + 36), "Auto schedule preview", font=f_h2, fill=CHARCOAL)
for i, line in enumerate(["7 shifts assigned", "2 conflicts prevented", "Labor cap: 38.5 hours"]):
    pill(d, 98, y + 120 + i * 78, line, (232, 242, 235), PRIMARY)

y = 1540
card(d, [64, y, W - 64, y + 300])
d.text((98, y + 36), "Pending requests", font=f_h2, fill=CHARCOAL)
d.text((98, y + 118), "Ana requested Friday off", font=f_body_b, fill=CHARCOAL)
d.text((98, y + 162), "Approve or deny from the manager calendar.", font=f_body, fill=MUTED)
paths.append(save(img, "02-schedule.png"))

# 3. Clock
img, d = app_screen("Time Clock", "GPS verified clock-in and payroll-ready hours.", "Clock")
y = 400
card(d, [64, y, W - 64, y + 580], fill=SOFT)
d.text((W / 2 - d.textlength("ON SHIFT", font=f_small_b) / 2, y + 60), "ON SHIFT", font=f_small_b, fill=SUCCESS)
d.text((W / 2 - d.textlength("4:32:08", font=f_kpi) / 2, y + 126), "4:32:08", font=f_kpi, fill=CHARCOAL)
d.text((W / 2 - d.textlength("Since 5:00 PM at The Green Room", font=f_body) / 2, y + 218), "Since 5:00 PM at The Green Room", font=f_body, fill=MUTED)
d.rounded_rectangle([180, y + 330, W - 180, y + 430], radius=28, fill=DANGER)
d.text((W / 2 - d.textlength("Clock Out", font=f_h2) / 2, y + 356), "Clock Out", font=f_h2, fill=BG)

y = 1060
card(d, [64, y, W - 64, y + 520])
d.text((98, y + 36), "Clock board", font=f_h2, fill=CHARCOAL)
for i, (name, detail, tone) in enumerate([
    ("Maria G.", "Clocked in 5:00 PM", SUCCESS),
    ("Devon R.", "Late clock-in warning", WARNING),
    ("Sam P.", "Missed clock-out alert", DANGER),
]):
    yy = y + 116 + i * 120
    d.ellipse([98, yy, 146, yy + 48], fill=tone)
    d.text((170, yy - 4), name, font=f_body_b, fill=CHARCOAL)
    d.text((170, yy + 36), detail, font=f_body, fill=MUTED)
paths.append(save(img, "03-timeclock.png"))

# 4. Floor
img, d = app_screen("Floor", "Manage tables, waitlist, and reservations live.", "Floor")
y = 380
card(d, [64, y, W - 64, y + 1360], fill=SOFT)
floor_x, floor_y, floor_w, floor_h = 104, y + 70, W - 208, 1120
tables = [
    (0.15, 0.12, "T1", SUCCESS, "round"),
    (0.44, 0.12, "T2", PRIMARY, "round"),
    (0.74, 0.14, "T3", MUTED, "round"),
    (0.18, 0.40, "T4", WARNING, "rect"),
    (0.50, 0.42, "T5", SUCCESS, "rect"),
    (0.80, 0.44, "T6", PRIMARY, "round"),
    (0.22, 0.72, "T7", MUTED, "round"),
    (0.55, 0.72, "VIP", SECONDARY, "rect"),
    (0.82, 0.74, "T9", SUCCESS, "round"),
]
for nx, ny, label, color, shape in tables:
    cx, cy = floor_x + nx * floor_w, floor_y + ny * floor_h
    if shape == "round":
        d.ellipse([cx - 74, cy - 74, cx + 74, cy + 74], fill=SURFACE, outline=color, width=5)
    else:
        d.rounded_rectangle([cx - 92, cy - 62, cx + 92, cy + 62], radius=18, fill=SURFACE, outline=color, width=5)
    d.text((cx - d.textlength(label, font=f_body_b) / 2, cy - 18), label, font=f_body_b, fill=color)

legend_y = y + 1225
x = 104
for label, color in [("Seated", SUCCESS), ("Reserved", PRIMARY), ("Open", MUTED), ("VIP", SECONDARY)]:
    d.ellipse([x, legend_y, x + 32, legend_y + 32], fill=color)
    d.text((x + 44, legend_y - 2), label, font=f_small_b, fill=MUTED)
    x += int(d.textlength(label, font=f_small_b)) + 120

y = 1800
card(d, [64, y, W - 64, y + 380])
d.text((98, y + 36), "Table timeline", font=f_h2, fill=CHARCOAL)
d.text((98, y + 116), "8:30 PM - Anderson party of 12", font=f_body_b, fill=CHARCOAL)
d.text((98, y + 160), "VIP setup, deposit paid, contract signed.", font=f_body, fill=MUTED)
d.text((98, y + 230), "Waitlist: 4 parties waiting", font=f_body_b, fill=PRIMARY)
paths.append(save(img, "04-floorplan.png"))

# 5. Chat
img, d = app_screen("Team Chat", "Keep shift notes and swaps in one place.", "Chat")
y = 400
messages = [
    ("Maria", "Patio section needs one more for the 8 PM rush.", False),
    ("You", "On it. Moving Devon over after table 12 closes.", True),
    ("Devon", "Clocked in. Heading to patio now.", False),
    ("Maria", "Thanks. 12-top just confirmed for 8:30.", False),
    ("You", "Table 5 is prepped and ready.", True),
]
for name, text, mine in messages:
    bubble_w = 770
    x = W - 64 - bubble_w if mine else 64
    d.text((x + (bubble_w - d.textlength(name, font=f_small_b) if mine else 0), y), name, font=f_small_b, fill=MUTED)
    y += 38
    lines = wrap(d, text, f_body, bubble_w - 70)
    h = 42 + len(lines) * 42
    fill = PRIMARY if mine else SOFT
    fg = BG if mine else CHARCOAL
    d.rounded_rectangle([x, y, x + bubble_w, y + h], radius=26, fill=fill)
    for i, line in enumerate(lines):
        d.text((x + 34, y + 22 + i * 42), line, font=f_body, fill=fg)
    y += h + 52

y = 1420
card(d, [64, y, W - 64, y + 420])
d.text((98, y + 36), "Shift swaps", font=f_h2, fill=CHARCOAL)
d.text((98, y + 116), "Ana wants to swap Friday 6p-10p", font=f_body_b, fill=CHARCOAL)
d.text((98, y + 160), "Managers can approve after both teammates accept.", font=f_body, fill=MUTED)
pill(d, 98, y + 238, "Accepted by Devon", (232, 242, 235), PRIMARY)
pill(d, 350, y + 238, "Needs approval", (250, 239, 221), WARNING)
paths.append(save(img, "05-chat.png"))

for path in paths:
    with Image.open(path) as img:
        print(path, img.size, img.mode)
