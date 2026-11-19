# Privacy Policy — Forum & Article Saver

**Last updated: November 19, 2026**  
**Extension:** Forum & Article Saver  
**Source:** https://github.com/Basil-AS/Dowloaders/tree/main/forum-article-saver  
**Support and privacy questions:** https://github.com/Basil-AS/Dowloaders/issues (do not post private information or access tokens in public issues)

## English

### Purpose

Forum & Article Saver is a browser extension for extracting and exporting user-selected articles, forum discussions, comments, and GitHub repository content to TXT, Markdown, and JSON. Access to page content is initiated by a user action, such as clicking the extension, using its shortcut or context menu, or requesting the multi-tab save feature.

### Data processed

- **Webpage content and URLs:** the extension reads the content, title, URL, author information, comments, and other relevant page metadata needed to create an export. It does not continuously record all browsing activity. Only pages requested by the user are processed.
- **Local save history:** when enabled, the extension stores up to 50 recent saves (for example, page URL, title, date, format, and filename) in browser local extension storage. Users can disable, export, or clear this history in the settings.
- **Preferences:** format, language, appearance, and extraction settings are stored using browser extension sync storage, which may synchronize them through the user's browser account if browser sync is enabled.
- **Optional GitHub token:** when supplied, a GitHub personal access token is stored in browser local extension storage, not in sync storage. It is sent in authorization headers only to GitHub endpoints `https://api.github.com` and `https://raw.githubusercontent.com`, when needed to fetch requested GitHub content.
- **Temporary processing state:** in-progress downloads, request limits, and processing status may be kept in memory or browser session storage to support pause and resume.

### Network requests and third parties

For supported forums and article platforms, the extension can request additional pages or site APIs directly from the user's browser to retrieve the article, comments, or discussion. Those requests go to the sites selected by the user and may use the browser's normal site session. GitHub extraction makes HTTPS requests to GitHub's API and raw content services. These services process requests under their respective privacy policies.

Exported content is saved to a file or copied to the clipboard at the user's request. The extension does **not** upload extracted content, browsing history, or GitHub tokens to a server operated by the extension developer. It does not include developer-operated advertising, analytics, or user tracking.

### Control and deletion

Users can change or reset preferences, disable or clear the extension's save history, remove the GitHub token, and uninstall the extension to remove locally stored extension data. Browser account synchronization of preferences is controlled by the browser's own settings. Files already downloaded or content copied elsewhere must be deleted separately by the user.

### Security and policy compliance

The extension uses browser permissions only to provide its stated functionality. Remote requests to GitHub use HTTPS. Source code is publicly available for review. The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is not sold and is not used for advertising.

This policy will be updated if data handling practices change.

---

## Русский

### Назначение

Forum & Article Saver извлекает и сохраняет по запросу пользователя статьи, форумные темы, комментарии и содержимое GitHub-репозиториев в TXT, Markdown и JSON. Обработка запускается нажатием на расширение, горячей клавишей, пунктом контекстного меню либо функцией сохранения вкладок.

### Обрабатываемые данные

- **Содержимое и адреса страниц:** для экспорта расширение читает текст, заголовок, URL, сведения об авторах, комментарии и относящиеся к материалу метаданные. Постоянного сбора всей истории просмотра нет; обрабатываются страницы, выбранные пользователем.
- **История сохранений:** при включённой функции в локальном хранилище расширения сохраняется до 50 последних операций (URL, заголовок, дата, формат, имя файла и т. п.). Историю можно отключить, экспортировать или очистить.
- **Настройки:** формат экспорта, язык, тема оформления и параметры обработки хранятся в хранилище синхронизации браузера. Если синхронизация браузера включена, настройки могут синхронизироваться через учётную запись браузера.
- **Необязательный токен GitHub:** введённый пользователем персональный токен хранится локально в браузере (без синхронизации) и при необходимости передаётся только сервисам GitHub `api.github.com` и `raw.githubusercontent.com` в заголовках авторизации.
- **Временные данные:** состояние загрузки и ограничения запросов могут храниться в памяти или сеансовом хранилище браузера для возможности продолжения загрузки.

### Сетевые запросы и третьи стороны

Для извлечения сообщений и комментариев расширение может обращаться с компьютера пользователя к исходному сайту и его API. Такие запросы могут использовать уже существующую авторизацию пользователя на этом сайте. Для GitHub выполняются HTTPS-запросы к GitHub API и сервису исходных файлов. Обработка запросов этими сайтами регулируется их собственными политиками.

Полученные материалы сохраняются в файл либо копируются в буфер обмена по запросу пользователя. **Разработчик не получает на собственный сервер** извлечённые тексты, историю посещений или токены GitHub. В расширении нет рекламной аналитики, отслеживания пользователей или продажи данных.

### Управление и удаление

Пользователь может изменить или сбросить настройки, отключить и очистить историю сохранений, удалить токен GitHub или удалить расширение. Управление синхронизацией настроек выполняется через настройки браузера. Уже скачанные файлы и скопированные материалы необходимо удалять отдельно.

### Безопасность и соблюдение правил

Разрешения браузера используются для заявленных функций. Сетевые обращения к GitHub выполняются по HTTPS. Исходный код открыт для проверки. Использование данных, полученных через API Google, соответствует правилам Chrome Web Store в отношении пользовательских данных, включая ограничения Limited Use. Данные не продаются и не используются для рекламы.

При изменении способов обработки данных политика будет обновлена.
