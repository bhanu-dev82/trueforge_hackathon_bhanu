# Provider routing and quota behavior

Model availability and quota are account- and runtime-specific. This repository therefore treats the running TrueForge model catalog as authoritative and drops configured IDs that are unavailable. The IDs in `.env.example` are development examples, not guaranteed public SKUs or quota claims.

Before a TrueForge-enhanced demo:

1. Start TrueForge.
2. Confirm the desired models in its live catalog/settings.
3. Put those exact IDs in `MODEL_NAME`, `MODEL_DEEP`, and `MODEL_FAILOVER_CHAIN`.
4. Check `GET /api/health`; only claim the displayed active model.

## Routing contract

TrueForge binds a model when a session is created. The router does not swap a model inside an existing session:

- transient rate/service failures retry the same model with bounded backoff;
- exhausted quota marks that model unavailable for the run;
- failover opens a new TrueForge session on the next catalog-confirmed model;
- cumulative token accounting spans failover sessions;
- if no configured model is available, the enhanced run fails explicitly rather than inventing activity.

Provider error classifications include `rate_limit_exceeded`, `too_many_requests`, `quota_exceeded`, `RESOURCE_EXHAUSTED`, `service_unavailable`, `api_error`, and `deadline_exceeded`. Consult the provider dashboard and documentation for current limits; do not copy historical numbers into judge-facing claims.

The credential-free LOCAL-ONLY path does not invoke a model and makes no quota claim.
