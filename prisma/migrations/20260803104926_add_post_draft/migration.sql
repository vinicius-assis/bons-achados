-- CreateTable
CREATE TABLE "PostDraft" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "source" "ProductSource" NOT NULL,
    "title" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "PostDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostDraft_affiliateLink_createdAt_idx" ON "PostDraft"("affiliateLink", "createdAt");
