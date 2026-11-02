/*
 * ИМПУЛЬС — оригинальный браузерный арканоид.
 * Чистый JavaScript и Canvas 2D, без сторонних зависимостей.
 * Введённые параметры собраны здесь для будущего баланса и переноса на TypeScript.
 */
'use strict';

const CFG = Object.freeze({
  width: 480, height: 720, left: 18, right: 462, top: 38, bottom: 708,
  paddleY: 658, paddleW: 96, paddleH: 13, paddleSpeed: 590,
  ballRadius: 8, initialSpeed: 315, maxSpeed: 525,
  brickW: 64, brickH: 25, brickGapX: 7, brickGapY: 9,
  brickStartX: 30, brickStartY: 110,
  pulseDuration: 5.4, wideDuration: 12, slowDuration: 7, comboWindow: 6,
  storageKey: 'impulse-arcade:best:v1', checkpointKey:'impulse-arcade:checkpoint:v1', settingsKey:'impulse-arcade:settings:v1'
});

const LEVELS = [
  {name:'ПЕРВЫЙ КОНТАКТ', speedScale:1, dropChance:.17, rows:['111111','111111','11CC11','1....1','..11..']},
  {name:'НЕОНОВЫЙ ДОЖДЬ',speedScale:1.06,dropChance:.18,rows:['212212','121X21','1PCC11','121121','U1111D','..22..','..M.M.']},
  {name:'ЯДРО СТАНЦИИ', speedScale:1.12, dropChance:.19, rows:['222222','2C1XC2','21E112','22CC22','12L12D','1X..P1','1.M.M1']},
  {name:'ПРИЗРАЧНЫЙ КОРИДОР',speedScale:1.16,dropChance:.20,rows:['2P12P2','11X111','C21E2C','212212','1P11P1','..UR..','.M..M.']},
  {name:'СЕРДЦЕ РЕАКТОРА',speedScale:1.20,dropChance:.21,rows:['C2E2C2','221X22','1PCCP1','2X22X2','D2112D','..EE..','.M..M.']}
];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
const ui = {
  score:document.getElementById('score'), best:document.getElementById('best'), lives:document.getElementById('lives'),
  stage:document.getElementById('stageLabel'), compactSector:document.getElementById('compactSector'), overlay:document.getElementById('overlay'),
  charge:document.getElementById('chargeFill'), chargeText:document.getElementById('chargeText'), chargeBar:document.getElementById('chargeBar'),
  hint:document.getElementById('hint'), launch:document.getElementById('launchBtn'),launchLabel:document.getElementById('launchLabel'),
  pulse:document.getElementById('pulseBtn'),pulseLabel:document.getElementById('pulseLabel'),
  pause:document.getElementById('pauseBtn'),sound:document.getElementById('soundBtn'),
  settingsButton:document.getElementById('settingsBtn'),settingsPanel:document.getElementById('settingsPanel'),
  settingsClose:document.getElementById('settingsClose'),settingsDone:document.getElementById('settingsDone'),volume:document.getElementById('volumeRange'),
  volumeText:document.getElementById('volumeValue'),effects:document.getElementById('effectsSelect'),
  sensitivity:document.getElementById('sensitivityRange'),
  sensitivityText:document.getElementById('sensitivityValue')
};

let audioContext = null;
let soundEnabled = false;
let masterVolume=.6;
let lastBeepAt=-Infinity;
function beep(frequency, duration=.06, volume=.035, type='sine') {
  if (!soundEnabled||masterVolume<=0) return;
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
    // Ограничиваем частоту коротких звуков, чтобы столкновения не перегружали мобильный аудиодвижок.
    const now=audioContext.currentTime;
    if(now-lastBeepAt<.05)return;
    lastBeepAt=now;
    const osc=audioContext.createOscillator(), gain=audioContext.createGain();
    osc.type=type;osc.frequency.setValueAtTime(frequency,audioContext.currentTime);
    gain.gain.setValueAtTime(volume*masterVolume,audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+duration);
    osc.connect(gain);gain.connect(audioContext.destination);
    osc.start();osc.stop(audioContext.currentTime+duration);
  } catch (_) { soundEnabled=false;ui.sound.querySelector('.sound-state').textContent='ВЫКЛ'; }
}

function random(min,max){return min+Math.random()*(max-min)}
function clamp(n,lo,hi){return Math.min(hi,Math.max(lo,n))}
/**
 * Основной владелец состояния игры и её жизненного цикла.
 * Правила кирпичей, физика, боссы, усиления, интерфейс и сохранения
 * подключаются к прототипу после объявления класса, но до первого new Game.
 * Это сохраняет один источник состояния и делает повторное создание
 * экземпляра безопасным для тестового стенда.
 */
class Game {
  constructor(){
    this.frame=0;
    this.state='menu';
    this.score=0;
    this.best=safeLoadBest();
    this.checkpoint=safeLoadCheckpoint();
    this.lives=3;
    this.level=0;
    this.energy=0;
    this.bricks=[];
    this.drops=[];
    this.particles=[];
    this.waves=[];
    this.enemyShots=[];
    this.boss=null;
    this.sectorPhase='bricks';
    this.keys={};
    this.activePointerId=null;
    this.settings=safeLoadSettings();
    this.settingsOpen=false;
    ui.settingsPanel.hidden=true;
    this.reducedMotion=this.settings.effects==='reduced'||
      (this.settings.effects==='auto'&&Boolean(window.matchMedia&&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    soundEnabled=this.settings.sound;
    masterVolume=this.settings.volume/100;
    this.syncSettingsUI();
    this.paddle={x:CFG.width/2,w:CFG.paddleW,y:CFG.paddleY,h:CFG.paddleH};
    this.targetX=this.paddle.x;
    this.ball={x:CFG.width/2,y:CFG.paddleY-14,vx:0,vy:0,r:CFG.ballRadius,trail:[]};
    this.extraBalls=[];
    this.timers={pulse:0,wide:0,slow:0,magnet:0};
    this.time=0;
    this.flash=0;
    this.shieldCharges=0;
    this.runStats={seconds:0,hits:0,broken:0,pulses:0,maxCombo:0,barriers:0,splits:0};
    this.comboHits=0;
    this.comboUntil=0;
    this.bestComboInSector=0;
    this.lastSectorBonus=0;
    this.lastSectorBestCombo=0;
    this.stars=Array.from({length:68},(_,i)=>({x:(i*137.37)%CFG.width,y:(i*231.59)%CFG.height,r:i%7===0?1.6:.8,s:(i%4)*.16+.18}));
    this.backdropLayer=createLayer();
    this.brickLayer=createLayer();
    this.bricksDirty=true;
    this.brickPaintCount=0;
    // Небольшие прозрачные спрайты заменяют дорогое рисование градиентов и теней в каждом кадре.
    this.spritePaintCount=0;
    this.sprites={
      paddleNormal:this.makePaddleSprite(CFG.paddleW,false),
      paddleWide:this.makePaddleSprite(145,true),
      ballNormal:this.makeBallSprite(false),
      ballPulse:this.makeBallSprite(true),
      guardianOpen:this.makeGuardianSprite(false),
      guardianShield:this.makeGuardianSprite(true),
      reactor:this.makeReactorSprite()
    };
    this.profileEnabled=Boolean(window.location && /(?:\?|&)fps=1(?:&|$)/.test(window.location.search||''));
    this.performance={fps:0,maxFrameMs:0,avgUpdateMs:0,avgDrawMs:0,
      frames:0,seconds:0,worst:0,updateTotalMs:0,drawTotalMs:0};
    if(this.backdropLayer)this.drawBackdrop(this.backdropLayer.ctx);
    this.draw();
    this.showOverlay('intro');
    this.updateUI();
  }
  setState(state){
    this.state=state;
    this.updateUI();
  }
  resetBall(){
    this.ball={x:this.paddle.x,y:this.paddle.y-17,vx:0,vy:0,r:CFG.ballRadius,trail:[]};
    this.extraBalls=[];
    this.timers.pulse=0;
    this.timers.slow=0;
    this.timers.magnet=0;
  }
  startNewGame(){
    // Новая игра удаляет предыдущую контрольную точку, в том числе после поражения.
    this.checkpoint=null;
    safeClearCheckpoint();
    this.score=0;
    this.lives=3;
    this.energy=0;
    this.level=0;
    this.timers={pulse:0,wide:0,slow:0,magnet:0};
    this.resetCombo();
    this.bestComboInSector=0;
    this.lastSectorBonus=0;
    this.lastSectorBestCombo=0;
    this.runStats={seconds:0,hits:0,broken:0,pulses:0,maxCombo:0,barriers:0,splits:0};
    this.shieldCharges=0;
    this.paddle.w=CFG.paddleW;
    this.paddle.x=CFG.width/2;
    this.targetX=this.paddle.x;
    this.drops=[];
    this.particles=[];
    this.waves=[];
    this.enemyShots=[];
    this.startLevel();
  }
  startLevel(){
    this.makeBricks();
    this.drops=[];
    this.waves=[];
    this.enemyShots=[];
    this.paddle.w=CFG.paddleW;
    this.timers.wide=0;
    this.shieldCharges=0;
    this.resetCombo();
    this.bestComboInSector=0;
    this.resetBall();
    this.setState('ready');
    this.hideOverlay();
    this.flash=0;
    this.updateUI();
  }
  launch(){
    if(this.settingsOpen)return;
    if(this.state==='menu' || this.state==='lost'){
      if(this.checkpoint&&this.continueGame())return;
      this.startNewGame();return;
    }
    if(this.state==='won'){this.startNewGame();return}
    if(this.state==='between'){this.level++;this.startLevel();return}
    if(this.state==='paused'){this.resume();return}
    if(this.state==='playing'){this.releaseHeldBalls();return}
    if(this.state!=='ready')return;
    const speed=this.levelSpeed();
    this.ball.vx=random(-110,110);
    this.ball.vy=-Math.sqrt(speed**2-this.ball.vx**2);
    this.setState('playing');
    this.hideOverlay();
    beep(430,.09);
  }
  togglePause(){
    if(this.state==='paused'){if(!this.settingsOpen)this.resume();return}
    if(this.state==='playing'||this.state==='ready'){
      this.savedState=this.state;this.setState('paused');this.showOverlay('pause');
    }
  }
  resume(){if(this.state!=='paused')return;this.setState(this.savedState||'ready');this.hideOverlay()}
  levelSpeed(){return Math.min(CFG.maxSpeed,CFG.initialSpeed*LEVELS[this.level].speedScale)}
  activeBalls(){return [this.ball,...this.extraBalls]}
  ballSpeed(ball=this.ball){return Math.hypot(ball.vx,ball.vy)}
  setBallSpeed(speed,ball=this.ball){
    const current=this.ballSpeed(ball);if(current<1)return;
    ball.vx*=speed/current;ball.vy*=speed/current;
  }
  removeBall(ball){
    if(ball===this.ball){
      if(this.extraBalls.length)this.ball=this.extraBalls.shift();
      else {this.dropBall();return}
    }else{
      const index=this.extraBalls.indexOf(ball);
      if(index>=0)this.extraBalls.splice(index,1);
    }
    this.addParticles(ball.x,CFG.bottom-12,9,'#c5abff');
    this.updateUI();
  }
  dropBall(){
    this.lives--;this.resetCombo();this.addParticles(this.ball.x,CFG.bottom-20,22,'#f9a4d2');beep(170,.25,.07,'triangle');
    this.drops=[];this.enemyShots=[];this.timers.wide=0;this.timers.magnet=0;this.paddle.w=CFG.paddleW;this.shieldCharges=0;this.extraBalls=[];
    if(this.lives<=0){this.end('lost');return}
    this.resetBall();this.setState('ready');this.updateUI();
  }
  end(kind){
    if(kind==='won'){
      this.checkpoint=null;safeClearCheckpoint(); // Завершённую кампанию нельзя возобновлять с контрольной точки.
    }
    this.setState(kind);this.updateBest();
    this.showOverlay(kind);beep(kind==='won'?720:180,.25,.04,'triangle');
  }
  checkStageCompletion(){
    if(this.bricks.length||this.state!=='playing'||this.sectorPhase!=='bricks')return;
    if(this.level===2)this.beginGuardian();
    else if(this.level===LEVELS.length-1)this.beginReactor();
    else this.completeLevel();
  }
  completeLevel(){
    this.enemyShots=[];this.lastSectorBestCombo=this.bestComboInSector;
    this.lastSectorBonus=100*(this.level+1)*Math.max(0,this.lives);
    this.score+=this.lastSectorBonus;
    this.resetCombo();
    this.updateBest();this.addParticles(CFG.width/2,230,45,'#59efff');
    if(this.level===LEVELS.length-1)this.end('won');
    else {
      this.setState('between');
      this.saveCheckpoint(); // Следующий ещё не начатый сектор можно восстановить после перезагрузки.
      this.showOverlay('between');beep(740,.19,.06);
    }
  }
  updateBest(){if(this.score>this.best){this.best=this.score;safeSaveBest(this.best)}}
  /**
   * Один шаг симуляции. Сначала обновляем эффекты и управление, затем
   * перемещаем сущности и проверяем столкновения. Пауза не меняет игровое время.
   * @param {number} dt Прошедшее время в секундах, ограниченное главным циклом.
   */
  update(dt){
    // Пауза останавливает и физику, и частицы.
    if(this.state==='paused')return;
    this.time+=dt;
    this.frame++;
    if(this.state==='playing')this.runStats.seconds+=dt;
    if(this.comboHits>0&&this.time>this.comboUntil)this.resetCombo();
    if(this.flash>0)this.flash=Math.max(0,this.flash-dt);
    for(let i=this.particles.length-1;i>=0;i--){
      const p=this.particles[i];
      p.x+=p.vx*dt;
      p.y+=p.vy*dt;
      p.vy+=125*dt;
      p.life-=dt;
      if(p.life<=0)this.particles.splice(i,1);
    }
    for(let i=this.waves.length-1;i>=0;i--){
      const wave=this.waves[i];
      wave.life-=dt;
      if(wave.life<=0)this.waves.splice(i,1);
    }
    this.updateBoss(dt);
    if(this.state!=='ready'&&this.state!=='playing')return;
    this.updatePaddle(dt);
    if(this.state==='ready'){
      this.ball.x=this.paddle.x;this.ball.y=this.paddle.y-17;
      return;
    }
    for(const ball of this.activeBalls()){
      if(!ball.held)continue;
      ball.x=clamp(this.paddle.x+(ball.holdOffset||0),CFG.left+ball.r,CFG.right-ball.r);
      ball.y=this.paddle.y-ball.r-1;
      ball.holdTime=Math.max(0,(ball.holdTime||0)-dt);
    }
    this.updateEffectTimers(dt);
    this.updateDrops(dt);
    if(this.state==='playing')this.updateEnemyShots(dt);
    if(this.activeBalls().some(b=>b.held&&(b.holdTime<=0||this.timers.magnet<=0)))
      this.releaseHeldBalls();
    this.advancePhysics(dt);
  }


  /** Клавиатура задаёт цель, платформа плавно следует к ней в пределах арены. */
  updatePaddle(dt){
    const move=(this.keys.ArrowRight||this.keys.KeyD?1:0)-
      (this.keys.ArrowLeft||this.keys.KeyA?1:0);
    if(move!==0)this.targetX+=move*CFG.paddleSpeed*dt*this.settings.sensitivity/100;
    this.targetX=clamp(this.targetX,CFG.left+this.paddle.w/2,CFG.right-this.paddle.w/2);
    this.paddle.x+=(this.targetX-this.paddle.x)*Math.min(1,dt*23);
  }


  // Подсистемы подключаются до создания Game, сохраняя общий объект состояния.

}

if(typeof IMPULSE_RENDER_METHODS==='undefined'){
  throw new Error('Не загружен модуль отрисовки game-render.js');
}
Object.assign(Game.prototype,IMPULSE_RENDER_METHODS);

if(typeof IMPULSE_PHYSICS_METHODS==='undefined'){
  throw new Error('Не загружен модуль физики game-physics.js');
}
Object.assign(Game.prototype,IMPULSE_PHYSICS_METHODS);

if(typeof IMPULSE_BOSS_METHODS==='undefined'){
  throw new Error('Не загружен модуль боссов game-bosses.js');
}
Object.assign(Game.prototype,IMPULSE_BOSS_METHODS);

if(typeof IMPULSE_EFFECT_METHODS==='undefined'){
  throw new Error('Не загружен модуль эффектов game-effects.js');
}
Object.assign(Game.prototype,IMPULSE_EFFECT_METHODS);

if(typeof IMPULSE_PERSISTENCE_METHODS==='undefined'){
  throw new Error('Не загружен модуль хранения game-storage.js');
}
Object.assign(Game.prototype,IMPULSE_PERSISTENCE_METHODS);

if(typeof IMPULSE_UI_METHODS==='undefined'){
  throw new Error('Не загружен модуль интерфейса game-ui.js');
}
Object.assign(Game.prototype,IMPULSE_UI_METHODS);

if(typeof IMPULSE_BRICK_METHODS==='undefined'){
  throw new Error('Не загружен модуль кирпичей game-bricks.js');
}
Object.assign(Game.prototype,IMPULSE_BRICK_METHODS);

const game=new Game();
