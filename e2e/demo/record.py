# Records the README demo: the real desktop interface in Chrome, with a stand-in for the
# Electron bridge (bridge.js) and Eleanor's demo data. Nothing here touches real keys.
#
#   pip install playwright      (uses your installed Chrome; no browser download)
#   python3 e2e/demo/record.py  -> docs/demo.gif   (needs ffmpeg)
import http.server, threading, functools, sys, os, time, subprocess, glob, tempfile
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = tempfile.mkdtemp(prefix="sondage-demo-")
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=REPO)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
bridge = open(os.path.join(HERE, "bridge.js")).read()
shim = open(os.path.join(HERE, "actioncable-shim.js")).read()
W, H = 1280, 800
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    ctx = b.new_context(viewport={"width": W, "height": H}, record_video_dir=OUT, record_video_size={"width": W, "height": H})
    ctx.add_init_script(bridge)
    pg = ctx.new_page()
    pg.route("**/node_modules/@rails/actioncable/**", lambda r: r.fulfill(body=shim, content_type="text/javascript"))
    pg.on("pageerror", lambda e: print("PAGEERROR", e))
    pg.goto("http://127.0.0.1:8765/desktop/src/renderer/index.html")
    pg.wait_for_selector("#view-home:not([hidden]) .feature")
    pause = lambda s: pg.wait_for_timeout(int(s * 1000))
    def move_click(sel, before=0.5):
        el = pg.locator(sel).first
        box = el.bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=18)
        pause(before)
        el.click()
    pause(2.2)
    # Home -> journal
    move_click('#view-home [data-go="journal"]')
    pg.wait_for_selector("#view-journal:not([hidden]) .page-entry")
    pause(1.8)
    # Answer the historian's question
    move_click("#journal-prompts [data-answer]")
    pg.wait_for_selector("#write-body")
    pause(0.6)
    pg.keyboard.type("We came in January of 1953. I pressed my hand on the window of the bus and the snow felt like sugar.", delay=38)
    pause(0.8)
    move_click("#write-save")
    pg.wait_for_selector("#view-journal .page-entry .words")
    pause(2.2)
    # Life story
    move_click('#nav [data-go="story"]')
    pause(2.0)
    for _ in range(14):
        pg.mouse.wheel(0, 160); pause(0.12)
    pause(1.4)
    # My recordings: check it is safe
    move_click('#nav [data-go="vault"]')
    pg.wait_for_selector("#view-vault .capsule-card")
    pause(1.0)
    move_click("#view-vault [data-verify]")
    pg.wait_for_function("() => /Yes/.test(document.querySelector('#view-vault .check-result').textContent)")
    pause(2.2)
    # Back home
    move_click('#nav [data-go="home"]')
    pg.wait_for_selector("#view-home:not([hidden]) .feature")
    pause(2.4)
    path = pg.video.path()
    ctx.close(); b.close()
srv.shutdown()
gif = os.path.join(REPO, "docs", "demo.gif")
pal = os.path.join(OUT, "pal.png")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vf", "fps=12,scale=960:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff", pal], check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-i", pal, "-lavfi", "fps=12,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", gif], check=True)
print("Wrote", gif)
