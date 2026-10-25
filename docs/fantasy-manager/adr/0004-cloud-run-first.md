# Cloud Run first for the initial workload

Deploy the initial application on GCP Cloud Run through Alchemy, targeting one user and five fantasy teams. Accept scale-to-zero cold starts and optimize startup; do not buy always-warm capacity or add keep-warm traffic by default.

Cloudflare was considered for cold-start behavior, but a paid compute baseline is not preferred at the initial scale and Workers Free's CPU limits have not been shown to fit the application. Reconsider Cloudflare if usage expands; do not build a second hosting implementation now. Database placement and public/background service topology remain separate decisions. Infrastructure deployment is not yet authorized.
