# Commercial facts at runtime (GAP-005)

`runAgent` checks both the incoming message and the complete proposed response before persisting any answer. Detected prices, promotions, discounts, delivery charges and availability require fresh, account-scoped evidence. This check runs even when the model skips tools, returns plain text, emits a multipart response, follows a hostile customer message, or follows a store prompt claiming a different price.

The model's commercial prose is replaced with deterministic text rendered from validated evidence. Unsupported or ambiguous evidence triggers the existing generation/token-checked human handoff. The unsupported text never enters the outbound batch. This preserves GAP-003 cancellation and handoff rules. Noncommercial conversation retains the existing model/tool flow.

## Owner setup using the existing FAQ form

Use the existing Knowledge Base FAQ form. Set a question such as `Harga Kopi A`. Paste JSON into the answer field:

```json
{
  "type": "commercial_facts",
  "product": "Kopi A",
  "verified_at": "2026-11-17T12:00:00Z",
  "valid_until": "2026-11-18T12:00:00Z",
  "price": { "currency": "MYR", "amount": 100 },
  "promotion": {
    "discount_percent": 10,
    "valid_from": "2026-11-17T12:00:00Z",
    "valid_until": "2026-11-18T12:00:00Z"
  }
}
```

Replace these example timestamps and values with verified current data. Dates require an explicit time zone. Never extend validity without checking the source. A record's verification must be no more than 30 days old, must not be in the future, and its validity must not have expired. Promotions require their own start and expiry dates. The runtime renders only the listed base price and discount; it does not calculate a final checkout total, delivery charge, discount stacking or other terms. Such requests can be passed to the owner.

The existing `saveFaq` handler stores `Soalan: ...\nJawapan: ...`; the parser accepts exactly that wrapper followed by a JSON answer. A plain JSON knowledge-base row also works. Arbitrary prose around JSON, Markdown fences, unstructured commercial FAQ prose, model replies, past conversation and customer-supplied JSON are not accepted as commercial evidence. Existing prose FAQ remains usable for noncommercial topics.

The customer's current message must name the canonical product, for example `Kopi A harga?`. Labels match case-insensitively with punctuation normalized. Ambiguous shorthand such as `ni berapa?` goes to the owner. Product labels are limited to 200 characters using letters, numbers, spaces and common product punctuation. Prices must be finite MYR amounts, nonnegative, no more than RM1,000,000, with at most two decimal places. Discounts must be finite percentages greater than zero and at most 100.

Two different records matching the requested product fail closed, including an old record conflicting with a new one. Delete the old FAQ record when replacing it. Exact duplicate JSON is tolerated. At most 100 structured commercial rows are supported per account; a larger result fails closed rather than silently miss a conflicting row. Lookup failure or foreign-account rows cannot supply evidence.

## Inventory contract

Stock requires a matching valid `commercial_facts` record to establish the product identity. Configure the existing profile inventory URL to return JSON for `?product=Kopi+A`:

```json
{ "product": "Kopi A", "stock": 8, "updated_at": "2026-11-17T12:00:00Z" }
```

The returned product must match the requested canonical product. Quantity must be a nonnegative safe integer. `updated_at` must have an explicit time zone, be no more than five minutes old and not be in the future. Wrong product, stale timestamps, malformed JSON, API failure and missing configuration cause handoff. The SSRF-guarded fetch enforces timeout and a 64 KiB body limit. `check_stock` and the final output gate share `readCommercialInventory`; there is one transport/validation implementation. The final gate fetches again rather than trust an earlier model tool result.

## Scope and limits

Detection uses a documented conservative Malay/English/Manglish vocabulary rather than a semantic truth oracle. It covers `harga`, `berapa`, `brp`, `bape`, `RM100`, MYR/USD/SGD markers, `discount`, `diskaun`, `promo`, `%`, `free`, `percuma`, `offer`, `clearance`, `stock`, `stok`, `available` and related phrases. Short `yang ni?`/`this?` follow-ups inherit commercial categories from history and fail safely if the current product is unclear. Novel euphemisms, other languages, bare numbers without a commercial cue and spelling obfuscation can evade detection. Broad terms such as `available` can classify a noncommercial question as commercial and cause an unnecessary handoff. This is a known availability tradeoff.

Owner-entered facts remain the trust boundary. A valid timestamp is an owner's assertion of verification, not proof that a real-world price or stock count is correct. Source timestamps, product identity and conflicts are checked in code; supplier truth cannot be inferred from the database. This change requires owner setup and runtime activation. It does not claim live WhatsApp/provider verification.

## Verification

Run `node --import tsx --test tests/commercial-grounding.test.mjs`. Tests include actual `runAgent` gateway output and persistence, account filtering, supported facts, missing evidence, failed lookup, stale/future data, conflicting records, wrong product, invalid amounts, expired promotions, API failures, customer-forged facts, malicious store instructions and multipart output bypass attempts.

The vocabulary fixture has eight expected commercial examples and five expected noncommercial examples across Malay, English and Manglish: zero false positives and zero false negatives within that bounded fixture. It is not a production accuracy estimate. Known potential false positives and negatives are listed above. Prompt transport/isolation is covered separately by `tests/agent-prompt.test.mjs`; delivery ordering and handoff fencing remain covered by the existing multi-response and chat-turn suites.
