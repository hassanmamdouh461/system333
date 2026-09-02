import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Package, History, Plus, Search,
  Scale, AlertTriangle, RefreshCw, TrendingUp, ChefHat
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { inventoryService } from '../services/inventoryService';
import { menuService } from '../services/menuService';
import { InventoryItem, InventoryTransaction, RecipeIngredient } from '../global';
import { MenuItem } from '../types/menu';
import { computeItemYields, summarizeInventory } from '../utils/inventoryMath';
import { costRecipes, groupRecipesByMenuItem, summarizeRecipes, RecipeSummary } from '../utils/recipeMath';
import { reportFailure } from '../utils/reportFailure';
import { StockTable } from '../components/inventory/StockTable';
import { TransactionTable } from '../components/inventory/TransactionTable';
import { RecipeTable } from '../components/inventory/RecipeTable';
import { RecipeEditorModal, RecipeLine } from '../components/inventory/RecipeEditorModal';
import { StockItemModal, StockItemForm } from '../components/inventory/StockItemModal';
import { AdjustStockModal, StockAdjustForm } from '../components/inventory/AdjustStockModal';

type InventoryTab = 'stock' | 'recipes' | 'history';

const EMPTY_ITEM_FORM: StockItemForm = {
  name: '',
  unit: 'kg',
  stock: '0',
  minStock: '1',
  costPerUnit: '0',
};

const EMPTY_ADJUST_FORM: StockAdjustForm = {
  quantity: '',
  type: 'IN',
  notes: '',
};

const SEARCH_PLACEHOLDER: Record<InventoryTab, string> = {
  stock: 'Search stock items...',
  recipes: 'Search products...',
  history: 'Search history logs...',
};

/**
 * What the recipe mapping is costing the business, above the table.
 *
 * Unmapped products are the headline number because a product with no recipe sells without
 * deducting anything, so its ingredients silently disappear from the stock count.
 */
function RecipeInsights({ summary }: { summary: RecipeSummary }) {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      <div className={`bg-white border rounded-2xl p-4 shadow-sm ${summary.unmappedCount > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}>
        <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('Products Without Recipe')}</p>
        <p className={`text-xl md:text-2xl font-bold tabular-nums ${summary.unmappedCount > 0 ? 'text-amber-700' : 'text-green-700'}`}>
          {summary.unmappedCount}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5">{t('Selling these deducts no stock')}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('Products With Recipe')}</p>
        <p className="text-xl md:text-2xl font-bold text-gray-900 tabular-nums">{summary.mappedCount}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{t('Average margin')}: {summary.averageMarginPercent.toFixed(0)}%</p>
      </div>

      <div className={`bg-white border rounded-2xl p-4 shadow-sm ${summary.outOfStockCount > 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
        <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('Cannot Be Made')}</p>
        <p className={`text-xl md:text-2xl font-bold tabular-nums ${summary.outOfStockCount > 0 ? 'text-red-700' : 'text-green-700'}`}>
          {summary.outOfStockCount}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5">{t('An ingredient has run out')}</p>
      </div>

      <div className={`bg-white border rounded-2xl p-4 shadow-sm ${summary.losingMoneyCount > 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
        <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('Sold At A Loss')}</p>
        <p className={`text-xl md:text-2xl font-bold tabular-nums ${summary.losingMoneyCount > 0 ? 'text-red-700' : 'text-green-700'}`}>
          {summary.losingMoneyCount}
        </p>
        <p className="text-[10px] text-gray-400 mt-0.5">{t('Costs more than its price')}</p>
      </div>
    </div>
  );
}

export default function Inventory() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<InventoryTab>('stock');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [recipeMenuItem, setRecipeMenuItem] = useState<MenuItem | null>(null);
  const [itemForm, setItemForm] = useState<StockItemForm>(EMPTY_ITEM_FORM);
  const [adjustForm, setAdjustForm] = useState<StockAdjustForm>(EMPTY_ADJUST_FORM);

  // Monotonic token per fetch: every mutation triggers a refetch, so two saves in quick
  // succession could otherwise finish out of order and leave the older stock levels on
  // screen. Same pattern as DataContext.
  const fetchId = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = ++fetchId.current;
    setLoading(true);
    try {
      const [invData, txData, menuData, recipeData] = await Promise.all([
        inventoryService.getAll(),
        inventoryService.getTransactions(),
        menuService.getAll().catch(() => []),
        inventoryService.getMenuRecipes().catch(() => [])
      ]);
      if (requestId !== fetchId.current) return;
      setInventory(invData);
      setTransactions(txData);
      setMenuItems(menuData);
      setRecipes(recipeData);
    } catch (error) {
      if (requestId !== fetchId.current) return;
      console.error('[Inventory] Failed to load inventory data:', error);
    } finally {
      if (requestId === fetchId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const itemYields = useMemo(
    () => computeItemYields(inventory, recipes, menuItems),
    [inventory, recipes, menuItems]
  );

  const summary = useMemo(
    () => summarizeInventory(inventory, itemYields),
    [inventory, itemYields]
  );

  const filteredStock = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return inventory.filter(item =>
      item.name.toLowerCase().includes(query) || t(item.name).toLowerCase().includes(query)
    );
  }, [inventory, searchQuery, t]);

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return transactions.filter(tx => {
      const itemName = tx.itemName || '';
      return itemName.toLowerCase().includes(query) ||
        t(itemName).toLowerCase().includes(query) ||
        (tx.referenceId?.toLowerCase().includes(query) ?? false) ||
        (tx.notes?.toLowerCase().includes(query) ?? false);
    });
  }, [transactions, searchQuery, t]);

  const recipeCostings = useMemo(
    () => costRecipes(menuItems, recipes, inventory),
    [menuItems, recipes, inventory]
  );

  const recipeSummary = useMemo(() => summarizeRecipes(recipeCostings), [recipeCostings]);

  const filteredRecipes = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return recipeCostings.filter(costing =>
      costing.menuItemName.toLowerCase().includes(query) ||
      t(costing.menuItemName).toLowerCase().includes(query)
    );
  }, [recipeCostings, searchQuery, t]);

  /** Saved lines for the product whose recipe is open, in the editor's own shape. */
  const editingRecipeLines = useMemo<RecipeLine[]>(() => {
    if (!recipeMenuItem) return [];
    const lines = groupRecipesByMenuItem(recipes).get(recipeMenuItem.id) ?? [];
    return lines.map(line => ({
      inventoryItemId: line.inventoryItemId,
      quantity: line.quantity,
    }));
  }, [recipeMenuItem, recipes]);

  const handleOpenItemModal = (item?: InventoryItem) => {
    if (item) {
      setSelectedItem(item);
      setItemForm({
        name: item.name,
        unit: item.unit,
        stock: item.stock.toString(),
        minStock: item.minStock.toString(),
        costPerUnit: item.costPerUnit.toString()
      });
    } else {
      setSelectedItem(null);
      setItemForm(EMPTY_ITEM_FORM);
    }
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        name: itemForm.name,
        unit: itemForm.unit,
        stock: parseFloat(itemForm.stock),
        minStock: parseFloat(itemForm.minStock),
        costPerUnit: parseFloat(itemForm.costPerUnit)
      };

      if (selectedItem) {
        // Stock moves only through logged adjustments, so an edit never rewrites the
        // balance — that is what keeps the ledger and the level in agreement.
        const { stock: _ignored, ...editable } = data;
        await inventoryService.update(selectedItem.id, editable);
      } else {
        await inventoryService.create(data);
      }
      setIsItemModalOpen(false);
      fetchData();
    } catch (error) {
      reportFailure(t('Failed to save stock item'), error);
    }
  };

  const handleOpenAdjustModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setAdjustForm(EMPTY_ADJUST_FORM);
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    const quantity = parseFloat(adjustForm.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      alert(t('Please enter a valid quantity greater than 0'));
      return;
    }

    try {
      await inventoryService.createTransaction({
        itemId: selectedItem.id,
        type: adjustForm.type,
        quantity,
        notes: adjustForm.notes,
        referenceId: 'MANUAL'
      });
      setIsAdjustModalOpen(false);
      fetchData();
    } catch (error) {
      reportFailure(t('Failed to adjust stock level'), error);
    }
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm(t('Are you sure you want to delete this item? This will also remove its history and recipes mapping.'))) {
      return;
    }
    try {
      await inventoryService.delete(id);
      fetchData();
    } catch (error) {
      reportFailure(t('Failed to delete item'), error);
    }
  };

  const handleOpenRecipeEditor = (menuItemId: string) => {
    const menuItem = menuItems.find(item => item.id === menuItemId);
    if (menuItem) setRecipeMenuItem(menuItem);
  };

  const handleSaveRecipe = async (lines: RecipeLine[]) => {
    if (!recipeMenuItem) return;
    try {
      await inventoryService.saveMenuRecipe(recipeMenuItem.id, lines);
      setRecipeMenuItem(null);
      fetchData();
    } catch (error) {
      reportFailure(t('Failed to save item recipe'), error);
    }
  };

  const money = (value: number) =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4 md:space-y-6 text-gray-900">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-2xl font-bold text-gray-900">{t('Inventory Management')}</h1>
          <p className="text-xs md:text-sm text-gray-500">{t('Manage raw materials, stock levels, and recipes.')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 bg-white active:scale-95 transition-all shadow-sm"
            aria-label={t('Refresh')}
            title={t('Refresh')}
          >
            <RefreshCw size={18} aria-hidden="true" className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => handleOpenItemModal()}
            className="bg-mocha-700 hover:bg-mocha-800 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center justify-center gap-2 shadow-lg shadow-mocha-500/20 transition-all active:scale-95 text-sm"
          >
            <Plus size={16} aria-hidden="true" />
            {t('Add Stock Item')}
          </button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-amber-50 text-amber-700 p-3 rounded-xl shrink-0">
            <Package size={22} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('TOTAL ITEMS')}</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900 tabular-nums">{summary.totalItems}</p>
          </div>
        </div>

        <div className={`bg-white border rounded-2xl p-5 shadow-sm flex items-center gap-4 ${summary.lowStockCount > 0 ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}>
          <div className={`p-3 rounded-xl shrink-0 ${summary.lowStockCount > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            <AlertTriangle size={22} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('LOW STOCK WARNINGS')}</p>
            <p className={`text-xl md:text-2xl font-bold tabular-nums ${summary.lowStockCount > 0 ? 'text-red-700' : 'text-green-700'}`}>
              {summary.lowStockCount}
            </p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-blue-50 text-blue-700 p-3 rounded-xl shrink-0">
            <Scale size={22} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('TOTAL VALUE (EST)')}</p>
            <p className="text-xl md:text-2xl font-bold text-gray-900 tabular-nums">EGP {money(summary.totalCostValue)}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-4">
          <div className="bg-emerald-50 text-emerald-700 p-3 rounded-xl shrink-0">
            <TrendingUp size={22} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">{t('TOTAL EXPECTED PROFIT')}</p>
            <p className="text-xl md:text-2xl font-bold text-emerald-700 tabular-nums">EGP {money(summary.totalPotentialProfit)}</p>
          </div>
        </div>
      </div>

      {/* ── Tabs and search ────────────────────────────────────────────────── */}
      <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex gap-1.5 bg-gray-100 p-1 rounded-xl w-fit" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'stock'}
            onClick={() => setActiveTab('stock')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'stock' ? 'bg-white text-mocha-800 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Package size={14} aria-hidden="true" />
            {t('Stock Levels')}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'recipes'}
            onClick={() => setActiveTab('recipes')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'recipes' ? 'bg-white text-mocha-800 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <ChefHat size={14} aria-hidden="true" />
            {t('Recipes')}
            {recipeSummary.unmappedCount > 0 && (
              <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums">
                {recipeSummary.unmappedCount}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 ${
              activeTab === 'history' ? 'bg-white text-mocha-800 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <History size={14} aria-hidden="true" />
            {t('Transaction History')}
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <label htmlFor="inventory-search" className="sr-only">
            {t(SEARCH_PLACEHOLDER[activeTab])}
          </label>
          <Search
            className={"absolute top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none right-3"}
            aria-hidden="true"
          />
          <input
            id="inventory-search"
            type="search"
            placeholder={t(SEARCH_PLACEHOLDER[activeTab])}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={"w-full py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-caramel focus:border-transparent text-sm pr-9 pl-4"}
          />
        </div>
      </div>

      {activeTab === 'recipes' && !loading && (
        <RecipeInsights summary={recipeSummary} />
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-gray-200" role="status">
          <RefreshCw className="animate-spin text-mocha-600 mb-2 w-8 h-8" aria-hidden="true" />
          <span className="text-sm text-gray-500">{t('Loading inventory...')}</span>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {activeTab === 'stock' && (
            <StockTable
              items={filteredStock}
              itemYields={itemYields}
              onAdjust={handleOpenAdjustModal}
              onEdit={handleOpenItemModal}
              onDelete={handleDeleteItem}
            />
          )}
          {activeTab === 'recipes' && (
            <RecipeTable costings={filteredRecipes} onEdit={handleOpenRecipeEditor} />
          )}
          {activeTab === 'history' && (
            <TransactionTable transactions={filteredTransactions} />
          )}
        </div>
      )}

      <AnimatePresence>
        {isItemModalOpen && (
          <StockItemModal
            item={selectedItem}
            form={itemForm}
            onChange={setItemForm}
            onSubmit={handleSaveItem}
            onClose={() => setIsItemModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAdjustModalOpen && selectedItem && (
          <AdjustStockModal
            item={selectedItem}
            form={adjustForm}
            averageYield={itemYields[selectedItem.id] || 0}
            onChange={setAdjustForm}
            onSubmit={handleSaveAdjustment}
            onClose={() => setIsAdjustModalOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {recipeMenuItem && (
          <RecipeEditorModal
            menuItem={recipeMenuItem}
            inventory={inventory}
            initialLines={editingRecipeLines}
            onSave={handleSaveRecipe}
            onClose={() => setRecipeMenuItem(null)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
