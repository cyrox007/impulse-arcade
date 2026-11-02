/*
 * Интерфейс, настройки и экраны результатов «Импульса».
 *
 * Методы читают существующее состояние Game, не копируют его в отдельную
 * модель представления. Открытие настроек ставит игру на паузу; закрытие
 * не запускает мяч самостоятельно. Результаты формируются из runStats.
 * Загрузка должна происходить до создания экземпляра Game.
 */
'use strict';

const IMPULSE_UI_METHODS = {
  syncSettingsUI() {
    ui.volume.value = String(this.settings.volume);
    ui.volumeText.textContent = this.settings.volume + '%';
    ui.effects.value = this.settings.effects;
    ui.sensitivity.value = String(this.settings.sensitivity);
    ui.sensitivityText.textContent = this.settings.sensitivity + '%';
    ui.sound.querySelector('.sound-state').textContent = this.settings.sound ? 'ВКЛ' : 'ВЫКЛ';
    ui.sound.setAttribute('aria-label', this.settings.sound ? 'Выключить звук' : 'Включить звук');
  },

  setSetting(key, value) {
    if (key === 'volume' || key === 'sensitivity') value = Number(value);
    const next = { ...this.settings, [key]: value };
    if (
      typeof next.sound !== 'boolean' ||
      !Number.isInteger(next.volume) ||
      next.volume < 0 ||
      next.volume > 100 ||
      !['auto', 'full', 'reduced'].includes(next.effects) ||
      !Number.isInteger(next.sensitivity) ||
      next.sensitivity < 70 ||
      next.sensitivity > 130
    )
      return false;
    this.settings = next;
    soundEnabled = next.sound;
    masterVolume = next.volume / 100;
    this.reducedMotion =
      next.effects === 'reduced' ||
      (next.effects === 'auto' &&
        Boolean(
          window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ));
    if (this.reducedMotion) {
      this.waves = [];
      if (this.particles.length > 60) this.particles.splice(0, this.particles.length - 60);
    }
    safeSaveSettings(next);
    this.syncSettingsUI();
    return true;
  },

  toggleSettings(force) {
    const open = force === undefined ? !this.settingsOpen : Boolean(force);
    if (open === this.settingsOpen) return;
    this.settingsOpen = open;
    if (open && this.state === 'playing') this.togglePause();
    ui.settingsPanel.hidden = !open;
    ui.settingsButton.setAttribute('aria-expanded', String(open));
    if (open) ui.settingsClose.focus();
    else ui.settingsButton.focus();
  },

  runStatsMarkup() {
    const totalSeconds = Math.floor(Math.max(0, this.runStats.seconds));
    const elapsed = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
    const stats = this.runStats;
    return `<div class="run-stats" role="group" aria-label="Статистика забега">
      <div><span>ВРЕМЯ</span><strong>${elapsed}</strong></div>
      <div><span>БЛОКОВ</span><strong>${stats.broken}</strong></div>
      <div><span>ЛУЧШАЯ СЕРИЯ</span><strong>${stats.maxCombo}</strong></div>
    </div>
    <div class="run-stats-more">ПОПАДАНИЯ: ${stats.hits} · ИМПУЛЬСЫ: ${stats.pulses} · СПАСЕНИЯ: ${stats.barriers} · РАЗДЕЛЕНИЯ: ${stats.splits}</div>`;
  },

  overlayContent(kind) {
    const checkpoint = this.checkpoint && ['intro', 'lost'].includes(kind) ? this.checkpoint : null;
    const resumeLabel = checkpoint
      ? 'ПРОДОЛЖИТЬ · СЕКТОР ' + String(checkpoint.sector + 1).padStart(2, '0')
      : null;
    const common = {
      intro: {
        icon: '✦',
        kicker: 'НОВАЯ АРКАДА',
        title: 'ИМПУЛЬС',
        text: 'Пять секторов, мультишар и новые испытания. В третьем секторе Страж ядра, в пятом — Реактор.',
        action: resumeLabel || 'НАЧАТЬ ИГРУ',
        small: checkpoint
          ? 'Сохранено на этом устройстве в начале сектора ' + (checkpoint.sector + 1) + '.'
          : 'На телефоне двигай платформу пальцем по полю. На ПК — мышь или стрелки.'
      },
      pause: {
        icon: 'Ⅱ',
        kicker: 'ИГРА ПРИОСТАНОВЛЕНА',
        title: 'ПАУЗА',
        text: 'Шар ждёт твоего возвращения.',
        action: 'ПРОДОЛЖИТЬ',
        small: 'Клавиша P — пауза / продолжить.'
      },
      between: {
        icon: '✧',
        kicker: 'СЕКТОР ОЧИЩЕН',
        title: 'ОТЛИЧНАЯ РАБОТА',
        text: `Следующий сектор: ${LEVELS[this.level + 1]?.name ?? 'ФИНАЛ'}. Бонус за жизни: +${this.lastSectorBonus}. Лучшая серия: ${this.lastSectorBestCombo}. Жизни и счёт сохраняются.`,
        action: 'СЛЕДУЮЩИЙ СЕКТОР',
        small: 'Впереди более прочные блоки.'
      },
      won: {
        icon: '★',
        kicker: 'МИССИЯ ВЫПОЛНЕНА',
        title: 'ПЯТЬ СЕКТОРОВ И ДВА БОССА ПРОЙДЕНЫ',
        text: `Финальный счёт: ${this.score.toLocaleString('ru-RU')}. Бонус финального сектора: +${this.lastSectorBonus}. Твой рекорд: ${this.best.toLocaleString('ru-RU')}.`,
        action: 'СЫГРАТЬ СНОВА',
        small: 'Рекорд сохранён на этом устройстве.'
      },
      lost: {
        icon: '✕',
        kicker: 'ПОПЫТКА ЗАВЕРШЕНА',
        title: 'ИГРА ОКОНЧЕНА',
        text: `Ты набрал ${this.score.toLocaleString('ru-RU')} очков. Попробуй ещё раз!`,
        action: resumeLabel || 'НОВАЯ ПОПЫТКА',
        small: checkpoint
          ? 'Сохранена контрольная точка перед сектором ' + (checkpoint.sector + 1) + '.'
          : 'Результат можно улучшить новой попыткой.'
      }
    }[kind];
    const results = kind === 'won' || kind === 'lost' ? this.runStatsMarkup() : '';
    return `<div class="overlay-icon" aria-hidden="true">${common.icon}</div><div class="overlay-kicker">${common.kicker}</div><h2>${common.title}</h2><p>${common.text}</p>${results}<button type="button" class="overlay-action" id="overlayAction">${common.action}</button>${checkpoint ? '<button type="button" class="overlay-action overlay-new-game" id="newGameAction">НОВАЯ ИГРА</button>' : ''}<div class="overlay-small">${common.small}</div>`;
  },

  showOverlay(kind) {
    ui.overlay.innerHTML = this.overlayContent(kind);
    ui.overlay.hidden = false;
    ui.overlay
      .querySelector('#overlayAction')
      .addEventListener('click', () => this.launch(), { once: true });
    if (this.checkpoint && ['intro', 'lost'].includes(kind))
      ui.overlay
        .querySelector('#newGameAction')
        .addEventListener('click', () => this.startNewGame(), { once: true });
  },

  hideOverlay() {
    ui.overlay.hidden = true;
    ui.overlay.innerHTML = '';
  },

  updateUI() {
    ui.score.textContent = String(this.score).padStart(6, '0');
    ui.best.textContent = String(this.best).padStart(6, '0');
    ui.lives.textContent = '♥ '.repeat(Math.max(0, this.lives)).trim() || '—';
    // Счётчик относится только к фазе кирпичей: во время боя с боссом
    // число 0 не должно создавать впечатление завершённого сектора.
    const remaining =
      this.sectorPhase === 'bricks' && this.bricks.length ? ` · ${this.bricks.length} БЛОКОВ` : '';
    ui.stage.textContent = `СЕКТОР ${String(this.level + 1).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}${remaining}`;
    ui.compactSector.textContent = `${String(this.level + 1).padStart(2, '0')}/${String(LEVELS.length).padStart(2, '0')}`;
    ui.charge.style.width = `${this.energy}%`;
    ui.chargeText.textContent = `${Math.floor(this.energy)}%`;
    ui.chargeBar.setAttribute('aria-valuenow', String(Math.floor(this.energy)));
    ui.pulse.disabled = this.state !== 'playing' || this.energy < 100 || this.timers.pulse > 0;
    ui.pulseLabel.textContent =
      this.timers.pulse > 0
        ? 'ПРОБИТИЕ!'
        : this.energy >= 100
          ? 'ИМПУЛЬС ГОТОВ'
          : `ИМПУЛЬС ${Math.floor(this.energy)}%`;
    const labels = {
      menu: 'СТАРТ',
      ready: 'ЗАПУСК ШАРА',
      playing: 'ШАР В ИГРЕ',
      paused: 'ПРОДОЛЖИТЬ',
      between: 'СЛЕД. СЕКТОР',
      won: 'СНОВА',
      lost: 'ПОВТОРИТЬ'
    };
    ui.launchLabel.textContent =
      this.state === 'playing' && this.activeBalls().some(b => b.held)
        ? 'ОТПУСТИТЬ ШАР'
        : labels[this.state];
    ui.launch.disabled = this.state === 'playing' && !this.activeBalls().some(b => b.held);
    ui.pause.disabled = !['ready', 'playing', 'paused'].includes(this.state);
    ui.pause.textContent = this.state === 'paused' ? '▶' : 'Ⅱ';
    ui.hint.textContent = this.activeBalls().some(b => b.held)
      ? 'Мяч пойман магнитом: коснись поля или нажми «Отпустить шар».'
      : this.timers.pulse > 0
        ? 'Пробивной импульс активен: шары проходят сквозь блоки.'
        : this.energy >= 100
          ? 'Заряд готов! Нажми «ИМПУЛЬС» или F.'
          : this.state === 'ready'
            ? 'Нажми «Запуск шара» или коснись игрового поля.'
            : 'Разбивай блоки, чтобы зарядить пробивной импульс.';
  }
};
