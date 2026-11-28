-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "token_digest" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_digest_key" ON "sessions"("token_digest");
