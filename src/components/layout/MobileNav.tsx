import { NavLink } from 'react-router-dom';
import { 
  ClipboardList, 
  CreditCard, 
  UtensilsCrossed, 
  BarChart3
} from 'lucide-react';
import { motion } from 'framer-motion';
import { playKeypadClick } from '../../utils/soundEffects';

export function MobileNav() {
  const navItems = [
    { icon: ClipboardList, label: 'الكاشير', path: '/orders' },
    { icon: CreditCard, label: 'الفواتير', path: '/payment' },
    { icon: UtensilsCrossed, label: 'المنيو', path: '/menu' },
    { icon: BarChart3, label: 'التقارير', path: '/reports' },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 pb-safe-bottom font-cairo" dir="rtl">
      <div className="bg-[#18100B]/95 backdrop-blur-xl border-t border-caramel/20 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-around px-1 py-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={() => playKeypadClick()}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1.5 rounded-xl transition-all duration-200 mobile-touch-target tap-highlight-none ${
                  isActive 
                    ? 'text-white font-bold' 
                    : 'text-mocha-400 hover:text-mocha-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active background pill */}
                  {isActive && (
                    <motion.div
                      layoutId="mobileNavPill"
                      className="absolute inset-0 bg-gradient-to-r from-caramel/25 to-mocha-600/30 rounded-xl border border-caramel/40"
                      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    />
                  )}
                  
                  {/* Icon */}
                  <motion.div
                    className="relative z-10"
                    animate={{ scale: isActive ? 1.1 : 1 }}
                    transition={{ duration: 0.15 }}
                  >
                    <item.icon 
                      size={19} 
                      strokeWidth={isActive ? 2.5 : 2}
                      className={isActive ? 'text-caramel drop-shadow-sm' : 'text-mocha-400'}
                    />
                  </motion.div>
                  
                  {/* Label */}
                  <span className="relative z-10 text-[10px] truncate w-full text-center leading-tight">
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
