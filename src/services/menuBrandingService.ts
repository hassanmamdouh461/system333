import { PublicMenuConfig, DEFAULT_MENU_CONFIG } from '../types/menuBranding';

const LS_KEY = 'engaz_public_menu_config';

export const menuBrandingService = {
  getLocalConfig(): PublicMenuConfig {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_MENU_CONFIG,
          ...parsed,
        };
      }
    } catch (e) {
      console.warn('[menuBrandingService] Failed to parse local config:', e);
    }
    return DEFAULT_MENU_CONFIG;
  },

  async saveLocalConfig(config: PublicMenuConfig): Promise<void> {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
      if (window.electronAPI?.saveSetting) {
        await window.electronAPI.saveSetting('public_menu_config', JSON.stringify(config));
      }
    } catch (e) {
      console.error('[menuBrandingService] Error saving local config:', e);
    }
  },

  async publishConfig(config: PublicMenuConfig): Promise<{ success: boolean; error?: string }> {
    // 1. Save locally
    await this.saveLocalConfig(config);

    // 2. Publish to Cloudflare Reports Worker (which serves public menu)
    try {
      const reportsUrl = (import.meta.env.VITE_REPORTS_WORKER_URL as string) || 'https://api-reports.engaz.tech';
      const apiKey = (import.meta.env.VITE_REPORTS_API_KEY as string) || '';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const res = await fetch(`${reportsUrl.replace(/\/+$/, '')}/public-menu-config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ config }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[menuBrandingService] Cloud publish warning:', msg);
      // Even if cloud publish failed (e.g. offline), local config was preserved
      return { success: false, error: msg };
    }
  },

  /**
   * Compresses an image file (e.g. phone camera photo) into an optimized, lightweight Data URL
   * using HTML5 Canvas to prevent storing giant megabyte strings.
   */
  async compressImage(
    file: File,
    maxWidth: number = 600,
    maxHeight: number = 600,
    quality: number = 0.8
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
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(reader.result as string);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('فشل قراءة الصورة المحددة'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
      reader.readAsDataURL(file);
    });
  },
};
