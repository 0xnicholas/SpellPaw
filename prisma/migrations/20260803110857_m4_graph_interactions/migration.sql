-- CreateEnum
CREATE TYPE "TouchAction" AS ENUM ('CLICK', 'LIKE', 'SHARE');

-- CreateEnum
CREATE TYPE "ConvDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('REGISTER', 'SUBSCRIBE', 'UPGRADE', 'LOGIN');

-- CreateTable
CREATE TABLE "ShortLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTouch" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "postId" TEXT NOT NULL,
    "variantId" TEXT,
    "action" "TouchAction" NOT NULL DEFAULT 'CLICK',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "direction" "ConvDirection" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "eventType" "EventType" NOT NULL,
    "externalSource" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShortLink_code_key" ON "ShortLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShortLink_variantId_key" ON "ShortLink"("variantId");

-- CreateIndex
CREATE INDEX "ShortLink_workspaceId_createdAt_idx" ON "ShortLink"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentTouch_contactId_timestamp_idx" ON "ContentTouch"("contactId", "timestamp");

-- CreateIndex
CREATE INDEX "ContentTouch_postId_timestamp_idx" ON "ContentTouch"("postId", "timestamp");
CREATE INDEX "ContentTouch_variantId_timestamp_idx" ON "ContentTouch"("variantId", "timestamp");

-- CreateIndex
CREATE INDEX "Conversation_contactId_timestamp_idx" ON "Conversation"("contactId", "timestamp");

-- CreateIndex
CREATE INDEX "Event_contactId_timestamp_idx" ON "Event"("contactId", "timestamp");

-- AddForeignKey
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PostVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTouch" ADD CONSTRAINT "ContentTouch_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTouch" ADD CONSTRAINT "ContentTouch_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- contact_timeline VIEW (spec §1): merged Interaction timeline across the
-- three partitioned tables. Idempotent — applied by `prisma migrate` in
-- production and by tests/integration/setup.ts after `db push`.
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
