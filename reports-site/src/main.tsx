import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');
createRoot(container).render(
  <React.StrictMode>
    {/* Outside App, so a failure anywhere inside the tree is caught rather than leaving a
        blank page that reads like "no sales today". */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
