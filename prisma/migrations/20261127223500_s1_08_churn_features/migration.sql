-- CreateTable
CREATE TABLE "churn_features" (
    "id" TEXT NOT NULL,
    "customer_code" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "orders_last_3m" INTEGER NOT NULL,
    "revenue_last_3m_cents" INTEGER NOT NULL,
    "revenue_prev_3m_cents" INTEGER NOT NULL,
    "days_since_last_order" INTEGER,
    "overdue_receivables" INTEGER NOT NULL,
    "segment" TEXT NOT NULL,
    "churned_90d" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "churn_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "churn_features_month_idx" ON "churn_features"("month");

-- CreateIndex
CREATE UNIQUE INDEX "churn_features_customer_code_month_key" ON "churn_features"("customer_code", "month");
