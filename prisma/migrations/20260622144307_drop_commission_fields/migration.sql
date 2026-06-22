-- AlterTable
ALTER TABLE "insurers" DROP COLUMN "default_commission_pct";

-- AlterTable
ALTER TABLE "conversions" DROP COLUMN "base_commission_pct",
DROP COLUMN "est_brokerage",
DROP COLUMN "funder",
DROP COLUMN "funding_commission",
DROP COLUMN "premium_funded";

