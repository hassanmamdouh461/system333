import { useMenuContext } from '../context/DataContext';

// Data is fetched once at app level and shared through DataContext.
export function useMenu() {
  const menu = useMenuContext();
  return {
    ...menu,
    addItem: async (...args: Parameters<typeof menu.addItem>) => {
      const item = await menu.addItem(...args);
      if (!item) throw new Error('Failed to create menu item');
      return item;
    },
  };
}
