'use strict';
// Каждая группа тестов использует одну и ту же изолированную игровую среду.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {root, createEnvironment, finishGuardian, finishReactor} = require('./support/game-harness.cjs');

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


test('разделённые подсистемы боссов и бонусов используют единый экземпляр Game', () => {
  const {game} = createEnvironment();
  const bosses = readFileSync(path.join(root,'game-bosses.js'),'utf8');
  const effects = readFileSync(path.join(root,'game-effects.js'),'utf8');
  const model = readFileSync(path.join(root,'game.js'),'utf8');

  assert.match(bosses,/const IMPULSE_BOSS_METHODS =/);
  assert.match(effects,/const IMPULSE_EFFECT_METHODS =/);
  assert.doesNotMatch(model,/^  updateBoss\(/m);
  assert.doesNotMatch(model,/^  updateEffectTimers\(/m);
  assert.doesNotMatch(model,/^  beginReactor\(/m);
  assert.match(model,/Object\.assign\(\s*Game\.prototype,\s*IMPULSE_BOSS_METHODS\)/);
  assert.match(model,/Object\.assign\(\s*Game\.prototype,\s*IMPULSE_EFFECT_METHODS\)/);

  game.launch();
  game.launch();
  game.level=2;
  game.beginGuardian();
  assert.ok(game.boss);
  const startPhase=game.boss.phaseTime;
  game.togglePause();
  game.updateBoss(.2);
  assert.equal(game.boss.phaseTime,startPhase);
  game.launch();
  game.updateBoss(.2);
  assert.ok(game.boss.phaseTime>startPhase);

  game.applyDrop('wide');
  const enlarged=game.paddle.w;
  assert.ok(enlarged>96);
  game.updateEffectTimers(12.1);
  assert.equal(game.timers.wide,0);
  assert.equal(game.paddle.w,96);
});
