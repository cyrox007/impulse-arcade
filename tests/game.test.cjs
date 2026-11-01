'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'game.js'), 'utf8');

function createEnvironment({fpsDebug=false,reducedMotion=false,sharedStorage=null,storageBlocked=false}={}) {
  const handlers = new Map();
  const gradientCalls={linear:0,radial:0};
  let animationFrame=null, clock=0;
  const records = new Map();
  const storage = sharedStorage||new Map();
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
    localStorage: {
      getItem(key) {if(storageBlocked)throw Error('storage denied');return storage.get(key)??null;},
      setItem(key,value) {if(storageBlocked)throw Error('quota exceeded');storage.set(key,value);},
      removeItem(key) {if(storageBlocked)throw Error('storage denied');storage.delete(key);}
    },
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
  assert.equal(game.state,'between');
  assert.equal(game.level,2);
  assert.equal(game.sectorPhase,'finished');
}
function finishReactor(game){
  assert.equal(game.sectorPhase,'reactor','reactor phase after final bricks');
  assert.equal(game.boss?.kind,'reactor');
  let hits=0;
  while(game.boss){
    const boss=game.boss,node=boss.nodes.find(n=>n.hp>0);
    assert.ok(node,'reactor must have a remaining node');
    boss.lock=0;
    game.ball.x=boss.x+node.offset;
    game.ball.y=boss.y+boss.h+game.ball.r+.4;
    game.ball.vx=0;game.ball.vy=-game.levelSpeed();
    game.moveBall(.004);
    if(++hits>9)assert.fail('reactor stuck');
  }
  assert.equal(hits,6);
  assert.equal(game.state,'won');
  assert.equal(game.sectorPhase,'finished');
}

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
  assert.match(html, /src="game\.js\?v=gameplay-090-20261101"/);
  assert.match(html, /href="style\.css\?v=gameplay-090-20261101"/);
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
    if(sector===2)finishGuardian(game);
    if(sector===LEVELS.length-1)finishReactor(game);
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
  assert.equal(elements.get('compactSector').textContent,'01/05');
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

test('0.8: подвижные кирпичи не проходят сквозь другие кирпичи и стены',()=>{
  const {game,CFG}=createEnvironment();game.launch();game.level=1;game.startLevel();
  const movers=game.bricks.filter(x=>x.type==='moving');
  for(let i=0;i<900;i++){
    game.updateMovingBricks(1/60);
    for(const b of movers){
      assert.ok(b.x>=CFG.left+3 && b.x+b.w<=CFG.right-3);
      assert.ok(b.y>=CFG.brickStartY-4 && b.y+b.h<game.paddle.y-100);
      for(const other of game.bricks){
        if(other===b)continue;
        assert.ok(!(b.x<other.x+other.w&&b.x+b.w>other.x &&
          b.y<other.y+other.h&&b.y+b.h>other.y),'no overlaps');
      }
    }
  }
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

test('0.8: свободные патрули меняют направление и могут двигаться по обеим осям',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  const movers=game.bricks.filter(b=>b.type==='moving');
  assert.equal(movers.length,2);
  assert.ok(movers.every(b=>b.path==='roam'));
  const initial=movers.map(b=>[b.x,b.y]);
  const velocities=new Set();
  for(let i=0;i<360;i++){
    game.updateMovingBricks(1/60);
    velocities.add(Math.round(movers[0].vx)+','+Math.round(movers[0].vy));
  }
  assert.ok(velocities.size>2,'must choose new random directions');
  assert.ok(movers.some((b,i)=>Math.abs(b.x-initial[i][0])+Math.abs(b.y-initial[i][1])>8));
});

test('0.8: свободные патрули замораживаются при паузе',()=>{
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
  const movers=game.bricks.filter(b=>b.type==='moving');
  game.update(.016);const frozen=movers.map(b=>[b.x,b.y,b.vx,b.vy]);
  game.togglePause();game.update(5);
  assert.deepEqual(movers.map(b=>[b.x,b.y,b.vx,b.vy]),frozen);
});

test('0.5.1: два облика Стража кэшируются, рендер не пересоздаёт градиенты',()=>{
  const {game,gradientCalls}=createEnvironment();
  assert.ok(game.sprites.guardianOpen&&game.sprites.guardianShield);
  assert.equal(game.sprites.guardianOpen.width,224);
  assert.equal(game.sprites.guardianShield.height,136);
  assert.equal(game.spritePaintCount,7);
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

test('0.6: мультишар создаёт максимум три самостоятельных мяча',()=>{
  const {game}=createEnvironment();game.launch();game.launch();
  assert.equal(game.activeBalls().length,1);
  assert.equal(game.splitBall(),true);
  assert.equal(game.activeBalls().length,3);
  const coords=game.activeBalls().map(b=>[b.x,b.y,b.vx,b.vy]);
  assert.ok(game.extraBalls.every(b=>b!==game.ball&&b.trail.length===0));
  assert.notEqual(coords[1][2],coords[2][2]);
  assert.equal(game.splitBall(),false);
  assert.equal(game.activeBalls().length,3);
  assert.equal(game.runStats.splits,1);
  assert.doesNotThrow(()=>game.drawBall());
});

test('0.6: призма создаёт новые шары, а энергоблок заряжает импульс',()=>{
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
  const prism=game.bricks.find(b=>b.type==='prism');
  assert.ok(prism);
  game.hitBrick(prism,game.bricks.indexOf(prism));
  assert.equal(game.activeBalls().length,3);
  assert.ok(game.waves.length>0);
  game.level=2;game.startLevel();game.launch();
  const charge=game.bricks.find(b=>b.type==='charge');
  assert.ok(charge);
  const energy=game.energy;
  game.hitBrick(charge,game.bricks.indexOf(charge));
  assert.equal(game.energy,energy+42);
  assert.ok(game.score>0);
});

test('0.6: при потере дополнительных мячей жизни не списываются',()=>{
  const {game,CFG}=createEnvironment();game.launch();game.launch();game.splitBall();
  const lives=game.lives,initial=game.ball;
  const extra=game.extraBalls[0];
  extra.y=CFG.bottom+extra.r+2;extra.vy=300;
  game.moveBall(.001,extra,false);
  assert.equal(game.lives,lives);
  assert.equal(game.activeBalls().length,2);
  assert.equal(game.ball,initial);
  // Primary ball is lost, another ball becomes primary and continues playing.
  initial.y=CFG.bottom+initial.r+2;initial.vy=300;
  game.moveBall(.001,initial,false);
  assert.equal(game.lives,lives);
  assert.equal(game.activeBalls().length,1);
  assert.equal(game.state,'playing');
  const last=game.ball;
  last.y=CFG.bottom+last.r+2;last.vy=300;
  game.moveBall(.001,last,false);
  assert.equal(game.lives,lives-1);
  assert.equal(game.state,'ready');
  assert.equal(game.activeBalls().length,1);
});

test('0.6: барьер спасает конкретный мяч и расходуется один раз',()=>{
  const {game,CFG}=createEnvironment();game.launch();game.launch();game.splitBall();
  game.applyDrop('shield');
  const second=game.extraBalls[0];
  second.y=CFG.bottom+second.r+2;second.vy=300;
  game.moveBall(.001,second,false);
  assert.equal(game.shieldCharges,0);
  assert.equal(game.runStats.barriers,1);
  assert.ok(second.vy<0);
  assert.equal(game.activeBalls().length,3);
  assert.equal(game.lives,3);
  second.y=CFG.bottom+second.r+2;second.vy=300;
  game.moveBall(.001,second,false);
  assert.equal(game.activeBalls().length,2);
  assert.equal(game.runStats.barriers,1);
  assert.equal(game.lives,3);
});

test('0.6: магнит удерживает шар и отпускает по кнопке запуска',()=>{
  const {game,CFG,elements}=createEnvironment();game.launch();game.launch();
  game.applyDrop('magnet');assert.equal(game.timers.magnet,12);
  const b=game.ball;
  b.x=game.paddle.x+14;b.y=game.paddle.y-b.r-.2;b.vx=100;b.vy=300;
  game.moveBall(.001);
  assert.equal(b.held,true);
  assert.equal(game.state,'playing');
  assert.equal(elements.get('launchBtn').disabled,false);
  assert.ok(elements.get('launchLabel').textContent.includes('ОТПУСТИТЬ'));
  game.targetX=game.paddle.x+50;game.update(.016);
  assert.ok(b.x>CFG.width/2+14,'held ball follows the paddle');
  game.launch();
  assert.equal(b.held,false);
  assert.ok(b.vy<0&&game.ballSpeed(b)>0);
  assert.equal(game.state,'playing');
});

test('0.6: магнит автоматически отпускает мяч и не блокирует паузу',()=>{
  const {game}=createEnvironment();game.launch();game.launch();
  game.applyDrop('magnet');
  const b=game.ball;
  b.y=game.paddle.y-b.r-.2;b.x=game.paddle.x;
  b.vx=50;b.vy=300;game.moveBall(.001);
  assert.equal(b.held,true);
  game.togglePause();game.update(2);
  assert.equal(b.held,true);
  game.launch();
  for(let i=0;i<40;i++)game.update(.033);
  assert.equal(b.held,false);
  assert.equal(game.state,'playing');
  assert.ok(Number.isFinite(b.vx)&&Number.isFinite(b.vy));
});

test('0.6: замедление и импульс действуют на все активные мячи',()=>{
  const {game,CFG}=createEnvironment();game.launch();game.launch();game.splitBall();
  const old=game.activeBalls().map(b=>game.ballSpeed(b));
  game.applyDrop('slow');
  for(let i=0;i<3;i++)assert.ok(game.ballSpeed(game.activeBalls()[i])<old[i]);
  game.energy=100;game.pulse();
  assert.equal(game.runStats.pulses,1);
  assert.equal(game.energy,0);
  assert.ok(game.activeBalls().every(b=>game.ballSpeed(b)<=CFG.maxSpeed));
  game.update(.02);
  assert.equal(game.activeBalls().length,3);
  game.togglePause();
  const before=game.activeBalls().map(b=>[b.x,b.y]);
  game.update(.3);
  assert.deepEqual(game.activeBalls().map(b=>[b.x,b.y]),before);
});

test('0.6: динамические кирпичи обновляются один раз за подшаг при трёх мячах',()=>{
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
  game.splitBall();
  const brick=game.bricks.find(b=>b.type==='moving');
  const x=brick.x,v=brick.vx;
  game.ball.y=600;
  for(const b of game.extraBalls){b.y=590;b.vy=-100}
  game.update(.012); // two 6ms steps for every ball, one moving-target update per step.
  assert.ok(Math.abs(brick.x-(x+v*.012))<.00001);
});

test('0.6: рестарт и переход сектора очищают шары и магнит',()=>{
  const {game}=createEnvironment();game.launch();game.launch();
  game.splitBall();game.applyDrop('magnet');
  while(game.bricks.length){const b=game.bricks[game.bricks.length-1];b.lock=0;game.hitBrick(b,game.bricks.length-1)}
  assert.equal(game.state,'between');
  game.launch();
  assert.equal(game.level,1);
  assert.equal(game.activeBalls().length,1);
  assert.equal(game.timers.magnet,0);
  game.launch();game.splitBall();
  game.startNewGame();
  assert.equal(game.activeBalls().length,1);
  assert.equal(game.runStats.splits,0);
});

test('0.6: с мультишаром Страж уязвим только при открытом щите и не получает двойного урона',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.splitBall();game.bricks=[];game.checkStageCompletion();
  const boss=game.boss;assert.ok(boss);
  boss.phaseTime=0;
  for(const b of game.activeBalls()){
    b.x=boss.x+boss.w/2;
    b.y=boss.y+boss.h+b.r+.4;b.vx=0;b.vy=-game.levelSpeed();
    game.moveBall(.004,b,false);
  }
  assert.equal(boss.hp,5,'one hit lock shared across all balls');
  boss.phaseTime=2.7;boss.lock=0;
  const b=game.extraBalls[0];
  b.x=boss.x+boss.w/2;b.y=boss.y+boss.h+b.r+.4;b.vx=0;b.vy=-game.levelSpeed();
  game.moveBall(.004,b,false);
  assert.equal(boss.hp,5,'shield blocks extra ball');
});

test('0.6: FPS 30/60/120 не вызывает потери управления при трёх мячах',()=>{
  for(const fps of [30,60,120]){
    const {game,CFG}=createEnvironment();game.launch();game.launch();game.splitBall();
    for(let i=0;i<fps;i++){
      game.update(1/fps);
      for(const b of game.activeBalls()){
        assert.ok(Number.isFinite(b.x)&&Number.isFinite(b.y));
        assert.ok(b.x>=CFG.left-1&&b.x<=CFG.right+1);
      }
      if(game.state==='ready')game.launch();
    }
    assert.ok(game.activeBalls().length>=1&&game.activeBalls().length<=3);
    assert.ok(game.particles.length<=180&&game.waves.length<=24);
  }
});

test('0.7: пять секторов, уникальные схемы и возрастающая сложность',()=>{
  const {game,LEVELS,CFG}=createEnvironment();
  assert.equal(LEVELS.length,5);
  assert.ok(LEVELS.every(l=>l.rows.every(row=>row.length===6)));
  const speed=LEVELS.map((_,i)=>{game.level=i;return game.levelSpeed()});
  assert.ok(speed.every((v,i)=>i===0||v>speed[i-1]));
  assert.ok(speed.every(v=>v<=CFG.maxSpeed));
  assert.equal(LEVELS[3].name,'ПРИЗРАЧНЫЙ КОРИДОР');
  assert.equal(LEVELS[4].name,'СЕРДЦЕ РЕАКТОРА');
  for(let i of [3,4]){
    game.level=i;game.startLevel();
    assert.equal(game.bricks.filter(b=>b.type==='moving').length,2);
    assert.ok(game.bricks.some(b=>b.type==='prism'));
    assert.ok(game.bricks.some(b=>b.type==='charge'));
  }
});

test('0.7: третий босс промежуточный, четвёртый сектор обычный',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  assert.equal(game.boss?.kind,'guardian');
  finishGuardian(game);
  assert.equal(game.state,'between');
  const score=game.score;
  game.launch();assert.equal(game.state,'ready');assert.equal(game.level,3);
  assert.ok(game.score>=score);
  game.launch();assert.equal(game.state,'playing');
  while(game.bricks.length){
    const b=game.bricks[game.bricks.length-1];b.lock=0;
    game.hitBrick(b,game.bricks.length-1);
  }
  assert.equal(game.state,'between');
  assert.equal(game.boss,null);
  game.launch();assert.equal(game.level,4);
});

test('0.7: финальный Реактор появляется после всех блоков пятого сектора',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  const last=game.bricks[game.bricks.length-1];game.bricks=[last];
  game.hitBrick(last,0);
  assert.equal(game.state,'playing');
  assert.equal(game.sectorPhase,'reactor');
  assert.equal(game.boss?.kind,'reactor');
  assert.equal(game.boss.nodes.map(n=>n.hp).join(','),'2,2,2');
  assert.equal(game.lastSectorBonus,0);
});

test('0.7: три независимых узла Реактора, попадания и реальная финальная победа',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const boss=game.boss,node=boss.nodes[0];
  const score=game.score;
  game.ball.x=boss.x+node.offset;
  game.ball.y=boss.y+boss.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(node.hp,1);assert.equal(boss.hp,5);
  assert.ok(game.score>score);
  assert.equal(game.damageReactor(node),false,'shared contact lock');
  boss.lock=0;
  // Broken node is no longer damaging; remaining nodes can still be hit.
  node.hp=0;
  game.ball.x=boss.x+node.offset;
  game.ball.y=boss.y+boss.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(boss.hp,5);
  game.level=4;game.startLevel();game.launch();game.bricks=[];game.checkStageCompletion();
  finishReactor(game);
  assert.ok(game.lastSectorBonus>0);
});

test('0.7: корпус Реактора отражает импульс, если попадание не по узлу',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const boss=game.boss;game.energy=100;game.pulse();
  assert.ok(game.timers.pulse>0);
  const hp=boss.hp;
  game.ball.x=boss.x+65; // 29px from middle, 29px from left node: gap
  game.ball.y=boss.y+boss.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(boss.hp,hp);
  assert.ok(game.ball.vy>0,'armor reflects powered ball off weak-point');
});

test('0.7: Реактор патрулирует, останавливается на паузе, не выходит за границы',()=>{
  const {game,CFG}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  game.shootBoss=()=>{}; // Isolate boss movement from projectile hits.
  const b=game.boss,start=b.x;
  // Park the ball so only boss movement, not life loss, is under test.
  game.ball.x=CFG.width/2;game.ball.y=570;game.ball.vx=0;game.ball.vy=0;
  for(const fps of [30,60,120])for(let i=0;i<fps*2;i++){
    game.update(1/fps);
    assert.ok(b.x>=b.minX-1e-5&&b.x<=b.maxX+1e-5);
    assert.ok(b.x>=CFG.left&&b.x+b.w<=CFG.right);
  }
  assert.notEqual(b.x,start);
  game.togglePause();
  const frozen=[b.x,b.y,b.phaseTime];game.update(.5);
  assert.deepEqual([b.x,b.y,b.phaseTime],frozen);
  game.launch();game.update(.02);
  assert.ok(b.phaseTime>frozen[2]);
});

test('0.7: мультишар наносит не более одного урона узлу за одно перекрытие',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();game.splitBall();
  const boss=game.boss,node=boss.nodes[1],hp=boss.hp;
  for(const ball of game.activeBalls()){
    ball.x=boss.x+node.offset;
    ball.y=boss.y+boss.h+ball.r+.4;
    ball.vx=0;ball.vy=-game.levelSpeed();
    game.moveBall(.004,ball,false);
  }
  assert.equal(boss.hp,hp-1);
  assert.equal(node.hp,1);
  assert.equal(game.activeBalls().length,3);
});

test('0.7: рендер финального босса кэширован и не создаёт градиенты каждый кадр',()=>{
  const {game,gradientCalls}=createEnvironment();
  assert.ok(game.sprites.reactor);
  assert.equal(game.sprites.reactor.width,236);
  assert.equal(game.sprites.reactor.height,124);
  assert.equal(game.spritePaintCount,7);
  game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();game.draw();
  const gradients={...gradientCalls},count=game.spritePaintCount;
  for(let i=0;i<120;i++)game.draw();
  assert.equal(game.spritePaintCount,count);
  assert.deepEqual(gradientCalls,gradients);
  assert.ok(game.particles.length<=180&&game.waves.length<=24);
});

test('0.8: односторонние блоки неуязвимы с закрытой грани и для импульса',()=>{
  const {game}=createEnvironment();game.launch();game.level=1;game.startLevel();game.launch();
  const b=game.bricks.find(b=>b.type==='directional'&&b.face==='U');
  assert.ok(b);
  game.energy=100;game.pulse();assert.ok(game.timers.pulse>0);
  const hp=b.hp,score=game.score,energy=game.energy;
  game.ball.x=b.x+b.w/2;game.ball.y=b.y+b.h+game.ball.r+.4;
  game.ball.vx=0;game.ball.vy=-game.levelSpeed();
  game.moveBall(.004);
  assert.equal(b.hp,hp);assert.equal(game.score,score);assert.equal(game.energy,energy);
  assert.ok(game.ball.vy>0,'protected underside must reflect even during pulse');
  // Correct top entry damages through the same pulse.
  game.ball.x=b.x+b.w/2;game.ball.y=b.y-game.ball.r-.4;
  game.ball.vx=0;game.ball.vy=game.levelSpeed();game.moveBall(.004);
  assert.equal(b.hp,0);
});

test('0.8.1: боковые направленные блоки доступны только с правильной стороны',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  const left=game.bricks.find(b=>b.type==='directional'&&b.face==='L');
  assert.ok(left);
  game.bricks=[left];
  const ball=game.ball;
  ball.x=left.x+left.w+ball.r+.4;ball.y=left.y+left.h/2;ball.vx=-400;ball.vy=0;
  game.moveBall(.004);assert.equal(left.hp,1);assert.ok(ball.vx>0);
  ball.x=left.x-ball.r-.4;ball.y=left.y+left.h/2;ball.vx=400;ball.vy=0;
  game.moveBall(.004);assert.equal(left.hp,0);
  // The right-facing brick is placed in the interior (sector 4), not next to the right wall.
  game.level=3;game.startLevel();game.launch();
  const right=game.bricks.find(b=>b.type==='directional'&&b.face==='R');
  assert.ok(right);game.bricks=[right];
  const rightBall=game.ball;
  rightBall.x=right.x+right.w+rightBall.r+.4;rightBall.y=right.y+right.h/2;
  rightBall.vx=-400;rightBall.vy=0;
  game.moveBall(.004);assert.equal(right.hp,0);
});

test('0.8: Страж перемещается вбок и стреляет в платформу',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const boss=game.boss,start=boss.x;
  game.ball.vx=0;game.ball.vy=0;game.ball.y=580;
  game.update(.5);
  assert.notEqual(boss.x,start);
  boss.shotClock=3.49;game.update(.03);
  assert.equal(game.enemyShots.length,1);
  const shot=game.enemyShots[0];
  assert.ok(shot.y>boss.y+boss.h);
  assert.ok(shot.vy>0);
  const initialLives=game.lives;
  shot.x=game.paddle.x;shot.y=game.paddle.y-shot.r-1;shot.vx=0;shot.vy=205;
  game.updateEnemyShots(.03);
  assert.equal(game.lives,initialLives-1);
  assert.equal(game.state,'ready');
  assert.equal(game.enemyShots.length,0);
});

test('0.8: барьер поглощает выстрел без потери жизни',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();game.applyDrop('shield');
  const boss=game.boss;
  game.shootBoss(boss);
  assert.equal(game.enemyShots.length,1);
  const shot=game.enemyShots[0];shot.x=game.paddle.x;shot.y=game.paddle.y-shot.r-1;shot.vx=0;
  const lives=game.lives;game.updateEnemyShots(.03);
  assert.equal(game.shieldCharges,0);assert.equal(game.runStats.barriers,1);
  assert.equal(game.lives,lives);
  assert.equal(game.enemyShots.length,0);
});

test('0.8: защищённый угол босса отражает пробивной импульс',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();const boss=game.boss;
  game.energy=100;game.pulse();boss.phaseTime=0;
  // Hit the open guardian from ABOVE: phase is open but its armor is not.
  const ball=game.ball;ball.x=boss.x+boss.w/2;ball.y=boss.y-ball.r-.4;
  ball.vx=0;ball.vy=game.levelSpeed();game.moveBall(.004);
  assert.equal(boss.hp,6);
  assert.ok(ball.vy<0);
  ball.x=boss.x+boss.w/2;ball.y=boss.y+boss.h+ball.r+.4;
  ball.vx=0;ball.vy=-game.levelSpeed();game.moveBall(.004);
  assert.equal(boss.hp,5);
});

test('0.8: Реактор уязвим только по узлу снизу',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const boss=game.boss,node=boss.nodes[0],ball=game.ball;
  game.energy=100;game.pulse();
  ball.x=boss.x+node.offset;ball.y=boss.y-ball.r-.4;
  ball.vx=0;ball.vy=game.levelSpeed();game.moveBall(.004);
  assert.equal(boss.hp,6);assert.ok(ball.vy<0);
  ball.x=boss.x+node.offset;ball.y=boss.y+boss.h+ball.r+.4;
  ball.vx=0;ball.vy=-game.levelSpeed();game.moveBall(.004);
  assert.equal(boss.hp,5);
});

test('0.8: пауза и завершение босса останавливают выстрелы',()=>{
  const {game}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  game.shootBoss(game.boss);const shots=game.enemyShots.map(s=>[s.x,s.y]);
  game.togglePause();game.update(.8);
  assert.deepEqual(game.enemyShots.map(s=>[s.x,s.y]),shots);
  game.launch();
  const boss=game.boss;
  for(const node of boss.nodes){while(node.hp>0){boss.lock=0;game.damageReactor(node)}}
  assert.equal(game.state,'won');
  assert.equal(game.enemyShots.length,0);
});

test('0.8: максимум четыре вражеских выстрела, отсутствие покадровых градиентов',()=>{
  const {game,gradientCalls}=createEnvironment();game.launch();game.level=4;game.startLevel();game.launch();
  game.bricks=[];game.checkStageCompletion();
  for(let i=0;i<15;i++)game.shootBoss(game.boss);
  assert.equal(game.enemyShots.length,4);
  game.draw();const baseline={...gradientCalls},paint=game.spritePaintCount;
  for(let i=0;i<100;i++)game.draw();
  assert.deepEqual(gradientCalls,baseline);
  assert.equal(game.spritePaintCount,paint);
  assert.ok(game.particles.length<=180&&game.waves.length<=24);
});

test('0.8.1: крайние стрелки никогда не направлены в непроходимую стену',()=>{
  const {game,CFG,LEVELS}=createEnvironment();game.launch();
  const requireSpace=CFG.ballRadius*2+2;
  for(let sector=0;sector<LEVELS.length;sector++){
    game.level=sector;game.startLevel();
    for(const brick of game.bricks.filter(b=>b.type==='directional')){
      assert.ok(game.directionalClearance(brick)>=requireSpace,
        'sector '+(sector+1)+' row '+brick.row+' col '+brick.col+' face '+brick.face);
    }
  }
  game.level=2;game.startLevel();
  const rightmost=game.bricks.find(b=>b.type==='directional'&&b.col===5);
  assert.ok(rightmost,'replicate screenshot rightmost brick');
  assert.equal(rightmost.face,'D','right edge must expose its underside');
  assert.ok(CFG.right-(rightmost.x+rightmost.w)<requireSpace);
  game.level=4;game.startLevel();
  const edges=game.bricks.filter(b=>b.type==='directional'&&(b.col===0||b.col===5));
  assert.equal(edges.length,2);
  assert.ok(edges.every(b=>b.face==='D'));
});

test('0.8.1: геометрический предохранитель автоматически разворачивает невозможную грань',()=>{
  const {game,CFG}=createEnvironment();game.launch();
  const b={type:'directional',x:CFG.right-64-12,y:210,w:64,h:25,face:'R',row:4,col:5};
  game.ensureDirectionalClearance(b);
  assert.equal(b.face,'D');
  const left={...b,x:CFG.left+12,face:'L',col:0};
  game.ensureDirectionalClearance(left);
  assert.equal(left.face,'D');
  const valid={...b,x:240,face:'R',col:3};
  game.ensureDirectionalClearance(valid);
  assert.equal(valid.face,'R');
});

test('0.8.1: реальные удары уничтожают все направленные блоки во всех пяти секторах',()=>{
  const {game,CFG,LEVELS}=createEnvironment();game.launch();
  let checked=0;
  for(let level=0;level<LEVELS.length;level++){
    game.level=level;game.startLevel();
    const coords=game.bricks.filter(b=>b.type==='directional').map(b=>({row:b.row,col:b.col}));
    for(const {row,col} of coords){
      game.level=level;game.startLevel();game.launch();
      const b=game.bricks.find(brick=>brick.type==='directional'&&brick.row===row&&brick.col===col);
      assert.ok(b);
      game.bricks=[b];const ball=game.ball,r=ball.r,face=b.face;
      assert.ok(game.directionalClearance(b)>=2*r+2);
      const speed=game.levelSpeed(),offset=.45;
      if(face==='D'){ball.x=b.x+b.w/2;ball.y=b.y+b.h+r+offset;ball.vx=0;ball.vy=-speed;}
      if(face==='U'){ball.x=b.x+b.w/2;ball.y=b.y-r-offset;ball.vx=0;ball.vy=speed;}
      if(face==='L'){ball.x=b.x-r-offset;ball.y=b.y+b.h/2;ball.vx=speed;ball.vy=0;}
      if(face==='R'){ball.x=b.x+b.w+r+offset;ball.y=b.y+b.h/2;ball.vx=-speed;ball.vy=0;}
      assert.ok(ball.x>=CFG.left+r&&ball.x<=CFG.right-r,'ball fits horizontally');
      assert.ok(ball.y>=CFG.top+r,'ball fits vertically');
      game.moveBall(.004);
      assert.equal(b.hp,0,'sector '+level+' brick '+row+','+col+' should die from '+face);
      assert.ok(!game.bricks.includes(b));
      checked++;
    }
  }
  assert.ok(checked>=6,'cover all directional variants across the campaign');
});

test('0.8.1: скриншот 03/05 — нижний удар по крайнему правому блоку завершает стадию',()=>{
  const {game}=createEnvironment();game.launch();game.level=2;game.startLevel();game.launch();
  const right=game.bricks.find(b=>b.type==='directional'&&b.col===5);
  const armor=game.bricks.find(b=>b.type==='armor'&&b.col===5);
  assert.ok(right&&armor);assert.equal(right.face,'D');
  // The remaining group reproduces the screenshot; ordinary brick can be
  // destroyed first. The directional one must not lock the sector.
  game.bricks=[armor,right];armor.lock=0;
  while(armor.hp>0){game.hitBrick(armor,0);armor.lock=0;}
  assert.equal(game.bricks.length,1);
  const ball=game.ball;
  ball.x=right.x+right.w/2;ball.y=right.y+right.h+ball.r+.4;
  ball.vx=0;ball.vy=-game.levelSpeed();game.moveBall(.004);
  assert.equal(right.hp,0);
  assert.equal(game.bricks.length,0);
  assert.equal(game.sectorPhase,'guardian');
  assert.equal(game.boss?.kind,'guardian');
});

test('0.9.0: контрольная точка сохраняется только после очистки сектора',()=>{
  const {game,CFG,storage}=createEnvironment();
  game.launch();game.launch();
  assert.equal(storage.has(CFG.checkpointKey),false);
  game.score=1245;game.energy=66;game.runStats.hits=12;game.runStats.seconds=43.5;
  game.update(.016);
  assert.equal(storage.has(CFG.checkpointKey),false,'mid-sector must never overwrite checkpoint');
  game.bricks=[];game.checkStageCompletion();
  assert.equal(game.state,'between');
  assert.equal(game.checkpoint.sector,1);
  const saved=JSON.parse(storage.get(CFG.checkpointKey));
  assert.equal(saved.version,1);assert.equal(saved.sector,1);
  assert.equal(saved.score,game.score);assert.equal(saved.lives,game.lives);
  assert.equal(saved.energy,66);assert.equal(saved.stats.hits,12);
  assert.ok(saved.stats.seconds>=43.5);
  assert.equal(game.state,'between');
  assert.equal(game.activeBalls().length,1);
});

test('0.9.0: новая сессия восстанавливает сектор, жизни, очки, энергию и статистику',()=>{
  const sharedStorage=new Map();
  const first=createEnvironment({sharedStorage});const g=first.game;
  g.launch();g.launch();g.score=7350;g.lives=2;g.energy=81;
  g.runStats.hits=32;g.runStats.splits=2;g.runStats.seconds=129;
  g.bricks=[];g.checkStageCompletion();
  assert.equal(g.checkpoint.sector,1);
  const expectedScore=g.score;
  const next=createEnvironment({sharedStorage});const restored=next.game;
  assert.equal(restored.state,'menu');
  assert.equal(restored.checkpoint.sector,1);
  assert.ok(next.elements.get('overlay').innerHTML.includes('ПРОДОЛЖИТЬ'));
  assert.ok(next.elements.get('overlay').innerHTML.includes('newGameAction'));
  restored.launch();
  assert.equal(restored.state,'ready');
  assert.equal(restored.level,1);
  assert.equal(restored.score,expectedScore);
  assert.equal(restored.lives,2);
  assert.equal(restored.energy,81);
  assert.equal(restored.runStats.hits,32);
  assert.equal(restored.runStats.splits,2);
  assert.equal(restored.runStats.seconds,129);
  assert.equal(restored.shieldCharges,0);
  assert.equal(restored.timers.pulse,0);
  assert.equal(restored.timers.magnet,0);
  assert.equal(restored.extraBalls.length,0);
  assert.equal(restored.boss,null);
  assert.ok(restored.bricks.length>0);
  assert.equal(next.storage.has(next.CFG.checkpointKey),true);
});

test('0.9.0: сохранение фиксирует следующий сектор после победы над Стражем',()=>{
  const {game,storage,CFG}=createEnvironment();game.launch();
  game.level=2;game.startLevel();game.launch();game.lives=1;game.energy=92;
  game.bricks=[];game.checkStageCompletion();
  finishGuardian(game);
  assert.equal(game.checkpoint.sector,3);
  assert.equal(JSON.parse(storage.get(CFG.checkpointKey)).sector,3);
  game.launch();
  assert.equal(game.level,3);assert.equal(game.lives,1);assert.equal(game.energy,100);
});

test('0.9.0: сохранение не обновляется от ударов, паузы и потери жизни',()=>{
  const {game,storage,CFG}=createEnvironment();game.launch();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const saved=storage.get(CFG.checkpointKey);
  game.launch();game.launch();
  game.score+=500;game.energy=11;game.applyDrop('multi');
  game.togglePause();game.update(3);game.launch();
  game.dropBall();
  assert.equal(storage.get(CFG.checkpointKey),saved);
});

test('0.9.0: новая игра удаляет сохранение, но сохраняет личный рекорд',()=>{
  const sharedStorage=new Map();const first=createEnvironment({sharedStorage});const g=first.game;
  g.launch();g.launch();g.score=5000;g.bricks=[];g.checkStageCompletion();
  assert.ok(sharedStorage.has(first.CFG.checkpointKey));
  const next=createEnvironment({sharedStorage});
  next.game.startNewGame();
  assert.equal(next.game.level,0);assert.equal(next.game.state,'ready');
  assert.equal(next.game.score,0);assert.equal(next.game.lives,3);
  assert.equal(sharedStorage.has(first.CFG.checkpointKey),false);
  assert.equal(next.game.best,5000);
  const reload=createEnvironment({sharedStorage});
  assert.equal(reload.game.checkpoint,null);
  assert.ok(!reload.elements.get('overlay').innerHTML.includes('newGameAction'));
});

test('0.9.0: проигрыш позволяет вернуться к последней контрольной точке',()=>{
  const {game,storage,CFG}=createEnvironment();game.launch();game.launch();
  game.bricks=[];game.checkStageCompletion();
  const checkpoint=JSON.parse(storage.get(CFG.checkpointKey));
  game.launch();game.launch();game.lives=1;game.dropBall();
  assert.equal(game.state,'lost');
  assert.ok(game.overlayContent('lost').includes('ПРОДОЛЖИТЬ'));
  game.launch();
  assert.equal(game.state,'ready');
  assert.equal(game.level,checkpoint.sector);
  assert.equal(game.lives,checkpoint.lives);
  assert.equal(game.score,checkpoint.score);
});

test('0.9.0: полная победа удаляет контрольную точку и не позволяет продолжить',()=>{
  const {game,storage,CFG}=createEnvironment();game.launch();game.launch();
  game.bricks=[];game.checkStageCompletion();
  assert.ok(storage.has(CFG.checkpointKey));
  game.level=4;game.startLevel();game.launch();game.end('won');
  assert.equal(game.checkpoint,null);
  assert.equal(storage.has(CFG.checkpointKey),false);
  const next=createEnvironment({sharedStorage:storage});
  assert.ok(!next.elements.get('overlay').innerHTML.includes('newGameAction'));
});

test('0.9.0: повреждённые и несовместимые сохранения не ломают старт',()=>{
  const storage=new Map();
  for(const payload of [
    '{not json',JSON.stringify({version:2,sector:1}),
    JSON.stringify({version:1,sector:99,score:12,lives:2,energy:5,stats:{}}),
    JSON.stringify({version:1,sector:1,score:-4,lives:2,energy:5,stats:{}}),
    JSON.stringify({version:1,sector:1,score:12,lives:0,energy:5,stats:{}}),
    'x'.repeat(4100)
  ]){
    storage.set('impulse-arcade:checkpoint:v1',payload);
    const {game}=createEnvironment({sharedStorage:storage});
    assert.equal(game.state,'menu');
    assert.equal(game.checkpoint,null);
    assert.doesNotThrow(()=>game.launch());
    assert.equal(game.state,'ready');
  }
});

test('0.9.0: если localStorage недоступен, игра всё равно запускается',()=>{
  const {game}=createEnvironment({storageBlocked:true});
  assert.equal(game.state,'menu');
  assert.equal(game.checkpoint,null);
  game.launch();game.launch();game.bricks=[];game.checkStageCompletion();
  assert.equal(game.state,'between');
  assert.equal(game.checkpoint,null,'save failure must not appear successful');
  game.launch();
  assert.equal(game.state,'ready');
});

test('0.9.0: контрольная точка не пересчитывает бонус за пройденный сектор',()=>{
  const storage=new Map();const original=createEnvironment({sharedStorage:storage});
  const g=original.game;g.launch();g.launch();g.score=3000;g.bricks=[];g.checkStageCompletion();
  const saved=g.score;
  const next=createEnvironment({sharedStorage:storage});next.game.launch();
  assert.equal(next.game.score,saved);
  next.game.launch();
  assert.equal(next.game.score,saved);
  next.game.bricks=[];next.game.checkStageCompletion();
  assert.equal(next.game.state,'between');
  assert.equal(next.game.checkpoint.sector,2);
  assert.ok(next.game.score>saved);
});
