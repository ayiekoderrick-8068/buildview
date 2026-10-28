-- AlterTable
ALTER TABLE "Project" DROP COLUMN "roomHeight",
DROP COLUMN "roomLength",
DROP COLUMN "roomWidth",
DROP COLUMN "wallThickness",
ADD COLUMN     "approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "roomCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wallCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CadSource" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "safeName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'not-scanned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingLayer" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityCount" INTEGER NOT NULL,
    "types" JSONB NOT NULL,

    CONSTRAINT "DrawingLayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CadSource_projectId_createdAt_idx" ON "CadSource"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_sourceId_createdAt_idx" ON "ImportJob"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "DrawingLayer_jobId_idx" ON "DrawingLayer"("jobId");

-- AddForeignKey
ALTER TABLE "CadSource" ADD CONSTRAINT "CadSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CadSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingLayer" ADD CONSTRAINT "DrawingLayer_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

