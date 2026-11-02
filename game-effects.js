/*
 * Бонусы, временные усиления и лёгкие визуальные эффекты «Импульса».
 *
 * Усиление скорости или размеров платформы отменяется только по истечении
 * соответствующего таймера. Замедление компенсируется обратным множителем
 * один раз, иначе накопится ошибка скорости.
 * Взрывы и эффекты не увеличивают число очков сами по себе — за начисление
 * очков отвечает игровая модель. Количество частиц и волн ограничено.
 *
 * Методы используют общие параметры CFG и текущее состояние Game.
 */
'use strict';

const IMPULSE_EFFECT_METHODS = {
  pulse() {
    if (this.state !== 'playing' || this.energy < 100 || this.timers.pulse > 0) return;
    this.energy = 0;
    this.timers.pulse = CFG.pulseDuration;
    this.flash = 0.36;
    this.runStats.pulses++;
    this.releaseHeldBalls();
    this.addParticles(this.ball.x, this.ball.y, 28, '#ff85d9');
    for (const ball of this.activeBalls())
      this.setBallSpeed(clamp(this.ballSpeed(ball) * 1.13, this.levelSpeed(), CFG.maxSpeed), ball);
    beep(520, 0.25, 0.06, 'sawtooth');
    this.updateUI();
  },

  splitBall() {
    if (this.state !== 'playing' || this.activeBalls().length >= 3) return false;
    this.releaseHeldBalls();
    const source = this.activeBalls().find(b => !b.held && this.ballSpeed(b) > 1);
    if (!source) return false;
    const speed = clamp(this.ballSpeed(source), this.levelSpeed(), CFG.maxSpeed);
    const base = Math.atan2(source.vx, Math.abs(source.vy));
    for (const sign of [-1, 1]) {
      if (this.activeBalls().length >= 3) break;
      const angle = clamp(base + sign * 0.48, -1.06, 1.06);
      this.extraBalls.push({
        x: clamp(source.x + sign * 13, CFG.left + source.r, CFG.right - source.r),
        y: source.y - 5,
        vx: speed * Math.sin(angle),
        vy: -speed * Math.cos(angle),
        r: source.r,
        trail: []
      });
    }
    this.runStats.splits++;
    this.addWave(source.x, source.y, '#ceacff', 42, 0.25, 2);
    beep(930, 0.1, 0.045, 'triangle');
    this.updateUI();
    return true;
  },

  releaseHeldBalls() {
    let count = 0;
    for (const b of this.activeBalls()) {
      if (!b.held) continue;
      b.held = false;
      b.holdTime = 0;
      const speed = this.levelSpeed() * (this.timers.slow > 0 ? 0.75 : 1);
      const angle = clamp(((b.holdOffset || 0) / (this.paddle.w / 2)) * 0.75, -0.85, 0.85);
      b.vx = speed * Math.sin(Math.abs(angle) < 0.12 ? 0.16 : angle);
      b.vy = -Math.sqrt(speed * speed - b.vx * b.vx);
      count++;
    }
    if (count) this.updateUI();
    return count;
  },

  maybeDrop(brick) {
    if (Math.random() > LEVELS[this.level].dropChance) return;
    const t = Math.random(),
      type =
        t < 0.28
          ? 'wide'
          : t < 0.49
            ? 'slow'
            : t < 0.64
              ? 'shield'
              : t < 0.78
                ? 'multi'
                : t < 0.92
                  ? 'magnet'
                  : 'life';
    this.drops.push({ x: brick.x + brick.w / 2, y: brick.y + brick.h / 2, vy: 115, type, spin: 0 });
  },

  applyDrop(type) {
    if (type === 'wide') {
      this.timers.wide = CFG.wideDuration;
      this.paddle.w = 145;
    }
    if (type === 'slow') {
      if (this.timers.slow <= 0)
        for (const ball of this.activeBalls())
          if (this.ballSpeed(ball) > 0)
            this.setBallSpeed(Math.max(195, this.ballSpeed(ball) * 0.75), ball);
      this.timers.slow = CFG.slowDuration;
    }
    if (type === 'magnet') this.timers.magnet = 12;
    if (type === 'multi') this.splitBall();
    if (type === 'life') this.lives = Math.min(5, this.lives + 1);
    if (type === 'shield') this.shieldCharges = 1;
    this.score += 75;
    this.updateBest();
    this.addParticles(this.paddle.x, this.paddle.y, 12, '#ffc477');
    beep(850, 0.13, 0.05);
    this.updateUI();
  },

  blockEffect(brick, destroyed, secondary = false) {
    const x = brick.x + brick.w / 2,
      y = brick.y + brick.h / 2;
    const colors = {
      normal: ['#6bcdff', '#b8f5ff'],
      moving: ['#89ffde', '#d6ffed'],
      charge: ['#ffdf80', '#fff4c4'],
      prism: ['#ae9aff', '#eadfff'],
      armor: ['#f0ba6c', '#fff0b7'],
      core: ['#ef83fc', '#ffd5ff'],
      blast: ['#ff8d50', '#ffe2a1'],
      directional: ['#8cffd1', '#dbfff1']
    };
    const [color, highlight] = colors[brick.type] || colors.normal;
    const amount = destroyed
      ? brick.type === 'blast'
        ? 14
        : brick.type === 'armor'
          ? 11
          : 9
      : brick.type === 'armor'
        ? 5
        : 3;
    this.addParticles(x, y, secondary ? Math.min(amount, 6) : amount, color, {
      shard: destroyed,
      life: destroyed ? 0.44 : 0.27
    });
    if (!destroyed) {
      if (brick.type === 'armor') this.addWave(x, y, highlight, 18, 0.14, 1.6);
      return;
    }
    if (
      brick.type === 'normal' ||
      brick.type === 'moving' ||
      brick.type === 'charge' ||
      brick.type === 'prism' ||
      brick.type === 'directional'
    ) {
      // Стеклянные осколки и короткий голубой импульс.
      this.addWave(x, y, highlight, 33, 0.2, 1.5);
    } else if (brick.type === 'armor') {
      // Тяжёлые янтарные осколки и компактная металлическая ударная волна.
      this.addWave(x, y, highlight, 41, 0.26, 2.3);
    } else if (brick.type === 'core') {
      // Две последовательно расходящиеся энергетические волны.
      this.addWave(x, y, color, 49, 0.32, 2.6);
      this.addWave(x, y, highlight, 28, 0.2, 1.5);
    } else if (brick.type === 'blast') {
      // Короткий радиальный взрыв без повторного игрового урона.
      this.addWave(x, y, color, 64, 0.31, 3.5, 'burst');
      this.addWave(x, y, highlight, 95, 0.35, 1.8);
      this.flash = Math.max(this.flash, this.reducedMotion ? 0.05 : 0.12);
    }
  },

  addWave(x, y, color, radius, duration, width = 2, kind = 'ring') {
    if (this.reducedMotion) return;
    if (this.waves.length >= 24) this.waves.splice(0, this.waves.length - 23);
    this.waves.push({ x, y, color, radius, duration, life: duration, width, kind });
  },

  addParticles(x, y, n, color, { shard = false, life = 0 } = {}) {
    // Ограничиваем количество эффектов при серии комбо, взрывах и множественном разрушении.
    const max = 180,
      count = Math.min(this.reducedMotion ? Math.ceil(n * 0.33) : n, max);
    if (this.particles.length + count > max)
      this.particles.splice(0, this.particles.length + count - max);
    for (let i = 0; i < count; i++) {
      const duration = life || random(0.3, 0.75);
      this.particles.push({
        x,
        y,
        vx: random(-170, 170),
        vy: random(-180, 160),
        life: duration,
        maxLife: duration,
        color,
        r: random(shard ? 2.4 : 1.1, shard ? 5 : 3.4),
        shard
      });
    }
  },

  updateEffectTimers(dt) {
    for (const brick of this.bricks) brick.lock = Math.max(0, brick.lock - dt);
    for (const kind of ['pulse', 'wide', 'slow', 'magnet']) {
      if (this.timers[kind] <= 0) continue;
      const previous = this.timers[kind];
      this.timers[kind] = Math.max(0, previous - dt);
      if (previous > 0 && this.timers[kind] === 0) {
        if (kind === 'wide') this.paddle.w = CFG.paddleW;
        if (kind === 'slow') {
          for (const ball of this.activeBalls())
            if (this.ballSpeed(ball) > 0)
              this.setBallSpeed(Math.min(CFG.maxSpeed, this.ballSpeed(ball) / 0.75), ball);
        }
        if (kind === 'pulse') {
          for (const ball of this.activeBalls())
            if (this.ballSpeed(ball) > CFG.maxSpeed * 0.83)
              this.setBallSpeed(CFG.maxSpeed * 0.83, ball);
        }
        this.updateUI();
      }
    }
  },

  updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y += d.vy * dt;
      d.spin += dt * 4;
      if (
        d.y > this.paddle.y - 8 &&
        d.y < this.paddle.y + this.paddle.h + 10 &&
        Math.abs(d.x - this.paddle.x) < this.paddle.w / 2 + 9
      ) {
        this.drops.splice(i, 1);
        this.applyDrop(d.type);
      } else if (d.y > CFG.height + 15) this.drops.splice(i, 1);
    }
  }
};
