# Kinglike Luxury - دليل بناء APK

## المتطلبات المطلوبة على جهازك

### 1. تحميل وتثبيت Java JDK 17
- رابط التحميل: https://adoptium.net/
- اختر: **Eclipse Temurin JDK 17** ثم Install

### 2. تحميل Android Studio
- رابط التحميل: https://developer.android.com/studio
- بعد التثبيت، افتح Android Studio
- اذهب إلى: Tools > SDK Manager
- تأكد من تثبيت: **Android 14 (API 34)**

### 3. تحميل Node.js
- رابط التحميل: https://nodejs.org/
- اختر النسخة **LTS**

---

## خطوات بناء APK

### الخطوة 1: فك ضغط الملف
فك ضغط ملف `kinglike-mobile.zip` في مجلد على جهازك

### الخطوة 2: تثبيت المكتبات
افتح Terminal أو Command Prompt داخل مجلد المشروع واكتب:
```bash
npm install
```

### الخطوة 3: بناء APK
```bash
cd android
./gradlew assembleDebug
```
**على Windows استخدم:**
```bash
cd android
gradlew.bat assembleDebug
```

### الخطوة 4: إيجاد ملف APK
بعد الانتهاء ستجد الملف في:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

---

## ملاحظات مهمة

- رابط API موضوع على: `https://kinglike-luxury.replit.app/api`
- تأكد أن التطبيق المنشور على Replit يعمل قبل بناء APK
- حجم APK المتوقع: 50-80 MB

---

## إذا واجهت مشكلة في NDK

أضف في ملف `android/local.properties`:
```
sdk.dir=C:\\Users\\YOUR_USERNAME\\AppData\\Local\\Android\\Sdk
```
(غير YOUR_USERNAME باسم مستخدمك على Windows)

---

## طريقة أسهل - استخدام Expo EAS (مجاناً)

1. سجّل حساب مجاني على: https://expo.dev
2. ثبّت EAS CLI:
   ```bash
   npm install -g eas-cli
   ```
3. سجّل الدخول:
   ```bash
   eas login
   ```
4. ابنِ APK على الإنترنت:
   ```bash
   eas build -p android --profile preview
   ```
5. بعد 5-10 دقائق ستحصل على رابط تحميل APK مباشر!
