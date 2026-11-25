/*
  Warnings:

  - You are about to drop the column `content_key` on the `historical_order_items` table. All the data in the column will be lost.
  - You are about to drop the column `occurrence` on the `historical_order_items` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[order_number,product_code]` on the table `historical_order_items` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[title_id]` on the table `historical_receivables` will be added. If there are existing duplicate values, this will fail.
  - Made the column `product_code` on table `historical_order_items` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "historical_order_items_content_key_occurrence_key";

-- DropIndex
DROP INDEX "historical_receivables_title_id_status_key";

-- AlterTable
ALTER TABLE "historical_order_items" DROP COLUMN "content_key",
DROP COLUMN "occurrence",
ALTER COLUMN "product_code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "historical_order_items_order_number_product_code_key" ON "historical_order_items"("order_number", "product_code");

-- CreateIndex
CREATE UNIQUE INDEX "historical_receivables_title_id_key" ON "historical_receivables"("title_id");
