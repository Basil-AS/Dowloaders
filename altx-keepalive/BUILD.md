# Сборка из исходников

Нужны Node.js 22+ и npm 10+.

```bash
npm ci                 # зависимости строго по package-lock.json
npm run build:firefox  # результат: dist/firefox-mv3/ (содержимое загруженного zip)
npm run build          # результат: dist/chrome-mv3/
npm run zip            # dist/altx-keepalive-<версия>-{chrome,firefox,sources}.zip
```

Инструменты: WXT (Vite), TypeScript, Preact. Код минифицируется стандартным Vite/esbuild. Сторонний код в сборке только `preact` (интерфейс popup).
