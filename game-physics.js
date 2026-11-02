/*
 * Физика шара, геометрия препятствий и интеграция движения.
 *
 * Эти методы работают с текущим состоянием Game, не создавая вторую модель.
 * `advancePhysics` разбивает кадр на шаги не длиннее 6 мс: это уменьшает
 * вероятность проскока тонких блоков при нестабильном FPS. Подвижные кирпичи
 * перемещаются один раз за подшаг, а не отдельно для каждого шара.
 *
 * `collisionSide` и `reflectBallFromRect` учитывают положение шара ДО
 * перемещения — иначе касательные попадания могут открывать защищённую грань.
 * При контакте с взрывным кирпичом массив препятствий может уменьшиться во
 * время обхода; этот порядок операций нужен для корректности мультишара.
 *
 * Скрипт загружается до game.js; после объявления класса Game методы
 * подключаются к его прототипу без копирования игрового состояния.
 */
'use strict';

const IMPULSE_PHYSICS_METHODS = {
  stabilizeBallAngle(b = this.ball) {
    const speed = this.ballSpeed(b),
      minY = speed * 0.2;
    if (speed < 1 || Math.abs(b.vy) >= minY) return;
    const directionY = b.vy < 0 ? -1 : 1,
      directionX = b.vx < 0 ? -1 : 1;
    b.vy = directionY * minY;
    b.vx = directionX * Math.sqrt(speed * speed - minY * minY);
  },

  directionalClearance(brick, face = brick.face) {
    if (!face) return Infinity;
    if (face === 'L') return brick.x - CFG.left;
    if (face === 'R') return CFG.right - (brick.x + brick.w);
    if (face === 'U') return brick.y - CFG.top;
    return this.paddle.y - (brick.y + brick.h);
  },

  ensureDirectionalClearance(brick) {
    if (brick.type !== 'directional') return;
    // Между слабой гранью блока и стеной помещаются два радиуса мяча:
    // первый возле блока, второй возле границы арены.
    const required = 2 * CFG.ballRadius + 2;
    if (this.directionalClearance(brick) >= required) return;
    const fallback = ['D', 'U', 'L', 'R'].find(
      face => this.directionalClearance(brick, face) >= required
    );
    // При невозможной геометрии уровня сигнализируем об ошибке сразу,
    // вместо появления неуязвимого блока.
    if (!fallback)
      throw new Error('Недоступная грань направленного блока: ' + brick.row + ',' + brick.col);
    brick.face = fallback;
  },

  updateMovingBricks(dt) {
    // Свободно движущиеся цели используют общее поле препятствий, без искусственных рельсов.
    // Проверяем оси отдельно: отражаем цель от оставшихся кирпичей и стен.
    const movers = this.bricks.filter(b => b.type === 'moving');
    const occupied = (brick, x, y) =>
      this.bricks.some(
        other =>
          other !== brick &&
          x < other.x + other.w + 1 &&
          x + brick.w + 1 > other.x &&
          y < other.y + other.h + 1 &&
          y + brick.h + 1 > other.y
      );
    for (const brick of movers) {
      brick.directionClock -= dt;
      if (brick.directionClock <= 0) {
        const angle = Math.random() * Math.PI * 2,
          speed = 100;
        brick.vx = Math.cos(angle) * speed;
        brick.vy = Math.sin(angle) * speed;
        brick.directionClock = 1.4 + Math.random() * 1.3;
      }
      const x = brick.x + brick.vx * dt;
      if (x < CFG.left + 4 || x + brick.w > CFG.right - 4 || occupied(brick, x, brick.y)) {
        brick.vx = -brick.vx;
      } else brick.x = x;
      const y = brick.y + brick.vy * dt;
      if (
        y < CFG.brickStartY - 3 ||
        y + brick.h > this.paddle.y - 108 ||
        occupied(brick, brick.x, y)
      ) {
        brick.vy = -brick.vy;
      } else brick.y = y;
    }
  },

  collisionSide(rect, prevX, prevY, ball) {
    // Определяем грань по предыдущему положению краёв шара: касательные удары не меняют уязвимую сторону.
    if (prevY + ball.r <= rect.y + 1) return 'U';
    if (prevY - ball.r >= rect.y + rect.h - 1) return 'D';
    if (prevX + ball.r <= rect.x + 1) return 'L';
    if (prevX - ball.r >= rect.x + rect.w - 1) return 'R';
    const distances = [
      ['U', Math.abs(ball.y + ball.r - rect.y)],
      ['D', Math.abs(rect.y + rect.h - (ball.y - ball.r))],
      ['L', Math.abs(ball.x + ball.r - rect.x)],
      ['R', Math.abs(rect.x + rect.w - (ball.x - ball.r))]
    ];
    distances.sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  },

  advancePhysics(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.006));
    for (let step = 0; step < steps; step++) {
      if (this.state !== 'playing') break;
      const subdt = dt / steps;
      this.updateMovingBricks(subdt);
      for (const ball of this.activeBalls()) {
        if (this.state !== 'playing') break;
        // При взрыве или потере жизни шар мог быть удалён прямо в этом кадре.
        if (ball !== this.ball && !this.extraBalls.includes(ball)) continue;
        this.moveBall(subdt, ball, false);
      }
    }
    if (this.state === 'playing')
      for (const ball of this.activeBalls()) {
        if (!ball.held) ball.trail.push({ x: ball.x, y: ball.y, life: 0.2 });
        if (ball.trail.length > 18) ball.trail.shift();
        for (const particle of ball.trail) particle.life -= dt;
        ball.trail = ball.trail.filter(particle => particle.life > 0);
      }
  },

  moveBall(dt, b = this.ball, advanceMoving = true) {
    if (b.held) return;
    const prevX = b.x,
      prevY = b.y;
    if (advanceMoving) this.updateMovingBricks(dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x - b.r < CFG.left) {
      b.x = CFG.left + b.r;
      b.vx = Math.abs(b.vx);
      beep(390, 0.035, 0.017);
    }
    if (b.x + b.r > CFG.right) {
      b.x = CFG.right - b.r;
      b.vx = -Math.abs(b.vx);
      beep(390, 0.035, 0.017);
    }
    if (b.y - b.r < CFG.top) {
      b.y = CFG.top + b.r;
      b.vy = Math.abs(b.vy);
      beep(390, 0.035, 0.017);
    }
    if (b.y - b.r > CFG.bottom) {
      if (this.shieldCharges > 0) {
        this.shieldCharges = 0;
        this.runStats.barriers++;
        this.resetCombo();
        b.y = this.paddle.y - b.r - 4;
        b.vy = -Math.max(80, Math.abs(b.vy));
        this.flash = 0.25;
        this.addParticles(b.x, CFG.bottom - 12, 18, '#87ffcf');
        beep(720, 0.12, 0.04);
        this.updateUI();
      } else {
        this.removeBall(b);
        return;
      }
    }
    if (
      b.vy > 0 &&
      b.y + b.r >= this.paddle.y &&
      prevY + b.r <= this.paddle.y + 5 &&
      Math.abs(b.x - this.paddle.x) <= this.paddle.w / 2 + b.r
    ) {
      b.y = this.paddle.y - b.r - 1;
      const relative = clamp((b.x - this.paddle.x) / (this.paddle.w / 2), -0.94, 0.94),
        speed = clamp(this.ballSpeed(b) * 1.017, this.levelSpeed(), CFG.maxSpeed);
      if (this.timers.magnet > 0 && this.timers.pulse <= 0) {
        b.held = true;
        b.holdTime = 1.2;
        b.holdOffset = clamp(b.x - this.paddle.x, -this.paddle.w / 2 + 12, this.paddle.w / 2 - 12);
        b.vx = 0;
        b.vy = 0;
        this.resetCombo();
        this.updateUI();
        beep(600, 0.09, 0.03, 'sine');
        return;
      }
      let angle = relative * 1.11;
      // Центральное попадание не должно создавать бесконечную вертикальную траекторию.
      if (Math.abs(angle) < 0.12) angle = (b.vx < 0 ? -1 : 1) * 0.12;
      b.vx = speed * Math.sin(angle);
      b.vy = -Math.abs(speed * Math.cos(angle));
      this.resetCombo();
      beep(275 + Math.abs(relative) * 180, 0.055, 0.023);
    }
    for (let i = this.bricks.length - 1; i >= 0; i--) {
      // Взрыв может удалить сразу несколько соседних блоков во время обхода.
      // Массив может сократиться более чем на одну позицию, поэтому
      // каждый индекс проверяем, особенно при пробивном мультишаре.
      const brick = this.bricks[i];
      if (!brick) continue;
      if (brick.lock > 0) continue;
      const closeX = clamp(b.x, brick.x, brick.x + brick.w),
        closeY = clamp(b.y, brick.y, brick.y + brick.h);
      if ((b.x - closeX) ** 2 + (b.y - closeY) ** 2 > b.r ** 2) continue;
      const sided = brick.type === 'directional';
      const permitted = !sided || this.collisionSide(brick, prevX, prevY, b) === brick.face;
      const pierced = this.timers.pulse > 0;
      if (permitted) {
        if (this.hitBrick(brick, i) && !pierced) {
          this.reflectBallFromRect(brick, prevX, prevY, b);
          break;
        }
      } else {
        this.reflectBallFromRect(brick, prevX, prevY, b);
        if (!this.reducedMotion) this.addWave(b.x, b.y, '#9effdd', 15, 0.12, 1.3);
        break;
      }
      if (this.state !== 'playing') break;
    }
    if (this.boss?.kind === 'reactor' && this.state === 'playing')
      this.reactorCollision(b, prevX, prevY);
    if (this.boss?.kind === 'guardian' && this.state === 'playing') {
      const guardian = this.boss;
      const closeX = clamp(b.x, guardian.x, guardian.x + guardian.w);
      const closeY = clamp(b.y, guardian.y, guardian.y + guardian.h);
      if ((b.x - closeX) ** 2 + (b.y - closeY) ** 2 <= b.r * b.r) {
        const vulnerable = this.guardianVulnerable();
        if (
          guardian.lock <= 0 &&
          vulnerable &&
          prevY - b.r >= guardian.y + guardian.h - 2 &&
          b.vy < 0
        )
          this.damageGuardian();
        // Защищённый босс отражает шар; пробивание действует только в уязвимой фазе.
        if (
          this.state === 'playing' &&
          (!vulnerable ||
            prevY - b.r < guardian.y + guardian.h - 2 ||
            b.vy >= 0 ||
            this.timers.pulse <= 0)
        )
          this.reflectBallFromRect(guardian, prevX, prevY, b);
      }
    }
    if (this.state === 'playing') this.stabilizeBallAngle(b);
  },

  reflectBallFromRect(rect, prevX, prevY, b = this.ball) {
    const fromTop = prevY + b.r <= rect.y;
    const fromBottom = prevY - b.r >= rect.y + rect.h;
    const fromLeft = prevX + b.r <= rect.x;
    const fromRight = prevX - b.r >= rect.x + rect.w;
    const dx = Math.min(b.x + b.r - rect.x, rect.x + rect.w - b.x + b.r);
    const dy = Math.min(b.y + b.r - rect.y, rect.y + rect.h - b.y + b.r);
    if ((fromLeft || fromRight) && ((!fromTop && !fromBottom) || dx < dy)) {
      if (fromLeft) {
        b.x = rect.x - b.r - 1;
        b.vx = -Math.abs(b.vx);
      } else {
        b.x = rect.x + rect.w + b.r + 1;
        b.vx = Math.abs(b.vx);
      }
    } else if (fromTop) {
      b.y = rect.y - b.r - 1;
      b.vy = -Math.abs(b.vy);
    } else if (fromBottom) {
      b.y = rect.y + rect.h + b.r + 1;
      b.vy = Math.abs(b.vy);
    } else if (dx < dy) {
      if (b.x < rect.x + rect.w / 2) {
        b.x = rect.x - b.r - 1;
        b.vx = -Math.abs(b.vx);
      } else {
        b.x = rect.x + rect.w + b.r + 1;
        b.vx = Math.abs(b.vx);
      }
    } else {
      if (b.y < rect.y + rect.h / 2) {
        b.y = rect.y - b.r - 1;
        b.vy = -Math.abs(b.vy);
      } else {
        b.y = rect.y + rect.h + b.r + 1;
        b.vy = Math.abs(b.vy);
      }
    }
  }
};
