import { logger } from './utils/logger';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Keys that persist to the SQLite settings table. Everything else stays
// local-only (POS drafts, session tokens, secrets) — secrets are handled
// separately via the encrypted secrets IPC channel, never through here.
const SYNCED_SETTING_KEYS = new Set([
  'brewmaster_tax_rate',
  'brewmaster_branch_config',
  'brewmaster_store_config',
  'brewmaster_lang',
  'branch_id',
]);

async function initApp() {
  // 1. Restore synced settings from the Electron SQLite DB on startup
  if (window.electronAPI && typeof window.electronAPI.getSettings === 'function') {
    try {
      const dbSettings = await window.electronAPI.getSettings();
      for (const key of SYNCED_SETTING_KEYS) {
        if (dbSettings[key] !== undefined) {
          localStorage.setItem(key, dbSettings[key]);
        }
      }
    } catch (e) {
      logger.error('[Settings] Failed to restore settings from DB:', e);
    }
  }

  // 2. Monkeypatch Storage.prototype to sync whitelisted settings back to SQLite
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.setItem = function(this: Storage, key: string, value: string) {
    originalSetItem.apply(this, [key, value]);
    if (this === localStorage && SYNCED_SETTING_KEYS.has(key)) {
      if (window.electronAPI && typeof window.electronAPI.saveSetting === 'function') {
        window.electronAPI.saveSetting(key, value);
      }
    }
  };

  Storage.prototype.removeItem = function(this: Storage, key: string) {
    originalRemoveItem.apply(this, [key]);
    if (this === localStorage && SYNCED_SETTING_KEYS.has(key)) {
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
