# Сборка из исходников (для ревьюеров AMO)

Нужны: Node.js 22+ и npm 10+ (проверено на Node 22).

```bash
cd forum-article-saver  # если архив распакован — корень этого архива
npm ci                # ставит зависимости строго по package-lock.json
npm run build:firefox # результат: dist/firefox-mv3/ (то, что внутри загруженного zip)
npm run zip           # (опционально) dist/forum-article-saver-<версия>-firefox.zip
```

Инструменты сборки: WXT (Vite), TypeScript, Preact. Код минифицируется стандартным Vite/esbuild.
Сторонний код в сборке: `preact` (интерфейс) и `@mozilla/readability` (выделение основного текста страницы;
версии зафиксированы в `package-lock.json`). Предупреждения «Unsafe assignment to innerHTML» относятся
к внутренностям этих двух библиотек; в коде самого расширения `innerHTML` не используется.

Проверка: `npm run typecheck && npm test` (юнит-тесты), `npm run e2e` (нужен Chromium).

## Firefox для Android и автообновление

- Android: Firefox 142+. Контекстного меню и горячих клавиш там нет — только кнопка расширения (меню «⋮ → Расширения»). На обычном (release) Firefox для Android ставятся только дополнения из каталога AMO (или из своей коллекции в Beta/Nightly); Chrome для Android расширения не поддерживает.
- Автообновление через AMO: отправьте сборку `npm run build:firefox` (без `FAS_SELF_UPDATE`) в каталог addons.mozilla.org (listed) — обновления и Android-установка тогда идут штатно.
- Автообновление из репозитория без каталога: добавьте секреты `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`, создайте тег `fas-vX.Y.Z` (должен совпадать с версией в package.json) — workflow `forum-article-saver-release` соберёт с `FAS_SELF_UPDATE=1`, подпишет на AMO (unlisted) и выложит XPI + `updates.json` в Release. Установленная копия сама проверяет `releases/latest/download/updates.json`.

## Orion (macOS): проверка сборки из исходников

1. `npm ci && npm run build` — результат: `dist/chrome-mv3/`.
2. В Orion откройте **Tools → Extensions → Install from Disk**, выберите ZIP из `npm run zip` или `manifest.json` распакованной сборки, если ваша версия Orion поддерживает такой импорт.
3. В настройках сайта разрешите работу расширения и убедитесь, что режим Compatibility Mode выключен: он отключает расширения.
4. Откройте обычную HTTPS-статью Habr, 4PDA или GitHub, нажмите на расширение и проверьте распознавание, копирование и скачивание.
5. Если Orion сообщает, что расширения недоступны на внутренних страницах, откройте **Tools → Extensions → Console** и проверьте `tabs.query`, `scripting.executeScript` и `tabs.sendMessage`. Orion реализует WebExtensions поверх WebKit, поэтому это тест вручную, а не гарантия CI.

`src/core/tab-target.ts` не выбирает случайную вкладку: запасной поиск среди окон разрешён только при единственном подходящем HTTP(S)-кандидате. `src/core/content-messaging.ts` проверяет наличие обработчика через `fas/ping` и не повторяет потенциально побочный запрос `fas/run`.
