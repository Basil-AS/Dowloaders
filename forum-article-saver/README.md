# Forum & Article Saver · 3.6.4

Расширение Manifest V3 для сохранения статей, форумных тем, комментариев и страниц GitHub в **TXT, Markdown и JSON**.

Поддерживаются Хабр, Reddit, 4PDA, Discourse, XenForo, GitHub, а также универсальный режим чтения статей на других сайтах. Настройки позволяют управлять форматами, объёмом, комментариями, ссылками, изображениями и именами файлов.

## Скачать готовые архивы

- [Chrome / Chromium / Orion (попробовать первым)](releases/forum-article-saver-3.6.4-chrome.zip)
- [Firefox MV3](releases/forum-article-saver-3.6.4-firefox.zip)
- [Исходники сборки для AMO](releases/forum-article-saver-3.6.4-sources.zip)

Обычный Chrome устанавливает ZIP после распаковки через `chrome://extensions` → режим разработчика → «Загрузить распакованное». Firefox может загрузить ZIP как **временное расширение** через `about:debugging`; постоянная установка требует подписи AMO.

**Orion (macOS):** использовать Chrome MV3 архив первым. В меню **Tools → Extensions → Install from Disk** установите подходящий архив/распакованную сборку (в зависимости от версии браузера). Проверьте разрешения для сайта и выключите Compatibility Mode. Исправления для выбора вкладки и обработки сообщений включены начиная с 3.6.4; проверка на WebKit/Orion обязательна и не заменяется CI в Chromium.

## Сборка из исходников

Требуются Node.js 22+ и npm 10+:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:firefox
npm run zip
python3 scripts/verify-release.py
```

Результаты: `dist/forum-article-saver-3.6.4-{chrome,firefox,sources}.zip`. Для E2E тестов нужен Chromium (`npm run e2e`); инструкция для проверки ревьюерами: [BUILD.md](BUILD.md).

После успешных CI-проверок push в **main** GitHub Actions пересобирает и проверяет три ZIP-файла, заменяет архивы прежних версий в [releases/](releases/) и фиксирует их отдельным коммитом `build(fas): publish ...`. Проверки PR публикуют только временные Actions artifacts и не изменяют `main`.

**Предупреждение:** ZIP для Firefox не является подписанным XPI. Для автоматического обновления в Firefox используется отдельный [релизный workflow](../.github/workflows/forum-article-saver-release.yml), который требует AMO API secrets.
