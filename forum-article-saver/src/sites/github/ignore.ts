/**
 * Маски путей в упрощённом gitignore-стиле: `*`, `**`, `?`, начальный `/` (от корня), конечный `/` (только каталог).
 * Маска без `/` совпадает с именем файла или каталога на любой глубине. Отрицания (`!`) не поддерживаются.
 */
export function globToRegExp(pattern: string): RegExp | null {
  let p = pattern.trim();
  if (!p || p.startsWith('#') || p.startsWith('!')) return null;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.includes('/');
  p = p.replace(/^\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++;
        if (p[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // «**/» — ноль или больше каталогов
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${re}${dirOnly ? '/' : '(?:/|$)'}`);
}

export const parsePatterns = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

/** Совпадает ли путь файла хотя бы с одной маской (каталоги проверяются по префиксам пути). */
export function makeMatcher(patterns: string[]): (path: string) => boolean {
  const res = patterns.map(globToRegExp).filter((r): r is RegExp => !!r);
  return path => res.some(r => r.test(path) || r.test(path + '/'));
}

/** Что не нужно в дайджесте по умолчанию: служебное, сборочное, бинарное, сгенерированное. */
export const DEFAULT_IGNORE = [
  // каталоги
  '.git/', '.svn/', '.hg/', 'node_modules/', 'bower_components/', 'vendor/', '__pycache__/', '.venv/', 'venv/', '.tox/', '.mypy_cache/', '.pytest_cache/', '.ruff_cache/',
  'dist/', 'build/', 'out/', 'target/', '.next/', '.nuxt/', '.svelte-kit/', '.output/', '.cache/', '.parcel-cache/', '.turbo/', 'coverage/', '.idea/', '.vscode/', '.gradle/', 'Pods/',
  // lock-файлы и сгенерированное
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'go.sum', 'flake.lock',
  '*.min.js', '*.min.css', '*.map', '*.bundle.js', '*.chunk.js',
  // бинарные и медиа
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.bmp', '*.ico', '*.icns', '*.svg', '*.psd', '*.ai', '*.tiff',
  '*.mp3', '*.mp4', '*.mov', '*.avi', '*.mkv', '*.wav', '*.flac', '*.ogg', '*.webm',
  '*.ttf', '*.otf', '*.woff', '*.woff2', '*.eot',
  '*.zip', '*.tar', '*.gz', '*.tgz', '*.bz2', '*.xz', '*.7z', '*.rar', '*.jar', '*.war', '*.apk', '*.ipa',
  '*.exe', '*.dll', '*.so', '*.dylib', '*.a', '*.lib', '*.o', '*.obj', '*.class', '*.pyc', '*.pyo', '*.wasm', '*.bin', '*.dat', '*.db', '*.sqlite', '*.sqlite3',
  '*.pdf', '*.doc', '*.docx', '*.xls', '*.xlsx', '*.ppt', '*.pptx', '*.iso', '*.dmg',
  // служебное
  '.DS_Store', 'Thumbs.db', '*.log', '*.swp', '.env', '.env.*',
];

export const isReadme = (path: string) => /^readme(\.[a-z]+)?$/i.test(path.split('/').pop() ?? '') && path.split('/').length === 1;
