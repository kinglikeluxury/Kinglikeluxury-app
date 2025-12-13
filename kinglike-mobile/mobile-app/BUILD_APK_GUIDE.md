# دليل بناء تطبيق APK - Kinglike Luxury

## المتطلبات الأساسية

1. **Node.js** (الإصدار 18 أو أحدث)
2. **حساب Expo** (مجاني) - قم بإنشائه على [expo.dev](https://expo.dev)
3. **EAS CLI** - سيتم تثبيته تلقائياً

---

## خطوات بناء ملف APK

### الخطوة 1: تحميل المشروع

قم بتحميل مجلد `kinglike-mobile` بالكامل إلى جهاز الكمبيوتر الخاص بك.

### الخطوة 2: افتح Terminal/CMD

```bash
cd kinglike-mobile/mobile-app
```

### الخطوة 3: تثبيت المكتبات

```bash
npm install
```

### الخطوة 4: تثبيت EAS CLI

```bash
npm install -g eas-cli
```

### الخطوة 5: تسجيل الدخول إلى Expo

```bash
eas login
```

أدخل بريدك الإلكتروني وكلمة المرور لحساب Expo.

### الخطوة 6: إعداد المشروع

```bash
eas build:configure
```

اختر "All" عند السؤال عن المنصات.

### الخطوة 7: بناء ملف APK

```bash
eas build --platform android --profile preview
```

انتظر حتى يكتمل البناء (حوالي 10-15 دقيقة).

### الخطوة 8: تحميل APK

بعد اكتمال البناء، ستحصل على رابط لتحميل ملف APK.
يمكنك أيضاً رؤية جميع البناءات على: https://expo.dev/accounts/YOUR_USERNAME/builds

---

## تحديث رابط الخادم

قبل البناء، تأكد من تحديث رابط الخادم في:
`src/config/api.config.ts`

```typescript
export const API_URL = 'https://your-replit-url.replit.dev/api';
```

---

## ملاحظات مهمة

- ملف APK الناتج سيكون بحجم حوالي 30-50 ميجابايت
- يمكنك تثبيته على أي جهاز Android
- للنشر على Google Play، استخدم `eas build --platform android --profile production`

---

## الدعم الفني

إذا واجهت أي مشاكل:
1. تأكد من تحديث Node.js إلى أحدث إصدار
2. احذف مجلد `node_modules` وأعد تثبيت المكتبات
3. تأكد من اتصالك بالإنترنت

---

## Build APK Guide (English)

### Prerequisites
1. **Node.js** (version 18 or later)
2. **Expo Account** (free) - Create at [expo.dev](https://expo.dev)
3. **EAS CLI** - Will be installed automatically

### Quick Steps

```bash
# Navigate to the project
cd kinglike-mobile/mobile-app

# Install dependencies
npm install

# Install EAS CLI globally
npm install -g eas-cli

# Login to Expo
eas login

# Configure the project
eas build:configure

# Build APK
eas build --platform android --profile preview
```

After the build completes (10-15 minutes), you'll receive a download link for the APK file.

### Update Server URL

Before building, update the API URL in `src/config/api.config.ts`:
```typescript
export const API_URL = 'https://your-replit-url.replit.dev/api';
```
