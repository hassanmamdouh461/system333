import { UserCheck, Award, Coins, Search, Users } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { StatCard } from '../ui/StatCard';
import { Card, SectionHeader, EmptyState } from '../ui/Card';
import { BRANCHES } from '../../utils/managerAnalytics';
import { ManagerCustomerRow } from '../../services/managerDataService';

interface CustomersTabProps {
  /** Customers already narrowed to the selected branch and search term. */
  filteredCustomers: ManagerCustomerRow[];
  searchTerm: string;
  onSearchChange: (term: string) => void;
  activeBranchLabel: string | undefined;
}

export function CustomersTab({
  filteredCustomers,
  searchTerm,
  onSearchChange,
  activeBranchLabel,
}: CustomersTabProps) {
  const { t, language, isRtl } = useLanguage();
  const currency = language === 'ar' ? 'ج.م' : 'EGP';

  const totalPoints = filteredCustomers.reduce((sum, c) => sum + (Number(c.points) || 0), 0);
  const isSearching = searchTerm.trim().length > 0;

  return (
    <div className="space-y-4 md:space-y-6">

      {/* ── Loyalty summary ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <StatCard
          label={language === 'ar' ? 'إجمالي العملاء' : 'Total Customers'}
          value={filteredCustomers.length.toLocaleString()}
          icon={UserCheck}
          trend={activeBranchLabel}
          color="blue"
        />
        <StatCard
          label={t('Total Points Distributed')}
          value={totalPoints.toLocaleString()}
          icon={Award}
          trend={language === 'ar' ? 'مجموع نقاط الولاء الممنوحة' : 'Loyalty points granted'}
          color="amber"
        />
        <StatCard
          label={language === 'ar' ? 'قيمة استرداد النقاط' : 'Redemption Liability'}
          value={`${totalPoints.toLocaleString()} ${currency}`}
          icon={Coins}
          trend={language === 'ar' ? 'كل نقطة تُستبدل بجنيه واحد' : 'Each point redeems for one unit'}
          color="green"
        />
      </div>

      {/* ── Customer list ────────────────────────────────────────────────────── */}
      <Card flush>
        <div className="p-4 md:p-6 border-b border-gray-200">
          <SectionHeader
            title={language === 'ar' ? `عملاء ${activeBranchLabel}` : `${activeBranchLabel} — Customers`}
            subtitle={
              language === 'ar'
                ? 'أرصدة نقاط الولاء وتاريخ التسجيل'
                : 'Loyalty point balances and registration dates'
            }
            action={
              <div className="relative w-full sm:w-72">
                <label htmlFor="customer-search" className="sr-only">
                  {language === 'ar' ? 'البحث في العملاء' : 'Search customers'}
                </label>
                <Search
                  className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none ${isRtl ? 'right-3' : 'left-3'}`}
                  aria-hidden="true"
                />
                <input
                  id="customer-search"
                  type="search"
                  placeholder={t('Search by phone or name...')}
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className={`w-full py-2 bg-gray-50 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
                />
              </div>
            }
          />
        </div>

        {filteredCustomers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={isSearching
              ? (language === 'ar' ? 'لا نتائج مطابقة' : 'No matching customers')
              : (language === 'ar' ? 'لا عملاء مسجلين' : 'No registered customers')}
            hint={isSearching
              ? (language === 'ar' ? 'جرّب اسمًا أو رقمًا آخر' : 'Try a different name or number')
              : (language === 'ar' ? 'يُسجَّل العميل عند أول فاتورة بنقاط ولاء' : 'A customer is registered on their first loyalty invoice')}
            className="py-14"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {language === 'ar' ? 'قائمة العملاء وأرصدة نقاطهم' : 'Customers and their point balances'}
              </caption>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wide">
                  <th scope="col" className="px-4 py-3 text-start">{t('Customer Name')}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t('Phone Number')}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t('Loyalty Points')}</th>
                  <th scope="col" className="px-4 py-3 text-start">{language === 'ar' ? 'الفرع' : 'Branch'}</th>
                  <th scope="col" className="px-4 py-3 text-start">{t('Registration Date')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {filteredCustomers.map(customer => {
                  const branch = BRANCHES.find(b => b.id === customer.branchId);
                  const branchLabel = language === 'ar' ? branch?.labelAr : branch?.labelEn;

                  return (
                    <tr key={customer.$id} className="hover:bg-gray-50/70 transition-colors">
                      <th scope="row" className="px-4 py-3 text-start font-bold text-gray-900">
                        {customer.name || (language === 'ar' ? 'عميل' : 'Customer')}
                      </th>
                      {/* Phone numbers read left-to-right even in an Arabic layout. */}
                      <td className="px-4 py-3 font-mono text-gray-600" dir="ltr">{customer.phone}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 bg-mocha-50 text-mocha-800 font-bold px-2.5 py-1 rounded-full text-xs tabular-nums">
                          <Award size={12} aria-hidden="true" className="text-mocha-600" />
                          {customer.points || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block text-[11px] font-bold text-mocha-700 bg-mocha-50 border border-mocha-100 px-2 py-0.5 rounded">
                          {branchLabel || (language === 'ar' ? 'غير محدد' : 'Unassigned')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {customer.createdAt
                          ? new Date(customer.createdAt).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
