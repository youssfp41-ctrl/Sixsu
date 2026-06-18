# تقرير المراجعة المعمارية — نظام Multi-Account
**المستودع:** `Sixseven-6677/Sixsu` | **التاريخ:** 2026-06-18

---

## الملخص التنفيذي

تمّ إجراء مراجعة معمارية شاملة لنظام تشغيل حسابين على Facebook Messenger Bot مكتوب بـ TypeScript. كشفت المراجعة عن **خللَين حرجَين** وعدد من القرارات التصميمية المتعمَّدة التي قد تُوهِم بأنها أخطاء. تم إصلاح الخللين وتوثيق كل شيء في هذا التقرير.

---

## 1. بنية النظام

### ما هو صحيح (مُعزَّل بشكل صحيح) ✅

| المكوّن | الوضع | التفسير |
|---|---|---|
| `MiraiTransport` | مُعزَّل لكل حساب | كل حساب له instance منفصلة مع اسم `systemName` فريد |
| `MiraiSender` | مُعزَّل لكل حساب | يستخدم transport الحساب نفسه |
| `FcaEventAdapter` | مُعزَّل لكل حساب | مبني بـ `botUserId` الخاص بكل حساب |
| `HumanBehaviorSender` | مُعزَّل لكل حساب | يُغلّف Sender الخاص بكل حساب |
| `FacebookGateway` | مُعزَّل لكل حساب | كل حساب له gateway خاص به |
| `ContextBuilder` | مُعزَّل لكل حساب | يُربط بـ gateway الحساب المناسب |
| `ctx.reply()` | صحيح | يذهب دائماً عبر sender الحساب الذي استقبل الحدث |
| `cooldown.middleware` | صحيح | يستخدم مفتاح `${botId}:${userId}:${command}` |
| `SessionManager` | صحيح | مُفهرَس بـ `accountId` |
| `ReconnectManager` | صحيح | يتتبع كل حساب بمفتاح مستقل |
| `AuthManager` | صحيح | بيانات اعتماد منفصلة لكل حساب |

### ما هو مشترك بتعمُّد (سلوك صحيح) ⚪

| المكوّن | التفسير |
|---|---|
| `CommandPipeline` + `CommandRegistry` | الأوامر stateless — المشاركة مقصودة ولا تسبب تداخلاً |
| `BanStore` | المستخدم المحظور محظور من جميع الحسابات — سلوك مقصود |
| `LockdownStore` | قفل قروب عبر حساب A يقفله عبر حساب B — مقصود |
| `AdminStore` | الأدمن هو أدمن على جميع الحسابات — مقصود |
| `UserService` + `UserRepository` | بروفايل المستخدم موحَّد — مقصود |
| `ProtectionRegistry._store` | مُفهرَس بـ `threadId` — إذا كان الحساب A و B في نفس القروب فالحماية مشتركة، وهذا صحيح |
| `GroupControlRegistry._mutedThreads` | كتم القروب يؤثر على جميع الحسابات — سلوك مقصود للأدمن |
| `PrefixStore` | بادئة موحدة لجميع الحسابات — مقصود في التصميم الحالي |

---

## 2. الأخطاء المكتشَفة والمُصلَحة

### الخلل الحرج #1 — Anti-Spam يحسب رسائل الحسابين معاً
**الملف:** `src/middleware/built-in/antispam.middleware.ts`
**الخطورة:** 🔴 حرج — يسبب حجب مستخدمين بشكل خاطئ

#### وصف المشكلة
تشاركت جميع الحسابات `CommandPipeline` واحداً، وبالتالي `createAntiSpamMiddleware` أنشأ instance واحداً لـ `store` يُفهرَس فقط بـ `userId`:

```typescript
// قبل الإصلاح — خاطئ
let record = store.get(userId);
```

**السيناريو التالف:**
- المستخدم X يرسل 3 رسائل لحساب A (عداده = 3)
- المستخدم X يرسل 2 رسائل لحساب B (عداده = 5)
- يُحجب المستخدم X من حساب B رغم أنه لم يتجاوز الحد في أيٍّ من الحسابين منفردًا

#### الإصلاح المطبَّق
```typescript
// بعد الإصلاح — صحيح
const botId = ctx.thread.pageId || "default";  // معرّف حساب البوت
const key   = `${botId}:${userId}`;             // عداد منفصل لكل حساب
let record = store.get(key);
```

يُطابق هذا نمط العزل الموجود بالفعل في `cooldown.middleware.ts`.

---

### الخلل المتوسط #2 — حماية الأسماء/الكنيات تستخدم API الحساب الأساسي دائماً
**الملفات:** `src/handlers/group.handler.ts` + `src/index.ts`
**الخطورة:** 🟡 متوسط — حماية الأسماء/الكنيات لا تعمل في الحساب الثانوي

#### وصف المشكلة
كان `_apiGetter` في `group.handler.ts` singleton على مستوى الوحدة، ويُعيَّن فقط للحساب الأساسي:

```typescript
// src/index.ts — يُعيَّن فقط للحساب الأساسي
if (isPrimary) {
  setGroupSender(sender);
  setGroupBotUserId(botUserId);
  setGroupApiGetter(() => transport.getApi() as any);  // PRIMARY فقط
}
```

وكان `bootFcaAccount` يمرّر الدوالَّ مباشرةً دون سياق الحساب:

```typescript
// قبل الإصلاح — خاطئ
onNameChanged:     handleNameChanged,      // لا يعرف أي حساب استقبل الحدث
onNicknameChanged: handleNicknameChanged,  // لا يعرف أي حساب استقبل الحدث
```

**النتيجة:** عندما يتلقى الحساب B حدث `name_changed` لقروب محمي، تحاول الدالة `setTitle` تنفيذ الأمر عبر API الحساب A — الذي ربما لا يكون عضواً في ذلك القروب أصلاً.

#### الإصلاح المطبَّق

**في `group.handler.ts`:** أُضيف معامل اختياري `apiGetterOverride`:
```typescript
export async function handleNameChanged(
  event: FBNameChangedEvent,
  apiGetterOverride?: () => any,  // يُحقن من bootFcaAccount
): Promise<void> {
  // يستخدم الـ override إذا وُجد، وإلا يرجع للـ getter العام
  const api = (apiGetterOverride ? apiGetterOverride() : getFcaApi()) as IFcaProtectionApi | null;
  // ...
}
```

**في `src/index.ts`:** تمرير getter خاص بكل حساب:
```typescript
const accountApiGetter = (): any => transport.getApi();  // مغلق على transport الحساب

transport.setEventHandler((fcaEvent) => {
  // ...
  onNameChanged:     (evt) => handleNameChanged(evt, accountApiGetter),     // ✅
  onNicknameChanged: (evt) => handleNicknameChanged(evt, accountApiGetter), // ✅
});
```

---

## 3. تحليل بقية المكوّنات (لا تتطلب إصلاحاً)

### `src/prefix/PrefixStore.ts`
```typescript
export const prefixStore = new PrefixStore();  // singleton عالمي
```
**الحكم:** مقصود. بادئة موحدة لكلا الحسابين. إذا أُريد عزل مستقبلاً: يُحوَّل إلى Map مُفهرَسة بـ `botId`.

### `src/protection/ProtectionRegistry.ts`
```typescript
let _store: ProtectionStore = { threads: {}, botNicknames: {} };
```
**الحكم:** آمن. المفتاح هو `threadId`. إذا كان كلا الحسابين في نفس القروب (نفس `threadId`)، مشاركة حالة الحماية مقصودة ومفيدة.

### `src/protection/GroupControlRegistry.ts`
```typescript
const _mutedThreads = new Set<string>();
```
**الحكم:** مقصود. الأدمن يكتم القروب لجميع الحسابات في آنٍ واحد.

### `src/handlers/message.handler.ts`
```typescript
let pipeline: CommandPipeline | undefined;  // مُعيَّن مرةً واحدة، مشترك
```
**الحكم:** آمن. `CommandPipeline` و`CommandRegistry` stateless، ولا تحتفظ بحالة per-request. الردود تُوجَّه عبر `ctx.reply()` الذي يستخدم sender الحساب الصحيح.

### قاعدة البيانات (MongoDB)
| النموذج | لا يحتوي `accountId` | التفسير |
|---|---|---|
| `GroupSettings` | مُفهرَس بـ `threadId` | إعدادات القروب مشتركة — مقصود |
| `BotConfig` | مفتاح نصي فقط | الإعدادات العالمية — مقصود |
| `BotAdmin` | مُفهرَس بـ `fbId` | الأدمن عالمي — مقصود |

---

## 4. ملخص التغييرات المُطبَّقة

| الملف | نوع التغيير | الوصف |
|---|---|---|
| `src/middleware/built-in/antispam.middleware.ts` | 🔴 إصلاح حرج | مفتاح العداد: `userId` → `${botId}:${userId}` |
| `src/handlers/group.handler.ts` | 🟡 إصلاح متوسط | إضافة `apiGetterOverride?` لـ `handleNameChanged` + `handleNicknameChanged` |
| `src/index.ts` | 🟡 إصلاح متوسط | تمرير `accountApiGetter` لكل حساب في `bootFcaAccount` |

---

## 5. توصيات مستقبلية (ليست أخطاء حالية)

1. **عزل البادئة per-account:** إذا احتاج كلٌّ من الحسابين لبادئة مختلفة، حوّل `PrefixStore` إلى `Map<botId, string>`.
2. **إعدادات القروب per-account:** أضف حقل `accountId` لـ `GroupSettings` إذا أُريد تخصيص إعدادات مختلفة لنفس القروب عبر حسابين مختلفين.
3. **`groupMuteMiddleware` scope:** الكتم حالياً عالمي (يؤثر على كلا الحسابين). إذا أُريد كتم per-account: غيّر المفتاح من `threadId` إلى `${botId}:${threadId}` في `GroupControlRegistry`.
4. **تسجيل `botId` في logs حماية الاسم:** أضف `botId: botId` لـ log entries في `handleNameChanged` لتسهيل تتبع أي حساب قام بالrevert.

---

## 6. الخلاصة

| الفئة | العدد |
|---|---|
| أخطاء تم إصلاحها | **2** |
| مكوّنات آمنة ومُعزَّلة بشكل صحيح | **12** |
| حالات مشاركة متعمَّدة | **7** |
| توصيات مستقبلية | **4** |

النظام في حالة جيدة بعد تطبيق الإصلاحين. المعمارية الأساسية لـ `bootFcaAccount` — حيث كل حساب له transport/sender/gateway/adapter مستقل — صحيحة. الإصلاحان يسدّان ثغرتين في الطبقة التي تربط هذا العزل بالـ middleware المشترك وبمعالجات أحداث القروب.
