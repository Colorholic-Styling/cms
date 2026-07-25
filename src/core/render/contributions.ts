// The seam that keeps optional features out of the admin chrome.
//
// buildBaseProps() used to import feature modules directly to fill in their
// slice of the shared props — which meant every admin route, including ones
// with nothing to do with those features, transitively depended on them.
// Instead a feature registers a contributor, and the chrome merges whatever
// the enabled contributors return without knowing what any of them are.

import type { AppContext } from '../../utils/context';
import type { BaseTemplateProps } from '../../templates/layout';

/** A feature's addition to the props every admin page render receives. */
export interface BasePropsContributor {
  /** Matches the feature id in cms.features.json. */
  readonly id: string;
  /**
   * Runs in parallel with the chrome's own queries on every admin render, so
   * keep it to a bounded, cheap lookup.
   */
  props(c: AppContext): Promise<Partial<BaseTemplateProps>>;
}
