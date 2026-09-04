import { useState } from 'react';
import { Store, LogOut, QrCode, Globe, Send, Armchair, Palette } from 'lucide-react';

// Web reports portal URL. The desktop POS pushes its data to the isolated reports D1
// database (api-reports.engaz.tech) and this link opens that data as a live dashboard
// on its own subdomain — fully separated from the production POS site.
const REPORTS_PORTAL_URL = 'https://reporting.engaz.tech';
import { motion } from 'framer-motion';
import { DatabaseStatus } from '../components/ui/DatabaseStatus';
import { SyncStatus } from '../components/ui/SyncStatus';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { QrMenuModal } from '../components/settings/QrMenuModal';
import { StoreConfigModal } from '../components/settings/StoreConfigModal';
import { TelegramConfigModal } from '../components/settings/TelegramConfigModal';
import { TablesConfigModal } from '../components/settings/TablesConfigModal';
import { MenuBrandingModal } from '../components/settings/MenuBrandingModal';

type ModalName = 'qr' | 'store' | 'telegram' | 'tables' | 'branding';

export default function Settings() {
  const [openModal, setOpenModal] = useState<ModalName | null>(null);
  const { logout } = useAuth();
  const { t } = useLanguage();

  const closeModal = () => setOpenModal(null);

  const sections = [
    {
      title: t('Store Configuration'),
      items: [
        {
          icon: Store,
          label: t('Store Configuration'),
          desc: t('Tax rates and general store info'),
          onClick: () => setOpenModal('store')
        },
        {
          icon: Armchair,
          label: t('Table Management'),
          desc: t('Add or remove dining tables'),
          onClick: () => setOpenModal('tables')
        },
      ]
    },
    {
      title: t('Customer Experience'),
      items: [
        {
          icon: QrCode,
          label: t('Customer QR Menu'),
          desc: t('Generate & print QR code for customer view'),
          onClick: () => setOpenModal('qr')
        },
        {
          icon: Palette,
          label: 'هوية ومظهر المنيو الإلكتروني',
          desc: 'تخصيص اسم المنيو، اللوجو، صور الغلاف، والألوان',
          onClick: () => setOpenModal('branding')
        },
      ]
    },
    {
      title: t('Telegram Configuration'),
      items: [
        {
          icon: Send,
          label: t('Enable Telegram Reports'),
          desc: t('Send the daily report automatically'),
          onClick: () => setOpenModal('telegram')
        },
      ]
    },
    {
      title: t('Web Reports Portal'),
      items: [
        {
          icon: Globe,
          label: t('Open Reports Website'),
          desc: t('Open the reports portal in a browser'),
          onClick: () => window.open(REPORTS_PORTAL_URL, '_blank', 'noopener,noreferrer')
        },
      ]
    }
  ];

  return (
    <div className="space-y-3 md:space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Settings')}</h1>
        <p className="text-xs md:text-base text-gray-500">{t('Manage your account and preferences.')}</p>
      </div>

      <div className="space-y-3 md:space-y-6">
        {sections.map((section, idx) => (
          <motion.div 
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
          >
            <div className="px-4 md:px-6 py-4 bg-gray-50 border-b border-gray-100">
               <h2 className="font-semibold text-gray-900">{section.title}</h2>
            </div>
            <div className="p-2">
               {section.items.map((item, i) => (
                  <button 
                    key={i} 
                    onClick={item.onClick}
                    className="mobile-touch-target w-full flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-colors text-start group tap-highlight-none"
                  >
                     <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 group-hover:bg-mocha-50 group-hover:text-mocha-700 transition-colors">
                        <item.icon size={20} />
                     </div>
                     <div className="flex-1">
                        <h3 className="font-medium text-gray-900 text-sm md:text-base">{item.label}</h3>
                        <p className="text-xs md:text-sm text-gray-500">{item.desc}</p>
                     </div>
                  </button>
               ))}
            </div>
          </motion.div>
        ))}

        {/* Database & Sync Connection Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <DatabaseStatus />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.33 }}
          >
            <SyncStatus />
          </motion.div>
        </div>

        <motion.button 
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           transition={{ delay: 0.4 }}
           onClick={logout}
           className="mobile-touch-target w-full bg-red-50 text-red-600 py-3 md:py-4 rounded-xl font-semibold hover:bg-red-100 flex items-center justify-center gap-2 transition-colors tap-highlight-none"
        >
           <LogOut size={20} /> {t('Sign Out')}
         </motion.button>
      </div>
      
      <QrMenuModal isOpen={openModal === 'qr'} onClose={closeModal} />
      <StoreConfigModal isOpen={openModal === 'store'} onClose={closeModal} />
      <TelegramConfigModal isOpen={openModal === 'telegram'} onClose={closeModal} />
      <TablesConfigModal isOpen={openModal === 'tables'} onClose={closeModal} />
      <MenuBrandingModal isOpen={openModal === 'branding'} onClose={closeModal} />
    </div>
  );
}
