"""Generate App Store screenshots with zeroed/empty-state data.

These are intended for App Store Connect when we do not want screenshots to
show mock people, venues, schedules, reservations, or messages. The output
keeps the app UI visible while all operational data is empty.
"""
from PIL import Image, ImageDraw, ImageFont
import os

BG = (255, 255, 255)
SURFACE = (255, 255, 255)
SOFT = (247, 248, 245)
BORDER = (229, 224, 214)
PRIMARY = (47, 125, 70)
SECONDARY = (183, 117, 42)
CHARCOAL = (35, 36, 31)
MUTED = (111, 106, 95)
INFO = (73, 122, 120)

FONTS = "C:/Windows/Fonts"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def scaled_fonts(scale):
    return {
        "brand": font("arialbd.ttf", int(42 * scale)),
        "h1": font("arialbd.ttf", int(64 * scale)),
        "h2": font("arialbd.ttf", int(42 * scale)),
        "h3": font("arialbd.ttf", int(32 * scale)),
        "body": font("arial.ttf", int(30 * scale)),
        "body_b": font("arialbd.ttf", int(30 * scale)),
        "small": font("arial.ttf", int(24 * scale)),
        "small_b": font("arialbd.ttf", int(24 * scale)),
        "kpi": font("arialbd.ttf", int(58 * scale)),
        "tab": font("arialbd.ttf", int(22 * scale)),
    }


TARGETS = [
    ("screenshots/appstore", 1242, 2688, 1.0),
    ("screenshots/appstore-ipad", 2064, 2752, 1.28),
    ("screenshots/appstore-ipad-13", 2064, 2752, 1.28),
]


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


def card(draw, xy, radius, fill=SURFACE, outline=BORDER, width=2):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def pill(draw, x, y, text, fnt, fill, fg=PRIMARY):
    tw = draw.textlength(text, font=fnt)
    h = int(fnt.size * 1.8)
    draw.rounded_rectangle([x, y, x + tw + h, y + h], radius=h // 2, fill=fill)
    draw.text((x + h // 2, y + int(fnt.size * 0.35)), text, font=fnt, fill=fg)
    return tw + h


def app_screen(w, h, scale, title, subtitle, active_tab):
    f = scaled_fonts(scale)
    pad = int(64 * scale) if w < 1600 else 128
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    d.text((pad, int(34 * scale)), "9:41", font=f["body_b"], fill=(0, 0, 0))
    batt_w = int(72 * scale)
    batt_h = int(30 * scale)
    bx = w - pad - batt_w - int(20 * scale)
    by = int(48 * scale)
    d.rounded_rectangle([bx, by, bx + batt_w, by + batt_h], radius=int(7 * scale), outline=(0, 0, 0), width=max(2, int(3 * scale)))
    d.rectangle([bx + batt_w + 3, by + batt_h // 3, bx + batt_w + int(11 * scale), by + batt_h * 2 // 3], fill=(0, 0, 0))
    d.rounded_rectangle([bx + int(7 * scale), by + int(6 * scale), bx + batt_w - int(14 * scale), by + batt_h - int(6 * scale)], radius=int(5 * scale), fill=(0, 0, 0))

    d.text((pad, int(128 * scale)), "Venue Wrangler", font=f["brand"], fill=PRIMARY)
    d.text((pad, int(194 * scale)), title, font=f["h1"], fill=PRIMARY)
    y = int(274 * scale)
    for line in wrap(d, subtitle, f["body"], w - 2 * pad):
        d.text((pad, y), line, font=f["body"], fill=MUTED)
        y += int(40 * scale)

    d.line([0, h - int(176 * scale), w, h - int(176 * scale)], fill=BORDER, width=max(2, int(2 * scale)))
    tabs = ["Home", "Schedule", "Clock", "Floor", "Chat"]
    tab_w = w / len(tabs)
    for i, tab in enumerate(tabs):
        cx = int(i * tab_w + tab_w / 2)
        color = PRIMARY if tab == active_tab else MUTED
        r = int(16 * scale)
        d.ellipse([cx - r, h - int(136 * scale), cx + r, h - int(104 * scale)], fill=color)
        label_w = d.textlength(tab, font=f["tab"])
        d.text((cx - label_w / 2, h - int(88 * scale)), tab, font=f["tab"], fill=color)
    return img, d, f, pad


def empty_panel(draw, x0, y0, x1, y1, f, title, body):
    card(draw, [x0, y0, x1, y1], radius=max(14, int(f["body"].size * 0.55)), fill=SOFT)
    draw.text((x0 + int(f["body"].size * 1.15), y0 + int(f["body"].size * 1.15)), title, font=f["h2"], fill=CHARCOAL)
    y = y0 + int(f["body"].size * 3.25)
    for line in wrap(draw, body, f["body"], x1 - x0 - int(f["body"].size * 2.3)):
        draw.text((x0 + int(f["body"].size * 1.15), y), line, font=f["body"], fill=MUTED)
        y += int(f["body"].size * 1.45)


def dashboard(w, h, scale):
    img, d, f, pad = app_screen(w, h, scale, "Today", "No venue activity has been added yet.", "Home")
    content_w = w - pad * 2
    y = int(390 * scale)
    gap = int(32 * scale) if w < 1600 else 52
    card_w = (content_w - gap) // 2
    for idx, (label, sub, color) in enumerate([
        ("Clocked in", "No one on shift", PRIMARY),
        ("Covers today", "No reservations", SECONDARY),
        ("Open shifts", "No open shifts", INFO),
        ("Labor target", "No labor data", PRIMARY),
    ]):
        x = pad + (idx % 2) * (card_w + gap)
        yy = y + (idx // 2) * int(258 * scale)
        card(d, [x, yy, x + card_w, yy + int(220 * scale)], radius=int(18 * scale))
        d.text((x + int(34 * scale), yy + int(28 * scale)), label, font=f["small_b"], fill=MUTED)
        d.text((x + int(34 * scale), yy + int(72 * scale)), "0", font=f["kpi"], fill=color)
        d.text((x + int(34 * scale), yy + int(154 * scale)), sub, font=f["body"], fill=MUTED)

    y = int(940 * scale) if w < 1600 else int(1080 * scale / 1.28)
    empty_panel(d, pad, y, w - pad, y + int(390 * scale), f, "Manager insights", "Insights will appear here once your venue has shifts, reservations, and time clock activity.")
    y += int(460 * scale)
    empty_panel(d, pad, y, w - pad, y + int(430 * scale), f, "Upcoming schedule", "No shifts have been published yet.")
    return img


def schedule(w, h, scale):
    img, d, f, pad = app_screen(w, h, scale, "Schedule", "Build and publish the weekly roster.", "Schedule")
    y = int(390 * scale)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    col_w = (w - 2 * pad) / 5
    for i, day in enumerate(days):
        x = pad + int(i * col_w)
        d.text((x + int(18 * scale), y), day, font=f["small_b"], fill=MUTED)
    y += int(58 * scale)
    for i in range(5):
        x = pad + int(i * col_w) + int(8 * scale)
        card(d, [x, y, x + int(col_w) - int(16 * scale), y + int(540 * scale)], radius=int(15 * scale), fill=SOFT)
        d.text((x + int(24 * scale), y + int(32 * scale)), "No shifts", font=f["small_b"], fill=MUTED)
    y += int(640 * scale)
    empty_panel(d, pad, y, w - pad, y + int(360 * scale), f, "Auto schedule preview", "No open shifts are available to schedule.")
    y += int(430 * scale)
    empty_panel(d, pad, y, w - pad, y + int(300 * scale), f, "Pending requests", "No requests have been submitted.")
    return img


def clock(w, h, scale):
    img, d, f, pad = app_screen(w, h, scale, "Time Clock", "GPS verified clock-in and payroll-ready hours.", "Clock")
    y = int(400 * scale)
    card(d, [pad, y, w - pad, y + int(580 * scale)], radius=int(18 * scale), fill=SOFT)
    d.text((w / 2 - d.textlength("OFF SHIFT", font=f["small_b"]) / 2, y + int(60 * scale)), "OFF SHIFT", font=f["small_b"], fill=MUTED)
    d.text((w / 2 - d.textlength("0:00:00", font=f["kpi"]) / 2, y + int(126 * scale)), "0:00:00", font=f["kpi"], fill=CHARCOAL)
    d.text((w / 2 - d.textlength("No active clock-in", font=f["body"]) / 2, y + int(218 * scale)), "No active clock-in", font=f["body"], fill=MUTED)
    d.rounded_rectangle([pad + int(120 * scale), y + int(330 * scale), w - pad - int(120 * scale), y + int(430 * scale)], radius=int(28 * scale), fill=PRIMARY)
    d.text((w / 2 - d.textlength("Clock In", font=f["h2"]) / 2, y + int(356 * scale)), "Clock In", font=f["h2"], fill=BG)
    y += int(660 * scale)
    empty_panel(d, pad, y, w - pad, y + int(520 * scale), f, "Clock board", "No team members are currently clocked in.")
    return img


def floor(w, h, scale):
    img, d, f, pad = app_screen(w, h, scale, "Floor", "Manage tables, waitlist, and reservations live.", "Floor")
    y = int(380 * scale)
    card(d, [pad, y, w - pad, y + int(1060 * scale)], radius=int(18 * scale), fill=SOFT)
    cx, cy = w // 2, y + int(430 * scale)
    d.rounded_rectangle([cx - int(250 * scale), cy - int(110 * scale), cx + int(250 * scale), cy + int(110 * scale)], radius=int(24 * scale), outline=BORDER, width=max(2, int(3 * scale)), fill=SURFACE)
    d.text((cx - d.textlength("No floor plan", font=f["h2"]) / 2, cy - int(48 * scale)), "No floor plan", font=f["h2"], fill=CHARCOAL)
    d.text((cx - d.textlength("Add tables to start managing service.", font=f["body"]) / 2, cy + int(24 * scale)), "Add tables to start managing service.", font=f["body"], fill=MUTED)
    x = pad + int(44 * scale)
    legend_y = y + int(890 * scale)
    for label, color in [("Seated", PRIMARY), ("Reserved", INFO), ("Open", MUTED), ("VIP", SECONDARY)]:
        d.ellipse([x, legend_y, x + int(32 * scale), legend_y + int(32 * scale)], fill=color)
        d.text((x + int(44 * scale), legend_y - int(2 * scale)), label, font=f["small_b"], fill=MUTED)
        x += int(d.textlength(label, font=f["small_b"])) + int(120 * scale)
    y += int(1140 * scale)
    empty_panel(d, pad, y, w - pad, y + int(380 * scale), f, "Table timeline", "No reservations or waitlist parties are scheduled.")
    return img


def chat(w, h, scale):
    img, d, f, pad = app_screen(w, h, scale, "Team Chat", "Keep shift notes and swaps in one place.", "Chat")
    y = int(420 * scale)
    empty_panel(d, pad, y, w - pad, y + int(520 * scale), f, "No messages yet", "Team conversations will appear here after staff join your venue.")
    y += int(600 * scale)
    empty_panel(d, pad, y, w - pad, y + int(420 * scale), f, "Shift swaps", "No swap requests are waiting for approval.")
    y += int(500 * scale)
    pill(d, pad, y, "No unread messages", f["small_b"], (232, 242, 235), PRIMARY)
    return img


SCREENS = [
    ("01-dashboard.png", dashboard),
    ("02-schedule.png", schedule),
    ("03-timeclock.png", clock),
    ("04-floorplan.png", floor),
    ("05-chat.png", chat),
]


for folder, w, h, scale in TARGETS:
    out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", folder))
    os.makedirs(out, exist_ok=True)
    for name, renderer in SCREENS:
        path = os.path.join(out, name)
        renderer(w, h, scale).save(path, "PNG")
        print(path, (w, h))
