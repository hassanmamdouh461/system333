import { motion } from 'framer-motion';
import { Coffee } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
  subMessage?: string;
}

export function LoadingScreen({
  message = 'جاري تحميل البيانات...',
  subMessage = 'يرجى الانتظار لحظات...'
}: LoadingScreenProps) {
  return (
    <div className="w-full flex-1 min-h-[55vh] flex flex-col items-center justify-center py-12 select-none" dir="rtl">
      <div className="relative flex flex-col items-center justify-center p-8 rounded-2xl bg-white/70 backdrop-blur-sm border border-gray-100 shadow-sm max-w-sm w-full mx-auto">
        
        {/* Animated Icon */}
        <div className="relative mb-4">
          <div className="w-14 h-14 rounded-2xl bg-caramel/10 flex items-center justify-center text-caramel border border-caramel/20 shadow-inner">
            <Coffee className="w-7 h-7 text-caramel animate-pulse" />
          </div>
          <div className="absolute -inset-1 rounded-2xl border-2 border-caramel/20 border-t-caramel animate-spin pointer-events-none" />
        </div>

        {/* Text */}
        <h3 className="text-sm md:text-base font-bold text-gray-800 mb-1 font-cairo">
          {message}
        </h3>
        <p className="text-xs text-gray-400 font-cairo">
          {subMessage}
        </p>

        {/* Mini progress line */}
        <div className="w-36 h-1 bg-gray-100 rounded-full overflow-hidden mt-4">
          <motion.div
            animate={{ x: ['-100%', '100%'] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            className="w-16 h-full bg-caramel rounded-full"
          />
        </div>
      </div>
    </div>
  );
}
