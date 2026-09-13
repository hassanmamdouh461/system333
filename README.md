<div align="center">

# ☕ Engaz POS
### نظام نقاط بيع للمطاعم والكافيهات — يعمل محلياً، يتزامن سحابياً

*Built for real cafés. Works offline, syncs when online.*

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers/D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

</div>

---

## 📐 البنية العامة

نظام من ثلاث طبقات حول قاعدة بيانات محلية:

```
┌──────────────────────────────┐   IPC (contextIsolation)   ┌───────────────────────────┐
│   Renderer (React + Vite)    │ ─────────────────────────► │   Electron Main Process   │
│   src/ — POS UI, screens     │ ◄───────────────────────── │   electron/*.cjs          │
└──────────────────────────────┘      preload.cjs bridge    │  • SQLite (better-sqlite3)│
                                                        │  • Repositories (scoped   │
                                                        │    by branch_id)          │
                                                        │  • Sync Engine            │
                                                        └────────────┬──────────────┘
                                                                     │ HTTPS (X-API-Key)
                                                       ┌─────────────▼─────────────┐
                                                       │  Cloudflare D1 Workers    │
                                                       │  • api.engaz.tech  (POS)  │
                                                       │  • api-reports…    (Portal)│
                                                       └───────────────────────────┘
```

- **قاعدة الحقيقة محلية**: كل عملية تُكتب في SQLite على الجهاز أولاً (`better-sqlite3`، وضع WAL)، والتطبيق يعمل كاملاً بلا إنترنت.
- **المزامنة سحابية**: محرك خلفي (`electron/syncEngine.cjs`) يدفع الصفوف غير المتزامنة ويجذب تغييرات الفروع الأخرى كل 30 ثانية مع backoff عند الفشل، وصفّ ذهاب وإياب لكل جدول.
- **فصل قاعدتين في السحابة**: قاعدة POS الإنتاجية، وقاعدة تقارير معزولة يقرأ منها بوابة المديرين (`reporting.engaz.tech`) — التطبيق يكتب في كلتيهما، والبوابة لا تحمل أي مفتاح كتابة.
- **كل استعلامات SQL في الـ Worker مكتوبة داخل الـ Worker نفسه**: العميل يرسل بيانات وفلاتر مسماة فقط، لا نصوص SQL.
- **حذف ناعم (tombstones)** في كل الجداول حتى تنتقل الحذوفات بين الفروع.

> هذا المستودع لا يستخدم Appwrite. القديم المذكور في بعض الوثائق أزيل مع انتقال المشروع إلى Electron + SQLite + Cloudflare D1.

---

## ✨ المزايا

- **شاشة POS** — قائمة أصناف بفئات ديناميكية، سلة، فاتورة ضريبية بلقطة مالية محفوظة مع الطلب.
- **لوحة طلبات (Kanban)** — `New → Preparing → Ready → Completed` مع إلغاء يعيد مكونات الوصفة للمخزون.
- **شاشة دفع** — فواتير غير مدفوعة/مدفوعة، نقدي/بطاقة، مرشحة لليوم الحالي.
- **مخزون ووصفات** — خصم تلقائي للمكونات عند البيع، حركات `IN`/`OUT`/`ADJUST` مع دفتر حركة كامل، وتكلفة الوصفة.
- **ولاء العملاء** — نقاط بالهاتف، دفتر نقاط (`points_transactions`)، استبدال يُرفض إذا زاد عن الرصيد.
- **تقارير** — إيرادات (تقرأ `paidAmount` فلا تُحسب الفاتورة المخصومة بالكامل)، COGS من الحركات الفعلية، أرباح.
- **طباعة** — فاتورة عميل + تذكرة مطبخ + تذكرة بار في نافذة معزولة بلا Node وCSP صارم.
- **تقارير Telegram يومية** — إرسال مجدول بوقت محلي، مع إعادة محاولة تلقائية.
- **منيو عام للعملاء** — صفحة QR عامة (`menu.engaz.tech`) تُدار من إعدادات التطبيق وتُنشر عبر الـ Worker.
- **متعدد الفروع** — كل جهاز فرع واحد؛ كل استعلامات SQLite مفلترة بـ `branch_id` داخل العملية الرئيسية.

---

## 🏛️ مبدأ الحسابات: حالة الطلب ≠ حالة الدفع

| المسار | القيم | الشاشة |
|---|---|---|
| مسار المطبخ (تشغيلي) | `New → Preparing → Ready → Completed` | Orders |
| المسار المالي | `Unpaid → Paid` | Payment |

الإيراد لا يُحتسب إلا من الطلبات `Paid`، ويقرأ المبلغ المحصل فعلاً (`paidAmount`) لا الإجمالي — ففاتورة دُفع جزء منها بنقاط ولاء لا تُقرأ كإيرادها الكامل. الضريبة والخصم يُخزنان كلقطة مع الطلب وقت إنشائه، فلا يُعاد حسابها بأثر رجعي.

---

## 🚀 التشغيل

### المتطلبات
- Node.js `24.16.0` (سطر 24.x المدعوم — انظر `.nvmrc`)
- npm `11.x`

### التثبيت

```bash
git clone https://github.com/hassanmamdouh461/system333.git
cd system333
npm install
```

### متغيرات البيئة

انسخ القالب ثم املأ القيم (`.env` مدرج في `.gitignore`):

```bash
cp .env.example .env
```

أهم المتغيرات (الشرح الكامل داخل القالب):

| المتغير | الاستخدام |
|---|---|
| `VITE_CF_WORKER_URL` | عنوان عامل POS الإنتاجي |
| `VITE_CF_WORKER_API_KEY` | مفتاح كتابة عامل POS — **يقرأه Electron من `.env` وقت التشغيل، لا يصل إلى أي حزمة متصفح** |
| `VITE_REPORTS_WORKER_URL` | عنوان عامل التقارير |
| `VITE_REPORTS_API_KEY` | مفتاح كتابة قاعدة التقارير — للعملية الرئيسية فقط |

> ⚠️ أي متغير يبدأ بـ `VITE_` ويُشار إليه من `src/` يُدمج في الحزمة المبنية. حزمة الجذر تُنشر للعامة على `menu.engaz.tech`، لذا لا يجوز الرجوع إلى أي مفتاح من كود الواجهة. مصادر التطبيق لا تقرأ المفاتيح إطلاقاً.

### التشغيل

```bash
# واجهة الويب فقط (بلا Electron)
npm run dev

# تطبيق سطح المكتب (Vite + Electron معاً)
npm run electron:dev

# بناء إنتاجي للحزمة + تطبيق سطح المكتب
npm run electron:build
```

قاعدة البيانات المحلية تُنشأ تلقائياً في مجلد بيانات المستخدم (وضع WAL، مع migrations تُنفذ مرة واحدة).

### اختصار سطح المكتب (Windows)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File launcher\create-shortcut.ps1
```

يُنشئ أيقونة **Engaz POS** تشغّل `launcher\launch.vbs`: يثبّت المتطلبات أول مرة، يخدم بناء `dist/` المحلي، ثم يفتح نافذة Electron — أو المتصفح إن لم يتوفر. الأخطاء تظهر في رسالة، وكل تشغيل يُسجّل في `logs\launcher.log`.

| الأمر | الأثر |
| --- | --- |
| `launcher\create-shortcut.ps1 -Mode Browser` | اختصار يفتح المتصفح بدل Electron |
| `launcher\create-shortcut.ps1 -Remove` | حذف الاختصار |
| `run.bat` | نفس المشغل بكولسول ظاهر للتنقيح |

---

## 🧪 الاختبارات والفحوص

```bash
npm run lint          # ESLint (صفر تحذيرات)
npm run typecheck     # tsc --noEmit
npm test              # Vitest: وحدات الواجهة + عمال Cloudflare
npm run test:electron-unit  # اختبارات SQLite معزولة (node:test)
npm run test:tooling  # فحص أدوات البناء (بصمة الحزمة، مسح الأسرار)
npm run test:native   # تشغيل Electron فعلياً + better-sqlite3
```

CI (`.github/workflows/ci.yml`) يشغل نفس المجموعات، إضافة إلى فحص منفصل للبوابة في `reports-site/` (بإصدار TypeScript أصرم).

---

## 📁 بنية المشروع

```
src/
├── components/        # شاشات الواجهة (POS, menu, inventory, settings, ...)
├── context/           # AuthContext (جلسة الجهاز), DataContext (بيانات مشتركة)
├── hooks/             # useOrders, useMenu, useAnalytics, ...
├── pages/             # مسارات (Orders, Payment, Reports, Inventory, PublicMenu, ...)
├── repositories/      # طبقة الوصول للبيانات فوق جسر Electron IPC
├── services/          # menuService, inventoryService, desktopBridge, workerClient
├── types/             # عقود الأنواع (Order, MenuItem, Customer, ...)
└── utils/             # حسابات المال، الضريبة، الولاء، الطباعة، التهيئة
electron/              # العملية الرئيسية: قاعدة البيانات، المستودعات، المزامنة، الطباعة، Telegram
cloudflare/            # عمال D1: عامل POS + عامل التقارير + اختباراتهما
reports-site/          # بوابة إحصائيات المديرين (SPA مستقلة بتثبيت مستقل)
launcher/              # مشغل Windows واختصار سطح المكتب
scripts/               # أدوات البناء والاختبار
```

بوابة التقارير منشورة على `reporting.engaz.tech` وعاملها على `api-reports.engaz.tech` — دليل النشر الكامل في [DEPLOY.md](./DEPLOY.md).

---

## 🔐 الأمان

- جسر IPC واحد (`preload.cjs`)، `contextIsolation` + `sandbox`، ولا يصل للواجهة إلا ما تحتاجه.
- كل مدخلات IPC تتحقق في `electron/validate.cjs` قبل الوصول لأي معامل SQL.
- كلمات المرور تُخزن PBKDF2-SHA256 (210k تكرار، ملح لكل جهاز) — لا كلمة مرور افتراضية مشحونة.
- مفاتيح الـ Workers تقرأها العملية الرئيسية من `.env` وقت التشغيل؛ حزمة الواجهة لا تحمل أي مفتاح.
- نافذة الطباعة معزولة: بلا Node، بلا سكربتات، CSP يمنع أي مصدر خارجي.
- حزم البوابات تُفحص آلياً قبل النشر بحثاً عن أي سر (`scripts/build-reports.mjs`).

---

## 📄 License

This project is licensed under the **MIT License**.
