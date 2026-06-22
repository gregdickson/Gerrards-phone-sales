-- DropForeignKey
ALTER TABLE "conversions" DROP CONSTRAINT "conversions_broker_user_id_fkey";

-- AlterTable
ALTER TABLE "conversions" ADD COLUMN     "ghl_assigned_to" TEXT,
ADD COLUMN     "ghl_lost_reason_id" TEXT,
ADD COLUMN     "lost_at" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'FORM',
ALTER COLUMN "broker_user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ghl_lost_reasons" (
    "id" TEXT NOT NULL,
    "ghl_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ghl_lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ghl_lost_reasons_ghl_id_key" ON "ghl_lost_reasons"("ghl_id");

-- CreateIndex
CREATE INDEX "conversions_ghl_opportunity_id_idx" ON "conversions"("ghl_opportunity_id");

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_broker_user_id_fkey" FOREIGN KEY ("broker_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

