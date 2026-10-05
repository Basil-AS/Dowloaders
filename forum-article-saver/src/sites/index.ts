import type { SiteAdapter } from '../core/types';
import { habr } from './habr';
import { reddit } from './reddit';
import { fourpda } from './fourpda';
import { discourse } from './discourse';
import { generic } from './generic';

/** Порядок важен: конкретные площадки раньше движка Discourse, а универсальный разбор статей — последним. */
export const ADAPTERS: SiteAdapter[] = [habr, reddit, fourpda, discourse, generic];
