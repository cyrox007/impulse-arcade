'use strict';
// Каждая группа тестов использует одну и ту же изолированную игровую среду.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {root, createEnvironment, finishGuardian, finishReactor} = require('./support/game-harness.cjs');

test('стартовая сцена → готовность → запуск шара', () => {
  const {game,CFG,LEVELS} = createEnvironment();
  assert.equal(game.state, 'menu');
  assert.equal(LEVELS.length, 5);
  game.launch();
  assert.equal(game.state, 'ready');
  assert.equal(game.bricks.length, LEVELS[0].rows.join('').replaceAll('.', '').length);
  game.launch();
  assert.equal(game.state, 'playing');
  assert.ok(Math.abs(game.ballSpeed() - CFG.initialSpeed) < 0.001);
});

test('пауза фиксирует физику; продолжение возвращает состояние', () => {
  const {game} = createEnvironment();
  game.launch(); game.launch();
  game.update(0.03);
  game.togglePause();
  assert.equal(game.state, 'paused');
  const position = [game.ball.x, game.ball.y];
  game.update(0.03);
  assert.deepEqual([game.ball.x, game.ball.y], position);
  game.launch();
  assert.equal(game.state, 'playing');
});

test('импульс расходует 100% заряда и включается только во время игры', () => {
  const {game,CFG} = createEnvironment();
  game.launch();
  game.energy = 100;
  game.pulse();
  assert.equal(game.energy, 100, 'нельзя активировать до начала движения');
  game.launch();
  game.pulse();
  assert.equal(game.energy, 0);
  assert.equal(game.timers.pulse, CFG.pulseDuration);
  game.pulse();
  assert.equal(game.energy, 0);
});

test('повреждение кирпича, счёт, рекорд и переход между тремя уровнями', () => {
  const {game,LEVELS,CFG,storage} = createEnvironment();
  game.launch(); game.launch();
  const initialScore = game.score;
  let armor = game.bricks.find(b => b.hp===2);
  assert.equal(armor,undefined,'на первом уровне нет брони');
  game.hitBrick(game.bricks[0],0);
  assert.ok(game.score > initialScore);
  for(let level=0;level<LEVELS.length;level++) {
    while(game.bricks.length) {
      const brick=game.bricks[game.bricks.length-1];
      brick.lock=0;game.hitBrick(brick,game.bricks.length-1);
    }
    assert.equal(game.bricks.length,0);
    if (level===2)finishGuardian(game);
    if (level<LEVELS.length-1) {
      assert.equal(game.state,'between');
      game.launch();
      assert.equal(game.state,'ready');
      assert.equal(game.level,level+1);
      game.launch();
    } else finishReactor(game);
  }
  assert.ok(game.best>0);
  assert.equal(Number(storage.get(CFG.storageKey)), game.best);
});

test('потеря трёх жизней завершает игру; повтор запускает новую', () => {
  const {game} = createEnvironment();
  game.launch();game.launch();
  game.dropBall();
  assert.equal(game.lives,2);
  assert.equal(game.state,'ready');
  game.launch();game.dropBall();
  game.launch();game.dropBall();
  assert.equal(game.state,'lost');
  assert.equal(game.lives,0);
  game.launch();
  assert.equal(game.state,'ready');
  assert.equal(game.lives,3);
  assert.equal(game.score,0);
});

test('ограничение положения платформы и захват бонусов', () => {
  const {game,CFG} = createEnvironment();
  game.launch();game.launch();
  game.keys.ArrowRight=true;
  game.targetX=CFG.right+100;
  game.update(.03);
  assert.ok(game.targetX<=CFG.right-game.paddle.w/2);
  game.keys.ArrowRight=false;
  game.applyDrop('wide');
  assert.equal(game.paddle.w,145);
  assert.ok(game.timers.wide>0);
  game.applyDrop('life');
  assert.equal(game.lives,4);
});

test('статический сайт не зависит от внешних JS/CSS и имеет мета-описание', () => {
  const html = readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html, /name="description"/);
  assert.match(html, /src="game-render\.js\?v=gameplay-100rc-20261101"/);
  assert.match(html, /src="game\.js\?v=gameplay-100rc-20261101"/);
  assert.match(html, /src="game-input\.js\?v=gameplay-100rc-20261101"/);
  assert.ok(html.indexOf("game.js") < html.indexOf("game-input.js"), "управление загружается после модели");
  assert.ok(html.indexOf("game-render.js") < html.indexOf("game.js"), "сначала подключается отрисовка");
  assert.match(html, /href="style\.css\?v=gameplay-100rc-20261101"/);
  assert.doesNotMatch(html, /<script[^>]*src="https?:\/\//i);
  assert.doesNotMatch(html, /<link[^>]*href="https?:\/\//i);
});

test('центральное попадание в платформу не даёт вертикальной петли', () => {
  const {game,CFG}=createEnvironment();
  game.launch();game.launch();
  game.ball.x=game.paddle.x;
  game.ball.y=game.paddle.y-game.ball.r-.5;
  game.ball.vx=0;game.ball.vy=CFG.initialSpeed;
  game.moveBall(.004);
  assert.ok(Math.abs(game.ball.vx)>CFG.initialSpeed*.1);
  assert.ok(game.ball.vy<0);
});

test('боковой удар по кирпичу отражает мяч горизонтально', () => {
  const {game}=createEnvironment();
  game.launch();game.launch();
  const brick=game.bricks[0];
  game.ball.x=brick.x-game.ball.r-1;
  game.ball.y=brick.y+brick.h/2;
  game.ball.vx=400;game.ball.vy=0;
  game.moveBall(.005);
  assert.ok(game.ball.vx<0);
  assert.ok(game.ball.x<brick.x);
});

test('второй палец не перехватывает управление мобильной платформой', () => {
  const {game,elements,CFG}=createEnvironment();
  game.launch();
  const canvas=elements.get('game');
  const down=canvas.listeners.get('pointerdown');
  const move=canvas.listeners.get('pointermove');
  const up=canvas.listeners.get('pointerup');
  const ev=(pointerId,clientX)=>({pointerType:'touch',pointerId,clientX,cancelable:true,preventDefault(){}});
  down(ev(11,340));
  assert.equal(game.activePointerId,11);
  const first=game.targetX;
  down(ev(22,60));move(ev(22,60));
  assert.equal(game.targetX,first);
  up(ev(22,60));assert.equal(game.activePointerId,11);
  move(ev(11,300));
  assert.notEqual(game.targetX,first);
  up(ev(11,300));assert.equal(game.activePointerId,null);
  move({pointerType:'mouse',pointerId:33,clientX:400});
  assert.ok(game.targetX>CFG.width/2);
});

test('потеря фокуса очищает кнопки и касания, игра уходит на паузу', () => {
  const {game,handlers}=createEnvironment();
  game.launch();game.launch();
  game.keys.ArrowRight=true;
  game.activePointerId=12;
  handlers.get('window:blur')();
  assert.equal(game.state,'paused');
  assert.equal(game.activePointerId,null);
  assert.equal(Object.keys(game.keys).length,0);
});

test('0.2: все три сектора проходимы через реальную логику попадания мяча', () => {
  const {game,CFG,LEVELS,storage,elements} = createEnvironment();
  game.launch();
  assert.equal(game.state,'ready');
  const sectorScores=[];
  for(let sector=0;sector<LEVELS.length;sector++) {
    assert.equal(game.level,sector);
    assert.equal(elements.get('compactSector').textContent,`${String(sector+1).padStart(2,'0')}/05`);
    game.launch();
    assert.equal(game.state,'playing');
    assert.ok(Math.abs(game.ballSpeed()-game.levelSpeed())<.001);
    let contacts=0;
    while(game.bricks.length && game.state==='playing'){
      const brick=game.bricks[game.bricks.length-1];
      brick.lock=0;
      const oldHP=brick.hp;
      // Put the ball just below a real brick and let moveBall resolve contact.
      if(brick.type==='directional'){
        // Direction-sensitive collisions are covered separately with all four faces.
        game.hitBrick(brick,game.bricks.indexOf(brick));
      }else{
        game.ball.x=brick.x+brick.w/2;
        game.ball.y=brick.y+brick.h+game.ball.r+.5;
        game.ball.vx=0;game.ball.vy=-game.levelSpeed();
        game.moveBall(.004);
      }
      assert.equal(brick.hp,oldHP-1,'every contact must damage exactly once');
      if(++contacts>200)assert.fail('unbounded contact loop');
    }
    assert.equal(game.bricks.length,0);
    sectorScores.push(game.score);
    if(sector===2)finishGuardian(game);
    if(sector<LEVELS.length-1){
      assert.equal(game.state,'between');
      assert.equal(elements.get('overlay').hidden,false);
      const lastScore=game.score,lastLives=game.lives,lastEnergy=game.energy;
      game.launch(); // Continue via regular start action.
      assert.equal(game.level,sector+1);
      assert.equal(game.state,'ready');
      assert.equal(game.score,lastScore);
      assert.equal(game.lives,lastLives);
      assert.equal(game.energy,lastEnergy);
      assert.equal(game.ballSpeed(),0);
    }else{
      finishReactor(game);
      assert.equal(elements.get('overlay').hidden,false);
      assert.ok(elements.get('overlay').innerHTML.includes('ПЯТЬ СЕКТОРОВ И ДВА БОССА ПРОЙДЕНЫ'));
      sectorScores[sector]=game.score;
    }
  }
  assert.ok(sectorScores[0]>0 && sectorScores[1]>sectorScores[0] && sectorScores[2]>sectorScores[1]);
  const best=game.best,finalScore=game.score;
  assert.equal(best,finalScore);
  assert.equal(Number(storage.get(CFG.storageKey)),best);
  game.launch();
  assert.equal(game.state,'ready');
  assert.equal(game.level,0);
  assert.equal(elements.get('compactSector').textContent,'01/05');
  assert.equal(game.lives,3);
  assert.equal(game.score,0);
  assert.equal(game.best,best);
  assert.equal(game.energy,0);
});

test('0.2: рост стартовой скорости по секторам остаётся в безопасных пределах', () => {
  const {game,CFG,LEVELS}=createEnvironment();
  const speeds=LEVELS.map((_,i)=>{game.level=i;return game.levelSpeed()});
  assert.equal(speeds[0],CFG.initialSpeed);
  assert.ok(speeds[0]<speeds[1] && speeds[1]<speeds[2]);
  assert.ok(speeds.every(s=>s<=CFG.maxSpeed));
  assert.ok(LEVELS.every(level=>level.dropChance>=0 && level.dropChance<=1));
  assert.ok(LEVELS[2].dropChance>=LEVELS[0].dropChance);
});

test('0.2: бонусы, потеря мяча и начало уровня не оставляют старые эффекты', () => {
  const {game,CFG}=createEnvironment();
  game.launch();game.launch();
  game.applyDrop('wide');
  game.applyDrop('slow');
  game.energy=100;game.pulse();
  assert.ok(game.timers.pulse>0);
  assert.ok(game.timers.wide>0);
  assert.ok(game.timers.slow>0);
  game.dropBall();
  assert.equal(game.state,'ready');
  assert.equal(game.timers.pulse,0);
  assert.equal(game.timers.slow,0);
  assert.equal(game.timers.wide,0);
  assert.equal(game.paddle.w,CFG.paddleW);
  assert.equal(game.drops.length,0);
  assert.equal(game.lives,2);
  assert.equal(game.energy,0);
  game.launch();
  assert.equal(game.state,'playing');
  assert.ok(Math.abs(game.ballSpeed()-game.levelSpeed())<.001);
});

test('0.2: замедление восстанавливает скорость по истечении таймера', () => {
  const {game}=createEnvironment();
  game.launch();game.launch();
  game.ball.x=240;game.ball.y=510;
  const before=game.ballSpeed();
  game.applyDrop('slow');
  assert.ok(game.ballSpeed()<before);
  game.timers.slow=.001;
  game.update(.005);
  assert.equal(game.timers.slow,0);
  assert.ok(Math.abs(game.ballSpeed()-before)<1);
});

test('0.2: пауза останавливает таймеры, частицы и игровое время', () => {
  const {game}=createEnvironment();
  game.launch();game.launch();
  game.applyDrop('wide');
  game.addParticles(150,200,2,'#fff');
  const snap=()=>JSON.stringify({time:game.time,frame:game.frame,particles:game.particles,
    ball:game.ball,timers:game.timers,energy:game.energy});
  game.togglePause();
  const paused=snap();
  for(let i=0;i<50;i++)game.update(.016);
  assert.equal(snap(),paused);
  game.launch();
  game.update(.016);
  assert.notEqual(snap(),paused);
});

test('0.2: симуляция FPS 30/60/120 не создаёт нечисловые или выходящие за поле координаты', () => {
  const {CFG}=createEnvironment();
  for(const fps of [30,60,120]) {
    const {game}=createEnvironment();
    game.launch();game.launch();
    game.bricks=[]; // isolate ball and wall motion; sector completion is tested separately
    game.ball.x=240;game.ball.y=420;game.ball.vx=150;game.ball.vy=-280;
    for(let frame=0;frame<fps*7;frame++){
      if(game.state==='ready')game.launch();
      game.update(1/fps);
      for(const k of ['x','y','vx','vy'])assert.ok(Number.isFinite(game.ball[k]),fps+':'+k);
      assert.ok(game.ball.x>=CFG.left-1 && game.ball.x<=CFG.right+1);
      assert.ok(game.ballSpeed()<=CFG.maxSpeed+1);
      if(game.state==='lost')break;
    }
  }
});

test('perf: фон создаётся один раз, слой кирпичей не рисуется каждый кадр', () => {
  const {game}=createEnvironment();
  assert.ok(game.backdropLayer && game.brickLayer);
  game.launch();game.launch();
  game.draw();
  const first=game.brickPaintCount;
  for(let i=0;i<120;i++)game.draw();
  assert.equal(game.brickPaintCount,first,'same bricks should reuse cached image');
  assert.equal(game.bricksDirty,false);
  assert.equal(game.brickLayer.canvas.width,480);
  assert.equal(game.brickLayer.canvas.height,720);
});

test('perf: урон, разрушение и следующий сектор инвалидируют кэш кирпичей', () => {
  const {game}=createEnvironment();
  game.launch();game.launch();game.draw();
  const before=game.brickPaintCount;
  const first=game.bricks[0];
  first.lock=0;
  game.hitBrick(first,0);
  assert.equal(game.bricksDirty,true);
  game.draw();
  assert.equal(game.brickPaintCount,before+1);
  for(let i=0;i<30;i++)game.draw();
  assert.equal(game.brickPaintCount,before+1);
  while(game.bricks.length){
    const b=game.bricks[game.bricks.length-1];
    b.lock=0;game.hitBrick(b,game.bricks.length-1);
  }
  assert.equal(game.state,'between');
  game.launch();
  assert.equal(game.state,'ready');
  assert.equal(game.level,1);
  assert.equal(game.bricksDirty,true);
  game.draw();
  assert.equal(game.bricksDirty,false);
  assert.equal(game.brickPaintCount,before+2);
});

test('perf: частицы ограничены и диагностические счётчики доступны', () => {
  const {game}=createEnvironment();
  game.addParticles(100,100,250,'#fff');
  assert.equal(game.particles.length,180);
  game.addParticles(100,100,90,'#fff');
  assert.equal(game.particles.length,180);
  assert.equal(typeof game.performance.fps,'number');
  assert.equal(typeof game.performance.maxFrameMs,'number');
});

test('perf: sprites мяча и платформы создаются однократно и переиспользуются', () => {
  const {game,CFG,gradientCalls}=createEnvironment();
  assert.equal(game.spritePaintCount,7);
  assert.ok(game.sprites.paddleNormal && game.sprites.paddleWide);
  assert.ok(game.sprites.ballNormal && game.sprites.ballPulse);
  assert.equal(game.sprites.ballNormal.width,CFG.ballRadius*2+72);
  assert.equal(game.sprites.paddleWide.width,145+52);
  game.launch();game.launch();game.draw();
  const before={...gradientCalls},paints=game.spritePaintCount;
  for(let i=0;i<120;i++)game.draw();
  assert.deepEqual(gradientCalls,before,'moving objects must reuse cached gradients');
  game.applyDrop('wide');
  game.energy=100;game.pulse();
  game.draw();
  assert.equal(game.spritePaintCount,paints,'wide and pulse use pre-rendered assets');
  assert.deepEqual(gradientCalls,before,'activation must not allocate new gradients');
});

test('perf: FPS-профайлер по умолчанию неактивен и включается только параметром', () => {
  const defaultRun=createEnvironment();
  assert.equal(defaultRun.game.profileEnabled,false);
  const diagnostic=createEnvironment({fpsDebug:true});
  assert.equal(diagnostic.game.profileEnabled,true);
  diagnostic.game.launch();diagnostic.game.launch();
  for(let i=1;i<=90;i++)diagnostic.tick(i*1000/60);
  const p=diagnostic.game.performance;
  assert.ok(p.fps>=58&&p.fps<=61);
  assert.ok(p.avgUpdateMs>=0&&Number.isFinite(p.avgUpdateMs));
  assert.ok(p.avgDrawMs>=0&&Number.isFinite(p.avgDrawMs));
  assert.ok(p.maxFrameMs>=16&&p.maxFrameMs<=17);
  assert.equal(typeof diagnostic.game.sprites.ballNormal,'object');
  // The opt-in counters must not change physics or advance game time when paused.
  diagnostic.game.togglePause();
  const lastTime=diagnostic.game.time;
  diagnostic.tick(91*1000/60);
  assert.equal(diagnostic.game.time,lastTime);
});

