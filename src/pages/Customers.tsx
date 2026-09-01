import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Search, Plus, Edit2, Trash2, Award } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { customersService } from '../services/customersService';
import { Customer } from '../types/customer';
import { reportFailure } from '../utils/reportFailure';
import { AddCustomerModal } from '../components/customers/AddCustomerModal';
import { EditPointsModal } from '../components/customers/EditPointsModal';

/** Digits a loyalty phone number must have to be accepted. */
const PHONE_LENGTH = 11;

export default function Customers() {
  const { t, isRtl, language } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editPoints, setEditPoints] = useState(0);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setCustomers(await customersService.getAll());
    } catch (err) {
      console.error('[Customers] Failed to load customers:', err);
      setError(t('Failed to load customers'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const filteredCustomers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter(c =>
      c.phone.includes(query) || c.name.toLowerCase().includes(query)
    );
  }, [customers, searchTerm]);

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = newPhone.replace(/\D/g, '');
    const name = newName.trim() || 'Customer';

    if (phone.length !== PHONE_LENGTH) {
      alert(t('Phone number must be exactly 11 digits'));
      return;
    }

    try {
      await customersService.save({ phone, name, points: 0 });
      setIsAddModalOpen(false);
      setNewPhone('');
      setNewName('');
      loadCustomers();
    } catch (err) {
      reportFailure(t('Failed to save customer'), err);
    }
  };

  const handleOpenEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditPoints(customer.points);
    setIsEditModalOpen(true);
  };

  const closeEdit = () => {
    setIsEditModalOpen(false);
    setSelectedCustomer(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      await customersService.save({
        phone: selectedCustomer.phone,
        name: selectedCustomer.name,
        points: editPoints,
      });
      closeEdit();
      loadCustomers();
    } catch (err) {
      reportFailure(t('Failed to adjust points'), err);
    }
  };

  const handleDeleteCustomer = async (customer: Customer) => {
    if (!confirm(t('Are you sure you want to delete this customer profile?'))) return;
    try {
      await customersService.delete(customer.id);
      loadCustomers();
    } catch (err) {
      reportFailure(t('Failed to delete customer'), err);
    }
  };

  const totalPoints = useMemo(
    () => customers.reduce((sum, c) => sum + (Number(c.points) || 0), 0),
    [customers]
  );

  return (
    <div className="space-y-4 md:space-y-6 text-gray-900">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Customers')}</h1>
          <p className="text-xs md:text-sm text-gray-500">{t('Manage loyalty points and profiles')}</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-mocha-600 hover:bg-mocha-700 text-white text-xs md:text-sm font-bold rounded-xl transition-colors shadow-md active:scale-95 self-start md:self-auto"
        >
          <Plus size={16} aria-hidden="true" />
          {t('Add Customer')}
        </button>
      </div>

      {/* ── Loyalty summary ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 shadow-sm">
          <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('Total Registered')}</p>
          <p className="text-xl md:text-2xl font-bold text-gray-900 tabular-nums mt-1">{customers.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 shadow-sm">
          <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('Total Points Distributed')}</p>
          <p className="text-xl md:text-2xl font-bold text-mocha-700 tabular-nums mt-1">{totalPoints.toLocaleString()}</p>
        </div>
      </div>

      {/* ── Search and list ────────────────────────────────────────────────── */}
      <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
        <div className="relative max-w-md">
          <label htmlFor="customers-search" className="sr-only">{t('Search by phone or name...')}</label>
          <Search
            className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none ${isRtl ? 'right-3' : 'left-3'}`}
            aria-hidden="true"
          />
          <input
            id="customers-search"
            type="search"
            placeholder={t('Search by phone or name...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('Customers')}</caption>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-600 uppercase tracking-wide">
                <th scope="col" className="px-4 py-3 text-start">{t('Customer Name')}</th>
                <th scope="col" className="px-4 py-3 text-start">{t('Phone Number')}</th>
                <th scope="col" className="px-4 py-3 text-start">{t('Loyalty Points')}</th>
                <th scope="col" className="px-4 py-3 text-start">{t('Registration Date')}</th>
                <th scope="col" className="px-4 py-3 text-center">{t('Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-gray-500" role="status">{t('Loading...')}</td>
                </tr>
              ) : error ? (
                <tr>
                  {/* A failure reads differently from an empty list, so it is styled and
                      announced as an error rather than as "no records". */}
                  <td colSpan={5} className="text-center py-10 text-red-700 font-semibold" role="alert">{error}</td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-gray-500">
                    {searchTerm.trim() ? t('No records found') : t('No registered customers')}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map(customer => (
                  <tr key={customer.id} className="hover:bg-gray-50/70 transition-colors">
                    <th scope="row" className="px-4 py-3.5 text-start font-bold text-gray-900">{customer.name}</th>
                    {/* A phone number reads left-to-right even inside an Arabic layout. */}
                    <td className="px-4 py-3.5 font-mono text-gray-600" dir="ltr">{customer.phone}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 bg-mocha-50 text-mocha-800 font-bold px-2.5 py-1 rounded-full text-xs tabular-nums">
                        <Award size={12} aria-hidden="true" className="text-mocha-600" />
                        {customer.points}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500">
                      {new Date(customer.createdAt).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => handleOpenEdit(customer)}
                          className="p-2 hover:bg-mocha-50 text-mocha-700 rounded-lg transition-colors"
                          aria-label={`${t('Edit Points')} — ${customer.name}`}
                          title={t('Edit Points')}
                        >
                          <Edit2 size={14} aria-hidden="true" />
                        </button>
                        <button
                          onClick={() => handleDeleteCustomer(customer)}
                          className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                          aria-label={`${t('Delete')} — ${customer.name}`}
                          title={t('Delete')}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isAddModalOpen && (
          <AddCustomerModal
            phone={newPhone}
            name={newName}
            onPhoneChange={setNewPhone}
            onNameChange={setNewName}
            onSubmit={handleAddCustomer}
            onClose={() => setIsAddModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isEditModalOpen && selectedCustomer && (
          <EditPointsModal
            customer={selectedCustomer}
            points={editPoints}
            onPointsChange={setEditPoints}
            onSubmit={handleSaveEdit}
            onClose={closeEdit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
