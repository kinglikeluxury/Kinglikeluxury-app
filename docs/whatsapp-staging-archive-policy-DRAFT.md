# Kinglike WhatsApp — Staging Archive Policy DRAFT
Status: DRAFT — NOT APPROVED — NOT ACTIVE
Version proposed: wa-staging-policy-v1
Scope: single approved company work number and authorized staff. This file does not authorize connection, archiving or production use.

## Processing purpose
Ensure continuity of work-related customer service, auditable handover of customer communications to assigned Kinglike Luxury staff, and limited quality/safety review of business-only conversations. Do not use this system for private communications, unrelated surveillance, or employee personal chats.

## Scope and access
Only preapproved company business numbers and Meta-verified coexistence accounts may be connected. Owner or explicitly authorized case staff get role-limited access to relevant business messages. Log access and administrative changes, encrypt data in transit and at rest, and keep tokens in a segregated store. Do not grant broad read access to all employees.

## Proposed retention — decision required
Suggested default **30 days** for message content, subject to assessment of the applicable legal basis, contractual needs, data residency, customer rights and any legal preservation duty. After expiration, delete or irreversibly anonymize content; apply separate minimal retention to security/audit events if lawfully justified. This is a proposal, not an implemented setting.

## Employee notice draft (Arabic)
"توضح شركة Kinglike Luxury أن رقم واتساب العمل المخصص لها قد يتم ربطه بنظام إدارة محادثات العمل، مع استمرار استخدام تطبيق WhatsApp Business إذا أجازت Meta ذلك. الغرض هو متابعة طلبات العملاء وضمان استمرارية الخدمة. قد يطّلع الموظفون المخوّلون فقط على محادثات العمل ضمن حدود الصلاحيات المعتمدة. لا يشمل النظام المحادثات الشخصية. مدة الاحتفاظ المقترحة بالمحتوى 30 يومًا، على أن تعتمد المدة النهائية بعد المراجعة القانونية. لا يبدأ الحفظ قبل اعتماد السياسة وإشعار العملاء واستكمال الضوابط التقنية. يحق للموظف توجيه استفسارات الخصوصية والاعتراضات إلى الإدارة."

## Customer notice draft (Arabic)
"قد تستخدم Kinglike Luxury نظامًا آمنًا لإدارة رسائلك المتعلقة باستفساراتك العقارية عبر واتساب، بهدف متابعة طلبك وتقديم خدمة متسقة من الموظفين المخوّلين. عند تفعيل النظام، تُحفظ محادثات العمل وفق سياسة احتفاظ معتمدة ومحدودة، مع ضوابط وصول وتشفير. للاستفسار عن كيفية استخدام بياناتك أو لطلب ممارسة حقوقك القانونية، يرجى التواصل مع الشركة عبر قنواتها الرسمية. لا تعني هذه الرسالة طلب موافقة على تسويق إضافي."

## Guardrails for activation
- Verify Meta eligibility/Tech Provider status and true WhatsApp Business App coexistence in Meta, not merely Cloud API onboarding.
- Obtain distinct employee acknowledgement with effective notice version and retention.
- Independently approve the lawful basis and policy through the authorized legal review process; do not fabricate a legal assessment reference.
- Require business-owner authorization, cryptographic webhook signature, idempotency, and no storage before customer notification proof.
- Respect the approved exact number; do not register a different phone.
- Treat all readiness flags as **false** until their named verification evidence is available.
- Do not replace or delete the employee's existing WhatsApp Business app.

Prepared for review; no data processing or external API calls are approved by this draft.
