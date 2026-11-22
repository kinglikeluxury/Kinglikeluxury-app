# Kinglike WhatsApp — Staging Archive Policy DRAFT
Status: DRAFT — NOT APPROVED — NOT ACTIVE
Version proposed: wa-staging-policy-v2
Scope: single approved company work number and authorized staff. This file does not authorize connection, archiving or production use.

## Processing purpose
Ensure continuity of work-related customer service, auditable handover of customer communications to assigned Kinglike Luxury staff, and limited quality/safety review of business-only conversations. Do not use this system for private communications, unrelated surveillance, or employee personal chats.

## Scope and access
Only preapproved company business numbers and Meta-verified coexistence accounts may be connected. Owner or explicitly authorized case staff get role-limited access to relevant business messages. Log access and administrative changes, encrypt data in transit and at rest, and keep tokens in a segregated store. Do not grant broad read access to all employees.

## Requested retention: no preset automatic expiry — legal review required
Owner requirement (22 November 2026): **retain authorized business conversations without a fixed 30-day or other automatic expiration timer**. Preserve chronological business history while processing remains necessary and lawfully justified. This is an open-ended retention request, **not an authorization to keep personal data forever regardless of purpose, legal basis or a valid erasure request**.
Before activation, document for each category the lawful basis, retention criteria, periodic necessity review, legal hold conditions, rights/erasure workflow, access controls, and secure deletion or irreversible anonymization when the legal basis ceases. Distinguish company business communications from private conversations and apply customer notice. A legally required specific retention limit or valid deletion obligation overrides this request.
**Technical gap:** the current Staging policy/database and runtime readiness impose an integer retention range of **1–3650 days**, and the archive feature remains disabled. The engineer must design and test a separately reviewed open-ended retention mode before it can be activated; do not insert a fake 3650-day period or bypass the existing safety checks.

## Employee notice draft (Arabic)
"توضح شركة Kinglike Luxury أن رقم واتساب العمل المخصص لها قد يتم ربطه بنظام إدارة محادثات العمل، مع استمرار استخدام تطبيق WhatsApp Business إذا أجازت Meta ذلك. الغرض هو متابعة طلبات العملاء وضمان استمرارية الخدمة. قد يطّلع الموظفون المخوّلون فقط على محادثات العمل ضمن حدود الصلاحيات المعتمدة. لا يشمل النظام المحادثات الشخصية. تطلب الشركة الاحتفاظ بسجل محادثات العمل دون تاريخ حذف تلقائي ثابت، ما دام الاحتفاظ ضروريًا وله أساس قانوني صالح، مع مراجعة الحاجة دوريًا واحترام حقوق أصحاب البيانات. لا يُفعّل هذا التوجه قبل المراجعة القانونية والتنفيذ التقني المعتمد. لا يبدأ الحفظ قبل اعتماد السياسة وإشعار العملاء واستكمال الضوابط التقنية. يحق للموظف توجيه استفسارات الخصوصية والاعتراضات إلى الإدارة."

## Customer notice draft (Arabic)
"قد تستخدم Kinglike Luxury نظامًا آمنًا لإدارة رسائلك المتعلقة باستفساراتك العقارية عبر واتساب، بهدف متابعة طلبك وتقديم خدمة متسقة من الموظفين المخوّلين. عند تفعيل النظام، تُحفظ محادثات العمل دون موعد حذف تلقائي ثابت ما دامت هناك حاجة مشروعة ومبررة للاحتفاظ، وبما يراعي حقوقك القانونية، مع مراجعة ضرورة الاحتفاظ وضوابط وصول وتشفير. وتُحدّد معايير الاحتفاظ النهائية قبل تفعيل الأرشفة. للاستفسار عن كيفية استخدام بياناتك أو لطلب ممارسة حقوقك القانونية، يرجى التواصل مع الشركة عبر قنواتها الرسمية. لا تعني هذه الرسالة طلب موافقة على تسويق إضافي."

## Guardrails for activation
- Verify Meta eligibility/Tech Provider status and true WhatsApp Business App coexistence in Meta, not merely Cloud API onboarding.
- Obtain distinct employee acknowledgement with effective notice version and retention.
- Independently approve the lawful basis and policy through the authorized legal review process; do not fabricate a legal assessment reference.
- Require business-owner authorization, cryptographic webhook signature, idempotency, and no storage before customer notification proof.
- Respect the approved exact number; do not register a different phone.
- Treat all readiness flags as **false** until their named verification evidence is available.
- Do not replace or delete the employee's existing WhatsApp Business app.

Prepared for review; no data processing or external API calls are approved by this draft.
