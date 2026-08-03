-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('AUDIENCE', 'CORRESPONDENT');

-- CreateEnum
CREATE TYPE "LifecycleStage" AS ENUM ('AWARE', 'ENGAGED', 'ACTIVATED', 'LOYAL', 'AT_RISK', 'CHURNED');

-- CreateTable
CREATE TABLE "ModelProviderKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "keyPreview" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastChecked" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelProviderKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL DEFAULT 'AUDIENCE',
    "profileName" TEXT,
    "profileEmail" TEXT,
    "profileSocialHandle" TEXT,
    "profileSourceChannel" TEXT,
    "profileTags" TEXT[],
    "personaContentDNA" JSONB,
    "personaSentimentArc" JSONB,
    "personaIntentVector" DOUBLE PRECISION[],
    "stateLifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'AWARE',
    "stateRiskScore" INTEGER,
    "stateOpportunityScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelProviderKey_workspaceId_isActive_idx" ON "ModelProviderKey"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_workspaceId_revokedAt_idx" ON "ApiToken"("workspaceId", "revokedAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_stateLifecycleStage_idx" ON "Contact"("workspaceId", "stateLifecycleStage");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_updatedAt_idx" ON "Contact"("workspaceId", "updatedAt");

-- AddForeignKey
ALTER TABLE "ModelProviderKey" ADD CONSTRAINT "ModelProviderKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
