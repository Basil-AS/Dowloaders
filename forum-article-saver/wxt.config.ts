import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  zip: { excludeSources: ['releases/**', 'PLAN-*.md'] },
  srcDir: 'src',
  outDir: 'dist',
  vite: () => ({ plugins: [preact()] }),
  hooks: {
    // runtime-скрипт тянет за собой host_permissions из matches (<all_urls>) — убираем: к страницам доступ только через activeTab.
    // Остаётся доступ к GitHub API и сырым файлам: запросы идут только через фон и только на эти два хоста.
    'build:manifestGenerated': (_wxt, manifest) => {
      manifest.host_permissions = ['https://api.github.com/*', 'https://raw.githubusercontent.com/*'];
    },
  },
  manifest: {
    name: 'Forum & Article Saver',
    description: 'Сохраняет статьи, темы и комментарии (Хабр, Reddit, 4PDA, Discourse), репозитории, issues и обсуждения GitHub в TXT / Markdown / JSON.',
    version: '3.5.1',
    // Только activeTab: расширение трогает страницу лишь по клику / хоткею / из меню.
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
    // Нужно только для режима «все вкладки» (запрашивается по кнопке).
    optional_host_permissions: ['<all_urls>'],
    commands: {
      'save-page': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Сохранить текущую страницу (настройки по умолчанию)',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'forum-article-saver@basil-as.github.io',
        data_collection_permissions: { required: ['none'], optional: ['authenticationInfo'] },
      },
    },
  },
});
