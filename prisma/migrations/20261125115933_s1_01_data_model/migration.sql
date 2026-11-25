-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SELLER', 'MANAGER', 'FINANCE', 'ADMIN');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'INACTIVE', 'PROSPECT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT_TO_ERP', 'SEND_ERROR', 'CREDIT_BLOCKED', 'AWAITING_FINANCE', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('PAID', 'OPEN', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SyncKind" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncResult" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "HistoricalItemStatus" AS ENUM ('INVOICED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HistoricalReceivableStatus" AS ENUM ('PAID', 'OPEN', 'OVERDUE', 'REVERSED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "erp_seller_name" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "erp_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL,
    "credit_limit_cents" INTEGER NOT NULL,
    "erp_seller_name" TEXT,
    "seller_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "erp_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "list_price_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "erp_id" INTEGER NOT NULL,
    "customer_id" TEXT NOT NULL,
    "erp_order_number" INTEGER NOT NULL,
    "installment" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "status" "ReceivableStatus" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "kind" "SyncKind" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "result" "SyncResult",
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_changed" INTEGER NOT NULL DEFAULT 0,
    "error_detail" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "total_cents" INTEGER NOT NULL,
    "erp_order_number" INTEGER,
    "send_key" TEXT NOT NULL,
    "justification" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "notice_days" INTEGER NOT NULL,
    "auto_renew" BOOLEAN NOT NULL,
    "payment_terms" TEXT NOT NULL,
    "min_volume_cents" INTEGER NOT NULL,
    "has_amendment" BOOLEAN NOT NULL DEFAULT false,
    "file" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_order_items" (
    "id" TEXT NOT NULL,
    "content_key" TEXT NOT NULL,
    "occurrence" INTEGER NOT NULL DEFAULT 1,
    "order_number" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "customer_code" TEXT NOT NULL,
    "seller_name" TEXT NOT NULL,
    "product_code" TEXT,
    "description" TEXT,
    "unit" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "status" "HistoricalItemStatus" NOT NULL,
    "source_row" INTEGER,
    "corrections" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_receivables" (
    "id" TEXT NOT NULL,
    "title_id" INTEGER NOT NULL,
    "customer_code" TEXT NOT NULL,
    "order_number" INTEGER NOT NULL,
    "installment" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "status" "HistoricalReceivableStatus" NOT NULL,
    "corrections" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_issues" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "field" TEXT,
    "problem_type" TEXT NOT NULL,
    "raw_value" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_erp_seller_name_key" ON "users"("erp_seller_name");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_erp_id_key" ON "customers"("erp_id");

-- CreateIndex
CREATE INDEX "customers_cnpj_idx" ON "customers"("cnpj");

-- CreateIndex
CREATE INDEX "customers_seller_id_idx" ON "customers"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_erp_id_key" ON "products"("erp_id");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_erp_id_key" ON "receivables"("erp_id");

-- CreateIndex
CREATE INDEX "receivables_customer_id_idx" ON "receivables"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_send_key_key" ON "orders"("send_key");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "orders_seller_id_idx" ON "orders"("seller_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_number_key" ON "contracts"("number");

-- CreateIndex
CREATE INDEX "contracts_customer_id_idx" ON "contracts"("customer_id");

-- CreateIndex
CREATE INDEX "historical_order_items_order_number_idx" ON "historical_order_items"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "historical_order_items_content_key_occurrence_key" ON "historical_order_items"("content_key", "occurrence");

-- CreateIndex
CREATE INDEX "historical_receivables_customer_code_idx" ON "historical_receivables"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "historical_receivables_title_id_status_key" ON "historical_receivables"("title_id", "status");

-- CreateIndex
CREATE INDEX "load_issues_run_id_idx" ON "load_issues"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "load_issues_source_file_row_number_problem_type_key" ON "load_issues"("source_file", "row_number", "problem_type");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
