/*
 * Управление боссами «Импульса».
 *
 * Страж и Реактор имеют разные частоты атак, траектории и уязвимые зоны.
 * Методы меняют существующее поле Game.boss, не создавая отдельный мир.
 * В паузе обновление и выстрелы не выполняются. В момент победы
 * состояние босса очищается до перехода на следующий сектор.
 *
 * Все функции используют этот же объект Game через this.
 * Никаких дополнительных экземпляров игрового состояния нет.
 */
'use strict';

const IMPULSE_BOSS_METHODS = {
  beginGuardian() {
    if (this.sectorPhase !== 'bricks' || this.level !== 2) return;
    this.sectorPhase = 'guardian';
    this.boss = {
      kind: 'guardian',
      x: CFG.width / 2 - 80,
      y: 138,
      w: 160,
      h: 66,
      hp: 6,
      maxHp: 6,
      lock: 0,
      phaseTime: 0,
      hitFlash: 0,
      vx: 72,
      minX: CFG.left + 24,
      maxX: CFG.right - 24 - 160,
      shotClock: 0
    };
    this.addWave(CFG.width / 2, 170, '#f6acff', 90, 0.4, 3);
    this.addParticles(CFG.width / 2, 170, 28, '#df96ff');
    beep(280, 0.17, 0.04, 'sawtooth');
    this.updateUI();
  },

  beginReactor() {
    if (this.sectorPhase !== 'bricks' || this.level !== LEVELS.length - 1) return;
    this.sectorPhase = 'reactor';
    this.boss = {
      kind: 'reactor',
      x: CFG.width / 2 - 94,
      y: 139,
      w: 188,
      h: 76,
      hp: 6,
      maxHp: 6,
      lock: 0,
      phaseTime: 0,
      hitFlash: 0,
      vx: 65,
      minX: CFG.left + 64,
      maxX: CFG.right - 64 - 188,
      shotClock: 0,
      nodes: [
        { offset: 36, hp: 2 },
        { offset: 94, hp: 2 },
        { offset: 152, hp: 2 }
      ]
    };
    this.addWave(CFG.width / 2, 179, '#f5b37b', 105, 0.4, 3);
    this.addParticles(CFG.width / 2, 179, 28, '#ffc690', { shard: true });
    beep(230, 0.2, 0.05, 'sawtooth');
    this.updateUI();
  },

  guardianVulnerable() {
    return this.boss !== null && this.boss.kind === 'guardian' && this.boss.phaseTime % 3.5 < 2.5;
  },

  reactorNodes() {
    const b = this.boss;
    return b?.kind === 'reactor' ? b.nodes.filter(n => n.hp > 0) : [];
  },

  damageReactor(node) {
    const boss = this.boss;
    if (
      !boss ||
      boss.kind !== 'reactor' ||
      this.state !== 'playing' ||
      boss.lock > 0 ||
      node.hp <= 0
    )
      return false;
    boss.lock = 0.16;
    boss.hitFlash = 0.2;
    node.hp--;
    boss.hp--;
    this.runStats.hits++;
    this.score += 400 * (this.level + 1);
    this.energy = clamp(this.energy + 14, 0, 100);
    const x = boss.x + node.offset,
      y = boss.y + boss.h - 10;
    this.addWave(x, y, '#ffd39d', 37, 0.24, 2);
    this.addParticles(x, y, 13, '#ffa96c', { shard: true, life: 0.36 });
    beep(480 + node.hp * 55, 0.09, 0.038, 'triangle');
    if (boss.hp <= 0) {
      this.score += 3000;
      this.runStats.broken++;
      this.addParticles(boss.x + boss.w / 2, boss.y + 38, 65, '#ffd39d', {
        shard: true,
        life: 0.62
      });
      this.addWave(boss.x + boss.w / 2, boss.y + 38, '#ffb973', 145, 0.5, 3, 'burst');
      this.addWave(boss.x + boss.w / 2, boss.y + 38, '#ff7bbc', 176, 0.57, 2);
      this.flash = Math.max(this.flash, this.reducedMotion ? 0.07 : 0.3);
      this.boss = null;
      this.sectorPhase = 'finished';
      this.completeLevel();
    } else {
      this.updateBest();
      this.updateUI();
    }
    return true;
  },

  reactorCollision(b, prevX, prevY) {
    const boss = this.boss;
    if (!boss || boss.kind !== 'reactor') return false;
    const cx = clamp(b.x, boss.x, boss.x + boss.w),
      cy = clamp(b.y, boss.y, boss.y + boss.h);
    if ((b.x - cx) ** 2 + (b.y - cy) ** 2 > b.r * b.r) return false;
    const node = boss.nodes.find(
      n =>
        n.hp > 0 &&
        (b.x - (boss.x + n.offset)) ** 2 + (b.y - (boss.y + boss.h - 10)) ** 2 <= (b.r + 18) ** 2
    );
    if (node && prevY - b.r >= boss.y + boss.h - 2 && b.vy < 0 && boss.lock <= 0)
      this.damageReactor(node);
    if (
      this.state === 'playing' &&
      (!node || prevY - b.r < boss.y + boss.h - 2 || b.vy >= 0 || this.timers.pulse <= 0)
    )
      this.reflectBallFromRect(boss, prevX, prevY, b);
    return true;
  },

  damageGuardian() {
    const boss = this.boss;
    if (!boss || this.state !== 'playing' || boss.lock > 0 || !this.guardianVulnerable())
      return false;
    boss.lock = 0.17;
    boss.hitFlash = 0.22;
    boss.hp--;
    this.runStats.hits++;
    this.score += 250 * (this.level + 1);
    this.energy = clamp(this.energy + 12, 0, 100);
    this.addParticles(boss.x + boss.w / 2, boss.y + boss.h / 2, 12, '#f6b3ff', {
      shard: true,
      life: 0.35
    });
    this.addWave(boss.x + boss.w / 2, boss.y + boss.h / 2, '#ffb5ec', 48, 0.22, 2);
    beep(420 + boss.hp * 40, 0.07, 0.035, 'triangle');
    if (boss.hp <= 0) {
      this.runStats.broken++;
      this.score += 1500;
      this.boss = null;
      this.sectorPhase = 'finished';
      this.addParticles(CFG.width / 2, boss.y + boss.h / 2, 60, '#ffcf94', {
        shard: true,
        life: 0.65
      });
      this.addWave(CFG.width / 2, boss.y + boss.h / 2, '#ffd09a', 110, 0.46, 3, 'burst');
      this.addWave(CFG.width / 2, boss.y + boss.h / 2, '#f5a8ff', 148, 0.56, 2);
      this.flash = Math.max(this.flash, this.reducedMotion ? 0.06 : 0.27);
      this.updateBest();
      this.completeLevel();
    } else {
      this.updateBest();
      this.updateUI();
    }
    return true;
  },

  shootBoss(boss) {
    if (this.enemyShots.length >= 4 || this.state !== 'playing') return;
    const x = boss.x + boss.w / 2,
      y = boss.y + boss.h + 8;
    const dx = clamp(this.paddle.x - x, -175, 175);
    const speed = boss.kind === 'reactor' ? 205 : 177;
    this.enemyShots.push({ x, y, vx: dx * 0.36, vy: speed, r: 8 });
    this.addWave(x, y, boss.kind === 'reactor' ? '#ffb76c' : '#ef94ff', 24, 0.19, 2);
    beep(240, 0.07, 0.03, 'sawtooth');
  },

  updateEnemyShots(dt) {
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const shot = this.enemyShots[i],
        oldY = shot.y;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      if (shot.y - shot.r > CFG.bottom || shot.x < CFG.left - 20 || shot.x > CFG.right + 20) {
        this.enemyShots.splice(i, 1);
        continue;
      }
      if (
        shot.vy > 0 &&
        oldY + shot.r <= this.paddle.y + 5 &&
        shot.y + shot.r >= this.paddle.y &&
        Math.abs(shot.x - this.paddle.x) <= this.paddle.w / 2 + shot.r
      ) {
        this.enemyShots.splice(i, 1);
        this.addParticles(shot.x, this.paddle.y, 14, '#ffae78');
        this.addWave(shot.x, this.paddle.y, '#ffc68a', 30, 0.24, 2);
        if (this.shieldCharges > 0) {
          this.shieldCharges = 0;
          this.runStats.barriers++;
          this.updateUI();
        } else this.dropBall();
        break;
      }
    }
  },

  updateBoss(dt) {
    if (this.state !== 'playing' || !this.boss) return;
    const boss = this.boss;
    boss.phaseTime += dt;
    boss.lock = Math.max(0, boss.lock - dt);
    boss.hitFlash = Math.max(0, boss.hitFlash - dt);
    boss.x += boss.vx * dt;
    if (boss.x > boss.maxX) {
      boss.x = boss.maxX - (boss.x - boss.maxX);
      boss.vx = -Math.abs(boss.vx);
    } else if (boss.x < boss.minX) {
      boss.x = boss.minX + (boss.minX - boss.x);
      boss.vx = Math.abs(boss.vx);
    }
    // У двух боссов разные высоты и частоты колебаний.
    const reactor = boss.kind === 'reactor';
    boss.y =
      (reactor ? 145 : 153) +
      (this.reducedMotion
        ? 0
        : (reactor ? 18 : 14) * Math.sin(boss.phaseTime * (reactor ? 0.95 : 1.25)));
    boss.shotClock += dt;
    const interval = reactor ? 2.9 : 3.5;
    if (boss.shotClock >= interval) {
      boss.shotClock -= interval;
      this.shootBoss(boss);
    }
  }
};
