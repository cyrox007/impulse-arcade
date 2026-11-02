/*
 * Управление, главный кадровый цикл и диагностический снимок игры.
 * Подключается после всех модулей и game.js: использует созданный
 * экземпляр Game, но не содержит правил столкновений и начисления очков.
 */
'use strict';

const pointerToX = e => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return;
  const desired = (e.clientX - rect.left) * (CFG.width / rect.width);
  game.targetX = clamp(
    game.paddle.x + ((desired - game.paddle.x) * game.settings.sensitivity) / 100,
    CFG.left + game.paddle.w / 2,
    CFG.right - game.paddle.w / 2
  );
};
canvas.addEventListener('pointerdown', e => {
  if (game.settingsOpen || game.activePointerId !== null) return; // Игнорируем другие пальцы и касания при открытых настройках.
  if (e.pointerType === 'touch' && e.cancelable) e.preventDefault();
  game.activePointerId = e.pointerId;
  pointerToX(e);
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (_) {}
  if (game.state === 'ready' || (game.state === 'playing' && game.activeBalls().some(b => b.held)))
    game.launch();
});
canvas.addEventListener('pointermove', e => {
  if (
    !game.settingsOpen &&
    (e.pointerId === game.activePointerId ||
      (e.pointerType === 'mouse' && game.activePointerId === null))
  )
    pointerToX(e);
});
const releasePointer = e => {
  if (e.pointerId === game.activePointerId) game.activePointerId = null;
};
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
ui.launch.addEventListener('click', () => game.launch());
ui.pulse.addEventListener('click', () => game.pulse());
ui.pause.addEventListener('click', () => game.togglePause());
ui.sound.addEventListener('click', () => {
  game.setSetting('sound', !game.settings.sound);
  if (soundEnabled) beep(650, 0.07);
});
ui.settingsButton.addEventListener('click', () => game.toggleSettings());
ui.settingsClose.addEventListener('click', () => game.toggleSettings(false));
ui.settingsDone.addEventListener('click', () => game.toggleSettings(false));
ui.volume.addEventListener('input', () => game.setSetting('volume', ui.volume.value));
ui.effects.addEventListener('change', () => game.setSetting('effects', ui.effects.value));
ui.sensitivity.addEventListener('input', () =>
  game.setSetting('sensitivity', ui.sensitivity.value)
);
window.addEventListener('keydown', e => {
  // Не перехватываем стрелки и пробел у ползунков в панели настроек:
  // браузер должен самостоятельно обрабатывать управление доступными полями.
  if (game.settingsOpen) {
    if (e.code === 'Escape') {
      game.toggleSettings(false);
      e.preventDefault();
    }
    return;
  }
  if (
    [
      'ArrowLeft',
      'ArrowRight',
      'Space',
      'KeyA',
      'KeyD',
      'KeyF',
      'KeyP',
      'Escape',
      'Enter'
    ].includes(e.code)
  )
    e.preventDefault();
  game.keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') game.launch();
  if (e.code === 'KeyF') game.pulse();
  if (e.code === 'KeyP' || e.code === 'Escape') game.togglePause();
});
window.addEventListener('keyup', e => {
  game.keys[e.code] = false;
});
window.addEventListener('blur', () => {
  game.keys = {};
  game.activePointerId = null;
  if (game.state === 'playing') game.togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.keys = {};
    game.activePointerId = null;
    if (game.state === 'playing') game.togglePause();
  }
});
let last = performance.now();
function loop(now) {
  const frameMs = Math.max(0, now - last);
  last = now;
  const dt = Math.min(0.033, frameMs / 1000);
  // Замеры времени обновления и отрисовки выполняются только при ?fps=1.
  const profile = game.profileEnabled;
  const begin = profile ? performance.now() : 0;
  game.update(dt);
  const updated = profile ? performance.now() : 0;
  game.draw();
  const drawn = profile ? performance.now() : 0;
  const m = game.performance;
  if (frameMs > 500) {
    m.frames = 0;
    m.seconds = 0;
    m.worst = 0;
    m.updateTotalMs = 0;
    m.drawTotalMs = 0;
  } else {
    m.frames++;
    m.seconds += frameMs / 1000;
    m.worst = Math.max(m.worst, frameMs);
    if (profile) {
      m.updateTotalMs += updated - begin;
      m.drawTotalMs += drawn - updated;
    }
    if (m.seconds >= 1) {
      m.fps = Math.round(m.frames / m.seconds);
      m.maxFrameMs = Math.round(m.worst);
      if (profile) {
        m.avgUpdateMs = Math.round((100 * m.updateTotalMs) / m.frames) / 100;
        m.avgDrawMs = Math.round((100 * m.drawTotalMs) / m.frames) / 100;
      }
      m.frames = 0;
      m.seconds = 0;
      m.worst = 0;
      m.updateTotalMs = 0;
      m.drawTotalMs = 0;
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// Открываем только диагностический снимок состояния для smoke-тестов, без возможности читерства.
window.__impulseDebug = () => ({
  state: game.state,
  score: game.score,
  level: game.level,
  lives: game.lives,
  bricks: game.bricks.length,
  energy: game.energy,
  combo: game.comboHits,
  fps: game.performance.fps,
  maxFrameMs: game.performance.maxFrameMs,
  avgUpdateMs: game.performance.avgUpdateMs,
  avgDrawMs: game.performance.avgDrawMs,
  spritePaintCount: game.spritePaintCount,
  shots: game.enemyShots.length,
  balls: game.activeBalls().length,
  held: game.activeBalls().filter(b => b.held).length,
  moving: game.bricks.filter(b => b.type === 'moving').length,
  phase: game.sectorPhase,
  checkpointSector: game.checkpoint?.sector ?? null,
  settings: { ...game.settings },
  bossHP: game.boss?.hp ?? 0,
  shield: game.shieldCharges,
  particles: game.particles.length,
  waves: game.waves.length,
  stats: { ...game.runStats }
});
