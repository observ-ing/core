-- CreateTable
CREATE TABLE "comments" (
    "uri" TEXT NOT NULL,
    "cid" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "subject_uri" TEXT NOT NULL,
    "subject_cid" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reply_to_uri" TEXT,
    "reply_to_cid" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "indexed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("uri")
);

-- CreateIndex
CREATE INDEX "comments_subject_uri_idx" ON "comments"("subject_uri");

-- CreateIndex
CREATE INDEX "comments_did_idx" ON "comments"("did");

-- CreateIndex
CREATE INDEX "comments_reply_to_uri_idx" ON "comments"("reply_to_uri");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_subject_uri_fkey" FOREIGN KEY ("subject_uri") REFERENCES "occurrences"("uri") ON DELETE CASCADE ON UPDATE CASCADE;
