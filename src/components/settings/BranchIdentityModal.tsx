import { useState, useEffect } from 'react';
import { X, Building2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useDialog } from '../../hooks/useDialog';
import { getBranchConfig, setBranchConfig } from '../../utils/settingsConfig';
import { validateBranchIdentity, BRANCH_NAME_MAX } from '../../utils/branchIdentity';

interface BranchIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Renders nothing while closed so the dialog body — and its focus management — mounts
 * and unmounts with the dialog itself.
 */
export function BranchIdentityModal({ isOpen, onClose }: BranchIdentityModalProps) {
  if (!isOpen) return null;
  return <BranchIdentityModalBody onClose={onClose} />;
}

function BranchIdentityModalBody({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const { panelRef, titleId, dialogProps } = useDialog<HTMLDivElement>({ onClose });

  const [branchName, setBranchName] = useState('');
  const [email, setEmail] = useState('');
  const [branchId, setBranchId] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const config = getBranchConfig();
    setBranchName(config.branchName);
    setEmail(config.email);
    setBranchId(config.branchId);
    setSuccess(false);
    setError('');
  }, []);

  const handleSave = async () => {
    setError('');

    const problem = validateBranchIdentity({
      branchId,
      branchName,
      email,
      freezeId: true,
    });
    if (problem) {
      setError(problem);
      return;
    }

    // The id is deliberately not editable here: every order this till has written carries it,
    // and changing it would split this branch's history in two. New branches are registered
    // from the reports portal, which issues their ids.
    await setBranchConfig({ branchName: branchName.trim(), email: email.trim() });

    setSuccess(true);
    setTimeout(onClose, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" dir="rtl">
      <div
        ref={panelRef}
        {...dialogProps}
        aria-labelledby={titleId}
        className="w-full max-w-md bg-[#221812] border border-white/10 rounded-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-caramel/15 border border-caramel/30 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-caramel" />
            </div>
            <h2 id={titleId} className="text-sm font-bold text-white">{t('Branch identity')}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-bold text-mocha-200">{t('Branch name')}</span>
            <input
              value={branchName}
              maxLength={BRANCH_NAME_MAX}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="فرع المعادي"
              className="w-full bg-[#120C08] border border-white/10 text-white px-3 py-2 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel text-sm transition-all placeholder-gray-500"
              autoFocus
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-mocha-200">{t('Branch email')}</span>
            <span className="block text-[10px] text-mocha-400">{t('Branch name and sign-in address')}</span>
            <input
              type="email"
              value={email}
              dir="ltr"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="branch@engaz.tech"
              className="w-full bg-[#120C08] border border-white/10 text-white px-3 py-2 rounded-xl focus:outline-none focus:border-caramel focus:ring-1 focus:ring-caramel text-sm transition-all placeholder-gray-500"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-bold text-mocha-200">{t('Branch id')}</span>
            <span className="block text-[10px] text-mocha-400">
              {t('Branch id is fixed: every order this device wrote carries it. New branches are registered from the manager portal.')}
            </span>
            <input
              value={branchId}
              dir="ltr"
              disabled
              className="w-full bg-[#120C08] border border-white/10 text-gray-400 px-3 py-2 rounded-xl text-sm opacity-70 cursor-not-allowed"
            />
          </label>

          {error && (
            <p className="bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold py-2 px-3 rounded-xl">
              {error}
            </p>
          )}

          {success && (
            <p className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold py-2 px-3 rounded-xl">
              {t('Branch identity updated successfully!')}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 bg-caramel hover:bg-caramel/90 text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
            >
              {t('Save Changes')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-bold py-2.5 rounded-xl transition-colors"
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
