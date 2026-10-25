# Neon Free PostgreSQL with Cloud Run

Use a fresh independently owned Neon Free PostgreSQL project alongside Cloud Run. The initial workload is one user and five fantasy teams, and the requirement is to fit recurring free allowances rather than rely on temporary credits or select the cheapest paid baseline.

Cloud SQL has no ongoing free PostgreSQL instance allowance. Neon retains the starter's Postgres implementation and supports automatic suspension/resumption without database start/stop orchestration. Verify compute, storage, transfer, email, and auxiliary service quotas; free database selection does not guarantee the entire stack costs zero at every usage level. Never reuse the starter's live database or credentials.
