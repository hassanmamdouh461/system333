import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Keys that are allowed to sync between localStorage and the Electron SQLite
// settings table. Anything else (session blobs, cart state, UI prefs, search
// strings...) stays in the renderer and never generates IPC traffic (problem #3).
const SYNCED_SETTINGS_KEYS = new Set([
  'brewmaster_tax_rate',
  'brewmaster_branch_config',
  'brewmaster_telegram_config',
  'brewmaster_d1_worker_url',
  'brewmaster_cf_api_key',
  'branch_id',
]);

async function initApp() {
  // 1. Sync settings from Electron SQLite DB to localStorage on startup
  if (window.electronAPI && typeof window.electronAPI.getSettings === 'function') {
    try {
      const dbSettings = await window.electronAPI.getSettings();
      for (const [key, val] of Object.entries(dbSettings)) {
        if (SYNCED_SETTINGS_KEYS.has(key)) {
          localStorage.setItem(key, val);
        }
      }
      // Drop legacy secrets that may linger from older versions (problem #3)
      localStorage.removeItem('brewmaster_admin_creds');
      localStorage.removeItem('brewmaster_admin_credentials');
    } catch (e) {
      console.error('[Settings] Failed to restore settings from DB:', e);
    }
  }

  // 2. Monkeypatch Storage.prototype to sync WHITELISTED settings back to SQLite
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
    originalSetItem.apply(this, [key, value]);
    if (this === localStorage && SYNCED_SETTINGS_KEYS.has(key)) {
      if (window.electronAPI && typeof window.electronAPI.saveSetting === 'function') {
        window.electronAPI.saveSetting(key, value);
      }
    }
  };

  Storage.prototype.removeItem = function(this: Storage, key: string) {
    originalRemoveItem.apply(this, [key]);
    if (this === localStorage && SYNCED_SETTINGS_KEYS.has(key)) {
      if (window.electronAPI && typeof window.electronAPI.deleteSetting === 'function') {
        window.electronAPI.deleteSetting(key);
      }
    }
  };

  // 3. Mount the React application
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

initApp();
