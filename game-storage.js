/*
 * Сохранения и проверка локальных данных «Импульса».
 * 
 * localStorage может быть недоступен при ограничениях браузера и file://.
 * Ошибки чтения, повреждённые версии или некорректные поля не ломают запуск:
 * функции возвращают безопасное значение.
 * Контрольная точка хранит только начало следующего сектора, счёт, жизни,
 * энергию и статистику — не текущие полёты шаров, кирпичи или бой с боссом.
 * 
 * Функции вызываются после объявления CFG и LEVELS в game.js.
 * Методы ниже используют единственный экземпляр Game через this.
 */
'use strict';

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

const IMPULSE_PERSISTENCE_METHODS = {
  saveCheckpoint(){
    if(this.state!=='between'||this.level>=LEVELS.length-1)return false;
    const checkpoint={version:CHECKPOINT_VERSION,sector:this.level+1,
      score:this.score,lives:this.lives,energy:this.energy,
      stats:Object.fromEntries(STAT_KEYS.map(k=>[k,this.runStats[k]]))};
    // Хранилище может быть недоступно или заполнено: не выдаём несохранённую точку за записанную.
    if(!safeSaveCheckpoint(checkpoint))return false;
    this.checkpoint=checkpoint;
    return true;
  },

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
};
