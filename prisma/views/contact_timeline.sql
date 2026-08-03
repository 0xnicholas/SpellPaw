-- contact_timeline VIEW (spec §1): merged Interaction timeline across the
-- three partitioned tables. Idempotent — applied by `prisma migrate` in
-- production and by tests/integration/setup.ts after `db push`.
--
-- Note: Prisma creates tables/columns with quoted camelCase names, so every
-- identifier below is quoted (unquoted names fold to lowercase in Postgres).
CREATE OR REPLACE VIEW contact_timeline AS
  SELECT "id", "contactId", 'CONTENT_TOUCH' AS "type", "timestamp",
         jsonb_build_object('postId', "postId", 'action', "action") AS "payload"
  FROM "ContentTouch"
  UNION ALL
  SELECT "id", "contactId", 'CONVERSATION' AS "type", "timestamp",
         jsonb_build_object('messageId', "messageId", 'direction', "direction") AS "payload"
  FROM "Conversation"
  UNION ALL
  SELECT "id", "contactId", 'EVENT' AS "type", "timestamp",
         jsonb_build_object('eventType', "eventType") AS "payload"
  FROM "Event";
