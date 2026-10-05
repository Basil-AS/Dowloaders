import type { Kind, Lang } from './types';

const ru = {
  site: 'update.altx-soft.ru',
  on: 'Включено',
  off: 'Выключено',
  toggle: 'Включить или выключить',
  interval: 'Интервал',
  minutes: '{n} мин',
  now: 'Продлить сейчас',
  working: 'Отправляю…',
  last: 'Последний запрос',
  next: 'Следующий через',
  nextNone: 'не запланирован',
  reason: 'Причина',
  http: 'Ответ сервера',
  log: 'Журнал',
  logEmpty: 'Пока пусто',
  appearance: 'Оформление',
  theme: 'Тема',
  themeSystem: 'Авто',
  themeLight: 'Светлая',
  themeDark: 'Тёмная',
  language: 'Язык',
  langAuto: 'Как в браузере',
  note: 'Работает, пока открыта вкладка сайта. На странице входа запросы не отправляются. Серверный предел жизни сессии расширение не обходит.',
  s_none: 'Ожидание первого запроса',
  s_ok: 'Сессия продлена',
  s_error: 'Запрос не удался',
  s_login: 'Нужно войти на сайте',
  s_expired: 'Сессия завершена, войдите заново',
  s_noTab: 'Откройте вкладку сайта',
  s_disabled: 'Выключено',
  r_timer: 'по таймеру',
  r_manual: 'вручную',
  r_startup: 'при открытии',
} as const;

export type Key = keyof typeof ru;

const en: Record<Key, string> = {
  site: 'update.altx-soft.ru',
  on: 'On',
  off: 'Off',
  toggle: 'Turn on or off',
  interval: 'Interval',
  minutes: '{n} min',
  now: 'Renew now',
  working: 'Sending…',
  last: 'Last request',
  next: 'Next in',
  nextNone: 'not scheduled',
  reason: 'Trigger',
  http: 'Server response',
  log: 'Log',
  logEmpty: 'Nothing yet',
  appearance: 'Appearance',
  theme: 'Theme',
  themeSystem: 'Auto',
  themeLight: 'Light',
  themeDark: 'Dark',
  language: 'Language',
  langAuto: 'Same as browser',
  note: 'Works while a tab of the site is open. Nothing is sent on the sign-in page. The extension does not bypass the server’s absolute session lifetime.',
  s_none: 'Waiting for the first request',
  s_ok: 'Session renewed',
  s_error: 'Request failed',
  s_login: 'Sign in on the site',
  s_expired: 'Session ended, sign in again',
  s_noTab: 'Open a tab of the site',
  s_disabled: 'Off',
  r_timer: 'timer',
  r_manual: 'manual',
  r_startup: 'on open',
};

const dict = { ru, en } as const;

export function resolveLang(pref: Lang | 'auto', nav: string = globalThis.navigator?.language ?? 'ru'): Lang {
  if (pref !== 'auto') return pref;
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const s: string = dict[lang][key];
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export const statusKey = (k: Kind): Key => (({ none: 's_none', ok: 's_ok', error: 's_error', login: 's_login', expired: 's_expired', 'no-tab': 's_noTab', disabled: 's_disabled' }) as const)[k];
