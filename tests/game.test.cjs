'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'game.js'), 'utf8');

function createEnvironment({fpsDebug=false,reducedMotion=false}={}) {
  const handlers = new Map();
  const gradientCalls={linear:0,radial:0};
  let animationFrame=null, clock=0;
  const records = new Map();
  const storage = new Map();
  const fakeGradient = {addColorStop() {}};
  const canvasContext = new Proxy({}, {
    get(target, property) {
      if (property === 'createLinearGradient') return () => {gradientCalls.linear++;return fakeGradient;};
      if (property === 'createRadialGradient') return () => {gradientCalls.radial++;return fakeGradient;};
      if (!Object.hasOwn(target, property)) target[property] = () => {};
      return target[property];
    }
  });
  function makeElement(id) {
    const listeners = new Map();
    const element = {
      id, style: {}, disabled: false, hidden: false, innerHTML: '', textContent: '',
      listeners,
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      querySelector() {return makeElement('child');},
      getBoundingClientRect() {return {left:0,width:480};},
      setPointerCapture() {},
      getContext() {return canvasContext;}
    };
    return element;
  }
  const document = {
    hidden:false,
    getElementById(id) {if (!records.has(id)) records.set(id, makeElement(id));return records.get(id);},
    createElement(tag) {if(tag!=='canvas')throw Error('Unexpected element '+tag);return {width:0,height:0,getContext(){return canvasContext;}};},
    addEventListener(type, handler) { handlers.set('document:'+type, handler); }
  };
  const window = {location:{search:fpsDebug?'?fps=1':''},
    matchMedia:()=>({matches:reducedMotion}),
    addEventListener(type, handler) {handlers.set('window:'+type, handler);}};
  const sandbox = {
    window, document,
    localStorage: {getItem(key) {return storage.get(key)??null;}, setItem(key,value) {storage.set(key,value);}},
    performance: {now: () => clock++ / 2},
    requestAnimationFrame(cb) {animationFrame=cb;},
    console, Math, Array, Object, String, Number, Map
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename:'game.js'});
  return { ...vm.runInContext('({game,CFG,LEVELS})', sandbox),
    handlers, elements:records, storage, gradientCalls,
    tick(now){if(!animationFrame)throw Error('RAF was not scheduled');animationFrame(now);}
  };
}

function finishGuardian(game){
  assert.equal(game.sectorPhase,'guardian','guardian should begin after all bricks');
  assert.ok(game.boss);
  let hits=0;
  while(game.boss){
    const b=game.boss;
    b.lock=0;b.phaseTime=0;
    game.ball.x=b.x+b.w/2;game.ball.y=b.y+b.h+game.ball.r+.4;
    game.ball.vx=0;game.ball.vy=-game.levelSpeed();
    game.moveBall(.004);
    if(++hits>10)assert.fail('guardian stuck');
  }
  assert.equal(hits,6);
  assert.equal(game.state,'won');
  assert.equal(game.sectorPhase,'finished');
}

test('стартовая сцена → готовность → запуск шара', () => {
  const {game,CFG,LEVELS} = createEnvironment();
  assert.equal(game.state, 'menu');
  assert.equal(LEVELS.length, 3);
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
    if (level<LEVELS.length-1) {
      assert.equal(game.state,'between');
      game.launch();
      assert.equal(game.state,'ready');
      assert.equal(game.level,level+1);
      game.launch();
    } else finishGuardian(game);
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
  assert.match(html, /src="game\.js\?v=gameplay-051-20261101"/);
  assert.match(html, /href="style\.css\?v=gameplay-051-20261101"/);
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
    assert.equal(elements.get('compactSector').textContent,`${String(sector+1).padStart(2,'0')}/03`);
    game.launch();
    assert.equal(game.state,'playing');
    assert.ok(Math.abs(game.ballSpeed()-game.levelSpeed())<.001);
    let contacts=0;
    while(game.bricks.length && game.state==='playing'){
      const brick=game.bricks[game.bricks.length-1];
      brick.lock=0;
      const oldHP=brick.hp;
      // Put the ball just below a real brick and let moveBall resolve contact.
      game.ball.x=brick.x+brick.w/2;
      game.ball.y=brick.y+brick.h+game.ball.r+.5;
      game.ball.vx=0;game.ball.vy=-game.levelSpeed();
      game.moveBall(.004);
      assert.equal(brick.hp,oldHP-1,'every contact must damage exactly once');
      if(++contacts>200)assert.fail('unbounded contact loop');
    }
    assert.equal(game.bricks.length,0);
    sectorScores.push(game.score);
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
      finishGuardian(game);
      assert.equal(elements.get('overlay').hidden,false);
      assert.ok(elements.get('overlay').innerHTML.includes('ТРИ СЕКТОРА И СТРАЖ ПРОЙДЕНЫ'));
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
  assert.equal(elements.get('compactSector').textContent,'01/03');
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
  assert.equal(game.spritePaintCount,6);
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

test('0.3: серия попаданий начисляет ограниченный множитель очков', () => {
  const {game}=createEnvironment();
  game.launch();game.launch();
  const scores=[100,100,100,200,200,200,300,300,300,400];
  for(let i=0;i<scores.length;i++) {
    const before=game.score;
    game.hitBrick(game.bricks[0],0);
    assert.equal(game.score-before,scores[i], 'gain for collision '+(i+1));
    assert.equal(game.comboHits,i+1);
    assert.ok(game.comboMultiplier()<=4);
  }
  assert.equal(game.comboMultiplier(),4);
  assert.equal(game.bestComboInSector,10);
  // More successful contacts never increase the multiplier above four.
  game.comboHits=100;
  assert.equal(game.comboMultiplier(),4);
});

test('0.3: броня сохраняет поэтапное повреждение и использует множитель', () => {
  const {game}=createEnvironment();
  game.launch();
  game.level=1;game.startLevel();game.launch();
  const armor=game.bricks.find(b=>b.hp===2);
  assert.ok(armor);
  const idx=game.bricks.indexOf(armor);
  game.comboHits=3;game.comboUntil=game.time+4;
  const before=game.score;
  game.hitBrick(armor,idx);
  assert.equal(armor.hp,1);
  assert.equal(game.score-before,70); // x2 × 35 for armored hit
  armor.lock=0;
  game.hitBrick(armor,idx);
  assert.equal(armor.hp,0);
  assert.equal(game.score-before,70+720); // x2 × 180 × sector 2
  assert.equal(game.bestComboInSector,5);
});

test('0.3: серия сбрасывается от платформы, потери шара и простоя', () => {
  const {game,CFG}=createEnvironment();
  game.launch();game.launch();
  game.hitBrick(game.bricks[0],0);
  game.hitBrick(game.bricks[0],0);
  assert.equal(game.comboHits,2);
  // Crossing the paddle on a valid downward trajectory ends the chain.
  game.ball.x=game.paddle.x;
  game.ball.y=game.paddle.y-game.ball.r-1;
  game.ball.vx=60;game.ball.vy=315;
  game.moveBall(.004);
  assert.equal(game.comboHits,0);
  game.hitBrick(game.bricks[0],0);
  assert.equal(game.comboHits,1);
  game.time+=CFG.comboWindow+.01;
  game.hitBrick(game.bricks[0],0);
  assert.equal(game.comboHits,1);
  game.dropBall();
  assert.equal(game.comboHits,0);
  game.launch();
  assert.equal(game.comboMultiplier(),1);
});

test('0.3: пауза сохраняет серию и время бонусов', () => {
  const {game,CFG}=createEnvironment();
  game.launch();game.launch();
  game.hitBrick(game.bricks[0],0);
  game.hitBrick(game.bricks[0],0);
  game.applyDrop('wide');game.applyDrop('slow');
  game.energy=100;game.pulse();
  const t=game.time,until=game.comboUntil,timers=JSON.stringify(game.timers);
  game.togglePause();
  for(let n=0;n<60;n++)game.update(.016);
  assert.equal(game.time,t);
  assert.equal(game.comboUntil,until);
  assert.equal(game.comboHits,2);
  assert.equal(JSON.stringify(game.timers),timers);
  game.launch();
  // Timer and streak still advance only during active play.
  game.time=until+CFG.comboWindow;
  game.update(.001);
  assert.equal(game.comboHits,0);
});

test('0.3: завершение сектора даёт бонус за жизни и сбрасывает комбо', () => {
  const {game,LEVELS,storage,CFG,elements}=createEnvironment();
  game.launch();game.launch();
  for(let sector=0;sector<LEVELS.length;sector++) {
    const oldLevel=game.level;
    game.lives=2;
    let hits=0;
    while(game.bricks.length){
      const brick=game.bricks[game.bricks.length-1];
      brick.lock=0;game.hitBrick(brick,game.bricks.length-1);hits++;
    }
    assert.ok(hits>0);
    if(sector===LEVELS.length-1)finishGuardian(game);
    assert.equal(game.lastSectorBonus,200*(oldLevel+1));
    assert.equal(game.comboHits,0);
    assert.equal(game.lastSectorBestCombo,hits);
    assert.ok(game.score>=game.lastSectorBonus);
    assert.equal(game.best,game.score);
    assert.equal(Number(storage.get(CFG.storageKey)),game.score);
    if(sector<LEVELS.length-1){
      assert.ok(elements.get('overlay').innerHTML.includes('Бонус за жизни'));
      game.launch();
      assert.equal(game.level,sector+1);
      assert.equal(game.comboHits,0);
      game.launch();
    }else{
      assert.equal(game.state,'won');
      assert.ok(elements.get('overlay').innerHTML.includes('Бонус финального сектора'));
    }
  }
  game.launch();
  assert.equal(game.score,0);
  assert.equal(game.lastSectorBonus,0);
  assert.equal(game.bestComboInSector,0);
});

test('0.3: защита от горизонтальной петли сохраняет скорость и направление', () => {
  const {game,CFG}=createEnvironment();
  game.launch();game.launch();
  game.ball.x=CFG.width/2;game.ball.y=500;
  for(const sign of [-1,1]){
    game.ball.vx=420;game.ball.vy=sign*3;
    const before=game.ballSpeed();
    game.moveBall(.001);
    assert.equal(Math.sign(game.ball.vy),sign);
    assert.ok(Math.abs(game.ball.vy)>=before*.2-.01);
    assert.ok(Math.abs(game.ballSpeed()-before)<.001);
  }
});

test('0.3: подсказки бонусов и серии не требуют новых внешних элементов', () => {
  const {game,elements}=createEnvironment();
  game.launch();game.launch();
  game.hitBrick(game.bricks[0],0);
  game.hitBrick(game.bricks[0],0);
  game.applyDrop('wide');
  game.applyDrop('slow');
  game.energy=100;game.pulse();
  assert.doesNotThrow(()=>game.drawGameplayStatus());
  assert.equal(game.comboHits,2);
  assert.ok(game.timers.wide>0&&game.timers.slow>0&&game.timers.pulse>0);
  assert.equal(elements.get('compactSector').textContent,'01/03');
  assert.equal(game.paddle.w,145);
});

test('0.4: взрывные блоки появляются во втором и третьем секторах',()=>{
  const {game}=createEnvironment();
  game.launch();
  assert.equal(game.bricks.some(b=>b.type==='blast'),false);
  game.level=1;game.startLevel();
  const blast=game.bricks.find(b=>b.type==='blast');
  assert.ok(blast);
  assert.ok(Number.isInteger(blast.row)&&Number.isInteger(blast.col));
  game.level=2;game.startLevel();
  assert.ok(game.bricks.filter(b=>b.type==='blast').length>=2);
});

test('0.4: взрыв наносит соседям один урон без цепной детонации или лишних комбо',()=>{
  const {game}=createEnvironment();
  game.launch();game.level=1;game.startLevel();game.launch();
  const blast=game.bricks.find(b=>b.type==='blast');
  const neighbors=game.bricks.filter(b=>Math.abs(b.row-blast.row)+Math.abs(b.col-blast.col)===1);
  assert.ok(neighbors.length>=2);
  const initialHP=neighbors.map(b=>b.hp);
  const initialLength=game.bricks.length;
  game.hitBrick(blast,game.bricks.indexOf(blast));
  assert.equal(blast.hp,0);
  assert.equal(game.comboHits,1,'secondary hits do not inflate combo');
  neighbors.forEach((b,i)=>assert.equal(b.hp,initialHP[i]-1));
  assert.equal(game.runStats.hits,1);
  assert.equal(game.runStats.broken,1+neighbors.filter(b=>b.hp===0).length);
  assert.equal(game.bricks.length,initialLength-game.runStats.broken);
  assert.ok(game.energy>=20);
  assert.equal(game.bricksDirty,true);
});

test('0.4: одноразовый барьер спасает жизнь и сбрасывается после срабатывания',()=>{
  const {game,CFG}=createEnvironment();
  game.launch();game.launch();
  game.applyDrop('shield');assert.equal(game.shieldCharges,1);
  game.ball.x=240;game.ball.y=CFG.bottom+CFG.ballRadius+2;
  game.ball.vx=130;game.ball.vy=250;
  game.moveBall(.001);
  assert.equal(game.shieldCharges,0);
  assert.equal(game.lives,3);
  assert.equal(game.state,'playing');
  assert.ok(game.ball.vy<0);
  assert.equal(game.runStats.barriers,1);
  game.ball.y=CFG.bottom+CFG.ballRadius+2;game.ball.vy=250;
  game.moveBall(.001);
  assert.equal(game.lives,2);
  assert.equal(game.state,'ready');
  assert.equal(game.runStats.barriers,1);
});

test('0.4: статистика забега учитывает игровое время, удары, импульсы и сброс',()=>{
  const {game,elements}=createEnvironment();
  game.launch();game.launch();
  game.update(.025);
  const elapsed=game.runStats.seconds;
  assert.ok(elapsed>=.025);
  game.hitBrick(game.bricks[0],0);
  game.energy=100;game.pulse();
  assert.equal(game.runStats.hits,1);
  assert.equal(game.runStats.broken,1);
  assert.equal(game.runStats.pulses,1);
  assert.equal(game.runStats.maxCombo,1);
  game.togglePause();game.update(.05);
  assert.equal(game.runStats.seconds,elapsed);
  game.launch();
  game.end('lost');
  assert.ok(elements.get('overlay').innerHTML.includes('Разрушено: 1'));
  game.launch();
  assert.equal(game.runStats.hits,0);
  assert.equal(game.runStats.seconds,0);
  assert.equal(game.runStats.pulses,0);
});

test('0.4.1: каждый тип кирпича даёт собственный визуальный отклик',()=>{
  const {game}=createEnvironment();
  game.launch();game.launch();
  const normal=game.bricks.find(b=>b.type==='normal');
  game.hitBrick(normal,game.bricks.indexOf(normal));
  assert.ok(game.waves.some(w=>w.radius===33));
  assert.ok(game.particles.some(p=>p.shard&&p.color==='#6bcdff'));

  game.level=1;game.startLevel();game.launch();
  const armor=game.bricks.find(b=>b.type==='armor');
  game.hitBrick(armor,game.bricks.indexOf(armor));
  assert.ok(game.waves.some(w=>w.radius===18),'armored impact chips');
  armor.lock=0;game.hitBrick(armor,game.bricks.indexOf(armor));
  assert.ok(game.waves.some(w=>w.radius===41),'armored destruction');
  const core=game.bricks.find(b=>b.type==='core');
  game.hitBrick(core,game.bricks.indexOf(core));
  assert.ok(game.waves.some(w=>w.radius===49));
  assert.ok(game.waves.some(w=>w.radius===28));
  const blast=game.bricks.find(b=>b.type==='blast');
  game.hitBrick(blast,game.bricks.indexOf(blast));
  assert.ok(game.waves.some(w=>w.kind==='burst'&&w.radius===64));
  assert.ok(game.waves.some(w=>w.radius===95));
  assert.doesNotThrow(()=>game.drawWaves());
  assert.doesNotThrow(()=>game.drawParticles());
});

test('0.4.1: каскадные повреждения создают FX, но не рекурсивные взрывы',()=>{
  const {game}=createEnvironment();
  game.launch();game.level=2;game.startLevel();game.launch();
  const blast=game.bricks.find(b=>b.type==='blast');
  const neighbors=game.bricks.filter(b=>Math.abs(b.row-blast.row)+Math.abs(b.col-blast.col)===1);
  assert.ok(neighbors.length>=2);
  const before=game.runStats.hits;
  game.hitBrick(blast,game.bricks.indexOf(blast));
  assert.equal(game.runStats.hits,before+1);
  assert.equal(game.comboHits,1);
  assert.ok(game.waves.length>=2);
  assert.ok(game.particles.length>0);
  assert.ok(game.waves.length<=24);
  assert.ok(game.particles.length<=180);
});

test('0.4.1: затухание, пауза и очистка эффекта не влияют на физику',()=>{
  const {game}=createEnvironment();
  game.launch();game.launch();
  const brick=game.bricks[0];
  game.hitBrick(brick,0);
  assert.ok(game.waves.length>0);
  const life=game.waves[0].life;
  const ball=[game.ball.x,game.ball.y];
  game.togglePause();game.update(.15);game.draw();
  assert.equal(game.waves[0].life,life);
  assert.deepEqual([game.ball.x,game.ball.y],ball);
  game.launch();game.update(.5);
  assert.equal(game.waves.length,0);
  game.startNewGame();
  assert.equal(game.waves.length,0);
  assert.equal(game.particles.length,0);
});

test('0.4.1: лимиты эффектов и кэш кирпичей соблюдаются при залпах',()=>{
  const {game}=createEnvironment();
  game.launch();game.launch();
  game.draw();
  const oldPaint=game.brickPaintCount;
  for(let i=0;i<80;i++){
    game.addWave(240,200,'#fff',45,.25);
    game.addParticles(240,200,15,'#fff',{shard:true});
  }
  assert.equal(game.waves.length,24);
  assert.equal(game.particles.length,180);
  for(let i=0;i<120;i++)game.draw();
  assert.equal(game.brickPaintCount,oldPaint);
});

test('0.4.1: режим уменьшения анимации не создаёт ударных волн',()=>{
  const {game}=createEnvironment({reducedMotion:true});
  game.launch();game.launch();
  const brick=game.bricks[0];
  game.hitBrick(brick,0);
  assert.equal(game.waves.length,0);
  assert.ok(game.particles.length>0&&game.particles.length<=3);
});

test('0.5: в секторах 2–3 подвижные блоки не меняют статический кэш',()=>{
  const {game}=createEnvironment();game.launch();
  assert.equal(game.bricks.some(b=>b.type==='moving'),false);
  game.level=1;game.startLevel();game.launch();game.draw();
  const movers=game.bricks.filter(b=>b.type==='moving');
  assert.equal(movers.length,2);
  const before=game.brickPaintCount,positions=movers.map(b=>b.x);
  for(let i=0;i<120;i++){game.updateMovingBricks(1/60);game.draw()}
  assert.equal(game.brickPaintCount,before);
  assert.ok(movers.some((b,i)=>b.x!==positions[i]));
  assert.doesNotThrow(()=>game.drawMovingBricks());
  game.level=2;game.startLevel();
  assert.equal(game.bricks.filter(b=>b.type==='moving').length,2);
});

test('0.5: подвижная цель отражается от границы и не проходит сквозь соседей',()=>{
  const {game,CFG}=createEnvironment();game.launch();
  game.level=1;game.startLevel();
  const b=game.bricks.find(x=>x.type==='moving');
  for(const dt of [1/30,1/60,1/120]){
    for(let i=0;i<240;i++){
      game.updateMovingBricks(dt);
      assert.ok(b.x>=b.minX-.0001 && b.x<=b.maxX+.0001);
      assert.ok(b.x>=CFG.left && b.x+b.w<=CFG.right);
    }
  }
  b.x=b.maxX-.2;b.vx=36;game.updateMovingBricks(.01);
  assert.ok(Math.abs(b.x-(b.maxX-.16))<.00001);assert.ok(b.vx<0);
  b.x=b.minX+.2;b.vx=-36;game.updateMovingBricks(.01);
  assert.ok(Math.abs(b.x-(b.minX+.16))<.00001);assert.ok(b.vx>0);
});

test('0.5: удар по движущемуся блоку не пересобирает кэш кирпичей',()=>{
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
  game.draw();const paints=game.brickPaintCount;
  const moving=game.bricks.find(b=>b.type==='moving');
  const score=game.score;
  game.ball.x=moving.x+moving.w/2;game.ball.y=moving.y+moving.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(moving.hp,0);
  assert.ok(game.score>score);
  assert.equal(game.bricksDirty,false);
  game.draw();assert.equal(game.brickPaintCount,paints);
});

test('0.5: после последнего кирпича третьего сектора появляется Страж',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  while(game.bricks.length){
    const b=game.bricks[game.bricks.length-1];b.lock=0;
    game.hitBrick(b,game.bricks.length-1);
  }
  assert.equal(game.state,'playing');
  assert.equal(game.sectorPhase,'guardian');
  assert.equal(game.boss.hp,6);
  assert.equal(game.lastSectorBonus,0);
  assert.doesNotThrow(()=>game.drawGuardian());
  assert.doesNotThrow(()=>game.drawGameplayStatus());
  finishGuardian(game);
  assert.ok(game.lastSectorBonus>0);
});

test('0.5: защита Стража блокирует урон, уязвимость принимает ровно один',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const boss=game.boss;
  assert.ok(boss);
  boss.phaseTime=2.7;
  const initial=game.score;
  game.ball.x=boss.x+boss.w/2;game.ball.y=boss.y+boss.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();game.moveBall(.004);
  assert.equal(boss.hp,6);
  assert.equal(game.score,initial);
  boss.phaseTime=0;boss.lock=0;
  game.ball.x=boss.x+boss.w/2;game.ball.y=boss.y+boss.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();game.moveBall(.004);
  assert.equal(boss.hp,5);
  assert.equal(game.damageGuardian(),false,'hit lock prevents double damage');
  assert.equal(boss.hp,5);
  assert.ok(game.score>initial);
});

test('0.5: таймер защитной фазы не движется на паузе, рестарт очищает босса',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  game.update(.3);
  const t=game.boss.phaseTime;
  game.togglePause();game.update(10);
  assert.equal(game.boss.phaseTime,t);
  game.launch();game.update(.2);
  assert.ok(game.boss.phaseTime>t);
  game.startNewGame();
  assert.equal(game.boss,null);
  assert.equal(game.sectorPhase,'bricks');
  assert.equal(game.level,0);
});

test('0.5: импульс не пробивает защищённого Стража',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const b=game.boss;
  game.energy=100;game.pulse();assert.ok(game.timers.pulse>0);
  b.phaseTime=2.8;
  game.ball.x=b.x+b.w/2;game.ball.y=b.y+b.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(b.hp,6);
  assert.ok(game.ball.vy>0,'shield reflects powered ball');
  b.phaseTime=0;b.lock=0;
  game.ball.y=b.y+b.h+game.ball.r+.4;
  game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(b.hp,5);
});

test('0.5.1: кирпичи патрулируют широкие горизонтальные полосы, а не дрожат',()=>{
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();
  const movers=game.bricks.filter(b=>b.type==='moving');
  assert.equal(movers.length,2);
  for(const b of movers) {
    assert.equal(b.path,'horizontal');
    assert.ok(b.maxX-b.minX>=300);
    const start=b.x;
    for(let i=0;i<120;i++)game.updateMovingBricks(1/60);
    assert.ok(Math.abs(b.x-start)>100,'patrol should visibly travel more than 100px');
    assert.ok(b.x>=b.minX&&b.x<=b.maxX);
  }
  assert.notEqual(Math.sign(movers[0].vx),Math.sign(movers[1].vx));
});

test('0.5.1: третий сектор включает горизонтальную и вертикальную траектории',()=>{
  const {game,CFG}=createEnvironment();game.launch();game.level=2;game.startLevel();
  const movers=game.bricks.filter(b=>b.type==='moving');
  assert.equal(movers.length,2);
  const sine=movers.find(b=>b.path==='sine'),vertical=movers.find(b=>b.path==='vertical');
  assert.ok(sine&&vertical);
  const originalY=sine.y,originalX=vertical.x,originalVerticalY=vertical.y;
  let minY=Infinity,maxY=-Infinity,minV=Infinity,maxV=-Infinity;
  for(let i=0;i<280;i++){
    game.updateMovingBricks(1/60);
    minY=Math.min(minY,sine.y);maxY=Math.max(maxY,sine.y);
    minV=Math.min(minV,vertical.y);maxV=Math.max(maxV,vertical.y);
    assert.ok(sine.x>=CFG.left&&sine.x+sine.w<=CFG.right);
    assert.ok(vertical.y+vertical.h<game.paddle.y);
  }
  assert.ok(maxY-minY>15,'sine lane must vary vertically');
  assert.ok(maxV-minV>85,'vertical lane must travel ~90px');
  assert.equal(vertical.x,originalX);
  assert.notEqual(vertical.y,originalVerticalY);
  assert.notEqual(sine.y,originalY);
});

test('0.5.1: движение независимо от частоты кадров и замораживается паузой',()=>{
  function sample(fps) {
    const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
    const b=game.bricks.find(b=>b.type==='moving');
    for(let i=0;i<fps*2;i++)game.updateMovingBricks(1/fps);
    return {x:b.x,vx:b.vx};
  }
  const a=sample(30),b=sample(60),c=sample(120);
  assert.ok(Math.abs(a.x-b.x)<.00001&&Math.abs(b.x-c.x)<.00001);
  assert.equal(a.vx,b.vx);assert.equal(b.vx,c.vx);
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
  const mover=game.bricks.find(b=>b.type==='moving');
  game.update(.016);const x=mover.x;
  game.togglePause();game.update(.5);
  assert.equal(mover.x,x);
});

test('0.5.1: два облика Стража кэшируются, рендер не пересоздаёт градиенты',()=>{
  const {game,gradientCalls}=createEnvironment();
  assert.ok(game.sprites.guardianOpen&&game.sprites.guardianShield);
  assert.equal(game.sprites.guardianOpen.width,224);
  assert.equal(game.sprites.guardianShield.height,136);
  assert.equal(game.spritePaintCount,6);
  game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  game.draw();const paints=game.spritePaintCount;
  const gradients={...gradientCalls};
  for(let n=0;n<100;n++)game.draw();
  game.boss.phaseTime=2.8;
  for(let n=0;n<100;n++)game.draw();
  assert.equal(game.spritePaintCount,paints);
  assert.deepEqual(gradientCalls,gradients,'guardian art must reuse sprites');
});

test('0.5.1: Страж показывает попадание и сохраняет боевые правила',()=>{
  const {game}=createEnvironment();
  game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const b=game.boss;assert.equal(b.hp,6);
  b.phaseTime=0;
  assert.equal(game.guardianVulnerable(),true);
  game.ball.x=b.x+b.w/2;game.ball.y=b.y+b.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(b.hp,5);assert.ok(b.hitFlash>0);
  game.update(.12);assert.ok(b.hitFlash<.22);
  b.phaseTime=2.7;b.lock=0;
  const score=game.score;
  game.ball.x=b.x+b.w/2;game.ball.y=b.y+b.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(b.hp,5);assert.equal(game.score,score);
  assert.doesNotThrow(()=>game.drawGuardian());
});

test('0.5.1: новые маршруты не требуют перерисовывать статический кэш',()=>{
  const {game,gradientCalls}=createEnvironment();
  game.launch();game.level=2;game.startLevel();game.launch();game.draw();
  const first=game.brickPaintCount,gradients={...gradientCalls};
  for(let n=0;n<180;n++){game.updateMovingBricks(1/60);game.draw();}
  assert.equal(game.brickPaintCount,first);
  assert.deepEqual(gradientCalls,gradients);
  assert.equal(game.bricksDirty,false);
});
