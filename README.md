# Dowloaders
https://ntc.party/t/%D0%B1%D0%BB%D0%BE%D0%BA%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B0-telegram-%D0%B8-whatsapp-%D0%B7%D0%B2%D0%BE%D0%BD%D0%BA%D0%BE%D0%B2/18333/178


https://github.com/bol-van/zapret/discussions/200

https://gitingest.com/

https://ntc.party/t/%D0%B5%D1%81%D0%BB%D0%B8-%D0%BE%D0%BF%D1%8F%D1%82%D1%8C-%D0%BF%D0%B5%D1%80%D0%B5%D1%81%D1%82%D0%B0%D0%BB-%D0%B3%D1%80%D1%83%D0%B7%D0%B8%D1%82%D1%8C%D1%81%D1%8F-youtube-%D0%B8%D0%BB%D0%B8-%D0%B5%D0%B3%D0%BE-%D0%B2%D0%B8%D0%B4%D0%B5%D0%BE/10529
https://www.bettercap.org/project/introduction/

## Расширение для Chrome и Firefox (`extension/`)

Сохраняет текущую страницу в **TXT / Markdown / JSON**. Стек: WXT + TypeScript + Preact, Manifest V3 (один код для Chrome и Firefox), Vitest + Playwright.

| Площадка | Что берёт |
|---|---|
| Хабр (статьи, новости) | статья + дерево комментариев (API Хабра) |
| Reddit | пост + дерево комментариев (JSON, если 403 — разбор открытой страницы, раскрытие «ещё ответы») |
| 4PDA | тема форума (5 потоков, повторы при 503, дедупликация), цитаты/код/спойлеры |
| Discourse (ntc.party и любой форум на этом движке) | вся тема через `/t/{id}.json` + `posts.json`, цитаты, ответы, лайки, теги |

Discourse определяется автоматически по `<meta name="generator" content="Discourse …">`.

**Управление:** popup (формат, комментарии, «последние N %», Скачать / Копировать, «Все вкладки», история), страница настроек
(язык RU/EN, глубина и мин. рейтинг комментариев, ссылки/картинки/код/цитаты, параллелизм и пауза, шаблон имени файла `{date} {time} {site} {title} {id} {count}`),
пункт контекстного меню и горячая клавиша **Alt+Shift+S**. Права: только `activeTab` (доступ к странице — по клику); «Все вкладки» запрашивает доступ отдельно.

**Разработка** (`cd extension`):

```bash
npm ci
npm run dev            # Chrome с горячей перезагрузкой  (dev:firefox — Firefox)
npm run typecheck && npm test
npm run build && npm run e2e     # e2e: настоящий Chromium + моки площадок
npm run zip            # dist/*.zip для Chrome и Firefox
```

Установка из сборки: Chrome — `chrome://extensions` → «Загрузить распакованное» → `extension/dist/chrome-mv3`;
Firefox — `about:debugging#/runtime/this-firefox` → «Временное дополнение» → `extension/dist/firefox-mv3/manifest.json`.
