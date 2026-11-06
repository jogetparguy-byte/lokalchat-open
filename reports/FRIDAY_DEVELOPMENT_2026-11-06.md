# Friday development — 6 November 2026

Scope: the Friday portion of the approved 6–8 November development plan (LOKA-12).
Baseline: `main` at `6589a8e9013a27e8bf7e3e773f9de6c3418a7e05`.
Implementation branch: `fix/loka-12-friday-security`.

## Completed checklist

- [x] Clean dependency installation using the committed lockfile.
- [x] Re-run baseline unit tests, TypeScript check and production build.
- [x] Pin outbound inventory and AI requests to a validated address.
- [x] Resolve and validate all A/AAAA answers; reject internal and special addresses.
- [x] Preserve TLS hostname verification and reject redirects.
- [x] Bound DOCX decompression, processing time, extracted text and chunk construction.
- [x] Add regressions for DNS rebinding, IPv6/private addresses, archive bombs and valid documents.
- [x] Re-run full verification after changes and smoke-test the production DOCX worker.

No agents were hired or delegated work. No dependency version or lockfile changes.

## Changes

### SSRF

`src/lib/ssrf.server.ts` resolves the configured hostname with Node's system resolver
(all A/AAAA results), validates every returned IP, and provides `publicHttpFetch`.
Its per-request HTTP(S) socket uses a custom lookup callback returning the approved
address. It never performs a second hostname resolution during connection and does
not reuse pooled sockets. The original hostname remains in the URL, preserving the
HTTP Host header, TLS SNI and certificate checks. IPv4 and IPv6 literals receive
the same address validation. Credentials in URLs are rejected.

Both inventory lookup and AI chat completion in `agent.server.ts` use this path,
including predefined AI providers. Save-time validation remains in place.
Redirects fail closed. DNS has a five-second deadline; the connected request has
an eight-second inventory or thirty-second AI deadline, including body reads.
Inventory bodies are capped at 64 KiB; AI bodies at 2 MiB, counting received bytes
rather than trusting Content-Length. Responses are buffered and uncompressed.

Only global-unicast IPv6 is accepted, with conservative exclusions for special,
documentation and transition ranges. Endpoints with a mix of public and private
answers are rejected. Only the first approved address is attempted; there is no
fallback to another address on connection failure.

### DOCX and chunking

`docx-worker.server.ts` reads only `word/document.xml`; unrelated archive members
are never inflated. ZIP central-directory and local-header bounds are checked.
ZIP64, multidisk archives, encrypted members, duplicate document XML and unsupported
compression methods are rejected. Ordinary stored/deflated ZIP members and data
descriptors are supported.

Limits:

| Resource | Limit |
| --- | --- |
| Compressed document input | 10 MiB |
| ZIP directory entries | 1,000 |
| Sum of declared expanded member sizes | 20 MiB |
| Actual expanded document XML | 2 MiB |
| Worker processing, including XML extraction | 5 seconds |
| Worker V8 old/young generations | 64 / 16 MiB |
| Extracted text | 160,000 UTF-16 code units |
| Chunk construction | At most 200 chunks |

`inflateRawSync` uses `maxOutputLength`, so forged ZIP length metadata cannot bypass
the actual XML output cap. V8 heap limits alone do not bound Buffer allocations;
input and decompression caps provide those bounds. XML stripping and entity
replacement run inside the worker. The worker is terminated on completion, error
or timeout. Main-thread chunking validates its size/overlap arguments and stops
at the chunk limit instead of constructing an unbounded array then slicing it.

## Verification

Clean source snapshots were taken from the baseline commit. They used identical
locked dependencies. Baseline files and the unrelated pre-existing changes in
`/tmp/lokalchat-open` were left untouched. Verification ran with Node v24.22.2.

| Check | Baseline | Final changes |
| --- | --- | --- |
| `npm test` | 109 passed, 0 failed | 115 passed, 0 failed |
| `npm run typecheck` | Passed | Passed |
| `npm run build` | Passed | Passed |
| Production bundle DOCX smoke | Not applicable | Valid DOCX extracted; bomb rejected |

Clean install: `npm ci --offline --no-audit --no-fund` completed successfully
(428 packages) after populating the cache from the npm registry with the locked
versions. An earlier sandboxed attempt hit esbuild binary execution restrictions;
the permitted retry completed. npm reports deprecated upstream packages and
install-script allowlist notices. Build retains upstream `use client` directive
warnings. Neither required changing the lockfile.

The six new regression groups cover:

1. Private, metadata, reserved, mapped and public IPv4/IPv6 classifications.
2. Alternate IP URL forms, trailing-dot localhost, mixed DNS answers, empty DNS,
   unsupported protocols and URL credentials.
3. A DNS change from a public to a private answer: only one resolution occurs;
   the actual request's lookup remains pinned. Both Node lookup callback forms,
   original TLS hostname, no pooling, redirect denial, body cap and timeout are
   checked with a controlled transport mock.
4. Valid compressed/stored DOCX files, text extraction and normal chunking.
5. Compressed XML bombs, forged expanded lengths, malformed ZIP, missing XML and
   worker timeout.
6. Input/text size caps, oversized DOCX text and invalid chunk parameters.

The existing reply-language test now stubs `publicHttpFetch` at the outbound
boundary and continues checking the real prompt and saved owner configuration.

Reproduce: `npm ci`, `npm test`, `npm run typecheck`, `npm run build`.
The security groups also run independently with `npm run test:security`.
Production smoke imported the generated `.output/server/_ssr/kb-extract.server-*.mjs`
module and tested a normal DOCX plus a compressed XML bomb.

## Limits and remaining approved weekend work

Friday's controlled regressions pass. This is not a production-release sign-off.
No live WhatsApp/AI provider transaction or tenant RLS/Storage staging test was
performed. Those remain Saturday's scope, together with logging, webhook and
security-header hardening. PDF parsing has the input and extracted-text limits,
but does not gain the DOCX worker's timeout or decompression isolation here.
Sunday's browser, installer and release-readiness work remains unchanged.

The branch is prepared for code review; it has not been merged or deployed.
