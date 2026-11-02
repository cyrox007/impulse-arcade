'use strict';
// Каждая группа тестов использует одну и ту же изолированную игровую среду.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {root, createEnvironment, finishGuardian, finishReactor} = require('./support/game-harness.cjs');

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

