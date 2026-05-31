"""Generate App Store product-page screenshots (1290x2796, RGB, no alpha)
matching Venue Wrangler's current clean white theme.
Each is a caption headline + a stylized feature panel. Output to
screenshots/appstore/.
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1290, 2796
BG = (255, 255, 255)
SURF = (255, 255, 255)
SURF2 = (247, 249, 245)
BORDER = (229, 224, 214)
PRIMARY = (49, 132, 75)
SECOND = (189, 126, 43)
CHAR = (31, 36, 30)
MUTED = (107, 115, 104)
SUCCESS = (48, 145, 80)
WARN = (183, 122, 40)
DANGER = (195, 74, 67)
DKTEXT = (255, 255, 255)

F = "C:/Windows/Fonts/"
def fnt(n, s): return ImageFont.truetype(os.path.join(F, n), s)
f_head = fnt("arialbd.ttf", 78)
f_sub = fnt("arial.ttf", 36)
f_card = fnt("arialbd.ttf", 40)
f_big = fnt("arialbd.ttf", 96)
f_body = fnt("arial.ttf", 32)
f_bodyb = fnt("arialbd.ttf", 34)
f_sm = fnt("arial.ttf", 27)
f_pill = fnt("arialbd.ttf", 26)

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "screenshots", "appstore"))
os.makedirs(OUT, exist_ok=True)
PAD = 70

def new():
    img = Image.new("RGB", (W, H), BG)
    return img, ImageDraw.Draw(img)

def header(d, title, sub):
    # title may contain \n; draw each line, track bottom
    y = 120
    for tl in title.split("\n"):
        d.text((PAD, y), tl, font=f_head, fill=PRIMARY)
        y += 92
    y += 24  # gap before subline
    # wrap sub below the title
    words, line = sub.split(), ""
    for w in words:
        t = (line + " " + w).strip()
        if d.textlength(t, font=f_sub) <= W - 2*PAD: line = t
        else: d.text((PAD, y), line, font=f_sub, fill=MUTED); y += 48; line = w
    d.text((PAD, y), line, font=f_sub, fill=MUTED)

def card(d, x, y, w, h, r=28, fill=SURF, outline=BORDER, ow=2):
    d.rounded_rectangle([x, y, x+w, y+h], radius=r, fill=fill, outline=outline, width=ow)

def pill(d, x, y, text, bg, fg, f=f_pill):
    tw = d.textlength(text, font=f)
    d.rounded_rectangle([x, y, x+tw+40, y+52], radius=26, fill=bg)
    d.text((x+20, y+12), text, font=f, fill=fg)
    return tw+40

def save(img, name):
    p = os.path.join(OUT, name)
    img.save(p, "PNG")
    return p

paths = []

# 1. Dashboard
img, d = new()
header(d, "Run your venue\nat a glance", "Live clock-ins, covers, and labor cost the moment you open the app.")
y0 = 470
stats = [("CLOCKED IN", "12", PRIMARY), ("TODAY'S COVERS", "184", SECOND), ("LABOR %", "27%", SUCCESS), ("OPEN SHIFTS", "3", WARN)]
cw, ch, gap = (W-2*PAD-40)//2, 280, 40
for i,(lab,val,col) in enumerate(stats):
    cx = PAD + (i%2)*(cw+40); cy = y0 + (i//2)*(ch+gap)
    card(d, cx, cy, cw, ch)
    d.text((cx+40, cy+44), lab, font=f_sm, fill=MUTED)
    d.text((cx+40, cy+92), val, font=f_big, fill=col)
# insight card
iy = y0 + 2*(ch+gap) + 10
card(d, PAD, iy, W-2*PAD, 360, fill=SURF2, outline=BORDER)
d.text((PAD+40, iy+40), "COSMIC INSIGHT", font=f_pill, fill=PRIMARY)
for i,l in enumerate(["Friday covers are trending +18% vs last week.","Add one server to the 7pm floor to hold your", "labor target under 28%."]):
    d.text((PAD+40, iy+100+i*56), l, font=f_body, fill=CHAR if i==0 else MUTED)
paths.append(save(img, "01-dashboard.png"))

# 2. Schedule
img, d = new()
header(d, "Build the week\nin minutes", "Drag shifts onto the calendar, catch conflicts, and publish to the team.")
y0 = 470
days = ["MON","TUE","WED","THU","FRI"]
colw = (W-2*PAD)//5
for i,dn in enumerate(days):
    d.text((PAD+i*colw+18, y0), dn, font=f_pill, fill=MUTED)
rows = [(SUCCESS,[1,1,0,1,1]),(PRIMARY,[0,1,1,1,1]),(SECOND,[1,0,1,1,0]),(WARN,[1,1,1,0,1]),(SUCCESS,[0,1,1,1,1]),(PRIMARY,[1,1,0,1,1])]
ry = y0+70
for col, pat in rows:
    for i,on in enumerate(pat):
        cx = PAD+i*colw+12
        if on:
            card(d, cx, ry, colw-24, 150, r=20, fill=SURF, outline=col, ow=3)
            d.rounded_rectangle([cx, ry, cx+10, ry+150], radius=6, fill=col)
            d.text((cx+28, ry+30), "5:00p", font=f_sm, fill=CHAR)
            d.text((cx+28, ry+78), "Close", font=f_sm, fill=MUTED)
        else:
            card(d, cx, ry, colw-24, 150, r=20, fill=SURF2, outline=BORDER, ow=2)
    ry += 170
paths.append(save(img, "02-schedule.png"))

# 3. Time clock
img, d = new()
header(d, "Clock in,\nGPS-verified", "Staff punch in from the floor. Geofencing keeps the timesheet honest.")
y0 = 540
card(d, PAD, y0, W-2*PAD, 620, r=36, fill=SURF)
d.text((W//2 - d.textlength("ON SHIFT", font=f_pill)/2, y0+60), "ON SHIFT", font=f_pill, fill=SUCCESS)
big = "4:32:08"
d.text((W//2 - d.textlength(big, font=f_big)/2, y0+130), big, font=f_big, fill=CHAR)
d.text((W//2 - d.textlength("Today, since 5:00 PM", font=f_body)/2, y0+260), "Today, since 5:00 PM", font=f_body, fill=MUTED)
bw = W-2*PAD-160
d.rounded_rectangle([PAD+80, y0+360, PAD+80+bw, y0+470], radius=26, fill=DANGER)
d.text((W//2 - d.textlength("Clock Out", font=f_card)/2, y0+390), "Clock Out", font=f_card, fill=DKTEXT)
# recent punches
py = y0+700
d.text((PAD, py), "Recent punches", font=f_bodyb, fill=CHAR); py += 70
for who,t,c in [("Maria G.","Clocked in 5:00 PM",SUCCESS),("Devon R.","Clocked out 2:14 PM",MUTED),("Sam P.","Clocked in 4:45 PM",SUCCESS)]:
    card(d, PAD, py, W-2*PAD, 130, r=22)
    d.ellipse([PAD+30, py+35, PAD+90, py+95], fill=SURF2, outline=c, width=3)
    d.text((PAD+120, py+30), who, font=f_bodyb, fill=CHAR)
    d.text((PAD+120, py+74), t, font=f_sm, fill=MUTED)
    py += 150
paths.append(save(img, "03-timeclock.png"))

# 4. Floor plan
img, d = new()
header(d, "Live floor &\nreservations", "See every table, party, and open seat update in real time.")
y0 = 500
card(d, PAD, y0, W-2*PAD, 1500, r=36, fill=(250, 251, 248))
tables = [(0.2,0.12,"T1",SUCCESS,"o"),(0.55,0.12,"T2",PRIMARY,"o"),(0.8,0.2,"T3",MUTED,"o"),
          (0.18,0.4,"T4",WARN,"s"),(0.5,0.42,"T5",SUCCESS,"s"),(0.8,0.45,"T6",PRIMARY,"o"),
          (0.25,0.68,"T7",MUTED,"o"),(0.55,0.7,"VIP",SECOND,"s"),(0.82,0.72,"T9",SUCCESS,"o")]
fx, fy, fw, fh = PAD+40, y0+60, W-2*PAD-80, 1380
for nx,ny,lab,col,sh in tables:
    cx, cy = fx+nx*fw, fy+ny*fh
    rsz = 95
    if sh=="o": d.ellipse([cx-rsz,cy-rsz,cx+rsz,cy+rsz], fill=SURF, outline=col, width=4)
    else: d.rounded_rectangle([cx-rsz,cy-rsz,cx+rsz,cy+rsz], radius=18, fill=SURF, outline=col, width=4)
    d.text((cx-d.textlength(lab,font=f_bodyb)/2, cy-22), lab, font=f_bodyb, fill=col)
# legend
ly = y0+1500+50
lx = PAD
for txt,c in [("Seated",SUCCESS),("Reserved",PRIMARY),("Open",MUTED),("VIP",SECOND)]:
    d.ellipse([lx, ly, lx+34, ly+34], fill=c)
    d.text((lx+48, ly+2), txt, font=f_body, fill=MUTED)
    lx += d.textlength(txt, font=f_body) + 130
paths.append(save(img, "04-floorplan.png"))

# 5. Team chat
img, d = new()
header(d, "Keep the team\nin sync", "Shift notes, swaps, and announcements in one place - no group texts.")
y0 = 500
msgs = [("Maria (Manager)","Patio section needs one more for the 8pm rush.",False),
        ("You","On it - moving Devon over.",True),
        ("Devon","Clocked in, heading to patio now.",False),
        ("Maria (Manager)","Thanks team. 12-top just confirmed for 8:30.",False),
        ("You","Got table 5 prepped and ready.",True)]
y = y0
for name,txt,me in msgs:
    bw = 760
    bx = W-PAD-bw if me else PAD
    bcol = PRIMARY if me else SURF
    tcol = DKTEXT if me else CHAR
    # name
    d.text((bx+10 if not me else bx+bw-10-d.textlength(name,font=f_sm), y), name, font=f_sm, fill=MUTED)
    y += 40
    # bubble (2 lines wrap)
    words, lines, line = txt.split(), [], ""
    for w in words:
        t=(line+" "+w).strip()
        if d.textlength(t,font=f_body)<=bw-80: line=t
        else: lines.append(line); line=w
    lines.append(line)
    bh = 50 + len(lines)*46
    d.rounded_rectangle([bx,y,bx+bw,y+bh], radius=30, fill=bcol)
    for i,l in enumerate(lines):
        d.text((bx+40, y+28+i*46), l, font=f_body, fill=tcol)
    y += bh + 50
paths.append(save(img, "05-chat.png"))

for p in paths:
    im = Image.open(p)
    print(p, im.size, im.mode)
