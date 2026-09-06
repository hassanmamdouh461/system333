import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Coffee, ArrowRight, Lock, Eye, EyeOff, Building2, Delete, ExternalLink, Info } from 'lucide-react';
import { useAuth, getBranchAccount } from '../context/AuthContext';
import { playKeypadClick, playPaymentSuccessChime, playWarningSound } from '../utils/soundEffects';

export default function Login() {
  const { login, needsPasswordSetup } = useAuth();
  const navigate = useNavigate();

  // This till is one branch, named in settings. The old picker shipped three addresses that
  // every copy of the bundle recognised; branches are now managed in the reports portal.
  const account = getBranchAccount();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [showNumpad, setShowNumpad] = useState(true);

  const isFirstTimeSetup = needsPasswordSetup(account.email);

  const triggerShake = () => {
    setShake(true);
    playWarningSound();
    setTimeout(() => setShake(false), 500);
  };

  const handleKeypadPress = (action: string) => {
    playKeypadClick();
    if (action === 'C') {
      setPassword('');
      return;
    }
    if (action === 'backspace') {
      setPassword((prev) => prev.slice(0, -1));
      return;
    }
    setPassword((prev) => prev + action);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('يرجى إدخال كلمة المرور');
      triggerShake();
      return;
    }

    setError('');
    setLoading(true);
    try {
      await login(account.email, password, rememberMe);
      playPaymentSuccessChime();
      navigate('/orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'بيانات الدخول غير صحيحة');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#18110D] overflow-hidden font-cairo p-4 select-none" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={shake ? { x: [-10, 10, -8, 8, -4, 4, 0], opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-sm sm:max-w-md bg-[#221812] border border-white/10 p-5 sm:p-6 rounded-2xl shadow-2xl relative z-10"
      >
        {/* Header Branding */}
        <div className="flex flex-col items-center mb-3 sm:mb-4 text-center">
          <div className="w-11 h-11 rounded-xl bg-caramel/15 border border-caramel/30 flex items-center justify-center mb-2 shadow-sm">
            <Coffee className="w-6 h-6 text-caramel" />
          </div>

          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-1.5 font-sans" dir="ltr">
            <span>Engaz</span>
            <span className="text-caramel font-bold">POS</span>
          </h1>

          <p className="text-mocha-300 text-xs mt-0.5 font-medium">
            تسجيل دخول الكاشير
          </p>
        </div>

        {/* The branch this till belongs to. Managed from settings, not picked here. */}
        <div className="mb-3 flex items-center gap-2.5 bg-[#120C08] border border-white/10 rounded-xl p-2.5">
          <div className="w-8 h-8 rounded-lg bg-caramel/15 border border-caramel/30 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-caramel" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate">{account.branchName}</div>
            <div className="text-[10px] text-mocha-400 truncate" dir="ltr">{account.email}</div>
          </div>
          <span className="mr-auto text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-full px-2 py-0.5 shrink-0">
            {account.branchId}
          </span>
        </div>

        {/* First Time Password Setup Notice */}
        <AnimatePresence>
          {isFirstTimeSetup && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-amber-500/15 border border-amber-500/30 rounded-xl p-2.5 mb-3 flex items-start gap-2 text-xs text-amber-200"
            >
              <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">أول تسجيل دخول لهذا الفرع على هذا الجهاز:</span>
                <p className="mt-0.5 text-amber-300/80">
                  يرجى تعيين كلمة مرور جديدة تتكون من 6 أحرف أو أرقام على الأقل.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold py-2 px-3 rounded-xl mb-3 text-center"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {/* Password Field */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-mocha-200 block">
                {isFirstTimeSetup ? 'تعيين كلمة مرور الفرع' : 'كلمة مرور الفرع'}
              </label>
              <button
                type="button"
                onClick={() => setShowNumpad(!showNumpad)}
                className="text-[11px] text-mocha-400 hover:text-caramel font-semibold transition-colors"
              >
                {showNumpad ? 'إخفاء لوحة الأرقام' : 'إظهار لوحة الأرقام'}
              </button>
            </div>

            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mocha-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#120C08] border border-white/10 text-white pr-9 pl-9 py-2 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel text-sm transition-all placeholder-gray-500 font-mono tracking-widest text-center"
                placeholder={isFirstTimeSetup ? '6 خانات على الأقل' : '••••••'}
                dir="ltr"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors p-1"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Touch Numpad */}
          {showNumpad && (
            <div className="grid grid-cols-3 gap-1.5 font-mono">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <motion.button
                  key={digit}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  onClick={() => handleKeypadPress(digit)}
                  className="py-2.5 rounded-xl font-bold text-base bg-white/5 hover:bg-white/10 active:bg-caramel/20 text-white border border-white/10 transition-colors flex items-center justify-center"
                >
                  {digit}
                </motion.button>
              ))}
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => handleKeypadPress('C')}
                className="py-2.5 rounded-xl font-bold text-xs bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 transition-colors flex items-center justify-center font-cairo"
                title="مسح الكل"
              >
                مسح
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => handleKeypadPress('0')}
                className="py-2.5 rounded-xl font-bold text-base bg-white/5 hover:bg-white/10 active:bg-caramel/20 text-white border border-white/10 transition-colors flex items-center justify-center"
              >
                0
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => handleKeypadPress('backspace')}
                className="py-2.5 rounded-xl font-bold text-xs bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors flex items-center justify-center"
                title="حذف خانة"
              >
                <Delete size={16} />
              </motion.button>
            </div>
          )}

          {/* Remember Me */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-gray-300 pt-0.5">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-caramel focus:ring-caramel border-gray-700 bg-gray-800"
            />
            <span>تذكر هذا الفرع على هذا الجهاز</span>
          </label>

          {/* Submit Button */}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading || !password}
            className="w-full mt-1 bg-caramel hover:bg-caramel-dark text-white py-2.5 sm:py-3 rounded-xl font-bold shadow-md flex items-center justify-center gap-2 transition-colors text-xs sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <span>تسجيل الدخول للكاشير</span>
                <ArrowRight size={14} className="rotate-180" />
              </>
            )}
          </motion.button>
        </form>

        {/* Central Reports Portal External Link */}
        <div className="mt-3 pt-2.5 border-t border-white/10 text-center">
          <a
            href="https://reporting.engaz.tech"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-mocha-300 hover:text-caramel transition-colors font-medium"
          >
            <span>بوابة تقارير الإدارة المركزية أونلاين</span>
            <ExternalLink size={11} />
          </a>
        </div>
      </motion.div>
    </div>
  );
}
