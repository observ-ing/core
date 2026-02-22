CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_did TEXT NOT NULL,
  actor_did TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_uri TEXT NOT NULL,
  reference_uri TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications (recipient_did, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (recipient_did) WHERE NOT read;
