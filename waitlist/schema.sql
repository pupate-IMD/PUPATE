-- The pre-register list: one row per person. The handle is unique whatever its case (X names are), the
-- address is stored lowercase and unique. A row that came with a wallet's signature is verified = 1 and
-- keeps the message and the signature it checked; a pasted address is verified = 0 with neither.
-- No IP, no user agent: the row's own time is the only time kept.
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  address TEXT NOT NULL UNIQUE,
  followed INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  message TEXT,
  signature TEXT,
  created_at TEXT NOT NULL
);
