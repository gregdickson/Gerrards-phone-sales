-- CreateTable
CREATE TABLE "broker_earnings" (
    "id" TEXT NOT NULL,
    "tran_number" TEXT NOT NULL,
    "broker_name" TEXT NOT NULL,
    "broker_user_id" TEXT,
    "tran_date" TIMESTAMP(3) NOT NULL,
    "effective_date" TIMESTAMP(3),
    "client_name" TEXT,
    "tran_type" TEXT NOT NULL,
    "invoice_amount" DECIMAL(14,2),
    "broker_fee" DECIMAL(14,2),
    "broker_commission" DECIMAL(14,2),
    "gross_broker_income" DECIMAL(14,2),
    "net_broker_income" DECIMAL(14,2),
    "source_file" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "broker_earnings_tran_number_key" ON "broker_earnings"("tran_number");

-- CreateIndex
CREATE INDEX "broker_earnings_broker_name_idx" ON "broker_earnings"("broker_name");

-- CreateIndex
CREATE INDEX "broker_earnings_tran_date_idx" ON "broker_earnings"("tran_date");

-- CreateIndex
CREATE INDEX "broker_earnings_tran_type_idx" ON "broker_earnings"("tran_type");

