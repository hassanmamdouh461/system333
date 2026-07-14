import React, { useState } from 'react';
import { User, Store, Lock, HelpCircle, LogOut, QrCode, Building2, Send } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { QrMenuModal } from '../components/settings/QrMenuModal';
import { PinSetupModal } from '../components/settings/PinSetupModal';
import { ProfileSettingsModal } from '../components/settings/ProfileSettingsModal';
import { StoreConfigModal } from '../components/settings/StoreConfigModal';
import { BranchConfigModal } from '../components/settings/BranchConfigModal';
import { TelegramConfigModal } from '../components/settings/TelegramConfigModal';
import { useLanguage } from '../context/LanguageContext';
import { DatabaseStatus } from '../components/ui/DatabaseStatus';
import { SyncStatus } from '../components/ui/SyncStatus';

export default function Settings() {
  const { t } = useLanguage();
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const { logout } = useAuth();

  const sections = [
    {
      id: 'profile',
      title: 'Profile Settings',
      icon: User,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      description: 'Update password and user settings',
    },
    {
      id: 'store',
      title: 'Store Configuration',
      icon: Store,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
      description: 'Edit tax rates',
    },
    {
      id: 'security',
      title: 'Security & Access',
      icon: Lock,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      description: 'Manage pin codes and user permissions',
    },
    {
      id: 'branch',
      title: 'Branch Configuration',
      icon: Building2,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      description: 'Configure branch identity and credentials',
    },
    {
      id: 'telegram',
      title: 'Telegram Reports',
      icon: Send,
      color: 'text-sky-600',
      bgColor: 'bg-sky-50',
      description: 'Configure daily Telegram sales reports',
    },
  ];

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{t('Settings')}</h1>
        <p className="text-sm md:text-base text-gray-600">{t('Configure application and database settings')}</p>
      </div>

      <div className="space-y-6 md:space-y-8">

        {/* Settings Sections Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sections.map((section, idx) => {
            const Icon = section.icon;
            return (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                onClick={() => {
                  if (section.id === 'security') setIsPinModalOpen(true);
                  if (section.id === 'profile') setIsProfileModalOpen(true);
                  if (section.id === 'store') setIsStoreModalOpen(true);
                  if (section.id === 'branch') setIsBranchModalOpen(true);
                  if (section.id === 'telegram') setIsTelegramModalOpen(true);
                }}
                className="bg-white p-5 rounded-2xl border border-gray-100 flex items-start gap-4 hover:shadow-md transition-shadow group cursor-pointer"
              >
                <div className={`w-12 h-12 rounded-full ${section.bgColor} flex items-center justify-center ${section.color} group-hover:scale-110 transition-transform`}>
                  <Icon size={22} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 group-hover:text-mocha-600 transition-colors text-sm md:text-base mb-1">
                    {t(section.title)}
                  </h3>
                  <p className="text-xs md:text-sm text-gray-600">
                    {t(section.description)}
                  </p>
                </div>
              </motion.div>
            );
          })}

          {/* QR Code Menu Generator Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            onClick={() => setIsQrModalOpen(true)}
            className="bg-white p-5 rounded-2xl border border-gray-100 flex items-start gap-4 hover:shadow-md transition-shadow group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform">
              <QrCode size={22} />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 group-hover:text-purple-600 transition-colors text-sm md:text-base mb-1">
                {t('QR Code Menu')}
              </h3>
              <p className="text-xs md:text-sm text-gray-600">
                {t('Generate a dynamic QR Code for customers to view the menu')}
              </p>
            </div>
          </motion.div>
        </div>

        {/* Database & Sync Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
          >
            <DatabaseStatus />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <SyncStatus />
          </motion.div>
        </div>

        {/* Support Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
        >
          <div className="px-4 md:px-6 py-4 bg-gray-50 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">{t('Support')}</h2>
          </div>
          <div className="p-4 md:p-6 flex items-start gap-4 hover:bg-gray-50 transition-colors">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 shrink-0">
              <HelpCircle size={20} />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-bold text-gray-900 text-sm md:text-base">م. حسن ممدوح</h3>
              <p className="text-xs md:text-sm font-semibold text-mocha-600">فريق إنجاز</p>
              <p className="text-xs md:text-sm text-gray-600 font-sans" dir="ltr">📞 01125377606</p>
              <p className="text-xs md:text-sm text-gray-600 font-sans" dir="ltr">✉️ hassanmamdouh461@gmail.com</p>
            </div>
          </div>
        </motion.div>

        <motion.button 
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           transition={{ delay: 0.4 }}
           onClick={logout}
           className="mobile-touch-target w-full bg-red-50 text-red-600 py-3 md:py-4 rounded-xl font-semibold hover:bg-red-100 flex items-center justify-center gap-2 transition-colors tap-highlight-none"
        >
           <LogOut size={20} /> {t('Log Out')}
         </motion.button>
      </div>
      
      <QrMenuModal isOpen={isQrModalOpen} onClose={() => setIsQrModalOpen(false)} />
      <PinSetupModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
      <ProfileSettingsModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} />
      <StoreConfigModal isOpen={isStoreModalOpen} onClose={() => setIsStoreModalOpen(false)} />
      <BranchConfigModal isOpen={isBranchModalOpen} onClose={() => setIsBranchModalOpen(false)} />
      <TelegramConfigModal isOpen={isTelegramModalOpen} onClose={() => setIsTelegramModalOpen(false)} />
    </div>
  );
}
