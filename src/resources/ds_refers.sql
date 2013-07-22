
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


-- New channel mechanism, based on a secret token value and a public
-- value derived from it using sha256.
-- In future could be sharded based on some of the sha256 value.


-- Just deduplicates the read_key text
CREATE TABLE read_keys (
       pkey serial, -- PRIMARY KEY;
       read_key text
);
CREATE INDEX read_keys_pkey ON read_keys (pkey);
CREATE INDEX read_keys_read_key ON read_keys (read_key);

-- content can be posted to multiple channels
CREATE TABLE channel_content (
       pkey serial, -- PRIMARY KEY;
       read_key integer,
       hash integer
);
CREATE INDEX channel_content_pkey ON channel_content (pkey);
CREATE INDEX channel_content_read_key_hash ON channel_content (read_key, hash);

-- The initial setup allows us to assign a random Write key as the
-- pair for a fingerprint Read key
-- Map from write_key -> fingerprint
-- (as opposed to the normal map of sha256)
CREATE TABLE fingerprint_alias (
       pkey serial, -- PRIMARY KEY;
       write_key text,
       fingerprint text
);
CREATE INDEX fingerprint_alias_pkey ON fingerprint_alias (pkey);
CREATE INDEX fingerprint_alias_write_key ON fingerprint_alias (write_key);

-- as above, except for looking up by fingerprint. This uses a
-- completely different mechanism, so is kept separate.
CREATE TABLE fingerprint_content (
       pkey serial, -- PRIMARY KEY;
       fingerprint_alias integer,
       hash integer
);
CREATE INDEX fingerprint_content_pkey ON fingerprint_content (pkey);
CREATE INDEX fingerprint_content_fingerprint_alias_hash ON fingerprint_content (fingerprint_alias, hash);
