import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  ClipboardList, 
  CreditCard, 
  UtensilsCrossed, 
  BarChart3, 
  Settings, 
  Coffee,
  Package,
  LogOut,
  Clock,
  User
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { motion } from 'framer-motion';
import { playKeypadClick } from '../../utils/soundEffects';

export function TopNav() {
  const { user, logout } = useAuth();
  const { t, isRtl } = useLanguage();
  const navigate = useNavigate();

  // Live Digital Clock
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { icon: ClipboardList, label: t('Cashier Board'), to: '/orders' },
    { icon: CreditCard, label: t('Payment & Invoice'), to: '/payment' },
    { icon: UtensilsCrossed, label: t('Menu'), to: '/menu' },
    { icon: Package, label: t('Inventory'), to: '/inventory' },
    { icon: BarChart3, label: t('Reports'), to: '/reports' },
    { icon: Settings, label: t('Settings'), to: '/settings' },
  ];

  const branchNames: Record<string, string> = {
    branch_1: 'فرع 1 (المعادي)',
    branch_2: 'فرع 2 (مصر الجديدة)',
    branch_3: 'فرع 3 (الزمالك)',
  };

  const currentBranchLabel = (user?.id && branchNames[user.id]) || user?.name || 'الفرع الرئيسي';

  return (
    <header className="hidden md:block w-full bg-[#18100B] border-b border-caramel/20 shadow-sm relative z-30 font-cairo" dir="rtl">
      <div className="w-full px-3 sm:px-4">
        <div className="flex items-center justify-between h-10">
          
          {/* Brand & Branch Indicator */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative bg-gradient-to-br from-caramel via-mocha-600 to-[#2D1F17] p-1.5 rounded-lg shadow-sm border border-caramel/30">
              <Coffee className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-white font-black text-xs leading-none tracking-tight font-sans">
                Engaz <span className="text-caramel font-bold">POS</span>
              </h1>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-caramel/15 text-caramel border border-caramel/30 font-semibold leading-none">
                {currentBranchLabel}
              </span>
            </div>
          </div>

          {/* Navigation Items with Animated Active Pill */}
          <nav className="flex items-center gap-0.5 bg-[#100B07] p-0.5 rounded-lg border border-white/5 shadow-inner">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => playKeypadClick()}
                  className={({ isActive }) =>
                    `relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-200 ${
                      isActive
                        ? 'text-white'
                        : 'text-mocha-300 hover:text-white hover:bg-white/5'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.div
                          layoutId="activeTopNavPill"
                          className="absolute inset-0 bg-gradient-to-r from-caramel via-caramel-dark to-mocha-600 rounded-md shadow-sm"
                          transition={{ type: 'spring', damping: 24, stiffness: 300 }}
                        />
                      )}
                      <Icon size={13} className="relative z-10" />
                      <span className="relative z-10">{item.label}</span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          {/* Right Action Section: Live Clock, Sync Heartbeat, User & Logout */}
          <div className="flex items-center gap-2 shrink-0">

            {/* Live Clock & Connection Status */}
            <div className="flex items-center gap-2 px-2 py-0.5 rounded-lg bg-[#100B07] border border-white/5 font-mono text-[11px] text-mocha-300">
              <div className="flex items-center gap-1 text-mocha-200" title="الوقت الحالي">
                <Clock size={11} className="text-caramel" />
                <span className="font-bold tabular-nums">
                  {currentTime.toLocaleTimeString(isRtl ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>

              <div className="h-2.5 w-px bg-white/10" />

              {/* Online/Offline Status Indicator */}
              <div 
                className="flex items-center gap-1 text-[10px]" 
                title={isOnline ? "متصل بالسحابة (مزامنة مباشرة)" : "وضع غير متصل (حفظ محلي آمن)"}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400' : 'bg-amber-500'}`} />
                <span className="font-sans font-semibold text-mocha-400">
                  {isOnline ? 'سحابي' : 'أوفلاين'}
                </span>
              </div>
            </div>

            {/* User Role Mini Card */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[#100B07] border border-white/5">
              <div className="w-5 h-5 rounded bg-gradient-to-br from-caramel to-mocha-700 flex items-center justify-center text-white shadow-inner">
                <User size={11} />
              </div>
              <span className="text-[10px] text-caramel font-bold leading-none">
                {user?.role === 'admin' ? 'مسؤول' : 'كاشير'}
              </span>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-lg text-mocha-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all active:scale-95"
              title="تسجيل الخروج"
            >
              <LogOut size={13} />
            </button>
          </div>

        </div>
      </div>
    </header>
  );
}
