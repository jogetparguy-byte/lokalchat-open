# Supabase MCP Connector

The connector authenticates the current local LokalChat account with the hosted Supabase MCP server using dynamic client registration and OAuth authorization code flow with PKCE S256.

`POST /api/supabase/mcp` starts authorization. Send a same-origin JSON request with the local session cookie. The response contains only `authorizationUrl`; navigate the browser to that URL. Supabase returns to `GET /api/supabase/mcp` on the same origin. HTTPS is required except on localhost.

The callback validates the account session, state, expiry and callback origin, consumes the pending flow once, exchanges the code on the server and initializes MCP before saving the connection. It returns to `/dashboard/settings?supabase_mcp=connected#supabase`, or `cancelled` / `failed` on an unsuccessful attempt.

`GET /api/supabase/mcp` without callback parameters returns `connected` and `needsReconnect`. It refreshes tokens near expiry. Credentials and pending flows are stored in the existing per-user settings file with mode `0600`. Values are base64url encoded for serialization; this is not encryption. They never appear in status responses or browser storage.

This connection grants MCP access to the Supabase organization selected during consent. It does not activate LokalChat's chat, knowledge base or WhatsApp data runtime. Those still require backend identity mapping and RLS integration.

Verification: `node --import tsx --test tests/supabase-mcp.test.mjs`. Tests cover account isolation, PKCE, CSRF, callback replay, cancellation, MCP initialization failure, JSON/SSE responses, private storage, token refresh and logout.

References: [Supabase MCP authentication](https://supabase.com/docs/guides/ai-tools/mcp), [OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration).
