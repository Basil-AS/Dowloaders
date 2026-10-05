import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  vite: () => ({ plugins: [preact()] }),
  hooks: {
    // runtime-скрипт тянет за собой host_permissions из matches — убираем: работаем только через activeTab
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
    },
  },
  manifest: {
    name: 'Forum & Article Saver',
    description: 'Сохраняет статьи, темы и комментарии (Хабр, Reddit, 4PDA, Discourse) в TXT / Markdown / JSON.',
    version: '2.0.0',
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
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
