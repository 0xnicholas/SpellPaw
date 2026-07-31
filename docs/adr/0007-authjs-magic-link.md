# Auth.js with email magic link for authentication

Authentication uses Auth.js (NextAuth v5) with a single provider: email magic link. No password-based or social OAuth login in Phase 1.

**Why**: Phase 1 has no team features — every user is a single account holder. Password storage introduces security surface area (hashing, reset flows, breach handling) that magic links eliminate entirely. Auth.js integrates natively with Next.js App Router, provides session management and CSRF protection out of the box, and has zero per-user cost (unlike Clerk, which charges per monthly active user). Magic link is also the lowest-friction signup flow: enter email, click the link in your inbox, done.

**Considered alternatives**: Clerk was rejected because per-MAU pricing would create a cost floor before the product generates any revenue. Custom email/password was rejected because building password reset flows and secure credential storage is not a differentiator worth the implementation time.
