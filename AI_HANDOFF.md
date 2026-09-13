# برومبت سياق مشروع Engaz POS — انسخه كاملاً كأول رسالة لنموذج الـ AI

> هذا الملف هو "وصف مشروع جاهز للصق". انسخ كل ما بالأسفل من علامة البداية للنهاية وابعته لأي نموذج AI في شات جديد، وهيفهم المشروع من غير ما يقرأ حاجة تانية.

━━━━━━━━━━━━━━━━━━━━━━ انسخ من هنا ━━━━━━━━━━━━━━━━━━━━━━

أنت مساعد برمجي يعمل على مشروع **Engaz POS**. إليك كل ما تحتاج معرفته عن المشروع:

## 1) هوية المشروع ومكانه

- **الاسم:** Engaz POS — نظام نقاط بيع للمطاعم والكافيهات (على GitHub اسمه `restaurant-management-system`)
- **المستودع:** `https://github.com/hassanmamdouh461/system333.git` — الفرع الافتراضي `main`
- **المسار على الجهاز:** `C:\Users\Lenovo\system333`
- **البرانش الحالي (فيه شغل غير ملتزم):** `fix/remove-hardcoded-seeds-and-sync-improvements`
- **آخر commit:** `15a916a fix: remove hardcoded seed data, propagate deletions across branches, and queue report mirrors`
- النظام: جهاز واحد = فرع واحد (single till per branch)، يعمل **offline-first** وقاعدة الحقيقة محلية (SQLite)، مع مزامنة سحابية اختيارية.

## 2) التقنيات

| الطبقة | التقنية |
|---|---|
| الواجهة | React 18 + TypeScript 5 + Vite 7 + Tailwind CSS 3 + framer-motion + lucide-react |
| سطح المكتب | Electron **29.4.6** (لا ترفعه — انظر ملاحظة 11-ج) + electron-builder |
| قاعدة البيانات المحلية | SQLite عبر `better-sqlite3@12.11.1` (وضع WAL، native module) |
| السحابة | Cloudflare Workers + D1 (عاملان منفصلان — انظر 5) |
| الاختبارات | Vitest (واجهة + عمال Cloudflare) + node:test (Electron units عبر `ELECTRON_RUN_AS_NODE`) |
| البيئة | Node `24.16.0` بالضبط (`.nvmrc`) و npm `11.x` على Windows |

## 3) البنية وتدفق البيانات

```
React (src/) ──IPC via preload.cjs──► Electron Main (electron/*.cjs)
                                        │  ├─ Repositories → SQLite (مفلترة بـ branch_id)
                                        │  ├─ SyncEngine (دورة كل 30 ث + backoff)
                                        │  └─ Telegram/Printing/MockApiService
                                        ▼ HTTPS (X-API-Key من .env وقت التشغيل)
                            Cloudflare D1 Workers:
                            • api.engaz.tech      → قاعدة POS الإنتاجية
                            • api-reports.engaz.tech → قاعدة تقارير معزولة
                            (التطبيق يكتب في الاثنين؛ البوابة لا تحمل أي مفتاح)
```

- **Renderer لا يرى SQL ولا مفاتيح أبداً** — يتكلم فقط عبر `window.electronAPI` (معرّف في `src/global.d.ts`).
- **كل SQL في الـ Workers مكتوب داخل الـ Worker نفسه** (named endpoints). العميل يرسل بيانات/فلاتر فقط.
- **الحذف ناعم** (tombstones في `deleted_at`) في كل الجداول حتى تنتقل الحذوفات بين الفروع.

## 4) بنية المجلدات المهمة

| المسار | المحتوى |
|---|---|
| `src/pages/` | الشاشات: Orders (POS), Payment, Menu, Inventory, Reports, Settings, Dashboard, PublicMenu, Login |
| `src/context/` | `AuthContext` (جلسة الجهاز — بريد الفرع + كلمة مرور PBKDF2 محلية) و `DataContext` (menu+orders مشتركة) |
| `src/repositories/` | طبقة وصول فوق الـ IPC: `SqliteMenuRepository`, `SqliteOrderRepository` |
| `src/services/` | `menuService`, `inventoryService`, `desktopBridge` (حرّاس وجود electronAPI), `workerClient` (**بلا أي مفتاح** — فقط health check) |
| `src/utils/` | `orderTotals` (كل حسابات المال), `printReceipts`, `settingsConfig`, `password` (PBKDF2), `reportMath`, `inventoryMath` |
| `electron/` | `main.cjs` (IPC handlers + نافذة), `preload.cjs` (الجسر الوحيد), `database.cjs` (schema + migrations + outbox), `OrderRepository/CustomerRepository/MenuRepository/InventoryRepository/CashierRepository.cjs`, `syncEngine.cjs`, `mockApiService.cjs` (عميل D1 — يحمل المفاتيح), `telegramService.cjs`, `printManager.cjs` (نافذة طباعة معزولة بلا Node + CSP), `validate.cjs` (تحقق كل مدخلات IPC), `money.cjs` |
| `cloudflare/` | `d1-proxy-worker.js` (عامل POS) و `d1-reports-worker.js` (عامل التقارير) + اختباراتهما في `__tests__/` |
| `reports-site/` | بوابة إحصائيات المديرين (SPA مستقلة بتثبيت مستقل، تُنشر على reporting.engaz.tech) — **لا تحمل أي مفتاح** |
| `launcher/` | `launch.vbs` → `launch.ps1`: أيقونة سطح المكتب؛ وضع Auto = FastElectron (يحمّل dist/ فوراً) وإلا fallback متصفح |
| `scripts/` | `electron-smoke.mjs` (فحص جاهزية Electron+SQLite قبل الإقلاع), `run-electron-unit.mjs`, `build-freshness.mjs`, `native-rebuild.mjs` |

## 5) الـ endpoints الحية

| الغرض | العنوان |
|---|---|
| بوابة المديرين | `reporting.engaz.tech` |
| عامل التقارير (API) | `api-reports.engaz.tech` |
| عامل POS الإنتاجي (API) | `api.engaz.tech` |
| المنيو العام للعملاء | `menu.engaz.tech` (يعرض نفس حزمة `dist/` — لذلك **ممنوع أي مفتاح في src/**) |

## 6) قواعد عمل (business rules) — لا تكسرها

1. **حالة الطلب ≠ حالة الدفع**: `status: New→Preparing→Ready→Completed(+Cancelled)` للمطبخ، و`paymentStatus: Unpaid→Paid` للمالية. الإيراد من الـ Paid فقط.
2. **الإيراد يقرأ `paidAmount`** (المحصل فعلاً) لا `grandTotal` — الفاتورة المدفوعة جزئياً بنقاط ولاء لا تُحسب كاملة.
3. **لقطة مالية مع الطلب**: `subtotal/taxRate/taxAmount/grandTotal` تُخزن وقت الإنشاء ولا يُعاد حسابها أبداً (`orderTotals()` في القراءة).
4. **نطاق الفرع**: قيمة `NULL` في `branch_id` = مشترك بين كل الفروع. أي استعلام في Repositories لازم يكون `(branch_id = ? OR branch_id IS NULL)`. **لا تثق أبداً بـ branchId قادم من الواجهة** — يُقبل فقط لو هو فرع هذا الجهاز (المصدر: settings key `branch_id`).
5. **نسخ الإصدار عند المزامنة**: أي تعديل محلي يرفع `updated_at` بدالة رتيبة `nextUpdatedAt()` (مللي ثانية واحدة لا تُلغي حقّ التعديل الثاني). تعليم synced يتم بـ version-guard (snapshots) حتى لا يُقفل تعديل حدث أثناء الدفع.
6. **LWW في كل مكان**: السحابة والسحب السحابي يكتبان فقط لو `excluded.updated_at >` الموجود. الجداول الدفترية (inventory_transactions, points_transactions) append-only بـ INSERT OR IGNORE.
7. **المخزون**: `IN` يضيف، `OUT` يخصم، `ADJUST` يثبّت الرصيد على العدد المجرود (`quantity - stock`). الرصيد لا ينزل تحت صفر. البيع يخصم مكونات الوصفة transactionally، والإلغاء يعيدها من الدفتر (لا من الوصفة الحالية).
8. **الولاء**: النقاط بالهاتف، أرصدة صحيحة فقط، الاستبدال يُرفض لو زاد عن الرصيد، وكل حركة تسجَّل في `points_transactions`.
9. **أول دخول للجهاز يضبط كلمة المرور** (لا كلمة مرور مشحونة افتراضية). نفس رسالة الرفض لبريد غير معروف وكلمة خطأ (منع التعداد).
10. **مفتاح settings whitelist**: الـ renderer قد يكتب في SQLite فقط المفاتيح المدرجة في `SETTINGS_WHITELIST` داخل `main.cjs`.

## 7) الأسرار وملفات البيئة — قواعد صارمة

- `.env` (بالجذر) و`reports-site/.env` **gitignored** — ممنوع نشر قيم حقيقية أبداً.
- أي متغير `VITE_*` يُشار إليه من `src/` **يُدمج في الحزمة المنشورة للعامة** (menu.engaz.tech). لذلك:
  - `src/` **لا يقرأ ولا يذكر** `VITE_CF_WORKER_API_KEY` / `VITE_REPORTS_API_KEY`.
  - المفاتيح يقرؤها `electron/mockApiService.cjs` من `.env` **وقت التشغيل** فقط.
  - فيه اختبارات حرس: `src/services/credentialHygiene.test.ts` تفشل البناء لو رجع أي مرجع للمفاتيح في الواجهة.
- القيم الحالية على هذا الجهاز: `VITE_CF_WORKER_API_KEY` مضبوط، `VITE_REPORTS_API_KEY` **غير مضبوط** (وضع reports-only معطّل — المرآة تعمل عبر عامل POS فقط).

## 8) أوامر التحقق (الجذر)

```bash
npm run lint            # ESLint — max-warnings 0
npx --no-install tsc --noEmit
npm test                # Vitest: 217 اختبار (واجهة + عمال Cloudflare)
npm run test:electron-unit   # 19 اختبار node:test على SQLite معزول (:memory:)
npm run test:tooling    # فحص أدوات البناء
npm run test:native     # فحص Electron حي + better-sqlite3 (يجب يطبع ENGAZ_NATIVE_SMOKE_OK)
npm run build           # vite build + بصمة freshness
npm run check:build     # الحزمة طازجة؟ (launcher يعتمد عليه لوضع FastElectron)
```

للبوابة (تثبيت مستقل):
```bash
cd reports-site && npx tsc --noEmit -p tsconfig.json && npm run build
```

CI (`.github/workflows/ci.yml`) يشغّل نفس المجموعتين.

## 9) حالة الشجرة الحالية (سبتمبر 2026)

شجرة العمل فيها تعديلات كثيرة **غير ملتزمة** فوق آخر commit (عمل مراجعة وإصلاح شامل). أهم ما أُصلح حديثاً:

1. **تسريب مفتاح API (P0 — مُصلح في الكود)**: كان `workerClient.ts`/`menuService.ts` يقرأان المفتاح عبر `import.meta.env` فيُدمج في الحزمة العامة. أُزيل نهائياً من الواجهة + اختبارات حرس. **لكن المفتاح القديم كان منشوراً فعلاً على menu.engaz.tech → تدويره واجب (انظر 11-أ)**.
2. **نطاق الفرع** أُطبق على كل Repositories (menu/customers/inventory: قراءة/كتابة/حذف/دفع/تعليم synced) — كانت بلا فلتر.
3. **`upsertPulledOrders`**: صفوف السحب بلا فرع تبقى NULL (مشتركة) ولا تتحول لـ `'default'`، والفلتر يمرر المشترك لكل الفروع.
4. **version-guard snapshots** لكل الدفعات في syncEngine (menu/customers/inventory/orders) — كانت تنسي التعديلات المتزامنة.
5. **`nextUpdatedAt` الرتيب** في Menu/Customer/Inventory repositories (كان `new Date().toISOString()`).
6. **`ADJUST` في المخزون** صار تثبيت رصيد (كان يضيف — كل جرد كان يضخم المخزون).
7. **عقد `getDailyReportStats`** في `global.d.ts` صُحح ليطابق المخرجات الفعلية.
8. **README** أعيدت كتابته بالكامل (كان يصف مشروع Appwrite قديم) و`.env.example` وُضّح.
9. **إرجاع Electron إلى 29.4.6** (كان مرفوعاً لـ 44.3.0 بدون prebuild متاح لـ better-sqlite3 على ويندوز → كسر أيقونة التشغيل).
10. **`scripts/electron-smoke.mjs`**: فشل حذف مجلد الـ temp (EPERM) لم يعد يُفشل الفحص — كان يقلب نجاح SQLite لفشل ويفتح المتصفح بدل التطبيق.
11. **أيقونة سطح المكتب تعمل الآن** (وضع FastElectron) — تم التحقق بتشغيل `wscript launcher\launch.vbs Auto` فعلياً.

## 10) تشغيل التطبيق

```bash
npm run electron:dev    # تطوير: Vite + Electron
npm run electron:build  # حزمة Windows (NSIS) في dist-electron/
```
أيقونة سطح المكتب: `launcher\create-shortcut.ps1` → تشغّل `launch.vbs` → `launch.ps1`:
- Auto = FastElectron (يحمّل `dist/` فوراً بلا dev server) لو الباينري موجود والفحص نجح والبناء طازج.
- أي فشل في فحص الجاهزية → fallback للمتصفح (وهذا ما كان يفتح "موقع" بدل التطبيق — أُصلح).
- اللوجات: `logs/launcher.log`, `logs/electron.out.log`, `logs/electron.err.log`.

## 11) بنود مفتوحة تحتاج قرار صاحب المشروع

- **أ) تدوير مفتاح WORKER_API_KEY واجب**: الحزمة القديمة كانت تحمله منشوراً. الخطوات في `DEPLOY.md` (قسم "مفتاح الكتابة الحالي محروق"): `wrangler secret put` ثم تحديث `.env` ثم إعادة بناء ونشر حزمة المنيو.
- **ب) إعادة نشر حزمة `dist/` النظيفة على menu.engaz.tech** (لإزالة الحزمة المسربة من الخدمة).
- **ج) Electron 44 ممنوع عملياً على ويندوز حالياً**: better-sqlite3 لا تنشر prebuild لإلكترون 44 (ABI 149)، والجهاز بلا VS Build Tools. ابقَ على 29.4.6.
- **د) إعداد الجهاز الحالي يوجه المزامنة لعنوان قديم**: `engaz_d1_worker_url` في الإعدادات = `https://brewmaster-d1-proxy.hassanmamdouh461.workers.dev` (نسخة قديمة من العامل تجيب 400 "Missing sql or batch"). لازم يتغير إلى `https://api.engaz.tech` من شاشة الإعدادات — **المزامنة السحابية معطلة لحد ذلك**.

## 12) قواعد التعديل (التزم بها)

- لا تحذف بيانات موجودة، ولا تعيد كتابة git history.
- لا تضع أسراراً في الكود أو اللوجات، ولا تستخدم `any` أو `@ts-ignore` لإخفاء أخطاء TypeScript، ولا تعطّل lint rules للحصول على build ناجح.
- لا تغيّر business logic (قسم 6) أو schema بدون migration مناسبة (نمط migrations في `database.cjs`: ledger table + فشلها لا يُسجَّل كمنفذة).
- Push دائماً لفرع feature وليس main، وبالأمر: `git -c credential.helper=manager push -u origin <branch>` (credential helper للمستخدم مفرّغ فيجب تمريره صراحة).
- الوثائق الموجودة: `AGENTS.md` (ملاحظات تشغيلية)، `DEPLOY.md` (نشر البوابة والعاملين — بالعربية)، `README.md` (حُدّث حديثاً).

━━━━━━━━━━━━━━━━━━━━━━ انسخ لحد هنا ━━━━━━━━━━━━━━━━━━━━━━
