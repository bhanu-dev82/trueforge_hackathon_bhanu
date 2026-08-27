# Gemini errors and how this repo routes them

Sources:

- https://ai.google.dev/gemini-api/docs/rate-limits (codes, dimensions, Pacific RPD reset)
- https://ai.google.dev/gemini-api/docs/api-errors (`rate_limit_exceeded`, `quota_exceeded`, …)
- **This project’s AI Studio dashboard**, Free tier, “Default Gemini Project”, 2026-08-27 (RPM / TPM / RPD)

Google does not publish a public free-tier table. The numbers below are this project’s live dashboard. Quotas are **per project**, not per API key. RPD resets at **midnight Pacific**. Free-tier spend cap is N/A.

## Text models we actually route

| Dashboard name | model id | RPM | TPM | RPD | Role |
|---|---|---|---|---|---|
| Gemini 3.1 Flash Lite | `gemini-3.1-flash-lite` | 15 | 250K | **500** | Primary |
| Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite` | 15 | 250K | **500** | Failover |
| Gemma 4 26B | `gemma-4-26b` | 30 | 16K | **14.4K** | Last resort (tiny TPM) |
| Gemini 3.7 Flash | `gemini-3.7-flash` | 5 | 250K | **20** | Deep only — never default failover |
| Gemini 2.5 Flash Lite | `gemini-2.5-flash-lite` | 10 | 250K | **20** | Unused (not a 500-RPD cousin) |

`gemini-2.5-flash-lite` is **20 RPD**, not 500. Do not put it on the failover chain expecting flash-lite headroom.

Gemma 4 26B is the only SKU here with four-digit daily room. Its 16K TPM means a fat CI log may 429 on tokens — that is why it is last.

## Error codes (`error.code`)

| code | HTTP | This repo |
|---|---|---|
| `rate_limit_exceeded` / `too_many_requests` | 429 RPM | retry same model, then **new TrueForge session** |
| `quota_exceeded` | 429 RPD | mark exhausted, new session on next SKU |
| `RESOURCE_EXHAUSTED` | 429 | inspect message for per-minute vs per-day |
| `service_unavailable` / `api_error` / `deadline_exceeded` | 503/500/504 | retry same model |

Never swap models mid-session (KV cache). Failover always opens a new session.
