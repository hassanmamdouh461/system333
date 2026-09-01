import { useState, useEffect, useCallback } from 'react';
import { Database, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { menuService } from '../../services/menuService';
import { checkWorkerHealth } from '../../services/workerClient';
import { motion } from 'framer-motion';
import { useLanguage } from '../../context/LanguageContext';

type ConnectionStatus = 'checking' | 'connected' | 'error';

export function DatabaseStatus() {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState<ConnectionStatus>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const checkConnection = useCallback(async () => {
    setStatus('checking');
    try {
      if (isElectron) {
        // Lightweight round trip against the local database.
        await menuService.getAll();
      } else {
        // The worker's own liveness endpoint, which needs no key and no query.
        const healthy = await checkWorkerHealth();
        if (!healthy) throw new Error('Worker health check failed');
      }
      setStatus('connected');
    } catch (error) {
      console.error('[DatabaseStatus] Connection check failed:', error);
      setStatus('error');
    } finally {
      setLastChecked(new Date());
    }
  }, [isElectron]);

  useEffect(() => {
    checkConnection();
    // Auto-check every 60 seconds
    const interval = setInterval(checkConnection, 60000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  const getStatusConfig = () => {
    switch (status) {
      case 'checking':
        return {
          icon: RefreshCw,
          color: 'text-blue-600',
          bgColor: 'bg-blue-50',
          borderColor: 'border-blue-200',
          label: language === 'ar' ? 'جاري التحقق...' : 'Checking...',
          description: isElectron 
            ? (language === 'ar' ? 'يتم الآن فحص الاتصال بقاعدة بيانات SQLite المحلية' : 'Verifying local database connection')
            : (language === 'ar' ? 'يتم الآن فحص الاتصال بقاعدة بيانات Cloudflare D1 السحابية' : 'Verifying Cloudflare D1 cloud database connection'),
        };
      case 'connected':
        return {
          icon: Wifi,
          color: 'text-green-600',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          label: isElectron 
            ? (language === 'ar' ? 'قاعدة البيانات المحلية متصلة' : 'Local SQLite Connected')
            : (language === 'ar' ? 'قاعدة البيانات السحابية متصلة' : 'Cloudflare D1 Connected'),
          description: isElectron
            ? (language === 'ar' ? 'قاعدة البيانات المحلية متصلة وتعمل بكفاءة تامة' : 'Local SQLite database is connected and fully operational')
            : (language === 'ar' ? 'قاعدة بيانات Cloudflare D1 متصلة وتعمل بكفاءة تامة أونلاين' : 'Cloudflare D1 cloud database is connected and fully operational online'),
        };
      case 'error':
        return {
          icon: WifiOff,
          color: 'text-red-600',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          label: isElectron
            ? (language === 'ar' ? 'خطأ في قاعدة البيانات' : 'Database Error')
            : (language === 'ar' ? 'خطأ في الاتصال بالسحاب' : 'Cloud Connection Error'),
          description: isElectron
            ? (language === 'ar' ? 'فشل الاتصال بقاعدة بيانات SQLite المحلية' : 'Failed to access local SQLite database')
            : (language === 'ar' ? 'تعذر الاتصال بـ Cloudflare D1. يرجى التحقق من إعدادات الـ Worker' : 'Failed to connect to Cloudflare D1. Please check Worker settings.'),
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`border ${config.borderColor} ${config.bgColor} rounded-xl p-4 md:p-5`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          {/* Icon */}
          <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full ${config.bgColor} border ${config.borderColor} flex items-center justify-center ${config.color} flex-shrink-0`}>
            <Icon 
              size={20} 
              className={status === 'checking' ? 'animate-spin' : ''} 
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 text-start">
            <div className="flex items-center gap-2 mb-1">
              <Database size={16} className="text-gray-400 flex-shrink-0" />
              <h3 className={`font-semibold ${config.color} text-sm md:text-base`}>
                {language === 'ar' ? 'حالة قاعدة البيانات:' : 'Database Status:'} {config.label}
              </h3>
            </div>
            <p className="text-xs md:text-sm text-gray-600 mb-2">
              {config.description}
            </p>
            
            <div className="space-y-1 text-xs text-gray-500">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-700">{language === 'ar' ? 'النوع:' : 'Type:'}</span>
                <span>{isElectron ? t('SQLite (Offline Standalone)') : (language === 'ar' ? 'سحابي (Cloudflare D1)' : 'Cloudflare D1 Database')}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-700">{isElectron ? (language === 'ar' ? 'مسار التخزين:' : 'File Storage:') : (language === 'ar' ? 'رابط الاتصال:' : 'Endpoint:')}</span>
                <span className="font-mono">{isElectron ? 'engaz.db' : 'Cloudflare D1'}</span>
              </div>
              {lastChecked && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-700">{language === 'ar' ? 'آخر فحص:' : 'Last checked:'}</span>
                  <span>{lastChecked.toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Refresh Button */}
        <button
          onClick={checkConnection}
          disabled={status === 'checking'}
          className={`mobile-touch-target p-2 rounded-lg ${config.bgColor} ${config.color} hover:opacity-80 transition-opacity disabled:opacity-50 flex-shrink-0 tap-highlight-none`}
          aria-label={t('Refresh')}
          title={t('Refresh')}
        >
          <RefreshCw 
            size={18} 
            className={status === 'checking' ? 'animate-spin' : ''} 
          />
        </button>
      </div>
    </motion.div>
  );
}
