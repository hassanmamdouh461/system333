import React, { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { MenuItem } from '../types/menu';
import { MenuItemCard } from '../components/menu/MenuItemCard';
import { MenuModal } from '../components/menu/MenuModal';
import { motion, AnimatePresence } from 'framer-motion';
import { useMenu } from '../hooks/useMenu';
import { useLanguage } from '../context/LanguageContext';
import { reportFailure } from '../utils/reportFailure';
import { RecipeIngredient } from '../global';

export default function Menu() {
  const { t, isRtl } = useLanguage();
  // Use local SQLite database for data persistence
  const { items, error, addItem, updateItem, deleteItem, toggleAvailability } = useMenu();
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  // Menu categories: Only categories that actually contain at least 1 item
  const dynamicCategories = React.useMemo(() => {
    const catCounts = new Map<string, number>();

    items.forEach(item => {
      if (!item.category) return;
      const parts = item.category.split('|');
      const menuCat = parts[0]?.trim();
      if (menuCat && menuCat !== 'All' && menuCat !== 'Kitchen' && menuCat !== 'Bar') {
        catCounts.set(menuCat, (catCounts.get(menuCat) || 0) + 1);
      }
    });

    const activeCats = Array.from(catCounts.entries())
      .filter(([_, count]) => count > 0)
      .map(([cat]) => cat);

    if (activeCats.length === 0) {
      return ['All'];
    }

    return ['All', ...activeCats];
  }, [items]);

  React.useEffect(() => {
    if (selectedCategory !== 'All' && !dynamicCategories.includes(selectedCategory)) {
      setSelectedCategory('All');
    }
  }, [dynamicCategories, selectedCategory]);

  const filteredItems = items.filter(item => {
    const parts = item.category ? item.category.split('|') : [];
    const menuCat = parts[0]?.trim() || '';
    const matchesCategory = selectedCategory === 'All' || menuCat === selectedCategory;
    
    const nameTranslated = t(item.name).toLowerCase();
    const descTranslated = t(item.description || '').toLowerCase();
    const nameOriginal = item.name.toLowerCase();
    const descOriginal = (item.description || '').toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    
    const matchesSearch = nameOriginal.includes(query) || 
                          descOriginal.includes(query) ||
                          nameTranslated.includes(query) ||
                          descTranslated.includes(query);
                          
    return matchesCategory && matchesSearch;
  });

  const handleToggleStatus = async (id: string) => {
    try {
      await toggleAvailability(id);
    } catch (error) {
      console.error('Failed to toggle status:', error);
      reportFailure(t('Failed to update item availability'), error);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm(t('Are you sure you want to delete this item?'))) {
      try {
        await deleteItem(id);
      } catch (error) {
        console.error('Failed to delete item:', error);
        reportFailure(t('Failed to delete item'), error);
      }
    }
  };

  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleSave = async (itemData: MenuItem | Omit<MenuItem, 'id'>, recipeIngredients: RecipeIngredient[]) => {
    try {
      let savedItemId = '';
      if ('id' in itemData) {
        // Edit existing
        const { id, ...data } = itemData;
        await updateItem(id, data);
        savedItemId = id;
      } else {
        // Add new
        const newItem = await addItem(itemData);
        if (newItem) {
          savedItemId = newItem.id;
        }
      }
      
      if (savedItemId && recipeIngredients) {
        const { inventoryService } = await import('../services/inventoryService');
        await inventoryService.saveMenuRecipe(savedItemId, recipeIngredients);
      }
      
      setIsModalOpen(false);
    } catch (error) {
      console.error('Failed to save item:', error);
      reportFailure(t('Failed to save item'), error);
    }
  };

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-2">{t('Failed to load menu')}</p>
          <p className="text-gray-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Menu Management')}</h1>
          <p className="text-xs md:text-sm text-gray-500">{t('Manage your coffee beverages and availability.')}</p>
        </div>
        <button 
          onClick={handleAddNew}
          className="bg-mocha-700 hover:bg-mocha-800 text-white px-6 md:px-8 py-3.5 md:py-4 rounded-xl font-bold flex items-center justify-center gap-2.5 shadow-lg shadow-mocha-500/30 transition-all active:scale-95 w-full sm:w-auto text-base md:text-lg"
        >
          <Plus size={20} />
          {t('Add New Item')}
        </button>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-2.5 md:p-3.5 rounded-2xl shadow-sm border border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sticky top-0 z-10 backdrop-blur-xl bg-white/95">
        {/* Categories - Only show when more than 1 category exists */}
        <div className="flex items-center gap-1.5 md:gap-2 overflow-x-auto hide-scrollbar pb-0.5">
          {dynamicCategories.length > 1 && dynamicCategories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-xl text-xs md:text-sm font-bold whitespace-nowrap transition-all border ${
                selectedCategory === category
                  ? 'bg-mocha-600 text-white border-mocha-700 shadow-sm'
                  : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
              }`}
            >
              {t(category) || category}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className={`absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 ${isRtl ? 'right-3' : 'left-3'}`} />
          <input
            aria-label={t('Search items...')}
            type="text"
            placeholder={t('Search items...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-mocha-500 focus:border-transparent text-sm font-semibold ${isRtl ? 'pr-9 pl-4' : 'pl-9 pr-4'}`}
          />
        </div>
      </div>

      {/* Menu Grid — responsive layout filling horizontal space */}
      <motion.div 
        layout
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 md:gap-5"
      >
        <AnimatePresence>
          {filteredItems.map(item => (
            <MenuItemCard
              key={item.id}
              item={item}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleStatus={handleToggleStatus}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      {filteredItems.length === 0 && (
        <div className="text-center py-10 text-gray-500">
          <div className="bg-gray-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
            <Search className="w-7 h-7 text-gray-400" />
          </div>
          <p className="text-sm font-medium">{t('No items found')}</p>
          <p className="text-xs text-gray-400">{t('Try adjusting your search or filters.')}</p>
        </div>
      )}

      {/* Modal */}
      <MenuModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        initialData={editingItem}
        existingItems={items}
      />
    </div>
  );
}
