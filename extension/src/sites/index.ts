import type { SiteAdapter } from '../core/types';
import { habr } from './habr';
import { reddit } from './reddit';
import { fourpda } from './fourpda';
import { discourse } from './discourse';

/** Порядок важен: конкретные площадки раньше универсального определения движка. */
export const ADAPTERS: SiteAdapter[] = [habr, reddit, fourpda, discourse];
