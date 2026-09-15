/**
 * Access to the Electron preload bridge.
 *
 * The bridge only exists in the desktop build, so it is typed as optional. Reaching for it
 * without a guard is a real bug in the web build — an unguarded call there throws a bare
 * "cannot read property of undefined" far from its cause. These helpers make the failure
 * name itself instead.
 */

export type DesktopApi = NonNullable<Window['electronAPI']>;

/** The bridge, or null in the web build. */
export function desktopApi(): DesktopApi | null {
  return (typeof window !== 'undefined' && window.electronAPI) || null;
}

export function isDesktop(): boolean {
  return desktopApi() !== null;
}

/**
 * The bridge, or a thrown error naming the action that needed it. Use this for operations
 * that genuinely have no web equivalent, such as writing to the local branch database.
 */
export function requireDesktopApi(action = 'هذه العملية'): DesktopApi {
  const api = desktopApi();
  if (!api) {
    throw new Error(`${action} متاح فقط في تطبيق سطح المكتب`);
  }
  return api;
}
