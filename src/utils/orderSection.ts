import { Order, OrderItem, OrderStatus } from '../types/order';

// Item names that route a line to the bar rather than the kitchen. Used as a fallback for
// legacy rows whose category column was never populated.
const DRINKS_KEYWORDS = [
  'coffee', 'iced', 'hot', 'frappe', 'milkshake', 'latte', 'espresso',
  'drink', 'juice', 'tea', 'beverage', 'smoothie', 'soda', 'water',
  'mojito', 'shake', 'brew', 'macchiato', 'cappuccino', 'flat white',
  'americano', 'cortado', 'mocha'
];

/**
 * Filter items of an order by destination section.
 */
export function filterItemsBySection(items: OrderItem[], section: 'all' | 'kitchen' | 'drinks'): OrderItem[] {
  if (section === 'all') return items;
  
  return items.filter(item => {
    const catFull = item.category || '';
    const parts = catFull.split('|');
    const cat = parts[1] ? parts[1].toLowerCase() : parts[0].toLowerCase();
    if (cat === 'bar' || cat === 'drinks') {
      return section === 'drinks';
    }
    if (cat === 'kitchen') {
      return section === 'kitchen';
    }
    
    // Fallback to item name keyword matching for legacy orders
    const nameLower = item.name.toLowerCase();
    const isDrink = DRINKS_KEYWORDS.some(keyword => nameLower.includes(keyword));
    return section === 'drinks' ? isDrink : !isDrink;
  });
}

/**
 * Calculate the status of an order for a specific section based on its items' statuses.
 */
export function getOrderStatusForSection(order: Order, section: 'all' | 'kitchen' | 'drinks'): OrderStatus {
  if (order.status === 'Cancelled') return 'Cancelled';
  if (order.status === 'Completed') return 'Completed';

  if (section === 'all') {
    const items = order.items;
    if (items.length === 0) return order.status;
    const statuses = items.map(item => item.status || order.status || 'New');
    if (statuses.every(s => s === 'Completed')) return 'Completed';
    if (statuses.every(s => s === 'Ready' || s === 'Completed')) return 'Ready';
    if (statuses.includes('Preparing') || statuses.includes('Ready')) return 'Preparing';
    return 'New';
  }

  const items = filterItemsBySection(order.items, section);
  if (items.length === 0) {
    return 'Ready'; // If no items for this section, treat as ready so it doesn't block overall order status.
  }

  const statuses = items.map(item => item.status || order.status || 'New');
  
  if (statuses.every(s => s === 'Completed')) {
    return 'Completed';
  }
  if (statuses.every(s => s === 'Ready' || s === 'Completed')) {
    return 'Ready';
  }
  if (statuses.includes('Preparing') || statuses.includes('Ready')) {
    return 'Preparing';
  }
  return 'New';
}
