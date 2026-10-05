import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: 'ALT-X KeepAlive',
    description: 'Держит сессию на update.altx-soft.ru активной: без повторных подтверждений каждые 30 минут.',
    version: '2.0.0',
    // tabs не нужен: tabs.query по адресу работает на основании host_permissions.
    permissions: ['storage', 'alarms'],
    host_permissions: ['https://update.altx-soft.ru/*'],
    browser_specific_settings: {
      gecko: {
        id: 'altx-keepalive@local.invalid', // прежний id: Firefox обновит установленную 1.x, настройки сохранятся
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
