# EVENTS.md — أحداث البوت

## أحداث Facebook Messenger (FCA)

يتلقى البوت الأحداث من FCA عبر \`MiraiTransport\` و \`FcaEventAdapter\`.

| الحدث | المعالج | الوظيفة |
|-------|---------|---------|
| \`message\` | \`message.handler.ts\` | رسالة نصية عادية → تمرير للـ CommandPipeline |
| \`message_reply\` | \`message.handler.ts\` + KickPlugin | رسالة ردّ — تُستخدم للكشف عن هدف الطرد |
| \`event:member_join\` | \`group.handler.ts\` | انضمام عضو جديد للقروب |
| \`event:member_left\` | \`group.handler.ts\` | مغادرة عضو من القروب |
| \`event:name_changed\` | \`group.handler.ts\` | تغيير اسم القروب → ManagementPlugin يُعيده |
| \`event:nickname_changed\` | \`group.handler.ts\` | تغيير كنية عضو → ManagementPlugin يُعيدها |
| \`typ\` | (internal) | مؤشر الكتابة |

## أحداث Plugin System (الباص الداخلي)

الـ plugins تتواصل فيما بينها عبر \`PluginEventBus\`.

| الحدث | الـ Publisher | الـ Subscriber |
|-------|--------------|---------------|
| \`plugin:enabled\` | PluginManager | (لوغ فقط) |
| \`plugin:disabled\` | PluginManager | (لوغ فقط) |

## أحداث دورة حياة البوت

| الحدث | الوظيفة |
|-------|---------|
| \`startup\` | تهيئة المصادقة + DB + Middleware + Plugins |
| \`shutdown\` | حفظ الحالة + إغلاق MQTT + تنظيف الموارد |
| \`reconnect\` | إعادة الاتصال بعد انقطاع MQTT |

---

*آخر تحديث: تلقائي*
