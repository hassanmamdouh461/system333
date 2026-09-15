import { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileNav } from './MobileNav';
import { TopNav } from './TopNav';
import { Outlet, useLocation } from 'react-router-dom';

export function DashboardLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const isPosPage = location.pathname === '/orders' || location.pathname === '/';

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* Desktop Top Navigation Bar */}
      <TopNav />

      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setMobileMenuOpen(true)} />

      {/* Lower layout wrapper */}
      <div className="flex-grow flex overflow-hidden relative">
        {/* Sidebar - Mobile Drawer only */}
        <Sidebar
          mobileOpen={mobileMenuOpen}
          onMobileClose={() => setMobileMenuOpen(false)}
        />

        {/* Main Content */}
        <main className={`flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 ${
          isPosPage
            ? 'p-1.5 md:p-2.5 pt-[68px] md:pt-2.5 pb-2 md:pb-2.5 h-full overflow-hidden'
            : 'p-3 sm:p-4 md:p-8 pb-24 md:pb-6 pt-[72px] md:pt-6'
        }`}>
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav />
    </div>
  );
}
