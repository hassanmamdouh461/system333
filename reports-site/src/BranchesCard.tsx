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
  /** Soft-deletes one branch by id; rows stamped with it stay readable in history. */
  onDelete: (id: string) => Promise<void>;
}

type Editing = { input: BranchInput; selfId: string | null } | null;

export function BranchesCard({
  branches,
  unregisteredIds,
  ordersByBranch,
  onSave,
  onDelete,
}: BranchesCardProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The id of the branch the manager has asked to remove, shown alongside its row so a
   * confirmation is local to the action that triggered it. The buttons that go with the
   * confirm replace the edit/delete pair, so the same row never asks two questions at once.
   */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const existingIds = branches.map((branch) => branch.id);
  const names = branchNames(branches);

  const startAdd = () => {
    setError(null);
    setConfirmDeleteId(null);
    setEditing({
      input: { ...emptyBranchInput(), id: suggestBranchId('', existingIds) },
      selfId: null,
    });
  };

  const startEdit = (branch: BranchRow) => {
    setError(null);
    setConfirmDeleteId(null);
    setEditing({ input: toBranchInput(branch), selfId: branch.id });
  };

  /** Names an id that rows already carry: an upsert on the same id, so nothing is orphaned. */
  const startNaming = (id: string) => {
    setError(null);
    setConfirmDeleteId(null);
    setEditing({ input: { ...emptyBranchInput(), id }, selfId: id });
  };

  const cancelEditing = () => {
    setEditing(null);
    setError(null);
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

  /**
   * Two-step removal: the row first reveals a small confirm strip, only a second click on
   * "تأكيد الحذف" commits. An accidental click on the trash icon must not erase a registry
   * entry a till is still using.
   */
  const confirmDelete = (id: string) => {
    setError(null);
    setEditing(null);
    setConfirmDeleteId(id);
  };

  const cancelDelete = () => setConfirmDeleteId(null);

  const performDelete = async () => {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setBusy(true);
    setError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch (e) {
      setError((e as Error).message || 'تعذر حذف الفرع');
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
            <button type="button" className="control" onClick={cancelEditing} disabled={busy}>
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="setting-list">
            {branches.map((branch) => {
              const orders = ordersByBranch.get(branch.id) ?? 0;
              const isConfirming = confirmDeleteId === branch.id;
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
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          className="control danger"
                          onClick={performDelete}
                          disabled={busy}
                          aria-label={`تأكيد حذف ${branchLabel(branch.id, names)}`}
                        >
                          {busy ? 'جارٍ الحذف…' : 'تأكيد الحذف'}
                        </button>
                        <button
                          type="button"
                          className="control"
                          onClick={cancelDelete}
                          disabled={busy}
                        >
                          تراجع
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="control" onClick={() => startEdit(branch)}>
                          تعديل
                        </button>
                        <button
                          type="button"
                          className="control danger"
                          onClick={() => confirmDelete(branch.id)}
                          title={`حذف ${branchLabel(branch.id, names)}`}
                          aria-label={`حذف ${branchLabel(branch.id, names)}`}
                        >
                          <span className="control-icon" aria-hidden="true">
                            <Icon name="trash" />
                          </span>
                          حذف
                        </button>
                      </>
                    )}
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
