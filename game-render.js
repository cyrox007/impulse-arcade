/*
 * Canvas-отрисовка «Импульса».
 *
 * Здесь нет правил начисления очков или изменения состояния игры:
 * методы читают уже рассчитанную модель и рисуют кадр либо кэшируют спрайты.
 * Файл загружается перед game.js, чтобы сохранить обычный статический сайт
 * без сборщика, npm-зависимостей и ограничений на file://.
 */
'use strict';

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


const IMPULSE_RENDER_METHODS = {
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
  },

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
    this.drawMovingBricks();this.drawGuardian();this.drawEnemyShots();this.drawDrops();this.drawParticles();this.drawWaves();this.drawShield();this.drawPaddle();this.drawBall();this.drawGameplayStatus();
    if(this.flash>0){ctx.fillStyle=`rgba(252,114,201,${Math.min(.2,this.flash*.4)})`;ctx.fillRect(0,0,w,h)}
    // Диагностика FPS включается параметром ?fps=1 и не загромождает обычный интерфейс.
    if(this.profileEnabled){
      const m=this.performance;
      ctx.fillStyle='#081327eb';ctx.fillRect(CFG.left+8,CFG.height-110,198,44);
      ctx.fillStyle='#c7edff';ctx.font='12px system-ui';ctx.textAlign='left';
      ctx.fillText(`FPS: ${m.fps}  max: ${m.maxFrameMs}ms`,CFG.left+13,CFG.height-94);
      ctx.fillText(`Логика: ${m.avgUpdateMs}мс  Графика: ${m.avgDrawMs}мс`,CFG.left+13,CFG.height-76);
    }
  },
  drawGameplayStatus(){
    if(!['playing','ready','paused'].includes(this.state))return;
    ctx.textAlign='left';ctx.font='bold 12px system-ui';
    // Показываем число оставшихся блоков рядом с комбо, но не в фазе босса.
    // Так игрок видит прогресс без дополнительной панели на узком экране.
    if(this.sectorPhase==='bricks'&&this.bricks.length>0){
      ctx.fillStyle='#a2cde3';
      ctx.textAlign='right';
      ctx.fillText(`ОСТАЛОСЬ ${this.bricks.length}`,CFG.right-9,77);
      ctx.textAlign='left';
    }
    if(this.comboHits>=2){
      ctx.fillStyle='#ffcf80';
      ctx.fillText(`СЕРИЯ ${this.comboHits}  ×${this.comboMultiplier()}`,CFG.left+4,77);
    }
    const effects=[];
    if(this.timers.wide>0)effects.push(`ПЛАТФОРМА ${Math.ceil(this.timers.wide)}с`);
    if(this.timers.slow>0)effects.push(`ЗАМЕДЛ. ${Math.ceil(this.timers.slow)}с`);
    if(this.timers.pulse>0)effects.push(`ИМПУЛЬС ${Math.ceil(this.timers.pulse)}с`);
    if(this.timers.magnet>0)effects.push(`МАГНИТ ${Math.ceil(this.timers.magnet)}с`);
    if(this.activeBalls().length>1)effects.push('ШАРЫ ×'+this.activeBalls().length);
    if(this.shieldCharges>0)effects.push('БАРЬЕР ×1');
    if(this.boss)effects.push((this.boss.kind==='reactor'?'РЕАКТОР ':'СТРАЖ ')+this.boss.hp+'/'+this.boss.maxHp);
    if(effects.length){
      ctx.fillStyle='#a4f5ed';ctx.font='11px system-ui';
      ctx.fillText(effects.slice(0,3).join(' · '),CFG.left+4,94);
      if(effects.length>3)ctx.fillText(effects.slice(3).join(' · '),CFG.left+4,106);
    }
  },
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
  },
  drawBricks(target=ctx){
    this.brickPaintCount++;for(const brick of this.bricks){
    if(brick.type==='moving')continue;
    let c1,c2,stroke;
    if(brick.type==='charge'){c1='#f9e68d';c2='#ab7041';stroke='#fff2ab'}
    else if(brick.type==='prism'){c1='#ba9cff';c2='#6651be';stroke='#e4d2ff'}
    else if(brick.type==='directional'){c1='#85d2ae';c2='#275e71';stroke='#c9ffdc'}
    else if(brick.type==='core'){c1='#ff7abb';c2='#a541a5';stroke='#ffb7dd'}
    else if(brick.type==='armor'){c1='#e4ba79';c2='#825e6d';stroke='#fff0a5'}
    else if(brick.type==='blast'){c1='#ffc07a';c2='#cc5a5c';stroke='#ffe2ab'}
    else {const colors=[['#6bcdff','#357cb3'],['#72dcf3','#346da1'],['#a28ff6','#575bba'],['#79bdf4','#3d70a7'],['#87eee3','#3b9ea9'],['#d1a3f6','#8559b9'],['#6ccde7','#4588ae']];[c1,c2]=colors[brick.row%colors.length];stroke=c1}
    if(brick.maxHp===2&&brick.hp===1){c1='#927e91';c2='#6b647a'}
    const g=target.createLinearGradient(brick.x,brick.y,brick.x,brick.y+brick.h);g.addColorStop(0,c1);g.addColorStop(1,c2);
    target.shadowColor=c1;target.shadowBlur=brick.type==='core'?15:5;
    roundRect(brick.x,brick.y,brick.w,brick.h,5,g,stroke,target);target.shadowBlur=0;
    target.fillStyle='#ffffff45';target.fillRect(brick.x+7,brick.y+4,brick.w-14,2);
    if(brick.type==='charge'||brick.type==='prism'){
      target.fillStyle='#fffefa';target.font='bold 17px system-ui';target.textAlign='center';
      target.fillText(brick.type==='charge'?'⚡':'✧',brick.x+brick.w/2,brick.y+18);
    }
    if(brick.type==='directional'){
      // Стрелка показывает единственную незащищённую грань; рисуется в кэшированном слое кирпичей.
      target.strokeStyle='#e8ffae';target.lineWidth=3;target.beginPath();
      const midX=brick.x+brick.w/2,midY=brick.y+brick.h/2;
      if(brick.face==='U'){target.moveTo(midX-10,brick.y+4);target.lineTo(midX+10,brick.y+4)}
      if(brick.face==='D'){target.moveTo(midX-10,brick.y+brick.h-4);target.lineTo(midX+10,brick.y+brick.h-4)}
      if(brick.face==='L'){target.moveTo(brick.x+4,midY-8);target.lineTo(brick.x+4,midY+8)}
      if(brick.face==='R'){target.moveTo(brick.x+brick.w-4,midY-8);target.lineTo(brick.x+brick.w-4,midY+8)}
      target.stroke();target.lineWidth=1;
      target.fillStyle='#e3ffeb';target.font='bold 16px system-ui';target.textAlign='center';
      target.fillText({U:'↑',D:'↓',L:'←',R:'→'}[brick.face],midX,brick.y+18);
    }
    if(brick.type==='armor'){target.fillStyle='#19213c98';target.font='bold 14px system-ui';target.textAlign='center';target.fillText(brick.hp===2?'◆':'◇',brick.x+brick.w/2,brick.y+18)}
    if(brick.type==='blast'){target.fillStyle='#fff6dd';target.font='bold 17px system-ui';target.textAlign='center';target.fillText('✶',brick.x+brick.w/2,brick.y+18)}
    if(brick.type==='core'){target.fillStyle='#fff2ff';target.beginPath();target.moveTo(brick.x+brick.w/2,brick.y+5);target.lineTo(brick.x+brick.w/2+8,brick.y+brick.h/2);target.lineTo(brick.x+brick.w/2,brick.y+brick.h-5);target.lineTo(brick.x+brick.w/2-8,brick.y+brick.h/2);target.fill()}
  }},
  drawMovingBricks(){
    // Силуэт как у обычного кирпича; не добавляем визуальных направляющих движения.
    for(const brick of this.bricks){
      if(brick.type!=='moving')continue;
      roundRect(brick.x,brick.y,brick.w,brick.h,5,'#337f9d','#84d5f4');
      ctx.fillStyle='#b9eaff';ctx.fillRect(brick.x+7,brick.y+4,brick.w-14,2);
      ctx.fillStyle='#e7fbff';ctx.font='bold 13px system-ui';ctx.textAlign='center';
      ctx.fillText('◇',brick.x+brick.w/2,brick.y+18);
    }
  },
  drawEnemyShots(){
    for(const shot of this.enemyShots){
      ctx.strokeStyle='#ffb17c';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(shot.x-shot.vx*.035,shot.y-12);ctx.lineTo(shot.x,shot.y);ctx.stroke();
      ctx.fillStyle='#ffe2ad';ctx.beginPath();ctx.arc(shot.x,shot.y,shot.r,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ff7f81';ctx.beginPath();ctx.arc(shot.x,shot.y,shot.r*.48,0,Math.PI*2);ctx.fill();
    }
    // Оранжевое мигание босса предупреждает о следующем снаряде.
    if(this.boss&&this.boss.shotClock> (this.boss.kind==='reactor'?2.4:3.0)){
      ctx.globalAlpha=.5+.4*Math.sin(this.time*19);
      ctx.strokeStyle='#ffbe7a';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(this.boss.x+this.boss.w/2,
        this.boss.y+this.boss.h+7,11,0,Math.PI*2);ctx.stroke();
      ctx.globalAlpha=1;ctx.lineWidth=1;
    }
  },
  paintGuardianSprite(target,shielded){
    const cx=112,cy=67;
    const poly=(points,fill,stroke)=>{
      target.beginPath();target.moveTo(points[0][0],points[0][1]);
      for(let i=1;i<points.length;i++)target.lineTo(points[i][0],points[i][1]);
      target.closePath();target.fillStyle=fill;target.fill();
      if(stroke){target.strokeStyle=stroke;target.lineWidth=2;target.stroke()}
    };
    // Корпус, механические плавники и ореол рисуются один раз на фазу.
    const halo=target.createRadialGradient(cx,cy,6,cx,cy,73);
    halo.addColorStop(0,shielded?'#58dcff8c':'#ff70deaa');
    halo.addColorStop(1,'#00000000');
    target.fillStyle=halo;target.beginPath();target.arc(cx,cy,73,0,Math.PI*2);target.fill();
    poly([[12,58],[34,29],[65,24],[81,45],[76,83],[42,106],[18,88]],'#182d50','#66a6d7');
    poly([[212,58],[190,29],[159,24],[143,45],[148,83],[182,106],[206,88]],'#182d50','#66a6d7');
    poly([[26,60],[58,41],[76,61],[58,85]],'#315476','#8dd5f3');
    poly([[198,60],[166,41],[148,61],[166,85]],'#315476','#8dd5f3');
    poly([[70,27],[90,13],[134,13],[154,27],[159,99],[136,116],[88,116],[65,99]],'#132440','#8bbcf0');
    poly([[84,37],[112,27],[140,37],[150,66],[140,95],[112,107],[84,95],[74,66]],shielded?'#1d536d':'#592e72',shielded?'#9aecff':'#ffb3ef');
    const core=target.createRadialGradient(cx-7,cy-10,3,cx,cy,30);
    core.addColorStop(0,'#ffffff');
    core.addColorStop(.36,shielded?'#91ecff':'#ffe1ff');
    core.addColorStop(1,shielded?'#337aa5':'#a835b8');
    target.fillStyle=core;target.beginPath();target.arc(cx,cy,shielded?18:26,0,Math.PI*2);target.fill();
    target.strokeStyle=shielded?'#9ef4ff':'#ffe2ff';target.lineWidth=3;
    target.beginPath();target.arc(cx,cy,shielded?25:31,0,Math.PI*2);target.stroke();
    if(shielded){
      // Смыкающиеся бронезаслонки визуально закрывают уязвимое ядро.
      poly([[69,43],[99,49],[103,86],[69,96],[55,76]],'#477b98','#b5f3ff');
      poly([[155,43],[125,49],[121,86],[155,96],[169,76]],'#477b98','#b5f3ff');
      poly([[94,59],[112,46],[130,59],[130,77],[112,91],[94,77]],'#234d70','#c4f5ff');
    }else{
      poly([[53,34],[77,42],[81,90],[54,100],[43,73]],'#76476f','#ffbad9');
      poly([[171,34],[147,42],[143,90],[170,100],[181,73]],'#76476f','#ffbad9');
      target.fillStyle='#fff8ff';target.beginPath();target.arc(cx,cy,9,0,Math.PI*2);target.fill();
    }
    // Боковые излучатели показывают масштаб и направление босса.
    for(const x of [37,187]){
      target.fillStyle=shielded?'#95ecff':'#fa9bdf';
      target.beginPath();target.arc(x,68,5,0,Math.PI*2);target.fill();
    }
  },
  makeGuardianSprite(shielded){
    const layer=createLayer(224,136);
    if(!layer)return null;
    this.paintGuardianSprite(layer.ctx,shielded);
    this.spritePaintCount++;
    return layer.canvas;
  },
  paintReactorSprite(target){
    const poly=(points,fill,stroke)=>{
      target.beginPath();target.moveTo(points[0][0],points[0][1]);
      for(let i=1;i<points.length;i++)target.lineTo(points[i][0],points[i][1]);
      target.closePath();target.fillStyle=fill;target.fill();
      if(stroke){target.lineWidth=2;target.strokeStyle=stroke;target.stroke()}
    };
    // Один раз кэшируем корпус реактора, три мишени, плавники и вентиляционные панели.
    const glow=target.createRadialGradient(118,69,6,118,69,106);
    glow.addColorStop(0,'#ff9f5866');glow.addColorStop(1,'#ff6e2000');
    target.fillStyle=glow;target.fillRect(0,0,236,124);
    poly([[4,58],[28,32],[64,35],[75,80],[43,111],[11,94]],'#482c43','#ffbd79');
    poly([[232,58],[208,32],[172,35],[161,80],[193,111],[225,94]],'#482c43','#ffbd79');
    poly([[36,51],[59,21],[177,21],[200,51],[188,99],[48,99]],'#1e3247','#ed9e6b');
    poly([[67,28],[89,12],[147,12],[169,28],[157,67],[79,67]],'#50405d','#ffc084');
    poly([[88,38],[118,25],[148,38],[141,59],[95,59]],'#8e4668','#ffbf8b');
    target.fillStyle='#ffcf9d';target.fillRect(82,42,72,4);
    target.fillStyle='#e98d6d';target.fillRect(68,72,100,4);
    // Три посадочных гнезда: светящиеся ядра узлов обновляются по текущей прочности.
    for(const x of [60,118,176]){
      target.fillStyle='#182b42';target.beginPath();target.arc(x,90,24,0,Math.PI*2);target.fill();
      target.strokeStyle='#ffd0a0';target.lineWidth=3;target.beginPath();target.arc(x,90,24,0,Math.PI*2);target.stroke();
    }
  },
  makeReactorSprite(){
    const layer=createLayer(236,124);if(!layer)return null;
    this.paintReactorSprite(layer.ctx);this.spritePaintCount++;
    return layer.canvas;
  },
  drawReactor(){
    const boss=this.boss;if(!boss||boss.kind!=='reactor')return;
    const sprite=this.sprites.reactor;
    if(sprite)ctx.drawImage(sprite,boss.x-24,boss.y-24);
    else{
      // Недорогой запасной способ рисования без offscreen canvas.
      roundRect(boss.x,boss.y,boss.w,boss.h,12,'#27354c','#ffbc83');
    }
    for(const node of boss.nodes){
      const x=boss.x+node.offset,y=boss.y+boss.h-10;
      ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);
      ctx.fillStyle=node.hp===2?'#ffb662':node.hp===1?'#ff7485':'#233248';ctx.fill();
      ctx.strokeStyle=node.hp?'#fff0c1':'#64758e';ctx.lineWidth=2;ctx.stroke();
      if(node.hp>0){
        ctx.fillStyle='#fff1cd';ctx.beginPath();ctx.arc(x,y,node.hp===2?7:5,0,Math.PI*2);ctx.fill();
      }else{
        ctx.strokeStyle='#6d788b';ctx.beginPath();ctx.moveTo(x-7,y-7);ctx.lineTo(x+7,y+7);
        ctx.moveTo(x+7,y-7);ctx.lineTo(x-7,y+7);ctx.stroke();
      }
    }
    ctx.textAlign='center';ctx.font='bold 12px system-ui';ctx.fillStyle='#ffd0ac';
    ctx.fillText('РЕАКТОР · СНИЗУ · '+boss.nodes.filter(n=>n.hp>0).length+'/3',boss.x+boss.w/2,boss.y-43);
    for(let i=0;i<boss.nodes.length;i++){
      const x=boss.x+boss.w/2-52+i*39;
      roundRect(x,boss.y-37,31,7,2,boss.nodes[i].hp===2?'#ffd08d':boss.nodes[i].hp===1?'#ff7c94':'#344252',null);
    }
    if(boss.hitFlash>0){
      ctx.globalAlpha=Math.min(.6,boss.hitFlash*3);
      ctx.fillStyle='#fff6d6';ctx.fillRect(boss.x+16,boss.y+7,boss.w-32,6);ctx.globalAlpha=1;
    }
    ctx.lineWidth=1;ctx.globalAlpha=1;
  },
  drawGuardian(){
    const boss=this.boss;if(!boss)return;
    if(boss.kind==='reactor'){this.drawReactor();return}
    const shielded=!this.guardianVulnerable(),cx=boss.x+boss.w/2,cy=boss.y+boss.h/2;
    const sprite=shielded?this.sprites.guardianShield:this.sprites.guardianOpen;
    if(sprite)ctx.drawImage(sprite,cx-112,cy-67);
    else this.paintGuardianSprite(ctx,shielded);
    // Лёгкая вращающаяся дуга оживляет заранее нарисованный спрайт.
    if(!this.reducedMotion){
      const angle=this.time*(shielded?1.8:-1.3);
      ctx.strokeStyle=shielded?'#8feaff':'#ffb9fa';ctx.lineWidth=2;
      for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(cx,cy,47,angle+i*Math.PI*2/3,angle+i*Math.PI*2/3+.85);ctx.stroke()}
    }
    if(boss.hitFlash>0){
      ctx.globalAlpha=Math.min(.65,boss.hitFlash*3);ctx.fillStyle='#ffffff';
      ctx.beginPath();ctx.arc(cx,cy,35,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    }
    // Шесть отдельных индикаторов прочности вместо прямоугольника, похожего на кирпич.
    ctx.textAlign='center';ctx.font='bold 12px system-ui';
    ctx.fillStyle=shielded?'#94ddff':'#ffb5e9';
    ctx.fillText(shielded?'СТРАЖ ЯДРА · ЩИТ':'СТРАЖ · УДАР СНИЗУ',cx,boss.y-42);
    for(let i=0;i<boss.maxHp;i++){
      const cell=18,gap=4,x=cx-(boss.maxHp*(cell+gap)-gap)/2+i*(cell+gap);
      roundRect(x,boss.y-36,cell,6,2,i<boss.hp?(shielded?'#76cbed':'#f49ed8'):'#32415c',null);
    }
    ctx.globalAlpha=1;ctx.lineWidth=1;
  },
  drawDrops(){for(const d of this.drops){
    const color=d.type==='wide'?'#6bf9bc':d.type==='slow'?'#81c6ff':d.type==='shield'?'#88ffd6':d.type==='multi'?'#c0a2ff':d.type==='magnet'?'#ffc881':'#ff83a9';
    ctx.shadowColor=color;ctx.shadowBlur=14;roundRect(d.x-13,d.y-13,26,26,8,'#192643',color);ctx.shadowBlur=0;
    ctx.fillStyle=color;ctx.font='bold 17px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(d.type==='wide'?'↔':d.type==='slow'?'◷':d.type==='shield'?'⬡':d.type==='multi'?'✳':d.type==='magnet'?'∩':'♥',d.x,d.y+1);
    ctx.textBaseline='alphabetic';
  }},
  drawShield(){
    if(this.shieldCharges<=0)return;
    ctx.strokeStyle='#88ffd6';ctx.globalAlpha=.8;ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(CFG.left+14,CFG.bottom-14);ctx.lineTo(CFG.right-14,CFG.bottom-14);ctx.stroke();
    ctx.globalAlpha=1;ctx.lineWidth=1;
  },
  drawParticles(){
    for(const p of this.particles){
      ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);ctx.fillStyle=p.color;
      if(p.shard){
        const tail=p.r*.55;
        ctx.beginPath();ctx.moveTo(p.x,p.y-p.r);ctx.lineTo(p.x+tail,p.y+tail);
        ctx.lineTo(p.x-tail,p.y+tail);ctx.closePath();ctx.fill();
      }else ctx.fillRect(p.x,p.y,p.r,p.r);
    }
    ctx.globalAlpha=1;
  },

  paintPaddle(target,w,wide,left,y){
    target.shadowColor=wide?'#5cf9bf':'#4adff5';target.shadowBlur=19;
    const gradient=target.createLinearGradient(left,y,left,y+CFG.paddleH);
    gradient.addColorStop(0,'#d4faff');
    gradient.addColorStop(.35,'#64dcef');
    gradient.addColorStop(1,'#2475b5');
    roundRect(left,y,w,CFG.paddleH,7,gradient,'#a2f2ff',target);target.shadowBlur=0;
    roundRect(left+w/2-19,y+2,38,3,2,'#ecfaff',null,target);
    target.fillStyle='#64dafa8a';target.fillRect(left+4,y+CFG.paddleH-1,w-18,3);
  },
  makePaddleSprite(width,wide){
    const pad=26,layer=createLayer(width+pad*2,CFG.paddleH+pad*2);
    if(!layer)return null;
    this.paintPaddle(layer.ctx,width,wide,pad,pad);
    this.spritePaintCount++;
    return layer.canvas;
  },
  drawPaddle(){
    const p=this.paddle,wide=this.timers.wide>0;
    const sprite=wide?this.sprites.paddleWide:this.sprites.paddleNormal;
    if(sprite&&p.w===(wide?145:CFG.paddleW)){
      ctx.drawImage(sprite,p.x-p.w/2-26,p.y-26);
    }else{
      // Если дополнительный Canvas недоступен, используем прямую отрисовку.
      this.paintPaddle(ctx,p.w,wide,p.x-p.w/2,p.y);
    }
    if(this.timers.magnet>0){
      // Тонкое поле статичного цвета не требует пересоздавать спрайт платформы.
      ctx.strokeStyle='#ffc57e';ctx.lineWidth=2;ctx.globalAlpha=.85;
      ctx.beginPath();ctx.moveTo(p.x-p.w/2+9,p.y-6);
      ctx.lineTo(p.x-p.w/2+9,p.y-10);ctx.lineTo(p.x+p.w/2-9,p.y-10);
      ctx.lineTo(p.x+p.w/2-9,p.y-6);ctx.stroke();
      ctx.globalAlpha=1;ctx.lineWidth=1;
    }
  },
  paintBall(target,pulse,x,y,r){
    target.shadowColor=pulse?'#ff65d4':'#b6faff';target.shadowBlur=pulse?28:18;
    const gradient=target.createRadialGradient(x-3,y-3,2,x,y,r+2);
    gradient.addColorStop(0,'#ffffff');
    gradient.addColorStop(.42,pulse?'#ff9be5':'#a6fcff');
    gradient.addColorStop(1,pulse?'#ad4ec6':'#248ca9');
    target.fillStyle=gradient;target.beginPath();target.arc(x,y,r,0,Math.PI*2);target.fill();
    target.shadowBlur=0;
  },
  makeBallSprite(pulse){
    const pad=36,size=CFG.ballRadius*2+pad*2,layer=createLayer(size,size);
    if(!layer)return null;
    this.paintBall(layer.ctx,pulse,pad+CFG.ballRadius,pad+CFG.ballRadius,CFG.ballRadius);
    this.spritePaintCount++;
    return layer.canvas;
  },
  drawBall(){
    const pulse=this.timers.pulse>0;
    for(const b of this.activeBalls()){
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
    if(this.state==='ready'||b.held){
      ctx.globalAlpha=.6+Math.sin(this.time*4)*.3;
      ctx.strokeStyle=b.held?'#ffda85':'#a6f8ff';ctx.beginPath();ctx.arc(b.x,b.y,b.r+11,0,Math.PI*2);
      ctx.stroke();ctx.globalAlpha=1;
    }
    }
  }

};
