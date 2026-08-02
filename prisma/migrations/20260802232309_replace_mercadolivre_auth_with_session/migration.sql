-- DropTable
DROP TABLE "MercadoLivreAuth";

-- CreateTable
CREATE TABLE "MercadoLivreSession" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cookieHeader" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercadoLivreGeneratedLink" (
    "id" TEXT NOT NULL,
    "mlItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "affiliateLink" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MercadoLivreGeneratedLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MercadoLivreGeneratedLink_mlItemId_generatedAt_idx" ON "MercadoLivreGeneratedLink"("mlItemId", "generatedAt");
