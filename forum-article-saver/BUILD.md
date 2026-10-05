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
