# Work in progress: recovered Venmo implementation

This branch is a reconstruction after the unpushed local candidate workspace was lost. It is not the previously tested artifact, not approved for promotion, and not a completed release. Prior test counts do not establish this candidate's correctness.

Checkout stays off until the operational readiness gates pass; it is not hard-disabled in code. Preview builds must never migrate databases. The production build guard refuses unbaselined history. No provider payment, live checkout enablement, or customer email is authorized by documentation alone. Vercel cron delivers queued email and expires unpaid orders only after `CRON_SECRET` and SMTP are configured.

Fresh independent verification is recorded in PRODUCTION-READINESS.md. Schema reconciliation review and exact release approval remain required before main promotion. Existing main design and all product artwork are preserved.
