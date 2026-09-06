import { describe, expect, it } from 'vitest';
import {
  BRANCH_NAME_MAX,
  branchLabel,
  branchNames,
  emptyBranchInput,
  suggestBranchId,
  toBranchInput,
  toBranchPayload,
  validateBranch,
  type BranchInput,
  type BranchRow,
} from './branches';

function input(overrides: Partial<BranchInput> = {}): BranchInput {
  return { ...emptyBranchInput(), id: 'main', name: 'الفرع الرئيسي', ...overrides };
}

function row(overrides: Partial<BranchRow> = {}): BranchRow {
  return { id: 'main', name: 'الفرع الرئيسي', phone: null, address: null, active: 1, ...overrides };
}

describe('validateBranch', () => {
  it('accepts a slug id with an Arabic name', () => {
    expect(validateBranch(input(), [])).toBeNull();
  });

  it('requires an id and a name', () => {
    expect(validateBranch(input({ id: '  ' }), [])).toBe('أدخل معرّف الفرع');
    expect(validateBranch(input({ name: '  ' }), [])).toBe('أدخل اسم الفرع');
  });

  it('rejects an id that could never be matched against branch_id', () => {
    for (const id of ['main branch', "main'", 'فرع', '-main', 'a'.repeat(41)]) {
      expect(validateBranch(input({ id }), []), id).toBeTruthy();
    }
  });

  it('rejects reusing an id, which would rename another branch instead of adding one', () => {
    expect(validateBranch(input({ id: 'main' }), ['main'])).toBe('هذا المعرّف مستخدم بالفعل');
  });

  it('lets a branch keep its own id while being edited', () => {
    expect(validateBranch(input({ id: 'main' }), ['main'], 'main')).toBeNull();
  });

  it('compares ids case-insensitively, matching how they are stored', () => {
    expect(validateBranch(input({ id: 'MAIN' }), ['main'])).toBe('هذا المعرّف مستخدم بالفعل');
  });

  it('caps the name', () => {
    expect(validateBranch(input({ name: 'x'.repeat(BRANCH_NAME_MAX) }), [])).toBeNull();
    expect(validateBranch(input({ name: 'x'.repeat(BRANCH_NAME_MAX + 1) }), [])).toBeTruthy();
  });
});

describe('toBranchPayload', () => {
  it('normalizes the id and trims every field once, at this boundary', () => {
    expect(
      toBranchPayload(input({ id: '  Maadi_2 ', name: '  فرع المعادي  ', phone: ' 0100 ' }))
    ).toEqual({
      id: 'maadi_2',
      name: 'فرع المعادي',
      phone: '0100',
      address: '',
      active: true,
    });
  });
});

describe('toBranchInput', () => {
  it('turns null columns into empty fields a form can bind to', () => {
    expect(toBranchInput(row())).toEqual({
      id: 'main',
      name: 'الفرع الرئيسي',
      phone: '',
      address: '',
      active: true,
    });
  });

  it('reads only an explicit zero as closed', () => {
    expect(toBranchInput(row({ active: 0 })).active).toBe(false);
    expect(toBranchInput(row({ active: null })).active).toBe(true);
  });
});

describe('branchNames and branchLabel', () => {
  it('maps each id to its display name', () => {
    const names = branchNames([row(), row({ id: 'maadi', name: 'فرع المعادي' })]);
    expect(branchLabel('maadi', names)).toBe('فرع المعادي');
  });

  it('shows an unregistered id as itself rather than hiding its sales', () => {
    // A till that synced before it was registered still has rows in the database.
    expect(branchLabel('branch_9', branchNames([row()]))).toBe('branch_9');
  });

  it('falls back to the id when a registered branch has an empty name', () => {
    expect(branchLabel('main', branchNames([row({ name: '' })]))).toBe('main');
  });

  it('names a row with no branch at all', () => {
    expect(branchLabel(null, branchNames([]))).toBe('غير محدد');
  });
});

describe('suggestBranchId', () => {
  it('slugifies a Latin name', () => {
    expect(suggestBranchId('New Cairo Store', [])).toBe('new-cairo-store');
  });

  it('falls back to a default for an Arabic-only name, which has no slug', () => {
    expect(suggestBranchId('فرع المعادي', [])).toBe('branch');
  });

  it('numbers a suggestion that is already taken', () => {
    expect(suggestBranchId('فرع جديد', ['branch'])).toBe('branch-2');
    expect(suggestBranchId('فرع جديد', ['branch', 'branch-2'])).toBe('branch-3');
  });

  it('always suggests something a validator accepts', () => {
    for (const name of ['', '   ', '!!!', '٢٠٢٦', 'x'.repeat(80)]) {
      const suggested = suggestBranchId(name, []);
      expect(validateBranch(input({ id: suggested }), []), name).toBeNull();
    }
  });
});
