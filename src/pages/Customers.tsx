import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  Award, 
  UserCheck, 
  Coins, 
  X,
  Phone,
  User,
  Calendar
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { customersService } from '../services/customersService';
import { Customer } from '../types/customer';
import { StatCard } from '../components/ui/StatCard';

export default function Customers() {
  const { t, isRtl, language } = useLanguage();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  // Form State
  const [newPhone, setNewPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [editPoints, setEditPoints] = useState<number>(0);

  // Load customers
  const loadCustomers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await customersService.getAll();
      setCustomers(data);
    } catch (err) {
      console.error(err);
      setError(t('Failed to load customers'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // Filtered customers list
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      c.phone.includes(searchTerm) || 
      c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [customers, searchTerm]);

  // Aggregate Stats
  const stats = useMemo(() => {
    const totalCount = customers.length;
    const totalPoints = customers.reduce((sum, c) => sum + c.points, 0);
    const totalValue = totalPoints; // 1 point = 1 EGP
    return { totalCount, totalPoints, totalValue };
  }, [customers]);

  // Handlers
  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = newPhone.trim();
    const name = newName.trim() || 'Customer';

    if (phone.length !== 11) {
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
      console.error(err);
      alert(t('Failed to save customer'));
    }
  };

  const handleOpenEdit = (customer: Customer) => {
    setSelectedCustomer(customer);
    setEditPoints(customer.points);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      await customersService.save({
        phone: selectedCustomer.phone,
        name: selectedCustomer.name,
        points: editPoints
      });
      setIsEditModalOpen(false);
      setSelectedCustomer(null);
      loadCustomers();
    } catch (err) {
      console.error(err);
      alert(t('Failed to adjust points'));
    }
  };

  const executeDeleteCustomer = async (customer: Customer) => {
    if (!confirm(t('Are you sure you want to delete this customer profile?'))) return;

    try {
      await customersService.delete(customer.id);
      loadCustomers();
    } catch (err) {
      console.error(err);
      alert(t('Failed to delete customer'));
    }
  };

  const handleDeleteCustomer = (customer: Customer) => {
    executeDeleteCustomer(customer);
  };

  return (
    <div className="space-y-4 md:space-y-8 text-gray-800">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900 text-left">{t('Customers')}</h1>
          <p className="text-xs md:text-base text-gray-500 text-left">{t('Manage loyalty points and profiles')}</p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-mocha-600 hover:bg-mocha-700 text-white text-xs md:text-sm font-bold rounded-xl transition-all shadow-md active:scale-95 self-start md:self-auto"
        >
          <Plus size={16} />
          {t('Add Customer')}
        </button>
      </div>



      {/* Filter & Listing */}
      <div className="bg-white p-4 md:p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        {/* Search */}
        <div className="relative max-w-md">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 md:w-5 md:h-5 ${isRtl ? 'right-3' : 'left-3'}`} />
          <input
            type="text"
            placeholder={t('Search by phone or name...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-sm ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-gray-150">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-150 text-[11px] md:text-xs font-extrabold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">{t('Customer Name')}</th>
                <th className="px-4 py-3 text-left">{t('Phone Number')}</th>
                <th className="px-4 py-3 text-left">{t('Loyalty Points')}</th>
                <th className="px-4 py-3 text-left">{t('Registration Date')}</th>
                <th className="px-4 py-3 text-center">{t('Action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs md:text-sm text-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400 font-bold">{t('Loading...')}</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-red-500 font-bold">{error}</td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400 font-bold">{t('No records found')}</td>
                </tr>
              ) : (
                filteredCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5 font-bold text-gray-900">{c.name}</td>
                    <td className="px-4 py-3.5 font-mono text-gray-650">{c.phone}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1 bg-mocha-50 text-mocha-800 font-bold px-2 py-0.5 rounded-full text-xs">
                        <Award size={12} className="text-mocha-600" />
                        {c.points}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-400">
                      {new Date(c.createdAt).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US')}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <div className="flex justify-center items-center gap-2">
                        <button
                          onClick={() => handleOpenEdit(c)}
                          className="p-1.5 hover:bg-mocha-50 text-mocha-700 rounded-lg transition-colors"
                          title={t('Edit Points')}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteCustomer(c)}
                          className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                          title={t('Delete')}
                        >
                          <Trash2 size={14} />
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

      {/* ─── Add Customer Modal ─── */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 max-w-sm w-full relative"
            >
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="absolute top-4 right-4 p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
              
              <h3 className="text-lg font-bold text-gray-900 mb-6 text-left">{t('Register New Customer')}</h3>
              
              <form onSubmit={handleAddCustomer} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 block text-left">{t('Phone Number')}</label>
                  <div className="relative">
                    <Phone className="absolute top-1/2 -translate-y-1/2 left-3 w-4 h-4 text-gray-450" />
                    <input
                      type="tel"
                      required
                      placeholder="01xxxxxxxxx"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-left font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 block text-left">{t('Customer Name')}</label>
                  <div className="relative">
                    <User className="absolute top-1/2 -translate-y-1/2 left-3 w-4 h-4 text-gray-455" />
                    <input
                      type="text"
                      placeholder={t('Customer Name')}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-left"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-mocha-700 hover:bg-mocha-800 text-white rounded-xl font-bold transition-all shadow-md"
                  >
                    {t('Confirm')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Edit / Adjust Points Modal ─── */}
      <AnimatePresence>
        {isEditModalOpen && selectedCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 max-w-sm w-full relative"
            >
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setSelectedCustomer(null);
                }}
                className="absolute top-4 right-4 p-1 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
              
              <h3 className="text-lg font-bold text-gray-900 mb-2 text-left">{t('Edit Points')}</h3>
              <p className="text-xs text-gray-400 text-left mb-6">
                {t('Adjust points for')}: <strong className="text-gray-800">{selectedCustomer.name}</strong> ({selectedCustomer.phone})
              </p>
              
              <form onSubmit={handleSaveEdit} className="space-y-4">
                 <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-500 block text-left">{t('Loyalty Points')}</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={editPoints}
                    onChange={(e) => setEditPoints(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel text-left font-mono"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditModalOpen(false);
                      setSelectedCustomer(null);
                    }}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-500 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                  >
                    {t('Cancel')}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-mocha-700 hover:bg-mocha-800 text-white rounded-xl font-bold transition-all shadow-md"
                  >
                    {t('Confirm')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
