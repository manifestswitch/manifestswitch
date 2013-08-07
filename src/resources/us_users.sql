
-- ACCESS DATABASE (separate)
-- ===============

CREATE TABLE passwords (
       pkey serial, -- PRIMARY KEY;
       username text, -- varchar (32) INDEX NOT NULL;
       password text, -- varchar (256) NOT NULL;
       modified_date timestamp, -- INDEX;
       disabled boolean -- NOT NULL;
       -- UNIQUE(username, password);
);
CREATE INDEX passwords_pkey ON passwords (pkey);
CREATE INDEX passwords_username ON passwords (username);

-- passwords aren't changed, instead a new password is added for the
-- user, and the old one is set disabled=true, with modified_date
-- updated.

-- Multiple masters can be used, with consistency conflicts on a
-- (username, password) pair being automatically resolved by whichever
-- modified_date is higher.

-- When registering a username, the password is inserted into all
-- masters with the disabled flag set to true.
-- It then reads back all the passwords for that username, and if
-- there are any more than expected, it deletes the rows and signals
-- failure, otherwise, it enables the rows.

CREATE TABLE primarykey (
       pkey serial,
       fingerprint bytea
);
CREATE INDEX primarykey_pkey ON primarykey (pkey);
CREATE INDEX primarykey_fingerprint ON primarykey (fingerprint);

-- This table is more of a cache - it could be determined by looking
-- up 'gpg --with-fingerprint --with-colons --list-keys | grep ^fpr'
-- and keeping only our own keys (the ultimate ones)
-- Currently assumed to be max one key per user
CREATE TABLE pubkey_own (
       pkey serial,
       username text,
       primarykey integer,
       write_token bytea
);
CREATE INDEX pubkey_own_pkey ON pubkey_own (pkey);
CREATE INDEX pubkey_own_username ON pubkey_own (username);

-- This table is more of a cache - it could be determined by looking
-- up 'gpg --with-fingerprint --with-colons --list-keys | grep ^fpr'
-- and removing our own keys (the ultimate ones)
CREATE TABLE pubkey_alias (
       pkey serial,
       username text,
       primarykey integer,
       identifier text
);
CREATE INDEX pubkey_alias_pkey ON pubkey_alias (pkey);
CREATE INDEX pubkey_alias_username ON pubkey_alias (username);

-- -----------------------------------------------
-- NODES

CREATE TABLE sha256 (
       pkey serial,
       sha256 bytea
);
CREATE INDEX sha256_pkey ON sha256 (pkey);
CREATE INDEX sha256_sha256 ON sha256 (sha256);

-- The idea of simply allowing anyone with the groupkey to access the
-- content is very slightly flawed, because it may have originally
-- come from eg. a local upload, unpublished.  For now however, the
-- assumption holds
CREATE TABLE nodes (
       pkey serial,
       sha256 integer,
       -- if true, only users in the recipients table can decrypt it
       isPubEnc boolean,
       -- the group key this is encrypted to, or null if not sym
       -- encrypted. Any sym encrypted items which can't be decrypted
       -- simply aren't recorded at all.
       groupkey integer,
       -- 64bit purported signing key, or null if no signature
       -- XXX: not useful now, but may be helpful for display, or for
       -- whittling down set of possible keys.
       signkeyId bytea,
       -- primarykey pkey of the signing key if signature is present
       -- and verified, null otherwise
       signkey integer,
       parent integer, -- parent, or null
       root integer, -- the ancestor with no parent, or self. NULL if we don't know yet.
       -- "parent" field contains the upvoted item. may be null if we
       -- don't know yet
       tag smallint
);
CREATE INDEX nodes_pkey ON nodes (pkey);
CREATE INDEX nodes_sha256 ON nodes (sha256);
CREATE INDEX nodes_parent ON nodes (parent);
CREATE INDEX nodes_tag ON nodes (tag);

-- we specifically remember the content that appears in channels which
-- is encrypted to private keys
CREATE TABLE channels_private (
       pkey serial index,
       -- the pubkey who's fingerprint channel this was in. This
       -- assumes such content was not found any other place like a
       -- group channel, but for now that holds - those are ignored.
       -- Note: some bastard could post the same content in their own
       -- fingerprint channel, so it'll end up twice here.
       pubkey integer,
       node integer
);

-- In fact, for anonymous recipients, we won't know which pubkey it
-- was encrypted to, just that the user could decrypt it. For now,
-- this is unambiguous since each user has just one private key
-- Later on we can just have one entry per key that a user holds

-- since a node can have multiple recipients
CREATE TABLE recipients (
       pkey serial,
       pubkey integer, -- a public key the node is encrypted to, if known
       node integer
);
CREATE INDEX recipients_pkey ON recipients (pkey);
CREATE INDEX recipients_pubkey_node ON recipients (pubkey, node);

-- since the recipients list is unknown, needn't be exhaustive, just
-- ones that might have been us but aren't.
CREATE TABLE not_recipients (
       pkey serial,
       pubkey integer, -- a public key the node is definitely not encrypted to, if known
       node integer
);
CREATE INDEX not_recipients_pkey ON not_recipients (pkey);
CREATE INDEX not_recipients_pubkey_node ON not_recipients (pubkey, node);

CREATE TABLE imported_pubkey (
       pkey serial,
       node integer,
       primarykey integer
);
CREATE INDEX imported_pubkey_pkey ON imported_pubkey (pkey);
CREATE INDEX imported_pubkey_node_primarykey ON imported_pubkey (node, primarykey);

-- -----------------------------------------------
-- SECRETS


-- write_token = sha512(secret).low(144).string('base64')
-- read_token  = sha256(write_token).string('base64')
-- key_id      = sha256(write_token).low(32).string('hex').upper()
CREATE TABLE secrets (
       pkey serial, -- PRIMARY KEY;
       secret bytea, -- NOT NULL
       -- both token columns are just cached evaluations:
       -- write_token = sha512(secret).low(144)
       -- read_token  = sha256(write_token.toString('base64'))
       write_token bytea, -- NOT NULL
       read_token bytea -- NOT NULL
       -- UNIQUE(username, identifier)
);
CREATE INDEX secrets_pkey ON secrets (pkey);
-- for insert where not exists. Doing this on write_token or
-- read_token should be safe, but I don't want to take the risk of
-- collision.
CREATE INDEX secrets_secret ON secrets (secret);

CREATE TABLE secrets_alias (
       pkey serial,
       username text,
       secret integer,
       identifier text,
       -- eg. if someone compromised the key and spams using it
       ignore_new boolean -- NOT NULL
);

CREATE INDEX secrets_alias_pkey ON secrets_alias (pkey);
CREATE INDEX secrets_alias_username ON secrets_alias (username);
