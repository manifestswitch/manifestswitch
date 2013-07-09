
-- SESSION DATABASE (separate)
-- ================

CREATE TABLE sessions (
       --pkey serial, -- PRIMARY KEY;
       identifier text, -- char (88) UNIQUE NOT NULL;
       expires timestamp,
       username text
);
CREATE INDEX sessions_identifier ON sessions (identifier);
