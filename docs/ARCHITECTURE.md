# ARCHITECTURE.md — هندسة البوت

## تدفق العمل الكامل

```
Facebook Messenger
      │  (MQTT/WebSocket)
      ▼
MiraiTransport.ts
      │  fcaEvent (raw FCA object)
      ▼
FcaEventAdapter.ts
      │  تحويل → صيغة داخلية موحّدة
      ▼
FacebookGateway.ts
      │  يوزّع: message / group events
      ├──► message.handler.ts  → CommandPipeline
      └──► group.handler.ts    → ManagementPlugin / group events
```

## مسار تنفيذ الأوامر

```
المستخدم يرسل: "/اوامر نظام"
        │
        ▼
CommandParser.ts
  ├─ يتحقق من البادئة: "/"
  ├─ يستخرج اسم الأمر: "اوامر"
  └─ يستخرج الـ args: ["نظام"]
        │
        ▼
CommandRegistry.resolve("اوامر")
  └─ يجد: CommandsPlugin → execute()
        │
        ▼
CommandPipeline (Middleware chain)
  1. BannedMiddleware     — هل المستخدم محظور؟
  2. LoggingMiddleware    — تسجيل الأمر
  3. LockdownMiddleware   — هل القروب مُغلق؟
  4. GroupMuteMiddleware  — هل القروب مكتوم؟
  5. AntiSpamMiddleware   — حدّ الرسائل
  6. CooldownMiddleware   — فترة انتظار الأمر
  7. PermissionsMiddleware— صلاحيات adminOnly
  8. TypingMiddleware     — مؤشر الكتابة
        │
        ▼
ICommand.execute(ctx)
  └─ ctx.reply("الرد") → MiraiSender → Facebook
```

## نظام الـ Plugins

```
PluginManager
  ├── PluginLoader    — يكشف ملفات الـ plugins تلقائياً
  ├── PluginRegistry  — يحتفظ بحالة كل plugin
  ├── PluginContext   — sandbox معزول لكل plugin
  │    ├── registerCommand()  → CommandRegistry
  │    ├── consumeService()   → PluginServiceRegistry
  │    ├── scheduleRecurring()→ TaskScheduler
  │    └── on() / emit()      → PluginEventBus
  └── PluginServiceRegistry — تبادل الخدمات بين plugins
```

## الخدمات الأساسية المتاحة للـ Plugins

| اسم الخدمة | النوع | الوظيفة |
|------------|-------|---------|
| `mirai-transport` | MiraiTransport | الـ FCA API (الحساب الأول) |
| `mirai-transport-secondary` | MiraiTransport | الحساب الثاني |
| `command-registry` | CommandRegistry | قائمة الأوامر الحية |
| `ban-store` | BanStore | إدارة الحظر |
| `lockdown-store` | LockdownStore | إدارة الإغلاق |
| `admin-store` | AdminStore | قائمة أدمن البوت |
| `user-service` | UserService | بيانات المستخدمين |
| `group-settings-repo` | GroupSettingsRepository | إعدادات القروبات |
| `bot-config-repo` | BotConfigRepository | الإعدادات العامة |

## دورة حياة Plugin

```
onLoad()   → يحمّل الموارد، يقرأ من DB
onEnable() → يسجّل الأوامر والـ listeners
onDisable()→ يحفظ الحالة، يوقف المؤقتات
onUnload() → يحرر الذاكرة نهائياً
```

*ملاحظة: عند disable/unload، يُلغي PluginContext كل ما سجّله (أوامر، listeners، مهام) تلقائياً.*

---

*آخر تحديث: تلقائي*
