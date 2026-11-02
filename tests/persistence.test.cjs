'use strict';
// Каждая группа тестов использует одну и ту же изолированную игровую среду.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {root, createEnvironment, finishGuardian, finishReactor} = require('./support/game-harness.cjs');

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
  assert.equal(next.game.best,5300,'sector bonus is included in personal best');
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

test('1.0 RC: настройки записываются и восстанавливаются независимо от чекпоинта',()=>{
  const sharedStorage=new Map();
  const a=createEnvironment({sharedStorage});const g=a.game;
  assert.equal(g.settings.sound,false);assert.equal(g.settings.volume,60);
  assert.equal(g.settings.sensitivity,100);assert.equal(g.settings.effects,'auto');
  assert.equal(g.setSetting('sound',true),true);
  assert.equal(g.setSetting('volume',30),true);
  assert.equal(g.setSetting('effects','reduced'),true);
  assert.equal(g.setSetting('sensitivity',120),true);
  assert.equal(g.reducedMotion,true);
  assert.equal(a.elements.get('volumeValue').textContent,'30%');
  assert.equal(a.elements.get('sensitivityValue').textContent,'120%');
  assert.ok(sharedStorage.has(a.CFG.settingsKey));
  assert.equal(sharedStorage.has(a.CFG.checkpointKey),false);
  const b=createEnvironment({sharedStorage});
  assert.equal(b.game.settings.sound,true);
  assert.equal(b.game.settings.volume,30);
  assert.equal(b.game.settings.effects,'reduced');
  assert.equal(b.game.settings.sensitivity,120);
  b.game.startNewGame();
  assert.equal(sharedStorage.has(a.CFG.settingsKey),true,'new game must preserve settings');
});

test('1.0 RC: открытие настроек замораживает текущую игру и клавиши',()=>{
  const {game,handlers,elements}=createEnvironment();
  game.launch();game.launch();
  game.ball.x=260;game.ball.y=570;
  game.toggleSettings(true);
  assert.equal(game.state,'paused');
  assert.equal(game.settingsOpen,true);
  assert.equal(elements.get('settingsPanel').hidden,false);
  const before=[game.ball.x,game.ball.y],ticks=game.time;
  game.update(.2);
  assert.deepEqual([game.ball.x,game.ball.y],before);
  assert.equal(game.time,ticks);
  game.launch();game.togglePause();
  assert.equal(game.state,'paused','launch/pause cannot resume while panel open');
  let prevented=false;
  handlers.get('window:keydown')({code:'Escape',repeat:false,preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.equal(game.settingsOpen,false);
  assert.equal(elements.get('settingsPanel').hidden,true);
  assert.equal(game.state,'paused','closing settings does not silently resume');
  game.launch();assert.equal(game.state,'playing');
});

test('1.0 RC: громкость и чувствительность строго проверяются',()=>{
  const {game,CFG}=createEnvironment();
  for(const [key,value] of [['volume',-10],['volume',101],['volume','abc'],
    ['sensitivity',10],['sensitivity',200],['sensitivity',90.1],
    ['effects','ultra'],['sound','true']]){
      assert.equal(game.setSetting(key,value),false,String(key)+' '+String(value));
  }
  assert.equal(game.settings.volume,60);assert.equal(game.settings.sensitivity,100);
  game.launch();game.launch();game.setSetting('sensitivity',130);
  game.targetX=game.paddle.x;game.keys.ArrowRight=true;
  game.update(.01);const fast=game.targetX-game.paddle.x;
  game.keys.ArrowRight=false;game.setSetting('sensitivity',70);
  game.targetX=game.paddle.x;game.keys.ArrowRight=true;
  game.update(.01);const slow=game.targetX-game.paddle.x;
  assert.ok(fast>slow,'keyboard sensitivity must affect paddle movement');
});

test('1.0 RC: настройки уважают reduced-motion устройства, но позволяют его переопределить',()=>{
  const {game}=createEnvironment({reducedMotion:true});
  assert.equal(game.reducedMotion,true);
  game.setSetting('effects','full');assert.equal(game.reducedMotion,false);
  game.addWave(230,140,'#ffffff',30,.2);
  assert.ok(game.waves.length>0);
  game.addParticles(230,140,160,'#ffffff');
  game.setSetting('effects','reduced');
  assert.equal(game.reducedMotion,true);assert.equal(game.waves.length,0);
  assert.ok(game.particles.length<=60);
  game.setSetting('effects','auto');assert.equal(game.reducedMotion,true);
});

test('1.0 RC: повреждённые prefs и запрещённое хранилище не ломают управление',()=>{
  const storage=new Map();
  for(const raw of ['{bad json',JSON.stringify({version:12,volume:999}),
    JSON.stringify({version:1,sound:true,volume:150,effects:'full',sensitivity:100}),
    'x'.repeat(1100)]){
    storage.set('impulse-arcade:settings:v1',raw);
    const {game}=createEnvironment({sharedStorage:storage});
    assert.equal(game.settings.volume,60);assert.equal(game.settings.sound,false);
  }
  const {game}=createEnvironment({storageBlocked:true});
  assert.doesNotThrow(()=>game.setSetting('effects','reduced'));
  assert.doesNotThrow(()=>game.setSetting('volume',20));
  assert.doesNotThrow(()=>game.toggleSettings(true));
  game.toggleSettings(false);game.launch();
  assert.equal(game.state,'ready');
});

test('1.0 RC: после всех обычных блоков направленные мишени в секторах имеют выход',()=>{
  const {game,CFG,LEVELS}=createEnvironment();game.launch();
  for(let sector=0;sector<LEVELS.length;sector++){
    game.level=sector;game.startLevel();
    let alive=game.bricks.filter(b=>b.type==='directional');
    let removed=0;
    for(let pass=0;pass<12&&alive.length;pass++){
      const reachable=b=>{
        const r=CFG.ballRadius;
        return !alive.some(other=>{
          if(other===b)return false;
          const horizontal=(other.x<b.x+b.w+r&&other.x+other.w>b.x-r);
          const vertical=(other.y<b.y+b.h+r&&other.y+other.h>b.y-r);
          if(b.face==='D')return horizontal&&other.y>=b.y+b.h&&other.y<b.y+b.h+180;
          if(b.face==='U')return horizontal&&other.y+other.h<=b.y&&other.y+other.h>b.y-180;
          if(b.face==='L')return vertical&&other.x+other.w<=b.x&&other.x+other.w>b.x-200;
          return vertical&&other.x>=b.x+b.w&&other.x<b.x+b.w+200;
        });
      };
      const next=alive.filter(b=>!reachable(b));
      removed+=alive.length-next.length;alive=next;
    }
    assert.equal(alive.length,0,'sector '+(sector+1)+' must have no directional dependency trap');
  }
});

test('1.0 RC: стресс трёх шаров, снарядов и случайных патрулей не нарушает бюджет',()=>{
  for(const level of [1,2,3,4]){
    const {game,CFG}=createEnvironment();
    game.launch();game.level=level;game.startLevel();game.launch();game.splitBall();
    game.applyDrop('magnet');game.applyDrop('wide');
    game.energy=100;game.pulse();
    for(let tick=0;tick<900;tick++){
      const f= tick%3===0?30:tick%3===1?60:120;
      const dt=1/f;
      if(game.state==='ready')game.launch();
      if(game.state==='between'||game.state==='won'||game.state==='lost')break;
      if(tick%80===0&&game.state==='playing')game.addParticles(240,200,85,'#def0ff');
      if(tick%65===0&&game.boss)game.shootBoss(game.boss);
      game.update(dt);
      game.draw();
      assert.ok(game.activeBalls().length>=1&&game.activeBalls().length<=3);
      assert.ok(game.particles.length<=180&&game.waves.length<=24);
      assert.ok(game.enemyShots.length<=4);
      assert.ok(Number.isFinite(game.score)&&game.score>=0);
      for(const ball of game.activeBalls()){
        assert.ok(Number.isFinite(ball.x)&&Number.isFinite(ball.y));
        assert.ok(Number.isFinite(ball.vx)&&Number.isFinite(ball.vy));
      }
    }
  }
});

test('1.0 RC: настройки и checkpoint сосуществуют при перезагрузке',()=>{
  const sharedStorage=new Map();
  const {game,CFG}=createEnvironment({sharedStorage});
  game.launch();game.launch();game.setSetting('sound',true);
  game.setSetting('effects','reduced');game.setSetting('sensitivity',110);
  game.bricks=[];game.checkStageCompletion();
  assert.ok(sharedStorage.has(CFG.checkpointKey));
  const next=createEnvironment({sharedStorage});
  assert.ok(next.game.checkpoint);
  assert.equal(next.game.settings.sound,true);
  assert.equal(next.game.settings.effects,'reduced');
  assert.equal(next.game.settings.sensitivity,110);
  next.game.launch();
  assert.equal(next.game.level,1);
});

test('1.0 RC: взрыв во время пробивного импульса не обращается к удалённым кирпичам',()=>{
  const {game}=createEnvironment();
  game.launch();game.level=1;game.startLevel();game.launch();
  const blast=game.bricks.find(b=>b.type==='blast');
  const left=game.bricks.find(b=>b.row===blast.row&&b.col===blast.col-1);
  const right=game.bricks.find(b=>b.row===blast.row&&b.col===blast.col+1);
  const remote=game.bricks.find(b=>b.row===0&&b.col===0);
  assert.ok(blast&&left&&right&&remote);
  // Deliberately arrange indexes so that three bricks disappear at once.
  game.bricks=[remote,left,right,blast];
  game.energy=100;game.pulse();
  const ball=game.ball;
  ball.x=blast.x+blast.w/2;ball.y=blast.y+blast.h+ball.r+.3;
  ball.vx=0;ball.vy=-game.levelSpeed();
  assert.doesNotThrow(()=>game.moveBall(.004),'a deleted neighbour must be skipped');
  // The right neighbour is armored and keeps one HP; the left is destroyed.
  assert.equal(game.bricks.length,2);
  assert.ok(game.bricks.includes(remote));
  assert.ok(game.bricks.includes(right));
  assert.equal(right.hp,1);
  assert.equal(game.state,'playing');
  assert.ok(Number.isFinite(ball.x)&&Number.isFinite(ball.y));
});

test('1.0 RC: мультишар переживает многократные взрывы и сохраняет лимиты',()=>{
  const {game}=createEnvironment();game.launch();game.level=3;game.startLevel();game.launch();
  game.splitBall();game.energy=100;game.pulse();
  for(let pass=0;pass<5;pass++){
    const blasts=game.bricks.filter(b=>b.type==='blast');
    if(!blasts.length)break;
    const brick=blasts[0];
    for(const b of game.activeBalls()){
      if(!game.bricks.includes(brick)||game.state!=='playing')break;
      b.x=brick.x+brick.w/2;b.y=brick.y+brick.h+b.r+.3;
      b.vx=0;b.vy=-game.levelSpeed();
      assert.doesNotThrow(()=>game.moveBall(.004,b,false));
    }
    assert.ok(game.particles.length<=180&&game.waves.length<=24);
    assert.ok(game.activeBalls().length<=3);
  }
});


test('ползунки настроек сохраняют клавиатурное управление стрелками', () => {
  const {game,handlers} = createEnvironment();
  const keydown = handlers.get('window:keydown');
  let cancelled = 0;
  const event = code => ({
    code,
    repeat: false,
    preventDefault() {cancelled++;}
  });

  game.toggleSettings(true);
  keydown(event('ArrowRight'));
  keydown(event('Space'));
  assert.equal(cancelled, 0, 'стрелки и пробел нужны элементам настроек');
  assert.equal(game.keys.ArrowRight, undefined);
  assert.equal(game.state, 'menu');

  keydown(event('Escape'));
  assert.equal(game.settingsOpen, false);
  assert.equal(cancelled, 1, 'Escape закрывает настройки');

  keydown(event('ArrowRight'));
  assert.equal(cancelled, 2, 'во время управления игрой стрелка перехватывается');
  assert.equal(game.keys.ArrowRight, true);
});

test('рефакторинг игрового цикла сохраняет остановку босса на паузе', () => {
  const {game} = createEnvironment();
  game.launch();
  game.launch();
  game.level = 2;
  game.beginGuardian();
  assert.ok(game.boss);

  const before = [game.boss.x, game.boss.y, game.boss.phaseTime];
  game.togglePause();
  game.update(0.03);
  assert.deepEqual([game.boss.x, game.boss.y, game.boss.phaseTime], before);

  game.launch();
  game.update(0.03);
  assert.ok(game.boss.phaseTime > before[2]);
});

test('таймер расширения платформы восстанавливает исходный размер', () => {
  const {game,CFG} = createEnvironment();
  game.launch();
  game.launch();
  game.applyDrop('wide');
  assert.ok(game.paddle.w > CFG.paddleW);
  game.updateEffectTimers(CFG.wideDuration);
  assert.equal(game.paddle.w, CFG.paddleW);
  assert.equal(game.timers.wide, 0);
});

test('сохранения и интерфейс вынесены без дублирования состояния и схемы', () => {
  const {game,storage,elements} = createEnvironment();
  const persistence = readFileSync(path.join(root,'game-storage.js'),'utf8');
  const interfaceCode = readFileSync(path.join(root,'game-ui.js'),'utf8');
  const model = readFileSync(path.join(root,'game.js'),'utf8');
  assert.match(persistence, /const IMPULSE_PERSISTENCE_METHODS =/);
  assert.match(interfaceCode, /const IMPULSE_UI_METHODS =/);
  assert.doesNotMatch(model, /^  continueGame\(/m);
  assert.doesNotMatch(model, /^  updateUI\(/m);
  assert.match(model, /Object\.assign\(Game\.prototype,IMPULSE_PERSISTENCE_METHODS\)/);
  assert.match(model, /Object\.assign\(Game\.prototype,IMPULSE_UI_METHODS\)/);

  // Данные остаются прежней версии: прогресс, рекорд и настройки не теряются.
  game.launch();
  game.launch();
  game.score=2900;
  game.lives=2;
  game.runStats.hits=12;
  game.bricks=[];
  game.checkStageCompletion();
  assert.equal(game.state,'between');
  const saved=JSON.parse(storage.get('impulse-arcade:checkpoint:v1'));
  assert.equal(saved.version,1);
  assert.equal(saved.stats.hits,12);
  assert.equal(saved.score,2900+200*2);

  game.setSetting('sensitivity',120);
  assert.equal(elements.get('sensitivityValue').textContent,'120%');
  assert.equal(JSON.parse(storage.get('impulse-arcade:settings:v1')).version,1);
});
