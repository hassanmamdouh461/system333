import { useState, useEffect } from 'react';
import { X, Building2, Mail, Lock, Tag, ShieldCheck, Hash } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useDialog } from '../../hooks/useDialog';
import { getBranchConfig, setBranchConfig } from '../../utils/settingsConfig';

interface BranchConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Renders nothing while closed so the dialog body — and its focus management — mounts
 * and unmounts with the dialog itself.
 */
export function BranchConfigModal({ isOpen, onClose }: BranchConfigModalProps) {
  if (!isOpen) return null;
  return <BranchConfigModalBody onClose={onClose} />;
}

function BranchConfigModalBody({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const { panelRef, titleId, dialogProps } = useDialog<HTMLDivElement>({ onClose });
  const [branchName, setBranchName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const config = getBranchConfig();
    setBranchName(config.branchName);
    setEmail(config.email);
    // The stored password is a digest, never plaintext. Loading it into the field and
    // saving it back would hash the digest again and lock the branch out, so the field
    // starts empty and an empty field means "keep the current credential".
    setPassword('');
    setBranchId(config.branchId);
    setSuccess(false);
    setError('');
  }, []);

  const handleSave = async () => {
    setError('');

    if (!branchName.trim()) {
      setError(t('Branch name is required'));
      return;
    }
    if (!email.trim()) {
      setError(t('Email is required'));
      return;
    }
    if (password.length > 0 && password.length < 6) {
      setError(t('Password must be at least 6 characters'));
      return;
    }

    await setBranchConfig({
      branchName: branchName.trim(),
      email: email.trim().toLowerCase(),
      branchId: branchId,
      ...(password.length > 0 ? { password } : {}),
    });

    setSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      
      <div
        ref={panelRef}
        {...dialogProps}
        className="relative bg-white w-full max-w-md rounded-2xl shadow-xl overflow-hidden outline-none">
        {/* Header */}
        <div className="bg-orange-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl text-white">
              <Building2 size={24} />
            </div>
            <div>
              <h2 id={titleId} className="text-lg font-bold text-white">{t('Branch Configuration')}</h2>
              <p className="text-orange-100 text-xs">{t('Configure branch identity and credentials')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Close')} className="text-white/80 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-gray-800">
          {/* Branch ID (read-only) */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch ID')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-4 flex items-center pointer-events-none text-gray-400">
                <Hash size={18} />
              </div>
              <input
                aria-label={t('Branch ID')}
                type="text"
                value={branchId}
                readOnly
                className="w-full bg-gray-100 border border-gray-200 rounded-xl ps-11 pe-4 py-3 text-sm font-mono text-gray-500 cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('Auto-generated identifier for this branch')}</p>
          </div>

          {/* Branch Name */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch Name')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-4 flex items-center pointer-events-none text-gray-400">
                <Tag size={18} />
              </div>
              <input
                aria-label={t('Branch Email')}
                type="text"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl ps-11 pe-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="Main Branch"
              />
            </div>
          </div>

          {/* Branch Email */}
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-700 block">{t('Branch Email')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-4 flex items-center pointer-events-none text-gray-400">
                <Mail size={18} />
              </div>
              <input
                aria-label={t('Branch Password')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl ps-11 pe-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="admin@branch.local"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('This email is used to login to this branch')}</p>
          </div>

          {/* Branch Password */}
          <div className="space-y-1">
            <label htmlFor="branch-password" className="text-sm font-bold text-gray-700 block">{t('Branch Password')}</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 ps-4 flex items-center pointer-events-none text-gray-400">
                <Lock size={18} />
              </div>
              <input
                id="branch-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 border border-gray-300 rounded-xl ps-11 pe-4 py-3 text-sm font-semibold focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all"
                placeholder="••••••••"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('Leave blank to keep current password')}</p>
          </div>

          {/* Error */}
          {error && (
            <div className="text-red-600 text-sm font-bold bg-red-50 p-3 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 text-emerald-600 text-sm font-bold bg-emerald-50 p-3 rounded-lg border border-emerald-100">
              <ShieldCheck size={16} />
              <p>{t('Branch configuration saved! Please re-login for changes to take effect.')}</p>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              className="w-full bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all shadow-sm"
            >
              {t('Save Changes')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
