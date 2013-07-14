
CREATE TABLE secrets (
       pkey serial, -- PRIMARY KEY;
       username text, -- varchar (32) INDEX NOT NULL;
       -- the user gives their key a name (can be renamed)
       identifier text, -- NOT NULL
       secret bytea, -- NOT NULL
       modified_date timestamp, -- INDEX;
       -- eg. if someone compromised the key and spams using it
       ignore_new boolean -- NOT NULL
       -- UNIQUE(username, identifier)
);
CREATE INDEX secrets_pkey ON secrets (pkey);
CREATE INDEX secrets_username ON secrets (username);
