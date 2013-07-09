
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
