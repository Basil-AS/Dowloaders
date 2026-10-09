export type GhPage = 'repo' | 'issue' | 'pull' | 'discussion' | 'issues' | 'pulls' | 'discussions';

export interface GhRef {
  owner: string;
  repo: string;
  page: GhPage;
  number?: number;
  /** Всё после /tree/ или /blob/: «ветка/путь» (ветка может содержать «/», поэтому разбор позже, по API). */
  refPath: string[];
  /** Страница файла (/blob/): дайджест берётся по репозиторию, а не по этому файлу. */
  blob?: boolean;
}

/** Первые сегменты адреса github.com, которые не владельцы репозиториев. */
const RESERVED = new Set([
  'about', 'account', 'ai', 'apps', 'codespaces', 'collections', 'community', 'contact', 'copilot', 'customer-stories', 'dashboard', 'education', 'enterprise', 'enterprises', 'events', 'explore', 'features', 'git-guides',
  'issues', 'join', 'login', 'logout', 'marketplace', 'mobile', 'models', 'new', 'nonprofit', 'notifications', 'orgs', 'organizations', 'password_reset', 'premium-support', 'pricing', 'pulls', 'readme', 'resources', 'search',
  'security', 'settings', 'signup', 'site', 'solutions', 'sponsors', 'stars', 'team', 'topics', 'trending', 'users', 'watching',
]);

export function parseGithub(url: URL): GhRef | null {
  if (url.hostname !== 'github.com') return null;
  const s = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (s.length < 2 || RESERVED.has(s[0]!.toLowerCase()) || !/^[\w.-]+$/.test(s[0]!) || !/^[\w.-]+$/.test(s[1]!)) return null;
  const [owner, repo, kind, third] = s as [string, string, string?, string?];
  const base = { owner, repo, refPath: [] as string[] };
  const num = third && /^\d+$/.test(third) ? Number(third) : undefined;
  switch (kind) {
    case 'issues':
      return num ? { ...base, page: 'issue', number: num } : { ...base, page: 'issues' };
    case 'pull':
      return num ? { ...base, page: 'pull', number: num } : null;
    case 'pulls':
      return { ...base, page: 'pulls' };
    case 'discussions':
      return num ? { ...base, page: 'discussion', number: num } : { ...base, page: 'discussions' };
    case 'tree':
    case 'blob':
      return { ...base, page: 'repo', refPath: s.slice(3), blob: kind === 'blob' };
    default:
      return { ...base, page: 'repo' };
  }
}

/** Режимы, доступные на странице, и режим по умолчанию. */
export function modesFor(g: GhRef): { list: string[]; def: string } {
  const list = ['digest', 'issues', 'pulls', 'discussions'];
  switch (g.page) {
    case 'issue':
    case 'pull':
    case 'discussion':
      return { list: ['item', ...list], def: 'item' };
    case 'issues':
      return { list, def: 'issues' };
    case 'pulls':
      return { list, def: 'pulls' };
    case 'discussions':
      return { list, def: 'discussions' };
    default:
      return { list, def: 'digest' };
  }
}
