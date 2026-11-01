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
html = re.sub(r'<script src="game\.js(?:\?[^"]*)?" defer></script>', '', html)

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
        assert page.locator('#compactSector').inner_text() == '01/03'
        assert page.evaluate('document.querySelector(\'meta[name="app-build"]\').content') == 'gameplay-03-20261101'
        assert page.locator('.eyebrow').inner_text() == 'АРКАДА • ИГРА 0.3'
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
            assert page.locator('#compactSector').is_visible()
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
        combo_stats = page.evaluate("""() => {
            const initial=game.score;
            for(let i=0;i<4;i++)game.hitBrick(game.bricks[0],0);
            game.applyDrop('wide');
            game.energy=100;
            game.pulse();
            game.draw();
            return {combo:window.__impulseDebug().combo,
                    multiplier:game.comboMultiplier(),
                    gain:game.score-initial,
                    timers:game.timers,
                    marker:document.querySelector('meta[name="app-build"]').content};
        }""")
        assert combo_stats['combo'] == 4, combo_stats
        assert combo_stats['multiplier'] == 2, combo_stats
        assert combo_stats['gain'] >= 500, combo_stats
        assert combo_stats['timers']['wide'] > 0 and combo_stats['timers']['pulse'] > 0, combo_stats
        assert combo_stats['marker'] == 'gameplay-03-20261101', combo_stats
        page.locator('#pauseBtn').click()
        assert page.evaluate('window.__impulseDebug().state') == 'paused'
        page.locator('#overlayAction').click()
        assert page.evaluate('window.__impulseDebug().state') == 'playing'
        page.evaluate('window.dispatchEvent(new Event("blur"))')
        assert page.evaluate('window.__impulseDebug().state') == 'paused'
        # Stress the actual third-sector renderer: a stable brick layer must
        # be rasterized once rather than rebuilt on all 90 paint calls.
        paint_stats = page.evaluate("""() => {
            game.level = 2;
            game.makeBricks();
            game.draw();
            const first = game.brickPaintCount;
            const start = performance.now();
            for(let i=0;i<90;i++) game.draw();
            return {cached: Boolean(game.brickLayer), first,
                    after: game.brickPaintCount,
                    ms: performance.now()-start, bricks: game.bricks.length,
                    fpsType: typeof window.__impulseDebug().fps};
        }""")
        assert paint_stats['cached'], paint_stats
        assert paint_stats['after'] == paint_stats['first'], paint_stats
        assert paint_stats['bricks'] >= 25, paint_stats
        assert paint_stats['fpsType'] == 'number', paint_stats
        sprite_stats = page.evaluate("""() => {
            const before = game.spritePaintCount;
            for(let i=0;i<90;i++) game.draw();
            game.applyDrop('wide');
            game.energy=100;
            game.pulse();
            game.draw();
            return {before, after:game.spritePaintCount,
                    ball:!!game.sprites.ballNormal,
                    paddle:!!game.sprites.paddleWide,
                    visibleStats:window.__impulseDebug().avgDrawMs};
        }""")
        assert sprite_stats['before'] == 4, sprite_stats
        assert sprite_stats['after'] == 4, sprite_stats
        assert sprite_stats['ball'] and sprite_stats['paddle'], sprite_stats
        assert isinstance(sprite_stats['visibleStats'], (int, float)), sprite_stats
        print(f"{label}: sector3 90 paints in {paint_stats['ms']:.1f}ms (desktop/mobile emulation)")
        # Compact end-of-run statistics and per-sector count in 0.3.
        run_stats = page.evaluate("""() => {
            game.startNewGame();game.launch();
            for(let i=0;i<4;i++)game.hitBrick(game.bricks[0],0);
            const debug=window.__impulseDebug();
            const stage=document.querySelector('#stageLabel').textContent;
            game.end('lost');
            const rect=selector=>document.querySelector(selector).getBoundingClientRect();
            return {hits:debug.stats.hits,bricks:debug.stats.bricks,
                bestCombo:debug.stats.bestCombo,stage,
                actionBottom:rect('#overlayAction').bottom,
                stageBottom:rect('.game-stage').bottom,
                statsTop:rect('.run-stats').top,
                stageTop:rect('.game-stage').top,
                label:document.querySelector('.run-stats').textContent};
        }""")
        assert run_stats['hits'] == 4 and run_stats['bricks'] == 4, run_stats
        assert run_stats['bestCombo'] == 4 and 'БЛОКОВ' in run_stats['stage'], run_stats
        assert 'ВРЕМЯ' in run_stats['label'] and 'СЕРИЯ' in run_stats['label'], run_stats
        assert run_stats['actionBottom'] <= run_stats['stageBottom'] + 1, run_stats
        assert run_stats['statsTop'] >= run_stats['stageTop'] - 1, run_stats
        assert not errors, errors
        print(f'{label}: responsive, controls, pause, blur OK; JS errors: 0')
        context.close()
    browser.close()
