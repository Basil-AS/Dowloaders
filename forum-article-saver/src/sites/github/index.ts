import { RateLimitError } from '../../core/http';
import { tFor } from '../../core/i18n';
import type { Ctx, ExtractOptions, ParsedDoc, ProgressFn, SiteAdapter } from '../../core/types';
import { AuthRequiredError, ForbiddenError, limitPause, NotFoundError } from './api';
import { extractDiscussion, extractDiscussionList } from './discussions';
import { extractIssue, extractIssueList } from './issues';
import { extractRepo } from './repo';
import { modesFor, parseGithub } from './url';

/** Понятные сообщения вместо «HTTP 404» и пауза при исчерпанном лимите API. */
function friendly(e: unknown, o: ExtractOptions): never {
  const L = tFor(o.lang);
  if (e instanceof RateLimitError) throw limitPause(e, L, o.lang);
  if (e instanceof NotFoundError) throw new Error(L('e_gh_notfound'));
  if (e instanceof AuthRequiredError) throw new Error(L('e_token_needed'));
  if (e instanceof ForbiddenError) throw new Error(L('e_gh_forbidden', { msg: e.message }));
  throw e;
}

function run(ctx: Ctx, g: NonNullable<ReturnType<typeof parseGithub>>, mode: string, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
  switch (mode) {
    case 'item':
      return g.page === 'discussion' ? extractDiscussion(ctx, g, o, progress) : extractIssue(ctx, g, o, progress);
    case 'issues':
    case 'pulls':
      return extractIssueList(ctx, g, o, progress, mode);
    case 'discussions':
      return extractDiscussionList(ctx, g, o, progress);
    default:
      return extractRepo(ctx, g, o, progress);
  }
}

export const github: SiteAdapter = {
  id: 'github',
  name: 'GitHub',
  kind: 'post',
  paged: false,
  hasComments: true,
  detect: ({ url }) => parseGithub(url) !== null,
  pageTitle: ({ url }) => {
    const g = parseGithub(url);
    return g && g.page !== 'issue' && g.page !== 'pull' && g.page !== 'discussion' ? `${g.owner}/${g.repo}` : null;
  },
  modes: ({ url }) => {
    const g = parseGithub(url);
    return g ? modesFor(g) : null;
  },

  async extract(ctx: Ctx, o: ExtractOptions, progress: ProgressFn): Promise<ParsedDoc> {
    const g = parseGithub(ctx.url)!;
    const mode = o.mode ?? modesFor(g).def;
    try {
      const doc = await run(ctx, g, mode, o, progress);
      // Ответы API (SHA коммита, дерево, страницы списков) кэшировались только ради докачки: после успеха они устарели.
      // После «сохранить, что есть» кэш остаётся, чтобы можно было дозагрузить остальное.
      if (!o.partial) ctx.cache.deletePrefix('gh:');
      return doc;
    } catch (e) {
      friendly(e, o);
    }
  },
};
