-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "submit_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "submissions_submit_token_key" ON "submissions"("submit_token");
