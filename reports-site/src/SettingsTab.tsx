import type { ReactNode } from 'react';
import {
  DENSITIES,
  DENSITY_LABELS,
  REFRESH_CHOICES,
  REFRESH_LABELS,
  THEMES,
  THEME_LABELS,
  type PortalSettings,
} from './settings';
import {
  EXPORT_LABELS,
  buildCsv,
  downloadCsv,
  exportFileName,
  exportRowCount,
  type ExportKind,
  type ExportScope,
} from './csv';
import { ALL_BRANCHES, PERIOD_LABELS, PERIOD_ORDER, formatCount, formatTime } from './analytics';
import { BranchesCard } from './BranchesCard';
import { branchLabel, branchNames, type BranchInput, type BranchRow } from './branches';
import { Card, Icon } from './ui';

interface SettingsTabProps {
  settings: PortalSettings;
  onChange: (patch: Partial<PortalSettings>) => void;
  onReset: () => void;
  /** Branch ids present in the loaded snapshot, for the default-branch picker. */
  branches: string[];
  /** The registry itself, which is what the branches card manages. */
  branchRows: BranchRow[];
  /** Ids seen on mirrored rows but absent from the registry. */
  unregisteredBranchIds: string[];
  /** Order count per branch id over the selected scope. */
  ordersByBranch: Map<string, number>;
  onSaveBranch: (input: BranchInput) => Promise<void>;
  /** Rows currently in scope, which is exactly what an export writes. */
  scope: ExportScope;
  branch: string;
  period: string;
  lastUpdated: Date | null;
  /** Palette in effect, which differs from `settings.theme` when that is `system`. */
  activeTheme: 'light' | 'dark';
  onSignOut: () => void;
}

/** One labelled preference row: description on the start side, control on the end side. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" aria-hidden="true" />
    </button>
  );
}

/** Segmented choice; short option lists read faster than a dropdown that has to be opened. */
function Segments<T extends string>({
  value,
  options,
  labels,
  onChange,
  label,
}: {
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          className={value === option ? 'segment is-active' : 'segment'}
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

const EXPORT_KINDS: ExportKind[] = ['orders', 'menu', 'inventory', 'customers'];

export function SettingsTab({
  settings,
  onChange,
  onReset,
  branches,
  branchRows,
  unregisteredBranchIds,
  ordersByBranch,
  onSaveBranch,
  scope,
  branch,
  period,
  lastUpdated,
  activeTheme,
  onSignOut,
}: SettingsTabProps) {
  const exportNow = (kind: ExportKind) => {
    downloadCsv(exportFileName(kind, branch, period), buildCsv(kind, scope));
  };

  const names = branchNames(branchRows);

  return (
    <div className="settings-grid">
      <BranchesCard
        branches={branchRows}
        unregisteredIds={unregisteredBranchIds}
        ordersByBranch={ordersByBranch}
        onSave={onSaveBranch}
      />

      <Card title="العرض" hint="يُحفظ على هذا الجهاز فقط">
        <div className="setting-list">
          <Row
            label="مظهر اللوحة"
            hint={
              settings.theme === 'system'
                ? `يتبع إعداد النظام، وهو الآن ${THEME_LABELS[activeTheme]}`
                : 'ثابت لا يتغير مع إعداد النظام'
            }
          >
            <Segments
              label="مظهر اللوحة"
              value={settings.theme}
              options={THEMES}
              labels={THEME_LABELS}
              onChange={(theme) => onChange({ theme })}
            />
          </Row>

          <Row label="كثافة العرض" hint="المضغوط يُظهر صفوفًا أكثر في نفس المساحة">
            <Segments
              label="كثافة العرض"
              value={settings.density}
              options={DENSITIES}
              labels={DENSITY_LABELS}
              onChange={(density) => onChange({ density })}
            />
          </Row>
        </div>
      </Card>

      <Card title="التحديث المباشر" hint="اللوحة تتوقف تلقائيًا عندما تكون النافذة مخفية">
        <div className="setting-list">
          <Row label="التحديث التلقائي" hint="سحب لقطة جديدة من قاعدة البيانات على فترات">
            <Toggle
              label="التحديث التلقائي"
              checked={settings.autoRefresh}
              onChange={(autoRefresh) => onChange({ autoRefresh })}
            />
          </Row>

          <Row
            label="مدة التحديث"
            hint={
              settings.autoRefresh
                ? 'المدة الأقصر تعني طلبات أكثر على الخادم'
                : 'تعمل عند تشغيل التحديث التلقائي'
            }
          >
            <select
              className="control"
              aria-label="مدة التحديث"
              disabled={!settings.autoRefresh}
              value={settings.refreshSeconds}
              onChange={(event) => onChange({ refreshSeconds: Number(event.target.value) })}
            >
              {REFRESH_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {REFRESH_LABELS[seconds]}
                </option>
              ))}
            </select>
          </Row>

          <Row label="آخر قراءة للبيانات" hint="توقيت قراءة الخادم للبيانات لا توقيت وصولها">
            <span className="setting-value">
              {lastUpdated ? formatTime(lastUpdated) : 'لم يتم التحديث بعد'}
            </span>
          </Row>
        </div>
      </Card>

      <Card title="النطاق الافتراضي" hint="ما تفتح عليه اللوحة في كل زيارة">
        <div className="setting-list">
          <Row label="حفظ آخر اختيار" hint="يجعل الفرع والفترة الحاليين هما الافتراضيين">
            <Toggle
              label="حفظ آخر اختيار للنطاق"
              checked={settings.rememberScope}
              onChange={(rememberScope) => onChange({ rememberScope })}
            />
          </Row>

          <Row
            label="الفرع الافتراضي"
            hint={branches.length === 0 ? 'لا توجد فروع في البيانات المحمَّلة' : undefined}
          >
            <select
              className="control"
              aria-label="الفرع الافتراضي"
              value={settings.defaultBranch}
              onChange={(event) => onChange({ defaultBranch: event.target.value })}
            >
              <option value={ALL_BRANCHES}>كل الفروع</option>
              {branches.map((id) => (
                <option key={id} value={id}>
                  {branchLabel(id, names)}
                </option>
              ))}
            </select>
          </Row>

          <Row label="الفترة الافتراضية">
            <select
              className="control"
              aria-label="الفترة الافتراضية"
              value={settings.defaultPeriod}
              onChange={(event) =>
                onChange({ defaultPeriod: event.target.value as PortalSettings['defaultPeriod'] })
              }
            >
              {PERIOD_ORDER.map((option) => (
                <option key={option} value={option}>
                  {PERIOD_LABELS[option]}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </Card>

      <Card title="تصدير البيانات" hint="النطاق المعروض حاليًا، بصيغة يقرأها Excel">
        <div className="setting-list">
          {EXPORT_KINDS.map((kind) => {
            const rows = exportRowCount(kind, scope);
            return (
              <Row
                key={kind}
                label={EXPORT_LABELS[kind]}
                hint={rows === 0 ? 'لا توجد صفوف في النطاق الحالي' : `${formatCount(rows)} صف`}
              >
                <button
                  type="button"
                  className="control"
                  disabled={rows === 0}
                  onClick={() => exportNow(kind)}
                >
                  <span className="control-icon" aria-hidden="true">
                    <Icon name="download" />
                  </span>
                  تنزيل
                </button>
              </Row>
            );
          })}
        </div>
      </Card>

      <Card title="الجلسة والصلاحيات" hint="اللوحة تقرأ ولا تكتب">
        <div className="setting-list">
          <Row label="صلاحية الجلسة" hint="رمز قراءة فقط، لا يستطيع تعديل أي بيانات">
            <span className="setting-value is-ok">
              <span className="control-icon" aria-hidden="true">
                <Icon name="shield" />
              </span>
              قراءة فقط
            </span>
          </Row>

          <Row label="إعادة الإعدادات" hint="يرجع كل ما في هذه الصفحة إلى الوضع الافتراضي">
            <button type="button" className="control" onClick={onReset}>
              استعادة الافتراضي
            </button>
          </Row>

          <Row label="تسجيل الخروج" hint="ينتهي الرمز فورًا على هذا المتصفح">
            <button type="button" className="control danger" onClick={onSignOut}>
              خروج
            </button>
          </Row>
        </div>
      </Card>
    </div>
  );
}
