-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "lastInteractionAt" TIMESTAMP(3),
ADD COLUMN     "personaDirtyAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_lastInteractionAt_idx" ON "Contact"("workspaceId", "lastInteractionAt");

-- CreateIndex
CREATE INDEX "Contact_personaDirtyAt_idx" ON "Contact"("personaDirtyAt");
