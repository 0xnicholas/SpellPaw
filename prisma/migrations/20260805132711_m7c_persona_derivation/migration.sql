-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "personaIntent" JSONB;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "personaDerivationEnabled" BOOLEAN NOT NULL DEFAULT false;
