-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('MERCADO_LIVRE', 'AMAZON', 'SHOPEE');

-- CreateEnum
CREATE TYPE "ProductSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "source" "ProductSource" NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "rating" DOUBLE PRECISION,
    "reviews" INTEGER,
    "image" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "category" TEXT,
    "seller" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_marketplace_productId_key" ON "Product"("marketplace", "productId");
