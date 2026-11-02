/*
 * Генерация кирпичей и учёт попаданий.
 *
 * Символы LEVELS определяют состав препятствий, но не хранят состояние:
 * объекты кирпичей создаются заново при старте каждого сектора.
 * Защищённые грани проверяются физическим модулем на проходимость.
 *
 * Взрыв повреждает только четырёх непосредственных соседей: нет цепной
 * детонации и повторного комбо за вторичный урон. Массив кирпичей
 * может изменяться во время обработки попадания, поэтому для удаления
 * ищем текущий индекс объекта и не доверяем прежнему номеру.
 *
 * Все методы используют тот же Game через this.
 */
'use strict';

const IMPULSE_BRICK_METHODS = {
  resetCombo(){this.comboHits=0;this.comboUntil=0},

  comboMultiplier(){return Math.min(4,1+Math.floor(Math.max(0,this.comboHits-1)/3))},

  registerHit(){
    if(this.time>this.comboUntil)this.resetCombo();
    this.comboHits++;this.comboUntil=this.time+CFG.comboWindow;
    this.bestComboInSector=Math.max(this.bestComboInSector,this.comboHits);
    this.runStats.maxCombo=Math.max(this.runStats.maxCombo,this.comboHits);
    return this.comboMultiplier();
  },

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
  },

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
  },

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
};
