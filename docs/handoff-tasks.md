# Handoff tasks and owner notifications

## Inbox

In **Live Chat**, open **Handoff tasks**. The **Open** view shows tasks awaiting acceptance, overdue tasks and accepted tasks. Open the customer's chat, accept the task, then resolve it after following up. **Resolved** shows the latest 100 resolved tasks. The chat's existing bot toggle controls when the bot resumes.

Choose the channel for new notifications in the same panel. **In Inbox** is the default. To select **WhatsApp**, save the owner's number in Settings. The worker also requires an active WhatsApp connection and an approved handoff template. Existing notification records keep their original channel.

Each alert shows its own stage and delivery status. A WhatsApp alert accepted by Meta can later show delivered or read. The task has a separate acceptance action. Failed alerts for tasks still awaiting acceptance can be queued again. An unconfirmed delivery requires explicit confirmation because another send may create a duplicate.

## Backend

A bot pause creates a durable `handoff_tasks` row and initial `handoff_notifications` record in the same database transaction. This covers AI handoff, model/prompt/commercial fallback, unreadable inbound media and manual bot pauses. A customer message arriving in an already paused chat also ensures an open task. A resolved task can therefore be followed by a new task without resuming the bot. Replay does not reset acknowledgement or duplicate an open task. Existing paused chats are backfilled during migration.

Tasks have explicit `pending`, `accepted` and `resolved` states. Owners acknowledge pending tasks, then resolve accepted tasks. `transition_handoff_task` performs an owner-scoped compare-and-set; ordinary authenticated clients have read-only table access. Task acknowledgement does not resume the bot. The authenticated API offers `listHandoffTasks`, `transitionHandoffTask`, `retryHandoffNotification`, `getHandoffSettings` and `setHandoffChannel` through the existing account request binding.

The default channel is `in_app`: the record persists, and becomes visible when the task UI is open. Publication does not prove that the owner saw or accepted it. Optional `whatsapp` requires the owner's explicit channel selection, `profiles.owner_whatsapp`, a working account connection and a purpose-specific approved template. Set service-only `internal_settings.key = whatsapp_handoff_template:<business UUID>` to JSON with `approved:true`, `name` and `language`, using the same validated template configuration reader as weekly reports. The approved body must accept two text parameters: the initial/overdue summary and the task UUID. Weekly-report template configuration remains separate.

The notification worker starts beside inbound recovery and sweeps every 15 seconds while the server is running. Atomic claims use `SKIP LOCKED`, attempt tokens and a five-minute lease. Known transient HTTP failures retry with 30-second exponential backoff, capped at 30 minutes and five attempts. Missing configuration, opt-out and terminal provider rejections are recorded. Unknown submission outcomes and expired sending leases become `uncertain`; they are not resent automatically. Explicit owner retry can duplicate a previously accepted alert and must carry that warning in the pending UI.

After exactly 15 minutes without task acceptance, one escalation notification is created. Unique `(task_id, stage)` prevents repeated escalation. Accepted/resolved tasks suppress unclaimed reminders; the worker rechecks task state and current channel preference before sending. A request already in flight cannot be withdrawn when acknowledgement arrives. No unattended server means no background sweep; tasks remain durable and are processed on the next startup.

Provider IDs and later statuses reuse the existing delivery event pipeline. Early status events reconcile when a notification is finalized. Old callback activity cannot consume a retry's new lease.

Customer handoff wording confirms that the request was recorded for owner review. Install the GAP-001 through GAP-009 migrations before activating this feature on another backend.

Verification includes worker behavior tests and real isolated PostgreSQL tests for atomic creation, deduplication, tenant/RLS isolation, CAS transitions, retry fences/backoff/exhaustion, exact escalation boundary, stale-submission uncertainty and provider callback reconciliation.

The Inbox browser harness uses a mocked server boundary to check task actions, retry confirmation and channel selection. Live WhatsApp delivery still requires verification with a configured recipient and approved template.
