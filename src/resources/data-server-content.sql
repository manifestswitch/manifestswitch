
-- CONTENT DATABASE (separate)
-- ================

-- handles the very direct case of data being stored on this node's
-- disk. The task of routing to the correct share is done elsewhere.

CREATE TABLE content (
       pkey serial, -- PRIMARY KEY;
       -- remember, this will not necessarily always be unique
       sha256 text, -- char (64) INDEX NOT NULL;
       content bytea, -- NOT NULL UNIQUE;
       -- if for any reason it is later removed
       gone boolean -- NOT NULL;
);
CREATE INDEX content_pkey ON content (pkey);
CREATE INDEX content_sha256 ON content (sha256);
