# DATABASE.md — قاعدة البيانات

## تقنية قاعدة البيانات: MongoDB + Mongoose

يستخدم البوت MongoDB Atlas عبر متغير `MONGODB_URI`.
إذا لم يكن المتغير موجوداً، يعمل البوت بدون persistence (تُفقد البيانات عند إعادة التشغيل).

---

## Collections

| Collection | Model | الوظيفة |
|------------|-------|---------|
| `bans` | `BanModel` | الحظر المؤقت/الدائم للمستخدمين |
| `blackconfigs` | `BlackConfigModel` | إعدادات الإرسال التلقائي لكل قروب |
| `botconfigs` | `BotConfigModel` | إعدادات عامة (البادئة…) |
| `botadmins` | `BotAdminModel` | أدمن البوت المضافون عبر الأوامر |
| `commandstats` | `CommandStatsModel` | إحصائيات استخدام الأوامر |
| `groupsettings` | `GroupSettingsModel` | إعدادات كل قروب (حماية الاسم، الكنيات، lockdown) |
| `users` | `UserModel` | بيانات المستخدمين (التفضيلات، عدد الرسائل) |

---

## Models التفصيلية

### BanModel (`bans`)
```typescript
{
  userId:    string;   // معرّف المستخدم المحظور
  reason?:   string;   // سبب الحظر
  expiresAt?: Date;    // null = حظر دائم
  bannedBy:  string;   // من أجرى الحظر
  createdAt: Date;
}
```

### BlackConfigModel (`blackconfigs`)
```typescript
{
  threadId:    string;  // معرّف القروب
  message:     string;  // نص الرسالة التلقائية
  intervalSec: number;  // الفاصل الزمني بالثواني
  active:      boolean; // هل هي مفعّلة؟
  lastSentAt:  Date | null;
}
```

### BotConfigModel (`botconfigs`)
```typescript
{
  key:   string;  // اسم الإعداد (مثال: "prefix")
  value: string;  // قيمة الإعداد
}
```

### BotAdminModel (`botadmins`)
```typescript
{
  userId:    string;  // معرّف الأدمن
  addedBy:   string;  // من أضافه
  addedAt:   Date;
}
```

### GroupSettingsModel (`groupsettings`)
```typescript
{
  threadId:         string;
  protectName:      boolean;             // حماية اسم القروب
  lockedName:       string;              // الاسم المحمي
  protectNicknames: boolean;             // حماية الكنيات
  nicknames:        Record<string,string>; // كنية كل عضو
  botNickname:      string;              // كنية البوت المحمية
  lockdown:         boolean;             // وضع الإغلاق
}
```

### UserModel (`users`)
```typescript
{
  userId:      string;
  displayName: string;
  messageCount: number;
  preferences: Record<string, unknown>;
  firstSeen:   Date;
  lastSeen:    Date;
}
```

---

## Repository Pattern

كل Model له Repository مقابله يوفّر عمليات CRUD آمنة:

```
BanRepository          → BanModel
BlackConfigRepository  → BlackConfigModel
BotConfigRepository    → BotConfigModel
BotAdminRepository     → BotAdminModel
CommandStatsRepository → CommandStatsModel
GroupSettingsRepository→ GroupSettingsModel
UserRepository         → UserModel
```

---

## ملاحظات

- **Fallback:** كل plugin يحفظ في ملف JSON محلي إذا لم يكن MongoDB متاحاً.
- **PrefixStore:** يحمّل البادئة من MongoDB عند البداية ويحدّثها عند التغيير.
- **AdminStore:** يحمّل أدمن البوت من MongoDB ويتزامن معه عند كل تغيير.

---

*آخر تحديث: تلقائي*
