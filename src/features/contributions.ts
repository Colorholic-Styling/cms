// Which optional features contribute to the admin chrome.
//
// This list is the code-side twin of cms.features.json, and for now it is
// maintained by hand: removing an entry removes that feature's props from
// every admin render AND removes its modules from the chrome's import graph,
// so esbuild can drop them. Once the code-side feature manifest lands this
// file becomes generated from cms.features.json.
//
// Nothing else may import feature modules from core/.

import type { BasePropsContributor } from '../core/render/contributions';
import { creditsBaseProps } from './credits/base-props';

export const basePropsContributors: BasePropsContributor[] = [
  creditsBaseProps,
];
