'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const physicsSource = readFileSync(path.join(root, 'game-physics.js'), 'utf8');
const rendererSource = readFileSync(path.join(root, 'game-render.js'), 'utf8');
const source = readFileSync(path.join(root, 'game.js'), 'utf8');
const inputSource = readFileSync(path.join(root, 'game-input.js'), 'utf8');

function createEnvironment({fpsDebug=false,reducedMotion=false,sharedStorage=null,storageBlocked=false}={}) {
  const handlers = new Map();
  const gradientCalls={linear:0,radial:0};
  let animationFrame=null, clock=0;
  const records = new Map();
  const storage = sharedStorage||new Map();
  const fakeGradient = {addColorStop() {}};
  const canvasContext = new Proxy({}, {
    get(target, property) {
      if (property === 'createLinearGradient') return () => {gradientCalls.linear++;return fakeGradient;};
      if (property === 'createRadialGradient') return () => {gradientCalls.radial++;return fakeGradient;};
      if (!Object.hasOwn(target, property)) target[property] = () => {};
      return target[property];
    }
  });
  function makeElement(id) {
    const listeners = new Map();
    const element = {
      id, style: {}, disabled: false, hidden: false, innerHTML: '', textContent: '',
      listeners,
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      querySelector() {return makeElement('child');},
      getBoundingClientRect() {return {left:0,width:480};},
      focus() {},
      setPointerCapture() {},
      getContext() {return canvasContext;}
    };
    return element;
  }
  const document = {
    hidden:false,
    getElementById(id) {if (!records.has(id)) records.set(id, makeElement(id));return records.get(id);},
    createElement(tag) {if(tag!=='canvas')throw Error('Unexpected element '+tag);return {width:0,height:0,getContext(){return canvasContext;}};},
    addEventListener(type, handler) { handlers.set('document:'+type, handler); }
  };
  const window = {location:{search:fpsDebug?'?fps=1':''},
    matchMedia:()=>({matches:reducedMotion}),
    addEventListener(type, handler) {handlers.set('window:'+type, handler);}};
  const sandbox = {
    window, document,
    localStorage: {
      getItem(key) {if(storageBlocked)throw Error('storage denied');return storage.get(key)??null;},
      setItem(key,value) {if(storageBlocked)throw Error('quota exceeded');storage.set(key,value);},
      removeItem(key) {if(storageBlocked)throw Error('storage denied');storage.delete(key);}
    },
    performance: {now: () => clock++ / 2},
    requestAnimationFrame(cb) {animationFrame=cb;},
    console, Math, Array, Object, String, Number, Map
  };
  vm.createContext(sandbox);
  vm.runInContext(physicsSource, sandbox, {filename:'game-physics.js'});
  vm.runInContext(rendererSource, sandbox, {filename:'game-render.js'});
  vm.runInContext(source, sandbox, {filename:'game.js'});
  vm.runInContext(inputSource, sandbox, {filename:'game-input.js'});
  return { ...vm.runInContext('({game,CFG,LEVELS})', sandbox),
    handlers, elements:records, storage, gradientCalls,
    tick(now){if(!animationFrame)throw Error('RAF was not scheduled');animationFrame(now);}
  };
}

function finishGuardian(game){
  assert.equal(game.sectorPhase,'guardian','guardian should begin after all bricks');
  assert.ok(game.boss);
  let hits=0;
  while(game.boss){
    const b=game.boss;
    b.lock=0;b.phaseTime=0;
    game.ball.x=b.x+b.w/2;game.ball.y=b.y+b.h+game.ball.r+.4;
    game.ball.vx=0;game.ball.vy=-game.levelSpeed();
    game.moveBall(.004);
    if(++hits>10)assert.fail('guardian stuck');
  }
  assert.equal(hits,6);
  assert.equal(game.state,'between');
  assert.equal(game.level,2);
  assert.equal(game.sectorPhase,'finished');
}
function finishReactor(game){
  assert.equal(game.sectorPhase,'reactor','reactor phase after final bricks');
  assert.equal(game.boss?.kind,'reactor');
  let hits=0;
  while(game.boss){
    const boss=game.boss,node=boss.nodes.find(n=>n.hp>0);
    assert.ok(node,'reactor must have a remaining node');
    boss.lock=0;
    game.ball.x=boss.x+node.offset;
    game.ball.y=boss.y+boss.h+game.ball.r+.4;
    game.ball.vx=0;game.ball.vy=-game.levelSpeed();
    game.moveBall(.004);
    if(++hits>9)assert.fail('reactor stuck');
  }
  assert.equal(hits,6);
  assert.equal(game.state,'won');
  assert.equal(game.sectorPhase,'finished');
}

module.exports = {root, createEnvironment, finishGuardian, finishReactor};
