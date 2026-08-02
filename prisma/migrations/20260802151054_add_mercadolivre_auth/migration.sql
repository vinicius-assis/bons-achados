-- CreateTable
CREATE TABLE "MercadoLivreAuth" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MercadoLivreAuth_pkey" PRIMARY KEY ("id")
);
