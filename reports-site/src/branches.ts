/**
 * Branch registry, as the portal sees it.
 *
 * A branch id is the value stamped on every mirrored row, so it is treated as an identifier
 * and validated the same way the worker validates it: reject here rather than let the worker
 * reject after a round trip, and keep the two rules in one readable place.
 *
 * A branch name is Arabic display text. Nothing reads it as data, so it is only trimmed and
 * length-capped.
 */

export interface BranchRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  /** 0 for a closed branch, which still keeps its history readable. */
  active: number | null;
}

/** What the settings form submits: the identity, without the bookkeeping columns. */
export interface BranchInput {
  id: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
}

/** Same rule as the worker: a slug, because `branch_id` is compared exactly. */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const BRANCH_NAME_MAX = 60;
export const BRANCH_ID_MAX = 40;

export function emptyBranchInput(): BranchInput {
  return { id: '', name: '', phone: '', address: '', active: true };
}

export function toBranchInput(row: BranchRow): BranchInput {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? '',
    address: row.address ?? '',
    active: row.active !== 0,
  };
}

/**
 * The first problem with this branch, in Arabic, or null when it is submittable.
 *
 * `existingIds` are the branches already registered; a new branch may not reuse one, because
 * the save is an upsert and would silently rename the other branch instead of creating this
 * one. Editing a branch passes its own id as `selfId` so it does not collide with itself.
 */
export function validateBranch(
  input: BranchInput,
  existingIds: string[],
  selfId: string | null = null
): string | null {
  const id = input.id.trim().toLowerCase();
  if (!id) return 'أدخل معرّف الفرع';
  if (!ID_PATTERN.test(id)) {
    return 'معرّف الفرع: حروف إنجليزية صغيرة وأرقام وشرطة، ويبدأ بحرف أو رقم';
  }
  if (id !== selfId && existingIds.includes(id)) return 'هذا المعرّف مستخدم بالفعل';

  const name = input.name.trim();
  if (!name) return 'أدخل اسم الفرع';
  if (name.length > BRANCH_NAME_MAX) return `اسم الفرع لا يزيد على ${BRANCH_NAME_MAX} حرفًا`;

  return null;
}

/** The payload the worker accepts, with the identifier normalized once, here. */
export function toBranchPayload(input: BranchInput) {
  return {
    id: input.id.trim().toLowerCase(),
    name: input.name.trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    active: input.active,
  };
}

/**
 * A display name per branch id.
 *
 * An id present on rows but missing from the registry keeps appearing as itself: dropping it
 * would hide a branch's sales, and inventing a name would claim knowledge the portal lacks.
 */
export function branchNames(branches: BranchRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const branch of branches) {
    if (branch.id) names.set(branch.id, branch.name || branch.id);
  }
  return names;
}

export function branchLabel(id: string | null, names: Map<string, string>): string {
  if (!id) return 'غير محدد';
  return names.get(id) ?? id;
}

/** Suggests a slug from a typed name, so the manager rarely has to invent one. */
export function suggestBranchId(name: string, existingIds: string[]): string {
  const base = name
    .trim()
    .toLowerCase()
    // Arabic names transliterate to nothing useful, so anything outside the slug alphabet
    // becomes a separator and an all-Arabic name falls through to the numbered default.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BRANCH_ID_MAX);

  const candidate = ID_PATTERN.test(base) ? base : 'branch';
  if (!existingIds.includes(candidate)) return candidate;

  for (let suffix = 2; suffix < 100; suffix++) {
    const numbered = `${candidate.slice(0, BRANCH_ID_MAX - 3)}-${suffix}`;
    if (!existingIds.includes(numbered)) return numbered;
  }
  return `${candidate.slice(0, BRANCH_ID_MAX - 6)}-${Date.now().toString(36).slice(-4)}`;
}
