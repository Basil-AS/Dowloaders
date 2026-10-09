import type { SiteAdapter } from '../core/types';
import { habr } from './habr';
import { reddit } from './reddit';
import { fourpda } from './fourpda';
import { discourse } from './discourse';
import { xenforo } from './xenforo';
import { generic } from './generic';
import { github } from './github';

/** Порядок важен: конкретные площадки раньше движка Discourse, а универсальный разбор статей — последним. */
export const ADAPTERS: SiteAdapter[] = [habr, reddit, fourpda, discourse, xenforo, github, generic];
