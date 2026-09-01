import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Coffee, ArrowRight, Lock, Mail, Info } from 'lucide-react';
import { useAuth, BRANCH_ACCOUNTS } from '../context/AuthContext';
import { isDesktop } from '../services/desktopBridge';

const LS_KEY = 'engaz_remembered_email';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, needsPasswordSetup } = useAuth();
  const navigate = useNavigate();
  const desktop = isDesktop();

  // Restore the remembered address, never a password.
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  // Which accounts this build can sign in with, so the user knows what to type. Addresses
  // only: the password is set per device on first use.
  const accountsForThisBuild = useMemo(
    () => BRANCH_ACCOUNTS.filter(acc => (desktop ? acc.role !== 'manager' : acc.role === 'manager')),
    [desktop]
  );

  const isFirstSignIn = email.trim() !== '' && needsPasswordSetup(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!email || !password) throw new Error('Please fill in all fields');
      const loggedUser = await login(email, password, rememberMe);
      navigate(loggedUser.role === 'manager' ? '/manager-dashboard' : '/orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes float2d {
          0%,  100% { transform: translateY(0px);  }
          50%        { transform: translateY(-7px); }
        }
        .icon-float {
          animation: float2d 3s ease-in-out infinite;
          will-change: transform;
        }
        .cb-caramel {
          appearance: none;
          -webkit-appearance: none;
          width: 1rem;
          height: 1rem;
          border: 1.5px solid #6b7280;
          border-radius: 4px;
          background: transparent;
          cursor: pointer;
          position: relative;
          flex-shrink: 0;
          transition: border-color 0.2s, background 0.2s;
        }
        .cb-caramel:checked {
          background: #c8956c;
          border-color: #c8956c;
        }
        .cb-caramel:checked::after {
          content: '';
          position: absolute;
          left: 3px;
          top: 0px;
          width: 5px;
          height: 9px;
          border: 2px solid #fff;
          border-top: none;
          border-left: none;
          transform: rotate(45deg);
        }
        .cb-caramel:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(200,149,108,0.35);
        }
      `}</style>

      <div className="min-h-screen flex items-center justify-center bg-gray-900 relative overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-caramel/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-mocha-700/10 rounded-full blur-[100px]" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="bg-white/10 backdrop-blur-lg border border-white/20 p-8 rounded-2xl w-full max-w-md shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="relative mb-4 icon-float">
              <div className="absolute inset-0 rounded-full bg-caramel/40 blur-xl scale-150" />
              <div className="relative bg-gradient-to-br from-caramel to-mocha-600 p-3 rounded-full shadow-lg shadow-caramel/40">
                <Coffee className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">
              {desktop ? 'دخول الفرع' : 'بوابة الإدارة'}
            </h1>
            <p className="text-gray-400 text-sm">
              {desktop ? 'سجل دخول كاشير الفرع' : 'دخول موقع الإدارة المركزي'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="login-email" className="block text-gray-300 text-xs uppercase tracking-wider font-semibold ms-1">
                البريد الإلكتروني
              </label>
              <div className="relative group">
                <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400 group-focus-within:text-caramel transition-colors" aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 text-white ps-10 pe-4 py-3 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel transition-all placeholder-gray-500"
                  placeholder={desktop ? 'branch1@system.com' : 'manager@system.com'}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="login-password" className="block text-gray-300 text-xs uppercase tracking-wider font-semibold ms-1">
                كلمة المرور
              </label>
              <div className="relative group">
                <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400 group-focus-within:text-caramel transition-colors" aria-hidden="true" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete={isFirstSignIn ? 'new-password' : 'current-password'}
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-800/50 border border-gray-700 text-white ps-10 pe-4 py-3 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel transition-all placeholder-gray-500"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* First sign-in on a device sets its password, so say so before it happens. */}
            {isFirstSignIn && (
              <div className="flex items-start gap-2 bg-caramel/10 border border-caramel/30 rounded-xl p-3 text-xs text-caramel">
                <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <p>هذا أول تسجيل دخول على هذا الجهاز، وكلمة المرور التي تكتبها الآن ستصبح كلمة مرور الفرع.</p>
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="cb-caramel"
              />
              <span className="text-sm text-gray-400 group-hover:text-gray-300 transition-colors">
                تذكرني على هذا الجهاز
              </span>
            </label>

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                role="alert"
                className="text-red-400 text-sm text-center bg-red-500/10 py-2 px-3 rounded-lg"
              >
                {error}
              </motion.p>
            )}

            <motion.button
              whileHover={loading ? {} : { scale: 1.02 }}
              whileTap={loading ? {} : { scale: 0.98 }}
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-caramel to-mocha-600 text-white py-3 rounded-xl font-semibold shadow-lg shadow-caramel/20 flex items-center justify-center gap-2 hover:shadow-caramel/40 transition-shadow disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" role="status" aria-label="جاري تسجيل الدخول" />
              ) : (
                <>تسجيل الدخول <ArrowRight className="w-5 h-5" aria-hidden="true" /></>
              )}
            </motion.button>

            {/* Addresses this build accepts. Clicking one fills the address only — there is
                no shared password to prefill. */}
            <div className="mt-6 pt-6 border-t border-white/10">
              <p className="text-gray-400 text-xs font-semibold mb-3 tracking-wide text-center">
                الحسابات المتاحة على هذا الجهاز
              </p>
              <div className="grid grid-cols-1 gap-2">
                {accountsForThisBuild.map(account => (
                  <button
                    key={account.branchId}
                    type="button"
                    onClick={() => setEmail(account.email)}
                    className="bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-lg p-2 text-xs transition-colors flex items-center justify-between gap-2"
                  >
                    <span className="font-bold text-caramel">{account.branchName}</span>
                    <span className="text-[10px] text-gray-400" dir="ltr">{account.email}</span>
                  </button>
                ))}
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}
