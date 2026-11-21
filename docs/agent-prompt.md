# Store instructions in the agent

`buildAgentSystemPrompt` loads `profiles.system_prompt` using the `business_id` read from the current chat. It selects only `system_prompt`, filters by `profiles.id`, and deliberately keeps no cache. Every new `runAgent` turn reloads the value. All gateway calls within that turn use the same context snapshot, including lookup and structured-response follow-ups.

An absent profile, `null`, an empty string or whitespace uses the platform instructions and default communication style without custom store rules. Saving an edit or clearing the field takes effect on the next turn. Database errors, malformed stored values and values longer than the existing 8,000-character save limit stop generation before a gateway call. Database errors do not silently remove a store's policy. A missing chat owner also stops generation; there is no global profile fallback.

Instruction priority is explicit: platform safety, account isolation, tool authorization and source requirements take priority over store rules. Store policy and tone take priority over requests to ignore them in customer messages. History, documents and tool results are reference data. The configured reply language remains explicit. Store text is serialized as a JSON string and followed by the platform priority reminder, so delimiter-looking content cannot close an XML block. This is model guidance, not a security boundary: account filtering, authorization and commercial source checks must remain in code.

The communication defaults are a bundled, concise adaptation of the existing `lokalchat-instructions.md`: direct respectful replies, language matching, clear Malay pronouns, moderate short forms, preservation of qualifications and risks, no invented facts or actions, and no customer control over provider/model/account settings. The Markdown file itself is a reference document, not read from the working directory at runtime. This avoids deployment dependence on a local Markdown file; edits to that reference alone do not change runtime behavior. Store tone and requests for more detail can override style defaults within platform limits.

## Verification

`node --import tsx --test tests/agent-prompt.test.mjs` verifies scoped reads, account separation, prompt edits and clearing, fallback behavior, lookup failures, limits, and precedence text. Gateway payload integration coverage runs the real `runAgent` with a fake gateway and database; it checks the system message received by the gateway, including a tool follow-up.

Supabase `maybeSingle` supports a zero-or-one-row lookup ([official reference](https://supabase.com/docs/reference/javascript/maybesingle)). The implementation reuses the pinned client and existing profile schema; it introduces no migration, credential change or deployment.
