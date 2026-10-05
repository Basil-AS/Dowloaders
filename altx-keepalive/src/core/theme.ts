import type { Theme } from './types';

/** 'system' — атрибут не ставим: тему выбирает prefers-color-scheme, то есть тема браузера. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
