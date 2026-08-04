-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "deliveryState" "DeliveryState" NOT NULL DEFAULT 'SENT',
ADD COLUMN     "errorMessage" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "mcpInboxAccess" BOOLEAN NOT NULL DEFAULT false;
