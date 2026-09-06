/**
 * Slug rule for a branch id, shared by the portal's registry and this form.
 *
 * The id becomes the `branch_id` stamped on every order this till writes, so the reports
 * worker only accepts lowercase letters, digits, dash and underscore. Both sides validate;
 * this copy exists because the portal is a separate build and the two projects share no
 * package.
 */
const BRANCH_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const BRANCH_NAME_MAX = 60;
const BRANCH_EMAIL_MAX = 120;

export { BRANCH_ID_PATTERN, BRANCH_NAME_MAX, BRANCH_EMAIL_MAX };

/**
 * The first problem with the identity, in Arabic, or null when it can be saved.
 *
 * The id is frozen once set: every row already written carries it, and changing it here would
 * silently split this till's history into two branches.
 */
export function validateBranchIdentity(identity: {
  branchId: string;
  branchName: string;
  email: string;
  freezeId: boolean;
}): string | null {
  if (!identity.freezeId) {
    const id = identity.branchId.trim().toLowerCase();
    if (!id) return 'أدخل معرّف الفرع';
    if (!BRANCH_ID_PATTERN.test(id)) {
      return 'معرّف الفرع: حروف إنجليزية صغيرة وأرقام وشرطة، ويبدأ بحرف أو رقم';
    }
  }

  if (!identity.branchName.trim()) return 'أدخل اسم الفرع';
  if (identity.branchName.trim().length > BRANCH_NAME_MAX) {
    return `اسم الفرع لا يزيد على ${BRANCH_NAME_MAX} حرفًا`;
  }

  const email = identity.email.trim();
  if (!email) return 'أدخل بريد الفرع';
  if (email.length > BRANCH_EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'أدخل بريدًا إلكترونيًا صحيحًا';
  }

  return null;
}
