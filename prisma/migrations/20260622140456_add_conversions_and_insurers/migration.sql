-- CreateEnum
CREATE TYPE "ConversionOutcome" AS ENUM ('WON', 'LOST');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('NEW_BUSINESS', 'RENEWAL');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('WENT_DIRECT', 'PRICE', 'INCUMBENT_BROKER', 'NO_APPETITE', 'CUSTOMER_WITHDREW', 'OTHER');

-- CreateTable
CREATE TABLE "insurers" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversions" (
    "id" TEXT NOT NULL,
    "broker_user_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "ghl_contact_id" TEXT,
    "ghl_opportunity_id" TEXT,
    "client_name" TEXT NOT NULL,
    "outcome" "ConversionOutcome" NOT NULL,
    "business_type" "BusinessType",
    "insurance_category_id" TEXT,
    "insurer_id" TEXT,
    "policies_bound" INTEGER NOT NULL DEFAULT 1,
    "annual_premium" DECIMAL(12,2),
    "inception_date" TIMESTAMP(3),
    "broker_fee" DECIMAL(12,2),
    "premium_funded" BOOLEAN NOT NULL DEFAULT false,
    "funder" TEXT,
    "funding_commission" DECIMAL(12,2),
    "base_commission_pct" DECIMAL(5,2),
    "est_brokerage" DECIMAL(12,2),
    "lost_reason" "LostReason",
    "competitor" TEXT,
    "notes" TEXT,
    "ghl_writeback_status" INTEGER,
    "submit_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insurers_label_key" ON "insurers"("label");

-- CreateIndex
CREATE UNIQUE INDEX "conversions_submit_token_key" ON "conversions"("submit_token");

-- CreateIndex
CREATE INDEX "conversions_broker_user_id_idx" ON "conversions"("broker_user_id");

-- CreateIndex
CREATE INDEX "conversions_created_at_idx" ON "conversions"("created_at");

-- CreateIndex
CREATE INDEX "conversions_outcome_idx" ON "conversions"("outcome");

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_broker_user_id_fkey" FOREIGN KEY ("broker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_insurance_category_id_fkey" FOREIGN KEY ("insurance_category_id") REFERENCES "insurance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_insurer_id_fkey" FOREIGN KEY ("insurer_id") REFERENCES "insurers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

