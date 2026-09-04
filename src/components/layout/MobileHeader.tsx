import { useState, useEffect } from 'react';
import { Menu, Coffee, Clock } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

interface MobileHeaderProps {
  onMenuClick: () => void;
}

export function MobileHeader({ onMenuClick }: MobileHeaderProps) {
  const location = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getPageTitle = () => {
    const path = location.pathname;
    const titles: Record<string, string> = {
      '/dashboard': 'الرئيسية',
      '/menu': 'قائمة الأصناف',
      '/orders': 'الكاشير وتسجيل الطلبات',
      '/payment': 'الفواتير والتحصيل',
      '/inventory': 'المخزون والمواد الخام',
      '/reports': 'التقارير والإحصائيات',
      '/settings': 'إعدادات النظام',
    };
    return titles[path] || 'Engaz POS';
  };

  return (
    <header className="md:hidden fixed top-0 left-0 right-0 z-30 pt-safe-top font-cairo" dir="rtl">
      <div className="bg-[#18100B] border-b border-caramel/20 shadow-md">
        <div className="flex items-center justify-between px-3 py-2.5">
          
          {/* Menu Drawer Button */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onMenuClick}
            className="mobile-touch-target p-2 rounded-xl bg-white/5 text-mocha-300 hover:text-white border border-white/10 transition-all flex items-center justify-center"
          >
            <Menu size={20} />
          </motion.button>

          {/* Page Title & Brand */}
          <div className="flex flex-col items-center">
            <motion.h1 
              key={getPageTitle()}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm font-black text-white"
            >
              {getPageTitle()}
            </motion.h1>
            <div className="flex items-center gap-1 text-[10px] text-caramel font-mono mt-0.5">
              <Clock size={10} />
              <span className="tabular-nums">
                {currentTime.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>

          {/* User / Branch Icon */}
          <div className="flex items-center gap-1.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-caramel to-mocha-700 flex items-center justify-center text-white font-bold text-xs shadow-sm border border-caramel/30">
              <Coffee size={15} />
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}
