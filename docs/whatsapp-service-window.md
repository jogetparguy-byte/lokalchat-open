# WhatsApp service windows and weekly templates

GAP-008 enforces the 24-hour customer service window at the shared sender. Text from bots, manual replies, retries and handoff confirmations uses the same check. The window is open strictly before 24 hours after the latest verified customer message. Missing, future or unreadable state blocks free text with an explicit owner-facing error. Policy failures are marked `retryable: false`.

`recordCustomerServiceEvent` is called after the verified webhook durably records a customer event. Delivery/read status receipts do not open windows. The provider event timestamp is used, never server arrival time. SQL keeps the maximum timestamp when duplicates or older events arrive. Keys include account, sending phone number and recipient, so another business or a replacement connection cannot reuse a window. The table and recording RPC are restricted to service role.

Normal phone recipients use Meta's `to` field. BSUID recipients preserve the complete `CC.alphanumeric` identifier and use `recipient`, omitting `to`. Incoming BSUID messages are always durably recorded. Outbound BSUID delivery is disabled by default and returns an explicit terminal policy error. Enable `WHATSAPP_BSUID_ENABLED=true` only after verifying BSUID support for the connected Meta account and configured `WHATSAPP_GRAPH_VERSION` with an operator-controlled test. The default Graph version remains `v21.0`; this change does not silently upgrade it. Current Meta BSUID documentation describes `<API_VERSION>` requests without a minimum version, so local tests do not establish live compatibility for a particular version. Once enabled, the same service-window and template checks still apply. Unsupported provider requests fail visibly.

## Template configuration

Weekly reports always use `sendWhatsAppTemplate`, including when the service window is open. This avoids depending on recent owner messages. Existing account notification preference and six-day rerun dedupe remain enforced. Missing template configuration and provider rejection do not mark a report sent. The protected cron response includes per-business failures.

Create an appropriate report template in WhatsApp Manager, wait for Meta approval, and configure its exact name and language in the service-only `internal_settings` row with key `whatsapp_weekly_report_template:<account UUID>`:

```json
{"name":"lokalchat_weekly_report","language":"ms","approved":true}
```

`approved: true` records the operator's confirmation, not proof obtained from Meta. Do not set it before the actual template is approved. Meta remains authoritative and may reject, pause or disable the template. The application does not create or approve templates automatically.

The template body must contain exactly these four positional text parameters, in this order:

1. Business name.
2. Number of automatically answered questions in the past seven days.
3. Hours saved, formatted to one decimal place.
4. Handoff percentage, rounded to an integer.

The existing weekly-report recipient preference must permit reports. Operators must obtain the recipient's opt-in and configure the correct owner phone. Sending a template does not itself open the service window; a new customer message does. Manual replies after expiry receive a clear refusal and can continue after the customer responds. There is no automatic replacement of arbitrary manual text with a template.

## Activation and limitations

Apply the service-window migration and GAP-006/GAP-007 migrations together before running the updated webhook. Deploying only the sender safely blocks unknown windows but cannot infer past customer conversations. Earlier stored chat messages are not silently treated as verified provider events.

Successful HTTP submission returns Meta's message ID and sending phone number for GAP-006 tracking. A successful response lacking a usable ID remains accepted with uncertain tracking; it must not trigger a duplicate send. Transport failures retain existing retry behavior. Actual Meta approval, live delivery, desktop activation and production migrations are not verified by local tests.

Sources checked on 20 November 2026:

- [Meta service messages and customer service windows](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).
- [Meta business-scoped user IDs and recipient request field](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids).
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy).
