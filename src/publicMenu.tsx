import ReactDOM from 'react-dom/client';
import PublicMenu from './pages/PublicMenu';
import './index.css';

/**
 * Entry point for the public customer menu (menu.engaz.tech).
 *
 * The menu used to be served from the same bundle as the whole admin application: Dashboard,
 * Inventory, Reports, Settings, the PBKDF2 login code and every internal route name were
 * published to anyone who scanned a QR code. Nothing secret leaked, but it handed out a free
 * map of the internals and made a customer download ~630 kB to read a menu.
 *
 * This entry imports the one page it needs, so the public site ships the menu and nothing
 * else. It deliberately does not mount the router or the admin context providers —
 * PublicMenu depends on neither.
 */
const container = document.getElementById('root');
if (!container) {
  throw new Error('Public menu root container is missing from public-menu.html');
}

ReactDOM.createRoot(container).render(<PublicMenu />);
