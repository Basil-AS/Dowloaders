const BAD = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitize(s: string): string {
  return (s ?? '').replace(BAD, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').trim() || 'untitled';
}

const p2 = (n: number) => String(n).padStart(2, '0');

export interface NameVars {
  title: string;
  site: string;
  id?: string;
  count?: number;
  now?: Date;
}

export function buildFilename(template: string, v: NameVars, ext: string, maxLen = 150): string {
  const d = v.now ?? new Date();
  const vars: Record<string, string> = {
    date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    time: `${p2(d.getHours())}-${p2(d.getMinutes())}`,
    site: v.site,
    title: v.title,
    id: v.id ?? '',
    count: v.count == null ? '' : String(v.count),
  };
  const raw = template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (vars[k] as string) : m));
  const base = sanitize(raw).slice(0, maxLen).trim();
  return `${base || 'untitled'}.${ext}`;
}
