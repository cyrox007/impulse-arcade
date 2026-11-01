"""Browser smoke for compact/normal mobile and desktop (not a physical-phone test).

Requirements: pip install playwright; python -m playwright install chromium.
HTML/CSS/JS are inlined to avoid file:// or localhost policy restrictions.
"""
from pathlib import Path
import shutil
import re
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'style.css').read_text(encoding='utf-8')
js = (root / 'game.js').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="style\.css(?:\?[^"]*)?">', '', html)
html = html.replace('<script src="game.js" defer></script>', '')

with sync_playwright() as pw:
    binary = shutil.which('chromium') or shutil.which('google-chrome')
    options = {'headless': True, 'args': ['--no-sandbox']}
    if binary:
        options['executable_path'] = binary
    browser = pw.chromium.launch(**options)
    devices = [
        ('desktop', 1100, 900),
        ('mobile-320', 320, 568),
        ('mobile-360', 360, 640),
        ('mobile-393', 393, 852),
        ('mobile-landscape', 844, 390),
    ]
    for label, width, height in devices:
        mobile = label.startswith('mobile')
        context = browser.new_context(viewport={'width': width, 'height': height},
                                      is_mobile=mobile, has_touch=mobile)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(html)
        page.add_style_tag(content=css)
        page.add_script_tag(content=js)
        assert page.evaluate('window.__impulseDebug().state') == 'menu'
        assert page.evaluate('document.querySelector(\'meta[name="app-build"]\').content') == 'mobile-ui-02-20261101'
        assert page.locator('.eyebrow').inner_text() == 'АРКАДА • UI 0.2'
        assert page.evaluate('document.documentElement.scrollWidth') <= width
        geometry = page.evaluate('''() => {
            const box = s => document.querySelector(s).getBoundingClientRect();
            return {stage: box('#overlay').toJSON(), title: box('.overlay h2').toJSON(),
                    action: box('#overlayAction').toJSON(), launch: box('#launchBtn').toJSON()};
        }''')
        assert geometry['action']['bottom'] <= geometry['stage']['bottom'] + 1, geometry
        assert geometry['title']['top'] >= geometry['stage']['top'] - 1, geometry
        if width < height:
            # A phone must devote most of its width to the actual game, not to outer UI.
            metrics = page.evaluate('''() => {
                const box = s => document.querySelector(s).getBoundingClientRect();
                const canvas = box('#game'), hud = box('.hud'), stage = box('.game-frame');
                return {
                    canvasWidth: canvas.width, canvasHeight: canvas.height,
                    canvasTop: canvas.top, hudTop: hud.top, hudBottom: hud.bottom,
                    stageTop: stage.top,
                    controlsBottom: box('.controls').bottom,
                    footerVisible: getComputedStyle(document.querySelector('.footer')).display !== 'none'
                };
            }''')
            assert metrics['canvasWidth'] >= width * .84, metrics
            assert abs(metrics['canvasHeight'] / metrics['canvasWidth'] - 1.5) < .03, metrics
            assert metrics['hudTop'] >= metrics['stageTop'] - 2, metrics
            assert metrics['hudBottom'] < metrics['canvasTop'] + 65, metrics
            assert metrics['controlsBottom'] <= height + 1, metrics
            assert not metrics['footerVisible'], metrics
            print(f"{label} arena={metrics['canvasWidth']:.1f}x{metrics['canvasHeight']:.1f}")
        else:
            assert page.evaluate('document.querySelector("#game").getBoundingClientRect().width') >= 200
        page.locator('#overlayAction').click()
        assert page.evaluate('window.__impulseDebug().state') == 'ready'
        if mobile:
            page.locator('#game').scroll_into_view_if_needed()
            rect = page.locator('#game').bounding_box()
            assert rect and rect['width'] > 180, rect
            page.touchscreen.tap(rect['x'] + rect['width']/2,
                                 rect['y'] + rect['height']*.7)
        else:
            page.locator('#launchBtn').click()
        assert page.evaluate('window.__impulseDebug().state') == 'playing'
        page.locator('#pauseBtn').click()
        assert page.evaluate('window.__impulseDebug().state') == 'paused'
        page.locator('#overlayAction').click()
        assert page.evaluate('window.__impulseDebug().state') == 'playing'
        page.evaluate('window.dispatchEvent(new Event("blur"))')
        assert page.evaluate('window.__impulseDebug().state') == 'paused'
        assert not errors, errors
        print(f'{label}: responsive, controls, pause, blur OK; JS errors: 0')
        context.close()
    browser.close()
