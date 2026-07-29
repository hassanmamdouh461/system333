import React, { useState, useEffect } from 'react';
import { X, User, ShieldCheck, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileSettingsModal({ isOpen, onClose }: ProfileSettingsModalProps) {
  const { t } = useLanguage();
  const { user, changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess(false);
      setSaving(false);
    }
  }, [isOpen]);

  const handleSave = async () => {
    setError('');
    setSuccess(false);

    if (!currentPassword) {
      setError(t('Enter your current password'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('New password must be at least 8 characters'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('Passwords do not match'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('New password must be different from the current password'));
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      setError(err.message || t('Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-blue-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <User size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('Profile Settings')}</h2>
              <p className="text-blue-100 text-xs">{t('Change your account password')}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-gray-800">
          {/* Account (read-only — password is verified against the server/local DB) */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <span className="text-xs text-gray-500 block">{t('Signed in as')}</span>
            <span className="font-bold text-gray-800">{user?.name || user?.email || '—'}</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700 block">{t('Current Password')}</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-700 block">{t('New Password')}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder={t('At least 8 characters')}
                autoComplete="new-password"
              />
            </div>

            {newPassword.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-bold text-gray-700 block">{t('Confirm New Password')}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-300 rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">
              <AlertCircle size={16} />
              <p>{error}</p>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-green-700 text-sm font-bold bg-green-50 p-3 rounded-lg border border-green-100">
              <ShieldCheck size={16} />
              <p>{t('Password changed successfully!')}</p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm flex justify-center items-center gap-2"
            >
              {saving ? t('Saving...') : t('Change Password')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
