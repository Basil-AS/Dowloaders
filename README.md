# Dowloaders
https://ntc.party/t/%D0%B1%D0%BB%D0%BE%D0%BA%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B0-telegram-%D0%B8-whatsapp-%D0%B7%D0%B2%D0%BE%D0%BD%D0%BA%D0%BE%D0%B2/18333/178


https://github.com/bol-van/zapret/discussions/200

https://gitingest.com/

https://ntc.party/t/%D0%B5%D1%81%D0%BB%D0%B8-%D0%BE%D0%BF%D1%8F%D1%82%D1%8C-%D0%BF%D0%B5%D1%80%D0%B5%D1%81%D1%82%D0%B0%D0%BB-%D0%B3%D1%80%D1%83%D0%B7%D0%B8%D1%82%D1%8C%D1%81%D1%8F-youtube-%D0%B8%D0%BB%D0%B8-%D0%B5%D0%B3%D0%BE-%D0%B2%D0%B8%D0%B4%D0%B5%D0%BE/10529
https://www.bettercap.org/project/introduction/

## Расширение для Chrome и Firefox (`extension/`)

Сохраняет текущую страницу в `.txt` (`YYYY-MM-DD - [сайт] - Заголовок.txt`):

| Площадка | Что берёт |
|---|---|
| Хабр (статьи, новости) | статья + дерево комментариев (через API Хабра) |
| Reddit | пост + дерево комментариев (JSON; если 403 — разбор открытой страницы) |
| 4PDA | тема форума, 5 потоков, можно скачать только последние N% |
| Discourse (ntc.party и любой форум на этом движке) | вся тема через `/t/{id}.json` + `posts.json`, цитаты, ответы, лайки; можно последние N% |

Discourse определяется автоматически по `<meta name="generator" content="Discourse …">`, поэтому работает не только на ntc.party.

**Установка:** Chrome — `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → папка `extension/`.
Firefox — `about:debugging#/runtime/this-firefox` → «Загрузить временное дополнение» → `extension/manifest.json`.
Сборка архивов: `./build-extension.sh`. Использование: открыть страницу → иконка расширения → «Скачать».
