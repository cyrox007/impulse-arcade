# GitHub Pages: диагностика развёртывания

**Состояние на 01.11.2026:** тестовый сайт публикуется из `develop`, папка предполагается `/(root)`. Поступил снимок GitHub Checks: 4 проверки успешны, **одна неуспешна — «pages build and deployment / deploy (dynamic)»**. Это проблема **публикации**, а не подтверждённая ошибка JavaScript, CSS или мобильного UI. Текст ошибки внутри шага deployment пока неизвестен.

## Что известно

- В `develop` находятся `index.html`, `style.css`, `game.js` и новый мобильный UI `UI 0.2`.
- CI `verify` и `browser-smoke` прошли в PR #4 и #5.
- Пользователь ранее открыл сайт в мобильном браузере, но увидел прежнюю компоновку.
- Изменение URL CSS и маркера UI в PR #5 **не могло само устранить сбой deployment**.
- При публикации из ветки GitHub запускает собственную задачу `pages build and deployment`, не наш `.github/workflows/pages.yml`.

## Диагностика (основной способ: сохранить branch deployment)

1. Открыть [Actions](https://github.com/cyrox007/impulse-arcade/actions), выбрать неуспешный **pages build and deployment**.
2. Открыть красную задачу **deploy (dynamic)**, найти **первую строку Error** и точный HTTP-статус (403, 404, 422, 500 и т. п.). Не угадывать причину до чтения журнала.
3. Проверить Settings → Pages: Source = **Deploy from a branch**, Branch = **develop**, Folder = **/(root)**.
4. Если журнал упоминает ограничения веток для environment `github-pages`, проверить Settings → Environments → `github-pages` → Deployment branches; ветка `develop` должна быть разрешена.
5. Если проблема временная на стороне GitHub (5xx), повторить неудачную задачу из Actions. Не делать серию бессмысленных CSS-коммитов.
6. При успешном deploy открыть https://cyrox007.github.io/impulse-arcade/?build=mobile-ui-02-20261101 и проверить маркер **АРКАДА • UI 0.2**.

В корне добавлен `.nojekyll`: он избавляет статический сайт от обработки Jekyll, **но не гарантирует исправления ошибки именно на шаге deploy**.

## Альтернативный способ публикации (если branch deployment продолжает падать)

В репозитории есть `.github/workflows/pages.yml`, намеренно настроенный на **ручной запуск**, чтобы не конкурировать с выбранным пользователем способом.

1. В Settings → Pages переключить **Source** с *Deploy from a branch* на **GitHub Actions**.
2. Открыть Actions → **Публикация Импульса (GitHub Pages)** → **Run workflow** → выбрать **develop**.
3. Workflow проверит Node-тесты, соберёт только `index.html`, `game.js`, `style.css`, `.nojekyll`, затем вызовет `actions/deploy-pages@v4`.
4. Дождаться (в самой GitHub Actions UI) успешной публикации и проверить URL в мобильном браузере.

**Важно:** переключение Source — действие владельца в настройках; само по себе присутствие workflow не переводит Pages в режим GitHub Actions. Не считать проблему решённой до зелёного деплоя и проверки публичной страницы.
