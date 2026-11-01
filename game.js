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
  storageKey: 'impulse-arcade:best:v1'
});

const LEVELS = [
  {name:'ПЕРВЫЙ КОНТАКТ', speedScale:1, dropChance:.17, rows:['111111','111111','11CC11','1....1','..11..']},
  {name:'НЕОНОВЫЙ ДОЖДЬ',speedScale:1.06,dropChance:.18,rows:['212212','121X21','11CC11','121121','.1111.','..22..']},
  {name:'ЯДРО СТАНЦИИ', speedScale:1.12, dropChance:.19, rows:['222222','2C1XC2','211112','22CC22','121121','1X..11','1....1']}
];

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', {alpha:false});
const ui = {
  score:document.getElementById('score'), best:document.getElementById('best'), lives:document.getElementById('lives'),
  stage:document.getElementById('stageLabel'), compactSector:document.getElementById('compactSector'), overlay:document.getElementById('overlay'),
  charge:document.getElementById('chargeFill'), chargeText:document.getElementById('chargeText'), chargeBar:document.getElementById('chargeBar'),
  hint:document.getElementById('hint'), launch:document.getElementById('launchBtn'),launchLabel:document.getElementById('launchLabel'),
  pulse:document.getElementById('pulseBtn'),pulseLabel:document.getElementById('pulseLabel'),
  pause:document.getElementById('pauseBtn'),sound:document.getElementById('soundBtn')
};

let audioContext = null;
let soundEnabled = false;
let lastBeepAt=-Infinity;
function beep(frequency, duration=.06, volume=.035, type='sine') {
  if (!soundEnabled) return;
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
    // Avoid bursts of overlapping oscillators on mobile after rapid collisions.
    const now=audioContext.currentTime;
    if(now-lastBeepAt<.05)return;
    lastBeepAt=now;
    const osc=audioContext.createOscillator(), gain=audioContext.createGain();
    osc.type=type;osc.frequency.setValueAtTime(frequency,audioContext.currentTime);
    gain.gain.setValueAtTime(volume,audioContext.currentTime);
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
// Cached 480×720 layers: expensive shadows/gradients are only repainted when needed.
function createLayer(width=CFG.width,height=CFG.height){
  if(typeof document.createElement!=='function')return null;
  const layer=document.createElement('canvas');layer.width=width;layer.height=height;
  const target=layer.getContext('2d');
  return target?{canvas:layer,ctx:target}:null;
}
function safeLoadBest(){try{return Math.max(0,Number(localStorage.getItem(CFG.storageKey))||0)}catch(_){return 0}}
function safeSaveBest(value){try{localStorage.setItem(CFG.storageKey,String(value))}catch(_){/* file:/// or restricted storage */}}

class Game {
  constructor(){
    this.frame=0;this.state='menu';this.score=0;this.best=safeLoadBest();this.lives=3;this.level=0;
    this.energy=0;this.bricks=[];this.drops=[];this.particles=[];this.keys={};this.activePointerId=null;
    this.paddle={x:CFG.width/2,w:CFG.paddleW,y:CFG.paddleY,h:CFG.paddleH};this.targetX=this.paddle.x;
    this.ball={x:CFG.width/2,y:CFG.paddleY-14,vx:0,vy:0,r:CFG.ballRadius,trail:[]};
    this.timers={pulse:0,wide:0,slow:0};this.time=0;this.flash=0;this.shieldCharges=0;
    this.runStats={seconds:0,hits:0,broken:0,pulses:0,maxCombo:0,barriers:0};
    this.comboHits=0;this.comboUntil=0;this.bestComboInSector=0;
    this.lastSectorBonus=0;this.lastSectorBestCombo=0;
    this.stars=Array.from({length:68},(_,i)=>({x:(i*137.37)%CFG.width,y:(i*231.59)%CFG.height,r:i%7===0?1.6:.8,s:(i%4)*.16+.18}));
    this.backdropLayer=createLayer();this.brickLayer=createLayer();this.bricksDirty=true;this.brickPaintCount=0;
    // A few tiny, transparent sprites replace gradients/shadows rebuilt every frame.
    this.spritePaintCount=0;
    this.sprites={
      paddleNormal:this.makePaddleSprite(CFG.paddleW,false),
      paddleWide:this.makePaddleSprite(145,true),
      ballNormal:this.makeBallSprite(false),
      ballPulse:this.makeBallSprite(true)
    };
    this.profileEnabled=Boolean(window.location && /(?:\?|&)fps=1(?:&|$)/.test(window.location.search||''));
    this.performance={fps:0,maxFrameMs:0,avgUpdateMs:0,avgDrawMs:0,
      frames:0,seconds:0,worst:0,updateTotalMs:0,drawTotalMs:0};
    if(this.backdropLayer)this.drawBackdrop(this.backdropLayer.ctx);
    this.draw();this.showOverlay('intro');this.updateUI();
  }
  setState(state){this.state=state;this.updateUI()}
  resetCombo(){this.comboHits=0;this.comboUntil=0}
  comboMultiplier(){return Math.min(4,1+Math.floor(Math.max(0,this.comboHits-1)/3))}
  registerHit(){
    if(this.time>this.comboUntil)this.resetCombo();
    this.comboHits++;this.comboUntil=this.time+CFG.comboWindow;
    this.bestComboInSector=Math.max(this.bestComboInSector,this.comboHits);
    this.runStats.maxCombo=Math.max(this.runStats.maxCombo,this.comboHits);
    return this.comboMultiplier();
  }
  // Enforce a minimum vertical component at extreme angles without changing speed.
  stabilizeBallAngle(){
    const b=this.ball,speed=this.ballSpeed(),minY=speed*.20;
    if(speed<1 || Math.abs(b.vy)>=minY)return;
    const directionY=b.vy<0?-1:1,directionX=b.vx<0?-1:1;
    b.vy=directionY*minY;b.vx=directionX*Math.sqrt(speed*speed-minY*minY);
  }
  resetBall(){
    this.ball={x:this.paddle.x,y:this.paddle.y-17,vx:0,vy:0,r:CFG.ballRadius,trail:[]};
    this.timers.pulse=0;this.timers.slow=0;
  }
  makeBricks(){
    const rows=LEVELS[this.level].rows;
    this.bricks=[];
    for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){
      const code=rows[r][c];if(code==='.')continue;
      this.bricks.push({x:CFG.brickStartX+c*(CFG.brickW+CFG.brickGapX),y:CFG.brickStartY+r*(CFG.brickH+CFG.brickGapY),w:CFG.brickW,h:CFG.brickH,
        hp:code==='2'?2:1,maxHp:code==='2'?2:1,type:code==='C'?'core':code==='2'?'armor':code==='X'?'blast':'normal',row:r,col:c,lock:0});
    }
    this.bricksDirty=true;
  }
  startNewGame(){
    this.score=0;this.lives=3;this.energy=0;this.level=0;this.timers={pulse:0,wide:0,slow:0};
    this.resetCombo();this.bestComboInSector=0;this.lastSectorBonus=0;this.lastSectorBestCombo=0;
    this.runStats={seconds:0,hits:0,broken:0,pulses:0,maxCombo:0,barriers:0};this.shieldCharges=0;
    this.paddle.w=CFG.paddleW;this.paddle.x=CFG.width/2;this.targetX=this.paddle.x;
    this.drops=[];this.particles=[];this.startLevel();
  }
  startLevel(){
    this.makeBricks();this.drops=[];this.paddle.w=CFG.paddleW;this.timers.wide=0;this.shieldCharges=0;
    this.resetCombo();this.bestComboInSector=0;
    this.resetBall();this.setState('ready');this.hideOverlay();this.flash=0;this.updateUI();
  }
  launch(){
    if(this.state==='menu' || this.state==='lost' || this.state==='won'){this.startNewGame();return}
    if(this.state==='between'){this.level++;this.startLevel();return}
    if(this.state==='paused'){this.resume();return}
    if(this.state!=='ready')return;
    const speed=this.levelSpeed();
    this.ball.vx=random(-110,110);
    this.ball.vy=-Math.sqrt(speed**2-this.ball.vx**2);
    this.setState('playing');this.hideOverlay();beep(430,.09);
  }
  togglePause(){
    if(this.state==='paused'){this.resume();return}
    if(this.state==='playing'||this.state==='ready'){
      this.savedState=this.state;this.setState('paused');this.showOverlay('pause');
    }
  }
  resume(){if(this.state!=='paused')return;this.setState(this.savedState||'ready');this.hideOverlay()}
  pulse(){
    if(this.state!=='playing'||this.energy<100||this.timers.pulse>0)return;
    this.energy=0;this.timers.pulse=CFG.pulseDuration;this.flash=.36;this.runStats.pulses++;
    this.addParticles(this.ball.x,this.ball.y,28,'#ff85d9');
    this.setBallSpeed(clamp(this.ballSpeed()*1.13,this.levelSpeed(),CFG.maxSpeed));
    beep(520,.25,.06,'sawtooth');this.updateUI();
  }
  levelSpeed(){return Math.min(CFG.maxSpeed,CFG.initialSpeed*LEVELS[this.level].speedScale)}
  ballSpeed(){return Math.hypot(this.ball.vx,this.ball.vy)}
  setBallSpeed(speed){const current=this.ballSpeed();if(current<1)return;this.ball.vx*=speed/current;this.ball.vy*=speed/current}
  dropBall(){
    this.lives--;this.resetCombo();this.addParticles(this.ball.x,CFG.bottom-20,22,'#f9a4d2');beep(170,.25,.07,'triangle');
    this.drops=[];this.timers.wide=0;this.paddle.w=CFG.paddleW;this.shieldCharges=0;
    if(this.lives<=0){this.end('lost');return}
    this.resetBall();this.setState('ready');this.updateUI();
  }
  end(kind){
    this.setState(kind);this.updateBest();
    this.showOverlay(kind);beep(kind==='won'?720:180,.25,.04,'triangle');
  }
  completeLevel(){
    this.lastSectorBestCombo=this.bestComboInSector;
    this.lastSectorBonus=100*(this.level+1)*Math.max(0,this.lives);
    this.score+=this.lastSectorBonus;
    this.resetCombo();
    this.updateBest();this.addParticles(CFG.width/2,230,45,'#59efff');
    if(this.level===LEVELS.length-1)this.end('won');
    else {this.setState('between');this.showOverlay('between');beep(740,.19,.06)}
  }
  updateBest(){if(this.score>this.best){this.best=this.score;safeSaveBest(this.best)}}
  hitBrick(brick,index){
    // Resolve the current index: area damage may have removed neighbouring bricks.
    const actualIndex=this.bricks.indexOf(brick);
    if(actualIndex<0||brick.lock>0)return false;
    brick.lock=.11;brick.hp--;this.bricksDirty=true;this.runStats.hits++;
    const multiplier=this.registerHit();
    this.addParticles(this.ball.x,this.ball.y,7,brick.type==='core'?'#ff8bd9':brick.type==='armor'?'#ffe2a3':brick.type==='blast'?'#ffad72':'#69e4ff');
    if(brick.hp<=0){
      this.bricks.splice(actualIndex,1);
      this.runStats.broken++;
      const gain=brick.type==='core'?24:brick.type==='armor'?18:brick.type==='blast'?20:12;
      const points=brick.type==='core'?240:brick.type==='armor'?180:brick.type==='blast'?160:100;
      this.score+=points*(this.level+1)*multiplier;
      this.energy=clamp(this.energy+gain,0,100);
      this.maybeDrop(brick);
      if(brick.type==='blast')this.blastNeighbors(brick);
      beep(brick.type==='core'?620:brick.type==='blast'?740:480,.07,.025,'square');
      this.updateBest();
      if(this.bricks.length===0)this.completeLevel();
    }else{this.score+=35*multiplier;beep(290,.055,.028,'triangle')}
    this.updateUI();return true;
  }
  blastNeighbors(source){
    // A blast removes one HP from orthogonally adjacent bricks. It never
    // recursively detonates another blast brick or grants extra combo hits.
    for(const target of [...this.bricks]){
      if(Math.abs(target.row-source.row)+Math.abs(target.col-source.col)!==1)continue;
      const index=this.bricks.indexOf(target);
      if(index<0)continue;
      target.hp=Math.max(0,target.hp-1);
      target.lock=0;this.bricksDirty=true;
      this.addParticles(target.x+target.w/2,target.y+target.h/2,5,'#ffb775');
      if(target.hp===0){
        this.bricks.splice(index,1);this.runStats.broken++;
        this.score+=60*(this.level+1);this.energy=clamp(this.energy+6,0,100);
      }
    }
    this.flash=Math.max(this.flash,.16);
    this.addParticles(source.x+source.w/2,source.y+source.h/2,20,'#ffb775');
  }
  maybeDrop(brick){
    if(Math.random()>LEVELS[this.level].dropChance)return;
    const t=Math.random(),type=t<.43?'wide':t<.79?'slow':t<.95?'shield':'life';
    this.drops.push({x:brick.x+brick.w/2,y:brick.y+brick.h/2,vy:115,type,spin:0});
  }
  applyDrop(type){
    if(type==='wide'){this.timers.wide=CFG.wideDuration;this.paddle.w=145}
    if(type==='slow'){
      if(this.timers.slow<=0&&this.ballSpeed()>0)this.setBallSpeed(Math.max(195,this.ballSpeed()*.75));
      this.timers.slow=CFG.slowDuration;
    }
    if(type==='life')this.lives=Math.min(5,this.lives+1);
    if(type==='shield')this.shieldCharges=1;
    this.score+=75;this.updateBest();this.addParticles(this.paddle.x,this.paddle.y,12,'#ffc477');beep(850,.13,.05);
    this.updateUI();
  }
  addParticles(x,y,n,color){
    // Keep short visual bursts bounded, even during rapid multi-brick hits.
    const max=180, count=Math.min(n,max);
    if(this.particles.length+count>max)this.particles.splice(0,this.particles.length+count-max);
    for(let i=0;i<count;i++)this.particles.push({x,y,vx:random(-170,170),vy:random(-180,160),life:random(.3,.75),maxLife:.75,color,r:random(1.1,3.4)});
  }
  update(dt){
    // A pause freezes both simulation and particles; only resumed play advances time.
    if(this.state==='paused')return;
    this.time+=dt;this.frame++;
    if(this.state==='playing')this.runStats.seconds+=dt;
    if(this.comboHits>0&&this.time>this.comboUntil)this.resetCombo();
    if(this.flash>0)this.flash=Math.max(0,this.flash-dt);
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=125*dt;p.life-=dt;if(p.life<=0)this.particles.splice(i,1)}
    if(this.state!=='ready'&&this.state!=='playing')return;
    const move=(this.keys.ArrowRight||this.keys.KeyD?1:0)-(this.keys.ArrowLeft||this.keys.KeyA?1:0);
    if(move!==0)this.targetX+=move*CFG.paddleSpeed*dt;
    this.targetX=clamp(this.targetX,CFG.left+this.paddle.w/2,CFG.right-this.paddle.w/2);
    this.paddle.x+=(this.targetX-this.paddle.x)*Math.min(1,dt*23);
    if(this.state==='ready'){
      this.ball.x=this.paddle.x;this.ball.y=this.paddle.y-17;
      return;
    }
    for(const b of this.bricks)b.lock=Math.max(0,b.lock-dt);
    for(const kind of ['pulse','wide','slow']){
      if(this.timers[kind]<=0)continue;
      const old=this.timers[kind];this.timers[kind]=Math.max(0,old-dt);
      if(old>0&&this.timers[kind]===0){
        if(kind==='wide')this.paddle.w=CFG.paddleW;
        if(kind==='slow'&&this.ballSpeed()>0)this.setBallSpeed(Math.min(CFG.maxSpeed,this.ballSpeed()/0.75));
        if(kind==='pulse'&&this.ballSpeed()>CFG.maxSpeed*.83)this.setBallSpeed(CFG.maxSpeed*.83);
        this.updateUI();
      }
    }
    this.updateDrops(dt);
    const steps=Math.max(1,Math.ceil(dt/.006));
    for(let step=0;step<steps;step++){
      if(this.state!=='playing')break;
      this.moveBall(dt/steps);
    }
    if(this.state==='playing'){
      this.ball.trail.push({x:this.ball.x,y:this.ball.y,life:.2});
      if(this.ball.trail.length>18)this.ball.trail.shift();
      for(const p of this.ball.trail)p.life-=dt;
      this.ball.trail=this.ball.trail.filter(p=>p.life>0);
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
  moveBall(dt){
    const b=this.ball,prevX=b.x,prevY=b.y;
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
      }else{this.dropBall();return}
    }
    if(b.vy>0&&b.y+b.r>=this.paddle.y&&prevY+b.r<=this.paddle.y+5&&Math.abs(b.x-this.paddle.x)<=this.paddle.w/2+b.r){
      b.y=this.paddle.y-b.r-1;
      const relative=clamp((b.x-this.paddle.x)/(this.paddle.w/2),-.94,.94),speed=clamp(this.ballSpeed()*1.017,this.levelSpeed(),CFG.maxSpeed);
      let angle=relative*1.11;
      // Centre hits should not lock the ball into a vertical loop.
      if(Math.abs(angle)<.12)angle=(b.vx<0?-1:1)*.12;
      b.vx=speed*Math.sin(angle);b.vy=-Math.abs(speed*Math.cos(angle));
      this.resetCombo();
      beep(275+Math.abs(relative)*180,.055,.023);
    }
    for(let i=this.bricks.length-1;i>=0;i--){
      const brick=this.bricks[i];if(brick.lock>0)continue;
      const closeX=clamp(b.x,brick.x,brick.x+brick.w),closeY=clamp(b.y,brick.y,brick.y+brick.h);
      if((b.x-closeX)**2+(b.y-closeY)**2>b.r**2)continue;
      const pierced=this.timers.pulse>0;
      if(this.hitBrick(brick,i)&&!pierced){
        const fromTop=prevY+b.r<=brick.y;
        const fromBottom=prevY-b.r>=brick.y+brick.h;
        const fromLeft=prevX+b.r<=brick.x;
        const fromRight=prevX-b.r>=brick.x+brick.w;
        // Use the previous ball edge, not the centre, to resolve brick sides.
        const dx=Math.min(b.x+b.r-brick.x,brick.x+brick.w-b.x+b.r);
        const dy=Math.min(b.y+b.r-brick.y,brick.y+brick.h-b.y+b.r);
        if((fromLeft||fromRight)&&(!fromTop&&!fromBottom||dx<dy)){
          if(fromLeft){b.x=brick.x-b.r-1;b.vx=-Math.abs(b.vx)}
          else{b.x=brick.x+brick.w+b.r+1;b.vx=Math.abs(b.vx)}
        }else if(fromTop){b.y=brick.y-b.r-1;b.vy=-Math.abs(b.vy)}
        else if(fromBottom){b.y=brick.y+brick.h+b.r+1;b.vy=Math.abs(b.vy)}
        else if(dx<dy){
          if(b.x<brick.x+brick.w/2){b.x=brick.x-b.r-1;b.vx=-Math.abs(b.vx)}
          else{b.x=brick.x+brick.w+b.r+1;b.vx=Math.abs(b.vx)}
        }else{
          if(b.y<brick.y+brick.h/2){b.y=brick.y-b.r-1;b.vy=-Math.abs(b.vy)}
          else{b.y=brick.y+brick.h+b.r+1;b.vy=Math.abs(b.vy)}
        }
        break;
      }
      if(this.state!=='playing')break;
    }
    if(this.state==='playing')this.stabilizeBallAngle();
  }
  statsSummary(){
    return 'Время: '+Math.floor(this.runStats.seconds)+' с · Попадания: '+this.runStats.hits+
      ' · Разрушено: '+this.runStats.broken+' · Импульсы: '+this.runStats.pulses+
      ' · Лучшая серия: '+this.runStats.maxCombo+' · Спасения: '+this.runStats.barriers;
  }
  overlayContent(kind){
    const common={
      intro:{icon:'✦',kicker:'НОВАЯ АРКАДА',title:'ИМПУЛЬС',text:'Разрушай блоки, собирай усиления и заряжай пробивной импульс. Три сектора ждут тебя.',action:'НАЧАТЬ ИГРУ',small:'На телефоне двигай платформу пальцем по полю. На ПК — мышь или стрелки.'},
      pause:{icon:'Ⅱ',kicker:'ИГРА ПРИОСТАНОВЛЕНА',title:'ПАУЗА',text:'Шар ждёт твоего возвращения.',action:'ПРОДОЛЖИТЬ',small:'Клавиша P — пауза / продолжить.'},
      between:{icon:'✧',kicker:'СЕКТОР ОЧИЩЕН',title:'ОТЛИЧНАЯ РАБОТА',text:`Следующий сектор: ${LEVELS[this.level+1]?.name ?? 'ФИНАЛ'}. Бонус за жизни: +${this.lastSectorBonus}. Лучшая серия: ${this.lastSectorBestCombo}. Жизни и счёт сохраняются.`,action:'СЛЕДУЮЩИЙ СЕКТОР',small:'Впереди более прочные блоки.'},
      won:{icon:'★',kicker:'МИССИЯ ВЫПОЛНЕНА',title:'ТРИ СЕКТОРА ПРОЙДЕНЫ',text:`Финальный счёт: ${this.score.toLocaleString('ru-RU')}. Бонус финального сектора: +${this.lastSectorBonus}. Твой рекорд: ${this.best.toLocaleString('ru-RU')}.`,action:'СЫГРАТЬ СНОВА',small:this.statsSummary()},
      lost:{icon:'✕',kicker:'ПОПЫТКА ЗАВЕРШЕНА',title:'ИГРА ОКОНЧЕНА',text:`Ты набрал ${this.score.toLocaleString('ru-RU')} очков. Попробуй ещё раз!`,action:'НОВАЯ ПОПЫТКА',small:this.statsSummary()}
    }[kind];
    return `<div class="overlay-icon" aria-hidden="true">${common.icon}</div><div class="overlay-kicker">${common.kicker}</div><h2>${common.title}</h2><p>${common.text}</p><button type="button" class="overlay-action" id="overlayAction">${common.action}</button><div class="overlay-small">${common.small}</div>`;
  }
  showOverlay(kind){ui.overlay.innerHTML=this.overlayContent(kind);ui.overlay.hidden=false;ui.overlay.querySelector('#overlayAction').addEventListener('click',()=>this.launch(),{once:true})}
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
    ui.launchLabel.textContent=labels[this.state];ui.launch.disabled=this.state==='playing';
    ui.pause.disabled=!['ready','playing','paused'].includes(this.state);
    ui.pause.textContent=this.state==='paused'?'▶':'Ⅱ';
    ui.hint.textContent=this.timers.pulse>0?'Пробивной импульс активен: шар проходит сквозь блоки.':this.energy>=100?'Заряд готов! Нажми «ИМПУЛЬС» или F.':this.state==='ready'?'Нажми «Запуск шара» или коснись игрового поля.':'Разбивай блоки, чтобы зарядить пробивной импульс.';
  }

  draw(){
    const w=CFG.width,h=CFG.height;
    if(this.backdropLayer)ctx.drawImage(this.backdropLayer.canvas,0,0);
    else this.drawBackdrop(ctx);
    for(const star of this.stars){
      ctx.globalAlpha=.23+Math.sin(this.time*star.s*3+star.x)*.16;
      ctx.fillStyle='#bdefff';ctx.fillRect(star.x,star.y,star.r,star.r);
    }
    ctx.globalAlpha=1;
    if(this.brickLayer){
      if(this.bricksDirty){
        this.brickLayer.ctx.clearRect(0,0,w,h);
        this.drawBricks(this.brickLayer.ctx);
        this.bricksDirty=false;
      }
      ctx.drawImage(this.brickLayer.canvas,0,0);
    }else{
      this.drawBricks(ctx);
      this.bricksDirty=false;
    }
    this.drawDrops();this.drawParticles();this.drawShield();this.drawPaddle();this.drawBall();this.drawGameplayStatus();
    if(this.flash>0){ctx.fillStyle=`rgba(252,114,201,${Math.min(.2,this.flash*.4)})`;ctx.fillRect(0,0,w,h)}
    // Opt-in on-device FPS overlay: ?fps=1 (no clutter during normal play).
    if(this.profileEnabled){
      const m=this.performance;
      ctx.fillStyle='#081327eb';ctx.fillRect(CFG.left+8,CFG.height-110,198,44);
      ctx.fillStyle='#c7edff';ctx.font='12px system-ui';ctx.textAlign='left';
      ctx.fillText(`FPS: ${m.fps}  max: ${m.maxFrameMs}ms`,CFG.left+13,CFG.height-94);
      ctx.fillText(`Логика: ${m.avgUpdateMs}мс  Графика: ${m.avgDrawMs}мс`,CFG.left+13,CFG.height-76);
    }
  }
  drawGameplayStatus(){
    if(!['playing','ready','paused'].includes(this.state))return;
    ctx.textAlign='left';ctx.font='bold 12px system-ui';
    if(this.comboHits>=2){
      ctx.fillStyle='#ffcf80';
      ctx.fillText(`СЕРИЯ ${this.comboHits}  ×${this.comboMultiplier()}`,CFG.left+9,77);
    }
    const effects=[];
    if(this.timers.wide>0)effects.push(`ПЛАТФОРМА ${Math.ceil(this.timers.wide)}с`);
    if(this.timers.slow>0)effects.push(`ЗАМЕДЛ. ${Math.ceil(this.timers.slow)}с`);
    if(this.timers.pulse>0)effects.push(`ИМПУЛЬС ${Math.ceil(this.timers.pulse)}с`);
    if(this.shieldCharges>0)effects.push('БАРЬЕР ×1');
    if(effects.length){
      ctx.fillStyle='#a4f5ed';ctx.font='11px system-ui';
      ctx.fillText(effects.join(' · '),CFG.left+9,94);
    }
  }
  drawBackdrop(target){
    const w=CFG.width,h=CFG.height;
    const bg=target.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,'#101936');bg.addColorStop(.57,'#10172e');bg.addColorStop(1,'#080e20');
    target.fillStyle=bg;target.fillRect(0,0,w,h);
    const glow=target.createRadialGradient(240,170,25,240,170,300);
    glow.addColorStop(0,'#21517840');glow.addColorStop(1,'#06102400');
    target.fillStyle=glow;target.fillRect(0,0,w,h);
    target.strokeStyle='#73acd30c';target.lineWidth=1;
    for(let x=34;x<w;x+=41){target.beginPath();target.moveTo(x,CFG.top);target.lineTo(x,CFG.bottom);target.stroke()}
    for(let y=64;y<h;y+=42){target.beginPath();target.moveTo(CFG.left,y);target.lineTo(CFG.right,y);target.stroke()}
    target.strokeStyle='#5ca4d73a';target.beginPath();
    target.moveTo(CFG.left,CFG.top);target.lineTo(CFG.left,CFG.bottom);
    target.moveTo(CFG.right,CFG.top);target.lineTo(CFG.right,CFG.bottom);target.stroke();
  }
  drawBricks(target=ctx){
    this.brickPaintCount++;for(const brick of this.bricks){
    let c1,c2,stroke;
    if(brick.type==='core'){c1='#ff7abb';c2='#a541a5';stroke='#ffb7dd'}
    else if(brick.type==='armor'){c1='#e4ba79';c2='#825e6d';stroke='#fff0a5'}
    else if(brick.type==='blast'){c1='#ffc07a';c2='#cc5a5c';stroke='#ffe2ab'}
    else {const colors=[['#6bcdff','#357cb3'],['#72dcf3','#346da1'],['#a28ff6','#575bba'],['#79bdf4','#3d70a7'],['#87eee3','#3b9ea9'],['#d1a3f6','#8559b9'],['#6ccde7','#4588ae']];[c1,c2]=colors[brick.row%colors.length];stroke=c1}
    if(brick.maxHp===2&&brick.hp===1){c1='#927e91';c2='#6b647a'}
    const g=target.createLinearGradient(brick.x,brick.y,brick.x,brick.y+brick.h);g.addColorStop(0,c1);g.addColorStop(1,c2);
    target.shadowColor=c1;target.shadowBlur=brick.type==='core'?15:5;
    roundRect(brick.x,brick.y,brick.w,brick.h,5,g,stroke,target);target.shadowBlur=0;
    target.fillStyle='#ffffff45';target.fillRect(brick.x+7,brick.y+4,brick.w-14,2);
    if(brick.type==='armor'){target.fillStyle='#19213c98';target.font='bold 14px system-ui';target.textAlign='center';target.fillText(brick.hp===2?'◆':'◇',brick.x+brick.w/2,brick.y+18)}
    if(brick.type==='blast'){target.fillStyle='#fff6dd';target.font='bold 17px system-ui';target.textAlign='center';target.fillText('✶',brick.x+brick.w/2,brick.y+18)}
    if(brick.type==='core'){target.fillStyle='#fff2ff';target.beginPath();target.moveTo(brick.x+brick.w/2,brick.y+5);target.lineTo(brick.x+brick.w/2+8,brick.y+brick.h/2);target.lineTo(brick.x+brick.w/2,brick.y+brick.h-5);target.lineTo(brick.x+brick.w/2-8,brick.y+brick.h/2);target.fill()}
  }}
  drawDrops(){for(const d of this.drops){
    const color=d.type==='wide'?'#6bf9bc':d.type==='slow'?'#81c6ff':d.type==='shield'?'#88ffd6':'#ff83a9';
    ctx.shadowColor=color;ctx.shadowBlur=14;roundRect(d.x-13,d.y-13,26,26,8,'#192643',color);ctx.shadowBlur=0;
    ctx.fillStyle=color;ctx.font='bold 17px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(d.type==='wide'?'↔':d.type==='slow'?'◷':d.type==='shield'?'⬡':'♥',d.x,d.y+1);
    ctx.textBaseline='alphabetic';
  }}
  drawShield(){
    if(this.shieldCharges<=0)return;
    ctx.strokeStyle='#88ffd6';ctx.globalAlpha=.8;ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(CFG.left+14,CFG.bottom-14);ctx.lineTo(CFG.right-14,CFG.bottom-14);ctx.stroke();
    ctx.globalAlpha=1;ctx.lineWidth=1;
  }
  drawParticles(){for(const p of this.particles){ctx.globalAlpha=clamp(p.life/.6,0,1);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.r,p.r)}ctx.globalAlpha=1}

  paintPaddle(target,w,wide,left,y){
    target.shadowColor=wide?'#5cf9bf':'#4adff5';target.shadowBlur=19;
    const gradient=target.createLinearGradient(left,y,left,y+CFG.paddleH);
    gradient.addColorStop(0,'#d4faff');
    gradient.addColorStop(.35,'#64dcef');
    gradient.addColorStop(1,'#2475b5');
    roundRect(left,y,w,CFG.paddleH,7,gradient,'#a2f2ff',target);target.shadowBlur=0;
    roundRect(left+w/2-19,y+2,38,3,2,'#ecfaff',null,target);
    target.fillStyle='#64dafa8a';target.fillRect(left+9,y+CFG.paddleH-1,w-18,3);
  }
  makePaddleSprite(width,wide){
    const pad=26,layer=createLayer(width+pad*2,CFG.paddleH+pad*2);
    if(!layer)return null;
    this.paintPaddle(layer.ctx,width,wide,pad,pad);
    this.spritePaintCount++;
    return layer.canvas;
  }
  drawPaddle(){
    const p=this.paddle,wide=this.timers.wide>0;
    const sprite=wide?this.sprites.paddleWide:this.sprites.paddleNormal;
    if(sprite&&p.w===(wide?145:CFG.paddleW)){
      ctx.drawImage(sprite,p.x-p.w/2-26,p.y-26);
    }else{
      // Safe fallback for environments without an offscreen canvas.
      this.paintPaddle(ctx,p.w,wide,p.x-p.w/2,p.y);
    }
  }
  paintBall(target,pulse,x,y,r){
    target.shadowColor=pulse?'#ff65d4':'#b6faff';target.shadowBlur=pulse?28:18;
    const gradient=target.createRadialGradient(x-3,y-3,2,x,y,r+2);
    gradient.addColorStop(0,'#ffffff');
    gradient.addColorStop(.42,pulse?'#ff9be5':'#a6fcff');
    gradient.addColorStop(1,pulse?'#ad4ec6':'#248ca9');
    target.fillStyle=gradient;target.beginPath();target.arc(x,y,r,0,Math.PI*2);target.fill();
    target.shadowBlur=0;
  }
  makeBallSprite(pulse){
    const pad=36,size=CFG.ballRadius*2+pad*2,layer=createLayer(size,size);
    if(!layer)return null;
    this.paintBall(layer.ctx,pulse,pad+CFG.ballRadius,pad+CFG.ballRadius,CFG.ballRadius);
    this.spritePaintCount++;
    return layer.canvas;
  }
  drawBall(){
    const b=this.ball,pulse=this.timers.pulse>0;
    for(const t of b.trail){
      ctx.globalAlpha=t.life/.2*.23;
      ctx.fillStyle=pulse?'#ff71d5':'#67e9ff';
      ctx.beginPath();ctx.arc(t.x,t.y,b.r*(t.life/.2+.3),0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    const sprite=pulse?this.sprites.ballPulse:this.sprites.ballNormal;
    if(sprite&&b.r===CFG.ballRadius){
      ctx.drawImage(sprite,b.x-b.r-36,b.y-b.r-36);
    }else{
      this.paintBall(ctx,pulse,b.x,b.y,b.r);
    }
    if(this.state==='ready'){
      ctx.globalAlpha=.6+Math.sin(this.time*4)*.3;
      ctx.strokeStyle='#a6f8ff';ctx.beginPath();ctx.arc(b.x,b.y,b.r+11,0,Math.PI*2);
      ctx.stroke();ctx.globalAlpha=1;
    }
  }

}

const game=new Game();
const pointerToX=e=>{
  const rect=canvas.getBoundingClientRect();
  if(rect.width===0)return;
  game.targetX=clamp((e.clientX-rect.left)*(CFG.width/rect.width),CFG.left+game.paddle.w/2,CFG.right-game.paddle.w/2);
};
canvas.addEventListener('pointerdown',e=>{
  if(game.activePointerId!==null)return; // Ignore additional simultaneous fingers.
  if(e.pointerType==='touch'&&e.cancelable)e.preventDefault();
  game.activePointerId=e.pointerId;
  pointerToX(e);
  try{canvas.setPointerCapture(e.pointerId)}catch(_){}
  if(game.state==='ready')game.launch();
});
canvas.addEventListener('pointermove',e=>{
  if(e.pointerId===game.activePointerId || (e.pointerType==='mouse'&&game.activePointerId===null))pointerToX(e);
});
const releasePointer=e=>{if(e.pointerId===game.activePointerId)game.activePointerId=null};
canvas.addEventListener('pointerup',releasePointer);
canvas.addEventListener('pointercancel',releasePointer);
canvas.addEventListener('lostpointercapture',releasePointer);
ui.launch.addEventListener('click',()=>game.launch());
ui.pulse.addEventListener('click',()=>game.pulse());
ui.pause.addEventListener('click',()=>game.togglePause());
ui.sound.addEventListener('click',()=>{
  soundEnabled=!soundEnabled;
  ui.sound.querySelector('.sound-state').textContent=soundEnabled?'ВКЛ':'ВЫКЛ';
  ui.sound.setAttribute('aria-label',soundEnabled?'Выключить звук':'Включить звук');
  if(soundEnabled)beep(650,.07);
});
window.addEventListener('keydown',e=>{
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
  // Profiling adds two high-resolution reads per frame only when ?fps=1.
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
// Expose a read-only diagnostic snapshot for automated smoke tests, no gameplay cheats.
window.__impulseDebug=()=>({state:game.state,score:game.score,level:game.level,lives:game.lives,bricks:game.bricks.length,energy:game.energy,combo:game.comboHits,fps:game.performance.fps,maxFrameMs:game.performance.maxFrameMs,avgUpdateMs:game.performance.avgUpdateMs,avgDrawMs:game.performance.avgDrawMs,spritePaintCount:game.spritePaintCount,shield:game.shieldCharges,stats:{...game.runStats}});
