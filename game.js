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
  // Гарантируем минимальную вертикальную составляющую скорости, сохраняя общую скорость шара.
  stabilizeBallAngle(b=this.ball){
    const speed=this.ballSpeed(b),minY=speed*.20;
    if(speed<1 || Math.abs(b.vy)>=minY)return;
    const directionY=b.vy<0?-1:1,directionX=b.vx<0?-1:1;
    b.vy=directionY*minY;b.vx=directionX*Math.sqrt(speed*speed-minY*minY);
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
  directionalClearance(brick,face=brick.face){
    if(!face)return Infinity;
    if(face==='L')return brick.x-CFG.left;
    if(face==='R')return CFG.right-(brick.x+brick.w);
    if(face==='U')return brick.y-CFG.top;
    return this.paddle.y-(brick.y+brick.h);
  }
  ensureDirectionalClearance(brick){
    if(brick.type!=='directional')return;
    // Между слабой гранью блока и стеной помещаются два радиуса мяча:
    // первый возле блока, второй возле границы арены.
    const required=2*CFG.ballRadius+2;
    if(this.directionalClearance(brick)>=required)return;
    const fallback=['D','U','L','R'].find(face=>this.directionalClearance(brick,face)>=required);
    // При невозможной геометрии уровня сигнализируем об ошибке сразу,
    // вместо появления неуязвимого блока.
    if(!fallback)throw new Error('Недоступная грань направленного блока: '+brick.row+','+brick.col);
    brick.face=fallback;
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
  pulse(){
    if(this.state!=='playing'||this.energy<100||this.timers.pulse>0)return;
    this.energy=0;this.timers.pulse=CFG.pulseDuration;this.flash=.36;this.runStats.pulses++;
    this.releaseHeldBalls();
    this.addParticles(this.ball.x,this.ball.y,28,'#ff85d9');
    for(const ball of this.activeBalls())
      this.setBallSpeed(clamp(this.ballSpeed(ball)*1.13,this.levelSpeed(),CFG.maxSpeed),ball);
    beep(520,.25,.06,'sawtooth');this.updateUI();
  }
  levelSpeed(){return Math.min(CFG.maxSpeed,CFG.initialSpeed*LEVELS[this.level].speedScale)}
  activeBalls(){return [this.ball,...this.extraBalls]}
  ballSpeed(ball=this.ball){return Math.hypot(ball.vx,ball.vy)}
  setBallSpeed(speed,ball=this.ball){
    const current=this.ballSpeed(ball);if(current<1)return;
    ball.vx*=speed/current;ball.vy*=speed/current;
  }
  splitBall(){
    if(this.state!=='playing'||this.activeBalls().length>=3)return false;
    this.releaseHeldBalls();
    const source=this.activeBalls().find(b=>!b.held&&this.ballSpeed(b)>1);
    if(!source)return false;
    const speed=clamp(this.ballSpeed(source),this.levelSpeed(),CFG.maxSpeed);
    const base=Math.atan2(source.vx,Math.abs(source.vy));
    for(const sign of [-1,1]){
      if(this.activeBalls().length>=3)break;
      const angle=clamp(base+sign*.48,-1.06,1.06);
      this.extraBalls.push({x:clamp(source.x+sign*13,CFG.left+source.r,CFG.right-source.r),
        y:source.y-5,vx:speed*Math.sin(angle),vy:-speed*Math.cos(angle),
        r:source.r,trail:[]});
    }
    this.runStats.splits++;
    this.addWave(source.x,source.y,'#ceacff',42,.25,2);
    beep(930,.1,.045,'triangle');this.updateUI();return true;
  }
  releaseHeldBalls(){
    let count=0;
    for(const b of this.activeBalls()){
      if(!b.held)continue;
      b.held=false;b.holdTime=0;
      const speed=this.levelSpeed()*(this.timers.slow>0 ? .75 : 1);
      const angle=clamp((b.holdOffset||0)/(this.paddle.w/2)*.75,-.85,.85);
      b.vx=speed*Math.sin(Math.abs(angle)<.12 ? .16 : angle);
      b.vy=-Math.sqrt(speed*speed-b.vx*b.vx);count++;
    }
    if(count)this.updateUI();
    return count;
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
  beginGuardian(){
    if(this.sectorPhase!=='bricks'||this.level!==2)return;
    this.sectorPhase='guardian';
    this.boss={kind:'guardian',x:CFG.width/2-80,y:138,w:160,h:66,hp:6,maxHp:6,lock:0,phaseTime:0,hitFlash:0,vx:72,minX:CFG.left+24,maxX:CFG.right-24-160,shotClock:0};
    this.addWave(CFG.width/2,170,'#f6acff',90,.4,3);
    this.addParticles(CFG.width/2,170,28,'#df96ff');
    beep(280,.17,.04,'sawtooth');this.updateUI();
  }
  beginReactor(){
    if(this.sectorPhase!=='bricks'||this.level!==LEVELS.length-1)return;
    this.sectorPhase='reactor';
    this.boss={kind:'reactor',x:CFG.width/2-94,y:139,w:188,h:76,
      hp:6,maxHp:6,lock:0,phaseTime:0,hitFlash:0,vx:65,
      minX:CFG.left+64,maxX:CFG.right-64-188,shotClock:0,
      nodes:[{offset:36,hp:2},{offset:94,hp:2},{offset:152,hp:2}]};
    this.addWave(CFG.width/2,179,'#f5b37b',105,.4,3);
    this.addParticles(CFG.width/2,179,28,'#ffc690',{shard:true});
    beep(230,.20,.05,'sawtooth');this.updateUI();
  }
  guardianVulnerable(){
    return this.boss!==null&&this.boss.kind==='guardian'&&this.boss.phaseTime%3.5<2.5;
  }
  reactorNodes(){
    const b=this.boss;
    return b?.kind==='reactor'?b.nodes.filter(n=>n.hp>0):[];
  }
  checkStageCompletion(){
    if(this.bricks.length||this.state!=='playing'||this.sectorPhase!=='bricks')return;
    if(this.level===2)this.beginGuardian();
    else if(this.level===LEVELS.length-1)this.beginReactor();
    else this.completeLevel();
  }
  damageReactor(node){
    const boss=this.boss;
    if(!boss||boss.kind!=='reactor'||this.state!=='playing'||boss.lock>0||node.hp<=0)return false;
    boss.lock=.16;boss.hitFlash=.20;node.hp--;boss.hp--;this.runStats.hits++;
    this.score+=400*(this.level+1);this.energy=clamp(this.energy+14,0,100);
    const x=boss.x+node.offset,y=boss.y+boss.h-10;
    this.addWave(x,y,'#ffd39d',37,.24,2);
    this.addParticles(x,y,13,'#ffa96c',{shard:true,life:.36});
    beep(480+node.hp*55,.09,.038,'triangle');
    if(boss.hp<=0){
      this.score+=3000;this.runStats.broken++;
      this.addParticles(boss.x+boss.w/2,boss.y+38,65,'#ffd39d',{shard:true,life:.62});
      this.addWave(boss.x+boss.w/2,boss.y+38,'#ffb973',145,.50,3,'burst');
      this.addWave(boss.x+boss.w/2,boss.y+38,'#ff7bbc',176,.57,2);
      this.flash=Math.max(this.flash,this.reducedMotion ? .07 : .3);
      this.boss=null;this.sectorPhase='finished';this.completeLevel();
    }else{this.updateBest();this.updateUI()}
    return true;
  }
  reactorCollision(b,prevX,prevY){
    const boss=this.boss;
    if(!boss||boss.kind!=='reactor')return false;
    const cx=clamp(b.x,boss.x,boss.x+boss.w),cy=clamp(b.y,boss.y,boss.y+boss.h);
    if((b.x-cx)**2+(b.y-cy)**2>b.r*b.r)return false;
    const node=boss.nodes.find(n=>n.hp>0&&
      (b.x-(boss.x+n.offset))**2+(b.y-(boss.y+boss.h-10))**2<=(b.r+18)**2);
    if(node&&prevY-b.r>=boss.y+boss.h-2&&b.vy<0&&boss.lock<=0)this.damageReactor(node);
    if(this.state==='playing'&&(!node||prevY-b.r<boss.y+boss.h-2||b.vy>=0||this.timers.pulse<=0))
      this.reflectBallFromRect(boss,prevX,prevY,b);
    return true;
  }
  damageGuardian(){
    const boss=this.boss;
    if(!boss||this.state!=='playing'||boss.lock>0||!this.guardianVulnerable())return false;
    boss.lock=.17;boss.hitFlash=.22;boss.hp--;this.runStats.hits++;
    this.score+=250*(this.level+1);this.energy=clamp(this.energy+12,0,100);
    this.addParticles(boss.x+boss.w/2,boss.y+boss.h/2,12,'#f6b3ff',{shard:true,life:.35});
    this.addWave(boss.x+boss.w/2,boss.y+boss.h/2,'#ffb5ec',48,.22,2);
    beep(420+boss.hp*40,.07,.035,'triangle');
    if(boss.hp<=0){
      this.runStats.broken++;this.score+=1500;this.boss=null;this.sectorPhase='finished';
      this.addParticles(CFG.width/2,boss.y+boss.h/2,60,'#ffcf94',{shard:true,life:.65});
      this.addWave(CFG.width/2,boss.y+boss.h/2,'#ffd09a',110,.46,3,'burst');
      this.addWave(CFG.width/2,boss.y+boss.h/2,'#f5a8ff',148,.56,2);
      this.flash=Math.max(this.flash,this.reducedMotion ? .06 : .27);
      this.updateBest();this.completeLevel();
    }else{this.updateBest();this.updateUI()}
    return true;
  }
  updateMovingBricks(dt){
    // Свободно движущиеся цели используют общее поле препятствий, без искусственных рельсов.
    // Проверяем оси отдельно: отражаем цель от оставшихся кирпичей и стен.
    const movers=this.bricks.filter(b=>b.type==='moving');
    const occupied=(brick,x,y)=>this.bricks.some(other=>
      other!==brick&&x<other.x+other.w+1&&x+brick.w+1>other.x&&
      y<other.y+other.h+1&&y+brick.h+1>other.y);
    for(const brick of movers){
      brick.directionClock-=dt;
      if(brick.directionClock<=0){
        const angle=Math.random()*Math.PI*2,speed=100;
        brick.vx=Math.cos(angle)*speed;brick.vy=Math.sin(angle)*speed;
        brick.directionClock=1.4+Math.random()*1.3;
      }
      const x=brick.x+brick.vx*dt;
      if(x<CFG.left+4||x+brick.w>CFG.right-4||occupied(brick,x,brick.y)){
        brick.vx=-brick.vx;
      }else brick.x=x;
      const y=brick.y+brick.vy*dt;
      if(y<CFG.brickStartY-3||y+brick.h>this.paddle.y-108||occupied(brick,brick.x,y)){
        brick.vy=-brick.vy;
      }else brick.y=y;
    }
  }
  shootBoss(boss){
    if(this.enemyShots.length>=4||this.state!=='playing')return;
    const x=boss.x+boss.w/2,y=boss.y+boss.h+8;
    const dx=clamp(this.paddle.x-x,-175,175);
    const speed=boss.kind==='reactor'?205:177;
    this.enemyShots.push({x,y,vx:dx*.36,vy:speed,r:8});
    this.addWave(x,y,boss.kind==='reactor'?'#ffb76c':'#ef94ff',24,.19,2);
    beep(240,.07,.03,'sawtooth');
  }
  updateEnemyShots(dt){
    for(let i=this.enemyShots.length-1;i>=0;i--){
      const shot=this.enemyShots[i],oldY=shot.y;
      shot.x+=shot.vx*dt;shot.y+=shot.vy*dt;
      if(shot.y-shot.r>CFG.bottom||shot.x<CFG.left-20||shot.x>CFG.right+20){
        this.enemyShots.splice(i,1);continue;
      }
      if(shot.vy>0&&oldY+shot.r<=this.paddle.y+5&&shot.y+shot.r>=this.paddle.y &&
        Math.abs(shot.x-this.paddle.x)<=this.paddle.w/2+shot.r){
        this.enemyShots.splice(i,1);
        this.addParticles(shot.x,this.paddle.y,14,'#ffae78');
        this.addWave(shot.x,this.paddle.y,'#ffc68a',30,.24,2);
        if(this.shieldCharges>0){this.shieldCharges=0;this.runStats.barriers++;this.updateUI()}
        else this.dropBall();
        break;
      }
    }
  }
  collisionSide(rect,prevX,prevY,ball){
    // Определяем грань по предыдущему положению краёв шара: касательные удары не меняют уязвимую сторону.
    if(prevY+ball.r<=rect.y+1)return 'U';
    if(prevY-ball.r>=rect.y+rect.h-1)return 'D';
    if(prevX+ball.r<=rect.x+1)return 'L';
    if(prevX-ball.r>=rect.x+rect.w-1)return 'R';
    const distances=[
      ['U',Math.abs(ball.y+ball.r-rect.y)],
      ['D',Math.abs(rect.y+rect.h-(ball.y-ball.r))],
      ['L',Math.abs(ball.x+ball.r-rect.x)],
      ['R',Math.abs(rect.x+rect.w-(ball.x-ball.r))]
    ];
    distances.sort((a,b)=>a[1]-b[1]);return distances[0][0];
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
  maybeDrop(brick){
    if(Math.random()>LEVELS[this.level].dropChance)return;
    const t=Math.random(),type=t<.28?'wide':t<.49?'slow':t<.64?'shield':t<.78?'multi':t<.92?'magnet':'life';
    this.drops.push({x:brick.x+brick.w/2,y:brick.y+brick.h/2,vy:115,type,spin:0});
  }
  applyDrop(type){
    if(type==='wide'){this.timers.wide=CFG.wideDuration;this.paddle.w=145}
    if(type==='slow'){
      if(this.timers.slow<=0)for(const ball of this.activeBalls())
        if(this.ballSpeed(ball)>0)this.setBallSpeed(Math.max(195,this.ballSpeed(ball)*.75),ball);
      this.timers.slow=CFG.slowDuration;
    }
    if(type==='magnet')this.timers.magnet=12;
    if(type==='multi')this.splitBall();
    if(type==='life')this.lives=Math.min(5,this.lives+1);
    if(type==='shield')this.shieldCharges=1;
    this.score+=75;this.updateBest();this.addParticles(this.paddle.x,this.paddle.y,12,'#ffc477');beep(850,.13,.05);
    this.updateUI();
  }
  // Для каждого типа блока используется отдельный лёгкий визуальный эффект разрушения.
  // Визуальные эффекты не изменяют очки, столкновения и кэш кирпичей.
  blockEffect(brick,destroyed,secondary=false){
    const x=brick.x+brick.w/2,y=brick.y+brick.h/2;
    const colors={
      normal:['#6bcdff','#b8f5ff'],
      moving:['#89ffde','#d6ffed'],
      charge:['#ffdf80','#fff4c4'],
      prism:['#ae9aff','#eadfff'],
      armor:['#f0ba6c','#fff0b7'],
      core:['#ef83fc','#ffd5ff'],
      blast:['#ff8d50','#ffe2a1'],
      directional:['#8cffd1','#dbfff1']
    };
    const [color,highlight]=colors[brick.type]||colors.normal;
    const amount=destroyed?(brick.type==='blast'?14:brick.type==='armor'?11:9):brick.type==='armor'?5:3;
    this.addParticles(x,y,secondary?Math.min(amount,6):amount,color,{shard:destroyed,life:destroyed ? .44 : .27});
    if(!destroyed){
      if(brick.type==='armor')this.addWave(x,y,highlight,18,.14,1.6);
      return;
    }
    if(brick.type==='normal'||brick.type==='moving'||brick.type==='charge'||brick.type==='prism'||brick.type==='directional'){
      // Стеклянные осколки и короткий голубой импульс.
      this.addWave(x,y,highlight,33,.20,1.5);
    }else if(brick.type==='armor'){
      // Тяжёлые янтарные осколки и компактная металлическая ударная волна.
      this.addWave(x,y,highlight,41,.26,2.3);
    }else if(brick.type==='core'){
      // Две последовательно расходящиеся энергетические волны.
      this.addWave(x,y,color,49,.32,2.6);
      this.addWave(x,y,highlight,28,.20,1.5);
    }else if(brick.type==='blast'){
      // Короткий радиальный взрыв без повторного игрового урона.
      this.addWave(x,y,color,64,.31,3.5,'burst');
      this.addWave(x,y,highlight,95,.35,1.8);
      this.flash=Math.max(this.flash,this.reducedMotion ? .05 : .12);
    }
  }
  addWave(x,y,color,radius,duration,width=2,kind='ring'){
    if(this.reducedMotion)return;
    if(this.waves.length>=24)this.waves.splice(0,this.waves.length-23);
    this.waves.push({x,y,color,radius,duration,life:duration,width,kind});
  }
  addParticles(x,y,n,color,{shard=false,life=0}={}){
    // Ограничиваем количество эффектов при серии комбо, взрывах и множественном разрушении.
    const max=180,count=Math.min(this.reducedMotion?Math.ceil(n*.33):n,max);
    if(this.particles.length+count>max)this.particles.splice(0,this.particles.length+count-max);
    for(let i=0;i<count;i++){
      const duration=life||random(.3,.75);
      this.particles.push({x,y,vx:random(-170,170),vy:random(-180,160),
        life:duration,maxLife:duration,color,r:random(shard?2.4:1.1,shard?5:3.4),shard});
    }
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
  /**
   * Движение шаров разбивается на шаги не больше 6 мс.
   * Это снижает вероятность пропуска тонких блоков на редких кадрах.
   * Подвижные кирпичи перемещаются один раз за шаг, а не для каждого шара.
   */
  advancePhysics(dt){
    const steps=Math.max(1,Math.ceil(dt/.006));
    for(let step=0;step<steps;step++){
      if(this.state!=='playing')break;
      const subdt=dt/steps;
      this.updateMovingBricks(subdt);
      for(const ball of this.activeBalls()){
        if(this.state!=='playing')break;
        // При взрыве или потере жизни шар мог быть удалён прямо в этом кадре.
        if(ball!==this.ball&&!this.extraBalls.includes(ball))continue;
        this.moveBall(subdt,ball,false);
      }
    }
    if(this.state==='playing')for(const ball of this.activeBalls()){
      if(!ball.held)ball.trail.push({x:ball.x,y:ball.y,life:.2});
      if(ball.trail.length>18)ball.trail.shift();
      for(const particle of ball.trail)particle.life-=dt;
      ball.trail=ball.trail.filter(particle=>particle.life>0);
    }
  }

  /** Обновление босса выполняется только во время игры, не в паузе. */
  updateBoss(dt){
    if(this.state!=='playing'||!this.boss)return;
    const boss=this.boss;
    boss.phaseTime+=dt;
    boss.lock=Math.max(0,boss.lock-dt);
    boss.hitFlash=Math.max(0,boss.hitFlash-dt);
    boss.x+=boss.vx*dt;
    if(boss.x>boss.maxX){
      boss.x=boss.maxX-(boss.x-boss.maxX);
      boss.vx=-Math.abs(boss.vx);
    }else if(boss.x<boss.minX){
      boss.x=boss.minX+(boss.minX-boss.x);
      boss.vx=Math.abs(boss.vx);
    }
    // У двух боссов разные высоты и частоты колебаний.
    const reactor=boss.kind==='reactor';
    boss.y=(reactor?145:153)+(this.reducedMotion?0:
      (reactor?18:14)*Math.sin(boss.phaseTime*(reactor?.95:1.25)));
    boss.shotClock+=dt;
    const interval=reactor?2.9:3.5;
    if(boss.shotClock>=interval){
      boss.shotClock-=interval;
      this.shootBoss(boss);
    }
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
   * Снимает временные усиления по истечении срока.
   * Замедление компенсируется обратным множителем только один раз.
   */
  updateEffectTimers(dt){
    for(const brick of this.bricks)brick.lock=Math.max(0,brick.lock-dt);
    for(const kind of ['pulse','wide','slow','magnet']){
      if(this.timers[kind]<=0)continue;
      const previous=this.timers[kind];
      this.timers[kind]=Math.max(0,previous-dt);
      if(previous>0&&this.timers[kind]===0){
        if(kind==='wide')this.paddle.w=CFG.paddleW;
        if(kind==='slow'){
          for(const ball of this.activeBalls())if(this.ballSpeed(ball)>0)
            this.setBallSpeed(Math.min(CFG.maxSpeed,this.ballSpeed(ball)/.75),ball);
        }
        if(kind==='pulse'){
          for(const ball of this.activeBalls())if(this.ballSpeed(ball)>CFG.maxSpeed*.83)
            this.setBallSpeed(CFG.maxSpeed*.83,ball);
        }
        this.updateUI();
      }
    }
  }
  updateDrops(dt){
    for(let i=this.drops.length-1;i>=0;i--){
      const d=this.drops[i];d.y+=d.vy*dt;d.spin+=dt*4;
      if(d.y>this.paddle.y-8&&d.y<this.paddle.y+this.paddle.h+10&&Math.abs(d.x-this.paddle.x)<this.paddle.w/2+9){
        this.drops.splice(i,1);this.applyDrop(d.type);
      }else if(d.y>CFG.height+15)this.drops.splice(i,1);
    }
  }
  moveBall(dt,b=this.ball,advanceMoving=true){
    if(b.held)return;
    const prevX=b.x,prevY=b.y;
    if(advanceMoving)this.updateMovingBricks(dt);
    b.x+=b.vx*dt;b.y+=b.vy*dt;
    if(b.x-b.r<CFG.left){b.x=CFG.left+b.r;b.vx=Math.abs(b.vx);beep(390,.035,.017)}
    if(b.x+b.r>CFG.right){b.x=CFG.right-b.r;b.vx=-Math.abs(b.vx);beep(390,.035,.017)}
    if(b.y-b.r<CFG.top){b.y=CFG.top+b.r;b.vy=Math.abs(b.vy);beep(390,.035,.017)}
    if(b.y-b.r>CFG.bottom){
      if(this.shieldCharges>0){
        this.shieldCharges=0;this.runStats.barriers++;this.resetCombo();
        b.y=this.paddle.y-b.r-4;b.vy=-Math.max(80,Math.abs(b.vy));
        this.flash=.25;this.addParticles(b.x,CFG.bottom-12,18,'#87ffcf');
        beep(720,.12,.04);this.updateUI();
      }else{this.removeBall(b);return}
    }
    if(b.vy>0&&b.y+b.r>=this.paddle.y&&prevY+b.r<=this.paddle.y+5&&Math.abs(b.x-this.paddle.x)<=this.paddle.w/2+b.r){
      b.y=this.paddle.y-b.r-1;
      const relative=clamp((b.x-this.paddle.x)/(this.paddle.w/2),-.94,.94),
        speed=clamp(this.ballSpeed(b)*1.017,this.levelSpeed(),CFG.maxSpeed);
      if(this.timers.magnet>0&&this.timers.pulse<=0){
        b.held=true;b.holdTime=1.2;
        b.holdOffset=clamp(b.x-this.paddle.x,-this.paddle.w/2+12,this.paddle.w/2-12);
        b.vx=0;b.vy=0;this.resetCombo();this.updateUI();
        beep(600,.09,.03,'sine');return;
      }
      let angle=relative*1.11;
      // Центральное попадание не должно создавать бесконечную вертикальную траекторию.
      if(Math.abs(angle)<.12)angle=(b.vx<0?-1:1)*.12;
      b.vx=speed*Math.sin(angle);b.vy=-Math.abs(speed*Math.cos(angle));
      this.resetCombo();
      beep(275+Math.abs(relative)*180,.055,.023);
    }
    for(let i=this.bricks.length-1;i>=0;i--){
      // Взрыв может удалить сразу несколько соседних блоков во время обхода.
      // Массив может сократиться более чем на одну позицию, поэтому
      // каждый индекс проверяем, особенно при пробивном мультишаре.
      const brick=this.bricks[i];
      if(!brick)continue;
      if(brick.lock>0)continue;
      const closeX=clamp(b.x,brick.x,brick.x+brick.w),closeY=clamp(b.y,brick.y,brick.y+brick.h);
      if((b.x-closeX)**2+(b.y-closeY)**2>b.r**2)continue;
      const sided=brick.type==='directional';
      const permitted=!sided||this.collisionSide(brick,prevX,prevY,b)===brick.face;
      const pierced=this.timers.pulse>0;
      if(permitted){
        if(this.hitBrick(brick,i)&&!pierced){
          this.reflectBallFromRect(brick,prevX,prevY,b);
          break;
        }
      }else{
        this.reflectBallFromRect(brick,prevX,prevY,b);
        if(!this.reducedMotion)this.addWave(b.x,b.y,'#9effdd',15,.12,1.3);
        break;
      }
      if(this.state!=='playing')break;
    }
    if(this.boss?.kind==='reactor'&&this.state==='playing')
      this.reactorCollision(b,prevX,prevY);
    if(this.boss?.kind==='guardian'&&this.state==='playing'){
      const guardian=this.boss;
      const closeX=clamp(b.x,guardian.x,guardian.x+guardian.w);
      const closeY=clamp(b.y,guardian.y,guardian.y+guardian.h);
      if((b.x-closeX)**2+(b.y-closeY)**2<=b.r*b.r){
        const vulnerable=this.guardianVulnerable();
        if(guardian.lock<=0&&vulnerable&&prevY-b.r>=guardian.y+guardian.h-2&&b.vy<0)this.damageGuardian();
        // Защищённый босс отражает шар; пробивание действует только в уязвимой фазе.
        if(this.state==='playing'&&(!vulnerable||prevY-b.r<guardian.y+guardian.h-2||b.vy>=0||this.timers.pulse<=0))
          this.reflectBallFromRect(guardian,prevX,prevY,b);
      }
    }
    if(this.state==='playing')this.stabilizeBallAngle(b);
  }
  reflectBallFromRect(rect,prevX,prevY,b=this.ball){
    const fromTop=prevY+b.r<=rect.y;
    const fromBottom=prevY-b.r>=rect.y+rect.h;
    const fromLeft=prevX+b.r<=rect.x;
    const fromRight=prevX-b.r>=rect.x+rect.w;
    const dx=Math.min(b.x+b.r-rect.x,rect.x+rect.w-b.x+b.r);
    const dy=Math.min(b.y+b.r-rect.y,rect.y+rect.h-b.y+b.r);
    if((fromLeft||fromRight)&&(!fromTop&&!fromBottom||dx<dy)){
      if(fromLeft){b.x=rect.x-b.r-1;b.vx=-Math.abs(b.vx)}
      else{b.x=rect.x+rect.w+b.r+1;b.vx=Math.abs(b.vx)}
    }else if(fromTop){b.y=rect.y-b.r-1;b.vy=-Math.abs(b.vy)}
    else if(fromBottom){b.y=rect.y+rect.h+b.r+1;b.vy=Math.abs(b.vy)}
    else if(dx<dy){
      if(b.x<rect.x+rect.w/2){b.x=rect.x-b.r-1;b.vx=-Math.abs(b.vx)}
      else{b.x=rect.x+rect.w+b.r+1;b.vx=Math.abs(b.vx)}
    }else{
      if(b.y<rect.y+rect.h/2){b.y=rect.y-b.r-1;b.vy=-Math.abs(b.vy)}
      else{b.y=rect.y+rect.h+b.r+1;b.vy=Math.abs(b.vy)}
    }
  }
  statsSummary(){
    return 'Время: '+Math.floor(this.runStats.seconds)+' с · Попадания: '+this.runStats.hits+
      ' · Разрушено: '+this.runStats.broken+' · Импульсы: '+this.runStats.pulses+
      ' · Лучшая серия: '+this.runStats.maxCombo+' · Спасения: '+this.runStats.barriers+
      ' · Разделений: '+this.runStats.splits;
  }
  overlayContent(kind){
    const checkpoint=this.checkpoint&&['intro','lost'].includes(kind)?this.checkpoint:null;
    const resumeLabel=checkpoint?'ПРОДОЛЖИТЬ · СЕКТОР '+String(checkpoint.sector+1).padStart(2,'0'):null;
    const common={
      intro:{icon:'✦',kicker:'НОВАЯ АРКАДА',title:'ИМПУЛЬС',text:'Пять секторов, мультишар и новые испытания. В третьем секторе Страж ядра, в пятом — Реактор.',action:resumeLabel||'НАЧАТЬ ИГРУ',small:checkpoint?'Сохранено на этом устройстве в начале сектора '+(checkpoint.sector+1)+'.':'На телефоне двигай платформу пальцем по полю. На ПК — мышь или стрелки.'},
      pause:{icon:'Ⅱ',kicker:'ИГРА ПРИОСТАНОВЛЕНА',title:'ПАУЗА',text:'Шар ждёт твоего возвращения.',action:'ПРОДОЛЖИТЬ',small:'Клавиша P — пауза / продолжить.'},
      between:{icon:'✧',kicker:'СЕКТОР ОЧИЩЕН',title:'ОТЛИЧНАЯ РАБОТА',text:`Следующий сектор: ${LEVELS[this.level+1]?.name ?? 'ФИНАЛ'}. Бонус за жизни: +${this.lastSectorBonus}. Лучшая серия: ${this.lastSectorBestCombo}. Жизни и счёт сохраняются.`,action:'СЛЕДУЮЩИЙ СЕКТОР',small:'Впереди более прочные блоки.'},
      won:{icon:'★',kicker:'МИССИЯ ВЫПОЛНЕНА',title:'ПЯТЬ СЕКТОРОВ И ДВА БОССА ПРОЙДЕНЫ',text:`Финальный счёт: ${this.score.toLocaleString('ru-RU')}. Бонус финального сектора: +${this.lastSectorBonus}. Твой рекорд: ${this.best.toLocaleString('ru-RU')}.`,action:'СЫГРАТЬ СНОВА',small:this.statsSummary()},
      lost:{icon:'✕',kicker:'ПОПЫТКА ЗАВЕРШЕНА',title:'ИГРА ОКОНЧЕНА',text:`Ты набрал ${this.score.toLocaleString('ru-RU')} очков. Попробуй ещё раз!`,action:resumeLabel||'НОВАЯ ПОПЫТКА',small:checkpoint?'Сохранена контрольная точка перед сектором '+(checkpoint.sector+1)+'.':this.statsSummary()}
    }[kind];
    return `<div class="overlay-icon" aria-hidden="true">${common.icon}</div><div class="overlay-kicker">${common.kicker}</div><h2>${common.title}</h2><p>${common.text}</p><button type="button" class="overlay-action" id="overlayAction">${common.action}</button>${checkpoint?'<button type="button" class="overlay-action overlay-new-game" id="newGameAction">НОВАЯ ИГРА</button>':''}<div class="overlay-small">${common.small}</div>`;
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
    ui.stage.textContent=`СЕКТОР ${String(this.level+1).padStart(2,'0')} / ${String(LEVELS.length).padStart(2,'0')}`;
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

const game=new Game();
const pointerToX=e=>{
  const rect=canvas.getBoundingClientRect();
  if(rect.width===0)return;
  const desired=(e.clientX-rect.left)*(CFG.width/rect.width);
  game.targetX=clamp(game.paddle.x+(desired-game.paddle.x)*game.settings.sensitivity/100,
    CFG.left+game.paddle.w/2,CFG.right-game.paddle.w/2);
};
canvas.addEventListener('pointerdown',e=>{
  if(game.settingsOpen||game.activePointerId!==null)return; // Игнорируем другие пальцы и касания при открытых настройках.
  if(e.pointerType==='touch'&&e.cancelable)e.preventDefault();
  game.activePointerId=e.pointerId;
  pointerToX(e);
  try{canvas.setPointerCapture(e.pointerId)}catch(_){}
  if(game.state==='ready'||(game.state==='playing'&&game.activeBalls().some(b=>b.held)))game.launch();
});
canvas.addEventListener('pointermove',e=>{
  if(!game.settingsOpen&&(e.pointerId===game.activePointerId || (e.pointerType==='mouse'&&game.activePointerId===null)))pointerToX(e);
});
const releasePointer=e=>{if(e.pointerId===game.activePointerId)game.activePointerId=null};
canvas.addEventListener('pointerup',releasePointer);
canvas.addEventListener('pointercancel',releasePointer);
canvas.addEventListener('lostpointercapture',releasePointer);
ui.launch.addEventListener('click',()=>game.launch());
ui.pulse.addEventListener('click',()=>game.pulse());
ui.pause.addEventListener('click',()=>game.togglePause());
ui.sound.addEventListener('click',()=>{
  game.setSetting('sound',!game.settings.sound);
  if(soundEnabled)beep(650,.07);
});
ui.settingsButton.addEventListener('click',()=>game.toggleSettings());
ui.settingsClose.addEventListener('click',()=>game.toggleSettings(false));
ui.settingsDone.addEventListener('click',()=>game.toggleSettings(false));
ui.volume.addEventListener('input',()=>game.setSetting('volume',ui.volume.value));
ui.effects.addEventListener('change',()=>game.setSetting('effects',ui.effects.value));
ui.sensitivity.addEventListener('input',()=>game.setSetting('sensitivity',ui.sensitivity.value));
window.addEventListener('keydown',e=>{
  // Не перехватываем стрелки и пробел у ползунков в панели настроек:
  // браузер должен самостоятельно обрабатывать управление доступными полями.
  if(game.settingsOpen){
    if(e.code==='Escape'){game.toggleSettings(false);e.preventDefault()}
    return;
  }
  if(['ArrowLeft','ArrowRight','Space','KeyA','KeyD','KeyF','KeyP','Escape','Enter'].includes(e.code))e.preventDefault();
  game.keys[e.code]=true;
  if(e.repeat)return;
  if(e.code==='Space'||e.code==='Enter')game.launch();
  if(e.code==='KeyF')game.pulse();
  if(e.code==='KeyP'||e.code==='Escape')game.togglePause();
});
window.addEventListener('keyup',e=>{game.keys[e.code]=false});
window.addEventListener('blur',()=>{game.keys={};game.activePointerId=null;if(game.state==='playing')game.togglePause()});
document.addEventListener('visibilitychange',()=>{if(document.hidden){game.keys={};game.activePointerId=null;if(game.state==='playing')game.togglePause()}});
let last=performance.now();
function loop(now){
  const frameMs=Math.max(0,now-last);last=now;
  const dt=Math.min(.033,frameMs/1000);
  // Замеры времени обновления и отрисовки выполняются только при ?fps=1.
  const profile=game.profileEnabled;
  const begin=profile?performance.now():0;
  game.update(dt);
  const updated=profile?performance.now():0;
  game.draw();
  const drawn=profile?performance.now():0;
  const m=game.performance;
  if(frameMs>500){
    m.frames=0;m.seconds=0;m.worst=0;m.updateTotalMs=0;m.drawTotalMs=0;
  }else{
    m.frames++;m.seconds+=frameMs/1000;m.worst=Math.max(m.worst,frameMs);
    if(profile){m.updateTotalMs+=updated-begin;m.drawTotalMs+=drawn-updated;}
    if(m.seconds>=1){
      m.fps=Math.round(m.frames/m.seconds);
      m.maxFrameMs=Math.round(m.worst);
      if(profile){
        m.avgUpdateMs=Math.round(100*m.updateTotalMs/m.frames)/100;
        m.avgDrawMs=Math.round(100*m.drawTotalMs/m.frames)/100;
      }
      m.frames=0;m.seconds=0;m.worst=0;m.updateTotalMs=0;m.drawTotalMs=0;
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// Открываем только диагностический снимок состояния для smoke-тестов, без возможности читерства.
window.__impulseDebug=()=>({state:game.state,score:game.score,level:game.level,lives:game.lives,bricks:game.bricks.length,energy:game.energy,combo:game.comboHits,fps:game.performance.fps,maxFrameMs:game.performance.maxFrameMs,avgUpdateMs:game.performance.avgUpdateMs,avgDrawMs:game.performance.avgDrawMs,spritePaintCount:game.spritePaintCount,shots:game.enemyShots.length,balls:game.activeBalls().length,held:game.activeBalls().filter(b=>b.held).length,moving:game.bricks.filter(b=>b.type==='moving').length,phase:game.sectorPhase,checkpointSector:game.checkpoint?.sector??null,settings:{...game.settings},bossHP:game.boss?.hp??0,shield:game.shieldCharges,particles:game.particles.length,waves:game.waves.length,stats:{...game.runStats}});
