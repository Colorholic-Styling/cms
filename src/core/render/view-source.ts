// Where Liquid templates are read from.
//
// The CMS's own templates ship as Worker assets (env.VIEWS). A feature may
// contribute a wider source — the plugin platform chains plugin-owned
// snippets after the bundle — by registering `viewSource`. With nothing
// registered this is env.VIEWS itself, so the common path adds no overhead
// and a build without the platform still renders every core template.

import { coreExtensions } from '../extensions';
import type { Env } from '../../types';

export function viewSourceFor(env: Env): Fetcher {
  return coreExtensions().viewSource?.(env) ?? env.VIEWS;
}
