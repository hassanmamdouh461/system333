import { useState } from 'react';
import { AuthError, login } from './api';

interface LoginScreenProps {
  onAuthenticated: (token: string) => void;
}

/**
 * Sign-in gate for the reports portal.
 *
 * The portal used to be fully public: anyone who found the URL saw every branch's revenue
 * and every customer's name and phone number.
 */
export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('أدخل كلمة المرور');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const session = await login(password);
      onAuthenticated(session.token);
    } catch (err) {
      setError(err instanceof AuthError ? 'كلمة المرور غير صحيحة' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Engaz Reports</h1>
        <p>تقارير المبيعات والتشغيل</p>

        <label htmlFor="reports-password">كلمة المرور</label>
        <input
          id="reports-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          dir="ltr"
        />

        {error && <p className="login-error" role="alert">{error}</p>}

        <button type="submit" disabled={busy}>
          {busy ? 'جارٍ التحقق…' : 'دخول'}
        </button>
      </form>
    </div>
  );
}
