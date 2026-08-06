-- CreateTable
CREATE TABLE "AmazonSession" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cookieHeader" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonSession_pkey" PRIMARY KEY ("id")
);
