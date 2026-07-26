import type { CmsFeature } from '../../core/feature';

/**
 * Soft-delete holding area: the trash list, restore-to-draft and permanent
 * delete screens, backed by the trash_* tables in schema/cms/features/trash.sql.
 * Its router is registered in ../routers.ts.
 *
 * NOTE: page deletion itself still routes through trashDraftPage() in
 * utils/admin-queries, so removing this feature hides the admin screens but
 * leaves deletes writing to the trash tables. Making deletes hard-delete when
 * the feature is absent is a separate change to the core delete path.
 */
export const trashFeature: CmsFeature = {
  id: 'trash',
  navKeys: ['trash'],
};
