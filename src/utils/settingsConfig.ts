// Keys for localStorage
const LS_TAX_RATE_KEY = 'engaz_tax_rate';
const LS_ADMIN_CREDS_KEY = 'engaz_admin_creds';
const LS_BRANCH_CONFIG_KEY = 'engaz_branch_config';
const LS_TELEGRAM_CONFIG_KEY = 'engaz_telegram_config';

/**
 * Persist a settings value through the explicit, whitelisted Electron settings
 * channel. The main process validates keys against a whitelist, so only durable
 * settings reach SQLite. localStorage stays as a fast read cache.
 */
function persistSetting(key: string, value: string): void {
  localStorage.setItem(key, value);
  if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.saveSetting === 'function') {
    window.electronAPI.saveSetting(key, value).catch((err: unknown) => {
      console.warn('[settings] Failed to persist setting to SQLite:', key, err);
    });
  }
}

// ─── Password hashing ─────────────────────────────────────────────────────────
// Re-exported from utils/password so every caller reaches the same implementation. Digests
// are PBKDF2 with a per-record random salt; see that module for why.
export { hashPassword, verifyPassword, isHashed } from './password';
import { hashPassword, isHashed } from './password';

// ─── Tax rate ─────────────────────────────────────────────────────────────────
/**
 * The rate applied when the branch has never configured one. `orderTotals` re-exports this
 * so the Electron layer and the tests read the same constant; a divergent default made one
 * stored order report two different revenues depending on which layer summed it.
 */
export const DEFAULT_TAX_RATE = 0.1;

export function getTaxRate(): number {
  const saved = localStorage.getItem(LS_TAX_RATE_KEY);
  if (saved !== null) {
    const rate = parseFloat(saved);
    if (!isNaN(rate)) return rate;
  }
  return DEFAULT_TAX_RATE;
}

export function setTaxRate(rate: number): void {
  persistSetting(LS_TAX_RATE_KEY, rate.toString());
}

// ─── Admin credentials ───────────────────────────────────────────────────────

export interface AdminCredentials {
  username: string;
  /** PBKDF2 digest, or null when no password has been set on this device yet. */
  password: string | null;
}

const DEFAULT_ADMIN_USERNAME = 'admin';

/**
 * The stored admin credential, or a username with no password when the device has never
 * had one set. There is deliberately no default password: a shipped default is a password
 * every install shares, and the one every attacker tries first.
 */
export async function getAdminCredentials(): Promise<AdminCredentials> {
  const saved = localStorage.getItem(LS_ADMIN_CREDS_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.username && isHashed(parsed.password)) {
        return { username: parsed.username, password: parsed.password };
      }
    } catch {
      // Unparseable: fall through to the unset state rather than trusting a partial record.
    }
  }
  return { username: DEFAULT_ADMIN_USERNAME, password: null };
}

export async function setAdminCredentials(username: string, password?: string): Promise<void> {
  // Omitted password means "keep the existing credential". This is the only way a caller
  // can update just the username without re-hashing an already-stored digest.
  if (password === undefined) {
    const existing = await getAdminCredentials();
    persistSetting(LS_ADMIN_CREDS_KEY, JSON.stringify({ username, password: existing.password }));
    return;
  }
  persistSetting(
    LS_ADMIN_CREDS_KEY,
    JSON.stringify({ username, password: await hashPassword(password) })
  );
}

// ─── Branch config ───────────────────────────────────────────────────────────
export interface BranchConfig {
  branchId: string;
  branchName: string;
  email: string;
  /** PBKDF2 digest, or null when this device has no branch password set yet. */
  password: string | null;
}

const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  branchId: 'default',
  branchName: 'Main Branch',
  email: 'admin@branch.local',
  password: null,
};

/**
 * The branch configuration for this POS instance, cached in localStorage and mirrored to
 * the Electron settings table.
 */
export function getBranchConfig(): BranchConfig {
  const saved = localStorage.getItem(LS_BRANCH_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.branchId && parsed.email) {
        return {
          ...DEFAULT_BRANCH_CONFIG,
          ...parsed,
          // A plaintext leftover from an older build is not a credential. Treating it as
          // unset forces the first-run password prompt instead of accepting the old value.
          password: isHashed(parsed.password) ? parsed.password : null,
        };
      }
    } catch {
      // Unparseable: fall back to defaults.
    }
  }
  return { ...DEFAULT_BRANCH_CONFIG };
}

/**
 * Saves the branch configuration, hashing the password at this boundary so no caller can
 * accidentally persist a plaintext one. Also writes branch_id separately because
 * database.cjs reads that key directly.
 */
export async function setBranchConfig(config: Partial<BranchConfig>): Promise<void> {
  const current = getBranchConfig();
  const updated: BranchConfig = { ...current, ...config };

  if (config.password !== undefined && config.password !== null) {
    // Already-hashed input is passed through: the branch settings form loads the stored
    // digest into its field, and re-hashing it would corrupt the credential.
    updated.password = isHashed(config.password)
      ? config.password
      : await hashPassword(config.password);
  }

  persistSetting(LS_BRANCH_CONFIG_KEY, JSON.stringify(updated));
  persistSetting('branch_id', updated.branchId);
}

// ─── Telegram config ─────────────────────────────────────────────────────────
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  reportTime: string; // e.g., "23:00"
  enabled: boolean;
}

const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  reportTime: '23:00',
  enabled: false,
};

export function getTelegramConfig(): TelegramConfig {
  const saved = localStorage.getItem(LS_TELEGRAM_CONFIG_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_TELEGRAM_CONFIG, ...parsed };
    } catch {
      // JSON parse error, fallback
    }
  }
  return { ...DEFAULT_TELEGRAM_CONFIG };
}

export function setTelegramConfig(config: Partial<TelegramConfig>): void {
  const current = getTelegramConfig();
  const updated = { ...current, ...config };
  persistSetting(LS_TELEGRAM_CONFIG_KEY, JSON.stringify(updated));
}
