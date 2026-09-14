/**
 * Input validation for the IPC boundary.
 *
 * Everything the renderer sends arrives here as untrusted data. It came from a form, from
 * `localStorage`, or from a caller that had a bug — and it goes straight into a bind
 * parameter. Without a check at this edge, a NaN price is stored as a number that turns
 * every later SUM into NaN, a negative quantity silently credits stock, and an unbounded
 * string grows the database without limit.
 *
 * Each validator throws a message naming the field, so a rejected write says what was wrong
 * rather than failing later as a constraint error or, worse, succeeding with bad data.
 */

/** Longest free-text value accepted, so one caller cannot bloat a row without limit. */
const MAX_TEXT_LENGTH = 500;
/** Longest name-like value: item names, customer names, table labels. */
const MAX_NAME_LENGTH = 120;
/** Most line items one order may carry. */
const MAX_ORDER_ITEMS = 200;
/** Upper bound on any single monetary figure, to catch a misplaced decimal point. */
const MAX_MONEY = 1_000_000;
/** Upper bound on a stock quantity or line quantity. */
const MAX_QUANTITY = 100_000;

/**
 * Longest branch id this layer accepts.
 *
 * This MUST stay equal to BRANCH_ID_MAX in cloudflare/d1-proxy-worker.js. A local limit
 * above the worker's meant a longer id was stored happily and then refused by every sync
 * batch: the row failed five times, was parked at MAX_SYNC_ATTEMPTS, and dropped out of
 * every subsequent push while still looking present on the till.
 */
const BRANCH_ID_MAX = 40;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    // Marks the error as caused by the caller, so a handler can answer 400 rather than 500.
    this.isValidation = true;
  }
}

function fail(message) {
  throw new ValidationError(message);
}

/** A non-empty string within a length bound. */
function requireString(value, field, { max = MAX_NAME_LENGTH } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${field} must be a non-empty string`);
  }
  if (value.length > max) {
    fail(`${field} must be at most ${max} characters`);
  }
  return value.trim();
}

/** A string, or null when absent. Empty and whitespace-only both become null. */
function optionalString(value, field, { max = MAX_NAME_LENGTH } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail(`${field} must be a string`);
  if (value.length > max) fail(`${field} must be at most ${max} characters`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A finite number within range.
 *
 * Absence is rejected rather than coerced. `Number(null)` and `Number('')` are both 0, so an
 * unchecked coercion turned a missing price into a real zero — a free item that looked like
 * a deliberate one — and `Number('abc')` is NaN, which poisons every later sum.
 */
function requireNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === '') {
    fail(`${field} is required`);
  }
  if (typeof value === 'boolean') fail(`${field} must be a number`);

  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${field} must be a finite number`);
  if (n < min) fail(`${field} must be at least ${min}`);
  if (n > max) fail(`${field} must be at most ${max}`);
  return n;
}

/** A finite number within range, or null when absent. */
function optionalNumber(value, field, options = {}) {
  if (value === null || value === undefined || value === '') return null;
  return requireNumber(value, field, options);
}

function requireMoney(value, field) {
  return requireNumber(value, field, { min: 0, max: MAX_MONEY });
}

function optionalMoney(value, field) {
  return optionalNumber(value, field, { min: 0, max: MAX_MONEY });
}

/** One of a fixed set of values. */
function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function optionalEnum(value, field, allowed) {
  if (value === null || value === undefined || value === '') return null;
  return requireEnum(value, field, allowed);
}

/**
 * An identifier: non-empty, bounded, printable.
 *
 * Control characters are rejected because an id carrying a newline or a NUL reads as a
 * different value in a log line than it does in the database.
 */
function requireId(value, field) {
  const id = requireString(value, field, { max: 100 });
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) fail(`${field} contains control characters`);
  }
  return id;
}

/**
 * A phone number: digits only, at a plausible length.
 *
 * Loyalty lookups key on this, so a number stored with stray spaces or dashes silently
 * creates a second customer record for the same person.
 */
function requirePhone(value, field = 'phone') {
  const raw = requireString(value, field, { max: 20 });
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    fail(`${field} must contain between 7 and 15 digits`);
  }
  return digits;
}

function optionalPhone(value, field = 'phone') {
  if (value === null || value === undefined || value === '') return null;
  return requirePhone(value, field);
}

// ─── Domain shapes ───────────────────────────────────────────────────────────

const ORDER_STATUSES = ['New', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
const PAYMENT_STATUSES = ['Paid', 'Unpaid'];
const PAYMENT_METHODS = ['Cash', 'Card'];
const STOCK_MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUST'];

/**
 * One line of an order.
 *
 * A zero or negative quantity is rejected rather than clamped: it means the caller has a
 * bug, and storing the line would deduct stock in the wrong direction.
 */
function validateOrderItem(item, index) {
  if (!item || typeof item !== 'object') fail(`items[${index}] must be an object`);
  const label = `items[${index}]`;

  return {
    id: requireId(item.id, `${label}.id`),
    name: requireString(item.name, `${label}.name`),
    price: requireMoney(item.price, `${label}.price`),
    quantity: requireNumber(item.quantity, `${label}.quantity`, { min: 0.001, max: MAX_QUANTITY }),
    category: optionalString(item.category, `${label}.category`),
    menuItemId: optionalString(item.menuItemId, `${label}.menuItemId`),
    status: optionalEnum(item.status, `${label}.status`, ORDER_STATUSES),
    notes: optionalString(item.notes, `${label}.notes`, { max: MAX_TEXT_LENGTH }),
  };
}

function validateOrderItems(items, field = 'items') {
  if (!Array.isArray(items)) fail(`${field} must be an array`);
  if (items.length === 0) fail(`${field} must contain at least one item`);
  if (items.length > MAX_ORDER_ITEMS) fail(`${field} must contain at most ${MAX_ORDER_ITEMS} items`);
  return items.map(validateOrderItem);
}

/**
 * An order as submitted for creation.
 *
 * Returns a normalised copy: every field is the right type, in range, and trimmed. Callers
 * use the return value rather than the input so nothing unvalidated reaches SQL.
 */
function validateNewOrder(order) {
  if (!order || typeof order !== 'object') fail('order must be an object');

  const paymentStatus = order.paymentStatus == null
    ? 'Unpaid'
    : requireEnum(order.paymentStatus, 'paymentStatus', PAYMENT_STATUSES);

  const validated = {
    id: order.id == null ? null : requireId(order.id, 'id'),
    orderNumber: optionalString(order.orderNumber, 'orderNumber', { max: 40 }),
    tableId: requireString(order.tableId, 'tableId'),
    items: validateOrderItems(order.items),
    status: order.status == null ? 'New' : requireEnum(order.status, 'status', ORDER_STATUSES),
    paymentStatus,
    paymentMethod: optionalEnum(order.paymentMethod, 'paymentMethod', PAYMENT_METHODS),
    totalAmount: requireMoney(order.totalAmount, 'totalAmount'),
    subtotal: optionalMoney(order.subtotal, 'subtotal'),
    // A tax rate is a fraction, not a percentage; 1.0 would be a 100% tax.
    taxRate: optionalNumber(order.taxRate, 'taxRate', { min: 0, max: 1 }),
    taxAmount: optionalMoney(order.taxAmount, 'taxAmount'),
    grandTotal: optionalMoney(order.grandTotal, 'grandTotal'),
    paidAmount: optionalMoney(order.paidAmount, 'paidAmount'),
    createdAt: optionalString(order.createdAt, 'createdAt', { max: 40 }),
    paidAt: optionalString(order.paidAt, 'paidAt', { max: 40 }),
    customerPhone: optionalPhone(order.customerPhone, 'customerPhone'),
    customerName: optionalString(order.customerName, 'customerName'),
    pointsEarned: optionalNumber(order.pointsEarned, 'pointsEarned', { min: 0, max: MAX_MONEY }) ?? 0,
    pointsRedeemed: optionalNumber(order.pointsRedeemed, 'pointsRedeemed', { min: 0, max: MAX_MONEY }) ?? 0,
    branchId: optionalString(order.branchId ?? order.branch_id, 'branchId', { max: BRANCH_ID_MAX }),
    cashierName: optionalString(order.cashierName, 'cashierName', { max: 60 }),
    cashierAvatar: optionalString(order.cashierAvatar, 'cashierAvatar', { max: 400000 }),
  };

  // A paid order must record how it was paid, otherwise the payment-method breakdown
  // silently attributes it to cash.
  if (validated.paymentStatus === 'Paid' && !validated.paymentMethod) {
    fail('paymentMethod is required when paymentStatus is Paid');
  }

  // Points can only be redeemed against a known customer.
  if (validated.pointsRedeemed > 0 && !validated.customerPhone) {
    fail('customerPhone is required when redeeming points');
  }

  return validated;
}

/** Fields accepted on an order update. Only the keys present are returned. */
function validateOrderUpdate(data) {
  if (!data || typeof data !== 'object') fail('update payload must be an object');
  const out = {};

  if ('orderNumber' in data) out.orderNumber = optionalString(data.orderNumber, 'orderNumber', { max: 40 });
  if ('tableId' in data) out.tableId = requireString(data.tableId, 'tableId');
  if ('items' in data) out.items = validateOrderItems(data.items);
  if ('status' in data) out.status = requireEnum(data.status, 'status', ORDER_STATUSES);
  if ('paymentStatus' in data) out.paymentStatus = requireEnum(data.paymentStatus, 'paymentStatus', PAYMENT_STATUSES);
  if ('paymentMethod' in data) out.paymentMethod = optionalEnum(data.paymentMethod, 'paymentMethod', PAYMENT_METHODS);
  if ('totalAmount' in data) out.totalAmount = requireMoney(data.totalAmount, 'totalAmount');
  if ('subtotal' in data) out.subtotal = optionalMoney(data.subtotal, 'subtotal');
  if ('taxRate' in data) out.taxRate = optionalNumber(data.taxRate, 'taxRate', { min: 0, max: 1 });
  if ('taxAmount' in data) out.taxAmount = optionalMoney(data.taxAmount, 'taxAmount');
  if ('grandTotal' in data) out.grandTotal = optionalMoney(data.grandTotal, 'grandTotal');
  if ('paidAmount' in data) out.paidAmount = optionalMoney(data.paidAmount, 'paidAmount');
  if ('createdAt' in data) out.createdAt = optionalString(data.createdAt, 'createdAt', { max: 40 });
  if ('paidAt' in data) out.paidAt = optionalString(data.paidAt, 'paidAt', { max: 40 });
  if ('customerPhone' in data) out.customerPhone = optionalPhone(data.customerPhone, 'customerPhone');
  if ('pointsEarned' in data) out.pointsEarned = optionalNumber(data.pointsEarned, 'pointsEarned', { min: 0, max: MAX_MONEY });
  if ('pointsRedeemed' in data) out.pointsRedeemed = optionalNumber(data.pointsRedeemed, 'pointsRedeemed', { min: 0, max: MAX_MONEY });
  if ('branchId' in data) out.branchId = optionalString(data.branchId, 'branchId', { max: BRANCH_ID_MAX });
  if ('cashierName' in data) out.cashierName = optionalString(data.cashierName, 'cashierName', { max: 60 });

  if (Object.keys(out).length === 0) fail('update payload contains no known fields');
  return out;
}

/**
 * A menu item as submitted for creation or a reset.
 *
 * The id is preserved when present. The seed catalogue ships stable ids and the recipe table
 * is keyed by them, so dropping the id here made a menu reset mint fresh ids and orphan
 * every ingredient mapping — the stock deduction then silently found no recipe and consumed
 * nothing.
 */
function validateMenuItem(item) {
  if (!item || typeof item !== 'object') fail('menu item must be an object');
  return {
    ...(item.id == null ? {} : { id: requireId(item.id, 'id') }),
    name: requireString(item.name, 'name'),
    description: optionalString(item.description, 'description', { max: MAX_TEXT_LENGTH }) ?? '',
    price: requireMoney(item.price, 'price'),
    category: requireString(item.category, 'category'),
    image: optionalString(item.image, 'image', { max: MAX_TEXT_LENGTH }) ?? '',
    available: item.available === undefined ? true : Boolean(item.available),
    branchId: optionalString(item.branchId, 'branchId', { max: BRANCH_ID_MAX }),
  };
}

/** Fields accepted on a menu item update. */
function validateMenuItemUpdate(data) {
  if (!data || typeof data !== 'object') fail('update payload must be an object');
  const out = {};
  if ('name' in data) out.name = requireString(data.name, 'name');
  if ('description' in data) out.description = optionalString(data.description, 'description', { max: MAX_TEXT_LENGTH }) ?? '';
  if ('price' in data) out.price = requireMoney(data.price, 'price');
  if ('category' in data) out.category = requireString(data.category, 'category');
  if ('image' in data) out.image = optionalString(data.image, 'image', { max: MAX_TEXT_LENGTH }) ?? '';
  if ('available' in data) out.available = Boolean(data.available);
  if ('branchId' in data) out.branchId = optionalString(data.branchId, 'branchId', { max: BRANCH_ID_MAX });
  if (Object.keys(out).length === 0) fail('update payload contains no known fields');
  return out;
}

function validateInventoryItem(item) {
  if (!item || typeof item !== 'object') fail('inventory item must be an object');
  return {
    name: requireString(item.name, 'name'),
    unit: requireString(item.unit, 'unit', { max: 30 }),
    stock: requireNumber(item.stock, 'stock', { min: 0, max: MAX_QUANTITY }),
    minStock: requireNumber(item.minStock, 'minStock', { min: 0, max: MAX_QUANTITY }),
    costPerUnit: requireMoney(item.costPerUnit, 'costPerUnit'),
    branchId: optionalString(item.branchId, 'branchId', { max: BRANCH_ID_MAX }),
  };
}

/** Fields accepted on an inventory item update. */
function validateInventoryItemUpdate(data) {
  if (!data || typeof data !== 'object') fail('update payload must be an object');
  const out = {};
  if ('name' in data) out.name = requireString(data.name, 'name');
  if ('unit' in data) out.unit = requireString(data.unit, 'unit', { max: 30 });
  if ('stock' in data) out.stock = requireNumber(data.stock, 'stock', { min: 0, max: MAX_QUANTITY });
  if ('minStock' in data) out.minStock = requireNumber(data.minStock, 'minStock', { min: 0, max: MAX_QUANTITY });
  if ('costPerUnit' in data) out.costPerUnit = requireMoney(data.costPerUnit, 'costPerUnit');
  if ('branchId' in data) out.branchId = optionalString(data.branchId, 'branchId', { max: BRANCH_ID_MAX });
  if (Object.keys(out).length === 0) fail('update payload contains no known fields');
  return out;
}

/**
 * A stock movement.
 *
 * The quantity is always positive; the direction comes from the type. Allowing a signed
 * quantity meant an "IN" of -5 quietly removed stock while reading as a delivery in the log.
 */
function validateStockMovement(tx) {
  if (!tx || typeof tx !== 'object') fail('transaction must be an object');
  return {
    itemId: requireId(tx.itemId, 'itemId'),
    type: requireEnum(tx.type, 'type', STOCK_MOVEMENT_TYPES),
    quantity: requireNumber(tx.quantity, 'quantity', { min: 0.001, max: MAX_QUANTITY }),
    referenceId: optionalString(tx.referenceId, 'referenceId', { max: 100 }),
    notes: optionalString(tx.notes, 'notes', { max: MAX_TEXT_LENGTH }),
    branchId: optionalString(tx.branchId ?? tx.branch_id, 'branchId', { max: BRANCH_ID_MAX }),
  };
}

function validateCustomer(customer) {
  if (!customer || typeof customer !== 'object') fail('customer must be an object');
  return {
    phone: requirePhone(customer.phone),
    name: optionalString(customer.name, 'name'),
    // Points are a whole-unit balance; a fractional point cannot be redeemed.
    points: optionalNumber(customer.points, 'points', { min: 0, max: MAX_MONEY }),
    branchId: optionalString(customer.branchId ?? customer.branch_id, 'branchId', { max: BRANCH_ID_MAX }),
  };
}

/** One ingredient line of a recipe. */
function validateRecipeIngredient(ingredient, index) {
  if (!ingredient || typeof ingredient !== 'object') fail(`ingredients[${index}] must be an object`);
  return {
    inventoryItemId: requireId(ingredient.inventoryItemId, `ingredients[${index}].inventoryItemId`),
    quantity: requireNumber(ingredient.quantity, `ingredients[${index}].quantity`, { min: 0.000001, max: MAX_QUANTITY }),
  };
}

function validateRecipe(ingredients) {
  if (!Array.isArray(ingredients)) fail('ingredients must be an array');
  if (ingredients.length > MAX_ORDER_ITEMS) fail(`ingredients must contain at most ${MAX_ORDER_ITEMS} entries`);
  return ingredients.map(validateRecipeIngredient);
}

/** A settings value: a bounded string, since the column is TEXT. */
function validateSettingValue(value, field = 'value') {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  // Settings hold JSON blobs such as the Telegram config, so the cap is generous but present.
  if (value.length > 10_000) fail(`${field} must be at most 10000 characters`);
  return value;
}

// ─── Public menu configuration ───────────────────────────────────────────────

/** Themes, layouts and sort orders the public page has styles and code for. */
const MENU_THEMES = ['dark', 'amber', 'emerald', 'burgundy', 'navy'];
const MENU_LAYOUTS = ['grid', 'list'];
const MENU_SORT_ORDERS = ['category', 'price-asc', 'price-desc', 'name'];
/**
 * The whole record is published on every save and returned on every menu view, so it is
 * capped as one object. The images dominate: two compressed data URLs at roughly 300 KB.
 */
const MAX_MENU_CONFIG_BYTES = 900_000;
const MAX_MENU_CATEGORIES = 60;
const MAX_MENU_ITEM_IDS = 500;

function menuText(value, field, max) {
  const text = optionalString(value, field, { max }) ?? '';
  return text;
}

function menuFlag(value, field) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`);
  return value;
}

/**
 * An image reference the public page can place in `src` and in a CSS `url()`.
 *
 * The renderer already filters these, but the renderer is exactly what this boundary does
 * not trust: a quote or a closing paren here ends the CSS value and starts a new
 * declaration on every customer's screen.
 */
function validateMenuImage(value, field) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const raw = value.trim();
  if (raw === '') return '';
  if (raw.length > MAX_MENU_CONFIG_BYTES) fail(`${field} is too large`);
  if (/["'()\\\s]/.test(raw)) fail(`${field} contains characters that are not allowed in a URL`);
  if (/^https?:\/\/\S+$/i.test(raw)) return raw;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=]+$/i.test(raw)) return raw;
  fail(`${field} must be an http(s) URL or an inline image`);
}

function validateMenuCategories(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('categories must be an array');
  if (value.length > MAX_MENU_CATEGORIES) {
    fail(`categories must contain at most ${MAX_MENU_CATEGORIES} entries`);
  }

  const seen = new Set();
  const rules = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') fail(`categories[${index}] must be an object`);
    const id = requireString(entry.id, `categories[${index}].id`, { max: 80 });
    if (seen.has(id)) return;
    seen.add(id);
    rules.push({
      id,
      label: menuText(entry.label, `categories[${index}].label`, 60),
      hidden: entry.hidden === undefined || entry.hidden === null
        ? false
        : (typeof entry.hidden === 'boolean' ? entry.hidden : fail(`categories[${index}].hidden must be a boolean`)),
    });
  });
  return rules;
}

function validateMenuItemIds(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (value.length > MAX_MENU_ITEM_IDS) {
    fail(`${field} must contain at most ${MAX_MENU_ITEM_IDS} entries`);
  }
  const seen = new Set();
  value.forEach((id, index) => seen.add(requireId(id, `${field}[${index}]`)));
  return Array.from(seen);
}

/**
 * The public menu configuration as submitted for publishing.
 *
 * Everything here is shown to customers on a page that carries no credential, so this is the
 * last place anything can be checked. Returns a normalised copy: unknown keys are dropped
 * rather than forwarded, so a field the worker never asked for cannot ride along.
 */
function validateMenuConfig(config) {
  if (!config || typeof config !== 'object') fail('config must be an object');

  const contact = config.contact && typeof config.contact === 'object' ? config.contact : {};
  const validated = {
    storeName: menuText(config.storeName, 'storeName', 60),
    subtitle: menuText(config.subtitle, 'subtitle', 140),
    logoUrl: validateMenuImage(config.logoUrl, 'logoUrl'),
    bannerUrl: validateMenuImage(config.bannerUrl, 'bannerUrl'),
    theme: config.theme == null ? 'dark' : requireEnum(config.theme, 'theme', MENU_THEMES),
    footerText: menuText(config.footerText, 'footerText', 160),
    currency: menuText(config.currency, 'currency', 8),
    layout: config.layout == null ? 'grid' : requireEnum(config.layout, 'layout', MENU_LAYOUTS),
    sortOrder: config.sortOrder == null
      ? 'category'
      : requireEnum(config.sortOrder, 'sortOrder', MENU_SORT_ORDERS),
    showPrices: menuFlag(config.showPrices, 'showPrices'),
    showImages: menuFlag(config.showImages, 'showImages'),
    showDescriptions: menuFlag(config.showDescriptions, 'showDescriptions'),
    showItemCount: menuFlag(config.showItemCount, 'showItemCount'),
    showSearch: menuFlag(config.showSearch, 'showSearch'),
    announcement: menuText(config.announcement, 'announcement', 160),
    categories: validateMenuCategories(config.categories),
    hiddenItemIds: validateMenuItemIds(config.hiddenItemIds, 'hiddenItemIds'),
    featuredItemIds: validateMenuItemIds(config.featuredItemIds, 'featuredItemIds'),
    contact: {
      phone: menuText(contact.phone, 'contact.phone', 90),
      whatsapp: menuText(contact.whatsapp, 'contact.whatsapp', 90),
      address: menuText(contact.address, 'contact.address', 90),
      instagram: menuText(contact.instagram, 'contact.instagram', 90),
    },
    updatedAt: menuText(config.updatedAt, 'updatedAt', 40) || new Date().toISOString(),
  };

  // Checked on the serialised form, because that is what is stored and re-sent: the two
  // images are each bounded, but nothing above bounds their sum.
  const size = Buffer.byteLength(JSON.stringify(validated), 'utf8');
  if (size > MAX_MENU_CONFIG_BYTES) {
    fail(`config must be at most ${MAX_MENU_CONFIG_BYTES} bytes; got ${size}. Use smaller images.`);
  }

  return validated;
}

module.exports = {
  ValidationError,
  MAX_TEXT_LENGTH,
  MAX_NAME_LENGTH,
  MAX_ORDER_ITEMS,
  MAX_MONEY,
  MAX_QUANTITY,
  BRANCH_ID_MAX,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  STOCK_MOVEMENT_TYPES,
  requireString,
  optionalString,
  requireNumber,
  optionalNumber,
  requireMoney,
  optionalMoney,
  requireEnum,
  optionalEnum,
  requireId,
  requirePhone,
  optionalPhone,
  validateOrderItems,
  validateNewOrder,
  validateOrderUpdate,
  validateMenuItem,
  validateMenuItemUpdate,
  validateInventoryItem,
  validateInventoryItemUpdate,
  validateStockMovement,
  validateCustomer,
  validateRecipe,
  validateSettingValue,
  validateMenuConfig,
  MAX_MENU_CONFIG_BYTES,
  MAX_MENU_CATEGORIES,
  MAX_MENU_ITEM_IDS,
  MENU_THEMES,
  MENU_LAYOUTS,
  MENU_SORT_ORDERS,
};
