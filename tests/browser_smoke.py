"""Опциональный UI smoke-test без веб-сервера.

Требуется Python Playwright и Chromium:
  python -m pip install playwright
  python -m playwright install chromium
  python tests/browser_smoke.py

HTML/CSS/JS встраиваются в страницу. Это не проверяет хостинг или физический телефон.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'style.css').read_text(encoding='utf-8')
js = (root / 'game.js').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', '')
html = html.replace('<script src="game.js" defer></script>', '')

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for label, context_kwargs in (
        ('desktop', {'viewport': {'width': 1100, 'height': 900}}),
        ('mobile', {'viewport': {'width': 393, 'height': 852}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2}),
    ):
        context = browser.new_context(**context_kwargs)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(html)
        page.add_style_tag(content=css)
        page.add_script_tag(content=js)
        assert page.evaluate('window.__impulseDebug().state') == 'menu'
        assert page.locator('#overlayAction').count() == 1
        page.locator('#overlayAction').click()
        assert page.evaluate('window.__impulseDebug().state') == 'ready'
        if label == 'mobile':
            rect = page.locator('#game').bounding_box()
            assert rect and rect['width'] > 100, rect
            page.touchscreen.tap(rect['x']+rect['width']/2, rect['y']+rect['height']*.7)
        else:
            page.locator('#launchBtn').click()
        assert page.evaluate('window.__impulseDebug().state') == 'playing'
        page.locator('#pauseBtn').click()
        assert page.evaluate('window.__impulseDebug().state') == 'paused'
        page.locator('#overlayAction').click()
        assert page.evaluate('window.__impulseDebug().state') == 'playing'
        assert not errors, errors
        print(f'{label}: menu → ready → playing → paused → playing; JS errors: 0')
        context.close()
    browser.close()
