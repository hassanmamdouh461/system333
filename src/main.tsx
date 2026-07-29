import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

async function initApp() {
  // 1. Sync settings from Electron SQLite DB to localStorage on startup
  if (window.electronAPI && typeof window.electronAPI.getSettings === 'function') {
    try {
      const dbSettings = await window.electronAPI.getSettings();
      for (const [key, val] of Object.entries(dbSettings)) {
        localStorage.setItem(key, val);
      }
    } catch (e) {
      console.error('[Settings] Failed to restore settings from DB:', e);
    }
  }

  // 2. Persistent settings are synced through the explicit, whitelisted
  // electronAPI settings channel (db:save-setting / db:delete-setting) — the
  // main process decides which keys are durable. No global Storage monkeypatch:
  // transient UI state (pos_*, session cache) never touches SQLite (Issue 30).

  // 3. Mount the React application
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

initApp();
