"""Generates stand-in 'old photographs' for the demo Fellow. Abstract scenes only,
each stamped DEMO so nobody mistakes them for real archival images."""
import random, sys, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

def grain(img, amount, seed):
    rnd = random.Random(seed)
    noise = Image.effect_noise(img.size, amount).convert("L")
    return Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.07)

def vignette(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((-w * 0.25, -h * 0.25, w * 1.25, h * 1.25), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) // 5))
    dark = Image.new("RGB", (w, h), (30, 24, 18))
    return Image.composite(img, dark, mask)

def tone(img, mode):
    g = ImageOps.grayscale(img)
    if mode == "sepia":
        return ImageOps.colorize(g, (45, 30, 18), (238, 222, 190))
    if mode == "bw":
        return ImageOps.colorize(g, (22, 22, 22), (232, 230, 224))
    return img  # faded colour

def stamp(img):
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", max(12, img.size[0] // 40))
    except Exception:
        f = ImageFont.load_default()
    d.text((img.size[0] - img.size[0] // 9, img.size[1] - img.size[1] // 14), "DEMO", fill=(255, 255, 255), font=f, anchor="mm")
    return img

def scene(name, w, h, kind, mode, seed):
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    sky_top, sky_bot = (rnd.randint(150, 200), rnd.randint(170, 210), rnd.randint(190, 230)), (235, 225, 205)
    horizon = int(h * rnd.uniform(0.5, 0.65))
    for y in range(h):
        t = y / horizon if y < horizon else 1
        c = tuple(int(sky_top[i] + (sky_bot[i] - sky_top[i]) * t) for i in range(3))
        if y >= horizon:
            k = (y - horizon) / (h - horizon)
            c = tuple(int(v) for v in (150 - 60 * k, 130 - 50 * k, 100 - 40 * k))
        d.line([(0, y), (w, y)], fill=c)
    if kind == "plaza":
        for i in range(7):
            x = int(w * (i + 0.5) / 7)
            d.rectangle((x - w // 30, horizon - h // 3, x + w // 30, horizon), fill=(215, 200, 175))
            d.ellipse((x - w // 22, horizon - h // 3 - h // 12, x + w // 22, horizon - h // 3 + h // 30), fill=(80, 110, 70))
        for i in range(5):
            x = rnd.randint(w // 8, w - w // 8)
            d.ellipse((x - 8, horizon + 10, x + 8, horizon + 26), fill=(40, 35, 30)); d.rectangle((x - 9, horizon + 24, x + 9, horizon + 70), fill=(60, 50, 45))
    elif kind == "street":
        for i in range(6):
            x0 = int(w * i / 6); bh = rnd.randint(h // 3, int(h * 0.62))
            d.rectangle((x0, horizon - bh, x0 + w // 6 - 4, horizon + 30), fill=(120 + rnd.randint(-20, 20), 95, 80))
            for r in range(4):
                for c in range(2):
                    d.rectangle((x0 + 12 + c * (w // 14), horizon - bh + 20 + r * (bh // 5), x0 + 12 + c * (w // 14) + w // 28, horizon - bh + 20 + r * (bh // 5) + bh // 9), fill=(60, 55, 52))
    elif kind == "portrait":
        d.rectangle((0, 0, w, h), fill=(205, 195, 178))
        cx = w // 2
        d.ellipse((cx - w // 7, h // 5, cx + w // 7, h // 5 + w // 3.6), fill=(150, 120, 100))
        d.pieslice((cx - w // 3.2, int(h * 0.55), cx + w // 3.2, int(h * 1.4)), 180, 360, fill=(60, 52, 58))
    elif kind == "wedding":
        d.rectangle((0, 0, w, h), fill=(190, 182, 170))
        for cx, col in ((int(w * 0.4), (245, 242, 235)), (int(w * 0.6), (40, 38, 42))):
            d.ellipse((cx - w // 14, h // 4, cx + w // 14, h // 4 + w // 7), fill=(150, 120, 100))
            d.polygon([(cx - w // 7, h), (cx + w // 7, h), (cx + w // 14, int(h * 0.48)), (cx - w // 14, int(h * 0.48))], fill=col)
    elif kind == "shop":
        d.rectangle((w // 10, h // 5, w - w // 10, horizon + 40), fill=(170, 80, 60))
        d.rectangle((w // 6, h // 3, w - w // 6, horizon), fill=(235, 225, 200))
        for i in range(9):
            x = w // 6 + 20 + i * ((w - w // 3 - 40) // 9)
            d.ellipse((x, horizon - 50, x + 34, horizon - 22), fill=(190, 140, 70))
        d.rectangle((w // 10, h // 5 - 40, w - w // 10, h // 5), fill=(60, 40, 35))
    elif kind == "garden":
        for i in range(60):
            x, y = rnd.randint(0, w), rnd.randint(horizon - 40, h)
            r = rnd.randint(6, 20)
            d.ellipse((x - r, y - r, x + r, y + r), fill=rnd.choice([(190, 70, 60), (230, 190, 70), (90, 130, 70), (210, 120, 150)]))
    elif kind == "beach":
        d.rectangle((0, horizon, w, horizon + h // 8), fill=(90, 130, 150))
        d.rectangle((0, horizon + h // 8, w, h), fill=(220, 200, 160))
        for i in range(3):
            x = int(w * (0.3 + i * 0.18))
            d.ellipse((x - 9, horizon + h // 8 + 20, x + 9, horizon + h // 8 + 38), fill=(140, 100, 80)); d.rectangle((x - 10, horizon + h // 8 + 36, x + 10, horizon + h // 8 + 90), fill=(200, 80, 70))
    elif kind == "kitchen":
        d.rectangle((0, 0, w, h), fill=(210, 190, 150))
        d.rectangle((0, int(h * 0.62), w, h), fill=(120, 90, 60))
        for i in range(4):
            x = int(w * (0.15 + i * 0.2)); d.ellipse((x, int(h * 0.48), x + w // 8, int(h * 0.62)), fill=(170, 160, 150))
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    img = tone(img, mode)
    if mode == "faded":
        img = Image.blend(img, Image.new("RGB", img.size, (230, 200, 160)), 0.25)
    img = vignette(grain(img, 40, seed))
    img = stamp(img)
    img.save(os.path.join(out, f"{name}.jpg"), quality=86)

scenes = [
    ("ponce-plaza-1948", 900, 640, "plaza", "sepia"),
    ("first-communion-1949", 640, 860, "portrait", "bw"),
    ("east-harlem-1954", 900, 640, "street", "bw"),
    ("wedding-1963", 720, 900, "wedding", "bw"),
    ("coney-island-1967", 900, 620, "beach", "faded"),
    ("kitchen-1978", 900, 660, "kitchen", "faded"),
    ("bakery-opening-1988", 900, 640, "shop", "faded"),
    ("garden-2015", 900, 640, "garden", "colour"),
]
for i, (n, w, h, k, m) in enumerate(scenes):
    scene(n, w, h, k, m, i * 7 + 3)
print("made", len(scenes))
