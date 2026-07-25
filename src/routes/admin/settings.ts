import { Hono } from 'hono';
import { requirePermission } from '../../middleware/auth';
import { pluginNav } from '../../plugins/registry';
import { systemSettingsPage } from '../../templates/settings';
import type { Env, Variables } from '../../types';
import { logAudit } from '../../utils/audit';
import { renderPage } from '../../core/render/chrome';
import {
  APP_ICON_OPTIONS,
  SIDEBAR_MENU_ITEMS,
  SYSTEM_TIMEZONE_OPTIONS,
  defaultPluginNavWeight,
  loadAppBrandingSettings,
  loadAdminHomeSettings,
  loadSidebarChromeSettings,
  loadSystemTimezone,
  normalizeSystemTimezone,
  pluginSidebarKey,
  saveAdminHomeSettings,
  saveAppBrandingSettings,
  saveSidebarMenuSettings,
  saveSystemTimezone,
} from '../../utils/settings';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

settingsRoutes.use('/settings/system', requirePermission('menu:manage'));
settingsRoutes.use('/settings/menu', requirePermission('menu:manage'));
// The credit summary is a read-only view any admin user may see; editing the
// prices happens under /plugins-manage/* which stays gated by plugin:manage.
// So no per-route permission here — editorGuard already limits it to signed-in
// admin users, and the "Configure" links are hidden below for non-managers.


settingsRoutes.get('/settings/menu', (c) => c.redirect('/admin/settings/system'));

// Shared row comparator: group by plugin, then by human label, then key.
settingsRoutes.get('/settings/system', async (c) => {
  const fallbackName = c.env.SITE_TITLE ?? '0xCMS';
  const [sidebarSettings, branding, adminHome, pluginItems, systemTimezone] = await Promise.all([
    loadSidebarChromeSettings(c.env),
    loadAppBrandingSettings(c.env, fallbackName),
    loadAdminHomeSettings(c.env),
    pluginNav(c.env),
    loadSystemTimezone(c.env),
  ]);
  const menuOption = (item: typeof SIDEBAR_MENU_ITEMS[number]) => ({
    value: item.key,
    label: item.label,
    description: item.description,
    labelKey: `nav.${item.key}`,
    descriptionKey: `settings.menu.${item.key}_description`,
    checked: sidebarSettings.items[item.key].visible,
    locked: item.key === 'system',
    weight: sidebarSettings.items[item.key].weight,
  });
  const pluginOptions = pluginItems.map((item) => {
    const key = pluginSidebarKey(item);
    return {
      label: item.label,
      href: item.href,
      groupLabel: item.group === 'settings' ? 'Settings' : 'Main',
      groupKey: item.group === 'settings' ? 'settings.groups.settings' : 'settings.groups.main',
      key,
      formKey: encodeURIComponent(key),
      checked: !sidebarSettings.hiddenPluginKeys.has(key),
      weight: sidebarSettings.pluginWeights[key] ?? defaultPluginNavWeight(item.group),
      icon: sidebarSettings.pluginIcons[key] ?? 'beaker',
    };
  });
  return renderPage(c, systemSettingsPage, {
    appName: branding.appName,
    appIcon: branding.appIcon,
    adminHomePath: adminHome.href,
    systemTimezone,
    timezoneOptions: [
      ...(SYSTEM_TIMEZONE_OPTIONS.some((option) => option.value === systemTimezone)
        ? []
        : [{ value: systemTimezone, label: systemTimezone }]),
      ...SYSTEM_TIMEZONE_OPTIONS,
    ].map((option) => ({ ...option, selected: option.value === systemTimezone })),
    iconOptions: [...APP_ICON_OPTIONS].sort((a, b) => a.label.localeCompare(b.label)).map((option) => ({
      ...option,
      labelKey: `settings.icons.${option.value}`,
      selected: option.value === branding.appIcon,
    })),
    settingsGroupWeight: sidebarSettings.settingsGroupWeight,
    mainOptions: SIDEBAR_MENU_ITEMS.filter((item) => item.group === 'main').map(menuOption),
    settingsOptions: SIDEBAR_MENU_ITEMS.filter((item) => item.group === 'settings').map(menuOption),
    options: SIDEBAR_MENU_ITEMS.map(menuOption),
    pluginOptions,
    flashKey: c.req.query('flash') === 'saved' ? 'settings.system_saved' : '',
    errorKey: c.req.query('error') === 'invalid-timezone' ? 'settings.timezone_invalid' : '',
  });
});

settingsRoutes.post('/settings/menu', async (c) => c.redirect('/admin/settings/system', 303));

settingsRoutes.post('/settings/system', async (c) => {
  const form = await c.req.formData();
  const submittedTimezone = form.get('system_timezone');
  const systemTimezone = submittedTimezone === null
    ? await loadSystemTimezone(c.env)
    : normalizeSystemTimezone(submittedTimezone);
  if (!systemTimezone) return c.redirect('/admin/settings/system?error=invalid-timezone', 303);
  const pluginItems = await pluginNav(c.env);
  const visibleKeys = form.getAll('visible_items').map(String);
  const weights = Object.fromEntries(SIDEBAR_MENU_ITEMS.map((item) => [item.key, form.get(`weight_${item.key}`)]));
  const pluginWeights = Object.fromEntries(pluginItems.map((item) => {
    const key = pluginSidebarKey(item);
    return [key, form.get(`plugin_weight_${encodeURIComponent(key)}`)];
  }));
  const pluginIcons = Object.fromEntries(pluginItems.map((item) => {
    const key = pluginSidebarKey(item);
    return [key, form.get(`plugin_icon_${encodeURIComponent(key)}`)];
  }));
  const pluginVisibleKeys = form.getAll('plugin_visible_items').map(String);
  await Promise.all([
    saveAppBrandingSettings(c.env, {
      appName: form.get('app_name'),
      appIcon: form.get('app_icon'),
    }, c.env.SITE_TITLE ?? '0xCMS'),
    saveAdminHomeSettings(c.env, {
      href: form.get('admin_home_path'),
    }),
    saveSystemTimezone(c.env, systemTimezone),
    saveSidebarMenuSettings(c.env, visibleKeys, weights, {
      settingsGroupWeight: form.get('settings_group_weight'),
      pluginWeights,
      pluginIcons,
      pluginVisibleKeys,
    }),
  ]);
  logAudit(c, 'settings.system.update', 'settings', 'admin.system');
  return c.redirect('/admin/settings/system?flash=saved');
});
