// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { InventoryItem } from '../global';
import type { MenuItem } from '../types/menu';
import { summarizeInventory, valuateQuantity, valuateStockItem } from './inventoryMath';
import Inventory from '../pages/Inventory';
import Menu from '../pages/Menu';
import App from '../App';
import { inventoryService } from '../services/inventoryService';
import { menuService } from '../services/menuService';
import { useMenuContext } from '../context/DataContext';
import { useOrders } from '../hooks/useOrders';
import { useAnalytics } from '../hooks/useAnalytics';

const auth = vi.hoisted(() => ({ authenticated: false }));
vi.mock('../context/LanguageContext', () => {
  const language = { t: (text: string) => text, isRtl: false, language: 'en' };
  return { useLanguage: () => language, LanguageProvider: ({ children }: { children: ReactNode }) => children };
});
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: auth.authenticated }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../context/DataContext', () => ({
  useMenuContext: vi.fn(),
  DataProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../hooks/useOrders', () => ({ useOrders: vi.fn() }));
vi.mock('../services/inventoryService', () => ({ inventoryService: {
  getAll: vi.fn(), getTransactions: vi.fn(), getMenuRecipes: vi.fn(),
  getMenuItemRecipe: vi.fn(), saveMenuRecipe: vi.fn(), createTransaction: vi.fn(),
  update: vi.fn(), create: vi.fn(), delete: vi.fn(),
} }));
vi.mock('../services/menuService', () => ({ menuService: { getAll: vi.fn() } }));
vi.mock('../pages/Dashboard', () => ({ default: () => null }));
vi.mock('../pages/Orders', () => ({ default: () => 'Orders screen' }));
vi.mock('../pages/Payment', () => ({ default: () => null }));
vi.mock('../pages/Reports', () => ({ default: () => null }));
vi.mock('../pages/Settings', () => ({ default: () => null }));
vi.mock('../pages/Login', () => ({ default: () => 'Login screen' }));
vi.mock('../pages/PublicMenu', () => ({ default: () => 'Public menu screen' }));
vi.mock('../components/layout/DashboardLayout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { DashboardLayout: Outlet };
});

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'stock-1', name: 'Beans', unit: 'kg', stock: 2, minStock: 1,
    costPerUnit: 10, createdAt: '2026-09-01', updatedAt: '2026-09-01', ...overrides,
  };
}

describe('potential stock margin', () => {
  it('retains a loss when estimated sales are below stock cost', () => {
    expect(valuateQuantity(2, 10, 6)).toEqual({
      costValue: 20, potentialSales: 12, potentialProfit: -8,
    });
  });

  it('retains the cost when estimated sales are zero', () => {
    expect(valuateQuantity(2, 10, 0)).toEqual({
      costValue: 20, potentialSales: 0, potentialProfit: -20,
    });
  });

  it('does not invent selling value for an unmapped stock item', () => {
    expect(valuateStockItem(item(), {})).toEqual({
      costValue: 20, potentialSales: 0, potentialProfit: -20,
    });
  });

  it('keeps profitable, break-even and empty quantities unchanged', () => {
    expect(valuateQuantity(2, 10, 15).potentialProfit).toBe(10);
    expect(valuateQuantity(2, 10, 10).potentialProfit).toBe(0);
    expect(valuateQuantity(0, 10, 15)).toEqual({
      costValue: 0, potentialSales: 0, potentialProfit: 0,
    });
  });

  it('offsets positive potential margin with losses in the summary', () => {
    const inventory = [item(), item({ id: 'stock-2', stock: 1 })];
    expect(summarizeInventory(inventory, { 'stock-1': 6, 'stock-2': 15 })).toEqual({
      totalItems: 2, lowStockCount: 1, totalCostValue: 30, totalPotentialProfit: -3,
    });
  });
});

// Keep integration regressions in the existing owned test file during this handoff.
describe('scoped renderer regressions', () => {
  const coffee: MenuItem = {
    id: 'menu-1', name: 'Coffee', description: '', price: 6,
    category: 'Hot Coffee|Bar', image: '', available: true,
  };
  let menu: ReturnType<typeof useMenuContext>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('alert', vi.fn());
    menu = {
      items: [], loading: false, error: null,
      addItem: vi.fn(async () => coffee), updateItem: vi.fn(async () => {}),
      deleteItem: vi.fn(async () => {}), toggleAvailability: vi.fn(async () => {}),
      refetch: vi.fn(async () => {}),
    };
    vi.mocked(useMenuContext).mockImplementation(() => menu);
    vi.mocked(inventoryService.getAll).mockResolvedValue([item()]);
    vi.mocked(inventoryService.getTransactions).mockResolvedValue([]);
    vi.mocked(inventoryService.getMenuRecipes).mockResolvedValue([
      { menuItemId: coffee.id, inventoryItemId: 'stock-1', quantity: 1 },
    ]);
    vi.mocked(inventoryService.getMenuItemRecipe).mockResolvedValue([]);
    vi.mocked(menuService.getAll).mockResolvedValue([coffee]);
    auth.authenticated = false;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([0, 2, 4])('submits absolute counted stock %s, including zero and an unchanged count', async (target) => {
    render(createElement(Inventory));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust Stock' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ADJUST' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: String(target) } });
    expect(screen.getByText(`${target.toFixed(3)} kg`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(inventoryService.createTransaction).toHaveBeenCalledExactlyOnceWith({
      itemId: 'stock-1', type: 'ADJUST', quantity: target, notes: '', referenceId: 'MANUAL',
    }));
    await waitFor(() => expect(screen.queryByText('Adjust Stock Level')).toBeNull());
  });

  it('keeps a rejected movement open and does not refresh it as a success', async () => {
    vi.mocked(inventoryService.createTransaction).mockRejectedValueOnce(new Error('Concurrent overdraw'));
    render(createElement(Inventory));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust Stock' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'OUT' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Failed to adjust stock level'));
    expect(screen.getByText('Adjust Stock Level')).toBeTruthy();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1');
    expect(inventoryService.getAll).toHaveBeenCalledOnce();
  });

  it('does not send disabled stale stock when editing item metadata', async () => {
    render(createElement(Inventory));
    fireEvent.click(await screen.findByTitle('Edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(inventoryService.update).toHaveBeenCalledExactlyOnceWith('stock-1', {
      name: 'Beans', unit: 'kg', minStock: 1, costPerUnit: 10,
    }));
  });

  it.each(['menu', 'recipes'] as const)('shows %s load failures, hides valuations, and recovers on retry', async (source) => {
    const loader = source === 'menu' ? vi.mocked(menuService.getAll) : vi.mocked(inventoryService.getMenuRecipes);
    loader.mockRejectedValueOnce(new Error('Auxiliary data unavailable'));
    render(createElement(Inventory));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load inventory data');
    expect(screen.queryByText('TOTAL EXPECTED PROFIT')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('table');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('TOTAL EXPECTED PROFIT')).toBeTruthy();
  });

  it.each([6, 0])('renders signed stock, summary and incoming margin at selling yield %s', async (price) => {
    vi.mocked(menuService.getAll).mockResolvedValue([{ ...coffee, price }]);
    render(createElement(Inventory));
    await screen.findByRole('table');
    const loss = (2 * (price - 10)).toFixed(2);
    const localizedLoss = (2 * (price - 10)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(screen.getByText('TOTAL EXPECTED PROFIT').parentElement?.textContent).toContain(`EGP ${localizedLoss}`);
    const row = screen.getByText('Beans').closest('tr')!;
    expect(within(row).getAllByRole('cell')[7].textContent).toBe(`EGP ${loss}`);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust Stock' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } });
    expect(screen.getByText('Expected Potential Profit:').parentElement?.textContent).toContain(`EGP ${loss}`);
  });

  it('displays a negative adjustment delta without a plus prefix', async () => {
    vi.mocked(inventoryService.getTransactions).mockResolvedValue([{
      id: 'tx-1', itemId: 'stock-1', itemName: 'Beans', itemUnit: 'kg',
      type: 'ADJUST', quantity: -6, createdAt: '2026-09-01T00:00:00.000Z',
    }]);
    render(createElement(Inventory));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Transaction History' }));
    expect(screen.getByText('-6.00 kg')).toBeTruthy();
    expect(screen.queryByText('+-6.00 kg')).toBeNull();
  });

  async function openNewMenuItem() {
    fireEvent.click(screen.getByRole('button', { name: 'Add New Item' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Item Name'), { target: { value: 'New Coffee' } });
    fireEvent.change(within(dialog).getByLabelText('Price'), { target: { value: '6' } });
    await act(async () => {});
    return dialog;
  }

  it.each(['create', 'update'] as const)('propagates a failed %s without closing or resetting the modal', async (operation) => {
    if (operation === 'update') menu.items = [coffee];
    const view = render(createElement(Menu));
    if (operation === 'create') {
      await openNewMenuItem();
      vi.mocked(menu.addItem).mockImplementationOnce(async () => {
        menu.error = new Error('Create rejected');
        return null;
      });
    } else {
      fireEvent.click(screen.getByTitle('Edit'));
      await act(async () => {});
      fireEvent.change(screen.getByLabelText('Item Name'), { target: { value: 'New Coffee' } });
      vi.mocked(menu.updateItem).mockImplementationOnce(async () => {
        menu.error = new Error('Update rejected');
        throw menu.error;
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    view.rerender(createElement(Menu));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Item Name') as HTMLInputElement).value).toBe('New Coffee');
    expect(inventoryService.saveMenuRecipe).not.toHaveBeenCalled();
    expect(screen.queryByText('Failed to load menu')).toBeNull();
  });

  it('retries a failed recipe save against the created id without losing draft ingredients', async () => {
    vi.mocked(inventoryService.saveMenuRecipe).mockRejectedValueOnce(new Error('Recipe rejected'));
    render(createElement(Menu));
    await openNewMenuItem();
    fireEvent.click(screen.getByRole('button', { name: 'Ingredients & Recipe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Ingredient' }));
    fireEvent.change(screen.getByLabelText('Quantity Used'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('Recipe rejected')));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByLabelText('Quantity Used') as HTMLInputElement).value).toBe('250');
    fireEvent.click(screen.getByRole('button', { name: 'Item Details' }));
    fireEvent.change(screen.getByLabelText('Item Name'), { target: { value: 'Retried Coffee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(menu.addItem).toHaveBeenCalledOnce();
    expect(menu.updateItem).toHaveBeenCalledExactlyOnceWith('menu-1', expect.objectContaining({ name: 'Retried Coffee' }));
    expect(inventoryService.saveMenuRecipe).toHaveBeenNthCalledWith(1, 'menu-1', [{ inventoryItemId: 'stock-1', quantity: 0.25 }]);
    expect(inventoryService.saveMenuRecipe).toHaveBeenNthCalledWith(2, 'menu-1', [{ inventoryItemId: 'stock-1', quantity: 0.25 }]);
    expect(inventoryService.getMenuItemRecipe).not.toHaveBeenCalled();
    await openNewMenuItem();
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(menu.addItem).toHaveBeenCalledTimes(2));
  });

  it('waits for the recipe save, prevents repeat submits, and closes only after success', async () => {
    let finish!: () => void;
    vi.mocked(inventoryService.saveMenuRecipe).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([]); }));
    render(createElement(Menu));
    await openNewMenuItem();
    const save = screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement;
    fireEvent.click(save);
    await waitFor(() => expect(inventoryService.saveMenuRecipe).toHaveBeenCalledOnce());
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(menu.addItem).toHaveBeenCalledOnce();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('allocates a whole paid basket before grouping and selecting the top five', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `line-${index}`, name: `Item ${index}`, price: 0.05, quantity: 1,
    }));
    vi.mocked(useOrders).mockReturnValue({
      orders: [{ id: 'order-1', orderNumber: '1', tableId: '1', status: 'Completed', paymentStatus: 'Paid',
        createdAt: '2026-09-01', items, totalAmount: 0.30, grandTotal: 0.33, paidAmount: 0.10 }],
      loading: false, error: null,
      addOrder: vi.fn(), updateOrderStatus: vi.fn(), completeWithPayment: vi.fn(),
      updateOrder: vi.fn(), deleteOrder: vi.fn(), refetch: vi.fn(),
    });
    const { result } = renderHook(() => useAnalytics('All Time'));
    expect(result.current.totalRevenue).toBe(0.10);
    expect(result.current.topItems.map(row => row.revenue)).toEqual([0.02, 0.02, 0.02, 0.02, 0.01]);
  });

  it.each([
    ['menu.engaz.tech', false, 'Public menu screen'],
    ['MENU.ENGAZ.TECH', true, 'Public menu screen'],
    ['menu.example.test', false, 'Login screen'],
    ['menu.engaz.tech.example.test', false, 'Login screen'],
    ['notmenu.engaz.tech', false, 'Login screen'],
    ['pos.engaz.tech', true, 'Orders screen'],
    ['localhost', false, 'Login screen'],
  ])('routes hostname %s with authentication %s to %s', async (hostname, authenticated, expected) => {
    const dom = (globalThis as unknown as { jsdom: { reconfigure: (options: { url: string }) => void } }).jsdom;
    dom.reconfigure({ url: `https://${hostname}/` });
    auth.authenticated = authenticated;
    render(createElement(App));
    expect(await screen.findByText(expected)).toBeTruthy();
  });
});
