-- CreateTable
CREATE TABLE "AmazonWebSession" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cookieHeader" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmazonWebSession_pkey" PRIMARY KEY ("id")
);
