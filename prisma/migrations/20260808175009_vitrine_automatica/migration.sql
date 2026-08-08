-- Old manually-curated highlights have no productId and would violate the
-- new NOT NULL constraint. They're stale (older than one cleanup cycle) by
-- the time this runs in production, so dropping them is safe.
DELETE FROM "Highlight";

-- AlterTable
ALTER TABLE "Highlight" ADD COLUMN     "productId" TEXT NOT NULL,
ALTER COLUMN "note" DROP DEFAULT;

-- DropTable
DROP TABLE "Product";

-- DropTable
DROP TABLE "MercadoLivreGeneratedLink";

-- CreateIndex
CREATE UNIQUE INDEX "Highlight_marketplace_productId_key" ON "Highlight"("marketplace", "productId");
