
-- REFERS DATABASE (separate)
-- ===============

-- All data passes through the refers node, and the references are
-- calculated here, so it is always consistent in its ordering.

-- give every hash a pkey in this database
CREATE TABLE refers_hash (
       pkey serial, -- PRIMARY KEY;
       sha256 text -- char (64) INDEX NOT NULL;
);
CREATE INDEX refers_hash_pkey ON refers_hash (pkey);
CREATE INDEX refers_hash_sha256 ON refers_hash (sha256);

-- If there are multiple referrer contents with the same hash, this
-- lists all of the hashes referenced by them.
CREATE TABLE refers (
       pkey serial, -- PRIMARY KEY;
       referrer integer, -- REFERENCES refers_hash (pkey) ON DELETE CASCADE NOT NULL;
       referree integer  -- REFERENCES refers_hash (pkey) ON DELETE CASCADE NOT NULL;
       -- UNIQUE (referrer, referree);
);
-- mainly so we can delete duplicates, also for ORDER BY
CREATE INDEX refers_pkey ON refers (pkey);
-- Index to have the order sorted for "ORDER BY referrer"
-- Not needed now that we have pkey
--CREATE INDEX refers_referrer ON refers (referrer);
-- SELECT .. WHERE referree="x"
CREATE INDEX refers_referree ON refers (referree);
