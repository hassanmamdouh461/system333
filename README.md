<div align="center">

# ☕ BrewMaster
### نظام نقاط بيع متكامل للكافيهات والمطاعم — Multi-Branch POS

*تطبيق سطح مكتب للفروع + بوابة ويب للإدارة العامة + قاعدة بيانات سحابية مركزية*

[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-29-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers_+_D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![SQLite](https://img.shields.io/badge/SQLite-Local-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)

</div>

---

## 🏗️ المعمارية الحقيقية للنظام

```
┌──────────────────────────┐         ┌─────────────────────────────┐
│   فرع الكاشير (Electron)  │         │     الإدارة العامة (الويب)    │
│  ┌────────────────────┐  │         │   manager.engaz.tech        │
│  │ React UI (Vite)    │  │         │  (Cloudflare Worker + KV)   │
│  ├────────────────────┤  │         └─────────────┬───────────────┘
│  │ SQLite محلي        │  │                       │ يقرأ التقارير
│  │ better-sqlite3     │  │                       ▼
│  └─────────┬──────────┘  │         ┌─────────────────────────────┐
│            │ مزامنة كل 30ث│         │  api.engaz.tech             │
└────────────┼─────────────┘         │  Cloudflare Worker          │
             ▼ POST {batch SQL}      │  (مصادقة X-API-Key + CORS)  │
      ┌──────────────────────────────┴─────────────┐
      │        Cloudflare D1 — brewmaster-db        │
      │  orders · customers · menu_items · inventory│
      └─────────────────────────────────────────────┘
```

| المكوّن | التقنية | الغرض |
|---------|---------|-------|
| **واجهة الفرع** | React 18 + Vite + Tailwind | شاشة الكاشير، المطبخ، المنيو، العملاء |
| **تطبيق سطح المكتب** | Electron 29 | يعمل بدون إنترنت، قاعدة SQLite محلية |
| **المزامنة** | `electron/syncEngine.cjs` | دفع السجلات غير المتزامنة كل 30 ثانية |
| **الـ API المركزي** | Cloudflare Worker على `api.engaz.tech` | وسيط SQL آمن بين العملاء وD1 |
| **قاعدة البيانات** | Cloudflare D1 (`brewmaster-db`) | المخزن المركزي لكل الفروع |
| **بوابة المدير** | `manager.engaz.tech` | تقارير وإحصائيات كل الفروع (قراءة فقط) |

---

## ✨ المزايا

### 🏪 مزايا تشغيلية
- **لوحة كانبان حية** — خط سير الطلبات: `جديد → قيد التحضير → جاهز`
- **تدفق دفع ذكي** — شاشة كاشير بفرز الطلبات غير المدفوعة وتتبع كاش/كارت
- **فصل المطبخ عن المالية** — حالة الطلب وحالة الدفع مساران مستقلان
- **إدارة المنيو والمخزون** — CRUD كامل مع وصفات وخصم مخزون تلقائي
- **ولاء العملاء** — نقاط كسب واستبدال مسجلة على الطلب نفسه
- **تقارير يومية عبر تيليجرام** — إرسال تلقائي من لوحة المدير

### ⚙️ مزايا تقنية
- **يعمل أوفلاين** — الفرع يشتغل بالكامل بدون إنترنت ويزامن لاحقًا
- **سجل مالي ثابت** — الضريبة تُخزن على الطلب وقت الدفع (لا تغيير رجعي)
- **لا بيانات وهمية** — كل رقم في التقارير من قاعدة البيانات فقط
- **مصادقة API** — كل طلبات الـ Worker محمية بمفتاح `X-API-Key`

---

## 🚀 التشغيل

### المتطلبات
- Node.js `>= 18`

### 1. فرع الكاشير (Electron)

```bash
git clone https://github.com/hassanmamdouh461/system333.git
cd system333
npm install

# ملف .env بجانب التطبيق (أو من شاشة الإعدادات):
#   VITE_CF_WORKER_URL=https://api.engaz.tech
#   VITE_CF_WORKER_API_KEY=<مفتاح الفروع المشترك>

npm run electron:dev      # تطوير: Vite + Electron
npm run electron:build    # إنتاج: حزمة NSIS لـ Windows
```

### 2. بوابة المدير (الويب)

```bash
# بناء نسخة الويب الموجهة للـ API المركزي
VITE_CF_WORKER_URL=https://api.engaz.tech \
VITE_CF_WORKER_API_KEY=<مفتاح الفروع المشترك> \
npx vite build

# محتويات dist/ تُنشر على manager.engaz.tech
```

> **حسابات الدخول الافتراضية:** المدير يدخل من الويب فقط، وحسابات الفروع تدخل من تطبيق سطح المكتب فقط.

### 3. البنية السحابية (Cloudflare)

كود الـ Worker المنشور على `api.engaz.tech` موجود في [`cloudflare/d1-proxy-worker.js`](cloudflare/d1-proxy-worker.js) مع إعداد `wrangler.toml`. الجداول الأربعة في D1: `orders`، `customers`، `menu_items`، `inventory`.

---

## 📁 بنية المشروع

```
├── electron/              # العملية الرئيسية لـ Electron
│   ├── main.cjs           # النافذة + IPC handlers
│   ├── database.cjs       # تهيئة SQLite والترحيلات
│   ├── syncEngine.cjs     # عامل المزامنة الخلفي (30 ثانية)
│   ├── mockApiService.cjs # عميل الـ Worker (دفع/سحب D1)
│   └── *Repository.cjs    # طبقة الوصول للجداول المحلية
├── src/
│   ├── pages/             # Dashboard, Orders, Payment, Reports,
│   │                      # ManagerDashboard, PublicMenu, Settings...
│   ├── repositories/      # واجهات المستودعات (renderer side)
│   ├── services/          # خدمات المنيو/الطلبات/العملاء
│   ├── hooks/             # useOrders, useMenu, useAnalytics
│   └── context/           # AuthContext, DataContext, LanguageContext
└── cloudflare/            # كود الـ Worker المنشور على api.engaz.tech
```

---

## 🔐 ملاحظات أمنية

- الـ Worker يرفض أي طلب بدون `X-API-Key` صحيح (401)
- CORS مقيد بنطاق `engaz.tech` وبيئات التطوير المحلية فقط
- كلمات مرور الحسابات التجريبية مضمنة في `AuthContext.tsx` — **غيّرها قبل أي استخدام إنتاجي حقيقي**

## 📜 تاريخ المشروع

النسخة الأولى من هذا النظام بُنيت على Appwrite (BaaS) مع Realtime WebSockets، ثم نُقلت البنية بالكامل إلى Cloudflare Workers + D1 مع SQLite محلي لدعم العمل أوفلاين وتعدد الفروع. أي مراجع لـ Appwrite في الملفات القديمة هي لأسباب تاريخية فقط.
