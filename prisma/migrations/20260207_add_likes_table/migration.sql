-- CreateTable
CREATE TABLE "likes" (
    "uri" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "subject_uri" TEXT NOT NULL,
    "subject_cid" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "likes_pkey" PRIMARY KEY ("uri")
);

-- CreateIndex
CREATE UNIQUE INDEX "likes_subject_did_unique" ON "likes"("subject_uri", "did");

-- CreateIndex
CREATE INDEX "likes_subject_uri_idx" ON "likes"("subject_uri");

-- CreateIndex
CREATE INDEX "likes_did_idx" ON "likes"("did");

-- AddForeignKey
ALTER TABLE "likes" ADD CONSTRAINT "likes_subject_uri_fkey" FOREIGN KEY ("subject_uri") REFERENCES "occurrences"("uri") ON DELETE CASCADE ON UPDATE CASCADE;
