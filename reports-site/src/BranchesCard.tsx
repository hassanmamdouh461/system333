import { useState } from 'react';
import {
  branchLabel,
  branchNames,
  emptyBranchInput,
  suggestBranchId,
  toBranchInput,
  toBranchPayload,
  validateBranch,
  BRANCH_ID_MAX,
  BRANCH_NAME_MAX,
  type BranchInput,
  type BranchRow,
} from './branches';
import { formatCount } from './analytics';
import { Card, Icon } from './ui';

interface BranchesCardProps {
  branches: BranchRow[];
  /**
   * Branch ids that appear on mirrored rows but are not in the registry — a till that synced
   * before anyone named it. They are listed so the manager can give them a name instead of
   * reading a slug in every filter.
   */
  unregisteredIds: string[];
  /** Order count per branch id, so a branch is never judged by its name alone. */
  ordersByBranch: Map<string, number>;
  onSave: (input: BranchInput) => Promise<void>;
}

type Editing = { input: BranchInput; selfId: string | null } | null;

export function BranchesCard({
  branches,
  unregisteredIds,
  ordersByBranch,
  onSave,
}: BranchesCardProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const existingIds = branches.map((branch) => branch.id);
  const names = branchNames(branches);

  const startAdd = () => {
    setError(null);
    setEditing({
      input: { ...emptyBranchInput(), id: suggestBranchId('', existingIds) },
      selfId: null,
    });
  };

  const startEdit = (branch: BranchRow) => {
    setError(null);
    setEditing({ input: toBranchInput(branch), selfId: branch.id });
  };

  /** Names an id that rows already carry: an upsert on the same id, so nothing is orphaned. */
  const startNaming = (id: string) => {
    setError(null);
    setEditing({ input: { ...emptyBranchInput(), id }, selfId: id });
  };

  const patch = (fields: Partial<BranchInput>) => {
    setEditing((current) => (current ? { ...current, input: { ...current.input, ...fields } } : current));
  };

  const submit = async () => {
    if (!editing) return;
    const problem = validateBranch(editing.input, existingIds, editing.selfId);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(toBranchPayload(editing.input) as BranchInput);
      setEditing(null);
    } catch (e) {
      setError((e as Error).message || 'تعذر حفظ الفرع');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="الفروع" hint={`${formatCount(branches.length)} فرع`}>
      {editing ? (
        <div className="branch-form">
          <label className="field">
            <span className="field-label">اسم الفرع</span>
            <input
              value={editing.input.name}
              maxLength={BRANCH_NAME_MAX}
              autoFocus
              onChange={(event) => {
                const name = event.target.value;
                // The id is derived only while adding: changing it on an existing branch
                // would orphan every sale already stamped with the old one.
                patch(
                  editing.selfId === null
                    ? { name, id: suggestBranchId(name, existingIds) }
                    : { name }
                );
              }}
              placeholder="فرع المعادي"
            />
          </label>

          <label className="field">
            <span className="field-label">
              معرّف الفرع
              <span className="field-hint">
                {editing.selfId === null
                  ? 'يُستخدم في ربط الطلبات بالفرع، ولا يُعدَّل بعد الحفظ'
                  : 'ثابت: تعديله يفصل الطلبات المسجَّلة عن هذا الفرع'}
              </span>
            </span>
            <input
              value={editing.input.id}
              maxLength={BRANCH_ID_MAX}
              dir="ltr"
              disabled={editing.selfId !== null}
              onChange={(event) => patch({ id: event.target.value })}
              placeholder="maadi"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field-label">الهاتف</span>
              <input
                value={editing.input.phone}
                dir="ltr"
                onChange={(event) => patch({ phone: event.target.value })}
                placeholder="01000000000"
              />
            </label>

            <label className="field">
              <span className="field-label">العنوان</span>
              <input
                value={editing.input.address}
                onChange={(event) => patch({ address: event.target.value })}
                placeholder="القاهرة"
              />
            </label>
          </div>

          <label className="field-inline">
            <input
              type="checkbox"
              checked={editing.input.active}
              onChange={(event) => patch({ active: event.target.checked })}
            />
            <span>
              الفرع يعمل
              <span className="field-hint">الفرع المتوقف يبقى في التقارير بكل بياناته</span>
            </span>
          </label>

          {error && (
            <p className="banner is-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="control primary" onClick={submit} disabled={busy}>
              {busy ? 'جارٍ الحفظ…' : editing.selfId === null ? 'إضافة الفرع' : 'حفظ التعديل'}
            </button>
            <button
              type="button"
              className="control"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              disabled={busy}
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="setting-list">
            {branches.map((branch) => {
              const orders = ordersByBranch.get(branch.id) ?? 0;
              return (
                <div className="setting-row" key={branch.id}>
                  <div className="setting-text">
                    <span className="setting-label">
                      {branchLabel(branch.id, names)}
                      {branch.active === 0 && <span className="tag tag-warn">متوقف</span>}
                    </span>
                    <span className="setting-hint" dir="ltr">
                      {branch.id}
                    </span>
                    <span className="setting-hint">
                      {orders === 0
                        ? 'لا توجد طلبات في النطاق الحالي'
                        : `${formatCount(orders)} طلب في النطاق الحالي`}
                    </span>
                  </div>
                  <div className="setting-control">
                    <button type="button" className="control" onClick={() => startEdit(branch)}>
                      تعديل
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {branches.length === 0 && (
            <p className="empty">لا توجد فروع مسجَّلة بعد</p>
          )}

          {unregisteredIds.length > 0 && (
            <div className="setting-list">
              {unregisteredIds.map((id) => (
                <div className="setting-row" key={id}>
                  <div className="setting-text">
                    <span className="setting-label" dir="ltr">
                      {id}
                      <span className="tag tag-warn">غير مسجَّل</span>
                    </span>
                    <span className="setting-hint">
                      {`فرع يرسل بيانات ولم يُسجَّل بعد · ${formatCount(
                        ordersByBranch.get(id) ?? 0
                      )} طلب في الفترة`}
                    </span>
                  </div>
                  <div className="setting-control">
                    <button type="button" className="control" onClick={() => startNaming(id)}>
                      تسمية
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="banner is-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <button type="button" className="control primary" onClick={startAdd}>
              <span className="control-icon" aria-hidden="true">
                <Icon name="plus" />
              </span>
              إضافة فرع جديد
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
