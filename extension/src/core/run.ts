import type { Ctx, ExtractOptions, ParsedDoc, ProgressFn, SiteAdapter } from './types';
import { applyFilters, EXT, formatDoc, MIME } from './format';
import { buildFilename } from './filename';

export interface RunOutput {
  doc: ParsedDoc;
  text: string;
  filename: string;
}

export function pickAdapter(adapters: SiteAdapter[], ctx: Ctx): SiteAdapter | undefined {
  return adapters.find(a => {
    try {
      return a.detect(ctx);
    } catch {
      return false;
    }
  });
}

/** Один и тот же конвейер для всех площадок: extract → фильтры → формат → имя файла. */
export async function runAdapter(
  adapter: SiteAdapter,
  ctx: Ctx,
  o: ExtractOptions,
  progress: ProgressFn,
  template: string,
  metaHeader: boolean,
  now = new Date(),
): Promise<RunOutput> {
  const raw = await adapter.extract(ctx, o, progress);
  const doc = applyFilters(raw, o);
  const text = formatDoc(doc, o, { meta: metaHeader, now });
  const filename = buildFilename(template, { title: doc.title, site: doc.site, count: doc.items.length, id: doc.meta.find(([k]) => k === 'ID')?.[1], now }, EXT[o.format]);
  return { doc, text, filename };
}

export function saveBlob(text: string, filename: string, format: ExtractOptions['format'], doc: Document = document): void {
  const blob = new Blob([text], { type: MIME[format] });
  const a = Object.assign(doc.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
