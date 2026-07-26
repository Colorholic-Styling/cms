// GENERATED FILE — do not edit.
//
// Written by scripts/build-features.mjs from cms.features.json.
// To add or drop a feature, edit that file and run `npm run build:features`.

import type { CmsFeature } from '../../core/feature';
import { creditsFeature } from '../credits/feature';
import { dbTypesFeature } from '../db-types/feature';
import { i18nFeature } from '../i18n/feature';
import { mediaFeature } from '../media/feature';
import { pluginsFeature } from '../plugins/feature';
import { searchFeature } from '../search/feature';
import { trashFeature } from '../trash/feature';
import { usersRolesFeature } from '../users-roles/feature';

/** Installed features, in cms.features.json order. */
export const featureManifests: readonly CmsFeature[] = [
  creditsFeature,
  dbTypesFeature,
  i18nFeature,
  mediaFeature,
  pluginsFeature,
  searchFeature,
  trashFeature,
  usersRolesFeature,
];
