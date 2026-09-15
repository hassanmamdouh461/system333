/**
 * Reading and publishing the public menu's configuration.
 *
 * Three copies exist and they are not equal in authority: the reports database holds what
 * customers actually see, `localStorage` is a cache so the panel and the page paint before
 * the network answers, and the panel's form state is a draft until it is published.
 *
 * Publishing needs the reports write key, so it runs in the Electron main process. It used
 * to run here with the key read from `import.meta.env`, which inlined that key into every
 * bundle built from this source — including the public menu bundle served to customers.
 */

import { PublicMenuConfig } from '../types/menuBranding';
import { normalizeMenuConfig } from '../utils/menuConfig';
import { failureReason } from '../utils/reportFailure';

const LS_KEY = 'engaz_public_menu_config';

const REPORTS_URL = (import.meta.env.VITE_REPORTS_WORKER_URL as string) || 'https://api-reports.engaz.tech';

export interface PublishResult {
  /** True only when the configuration reached the reports database. */
  published: boolean;
  /** True when the draft was at least kept on this device. */
  savedLocally: boolean;
  error?: string;
}

function reportsEndpoint(path: string): string {
  return `${REPORTS_URL.replace(/\/+$/, '')}${path}`;
}

export const menuBrandingService = {
  /** The cached configuration, complete and bounded even if the stored value is not. */
  getLocalConfig(): PublicMenuConfig {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return normalizeMenuConfig(JSON.parse(saved));
    } catch (e) {
      console.warn('[menuBrandingService] Ignoring unreadable local config:', e);
    }
    return normalizeMenuConfig(null);
  },

  saveLocalConfig(config: PublicMenuConfig): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
    } catch (e) {
      // A data-URL logo can exceed the quota. The publish still went out, so this is a
      // cache miss on the next open, not a lost setting.
      console.warn('[menuBrandingService] Could not cache config locally:', e);
    }
  },

  /**
   * What is live right now, read from the public endpoint that needs no credential. The
   * panel opens on this rather than on the local cache, so it never shows a stale draft as
   * though it were published.
   */
  async fetchPublishedConfig(): Promise<PublicMenuConfig | null> {
    try {
      const res = await fetch(reportsEndpoint('/read/public-menu'), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data?.success || !data.config) return null;
      return normalizeMenuConfig(data.config);
    } catch (e) {
      console.warn('[menuBrandingService] Could not read the published config:', e);
      return null;
    }
  },

  /**
   * Publishes through the desktop bridge, which holds the write key.
   *
   * The web build has no bridge and must not carry that key, so there it keeps the draft on
   * the device and says plainly that it did not publish.
   */
  async publishConfig(config: PublicMenuConfig): Promise<PublishResult> {
    const stamped: PublicMenuConfig = { ...config, updatedAt: new Date().toISOString() };
    this.saveLocalConfig(stamped);

    if (!window.electronAPI?.publishMenuConfig) {
      return {
        published: false,
        savedLocally: true,
        error: 'النشر للمنيو العام يتم من تطبيق سطح المكتب',
      };
    }

    try {
      const result = await window.electronAPI.publishMenuConfig(stamped);
      if (!result?.success) {
        return { published: false, savedLocally: true, error: result?.error || 'تعذر النشر' };
      }
      return { published: true, savedLocally: true };
    } catch (err: unknown) {
      // The IPC layer wraps a rejection; `failureReason` strips that wrapper so the panel
      // shows why the publish was refused rather than naming the transport.
      const message = failureReason(err) || 'تعذر النشر';
      console.warn('[menuBrandingService] Publish failed:', message);
      return { published: false, savedLocally: true, error: message };
    }
  },

  /**
   * Compresses a chosen image into a bounded data URL.
   *
   * The configuration travels with every menu view, so an untouched phone photo would cost
   * each customer several megabytes.
   */
  async compressImage(
    file: File,
    maxWidth = 600,
    maxHeight = 600,
    quality = 0.8
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('تعذر تجهيز الصورة على هذا الجهاز'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('فشل قراءة الصورة المحددة'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
      reader.readAsDataURL(file);
    });
  },
};
