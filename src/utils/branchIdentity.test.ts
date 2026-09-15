import { describe, expect, it } from 'vitest';
import {
  BRANCH_ID_PATTERN,
  BRANCH_NAME_MAX,
  validateBranchIdentity,
} from './branchIdentity';

const base = {
  branchId: 'main',
  branchName: 'الفرع الرئيسي',
  email: 'main@engaz.tech',
  freezeId: false,
};

describe('validateBranchIdentity', () => {
  it('accepts a slug id, a name and a valid address', () => {
    expect(validateBranchIdentity(base)).toBeNull();
  });

  it('validates the id only when it is still editable', () => {
    expect(validateBranchIdentity({ ...base, branchId: 'main branch' })).toBeTruthy();
    expect(
      validateBranchIdentity({ ...base, branchId: 'main branch', freezeId: true })
    ).toBeNull();
  });

  it('requires a name within the cap', () => {
    expect(validateBranchIdentity({ ...base, branchName: '  ' })).toBe('أدخل اسم الفرع');
    expect(
      validateBranchIdentity({ ...base, branchName: 'x'.repeat(BRANCH_NAME_MAX + 1) })
    ).toBeTruthy();
  });

  it('requires a plausible address, since login matches on it exactly', () => {
    expect(validateBranchIdentity({ ...base, email: 'not-an-email' })).toBeTruthy();
    expect(validateBranchIdentity({ ...base, email: '' })).toBe('أدخل بريد الفرع');
  });

  it('agrees with the reports worker on what an id is', () => {
    for (const id of ['main', 'maadi_2', 'a'.repeat(40)]) {
      expect(BRANCH_ID_PATTERN.test(id), id).toBe(true);
    }
    for (const id of ['Main', 'main branch', "main'", 'فرع', '-main', 'a'.repeat(41)]) {
      expect(BRANCH_ID_PATTERN.test(id), id).toBe(false);
    }
  });
});
