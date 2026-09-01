import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar, Download, AlertCircle, Building2, ChevronDown, RefreshCw,
  SignalHigh, WifiOff, Package, BarChart3, Users, Settings, Send, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';
import { useMenu } from '../hooks/useMenu';
import SettingsPage from './Settings';
import { AnalyticsPeriod, BRANCHES } from '../utils/managerAnalytics';
import { useManagerDashboardData } from '../hooks/useManagerDashboardData';
import {
  buildCustomerReport,
  buildInventoryReport,
  buildSalesReport,
  readTelegramConfig,
  sendTelegramMessage,
} from '../utils/managerReports';
import { AnalyticsTab } from '../components/manager/AnalyticsTab';
import { InventoryTab } from '../components/manager/InventoryTab';
import { CustomersTab } from '../components/manager/CustomersTab';

type ManagerTab = 'analytics' | 'inventory' | 'customers' | 'settings';

const PERIOD_LABEL_KEYS: Record<AnalyticsPeriod, string> = {
  'Today': 'today',
  'This Week': 'this week',
  'This Month': 'this month',
  'This Year': 'this year',
};

const PERIOD_OPTIONS: AnalyticsPeriod[] = ['Today', 'This Week', 'This Month', 'This Year'];

function isAnalyticsPeriod(value: string | null): value is AnalyticsPeriod {
  return value === 'Today' || value === 'This Week' || value === 'This Month' || value === 'This Year';
}

export default function ManagerDashboard() {
  const { t, isRtl, language } = useLanguage();
  const { items: menuItems } = useMenu();

  const [selectedBranch, setSelectedBranch] = useState<string>(
    () => localStorage.getItem('manager_selected_branch') || 'all'
  );
  const [dateRange, setDateRange] = useState<AnalyticsPeriod>(() => {
    const saved = localStorage.getItem('manager_date_range');
    return isAnalyticsPeriod(saved) ? saved : 'This Week';
  });
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ManagerTab>('analytics');
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [isSendingReport, setIsSendingReport] = useState(false);

  const {
    loading,
    isDemoMode,
    errorInfo,
    refresh,
    orders,
    filteredCustomers,
    analytics,
    stockRows,
    materialYields,
    inventorySummary,
    taxRate,
  } = useManagerDashboardData({
    selectedBranch,
    period: dateRange,
    language,
    customerSearchTerm,
  });

  // Close the branch dropdown on any outside click.
  useEffect(() => {
    const close = () => setIsBranchDropdownOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const activeBranchLabel = useMemo(() => {
    const branch = BRANCHES.find(b => b.id === selectedBranch);
    return language === 'ar' ? branch?.labelAr : branch?.labelEn;
  }, [selectedBranch, language]);

  const periodLabel = t(PERIOD_LABEL_KEYS[dateRange]);

  const TABS: { id: ManagerTab; label: string; icon: typeof BarChart3; badge?: number }[] = [
    { id: 'analytics', label: language === 'ar' ? 'الإحصائيات' : 'Analytics', icon: BarChart3 },
    {
      id: 'inventory',
      label: language === 'ar' ? 'المخزون' : 'Inventory',
      icon: Package,
      badge: inventorySummary.lowStockCount || undefined,
    },
    { id: 'customers', label: language === 'ar' ? 'العملاء' : 'Customers', icon: Users },
    { id: 'settings', label: t('Settings'), icon: Settings },
  ];

  /** Sends the report for whichever tab is open; the settings tab has none. */
  const sendTelegramReport = async () => {
    const config = readTelegramConfig();
    if (!config) {
      alert(language === 'ar'
        ? 'يرجى إدخال التوكن ومعرف المحادثة في الإعدادات أولاً!'
        : 'Please enter Bot Token and Chat ID in Settings!');
      return;
    }

    if (activeTab === 'settings') {
      alert(language === 'ar'
        ? 'افتح لوحة الإحصائيات أو المخزون أو العملاء لإرسال تقريرها.'
        : 'Open the Analytics, Inventory, or Customers tab to send its report.');
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-CA');
    let message: string;

    if (activeTab === 'analytics') {
      if (analytics.totalCount === 0) {
        alert(language === 'ar'
          ? 'لا توجد مبيعات مسجلة في هذه الفترة لإرسالها!'
          : 'No orders recorded in this period to send!');
        return;
      }
      message = buildSalesReport({
        analytics, orders, selectedBranch, period: dateRange, language, taxRate, todayStr,
      });
    } else if (activeTab === 'inventory') {
      message = buildInventoryReport({
        summary: inventorySummary, stockRows, selectedBranch, language, todayStr,
      });
    } else {
      message = buildCustomerReport({
        customers: filteredCustomers, selectedBranch, language, todayStr,
      });
    }

    setIsSendingReport(true);
    try {
      await sendTelegramMessage(config, message);
      alert(language === 'ar'
        ? 'تم إرسال التقرير إلى تيليجرام بنجاح.'
        : 'Report sent to Telegram successfully.');
    } catch (err) {
      const reason = err instanceof Error ? err.message : (language === 'ar' ? 'خطأ غير معروف' : 'Unknown error');
      alert(`${language === 'ar' ? 'فشل الإرسال: ' : 'Send failed: '}${reason}`);
    } finally {
      setIsSendingReport(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-gray-600" role="status">
        <Loader2 size={32} className="animate-spin text-mocha-600" aria-hidden="true" />
        <p className="font-semibold">
          {language === 'ar' ? 'جاري تحميل بيانات الفروع…' : 'Loading branch data…'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 text-gray-900 pb-12">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">
                {language === 'ar' ? 'لوحة الإدارة المركزية' : 'Central Management'}
              </h1>
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border',
                  isDemoMode
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                )}
              >
                {isDemoMode ? <WifiOff size={12} aria-hidden="true" /> : <SignalHigh size={12} aria-hidden="true" />}
                {isDemoMode
                  ? (language === 'ar' ? 'بيانات تجريبية' : 'Demo data')
                  : (language === 'ar' ? 'متصل' : 'Live')}
              </span>
            </div>
            <p className="text-xs md:text-sm text-gray-500 mt-1">
              {language === 'ar'
                ? 'إيرادات ومخزون وعملاء كل الفروع في مكان واحد'
                : 'Revenue, stock and customers across every branch'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="p-2.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-900 transition-colors active:scale-95"
              aria-label={t('Refresh')}
              title={t('Refresh')}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>

            <button
              onClick={sendTelegramReport}
              disabled={isSendingReport}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl text-xs md:text-sm font-bold transition-colors active:scale-95"
            >
              {isSendingReport
                ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                : <Send size={15} aria-hidden="true" />}
              <span className="hidden sm:inline">
                {language === 'ar' ? 'تقرير تيليجرام' : 'Telegram report'}
              </span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-gray-900 hover:bg-black text-white rounded-xl text-xs md:text-sm font-bold transition-colors active:scale-95"
            >
              <Download size={15} aria-hidden="true" />
              <span className="hidden sm:inline">{t('Export')}</span>
            </button>
          </div>
        </div>

        {/* Scope: which branch and which period every figure below refers to. */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsBranchDropdownOpen(!isBranchDropdownOpen);
              }}
              aria-expanded={isBranchDropdownOpen}
              aria-haspopup="listbox"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white border border-gray-200 hover:border-gray-300 rounded-xl text-xs md:text-sm font-bold text-gray-700 hover:text-gray-900 transition-colors"
            >
              <Building2 size={15} className="text-mocha-600" aria-hidden="true" />
              <span>{activeBranchLabel}</span>
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={clsx('text-gray-400 transition-transform', isBranchDropdownOpen && 'rotate-180')}
              />
            </button>

            <AnimatePresence>
              {isBranchDropdownOpen && (
                <motion.ul
                  role="listbox"
                  aria-label={language === 'ar' ? 'اختيار الفرع' : 'Select branch'}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={clsx(
                    'absolute z-40 mt-2 w-56 bg-white border border-gray-200 rounded-2xl shadow-lg py-2 overflow-hidden',
                    isRtl ? 'right-0' : 'left-0'
                  )}
                >
                  {BRANCHES.map(branch => {
                    const isActive = selectedBranch === branch.id;
                    return (
                      <li key={branch.id} role="option" aria-selected={isActive}>
                        <button
                          onClick={() => {
                            setSelectedBranch(branch.id);
                            localStorage.setItem('manager_selected_branch', branch.id);
                          }}
                          className={clsx(
                            'w-full text-start px-4 py-2.5 text-xs md:text-sm font-semibold hover:bg-mocha-50 transition-colors flex items-center gap-2.5',
                            isActive ? 'text-mocha-700 bg-mocha-50/60' : 'text-gray-600'
                          )}
                        >
                          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', isActive ? 'bg-caramel-500' : 'bg-transparent')} />
                          {language === 'ar' ? branch.labelAr : branch.labelEn}
                        </button>
                      </li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>

          {/* Period as segmented buttons: the whole range is visible without opening a menu. */}
          <div
            className="inline-flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1"
            role="group"
            aria-label={language === 'ar' ? 'الفترة الزمنية' : 'Time period'}
          >
            <Calendar size={14} className="text-gray-400 mx-1.5 shrink-0" aria-hidden="true" />
            {PERIOD_OPTIONS.map(option => (
              <button
                key={option}
                onClick={() => {
                  setDateRange(option);
                  localStorage.setItem('manager_date_range', option);
                }}
                aria-pressed={dateRange === option}
                className={clsx(
                  'px-2.5 md:px-3 py-1.5 rounded-lg text-[11px] md:text-xs font-bold transition-colors whitespace-nowrap',
                  dateRange === option
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                )}
              >
                {t(option)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 overflow-x-auto hide-scrollbar"
        role="tablist"
        aria-label={language === 'ar' ? 'أقسام اللوحة' : 'Dashboard sections'}
      >
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'relative inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs md:text-sm font-bold transition-colors whitespace-nowrap',
                isActive ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              )}
            >
              <Icon size={15} aria-hidden="true" />
              {tab.label}
              {tab.badge !== undefined && (
                <span
                  className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                  aria-label={`${tab.badge} ${t('Low Stock')}`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Demo fallback notice ─────────────────────────────────────────────── */}
      {isDemoMode && errorInfo && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-4 rounded-2xl flex items-start gap-3" role="status">
          <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-bold text-sm">
              {language === 'ar' ? 'يتم عرض بيانات تجريبية' : 'Showing demo data'}
            </h2>
            <p className="text-xs text-amber-800/90 mt-1 leading-relaxed">
              {language === 'ar'
                ? `تعذّر الاتصال بقاعدة البيانات المركزية (${errorInfo}). الأرقام أدناه توضيحية ولا تمثّل مبيعات حقيقية.`
                : `Could not reach the central database (${errorInfo}). The figures below are illustrative, not real sales.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Active tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <AnalyticsTab
          analytics={analytics}
          inventorySummary={inventorySummary}
          menuItems={menuItems}
          selectedBranch={selectedBranch}
          period={dateRange}
          activeBranchLabel={activeBranchLabel}
          periodLabel={periodLabel}
          taxRate={taxRate}
        />
      )}

      {activeTab === 'inventory' && (
        <InventoryTab
          stockRows={stockRows}
          summary={inventorySummary}
          materialYields={materialYields}
          selectedBranch={selectedBranch}
          activeBranchLabel={activeBranchLabel}
        />
      )}

      {activeTab === 'customers' && (
        <CustomersTab
          filteredCustomers={filteredCustomers}
          searchTerm={customerSearchTerm}
          onSearchChange={setCustomerSearchTerm}
          activeBranchLabel={activeBranchLabel}
        />
      )}

      {activeTab === 'settings' && (
        <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-200 shadow-sm">
          <SettingsPage />
        </div>
      )}
    </div>
  );
}
