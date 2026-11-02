/*
 * ИМПУЛЬС — оригинальный браузерный арканоид.
 * Vanilla JavaScript + Canvas 2D, без сторонних зависимостей.
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
function roundRect(x,y,w,h,r,fillStyle,strokeStyle,target=ctx){
  target.beginPath();target.roundRect(x,y,w,h,r);
  if(fillStyle){target.fillStyle=fillStyle;target.fill()}
  if(strokeStyle){target.strokeStyle=strokeStyle;target.stroke()}
}
// Кэшируем слои 480×720: дорогие тени и градиенты перерисовываются только при изменении состояния.
function createLayer(width=CFG.width,height=CFG.height){
  if(typeof document.createElement!=='function')return null;
  const layer=document.createElement('canvas');layer.width=width;layer.height=height;
  const target=layer.getContext('2d');
  return target?{canvas:layer,ctx:target}:null;
}
function safeLoadBest(){try{return Math.max(0,Number(localStorage.getItem(CFG.storageKey))||0)}catch(_){return 0}}
function safeSaveBest(value){try{localStorage.setItem(CFG.storageKey,String(value))}catch(_){/* Локальное хранилище может быть запрещено браузером */}}
const SETTINGS_DEFAULTS=Object.freeze({sound:false,volume:60,effects:'auto',sensitivity:100});
function safeLoadSettings(){
  try{
    const raw=localStorage.getItem(CFG.settingsKey);
    if(!raw||raw.length>1024)return {...SETTINGS_DEFAULTS};
    const x=JSON.parse(raw);
    if(!x||x.version!==1||typeof x.sound!=='boolean'||
       !Number.isInteger(x.volume)||x.volume<0||x.volume>100||
       !['auto','full','reduced'].includes(x.effects)||
       !Number.isInteger(x.sensitivity)||x.sensitivity<70||x.sensitivity>130)
      return {...SETTINGS_DEFAULTS};
    return {sound:x.sound,volume:x.volume,effects:x.effects,sensitivity:x.sensitivity};
  }catch(_){return {...SETTINGS_DEFAULTS}}
}
function safeSaveSettings(value){
  try{localStorage.setItem(CFG.settingsKey,JSON.stringify({version:1,...value}));return true}
  catch(_){return false}
}
// Контрольные точки создаются только после завершения сектора.
// Не сохраняем подвижные объекты, незавершённые бои с боссами и частично разрушенные блоки.
const CHECKPOINT_VERSION=1;
const STAT_KEYS=['seconds','hits','broken','pulses','maxCombo','barriers','splits'];
function safeLoadCheckpoint(){
  try{
    const raw=localStorage.getItem(CFG.checkpointKey);
    if(!raw||raw.length>4096)return null;
    const value=JSON.parse(raw);
    if(!value||value.version!==CHECKPOINT_VERSION||
       !Number.isInteger(value.sector)||value.sector<1||value.sector>=LEVELS.length||
       !Number.isSafeInteger(value.score)||value.score<0||value.score>1e9||
       !Number.isInteger(value.lives)||value.lives<1||value.lives>5||
       !Number.isFinite(value.energy)||value.energy<0||value.energy>100||
       !value.stats||typeof value.stats!=='object'||Array.isArray(value.stats)||
       !STAT_KEYS.every(k=>typeof value.stats[k]==='number'&&Number.isFinite(value.stats[k])&&
         value.stats[k]>=0&&value.stats[k]<=1e9))return null;
    return {version:CHECKPOINT_VERSION,sector:value.sector,score:value.score,
      lives:value.lives,energy:value.energy,
      stats:Object.fromEntries(STAT_KEYS.map(k=>[k,value.stats[k]]))};
  }catch(_){return null}
}
function safeSaveCheckpoint(checkpoint){
  try{localStorage.setItem(CFG.checkpointKey,JSON.stringify(checkpoint));return true}
  catch(_){return false}
}
function safeClearCheckpoint(){
  try{localStorage.removeItem(CFG.checkpointKey)}catch(_){/* Доступ к хранилищу может быть запрещён */}
}

class Game {
  constructor(){
    this.frame=0;this.state='menu';this.score=0;this.best=safeLoadBest();this.checkpoint=safeLoadCheckpoint();this.lives=3;this.level=0;
    this.energy=0;this.bricks=[];this.drops=[];this.particles=[];this.waves=[];this.enemyShots=[];this.boss=null;this.sectorPhase='bricks';this.keys={};this.activePointerId=null;
    this.settings=safeLoadSettings();this.settingsOpen=false;ui.settingsPanel.hidden=true;
    this.reducedMotion=this.settings.effects==='reduced'||
      (this.settings.effects==='auto'&&Boolean(window.matchMedia&&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    soundEnabled=this.settings.sound;masterVolume=this.settings.volume/100;
    this.syncSettingsUI();
    this.paddle={x:CFG.width/2,w:CFG.paddleW,y:CFG.paddleY,h:CFG.paddleH};this.targetX=this.paddle.x;
    this.ball={x:CFG.width/2,y:CFG.paddleY-14,vx:0,vy:0,r:CFG.ballRadius,trail:[]};this.extraBalls=[];
    this.timers={pulse:0,wide:0,slow:0,magnet:0};this.time=0;this.flash=0;this.shieldCharges=0;
    this.runStats={seconds:0,hits:0,broken:0,pulses:0,maxCombo:0,barriers:0,splits:0};
    this.comboHits=0;this.comboUntil=0;this.bestComboInSector=0;
    this.lastSectorBonus=0;this.lastSectorBestCombo=0;
    this.stars=Array.from({length:68},(_,i)=>({x:(i*137.37)%CFG.width,y:(i*231.59)%CFG.height,r:i%7===0?1.6:.8,s:(i%4)*.16+.18}));
    this.backdropLayer=createLayer();this.brickLayer=createLayer();this.bricksDirty=true;this.brickPaintCount=0;
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
    this.draw();this.showOverlay('intro');this.updateUI();
  }
  setState(state){this.state=state;this.updateUI()}
  syncSettingsUI(){
    ui.volume.value=String(this.settings.volume);ui.volumeText.textContent=this.settings.volume+'%';
    ui.effects.value=this.settings.effects;
    ui.sensitivity.value=String(this.settings.sensitivity);
    ui.sensitivityText.textContent=this.settings.sensitivity+'%';
    ui.sound.querySelector('.sound-state').textContent=this.settings.sound?'ВКЛ':'ВЫКЛ';
    ui.sound.setAttribute('aria-label',this.settings.sound?'Выключить звук':'Включить звук');
  }
  setSetting(key,value){
    if(key==='volume'||key==='sensitivity')value=Number(value);
    const next={...this.settings,[key]:value};
    if(typeof next.sound!=='boolean'||!Number.isInteger(next.volume)||
       next.volume<0||next.volume>100||!['auto','full','reduced'].includes(next.effects)||
       !Number.isInteger(next.sensitivity)||next.sensitivity<70||next.sensitivity>130)return false;
    this.settings=next;soundEnabled=next.sound;masterVolume=next.volume/100;
    this.reducedMotion=next.effects==='reduced'||
      (next.effects==='auto'&&Boolean(window.matchMedia&&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    if(this.reducedMotion){this.waves=[];if(this.particles.length>60)this.particles.splice(0,this.particles.length-60)}
    safeSaveSettings(next);this.syncSettingsUI();return true;
  }
  toggleSettings(force){
    const open=force===undefined?!this.settingsOpen:Boolean(force);
    if(open===this.settingsOpen)return;
    this.settingsOpen=open;
    if(open&&this.state==='playing')this.togglePause();
    ui.settingsPanel.hidden=!open;
    ui.settingsButton.setAttribute('aria-expanded',String(open));
    if(open)ui.settingsClose.focus();
    else ui.settingsButton.focus();
  }
  resetCombo(){this.comboHits=0;this.comboUntil=0}
  comboMultiplier(){return Math.min(4,1+Math.floor(Math.max(0,this.comboHits-1)/3))}
  registerHit(){
    if(this.time>this.comboUntil)this.resetCombo();
    this.comboHits++;this.comboUntil=this.time+CFG.comboWindow;
    this.bestComboInSector=Math.max(this.bestComboInSector,this.comboHits);
    this.runStats.maxCombo=Math.max(this.runStats.maxCombo,this.comboHits);
    return this.comboMultiplier();
  }
  resetBall(){
    this.ball={x:this.paddle.x,y:this.paddle.y-17,vx:0,vy:0,r:CFG.ballRadius,trail:[]};
    this.extraBalls=[];this.timers.pulse=0;this.timers.slow=0;this.timers.magnet=0;
  }
  makeBricks(){
    const rows=LEVELS[this.level].rows;
    this.bricks=[];
    for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){
      const code=rows[r][c];if(code==='.')continue;
      this.bricks.push({x:CFG.brickStartX+c*(CFG.brickW+CFG.brickGapX),y:CFG.brickStartY+r*(CFG.brickH+CFG.brickGapY),w:CFG.brickW,h:CFG.brickH,
         hp:code==='2'?2:1,maxHp:code==='2'?2:1,type:code==='C'?'core':code==='2'?'armor':code==='X'?'blast':code==='M'?'moving':code==='E'?'charge':code==='P'?'prism':'UDLR'.includes(code)?'directional':'normal',
        row:r,col:c,lock:0,face:'UDLR'.includes(code)?code:null,
        anchorX:CFG.brickStartX+c*(CFG.brickW+CFG.brickGapX),
        anchorY:CFG.brickStartY+r*(CFG.brickH+CFG.brickGapY),
        path:code==='M'?'roam':null,
        minX:CFG.brickStartX,maxX:CFG.right-CFG.brickW-12,
        minY:CFG.brickStartY+r*(CFG.brickH+CFG.brickGapY)-10,
        maxY:CFG.brickStartY+r*(CFG.brickH+CFG.brickGapY)+86,
        vx:code==='M'?(c%2?80:-90):0,
        vy:code==='M'?(c%2?-60:-65):0,
        directionClock:code==='M'?1.2+.17*c:0});
    }
    // Слабая грань должна быть доступна мячу со стороны игрового поля.
    // Направленные блоки, в отличие от обычных, могут стать непроходимыми,
    // если единственная уязвимая сторона обращена к стене.
    for(const brick of this.bricks)this.ensureDirectionalClearance(brick);
    this.boss=null;this.enemyShots=[];this.sectorPhase='bricks';this.bricksDirty=true;
  }
  saveCheckpoint(){
    if(this.state!=='between'||this.level>=LEVELS.length-1)return false;
    const checkpoint={version:CHECKPOINT_VERSION,sector:this.level+1,
      score:this.score,lives:this.lives,energy:this.energy,
      stats:Object.fromEntries(STAT_KEYS.map(k=>[k,this.runStats[k]]))};
    // Хранилище может быть недоступно или заполнено: не выдаём несохранённую точку за записанную.
    if(!safeSaveCheckpoint(checkpoint))return false;
    this.checkpoint=checkpoint;
    return true;
  }
  continueGame(){
    if(!this.checkpoint||!['menu','lost'].includes(this.state))return false;
    // Повторно проверяем данные контрольной точки перед применением, даже если объект изменили в памяти.
    const saved=this.checkpoint;
    const valid=saved.version===CHECKPOINT_VERSION&&
      Number.isInteger(saved.sector)&&saved.sector>=1&&saved.sector<LEVELS.length&&
      Number.isSafeInteger(saved.score)&&saved.score>=0&&saved.score<=1e9&&
      Number.isInteger(saved.lives)&&saved.lives>=1&&saved.lives<=5&&
      Number.isFinite(saved.energy)&&saved.energy>=0&&saved.energy<=100&&
      saved.stats&&STAT_KEYS.every(k=>Number.isFinite(saved.stats[k])&&saved.stats[k]>=0&&saved.stats[k]<=1e9);
    if(!valid){this.checkpoint=null;safeClearCheckpoint();return false}
    this.level=saved.sector;this.score=saved.score;this.lives=saved.lives;
    this.energy=saved.energy;
    this.runStats=Object.fromEntries(STAT_KEYS.map(k=>[k,saved.stats[k]]));
    this.time=0;this.resetCombo();this.bestComboInSector=0;
    this.lastSectorBestCombo=0;this.lastSectorBonus=0;
    this.shieldCharges=0;
    this.paddle.x=CFG.width/2;this.targetX=this.paddle.x;
    this.keys={};this.activePointerId=null;
    this.timers={pulse:0,wide:0,slow:0,magnet:0};
    this.drops=[];this.particles=[];this.waves=[];this.enemyShots=[];
    this.startLevel();return true;
  }
  startNewGame(){
    // Новая игра удаляет предыдущую контрольную точку, в том числе после поражения.
    this.checkpoint=null;safeClearCheckpoint();
    this.score=0;this.lives=3;this.energy=0;this.level=0;this.timers={pulse:0,wide:0,slow:0,magnet:0};
    this.resetCombo();this.bestComboInSector=0;this.lastSectorBonus=0;this.lastSectorBestCombo=0;
    this.runStats={seconds:0,hits:0,broken:0,pulses:0,maxCombo:0,barriers:0,splits:0};this.shieldCharges=0;
    this.paddle.w=CFG.paddleW;this.paddle.x=CFG.width/2;this.targetX=this.paddle.x;
    this.drops=[];this.particles=[];this.waves=[];this.enemyShots=[];this.startLevel();
  }
  startLevel(){
    this.makeBricks();this.drops=[];this.waves=[];this.enemyShots=[];this.paddle.w=CFG.paddleW;this.timers.wide=0;this.shieldCharges=0;
    this.resetCombo();this.bestComboInSector=0;
    this.resetBall();this.setState('ready');this.hideOverlay();this.flash=0;this.updateUI();
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
    this.setState('playing');this.hideOverlay();beep(430,.09);
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
  hitBrick(brick,index){
    // После урона по площади пересчитываем индекс: соседние блоки могли уже исчезнуть.
    const actualIndex=this.bricks.indexOf(brick);
    if(actualIndex<0||brick.lock>0)return false;
    brick.lock=.11;brick.hp--;if(brick.type!=='moving')this.bricksDirty=true;this.runStats.hits++;
    const multiplier=this.registerHit();
    this.blockEffect(brick,brick.hp<=0);
    if(brick.hp<=0){
      this.bricks.splice(actualIndex,1);
      this.runStats.broken++;
      const gain=brick.type==='charge'?42:brick.type==='core'?24:brick.type==='armor'?18:brick.type==='blast'?20:12;
      const points=brick.type==='charge'?220:brick.type==='prism'?200:brick.type==='core'?240:brick.type==='armor'?180:brick.type==='blast'?160:100;
      this.score+=points*(this.level+1)*multiplier;
      this.energy=clamp(this.energy+gain,0,100);
      this.maybeDrop(brick);
      if(brick.type==='prism')this.splitBall();
      if(brick.type==='blast')this.blastNeighbors(brick);
      beep(brick.type==='core'?620:brick.type==='blast'?740:480,.07,.025,'square');
      this.updateBest();
      this.checkStageCompletion();
    }else{this.score+=35*multiplier;beep(290,.055,.028,'triangle')}
    this.updateUI();return true;
  }
  blastNeighbors(source){
    // Взрыв снимает одно очко прочности с соседних блоков по вертикали и горизонтали.
    // Цепные детонации и дополнительные комбо за вторичный урон запрещены.
    for(const target of [...this.bricks]){
      if(Math.abs(target.row-source.row)+Math.abs(target.col-source.col)!==1)continue;
      const index=this.bricks.indexOf(target);
      if(index<0)continue;
      if(target.type==='moving'||target.type==='directional')continue;
      target.hp=Math.max(0,target.hp-1);
      target.lock=0;this.bricksDirty=true;
      this.blockEffect(target,target.hp===0,true);
      if(target.hp===0){
        this.bricks.splice(index,1);this.runStats.broken++;
        this.score+=60*(this.level+1);this.energy=clamp(this.energy+6,0,100);
      }
    }
    this.flash=Math.max(this.flash,this.reducedMotion ? .07 : .16);
  }
  drawWaves(){
    for(const wave of this.waves){
      const progress=1-wave.life/wave.duration;
      const radius=4+wave.radius*progress;
      ctx.globalAlpha=(1-progress)*.8;
      ctx.strokeStyle=wave.color;ctx.lineWidth=wave.width*(1-progress*.55);
      ctx.beginPath();ctx.arc(wave.x,wave.y,radius,0,Math.PI*2);ctx.stroke();
      if(wave.kind==='burst'){
        // Четыре направленных световых штриха без градиентов, создаваемых в каждом кадре.
        const start=radius*.55,end=radius+12*(1-progress);
        ctx.beginPath();
        ctx.moveTo(wave.x-start,wave.y);ctx.lineTo(wave.x-end,wave.y);
        ctx.moveTo(wave.x+start,wave.y);ctx.lineTo(wave.x+end,wave.y);
        ctx.moveTo(wave.x,wave.y-start);ctx.lineTo(wave.x,wave.y-end);
        ctx.moveTo(wave.x,wave.y+start);ctx.lineTo(wave.x,wave.y+end);
        ctx.stroke();
      }
    }
    ctx.globalAlpha=1;ctx.lineWidth=1;
  }
  /**
   * Один шаг симуляции. Сначала обновляем эффекты и управление, затем
   * перемещаем сущности и проверяем столкновения. Пауза не меняет игровое время.
   * @param {number} dt Прошедшее время в секундах, ограниченное главным циклом.
   */
  update(dt){
    // Пауза останавливает и физику, и частицы.
    if(this.state==='paused')return;
    this.time+=dt;this.frame++;
    if(this.state==='playing')this.runStats.seconds+=dt;
    if(this.comboHits>0&&this.time>this.comboUntil)this.resetCombo();
    if(this.flash>0)this.flash=Math.max(0,this.flash-dt);
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=125*dt;p.life-=dt;if(p.life<=0)this.particles.splice(i,1)}
    for(let i=this.waves.length-1;i>=0;i--){const wave=this.waves[i];wave.life-=dt;if(wave.life<=0)this.waves.splice(i,1)}
    this.updateBoss(dt);
    if(this.state!=='ready'&&this.state!=='playing')return;
    this.updatePaddle(dt);
    if(this.state==='ready'){
      this.ball.x=this.paddle.x;this.ball.y=this.paddle.y-17;
      return;
    }
    for(const ball of this.activeBalls())if(ball.held){
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

  /**
   * Формируем наглядный итог забега из уже существующих счётчиков.
   * Статистика обновляется игровой моделью, поэтому отдельное состояние
   * результатов не создаётся и не расходится с сохранённой контрольной точкой.
   */
  runStatsMarkup(){
    const totalSeconds=Math.floor(Math.max(0,this.runStats.seconds));
    const elapsed=`${Math.floor(totalSeconds/60)}:${String(totalSeconds%60).padStart(2,'0')}`;
    const stats=this.runStats;
    return `<div class="run-stats" role="group" aria-label="Статистика забега">
      <div><span>ВРЕМЯ</span><strong>${elapsed}</strong></div>
      <div><span>БЛОКОВ</span><strong>${stats.broken}</strong></div>
      <div><span>ЛУЧШАЯ СЕРИЯ</span><strong>${stats.maxCombo}</strong></div>
    </div>
    <div class="run-stats-more">ПОПАДАНИЯ: ${stats.hits} · ИМПУЛЬСЫ: ${stats.pulses} · СПАСЕНИЯ: ${stats.barriers} · РАЗДЕЛЕНИЯ: ${stats.splits}</div>`;
  }
  overlayContent(kind){
    const checkpoint=this.checkpoint&&['intro','lost'].includes(kind)?this.checkpoint:null;
    const resumeLabel=checkpoint?'ПРОДОЛЖИТЬ · СЕКТОР '+String(checkpoint.sector+1).padStart(2,'0'):null;
    const common={
      intro:{icon:'✦',kicker:'НОВАЯ АРКАДА',title:'ИМПУЛЬС',text:'Пять секторов, мультишар и новые испытания. В третьем секторе Страж ядра, в пятом — Реактор.',action:resumeLabel||'НАЧАТЬ ИГРУ',small:checkpoint?'Сохранено на этом устройстве в начале сектора '+(checkpoint.sector+1)+'.':'На телефоне двигай платформу пальцем по полю. На ПК — мышь или стрелки.'},
      pause:{icon:'Ⅱ',kicker:'ИГРА ПРИОСТАНОВЛЕНА',title:'ПАУЗА',text:'Шар ждёт твоего возвращения.',action:'ПРОДОЛЖИТЬ',small:'Клавиша P — пауза / продолжить.'},
      between:{icon:'✧',kicker:'СЕКТОР ОЧИЩЕН',title:'ОТЛИЧНАЯ РАБОТА',text:`Следующий сектор: ${LEVELS[this.level+1]?.name ?? 'ФИНАЛ'}. Бонус за жизни: +${this.lastSectorBonus}. Лучшая серия: ${this.lastSectorBestCombo}. Жизни и счёт сохраняются.`,action:'СЛЕДУЮЩИЙ СЕКТОР',small:'Впереди более прочные блоки.'},
      won:{icon:'★',kicker:'МИССИЯ ВЫПОЛНЕНА',title:'ПЯТЬ СЕКТОРОВ И ДВА БОССА ПРОЙДЕНЫ',text:`Финальный счёт: ${this.score.toLocaleString('ru-RU')}. Бонус финального сектора: +${this.lastSectorBonus}. Твой рекорд: ${this.best.toLocaleString('ru-RU')}.`,action:'СЫГРАТЬ СНОВА',small:'Рекорд сохранён на этом устройстве.'},
      lost:{icon:'✕',kicker:'ПОПЫТКА ЗАВЕРШЕНА',title:'ИГРА ОКОНЧЕНА',text:`Ты набрал ${this.score.toLocaleString('ru-RU')} очков. Попробуй ещё раз!`,action:resumeLabel||'НОВАЯ ПОПЫТКА',small:checkpoint?'Сохранена контрольная точка перед сектором '+(checkpoint.sector+1)+'.':'Результат можно улучшить новой попыткой.'}
    }[kind];
    const results=(kind==='won'||kind==='lost')?this.runStatsMarkup():'';
    return `<div class="overlay-icon" aria-hidden="true">${common.icon}</div><div class="overlay-kicker">${common.kicker}</div><h2>${common.title}</h2><p>${common.text}</p>${results}<button type="button" class="overlay-action" id="overlayAction">${common.action}</button>${checkpoint?'<button type="button" class="overlay-action overlay-new-game" id="newGameAction">НОВАЯ ИГРА</button>':''}<div class="overlay-small">${common.small}</div>`;
  }
  showOverlay(kind){
    ui.overlay.innerHTML=this.overlayContent(kind);ui.overlay.hidden=false;
    ui.overlay.querySelector('#overlayAction').addEventListener('click',()=>this.launch(),{once:true});
    if(this.checkpoint&&['intro','lost'].includes(kind))
      ui.overlay.querySelector('#newGameAction').addEventListener('click',()=>this.startNewGame(),{once:true});
  }
  hideOverlay(){ui.overlay.hidden=true;ui.overlay.innerHTML=''}
  updateUI(){
    ui.score.textContent=String(this.score).padStart(6,'0');ui.best.textContent=String(this.best).padStart(6,'0');
    ui.lives.textContent='♥ '.repeat(Math.max(0,this.lives)).trim()||'—';
    // Счётчик относится только к фазе кирпичей: во время боя с боссом
    // число 0 не должно создавать впечатление завершённого сектора.
    const remaining=this.sectorPhase==='bricks'&&this.bricks.length?
      ` · ${this.bricks.length} БЛОКОВ`:'';
    ui.stage.textContent=`СЕКТОР ${String(this.level+1).padStart(2,'0')} / ${String(LEVELS.length).padStart(2,'0')}${remaining}`;
    ui.compactSector.textContent=`${String(this.level+1).padStart(2,'0')}/${String(LEVELS.length).padStart(2,'0')}`;
    ui.charge.style.width=`${this.energy}%`;ui.chargeText.textContent=`${Math.floor(this.energy)}%`;
    ui.chargeBar.setAttribute('aria-valuenow',String(Math.floor(this.energy)));
    ui.pulse.disabled=this.state!=='playing'||this.energy<100||this.timers.pulse>0;
    ui.pulseLabel.textContent=this.timers.pulse>0?'ПРОБИТИЕ!':this.energy>=100?'ИМПУЛЬС ГОТОВ':`ИМПУЛЬС ${Math.floor(this.energy)}%`;
    const labels={menu:'СТАРТ',ready:'ЗАПУСК ШАРА',playing:'ШАР В ИГРЕ',paused:'ПРОДОЛЖИТЬ',between:'СЛЕД. СЕКТОР',won:'СНОВА',lost:'ПОВТОРИТЬ'};
    ui.launchLabel.textContent=this.state==='playing'&&this.activeBalls().some(b=>b.held)?'ОТПУСТИТЬ ШАР':labels[this.state];ui.launch.disabled=this.state==='playing'&&!this.activeBalls().some(b=>b.held);
    ui.pause.disabled=!['ready','playing','paused'].includes(this.state);
    ui.pause.textContent=this.state==='paused'?'▶':'Ⅱ';
    ui.hint.textContent=this.activeBalls().some(b=>b.held)?'Мяч пойман магнитом: коснись поля или нажми «Отпустить шар».':this.timers.pulse>0?'Пробивной импульс активен: шары проходят сквозь блоки.':this.energy>=100?'Заряд готов! Нажми «ИМПУЛЬС» или F.':this.state==='ready'?'Нажми «Запуск шара» или коснись игрового поля.':'Разбивай блоки, чтобы зарядить пробивной импульс.';
  }

  // Визуальные методы подключаются к прототипу после объявления Game.
  // Это позволяет сохранить `this` и публичный интерфейс для тестов.

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

const game=new Game();
