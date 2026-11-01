'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = readFileSync(path.join(root, 'game.js'), 'utf8');

function createEnvironment() {
  const handlers = new Map();
  const records = new Map();
  const storage = new Map();
  const fakeGradient = {addColorStop() {}};
  const canvasContext = new Proxy({}, {
    get(target, property) {
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => fakeGradient;
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
      setPointerCapture() {},
      getContext() {return canvasContext;}
    };
    return element;
  }
  const document = {
    hidden:false,
    getElementById(id) {if (!records.has(id)) records.set(id, makeElement(id));return records.get(id);},
    addEventListener(type, handler) { handlers.set('document:'+type, handler); }
  };
  const window = {addEventListener(type, handler) {handlers.set('window:'+type, handler);}};
  const sandbox = {
    window, document,
    localStorage: {getItem(key) {return storage.get(key)??null;}, setItem(key,value) {storage.set(key,value);}},
    performance: {now: () => 0},
    requestAnimationFrame() {},
    console, Math, Array, Object, String, Number, Map
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename:'game.js'});
  return { ...vm.runInContext('({game,CFG,LEVELS})', sandbox), handlers, elements:records, storage };
}

test('стартовая сцена → готовность → запуск шара', () => {
  const {game,CFG,LEVELS} = createEnvironment();
  assert.equal(game.state, 'menu');
  assert.equal(LEVELS.length, 3);
  game.launch();
  assert.equal(game.state, 'ready');
  assert.equal(game.bricks.length, LEVELS[0].rows.join('').replaceAll('.', '').length);
  game.launch();
  assert.equal(game.state, 'playing');
  assert.ok(Math.abs(game.ballSpeed() - CFG.initialSpeed) < 0.001);
});

test('пауза фиксирует физику; продолжение возвращает состояние', () => {
  const {game} = createEnvironment();
  game.launch(); game.launch();
  game.update(0.03);
  game.togglePause();
  assert.equal(game.state, 'paused');
  const position = [game.ball.x, game.ball.y];
  game.update(0.03);
  assert.deepEqual([game.ball.x, game.ball.y], position);
  game.launch();
  assert.equal(game.state, 'playing');
});

test('импульс расходует 100% заряда и включается только во время игры', () => {
  const {game,CFG} = createEnvironment();
  game.launch();
  game.energy = 100;
  game.pulse();
  assert.equal(game.energy, 100, 'нельзя активировать до начала движения');
  game.launch();
  game.pulse();
  assert.equal(game.energy, 0);
  assert.equal(game.timers.pulse, CFG.pulseDuration);
  game.pulse();
  assert.equal(game.energy, 0);
});

test('повреждение кирпича, счёт, рекорд и переход между тремя уровнями', () => {
  const {game,LEVELS,CFG,storage} = createEnvironment();
  game.launch(); game.launch();
  const initialScore = game.score;
  let armor = game.bricks.find(b => b.hp===2);
  assert.equal(armor,undefined,'на первом уровне нет брони');
  game.hitBrick(game.bricks[0],0);
  assert.ok(game.score > initialScore);
  for(let level=0;level<LEVELS.length;level++) {
    for(let i=game.bricks.length-1;i>=0;i--) {
      const brick=game.bricks[i];
      while (brick.hp>0) {brick.lock=0;game.hitBrick(brick,i);}
    }
    assert.equal(game.bricks.length,0);
    if (level<LEVELS.length-1) {
      assert.equal(game.state,'between');
      game.launch();
      assert.equal(game.state,'ready');
      assert.equal(game.level,level+1);
      game.launch();
    } else assert.equal(game.state,'won');
  }
  assert.ok(game.best>0);
  assert.equal(Number(storage.get(CFG.storageKey)), game.best);
});

test('потеря трёх жизней завершает игру; повтор запускает новую', () => {
  const {game} = createEnvironment();
  game.launch();game.launch();
  game.dropBall();
  assert.equal(game.lives,2);
  assert.equal(game.state,'ready');
  game.launch();game.dropBall();
  game.launch();game.dropBall();
  assert.equal(game.state,'lost');
  assert.equal(game.lives,0);
  game.launch();
  assert.equal(game.state,'ready');
  assert.equal(game.lives,3);
  assert.equal(game.score,0);
});

test('ограничение положения платформы и захват бонусов', () => {
  const {game,CFG} = createEnvironment();
  game.launch();game.launch();
  game.keys.ArrowRight=true;
  game.targetX=CFG.right+100;
  game.update(.03);
  assert.ok(game.targetX<=CFG.right-game.paddle.w/2);
  game.keys.ArrowRight=false;
  game.applyDrop('wide');
  assert.equal(game.paddle.w,145);
  assert.ok(game.timers.wide>0);
  game.applyDrop('life');
  assert.equal(game.lives,4);
});

test('статический сайт не зависит от внешних JS/CSS и имеет мета-описание', () => {
  const html = readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html, /name="description"/);
  assert.match(html, /src="game\\.js"/);
  assert.match(html, /href="style\\.css"/);
  assert.doesNotMatch(html, /<script[^>]*src="https?:\\/\\//i);
  assert.doesNotMatch(html, /<link[^>]*href="https?:\\/\\//i);
});
