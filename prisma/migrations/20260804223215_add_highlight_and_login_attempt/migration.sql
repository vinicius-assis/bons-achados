-- CreateTable
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "title" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Highlight_createdAt_idx" ON "Highlight"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_ip_windowStart_key" ON "LoginAttempt"("ip", "windowStart");
