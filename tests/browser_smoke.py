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
renderer = (root / 'game-render.js').read_text(encoding='utf-8')
js = (root / 'game.js').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="style\.css(?:\?[^"]*)?">', '', html)
html = re.sub(r'<script src="game-render\\.js(?:\\?[^"]*)?" defer></script>', '', html)
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
        page.add_script_tag(content=renderer)
        page.add_script_tag(content=js)
        assert page.evaluate('window.__impulseDebug().state') == 'menu'
        assert page.locator('#compactSector').inner_text() == '01/05'
        assert page.evaluate('document.querySelector(\'meta[name="app-build"]\').content') == 'gameplay-100rc-20261101'
        assert page.locator('.eyebrow').inner_text() == 'АРКАДА • 1.0 RC'
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
        # New release settings panel must fit a compact mobile screen.
        page.locator('#settingsBtn').click()
        assert page.locator('#settingsPanel').is_visible()
        panel_bounds=page.evaluate("""() => {
            const panel=document.querySelector('#settingsPanel').getBoundingClientRect();
            const done=document.querySelector('#settingsDone').getBoundingClientRect();
            return {panelTop:panel.top,panelBottom:panel.bottom,doneTop:done.top,
                    doneBottom:done.bottom,doneWidth:done.width};
        }""")
        assert panel_bounds['doneBottom']<=panel_bounds['panelBottom']+1,panel_bounds
        assert panel_bounds['doneTop']>=panel_bounds['panelTop']-1,panel_bounds
        assert panel_bounds['doneWidth']>60,panel_bounds
        page.locator('#settingsDone').click()
        assert page.locator('#settingsPanel').is_hidden()
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
        page.locator('#settingsBtn').click()
        assert page.locator('#settingsPanel').is_visible()
        assert page.evaluate('game.state')=='paused'
        page.locator('#effectsSelect').select_option('reduced')
        page.evaluate("""() => {
            const el=document.querySelector('#volumeRange');
            el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));
            const sense=document.querySelector('#sensitivityRange');
            sense.value='120';sense.dispatchEvent(new Event('input',{bubbles:true}));
        }""")
        assert page.locator('#volumeValue').inner_text()=='40%'
        assert page.locator('#sensitivityValue').inner_text()=='120%'
        assert page.evaluate('game.reducedMotion') is True
        page.keyboard.press('Escape')
        assert page.locator('#settingsPanel').is_hidden()
        assert page.evaluate('game.state')=='paused'
        page.locator('#overlayAction').click()
        assert page.evaluate('game.state')=='playing'
        page.evaluate("game.setSetting('effects','full')")
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
        assert combo_stats['marker'] == 'gameplay-100rc-20261101', combo_stats
        specials = page.evaluate("""() => {
            game.level=1;game.startLevel();game.launch();
            const blast=game.bricks.find(b=>b.type==='blast');
            const neighbor=game.bricks.find(b=>Math.abs(b.row-blast.row)+Math.abs(b.col-blast.col)===1);
            const hp=neighbor.hp;
            game.hitBrick(blast,game.bricks.indexOf(blast));
            game.applyDrop('shield');game.draw();
            const armed=window.__impulseDebug().shield;
            const lives=game.lives;
            game.ball.x=240;game.ball.y=CFG.bottom+CFG.ballRadius+3;
            game.ball.vx=140;game.ball.vy=300;game.moveBall(.001);
            return {blast:!!blast, damage:neighbor.hp===hp-1,
                    armed, shield:window.__impulseDebug().shield,
                    livesKept:game.lives===lives, saved:game.runStats.barriers};
        }""")
        assert specials['blast'] and specials['damage'], specials
        assert specials['armed'] == 1 and specials['shield'] == 0, specials
        assert specials['livesKept'] and specials['saved'] == 1, specials
        visual_fx = page.evaluate("""() => {
            game.level=1;game.startLevel();game.launch();
            const normal=game.bricks.find(b=>b.type==='normal');
            game.hitBrick(normal,game.bricks.indexOf(normal));
            const shards=game.particles.filter(p=>p.shard).length;
            const normalWave=game.waves.some(w=>w.radius===33);
            const core=game.bricks.find(b=>b.type==='core');
            game.hitBrick(core,game.bricks.indexOf(core));
            const coreWaves=game.waves.some(w=>w.radius===49)&&game.waves.some(w=>w.radius===28);
            const blast=game.bricks.find(b=>b.type==='blast');
            game.hitBrick(blast,game.bricks.indexOf(blast));
            const explosion=game.waves.some(w=>w.kind==='burst');
            game.draw();
            return {shards,normalWave,coreWaves,explosion,
                    waves:window.__impulseDebug().waves,
                    particles:window.__impulseDebug().particles};
        }""")
        assert visual_fx['shards'] and visual_fx['normalWave'], visual_fx
        assert visual_fx['coreWaves'] and visual_fx['explosion'], visual_fx
        assert visual_fx['waves'] <= 24 and visual_fx['particles'] <= 180, visual_fx
        guardian_stats = page.evaluate("""() => {
            game.level=2;game.startLevel();game.launch();game.draw();
            const moving=game.bricks.find(b=>b.type==='moving');
            const startX=moving.x,paintBefore=game.brickPaintCount;
            for(let i=0;i<60;i++){game.updateMovingBricks(1/60);game.draw()}
            const moved=moving.x!==startX,cache=game.brickPaintCount===paintBefore;
            game.bricks=[];game.checkStageCompletion();game.draw();
            const spawned=game.boss&&game.boss.hp===6&&game.state==='playing';
            let hits=0;
            while(game.boss&&hits<10){
                const boss=game.boss;
                boss.phaseTime=0;boss.lock=0;
                game.ball.x=boss.x+boss.w/2;
                game.ball.y=boss.y+boss.h+game.ball.r+.4;
                game.ball.vx=0;game.ball.vy=-game.levelSpeed();
                game.moveBall(.004);hits++;
            }
            const continued=game.state==='between'&&game.sectorPhase==='finished';
            const overlay=document.querySelector('#overlay').textContent;
            game.launch();game.launch();
            return {moved,cache,spawned,hits,continued,
                    overlay:overlay.includes('ПРИЗРАЧНЫЙ'),restored:game.state==='playing'&&game.level===3};
        }""")
        assert guardian_stats['moved'] and guardian_stats['cache'], guardian_stats
        assert guardian_stats['spawned'] and guardian_stats['hits'] == 6, guardian_stats
        assert guardian_stats['continued'] and guardian_stats['overlay'] and guardian_stats['restored'], guardian_stats
        reactor_stats = page.evaluate("""() => {
            game.level=4;game.startLevel();game.launch();game.draw();
            const special=game.bricks.some(b=>b.type==='charge') &&
                          game.bricks.some(b=>b.type==='prism') &&
                          game.bricks.some(b=>b.type==='moving');
            game.bricks=[];game.checkStageCompletion();
            const boss=game.boss;
            const spawned=game.sectorPhase==='reactor'&&boss?.kind==='reactor'&&boss.hp===6;
            const beforeX=boss.x;game.update(.03);
            const patrol=boss.x!==beforeX;
            const sprite=game.sprites.reactor && game.sprites.reactor.width===236;
            let hits=0;
            while(game.boss&&hits<10){
                const reactor=game.boss,node=reactor.nodes.find(n=>n.hp>0);
                reactor.lock=0;
                game.ball.x=reactor.x+node.offset;
                game.ball.y=reactor.y+reactor.h+game.ball.r+.4;
                game.ball.vx=0;game.ball.vy=-game.levelSpeed();
                game.moveBall(.004);hits++;
            }
            const won=game.state==='won'&&game.sectorPhase==='finished';
            const overlay=document.querySelector('#overlay').textContent.includes('ПЯТЬ СЕКТОРОВ');
            game.launch();game.launch();
            return {special,spawned,patrol,sprite,hits,won,overlay,
                    restored:game.state==='playing'&&game.level===0};
        }""")
        assert reactor_stats['special'] and reactor_stats['spawned'], reactor_stats
        assert reactor_stats['patrol'] and reactor_stats['sprite'], reactor_stats
        assert reactor_stats['hits'] == 6 and reactor_stats['won'] and reactor_stats['overlay'] and reactor_stats['restored'], reactor_stats
        visuals = page.evaluate("""() => {
            game.level=1;game.startLevel();game.launch();game.draw();
            const movers=game.bricks.filter(b=>b.type==='moving');
            const initial=movers.map(b=>b.x),paint=game.brickPaintCount;
            for(let n=0;n<120;n++){game.updateMovingBricks(1/60);game.draw()}
            const traveled=movers.some((b,i)=>Math.abs(b.x-initial[i])>5);
            const cached=game.brickPaintCount===paint;
            game.level=2;game.startLevel();game.launch();
            const roam=game.bricks.filter(b=>b.path==='roam');
            const start=roam.map(b=>b.y);
            for(let n=0;n<130;n++)game.updateMovingBricks(1/60);
            const verticalMotion=roam.some((b,i)=>Math.abs(b.y-start[i])>5);
            game.bricks=[];game.checkStageCompletion();
            game.draw();const spriteCount=game.spritePaintCount;
            const open=Boolean(game.sprites.guardianOpen),closed=Boolean(game.sprites.guardianShield);
            game.boss.phaseTime=2.7;game.draw();
            return {traveled,cached,verticalMotion,open,closed,spriteCount,
                    screen:window.__impulseDebug().phase};
        }""")
        assert visuals['traveled'] and visuals['cached'], visuals
        assert visuals['verticalMotion'] and visuals['open'] and visuals['closed'], visuals
        assert visuals['spriteCount'] == 7 and visuals['screen'] == 'guardian', visuals
        tactics = page.evaluate("""() => {
            game.level=1;game.startLevel();game.launch();
            const shield=game.bricks.find(b=>b.type==='directional'&&b.face==='U');
            const ball=game.ball,oldScore=game.score;
            game.energy=100;game.pulse();
            ball.x=shield.x+shield.w/2;
            ball.y=shield.y+shield.h+ball.r+.4;
            ball.vx=0;ball.vy=-game.levelSpeed();
            game.moveBall(.004);
            const protectedSide=shield.hp===1&&game.score===oldScore&&ball.vy>0;
            ball.x=shield.x+shield.w/2;ball.y=shield.y-ball.r-.4;
            ball.vx=0;ball.vy=game.levelSpeed();game.moveBall(.004);
            const destroyed=shield.hp===0;
            game.level=2;game.startLevel();game.launch();game.bricks=[];
            game.checkStageCompletion();
            const boss=game.boss,px=boss.x;
            game.update(.03);
            const bossMoves=boss.x!==px;
            game.shootBoss(boss);
            const projectiles=game.enemyShots.length===1&&window.__impulseDebug().shots===1;
            const shot=game.enemyShots[0];
            const lives=game.lives;game.applyDrop('shield');
            shot.x=game.paddle.x;shot.vx=0;shot.y=game.paddle.y-shot.r-1;
            game.updateEnemyShots(.03);
            const absorbed=game.lives===lives&&game.shieldCharges===0;
            game.draw();
            return {protectedSide,destroyed,bossMoves,projectiles,absorbed};
        }""")
        assert all(tactics.values()), tactics
        wall_bricks = page.evaluate("""() => {
            let reachable=true;
            for(let sector=1;sector<5;sector++){
                game.level=sector;game.startLevel();
                for(const brick of game.bricks.filter(b=>b.type==='directional')){
                    if(game.directionalClearance(brick)<2*CFG.ballRadius+2)reachable=false;
                }
            }
            game.level=2;game.startLevel();game.launch();
            const block=game.bricks.find(b=>b.type==='directional'&&b.col===5);
            const wallGap=CFG.right-block.x-block.w;
            const corrected=block.face==='D'&&wallGap<2*CFG.ballRadius+2;
            game.bricks=[block];
            const ball=game.ball;
            ball.x=block.x+block.w/2;
            ball.y=block.y+block.h+ball.r+.4;
            ball.vx=0;ball.vy=-game.levelSpeed();
            game.moveBall(.004);
            const completed=block.hp===0&&game.bricks.length===0&&
                game.sectorPhase==='guardian';
            game.startNewGame();game.launch();
            return {reachable,corrected,completed};
        }""")
        assert all(wall_bricks.values()), wall_bricks

        # Restore gameplay after checking the boss appearance.
        multiball = page.evaluate("""() => {
            game.startNewGame();game.launch();
            game.level=1;game.startLevel();game.launch();
            const prism=game.bricks.find(b=>b.type==='prism');
            game.hitBrick(prism,game.bricks.indexOf(prism));
            const spawned=game.activeBalls().length===3&&window.__impulseDebug().balls===3;
            const first=game.ball;
            first.y=CFG.bottom+first.r+2;first.vy=240;
            const lives=game.lives;
            game.moveBall(.001,first,false);
            const survived=game.lives===lives&&game.activeBalls().length===2;
            game.applyDrop('magnet');
            const b=game.ball;
            b.x=game.paddle.x;b.y=game.paddle.y-b.r-.2;
            b.vx=0;b.vy=300;game.moveBall(.001,b,false);
            const caught=b.held&&window.__impulseDebug().held===1;
            const button=document.querySelector('#launchBtn');
            const enabled=!button.disabled;
            game.draw();button.click();
            const released=!b.held&&b.vy<0;
            game.level=2;game.startLevel();game.launch();
            const energy=game.energy,charge=game.bricks.find(b=>b.type==='charge');
            game.hitBrick(charge,game.bricks.indexOf(charge));
            const charged=game.energy===energy+42;
            game.draw();
            return {spawned,survived,caught,enabled,released,charged};
        }""")
        assert all(multiball.values()), multiball
        # Resume a neutral state for existing pause and renderer checks.
        page.evaluate("game.startNewGame();game.launch()")


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
        assert sprite_stats['before'] == 7, sprite_stats
        assert sprite_stats['after'] == 7, sprite_stats
        assert sprite_stats['ball'] and sprite_stats['paddle'], sprite_stats
        assert isinstance(sprite_stats['visibleStats'], (int, float)), sprite_stats
        print(f"{label}: sector3 90 paints in {paint_stats['ms']:.1f}ms (desktop/mobile emulation)")
        assert not errors, errors
        print(f'{label}: responsive, controls, pause, blur OK; JS errors: 0')
        context.close()
    # Dedicated real-origin browser session: localStorage must survive a reload.
    # The response is served by Playwright itself, with no external network.
    inline_html=html.replace('</head>', '<style>'+css+'</style></head>').replace(
        '</body>', '<script>'+renderer+'</script><script>'+js+'</script></body>')
    for label,width,height in [('checkpoint-mobile-320',320,568),('checkpoint-mobile-393',393,852)]:
        context=browser.new_context(viewport={'width':width,'height':height},
                                    is_mobile=True,has_touch=True)
        page=context.new_page()
        errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.route('https://impulse.test/**', lambda route: route.fulfill(
            status=200,content_type='text/html',body=inline_html))
        page.goto('https://impulse.test/')
        assert page.evaluate('window.__impulseDebug().state') == 'menu'
        page.locator('#settingsBtn').click()
        page.locator('#effectsSelect').select_option('reduced')
        page.locator('#settingsDone').click()
        page.locator('#soundBtn').click()
        assert page.evaluate("game.settings.sound && game.reducedMotion")
        first=page.evaluate("""() => {
            game.launch();game.launch();
            game.score=6450;game.lives=2;game.energy=75;
            game.runStats.hits=38;
            game.bricks=[];game.checkStageCompletion();
            return {phase:game.state,sector:game.checkpoint?.sector,
                    score:game.score,stored:!!localStorage.getItem(CFG.checkpointKey)};
        }""")
        assert first['phase']=='between' and first['sector']==1 and first['stored'],first
        page.reload()
        assert page.evaluate('window.__impulseDebug().state')=='menu'
        assert page.evaluate("game.settings.sound && game.settings.effects==='reduced'")
        assert page.locator('#settingsBtn').get_attribute('aria-expanded')=='false'
        assert page.locator('#newGameAction').is_visible()
        assert 'ПРОДОЛЖИТЬ' in page.locator('#overlayAction').inner_text()
        geo=page.evaluate("""() => {
            const stage=document.querySelector('#overlay').getBoundingClientRect();
            const button=document.querySelector('#newGameAction').getBoundingClientRect();
            return {buttonBottom:button.bottom,stageBottom:stage.bottom,
                    buttonTop:button.top,stageTop:stage.top};
        }""")
        assert geo['buttonBottom']<=geo['stageBottom']+1 and geo['buttonTop']>=geo['stageTop']-1,geo
        page.locator('#overlayAction').click()
        resumed=page.evaluate("""() => ({
            state:game.state,level:game.level,score:game.score,lives:game.lives,
            energy:game.energy,hits:game.runStats.hits,balls:game.activeBalls().length
        })""")
        assert resumed=={'state':'ready','level':1,'score':first['score'],
                         'lives':2,'energy':75,'hits':38,'balls':1},resumed
        # Reload again and explicitly start a new campaign.
        page.reload()
        page.locator('#newGameAction').click()
        assert page.evaluate('game.level===0&&game.score===0&&game.lives===3&&game.state==="ready"')
        assert page.evaluate('localStorage.getItem(CFG.checkpointKey)') is None
        page.reload()
        assert page.locator('#newGameAction').count()==0
        assert not errors,errors
        print(f'{label}: local checkpoint, reload, continue and reset OK')
        context.close()
    browser.close()
