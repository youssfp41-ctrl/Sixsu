# PROJECT.md — Sixsu Bot

## فكرة البوت

**Sixsu** بوت Facebook Messenger مكتوب بـ TypeScript يعمل على Railway.
يستخدم مكتبة \`@dongdev/fca-unofficial\` للاتصال بـ Messenger عبر بروتوكول MQTT،
ويوفر نظام Plugin قابل للتوسيع يتيح إضافة أوامر جديدة دون تعديل الكود الأساسي.

---

## هيكل المشروع

\`\`\`
src/
├── app.ts                     # تهيئة Express HTTP server (healthcheck)
├── index.ts                   # Bootstrap: يشغّل كل الخدمات بالترتيب
│
├── commands/                  # محرك الأوامر
│   ├── CommandLoader.ts       # يحمّل ملفات الأوامر من القرص
│   ├── CommandParser.ts       # يحلّل نص الرسالة → اسم + args
│   ├── CommandPipeline.ts     # سلسلة middleware → تنفيذ الأمر
│   ├── CommandRegistry.ts     # تسجيل/إلغاء/بحث الأوامر
│   └── types/ICommand.ts      # واجهة ICommand
│
├── context/                   # سياق تنفيذ كل أمر
│   ├── Context.ts             # ctx.reply / ctx.args / ctx.user...
│   ├── ContextBuilder.ts      # يبني Context من حدث Messenger
│   └── types.ts               # ContextUser / ContextThread / ContextMessage
│
├── core/                      # دورة حياة البوت
│   ├── Bot.ts                 # يسجّل + يشغّل الخدمات
│   └── lifecycle/             # startup / shutdown hooks
│
├── database/                  # قاعدة البيانات
│   ├── DatabaseManager.ts     # الاتصال بـ MongoDB
│   ├── models/                # Mongoose models
│   └── repositories/          # Repository pattern لكل Model
│
├── facebook/                  # طبقة Facebook
│   ├── mirai/MiraiTransport.ts# MQTT transport عبر FCA
│   ├── mirai/FcaEventAdapter.ts # يحوّل أحداث FCA → صيغة داخلية
│   ├── FacebookGateway.ts     # يوزّع الأحداث للـ handlers
│   └── auth/                  # إدارة appState + sessions
│
├── middleware/                 # طبقة middleware للأوامر
│   └── built-in/              # antispam, cooldown, permissions, lockdown...
│
├── plugins/                   # نظام الـ Plugins
│   ├── PluginManager.ts       # تحميل/تفعيل/تعطيل الـ plugins
│   ├── PluginContext.ts       # sandbox لكل plugin
│   ├── PluginRegistry.ts      # سجل الـ plugins
│   └── definitions/           # ملفات الـ plugins (كل أمر في مجلد)
│
├── prefix/PrefixStore.ts      # إدارة بادئة الأوامر (يحفظ في MongoDB)
├── protection/                # حماية اسم القروب والكنيات
├── scheduler/                 # مهام مجدولة (recurring / delayed)
├── security/                  # تشفير الـ credentials
└── ui/BotUI.ts               # صيغ الرسائل والهوية البصرية

docs/                          # توثيق المشروع (يُحدَّث تلقائياً)
scripts/                       # سكريبتات مساعدة
\`\`\`

---

## المجلدات الأساسية

| المجلد | الوظيفة |
|--------|---------|
| \`src/plugins/definitions/\` | كل plugin في مجلد مستقل باسمه |
| \`src/ui/BotUI.ts\` | مصدر الهوية البصرية — BRAND, DIV, buildCommandsMessage |
| \`src/commands/CommandRegistry.ts\` | سجل الأوامر الحية — يُستخدم لبناء القوائم ديناميكياً |
| \`src/database/models/\` | نماذج MongoDB |
| \`docs/\` | توثيق يُنشأ تلقائياً عند بدء تشغيل البوت |

---

## متطلبات التشغيل

| المتغير | الوظيفة |
|---------|---------|
| \`FB_APPSTATE\` | appState الحساب الأول (Base64 JSON) |
| \`FB_APPSTATE_2\` | appState الحساب الثاني (اختياري) |
| \`MONGODB_URI\` | رابط MongoDB Atlas |
| \`SESSION_SECRET\` | مفتاح تشفير الجلسة |
| \`BOT_OWNER_IDS\` | معرّفات المالكين (فاصل: ,) |

---

*آخر تحديث: تلقائي عند بدء التشغيل*
