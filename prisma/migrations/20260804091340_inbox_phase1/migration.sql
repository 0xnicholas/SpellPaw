/*
  Warnings:

  - You are about to drop the column `messageId` on the `Conversation` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[externalId]` on the table `Conversation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `channelId` to the `Conversation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `content` to the `Conversation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `externalId` to the `Conversation` table without a default value. This is not possible if the table is not empty.

*/
-- contact_timeline VIEW depends on Conversation.messageId — drop before the column change, recreate below
DROP VIEW IF EXISTS contact_timeline;

-- AlterEnum (guarded: an earlier failed run may have leaked the label)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'EventType' AND e.enumlabel = 'MANUAL_ACTIVATION'
  ) THEN
    ALTER TYPE "EventType" ADD VALUE 'MANUAL_ACTIVATION';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "messageId",
ADD COLUMN     "channelId" TEXT NOT NULL,
ADD COLUMN     "content" TEXT NOT NULL,
ADD COLUMN     "externalId" TEXT NOT NULL,
ADD COLUMN     "postId" TEXT;

-- CreateTable
CREATE TABLE "InboxReadState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboxReadState_contactId_channelId_key" ON "InboxReadState"("contactId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_externalId_key" ON "Conversation"("externalId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_channelId_timestamp_idx" ON "Conversation"("workspaceId", "channelId", "timestamp");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxReadState" ADD CONSTRAINT "InboxReadState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxReadState" ADD CONSTRAINT "InboxReadState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxReadState" ADD CONSTRAINT "InboxReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Recreate contact_timeline VIEW with the renamed payload column (messageId -> externalId)
CREATE OR REPLACE VIEW contact_timeline AS
  SELECT "id", "contactId", 'CONTENT_TOUCH' AS "type", "timestamp",
         jsonb_build_object('postId', "postId", 'action', "action") AS "payload"
  FROM "ContentTouch"
  UNION ALL
  SELECT "id", "contactId", 'CONVERSATION' AS "type", "timestamp",
         jsonb_build_object('externalId', "externalId", 'direction', "direction") AS "payload"
  FROM "Conversation"
  UNION ALL
  SELECT "id", "contactId", 'EVENT' AS "type", "timestamp",
         jsonb_build_object('eventType', "eventType") AS "payload"
  FROM "Event";
