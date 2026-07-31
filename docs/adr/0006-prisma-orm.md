# Prisma as ORM

Database access uses Prisma ORM, not Drizzle or raw SQL.

**Why**: Prisma provides a typed schema-first workflow that maps naturally to the Contact-Post-Interaction entity model defined in the Customer Graph. Its migration system, relation queries, and TypeScript integration reduce the boilerplate of hand-writing JOINs across the interaction timeline. pgvector support (native in Prisma since v5) covers embedding storage for Persona derivation without an additional vector database. Drizzle was considered but rejected because its migration tooling and relation API are less mature for the entity-heavy read patterns the Customer Graph requires. Raw SQL was rejected because the risk of untyped query drift across a 3-phase product evolution outweighs the performance gain.

**Consequence**: The Prisma schema acts as the canonical source of truth for the data model. Any change to the Customer Graph entity structure must go through a Prisma migration.
