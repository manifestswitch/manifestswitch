
/*
Copyright (c) 2013, manifestswitch <EbXza@yahoo.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the manifestswitch project nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

// any other cool mods i can use?
"use strict";

var sessionSet,
redirectTo,
hasSession,
sessionStart,
process,
url,
sendResponse,
htmlEscape,
async_log,
https,
getJson404,
getPlain404,
getHtml404,
getJson405,
getPlain405,
getHtml405,
getJson406,
getPlain406,
getHtml406,
getJson500,
getPlain500,
getHtml500,
main;

//@include common.js
//@end

var https = require('https');
var child_process = require('child_process');

/*

Now we have a back-end, which will be used to store data and search by
hash.

The next step is to slowly build a UI that can understand and add to
this data in a structured fashion.

At its most basic form, the navigation will consist of the axioms:
getChildren -> [hash], getParents -> [hash]

A hash representing a topic, or "root" will be taken as the basis from
which getChildren calls will be followed.

STEP 1:
Put data in a tree-like reference fashion.

STEP 2:
Show the full tree in hash form.

STEP 3:
Add metadata actions - reply/edit/*vote

Once it is possible to navigate the content structure and make
additions freely, it will be time to add a notion of keyids, which
will provide another anchor from which to search for material.

STEP 4:
Search by keyid, verify signatures, signing for all of my own content.

Finally, graphs will be published into the content, and additional
methods for filtering and organising data according to graph trust.

STEP 5:
Discovery of graph information from friends.

STEP 6:
Filtering votes by graph, distributing authority to trusted network.

??? Key revocation requires ability to untrust a signature, but we
only want to do this for signatures created after a certain date.

Like key revocation, it must be extremely easy to change and extend
data sources, import extra data files and such.

The client needs to be able to handle conflict in the rare case where
two hefty trees of knowledge are built up upon different content with
the same hash.


The model as regards signing and verification is that it must be based
on GPG to the extent that someone can fairly easily use their local
GPG homedir for the job, and maybe upload it to the server and
download it as they please.

For now, just use the Process library to communicate with GPG. In
future, find or make a library to do this efficiently.

*/

// Step 1:
// Build a navigable tree of data references.
// Obviously it's possible to have multiple disconnected strands.

// Normally it isn't possible for an item to have multiple parents on
// Reddit and Twitter. It is possible for twitter to have multiple @
// and # tags, but that is more ofa "To" structure than reply.

// It may be manageable to view such a graph if we show N parents, and
// the item and N children, but may become annoying.

// Unfortunately it's a bit difficult to have multiple
// parents. Instead, an item can have 0-1 parents, and 0-N refs, for
// now the first referenced hash is considered a parent, and the
// remaining are simply refs. Refs are almost like a CC, and parent is
// almost like a To.

////////////////////////////////////////////////////////////////////////////////

var ui_server_css = '.hash { font-family: monospace; } ul.comments { padding-left: 16px; } ul.comments li { list-style: none; } ul.comments p { margin: 16px 0 0; } a.comments, a.reply { margin-left: 4px; font-size: 12px; } li a { color: #999; } div.content { font-size: 12px; } div.content h1 { font-size: 24px; } ';
var ui_server_css_gzip = new Buffer('H4sICIuczFECA2RhdGEtc2VydmVyLmNzcwDTy0gszlCoVkjLzyvRTUvMzcyptFLIzc/LLy5ITE61VqjlAgB3ZlLSIgAAAA==', 'base64');

var ui_server_js = _UI_SERVER_JS_;
var ui_server_js_gzip = null;

var jquery_js = _JQUERY_JS_;
var jquery_js_gzip = null;

var markdown_js = _MARKDOWN_JS_;
var markdown_js_gzip = null;

// what we are ultimately looking for is the hashes of all our
// friend's signature fingerprints, and hash of our encryption
// fingerprint
// 'user': ['d283a3...' /*mine*/, 'cd3987af...', ... /*theirs*/ ]
var follows_list = {
    // [sha256("user"), sha256("user2")]
    'user': ['04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb', '6025d18fe48abd45168528f18a82e265dd98d421a7084aa09f61b341703901a3', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']
}

var datadb = [
    //{ hash: 'caf3af6d893b5cb8eae9a90a3054f370a92130863450e3299d742c7a65329d94', content: 'boo\n', gone: false },
];

// index on hash -> [datadb[i], ...]
var hashed_by = {
}

var refersdb = [
//    { referrer: 'caf3af6d893b5cb8eae9a90a3054f370a92130863450e3299d742c7a65329d94',
//      referree: 'bf07a7fbb825fc0aae7bf4a1177b2b31fcf8a3feeaf7092761e18c859ee52a9c' },
];

// an index on referree -> [referrer, ...]
var referred_by = {
};

// pubkey -> [content, ...]
var posted_by = {
    //'user2': [datadb[0]]
};

var us_users_conf = "postgres://us_users:_US_USERS_PASS_@localhost:5432/us_users";
var us_pubkeyalias_conf = us_users_conf;
var us_sessions_conf = "postgres://us_sessions:_US_SESSIONS_PASS_@localhost:5432/us_sessions";
var us_keys_conf = us_users_conf;
var us_nodes_conf = us_users_conf;

function us_users_query(query, params, cb, err) {
    perform_query(us_users_conf, query, params, cb, err);
}

function us_pubkey_alias_query(query, params, cb, err) {
    perform_query(us_pubkeyalias_conf, query, params, cb, err);
}

function us_sessions_query(query, params, cb, err) {
    perform_query(us_sessions_conf, query, params, cb, err);
}

function us_keys_query(query, params, cb, err) {
    perform_query(us_keys_conf, query, params, cb, err);
}

function us_nodes_query(query, params, cb, err) {
    perform_query(us_nodes_conf, query, params, cb, err);
}


// returns a list of all hashes that the user wants to follow
// references of
function userFollowList(username) {
    if (!(username in follows_list)) {
        return [];
    }
    return follows_list[username];
}

// username -> [read_key, ...]
function userReadKeys(username, cont, contfail) {
    // the read keys for each secret key we have.
    // then just return those lists.

}

// returns all the user's fingerprints, less their own.
// username -> [fingerprint, ...]
function userFingerprints(username, cont, contfail) {
    // pubkey_alias holds a list of the user's 32bit keyids
    // first, we need to fix so that it holds the full 160bit fingerprint:
    // 899367D2 A6A5C175 3D724EEC 65280579 59DE2B30

}

var currentlyFetchingItems = {
    // hex: [handler,...]
};

// TODO: as a potential optimisation, do everything as in the Agent
// implementation, except when the request queue has more than one
// element, combine them into a single bulk request to the data
// service. Could be useful in higher latency connections.
function getDataItem(hex, cont) {

    // if the item is already being got, just register interest in the
    // results
    if (hex in currentlyFetchingItems) {
        currentlyFetchingItems[hex].push(cont);
        return;
    }
    currentlyFetchingItems[hex] = [cont];

    var options = {
        hostname: '127.0.0.1',
        port: 7443,
        path: '/data/' + hex,
        method: 'GET',
        headers: { Accept: 'text/plain' }
    };

    if (options.hostname === '127.0.0.1') {
        options.rejectUnauthorized = false;
    }

    var req = https.request(options, function(res) {
        res.setEncoding('utf8');

        var ch = '', shasum;

        // TODO: unlikely, but if we don't get 64 bytes of shasum it
        // will succeed anyway, make it fail in that case.
        function shasumFinish() {
            for (var i = 0, len = currentlyFetchingItems[hex].length; i < len; ++i) {
                currentlyFetchingItems[hex][i](hex, ch);
            }
            delete currentlyFetchingItems[hex];
        }

        function shasumRead() {
            var digest = shasum.read(64);

            if (digest === null) {
                return;
            }

            if (digest !== hex) {
                async_log(digest + ' doesnt match ' + hex);
                // this would be a good point to fail over to another data
                // service
                ch = null;
            }

            shasumFinish();
        }

        res.on('readable', function () {
            var str = res.read();
            if (str !== null) {
                ch += str;
            }
        });
        res.on('end', function () {
            if ((res.statusCode >= 200) && (res.statusCode <= 299)) {
                shasum = crypto.createHash('sha256');
                shasum.setEncoding('hex');
                shasum.on('readable', shasumRead);
                // seems like a bug, can't hash the empty string
                if (ch !== '') {
                    shasum.write(ch);
                }
                shasum.end();
            } else {
                ch = null
                shasumFinish();
            }
        });
    });

    req.on('error', function(e) {
        async_log('problem with request: ' + e.message);
    });

    req.end();
}

var currentlyFetchingItemsToIndex = {
    // hex: [handler,...]
};

function getDataCached(hash) {
    return hash in hashed_by ? (hashed_by[hash].length > 0 ? hashed_by[hash][0].content : null) : null;
}

function getDataItemAndIndex(ctx, hash, cont) {

    function fetchedDataItem(hex, data) {

        // need to be careful that all related indexes are fully
        // calculated before we return, else another part of code may get
        // partially complete results.
        // save the data in cache, we shouldn't need to download it ever again

        if (data !== null) {
            var newdata = { hash: hex, content: data, gone: false, refersCached: false };
            datadb.push(newdata);
            hashed_by[hex] = [newdata];

            // index all of the things it references
            var references = getReferencedHashes(data);

            for (var i = 0, len = references.length; i < len; ++i) {
                var refhex = references[i];

                if (!(refhex in referred_by)) {
                    referred_by[refhex] = [hex];
                    refersdb.push({ referrer: hex, referree: refhex });
                } else if (referred_by[refhex].indexOf(hex) === -1) {
                    referred_by[refhex].push(hex);
                    refersdb.push({ referrer: hex, referree: refhex });
                }
            }
        }

        for (var i = 0, len = currentlyFetchingItemsToIndex[hex].length; i < len; ++i) {
            currentlyFetchingItemsToIndex[hex][i](ctx, hex, data);
        }
        delete currentlyFetchingItemsToIndex[hex];
    }

    if (hash in hashed_by) {
        //process.nextTick(cont);
        cont(null, hash, getDataCached(hash));
        return;
    }

    // if the item is already being got, just register interest in the
    // results
    if (hash in currentlyFetchingItemsToIndex) {
        currentlyFetchingItemsToIndex[hash].push(cont);
        return;
    }
    currentlyFetchingItemsToIndex[hash] = [cont];

    getDataItem(hash, fetchedDataItem);
}

function getReferencingHashesFromCache(referencing) {
    var rv = {};
    for (var i = 0, len = referencing.length; i < len; ++i) {
        rv[referencing[i]] = referred_by[referencing[i]];
    }
    return rv;
}

function offsetsMap(counts, offsets) {
    var rv = null, offset;

    for (var sourcefull in counts) {
        for (var key in counts[sourcefull]) {
            var count = counts[sourcefull][key];
            if (count === 0) {
                delete counts[sourcefull][key];
                continue;
            }
            if ((!(sourcefull in offsets)) || (!(key in offsets[sourcefull]))) {
                offset = 0;
            } else {
                offset = offsets[sourcefull][key];
                if (offset >= counts[sourcefull][key]) {
                    delete counts[sourcefull][key];
                    continue;
                }
            }
            if (rv === null) {
                rv = {};
            }
            if (!(sourcefull in rv)) {
                rv[sourcefull] = {};
            }
            rv[sourcefull][key] = offset
        }
    }
    return rv;
}

// how far into a given stream we have processed. This works a bit
// like a seek operation and allows us to only fetch those hashes
// which have arrived since our last download.
// TODO: what if we ever need to rewind due to an error? Redo the
// whole stream?
// FIXME: as above, if fetching an item fails we need a way to try
// fetching again at some point, and an efficient way to note that
// fetching it failed and we would like to reprocess anything that
// depends on the data if we ever successfully download it.
var csoffsets = {
    // "https://example.org/data": { key1: N1, key2: N2, ... }
};
var ksoffsets = {
    // "https://example.org/data": { key1: N1, key2: N2, ... }
};

var currentlyFetchingLists = {
    // basePath: [handler,...]
};

// for the currently logged in user, we would like to loop through
// their peers, re-downloading all of the hashes of content that
// person has ever potentially signed.
// These posts are cached locally as user -> [content, ...]
//
// FIXME: This could get into trouble if two users fetch content for
// the same key at once. Make the latter just wait for the former to
// complete.
//
// One tricky part of the node info thing is making sure that if
// A<-B<-C<-D and we see C and D first, we'll have
// C:parent=B,root=null, D:parent=C,root=null When B arrives we need
// to update C:root=A and therefore D:root=A
// children = SELECT * WHERE parent=B
// UPDATE children SET root=B.root
// for c in children; repeat
function refreshPeerContent(params, username, cont, failed) {
    var waiting = 3, aborted = false, cs = null, ks = null, cscs, kscs, dwaiting = 0;
    // TODO: at a minimum let the ui-server admin supply a list of 1
    // or more data service URLs, fetching from all of them
    var sources = [{ proto: 'https:', host: '127.0.0.1', port: 7443 }];
    var sourcesfull = [sources[0].proto + '//' + sources[0].host + ':' + sources[0].port];
    var cspointers = {}, kspointers = {};

    // previously we would work back from the signed upvotes to a posted item, then get the posted item, and if it had a parent, record that.
    // now we have

    // all_child_posts of a parent (may be null):
    // SELECT pkey FROM nodes WHERE parent=$2 AND tag=1 AND ((signkey IN (SELECT primarykey FROM pubkey_alias WHERE username=$1) OR groupKey IN (SELECT secret FROM secrets_alias WHERE username=$1) OR (pkey IN (SELECT parent FROM nodes WHERE tag=2 AND signkey IN (SELECT primarykey FROM pubkey_alias WHERE username=$1) OR groupKey IN (SELECT secret FROM secrets_alias WHERE username=$1)))))

    function problem() {
        failed();
    }

    function decAndCheck() {
        --dwaiting;
        if (dwaiting === 0) {
            for (var source in cspointers) {
                for (var c in cspointers[source]) {
                    csoffsets[source][c] = cspointers[source][c];
                }
            }
            for (var source in kspointers) {
                for (var k in kspointers[source]) {
                    ksoffsets[source][k] = kspointers[source][k];
                }
            }
            cont();
        }
    }

    // TODO: decrypt, learning keys along the way.
    // What if the content is encrypted to a different user's public
    // key?
    // insert/ignore node info into the database.
    function fetchedDataItemIndexed(ctx, hex, data) {
        var groupKey = null, nodePkey, decrypt, sigfingerprintPkey = null, sigfingerprintIdentifier = null,
        shaPkey, upvoted, post, signkeyId, keyType, sendGroupKey;

        function sqlFail(err) {
            decAndCheck();
        }

        function insertedPubKeyImported(result) {
            if ((result.rowCount === 0) && (sigfingerprintPkey !== null)) {
                // UPDATE nodes SET signkey=$1 WHERE sha256=$2
            }
            if (decrypt.isPubEnc) {
                insertedNodeHasPubEnc();
                return;
            }
            decAndCheck();
        }

        function insertedPubKeyNode(result) {

            // FIXME: import only if it's signed correctly or has a good group key.
            // otherwise, we've already recorded its existence

            // We need to get hold of the @name before inserting it too

            if (((sigfingerprintPkey !== null) && (sigfingerprintPkey in myFriends)) ||
                ((decrypt.symKeyPkey !== null) && (decrypt.symKeyPkey in myGroupKeys))) {

                importPublicKey(username, pubkey, identifier, importedPubKey, sqlFail);
                return;
            }
            decAndCheck();
        }

        function insertedGroupKeyNode(result) {

            // FIXME: insert key material immediately into secrets table, maintain a link like:
            // CREATE TABLE imported_secret ( node integer, secret integer );
            // This allows users to easily find the new key material when they next login
            us_nodes_query('INSERT INTO nodes (sha256, isPubEnc, groupkey, signkeyId, signKey, parent, root, tag) SELECT $1,$2,$3,$4,$5,null,null,8 WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE sha256=$1)',
                           [shaPkey, decrypt.isPubEnc, decrypt.symKeyPkey, signkeyId, sigfingerprintPkey],
                           insertedGroupKeyNode, sqlFail);

            if (((sigfingerprintPkey !== null) && (sigfingerprintPkey in myFriends)) ||
                ((decrypt.symKeyPkey !== null) && (decrypt.symKeyPkey in myGroupKeys))) {

                importPublicKey(username, pubkey, identifier, importedPubKey, sqlFail);
                return;
            }
        }

        function insertedNotRecipient(result) {
            decAndCheck();
        }

        function selectedOwnPubkeyHasPubEnc(result) {
            var table = decrypt.gotPubDec ? 'recipients' : 'not_recipients';
            us_nodes_query('INSERT INTO ' + table + ' (pubkey, node) SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM ' + table + ' WHERE node=$2)',
                           [result.rows[0].pkey, nodePkey],
                           insertedNotRecipient, sqlFail);
        }

        function selectedNodeHasPubEnc(result) {
            nodePkey = result.rows[0].pkey;
            us_nodes_query('SELECT pkey FROM pubkey_own WHERE username=$1',
                           [username],
                           selectedOwnPubkeyHasPubEnc, sqlFail);
        }

        function insertedNodeHasPubEnc(result) {
            us_nodes_query('SELECT pkey FROM nodes WHERE sha256=$1',
                           [shaPkey],
                           selectedNodeHasPubEnc, sqlFail);
        }

        function importedPubKey(fingerprint, primarykey) {
            // i believe we're done at this point
            decAndCheck();
        }

        function importedGroupKey() {
            // i believe we're done at this point
            decAndCheck();
        }

        function continueGotKeyImportSignIdentifier() {
            var identifier, from, name = getNameFromData(decrypt.data);

            if (sigfingerprintIdentifier !== null) {
                if (decrypt.symKeyIdentifier !== null) {
                    from = sigfingerprintIdentifier + ' in ' + decrypt.symKeyIdentifier;
                } else {
                    from = sigfingerprintIdentifier;
                }
            } else if (decrypt.symKeyIdentifier !== null) {
                from = decrypt.symKeyIdentifier;
            }

            identifier = '[from: ' + from + '] ' + (name === null ? 'Unknown' : name);

            // Import the thing
            if (keyType === 4) {
                importPublicKey(username, decrypt.data, identifier, importedPubKey, sqlFail);
            } else if (keyType === 8) {
                importGroupKey(username, sendGroupKey, identifier, importedGroupKey, sqlFail);
            } else {
                async_log('unknown key import type: ' + nodePkey);
                decAndCheck();
            }
        }

        function gotKeyImportSignIdentifier(result) {
            if (result.rows.length === 0) {
                // most likely signed by our own key
                decAndCheck();
                return;
            }
            sigfingerprintIdentifier = result.rows[0].identifier;
            continueGotKeyImportSignIdentifier();
        }

        function insertedKeyNode(result) {
            if ((sigfingerprintPkey === null) && (decrypt.symKeyIdentifier === null)) {
                decAndCheck();
                return;
            }

            if (sigfingerprintPkey !== null) {
                // the only other option is that it's signed by our
                // own key, in which case importing has no impact
                us_users_query('SELECT identifier FROM pubkey_alias WHERE username=$1 AND primarykey=$2',
                               [username, sigfingerprintPkey],
                               gotKeyImportSignIdentifier, sqlFail);
                return;
            }

            continueGotImportSendKeyIdentifier();
        }

        function insertedUpvoteNode(result) {
            if ((result.rowCount === 0) && (sigfingerprintPkey !== null)) {
                // UPDATE nodes SET signkey=$1 WHERE sha256=$2
            }
            if (decrypt.isPubEnc) {
                insertedNodeHasPubEnc();
                return;
            }
            decAndCheck();
        }

        function insertedPostNode(result) {
            if ((result.rowCount === 0) && (sigfingerprintPkey !== null)) {
                // UPDATE nodes SET signkey=$1 WHERE sha256=$2
            }
            if (decrypt.isPubEnc) {
                insertedNodeHasPubEnc();
                return;
            }
            decAndCheck();
        }

        function insertedPlainNode(result) {
            if ((result.rowCount === 0) && (sigfingerprintPkey !== null)) {
                // UPDATE nodes SET signkey=$1 WHERE sha256=$2
            }
            if (decrypt.isPubEnc) {
                insertedNodeHasPubEnc();
                return;
            }
            decAndCheck();
        }

        function gotUpvotedShaPkey(result) {
            us_nodes_query('INSERT INTO nodes (sha256, isPubEnc, groupkey, signkeyId, signKey, parent, root, tag) SELECT $1,$2,$3,$4,$5,$6,null,2 WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE sha256=$1)',
                           [shaPkey, decrypt.isPubEnc, decrypt.symKeyPkey, signkeyId, sigfingerprintPkey, result.rows[0].pkey],
                           insertedUpvoteNode, sqlFail);
        }

        function gotPostShaPkey(result) {
            us_nodes_query('INSERT INTO nodes (sha256, isPubEnc, groupkey, signkeyId, signKey, parent, root, tag) SELECT $1,$2,$3,$4,$5,$6,null,$7 WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE sha256=$1)',
                           [shaPkey, decrypt.isPubEnc, decrypt.symKeyPkey, signkeyId, sigfingerprintPkey, result.rows[0].pkey,
                            (!decrypt.isPubEnc || decrypt.gotPubDec) && (!decrypt.isSymEnc || decrypt.symKeyIdentifier !== null) ? 1 : null],
                           insertedPostNode, sqlFail);
        }

        function insertedUpvoteSha(result) {
            us_users_query('SELECT pkey FROM sha256 WHERE sha256=$1',
                           ['\\x' + upvoted],
                           gotUpvotedShaPkey, sqlFail);
        }

        function insertedPostSha(result) {
            us_users_query('SELECT pkey FROM sha256 WHERE sha256=$1',
                           ['\\x' + post],
                           gotPostShaPkey, sqlFail);
        }

        function continueInsertKey() {
            us_nodes_query('INSERT INTO nodes (sha256, isPubEnc, groupkey, signkeyId, signKey, parent, root, tag) SELECT $1,$2,$3,$4,$5,null,null,$6 WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE sha256=$1)',
                           [shaPkey, decrypt.isPubEnc, decrypt.symKeyPkey, signkeyId, sigfingerprintPkey, keyType],
                           insertedKeyNode, sqlFail);
        }

        function primarykeyContinue() {
            signkeyId = decrypt.signkeyId === null ? null : '\\x' + decrypt.signkeyId;

            // FIXME: at this point, if it is a public key, or a ~key
            // item, and signed by a key we trust, or is posted in a
            // group we follow, add it to our keyring
            /* Looks something like
               if (gotGroupKey || signatureValid) { if (decrypt.hasPubKey || getGroupKeyFromData(decrypt.data)) { importKey ; nameKeyAppropriately } }
               Results in keys named like one of these:
               [from GroupName] KeyName
               [from User] KeyName
               [from User in GroupName] KeyName

               As per normal, we also want other user's following this
               channel to process it - that will happen in much the
               same way, but a flag is needed in the database to
               indicate this is a key.

               Option 1:
               add "ispubkey" and "isgroupkey"
               Option 2:
               add smallint "type", 1=Post, 2=Upvote, 4=PubKey, 8=GroupKey, 16=Network
            */

            if (decrypt.hasPubKey) {
                keyType = 4;
                continueInsertKey();
                return;
            }

            upvoted = getUpvoteFromData(decrypt.data);

            if (upvoted !== null) {
                us_users_query('INSERT INTO sha256 (sha256) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM sha256 WHERE sha256=$1)',
                               ['\\x' + upvoted],
                               insertedUpvoteSha, sqlFail);
                return;
            }

            post = getPostFromData(decrypt.data);

            if (post !== null) {
                us_users_query('INSERT INTO sha256 (sha256) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM sha256 WHERE sha256=$1)',
                               ['\\x' + post],
                               insertedPostSha, sqlFail);
                return;
            }

            sendGroupKey = getSentGroupKeyFromData(decrypt.data);

            if (sendGroupKey !== null) {
                keyType = 8;
                continueInsertKey();
                return;
            }

            // could just be some plain text
            us_nodes_query('INSERT INTO nodes (sha256, isPubEnc, groupkey, signkeyId, signKey, parent, root, tag) SELECT $1,$2,$3,$4,$5,null,null,0 WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE sha256=$1)',
                           [shaPkey, decrypt.isPubEnc, decrypt.symKeyPkey, signkeyId, sigfingerprintPkey],
                           insertedPlainNode, sqlFail);
        }

        function selectedSignaturePkey(result) {
            sigfingerprintPkey = result.rows[0].pkey;
            primarykeyContinue();
        }

        function selectedShaPkey(result) {
            shaPkey = result.rows[0].pkey

            // we don't want to skip past pubkey failures because they
            // may genuinely not be addressed to us.
            if (decrypt.isPubEnc && !decrypt.gotPubDec) {
                us_nodes_query('INSERT INTO nodes (sha256, isPubEnc, groupkey, signkeyId, signKey, parent, root, tag) SELECT $1,true,null,null,null,null,null,null WHERE NOT EXISTS (SELECT 1 FROM nodes WHERE sha256=$1)',
                               [shaPkey],
                               insertedNodeHasPubEnc, sqlFail);
                return;
            }

            if (decrypt.sigfinger !== null) {
                us_users_query('SELECT pkey FROM primarykey WHERE fingerprint=$1',
                               ['\\x' + decrypt.sigfinger],
                               selectedSignaturePkey, sqlFail);
                return;
            }

            primarykeyContinue();
        }

        function insertedSha(result) {
            us_nodes_query('SELECT pkey FROM sha256 WHERE sha256=$1',
                           ['\\x' + hex],
                           selectedShaPkey, sqlFail);
        }

        function gotDecrypt(d) {
            decrypt = d;

            if (decrypt.isSymEnc && (decrypt.symKeyIdentifier === null)) {
                // then something has gone wrong and we should proceed no
                // further.
                // we assume the user hasn't somehow managed to listen
                // on a channel they shouldn't, someone likely just
                // posted garbage to the wrong channel
                decAndCheck();
                return;
            }

            us_nodes_query('INSERT INTO sha256 (sha256) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM sha256 WHERE sha256=$1)',
                           ['\\x' + hex],
                           insertedSha, sqlFail);
        }

        getDecrypt(params, data, gotDecrypt);
    }

    function getDataList(sourcefull, cs, ks) {
        var ddi = sourcefull.indexOf('//');
        var pi  = sourcefull.indexOf(':', ddi);
        var proto = sourcefull.substr(0, ddi);
        var host = sourcefull.substring(ddi+2, pi);
        var port = strPosInt(sourcefull.substring(pi+1));
        var path = '/data';
        var pathstr = path;
        var ch = '';

        if (cs !== null) {
            var first = true;
            for (var c in cs) {
                if (first) {
                    pathstr += '?c=' + c.replace(unreplaceB64Regex, unreplaceB64) + '.' + cs[c];
                    first = false;
                } else {
                    pathstr += '.' + c.replace(unreplaceB64Regex, unreplaceB64) + '.' + cs[c];
                }
            }
        }
        if (ks !== null) {
            var first = true;
            for (var k in ks) {
                if (first) {
                    pathstr += (pathstr === path ? '?' : '&') + 'k=' + k + '.' + ks[k];
                    first = false;
                } else {
                    pathstr += '.' + k + '.' + ks[k];
                }
            }
        }

        var options = {
            hostname: host,
            port: port,
            path: pathstr,
            method: 'GET',
            headers: { Accept: 'text/plain' }
        };

        function onResEnd() {
            var lines = ch.split('\n'), m, isc, curkey, gotSomething = false;

            for (var i = 0, len = lines.length; i < len; ++i) {
                if ((lines[i].length >= 2) && (lines[i][1] === ' ')) {
                    isc = lines[i][0] === 'c';
                    curkey = lines[i].substr(2);
                } else {
                    m = hashonly_re.exec(lines[i]);

                    if (m !== null) {
                        gotSomething = true;

                        if (isc) {
                            if (curkey in cspointers[sourcefull]) {
                                cspointers[sourcefull][curkey] += 1;
                            }
                        } else {
                            if (curkey in kspointers[sourcefull]) {
                                kspointers[sourcefull][curkey] += 1;
                            }
                        }

                        dwaiting += 1;

                        // now fetch it, decrypt, index it and so
                        // on. the only remaining question is where to
                        // sync, and do continueFetchLists call
                        getDataItemAndIndex({ type: lines[i][0], key: curkey }, m[1], fetchedDataItemIndexed);
                    }

                }
            }

            if (!gotSomething) {
                // stop if we didn't make any progress
                decAndCheck();
            } else {
                continueFetchLists(offsetsMap(cscs, cspointers),
                                   offsetsMap(kscs, kspointers));
            }
        }

        function gotDataList(res) {
            function resRead() {
                var str = res.read();
                if (str !== null) {
                    ch += str;
                }
            }
            res.setEncoding('ascii');
            res.on('readable', resRead);
            res.on('end', onResEnd);
        }

        if (host === '127.0.0.1') {
            options.rejectUnauthorized = false;
        }

        if (proto === 'https:') {
            var req = https.request(options, gotDataList);
        } else {
            var req = http.request(options, gotDataList);
        }
        req.on('error', logError);
        req.end();
    }

    function continueFetchLists(cs, ks) {
        var ksv;
        if ((cs === null) && (ks === null)) {
            decAndCheck();
        } else {
            if (cs !== null) {
                for (var it in cs) {
                    if ((ks !== null) && (it in ks)) {
                        ksv = ks[it];
                        delete ks[it];
                    } else {
                        ksv = null;
                    }
                    getDataList(it, cs[it], ksv);
                    delete cs[it];
                    return;
                }
            } else {
                for (var it in ks) {
                    getDataList(it, null, ks[it]);
                    delete ks[it];
                    return;
                }
            }
            // if we reached here we have finished fetching
            decAndCheck();
        }
    }

    function getDataCount(protocol, hostname, port, cs, ks) {
        var sourcefull = protocol + '//' + hostname + ':' + port;
        var path = '/count';
        var pathstr = path;
        var ch = '';

        function onResEnd() {
            var lines = ch.split('\n');
            for (var i = 0, len = lines.length; i < len; ++i) {
                var parts = lines[i].split(' ');
                if (parts.length !== 3) {
                    continue;
                }
                var count = strPosInt(parts[2]);
                if (count < 0) {
                    continue;
                }
                if (parts[0] === 'c') {
                    if (!(parts[1] in cscs[sourcefull])) {
                        continue;
                    }
                    cscs[sourcefull][parts[1]] = count;
                } else if (parts[0] === 'k') {
                    if (!(parts[1] in kscs[sourcefull])) {
                        continue;
                    }
                    kscs[sourcefull][parts[1]] = count;
                }
            }

            // set up cspointers and kspointers, which we use to
            // track progress across the lists and bulk update at
            // the end.
            var cs = offsetsMap(cscs, csoffsets);
            var ks = offsetsMap(kscs, ksoffsets);

            for (var source in cs) {
                if (!(source in csoffsets)) {
                    csoffsets[source] = {};
                }
                cspointers[source] = {};
                for (var key in cs[source]) {
                    if (!(key in csoffsets[source])) {
                        csoffsets[source][key] = 0;
                    }
                    cspointers[source][key] = csoffsets[source][key];
                }
            }
            for (var source in ks) {
                if (!(source in ksoffsets)) {
                    ksoffsets[source] = {};
                }
                kspointers[source] = {};
                for (var key in ks[source]) {
                    if (!(key in ksoffsets[source])) {
                        ksoffsets[source][key] = 0;
                    }
                    kspointers[source][key] = ksoffsets[source][key];
                }
            }

            dwaiting = 1;
            continueFetchLists(cs, ks);
        }

        function gotDataResponse(res) {
            function resRead() {
                var str = res.read();
                if (str !== null) {
                    ch += str;
                }
            }

            res.setEncoding('ascii');
            res.on('readable', resRead);
            res.on('end', onResEnd);
        }

        if (cs.length !== 0) {
            pathstr += '?c=' + cs[0];
        }
        for (var i = 1, len = cs.length; i < len; ++i) {
            pathstr += '.' + cs[i];
        }
        if (ks.length !== 0) {
            pathstr += (pathstr === path ? '?' : '&') + 'k=' + ks[0];
        }
        for (var i = 1, len = ks.length; i < len; ++i) {
            pathstr += '.' + ks[i];
        }

        var options = {
            hostname: hostname,
            port: port,
            path: pathstr,
            method: 'GET',
            headers: { Accept: 'text/plain' }
        };

        if ((hostname === '127.0.0.1') && (protocol === 'https:')) {
            options.rejectUnauthorized = false;
        }

        if (protocol === 'https:') {
            var req = https.request(options, gotDataResponse);
        } else {
            var req = http.request(options, gotDataResponse);
        }

        req.on('error', logError);
        req.end();
    }

    // TODO: each source should be counted and fetched in a separate
    // strand, so long as we don't try to fetch the same data item
    // twice when listed in two separate sources
    function continueKeys(cs, ks) {
        var stalecs = [], staleks = [], key;

        cscs = {};
        kscs = {};
        cscs[sourcesfull[0]] = {};
        kscs[sourcesfull[0]] = {};

        // TODO: filter fl down so that we only try to refetch if our
        // cached data is older than say 1 second.
        // If they're all under 1 second old, there's nothing to do.
        for (var i = 0, len = cs.length; i < len; ++i) {
            key = cs[i].read_token.toString('base64');
            cscs[sourcesfull[0]][key] = 0;
            stalecs.push(key.replace(unreplaceB64Regex, unreplaceB64));
        }
        for (var i = 0, len = ks.length; i < len; ++i) {
            key = ks[i].fingerprint.toString('hex').toUpperCase();
            kscs[sourcesfull[0]][key] = 0;
            staleks.push(key);
        }

        if ((stalecs.length !== 0) || (staleks.length !== 0)) {
            getDataCount(sources[0].proto, sources[0].host, sources[0].port, stalecs, staleks);
        } else {
            cont();
        }
    }

    function checkContinue() {
        if (aborted) {
            return;
        }
        --waiting;
        if (waiting === 0) {
            continueKeys(cs, ks);
        }
    }

    function gotPubkeyAliases(result) {
        if (result === null) {
            aborted = true;
            sendResponse(params, 500, 'Could not get list of known keys');
            return;
        }
        if (ks !== null) {
            var oldk = ks[0];
            ks = result.rows;
            ks.push(oldk);
        } else {
            ks = result.rows;
        }
        checkContinue();
    }

    function gotPubkeyOwn(result) {
        if (result === null) {
            aborted = true;
            sendResponse(params, 500, 'Could not get list of known keys');
            return;
        }
        if (ks !== null) {
            ks.push(result.rows[0]);
        } else {
            ks = result.rows;
        }

        ks = result.rows;
        checkContinue();
    }

    function gotReadToken(result) {
        if (result === null) {
            aborted = true;
            sendResponse(params, 500, 'Could not get list of known keys');
            return;
        }
        cs = result.rows;
        checkContinue();
    }

    us_pubkey_alias_query('SELECT pk.fingerprint FROM primarykey AS pk, pubkey_own AS pa WHERE pa.username=$1 AND pa.primarykey=pk.pkey',
                          [username],
                          gotPubkeyAliases);

    us_pubkey_alias_query('SELECT pk.fingerprint FROM primarykey AS pk, pubkey_alias AS pa WHERE pa.username=$1 AND pa.primarykey=pk.pkey',
                          [username],
                          gotPubkeyOwn);

    us_keys_query('SELECT s.read_token FROM secrets AS s, secrets_alias AS sa WHERE sa.username=$1 AND sa.secret=s.pkey',
                  [username],
                  gotReadToken);
}

// LOGIN CODE

function deleteSession(sessionId, cont) {
    us_sessions_query("DELETE FROM sessions WHERE identifier=$1",
                      [sessionId],
                      cont);
}

function getUsername(params, cont) {
    function gotUsername(result) {
        if ((result !== null) && (result.rows.length === 1)) {
            cont(result.rows[0].username);
        } else {
            cont(null);
        }
    }

    if (!hasSessionCookie(params)) {
        cont(null);
        return;
    }
    us_sessions_query("SELECT username FROM sessions WHERE identifier=$1",
                      [params.cookies.s.value],
                      gotUsername);
}

// FIXME: I should do some limiting - if an IP address shows
// up as repeatedly failing login, say 3 attempts, then A) prevent
// many concurrent connections from that IP, B) add a sleep in to
// thwart any cracking.

function authenticate_continue(params, username) {
    var savedResult = null, sessionId;

    function createdSession(result) {
        params.cookies.s = { value: sessionId };
        redirectTo(params, '/');
    }

    function gotSessionId(sessId) {
        sessionId = sessId;
        // expires with one day of inactivity, or when browser is closed
        us_sessions_query("INSERT INTO sessions (identifier, expires, username) VALUES ($1, CURRENT_TIMESTAMP+'1d', $2)",
                          [sessId, username],
                          createdSession);
    }

    function cleared() {
        if (!savedResult) {
            sendResponse(params, 403, 'Login failed');
            return;
        }
        createSessionId(gotSessionId);
    }

    return function (result) {
        var hc = hasSessionCookie(params);
        savedResult = result;

        if (hc) {
            deleteSession(params.cookies.s.value, cleared);
        } else {
            cleared();
        }
    };
}

function authenticate(username, password, cont) {
    function gotPasswords(result) {
        if ((result !== null) && (result.rows.length > 0)) {
            for (var i = 0, len = result.rows.length; i < len; ++i) {
                if (password === result.rows[i].password) {
                    cont(true);
                    return;
                }
            }
        }
        cont(false);
    }

    us_users_query("SELECT password FROM passwords WHERE username=$1 AND disabled=false",
                   [username],
                   gotPasswords);
}

function postLoginGotData(params, uparams) {
    authenticate(uparams.username, uparams.password,
                 authenticate_continue(params, uparams.username));
}

function postLogin(params) {
    getFormData(params, postLoginGotData);
}

function postRegisterGotData(params, uparams) {

    function insertedUser(result) {
        if (result === null) {
            sendResponse(params, 500, 'Could not register account');
            return;
        }
        redirectTo(params, '/');
    }

    if (uparams.password !== uparams.repassword) {
        sendResponse(params, 400, "Passwords don't match");
        return;
    }

    us_users_query("INSERT INTO passwords (username, password, modified_date, disabled) VALUES ($1, $2, CURRENT_TIMESTAMP, false)",
                   [uparams.username, uparams.password],
                   insertedUser);
}

function postRegister(params) {
    getFormData(params, postRegisterGotData);
}

////////////////////////////////////////////////////////////////////////////////

function getLoginResultPlain(params) {
    function gotUsername(username) {
        var body, status;
        if (username !== null) {
            status = 200;
            body = '200 OK: You have successfully logged in';
        } else {
            status = 403;
            body = '403 Forbidden: Login failed';
        }
        sendResponse(params, status, body);
    }
    getUsername(params, gotUsername);
}

function getLoginResultJson(params) {
    function gotUsername(username) {
        var body, status;
        if (username !== null) {
            status = 200;
            body = '{ "status": 200, "result": "OK", "message": "You have successfully logged in" }';
        } else {
            status = 403;
            body = '{ "status": 403, "result": "Forbidden", "message": "Login failed" }';
        }
        sendResponse(params, status, body);
    }
    getUsername(params, gotUsername);
}

function getLoginResultHtml(params) {
    function gotUsername(username) {
        var body, status;
        if (username !== null) {
            status = 200;
            body = '<h1>200 OK: You have successfully logged in</h1><a href="/">Continue</a>';
        } else {
            status = 403;
            body = '<h1>403 Forbidden: Login failed</h1><a href="/">Continue</a>';
        }
        sendResponse(params, status, body);
    }
    getUsername(params, gotUsername);
}

////////////////////////////////////////////////////////////////////////////////

function postLogout(params) {
    // allow to run asynchronously
    deleteSession(params.cookies.s.value, do_nothing);
    // TODO: make this expired instead
    delete params.cookies.s;
    redirectTo(params, '/');
}

////////////////////////////////////////////////////////////////////////////////

function getLogoutResultPlain(params) {
    function gotUsername(username) {
        var body, status;
        if (username === null) {
            status = 200;
            body = '200 OK: You have successfully logged out';
        } else {
            status = 500;
            body = '500 Internal Server Error: Logout failed';
        }
        sendResponse(params, status, body);
    }
    getUsername(params, gotUsername);
}

function getLogoutResultJson(params) {
    function gotUsername(username) {
        var body, status;
        if (username === null) {
            status = 200;
            body = '{ "status": 200, "result": "OK", "message": "You have successfully logged out" }';
        } else {
            status = 500;
            body = '{ "status": 500, "result": "Internal Server Error", "message": "Logout failed" }';
        }
        sendResponse(params, status, body);
    }
    getUsername(params, gotUsername);
}

function getLogoutResultHtml(params) {
    function gotUsername(username) {
        var body, status;
        if (username === null) {
            status = 200;
            body = '<h1>200 OK: You have successfully logged out</h1><a href="/">Continue</a>';
        } else {
            status = 500;
            body = '<h1>500 Internal Server Error: Logout failed</h1><a href="/">Continue</a>';
        }
        sendResponse(params, status, body);
    }

    getUsername(params, gotUsername);
}

////////////////////////////////////////////////////////////////////////////////

// Should a signature be detached or inline?
// I'm thinking detached - there doesn't seem much reason to have it
// attached.

//var spawn = require('child_process').spawn;
//ch = spawn("/usr/bin/gpg", ["-as"]);

function getHomePageHtml(params) {

    function gotUsername(username) {
        var body = ('<!DOCTYPE html>\n' +
                    '<html>\n' +
                    '  <head>\n' +
                    '    <title>UI</title>\n' +
                    '  </head>\n' +
                    '  <body>\n' +
                    (
                        ((username !== undefined) && (username !== null)) ?
                            ('    <div>\n' +
                             '      ' + htmlEscape(username) + '\n' +
                             '    <div>\n' +
                             '    <form action="/logout" method="POST">\n' +
                             '      <input value="logout" type="submit">\n' +
                             '    </form>\n')
                            :
                            ('    <form action="/login" method="POST">\n' +
                             '      <label for="username">username</label>\n' +
                             '      <input name="username" id="username" type="text">\n' +
                             '      <label for="password">password</label>\n' +
                             '      <input name="password" id="password" type="password">\n' +
                             '      <input value="login" type="submit">\n' +
                             '    </form>\n' +
                             '    <form action="/register" method="POST">\n' +
                             '      <label for="username">username</label>\n' +
                             '      <input name="username" id="username" type="text">\n' +
                             '      <label for="password">password</label>\n' +
                             '      <input name="password" id="password" type="password">\n' +
                             '      <label for="repassword">repeat password</label>\n' +
                             '      <input name="repassword" id="repassword" type="password">\n' +
                             '      <input value="register" type="submit">\n' +
                             '    </form>\n')
                    ) +
                    '    <div>\n' +
                    '      <h1>UI</h1>\n' +
                    '      <div><a href="/keys">keys</a> <a href="/posts">posts</a></div>\n' +
                    '    </div>\n' +
                    '  </body>\n' +
                    '</html>');

        sendResponse(params, 200, body);
    }

    getUsername(params, gotUsername);
}

/*

# Really, there's no reason that XHRs can't be used to navigate the
# tree - this call just provides a simple link to get started.  We
# always focus on a single hash as the focal point, then show children
# and parents as appropriate.

GET /tree?sha256=$hash&context=$uint



The most common UI views that I'll want to support are:
tree view: see replies as a tree, possibly part hidden
list date ordered: see most recent at top, eg. most recent by Bob or most recent reply/post to X
list rated: same as above, but sorted by friend's upvotes within a time period

*/

// This is a preliminary page to list all content which references a hash and is correctly signed by a trusted key.
// I'd like this to look like a full recursive tree view of items as in YC news.
//
// The basic format of each node is:
// -----------
// some data
//
// ~date($somedate)
// ~post($somehash)
//
// BEGIN GPG SIGNATURE
// ...
// END GPG SIGNATURE
// -----------
//
// The basic HTML only view is to be shown the content, and then have
// a link to see the parent post (if there is one), and a link to see
// the list of 0 or more child posts.
//
// GET /post/$somehash
// [ $sigkeyid | $somedate | Parent link | Children link | +42 | -3 ]
// some data
//
// The lists view is simply:
// GET /posts&references=$somehash
// [ $sigkeyid1 | $somedate1 | Item1 link ]
// [ $sigkeyid2 | $somedate2 | Item2 link ]
// [ $sigkeyid3 | $somedate3 | Item3 link ]
// [ $sigkeyid4 | $somedate4 | Item4 link ]
//
// The design is exactly analagous to "GET /data?references=..." and
// "GET /data/$hash/entry/$id" except that instead of showing all
// entries, we only show those that are in valid "post" format, and
// only those that have an upvote signed by someone we trust.
//
// The hash parameter is the node to be considered.

var dateRegex = /\[date\]: iso8601:(.+)\n/;

// If there is an upvote, returns the thing being upvoted
var upvotes = {
    // 'hex': hex
};

var upvoteRegex = /\[upvote\]: sha256:([0-9a-f]{64})\n/;

var sentGroupKeyRegex = /~key\(([0-9a-zA-Z\/\+]{43}=)\)/;

var nameRegex = /~name\(([^\)]+)\)/;

function getPostFromData(data) {
    var match = data.match(parentsRegex);
    return (match === null) ? null : match[1];
}

function getUpvoteFromData(data) {
    var match = data.match(upvoteRegex);
    return (match === null) ? null : match[1];
}

function getSentGroupKeyFromData(data) {
    var match = data.match(sentGroupKeyRegex);
    return (match === null) ? null : new Buffer(match[1], 'base64');
}

function getNameFromData(data) {
    var match = data.match(nameRegex);
    return (match === null) ? null : match[1];
}

function getUpvotedCached(hex) {
    if (!(hex in upvotes)) {
        var data = getDataCached(hex);
        if (data === null) {
            return null;
        }
        upvotes[hex] = getUpvoteFromData(data)
    }
    return upvotes[hex];
}

var gpgStart = '-----BEGIN PGP ';
var pubkeyStart = ':pubkey enc packet:';
var symkeyStart = ':symkey enc packet:';
var keyStart = ':public key packet:';

var signatureRegex = /\n:signature packet:.*keyid ([0-9A-F]{16})\n/;
var sigMadeRegex = /gpg: Signature made .* using .* key ID ([0-9A-F]{8})\n/;
var sigErrRegex = / ERRSIG ([0-9A-F]{16}) /;
var sigValidRegex = / VALIDSIG ([0-9A-F]{40}) /;

/*
This should attempt the steps of postPost in reverse. Start trying to
decrypt message using private key, then using one of the shared
secrets, finally try to verify.

In case of combined encryption and signature, empty content is taken
to mean "decryption failed", and content with >0 status code to mean
"verification failed". The case of successfully decrypting the empty
content, but failing to verify is not supported - this is treated as
decryption failure.

--batch --list-packets

:pubkey enc packet:
:symkey enc packet:
:packet 
// otherwise empty content

If it is a pubkey enc and we are the recipient and it's signed, we'll also see:
^:signature packet:

If it's symkey enc then we will have to enumerate our shared keys
before we hit the right one (or not).

*/


// FIXME: use --status-fd more often.

function getDecrypt(params, data, cont) {
    var gpgDir, ch = '', isPubEnc = false, isSymEnc = null, hasPubKey = null, gotPubDec = null,
    keys, key, gpg, gpgStatus, decData, sigRes = '', partial = data, symKeyIdentifier = null, symKeyPkey = null,
    symKeyReadToken = null, signkeyId = null, sigfinger = null, username;

    // TODO: return the key signed with and encrypted to if present.

    function finish() {
        cont({ data: partial, isPubEnc: isPubEnc, gotPubDec: gotPubDec, isSymEnc: isSymEnc,
               symKeyIdentifier: symKeyIdentifier, symKeyPkey: symKeyPkey, symKeyReadToken: symKeyReadToken,
               signkeyId: signkeyId, sigfinger: sigfinger, hasPubKey: hasPubKey });
    }

    function endPubdec(code) {
        if (code !== 0) {
            if (ch === '') {
                gotPubDec = false;
                finish();
                return;
            }
            // signature check failed
            gotPubDec = true;
            var m = sigErrRegex.exec(sigRes);
            if (m !== null) {
                signkeyId = m[1];
            }
            partial = ch;
            finish();
            return;
        }
        gotPubDec = true;
        var m = sigValidRegex.exec(sigRes);
        if (m !== null) {
            sigfinger = m[1];
        }
        partial = ch;
        runListPackets();
    }

    function checkKeyEnd(code) {
        if (code !== 0) {
            if (ch === '') {
                tryUserKeys();
                return;
            }
            // signature check failed
            symKeyIdentifier = key.identifier;
            symKeyReadToken = key.read_token;
            symKeyPkey = key.pkey;
            var m = sigErrRegex.exec(sigRes);
            if (m !== null) {
                signkeyId = m[1];
            }
            partial = ch;
            finish();
            return;
        }

        symKeyIdentifier = key.identifier;
        symKeyReadToken = key.read_token;
        symKeyPkey = key.pkey;
        var m = sigValidRegex.exec(sigRes);
        if (m !== null) {
            sigfinger = m[1];
        }
        partial = ch;
        runListPackets();
    }

    function endSignature(code) {
        var m = sigErrRegex.exec(sigRes);
        if (m !== null) {
            signkeyId = m[1];
        }
        var m = sigValidRegex.exec(sigRes);
        if (m !== null) {
            sigfinger = m[1];
        }
        if (code === 0) {
            partial = ch;
        }
        finish();
    }

    function signatureRead() {
        var str = gpg.stdout.read();
        if (str !== null) {
            ch += str;
        }
    }

    function signatureResultRead() {
        var str = gpg.stdio[3].read();
        if (str !== null) {
            sigRes += str;
        }
    }

    function listPacketsRead() {
        var str = gpg.stdout.read();
        if (str !== null) {
            ch += str;
        }
    }

    function tryUserKeys() {
        if (keys.length === 0) {
            finish();
            return;
        }

        key = keys.pop();
        gpg = child_process.spawn('/usr/bin/gpg',
                                  ['-q', '--batch', '--status-fd', '3', '--passphrase-fd', '0', '--homedir', 'var/gpg/' + gpgDir],
                                  { stdio: ['pipe', 'pipe', 'ignore', 'pipe', 'pipe'] });

        ch = '';
        sigRes = '';
        gpg.stdout.on('close', checkKeyEnd);
        gpg.stdout.on('readable', signatureRead);
        gpg.stdio[3].on('readable', signatureResultRead);
        gpg.stdin.write(key.secret.toString('hex') + '\n');
        gpg.stdin.write(partial);
        gpg.stdin.end();
    }

    function gotUserKeys(result) {
        if (result === null) {
            cont(null);
            return;
        }
        keys = result.rows;
        tryUserKeys();
    }

    function listPacketsEnd() {
        var endFunc = endSignature;
        if (ch.substr(0, symkeyStart.length) === symkeyStart) {
            //loop through the secrets trying each in turn
            isSymEnc = true;
            us_keys_query('SELECT s.pkey,sa.identifier,s.secret,s.read_token FROM secrets AS s, secrets_alias AS sa WHERE sa.username=$1 AND sa.secret=s.pkey',
                          [username],
                          gotUserKeys);
            return;
        }

        if ((ch.substr(0, pubkeyStart.length) === pubkeyStart)) {
            isPubEnc = true;
            endFunc = endPubdec;
            // fall through
        }

        if ((ch.substr(0, keyStart.length) === keyStart)) {
            hasPubKey = true;
            // fall through
        }

        gpg = child_process.spawn('/usr/bin/gpg',
                                  ['-q', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--status-fd', '3'],
                                  { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });
        ch = '';
        sigRes = '';
        gpg.on('close', endFunc);
        gpg.stdout.on('readable', signatureRead);
        gpg.stdio[3].on('readable', signatureResultRead);
        gpg.stdin.write(partial);
        gpg.stdin.end();
    }

    function runListPackets() {
        ch = '';
        sigRes = '';
        gpg = child_process.spawn('/usr/bin/gpg',
                                  ['-q', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--list-packets'],
                                  { stdio: ['pipe', 'pipe', 'ignore'] });

        gpg.stdout.on('readable', listPacketsRead);
        gpg.stdout.on('end', listPacketsEnd);
        gpg.stdin.write(partial);
        gpg.stdin.end();
    }

    function gotUsername(u) {
        username = u;
        gpgDir = getGpgDir(username);

        if (gpgDir === null) {
            cont(null);
            return;
        }

        partial = data;
        runListPackets();
    }

    if (data === '') {
        finish();
    }

    getUsername(params, gotUsername);
}

function importKey() {

    if ((ch.substr(0, keyStart.length) === keyStart)) {
        isPubKey = true;
        gpg = child_process.spawn('/usr/bin/faketime',
                                  ["2000-01-01 00:00:00", '/usr/bin/gpg', '-q', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--status-fd', '3', '--import'],
                                  { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });
        ch = '';
        sigRes = '';
        gpg.on('close', endKey);
        gpg.stdout.on('readable', signatureRead);
        gpg.stdio[3].on('readable', signatureResultRead);
        gpg.stdin.write(partial);
        gpg.stdin.end();
        return;
    }
}

// If there is a parent, returns it
var parents = {
    // 'hex': hex
};

var parentsRegex = /\[parent\]: sha256:([0-9a-f]{64})\n/;

function getPostParentCached(hex, data) {
    if (!(hex in parents)) {
        if (data === null) {
            return null;
        }
        parents[hex] = getPostFromData(data);
    }
    return parents[hex];
}

var user_posts = {
    // 'user': { 'posthash': set({'childhash1', 'childhash2', ...}), ... }
}

function getGpgDir(username) {
    if (username === null) {
        return null;
    }
    var gpgDir = (new Buffer(username, 'utf8')).toString('base64');

    // TODO: give the username an ID so there is no limit on
    // username length
    if (gpgDir.length >= 255) {
        return null;
    }
    return gpgDir;
}

var hexCharsRegex = /^[0-9a-f]+$/;
var keyCreatedRegex = / KEY_CREATED \w+ ([0-9A-F]{40})/;

function postGenerateGpg(params) {
    var gpgDir, gpg, output = '', username, primarykey, fingerprint, res, tokstr = '';

    function problem() {
        sendResponse(params, 500, 'Could not generate keys');
    }

    function insertedOwnPrimarykey(result) {
        redirectTo(params, '/keys');
    }

    function gotToken() {
        if (!tokstr.match(hexCharsRegex)) {
            async_log('Token string not valid: ' + tokstr);
            problem();
            return;
        }

        us_users_query('INSERT INTO pubkey_own (username, primarykey, write_token) VALUES ($1, $2, $3)',
                       [username, primarykey, '\\x' + tokstr],
                       insertedOwnPrimarykey, problem);
    }

    function readToken() {
        var s = res.read();
        if (s !== null) {
            tokstr += s;
        }
    }

    function generatedToken(params, result, r) {
        if (!result) {
            problem();
            return;
        }
        res = r;
        res.setEncoding('ascii');
        res.on('end', gotToken);
        res.on('readable', readToken);
    }

    function insertedPrimarykey(result) {
        primarykey = result.rows[0].pkey;

        var options = {
            hostname: '127.0.0.1',
            port: 7443,
            path: '/token',
            method: 'POST',
            headers: {}
        };
        followUntilSuccess(params, 'https:', options, 'fingerprint=' + fingerprint, generatedToken, 0);
    }

    function gpgClose(code) {
        if (code !== 0) {
            async_log('gpg create failed');
            redirectTo(params, '/error/500');
            return;
        }

        var m = output.match(keyCreatedRegex);
        if (m === null) {
            async_log('no match for created key in output');
            problem();
            return;
        }
        fingerprint = m[1];

        us_users_query('INSERT INTO primarykey (fingerprint) VALUES ($1) RETURNING pkey',
                       ['\\x' + fingerprint],
                       insertedPrimarykey, problem);
    }

    function statusRead() {
        var str = gpg.stdio[3].read();
        if (str !== null) {
            output += str;
        }
    }

    function madeDir(err) {
        if (err !== null) {
            async_log('could not mk gpg dir');
            redirectTo(params, '/error/500');
            return;
        }
        gpg = child_process.spawn('/usr/bin/faketime',
                                  ["2000-01-01 00:00:00", '/usr/bin/gpg', '-q', '--status-fd', '3', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--gen-key'],
                                  { stdio: ['pipe', 'ignore', 'ignore', 'pipe'] });
        gpg.stdio[3].on('readable', statusRead);
        gpg.on('exit', gpgClose);

        // Could use 4096 bit, but this is not the weakest link of
        // security, and doing so would use up extra entropy.
        gpg.stdin.write('Key-Type: RSA\n' +
                        'Key-Length: 2048\n' +
                        'Key-Usage: sign\n' +
                        'Subkey-Type: RSA\n' +
                        'Subkey-Length: 2048\n' +
                        'Subkey-Usage: encrypt\n' +
                        'Creation-Date: 20000101T000000\n' +
                        'Name-Real: Anonymous\n');
//                        'Name-Comment: \n' +
//                        'Name-Email: \n' +

        gpg.stdin.end();
    }

    function gotUsername(u) {
        username = u;
        gpgDir = getGpgDir(username);

        if (gpgDir === null) {
            redirectTo(params, '/error/500');
            return;
        }

        // oct 0700 = dec 448
        fs.mkdir('var/gpg/' + gpgDir, 448, madeDir);
    }

    getUsername(params, gotUsername);
}

var importRegex = /\[GNUPG:\] IMPORT_OK [0-9]+ ([0-9A-F]{40})/;

function importPublicKey(username, pubkey, identifier, success, fail) {

    // FIXME: prevent duplicates and so on.

    var gpg, data = '', fingerprint, primarykey;

    function insertedAlias(result) {
        if (result === null) {
            fail();
            return;
        }
        success(fingerprint, primarykey);
    }

    function selectedKeyPkey(result) {
        primarykey = result.rows[0].pkey;
        us_pubkey_alias_query('INSERT INTO pubkey_alias (username, primarykey, identifier) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM pubkey_alias WHERE username=$1 AND (primarykey=$2 OR identifier=$3))',
                              [username, primarykey, identifier],
                              insertedAlias);
    }

    function insertedKey(result) {
        us_pubkey_alias_query('SELECT pkey FROM primarykey WHERE fingerprint=$1',
                              ['\\x' + fingerprint],
                              selectedKeyPkey);
    }

    function gotImportResult(status) {
        var m = importRegex.exec(data);
        if ((status !== 0) || (m === null)) {
            async_log('bad import status or no key match, status: ' + status + ', data:');
            async_log(data);
            fail();
            return;
        }
        fingerprint = m[1]
        us_pubkey_alias_query('INSERT INTO primarykey (fingerprint) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM primarykey WHERE fingerprint=$1)',
                              ['\\x' + fingerprint],
                              insertedKey);
    }

    function gpgRead() {
        var str = gpg.stdout.read();
        if (str !== null) {
            data += str;
        }
    }

    var gpgDir = getGpgDir(username);

    if (gpgDir === null) {
        fail();
        return;
    }

    gpg = child_process.spawn('/usr/bin/faketime',
                              ["2000-01-01 00:00:00", '/usr/bin/gpg', '--status-fd', '1', '--homedir', 'var/gpg/' + gpgDir, '--import'],
                              { stdio: ['pipe', 'pipe', 'ignore'] });
    gpg.stdout.on('readable', gpgRead);
    gpg.stdin.write(pubkey);
    gpg.stdin.end();
    gpg.on('close', gotImportResult);
}

function postImportGpg(params) {
    var pubkey, identifier;

    function fail() {
        sendResponse(params, 500, 'Could not import key');
    }

    function success(fingerprint, primarykey) {
        sendResponse(params, 200, 'Import successful');
    }

    function gotUsername(username) {
        var gpgDir = getGpgDir(username);

        if (gpgDir === null) {
            redirectTo(params, '/error/500');
            return;
        }

        importPublicKey(username, pubkey, identifier, success, fail);
    }

    function gotFormData(params, uparams) {
        if (!('pubkey' in uparams) || !('identifier' in uparams)) {
            sendResponse(params, 400, 'Missing public key data or identifier alias');
            return;
        }
        pubkey = uparams.pubkey;
        identifier = uparams.identifier;
        getUsername(params, gotUsername);
    }

    getFormData(params, gotFormData);
}

// This returns the list of posts with at least one upvote signed by
// someone in our network.
// Currently it uses looks for 'parent' hash on all keys. Would like
// to allow limiting to a subset of keys, or a single key.
// (network files serve this purpose)

// If I'm having a conversation with someone using our public keys, we
// will be replying more or less in a linear ancestry from the opening
// post, down to the most recent.
// a=[hi~X] b=^a,[hi!~Y], c=^b,[me again~X], ...
// Here ~X keeps downloading new messages in ~Y's stream and vice
// versa.
// Probably the best way of viewing this is by taking * from the root
// node and flattening based on reported time.
// After getting all data from the stream, we build the tree to
// determine which nodes have no parent, and these become the
// "conversations"

// X~ takes all data from Y~'s stream which has a valid signature, and
// is encrypted to X.
// Trees are built with this data, and the roots noted. [what about
// replies to content on another stream - should these be "roots"?
// Especially replies to our own stream's data!]

//------
/*
fetch *all* authenticated content (from group and pubkey channels)
build a set of trees
in particular, for each node record the immediate parent (or null)
the immediate parent is as appears in ~post tag
the ultimate parent follows this until the immediate parent is null,
or the immediate parent is not in the authenticated set.
The set of ultimate parents are the start of "conversations" that we
are privy to.

UI: The default tree view can be time linearised from any node
down. If two approximately linear conversations appear off the same
parent, they can both be linearised into distinct streams, and back
afterwards. These are "stream" view and "tree" view. "collapse" view
is the same for both, and as in Reddit.

The UI should automatically go in collapse mode for all terminating
branches.

P
-C1
| C11
|  C12
-C2
| C21
|  C22

P
-C1
|C11
|C12
-C2
|C21
|C22
*/

function getDataPosts(params, cont) {
    var hash = null;
    var waiting = 0, username;

    function problem(err) {
        sendResponse(params, 500, 'There was a problem');
    }

    function sendFinal(result) {
        cont(params, hash, result);
    }

    // Note: selecting parent=NULL won't catch replies to content we
    // haven't verified, eg. the content "Sport". We may be better off
    // leaving the parent=$2 selection out and looping over the
    // results manually.
    // However, it is possible to select for these too, we just need
    // to check parent!=null and parent is not a verified post.
    // In a chain of replies to an unverified account, we need to keep
    // following until we reach the root node, and only display the
    // nearest one to that, otherwise each reply will look like a
    // separate conversation.
    function selectPosts() {
        // FIXME: check that if it's pubkey we're in the recipients
        // list, and if it's group key we have the group key.
        var query = 'SELECT s.sha256 FROM nodes AS n, sha256 AS s WHERE n.parent=(SELECT pkey FROM sha256 WHERE sha256=$2) AND n.tag=1 AND (((n.signkey IN (SELECT primarykey FROM pubkey_alias WHERE username=$1)) OR (n.signkey IN (SELECT primarykey FROM pubkey_own WHERE username=$1)) OR (n.groupKey IN (SELECT secret FROM secrets_alias WHERE username=$1))) OR (n.pkey IN (SELECT parent FROM nodes WHERE tag=2 AND ((signkey IN (SELECT primarykey FROM pubkey_alias WHERE username=$1)) OR (signkey IN (SELECT primarykey FROM pubkey_own WHERE username=$1)) OR (groupKey IN (SELECT secret FROM secrets_alias WHERE username=$1)))))) AND n.sha256=s.pkey';
        us_nodes_query(query,
                       [username, '\\x' + hash],
                       sendFinal, problem);
    }

    function gotUsername(u) {
        username = u;
        if (username === null) {
            var status = 403;
            var body = '<h1>403 Forbidden: You must be logged in </h1><a href="/">Continue</a>';
            sendResponse(params, status, body);
            return;
        }

        var query = url.parse(params.request.url, true).query;

        if ('parent' in query) {
            hash = query.parent;
        }

        // a) If we do not yet have an up-to-date list of our network's
        // current upvotes (non-repudiated), retrieve that by looping over
        // each peer.
        // a.1) For each peer, download everything they've ever signed
        // a.2) For each of those content, get a filter list of their upvotes, downvotes, and novotes
        // a.3) Where multiple votes are cast on the same content by a user, take only the most recent one.
        // b) For each of the upvotes above, download the content it references.
        // c) Filter the list to only those containing "~post($hash)"

        // lists contains all of the newly discovered hashes (possibly
        // with duplicates)
        refreshPeerContent(params, username, selectPosts);
    }

    getUsername(params, gotUsername);
}

function gotDataPostsHtml(params, hash, result) {
    // FIXME: by default comment in same manner as hash: normally either signed plaintext or group key
    var html = ('<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body>' +
                '    <form action="/posts" method="POST">\n' +
                '      <input type="hidden" name="parent" value="' + hash + '">\n' +
                '      <textarea name="content"></textarea>\n' +
                '      <input value="submit" type="submit">\n' +
                '    </form>' +
                '<ul>');
    var posts = result.rows;
    for (var k = 0, klen = posts.length; k < klen; ++k) {
        var hex = posts[k].sha256.toString('hex');
        html += '<li><a class="hash" href="/post/' + hex + '">' + hex + '</a></li>';
    }
    html += '</ul><div><a href="/posts/form' + (hash !== null ? '?parent=' + hash : '') + '">Add</a></div>';
    html += '<div><a href="/">Home</a></div></body></html>';

    sendResponse(params, 200, html);
}

function gotDataPostsJson(params, hash, result) {
    // FIXME: by default comment in same manner as hash: normally either signed plaintext or group key
    var posts = result.rows;
    var k = 0, klen = posts.length;
    var str = '[';

    if (k < klen) {
        str += '"' + posts[k].sha256.toString('hex') + '"';
        ++k;
    }
    for (; k < klen; ++k) {
        str += ',"' + posts[k].sha256.toString('hex') + '"';
    }
    str += ']';
    sendResponse(params, 200, str);
}

function getDataPostsHtml(params) {
    getDataPosts(params, gotDataPostsHtml);
}

function getDataPostsJson(params) {
    getDataPosts(params, gotDataPostsJson);
}

// Show all the root nodes associated with the group.
// Initially it doesn't need to consider nodes that are non-root but
// also not replies to the same group.
function getGroupRootsPageHtml(params) {
    var body, status, hash = null;
    var waiting = 0, username, groupKey;

    function problem(err) {
        sendResponse(params, 500, 'There was a problem');
    }

    function sendFinal(result) {
        var html = ('<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body>' +
                    '    <form action="/posts" method="POST">\n' +
                    '      <input type="hidden" name="symKey" value="' + groupKey + '">\n' +
                    '      <textarea name="content"></textarea>\n' +
                    '      <input value="submit" type="submit">\n' +
                    '    </form>' +
                    '<ul class="comments">');
        var posts = result.rows;
        for (var k = 0, klen = posts.length; k < klen; ++k) {
            var hex = posts[k].sha256.toString('hex');
            html += '<li><a class="hash" href="/post/' + hex + '">' + hex.substring(0, 8) + '</a><a class="comments" href="/posts?parent=' + hex + '">comments</a></li>';
        }
        html += '</ul><div><a href="/posts/form' + (hash !== null ? '?parent=' + hash : '') + '">Add</a></div>';
        html += '<div><a href="/">Home</a></div><script type="text/javascript" deferred="deferred" src="/jquery"></script><script type="text/javascript" deferred="deferred" src="/markdown"></script><script type="text/javascript" deferred="deferred" src="/script"></script></body></html>';

        sendResponse(params, 200, html);
    }

    // Note: selecting parent=NULL won't catch replies to content we
    // haven't verified, eg. the content "Sport". We may be better off
    // leaving the parent=$2 selection out and looping over the
    // results manually.
    // However, it is possible to select for these too, we just need
    // to check parent!=null and parent is not a verified post.
    // In a chain of replies to an unverified account, we need to keep
    // following until we reach the root node, and only display the
    // nearest one to that, otherwise each reply will look like a
    // separate conversation.
    function selectPosts() {

        us_users_query('SELECT sh.sha256 FROM nodes AS n, sha256 AS sh, secrets AS s, secrets_alias AS sa WHERE s.read_token=$2 AND sa.secret=s.pkey AND sa.username=$1 AND n.groupKey=s.pkey AND sh.pkey=n.sha256 AND n.parent IS NULL',
                       [username, '\\x' + groupKey],
                       sendFinal, problem);

        // FIXME: check that if it's pubkey we're in the recipients
        // list, and if it's group key we have the group key.
/*
        var query = 'SELECT s.sha256 FROM nodes AS n, sha256 AS s WHERE n.parent=(SELECT pkey FROM sha256 WHERE sha256=$2) AND n.tag=1 AND (((n.signkey IN (SELECT primarykey FROM pubkey_alias WHERE username=$1)) OR (n.signkey IN (SELECT primarykey FROM pubkey_own WHERE username=$1)) OR (n.groupKey IN (SELECT secret FROM secrets_alias WHERE username=$1))) OR (n.pkey IN (SELECT parent FROM nodes WHERE tag=2 AND ((signkey IN (SELECT primarykey FROM pubkey_alias WHERE username=$1)) OR (signkey IN (SELECT primarykey FROM pubkey_own WHERE username=$1)) OR (groupKey IN (SELECT secret FROM secrets_alias WHERE username=$1)))))) AND n.sha256=s.pkey';
        us_nodes_query(query,
                       [username, hash],
                       sendFinal, problem);
*/

    }

    function gotUsername(u) {
        username = u;
        if (username === null) {
            status = 403;
            body = '<h1>403 Forbidden: You must be logged in </h1><a href="/">Continue</a>';
            sendResponse(params, status, body);
            return;
        }

        var query = url.parse(params.request.url, true).query;

        if ('group' in query) {
            if (query.group.match(shab64Regex) === null) {
                // TODO: prettier error handling
                sendResponse(params, 400, 'Invalid group key');
                return;
            }
            groupKey = (new Buffer(query.group, 'base64')).toString('hex');
        }

        // a) If we do not yet have an up-to-date list of our network's
        // current upvotes (non-repudiated), retrieve that by looping over
        // each peer.
        // a.1) For each peer, download everything they've ever signed
        // a.2) For each of those content, get a filter list of their upvotes, downvotes, and novotes
        // a.3) Where multiple votes are cast on the same content by a user, take only the most recent one.
        // b) For each of the upvotes above, download the content it references.
        // c) Filter the list to only those containing "~post($hash)"

        // lists contains all of the newly discovered hashes (possibly
        // with duplicates)
        refreshPeerContent(params, username, selectPosts);
    }

    getUsername(params, gotUsername);
}

function getPostsFormHtml(params) {
    var query = url.parse(params.request.url, true).query, parent = null, groupKey = null;

    if ('parent' in query) {
        if (!looksLikeSha(query.parent)) {
            // TODO: prettier error handling
            sendResponse(params, 400, 'Doesnt look like a SHA');
            return;
        }
        parent = query.parent;
    }

    if ('group' in query) {
        if (query.group.match(shab64Regex) === null) {
            // TODO: prettier error handling
            sendResponse(params, 400, 'Invalid group key');
            return;
        }
        groupKey = (new Buffer(query.group, 'base64')).toString('hex');
    }

    var body = ('<!DOCTYPE html><html><head></head><body>' +
                '    <form action="/posts" method="POST">\n' +
                (parent !== null ? '      <input type="hidden" name="parent" value="' + parent + '">\n' : '') +
                (groupKey !== null ? '      <input type="hidden" name="symKey" value="' + groupKey + '">\n' : '') +
                '      <textarea name="content"></textarea>\n' +
                '      <input value="submit" type="submit">\n' +
                '    </form><a href="/posts">Back</a></body></html>');

    sendResponse(params, 200, body);
}

function gotPostItem(params, cont) {
    var hash, data, parent, decrypt = null;

    function printLiteral() {
        cont(params, hash, data, decrypt, parent);
    }

    function gotDecrypt(dec) {
        if (dec !== null) {
            decrypt = dec;
            data = dec.data;
            parent = getPostFromData(dec.data);
        }
        printLiteral();
    }

    function gotPostItemLiteral(ctx, h, d) {
        hash = h;
        data = d;

        if (data === null) {
            // TODO: add some knowledge of 410 hashes
            sendResponse(params, 404, 'No such hash <a href="/posts">Back</a>');
            return;
        }

        // Note we only try decrypting if the current content doesn't
        // show a ~post()
        parent = getPostParentCached(hash, data);
        getDecrypt(params, data, gotDecrypt);
    };

    return gotPostItemLiteral;
}

function gotPostItemHtml(params, hash, data, decrypt, parent) {
    var parentLink = (parent === null) ? (decrypt.symKeyReadToken !== null ? '<a href="/grouproots?group=' + decrypt.symKeyReadToken.toString('base64').replace(unreplaceB64Regex, unreplaceB64) + '">' + decrypt.symKeyIdentifier + ' comments</a>' : '') : '<div><a href="/post/' + parent + '">Parent</a></div>';

    var verified = '<span>(Unverified)</span>', group = '', pubkey = '', by = 'Anonymous';
    if (decrypt !== null) {
        if (decrypt.sigfinger !== null) {
            verified = '<span>(Verified)</span>';
        }
        if (decrypt.signkeyId !== null) {
            by = htmlEscape(decrypt.signkeyId);
        }
        if (decrypt.symKeyIdentifier !== null) {
            group = '<span>Group: ' + htmlEscape(decrypt.symKeyIdentifier) + '</span>';
        }
        if (decrypt.isPubEnc === true) {
            pubkey = '<span>Private</span>';
        }
    }
    var replyArgs = decrypt.symKeyReadToken !== null ? '&group=' + decrypt.symKeyReadToken.toString('base64').replace(unreplaceB64Regex, unreplaceB64) : '';

    var title = '';
    var body = ('<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body>' + htmlEscape(title) + '<h2 class="hash">' +
                hash +
                '</h2><pre>' +
                htmlEscape(data.replace(parentsRegex, '')) +
                '</pre><div>By: ' + by + ' ' + verified + '</div>' + group + pubkey + '<form action="/vote" method="POST"><input type="submit" name="vote" value="upvote"></form>' + parentLink + '<div><a href="/posts?parent=' + hash + '">Comments</a><div><a href="/posts/form?parent=' + hash + replyArgs + '">Reply</a></div></div><div></div><script type="text/javascript" src="/script?v=0"></script></body></html>');

    sendResponse(params, 200, body);
}

function gotPostItemJson(params, hash, data, decrypt, parent) {
    sendResponse(params, 200,
                 JSON.stringify({
                     hash: hash,
                     data: data,
                     symKeyReadToken: decrypt.symKeyReadToken !== null ? decrypt.symKeyReadToken.toString('base64') : null,
                     symKeyIdentifier: decrypt.symKeyIdentifier,
                     sigfinger: decrypt.sigfinger,
                     signkeyId: decrypt.signkeyId,
                     isPubEnc: decrypt.isPubEnc
                 }));
}

function getPostItemHtml(params) {
    var hash = params.urlparts.pathname.substring('/post/'.length);

    getDataItemAndIndex(null, hash, gotPostItem(params, gotPostItemHtml));
}

function getPostItemJson(params) {
    var hash = params.urlparts.pathname.substring('/post/'.length);

    getDataItemAndIndex(null, hash, gotPostItem(params, gotPostItemJson));
}

function getStyleCss(params) {
    // 365 days
    params.headers['Cache-Control'] = 'max-age=31536000';
    // TODO: pre gzip -9 this into a new Buffer
    sendResponse(params, 200, ui_server_css);
}

function getScriptJs(params) {
    params.contentType = 'text/javascript; charset=utf-8';
    // 365 days
    params.headers['Cache-Control'] = 'max-age=31536000';
    // TODO: pre gzip -9 this into a new Buffer
    sendRawResponse(params, 200, ui_server_js);
}

function getJqueryJs(params) {
    params.contentType = 'text/javascript; charset=utf-8';
    // 365 days
    params.headers['Cache-Control'] = 'max-age=31536000';
    // TODO: pre gzip -9 this into a new Buffer
    sendRawResponse(params, 200, jquery_js);
}

function getMarkdownJs(params) {
    params.contentType = 'text/javascript; charset=utf-8';
    // 365 days
    params.headers['Cache-Control'] = 'max-age=31536000';
    // TODO: pre gzip -9 this into a new Buffer
    sendRawResponse(params, 200, markdown_js);
}

function followUntilSuccess(params, protocol, options, payload, cont, scount) {
    function gotResponse(res) {
        if (res.statusCode >= 200 && res.statusCode <= 299) {
            cont(params, true, res);
            return;
        }
        if (res.statusCode >= 301 && res.statusCode <= 399) {
            if (!('location' in res.headers)) {
                async_log('bad location');
                async_log(JSON.stringify(res.headers));
                cont(params, false);
                return;
            }
            if (scount > 8) {
                async_log('too much redirect');
                cont(params, false);
                return;
            }
            var u = url.parse(res.headers.location);
            var newoptions = {
                hostname: u.hostname === null ? options.hostname : u.hostname,
                port: u.port === null ? options.port : u.port,
                path: u.path,
                method: 'HEAD'
            };
            followUntilSuccess(params, u.protocol === null ? protocol : u.protocol, newoptions, null, cont, scount + 1);
            return;
        }
        async_log('bad status');
        async_log(res.statusCode);

        cont(params, false);
    }

    var req;
    if (protocol === 'https:') {
        if (options.hostname === '127.0.0.1') {
            options.rejectUnauthorized = false;
        }
        req = https.request(options, gotResponse);
    } else if (protocol === 'http:') {
        req = http.request(options, gotResponse);
    } else {
        async_log('bad protocol');
        async_log(protocol);
        cont(params, false);
        return;
    }

    req.on('error', logError);
    req.end(payload);
}

function getPostsFormResultHtml(params) {
    var body;
    var query = url.parse(params.request.url, true).query;
    if (!('sha256' in query) || !looksLikeSha(query.sha256)) {
        sendResponse(params, 400, 'invalid sha <a href="/posts">Back</a>');
        return;
    }
    // FIXME: check that the data was posted
    if (!query.sha256) {
        sendResponse(params, 500, 'data was not posted <a href="/posts">Back</a>');
        return;
    }
    sendResponse(params, 200,
                 ('data was posted <div><a class="hash" href="/post/' + query.sha256 + '">' +
                  query.sha256 + '</a></div><div><a href="/posts">Back</a></div>'));
}

function postFailed(params) {
    sendResponse(params, 500, 'Could not submit post');
}

function postKeySend(params) {
    /*
      If the target is a Pubkey, encrypt to the Pubkey, sign by us, post on our own channel
      If the target is a Symkey, post on the group channel

either:
~name(foobar)
-----BEGIN PGP PUBLIC KEY BLOCK-----

~name(foobar)
~key(5c8c86baa6c4c0b7daff2b326f22383a7e16642b490e8d67711db22cec94c91c)


      On the receiving end, the retriever will find:
      :public key packet:
      Ideally we should include a name for it, and the signer/group it
      was found in.

      This should then appear in the receiver's key list as either:
      "[from: userbob] name"
      "[from: bob] name"

      Now we just need to automatically add this on downloading data
      from the stream.
      Currently we have isupvoted, with (!isupvote && parent!=null)
      implying a post. Potentially, this could be changed to a
      smallint "type" value, with 1=upvote 2=post 4=symkey 8=pubkey
      This would take up the same amount of space as two boolean
      fields anyway i think

    */

    var uparams, identifier, toPost, username;

    function problem() {
        sendResponse(params, 500, 'Could not send key');
    }

    function postFinished(params, hex) {
        redirectTo(params, '/keys');
    }

    function gotSymKeyTo(result) {
        if (result.rows.length !== 1) {
            problem();
            return;
        }
        postPostInner(params, false, uparams.to.substr(1), null,  toPost,
                      postFinished, postFailed);
    }

    function gotPubKeyTo(result) {
        if (result.rows.length !== 1) {
            problem();
            return;
        }
        postPostInner(params, true, null, uparams.to.substr(1), toPost,
                      postFinished, postFailed);
    }

    function sendKey(data) {
        toPost = data;

        // now post it to either a group channel, or signed on own channel
        var to = uparams.to;
        if ((to.length === 41) && (to[0] === 'k')) {
            // TODO: validate hex param first
            us_users_query('SELECT pa.identifier FROM pubkey_alias AS pa, primarykey AS pk WHERE pa.username=$1 AND pk.fingerprint=$2 AND pa.primarykey=pk.pkey',
                           [username, '\\x' + to.substr(1)],
                           gotPubKeyTo, problem);
        } else if ((to.length === 65) && (to[0] === 'c')) {
            // TODO: validate hex param first
            us_users_query('SELECT 1 FROM secrets_alias AS sa, secrets AS s WHERE sa.username=$1 AND s.read_token=$2 AND sa.secret=s.pkey',
                           [username, '\\x' + to.substr(1)],
                           gotSymKeyTo, problem);
        } else {
            sendResponse(params, 400, 'Invalid key value');
            return;
        }
    }

    function gotSymKeyIdentifier(result) {
        sendKey('~name(' + result.rows[0].identifier + ')\n~key(' + result.rows[0].secret.toString('base64') + ')');
    }

    function gotPublicKey(key) {
        sendKey('~name(' + identifier + ')\n' + key);
    }

    function gotPubkeyIdentifier(result) {
        identifier = result.rows[0].identifier;
        getPublicKey(uparams.to.substr(1), gotPublicKey, problem);
    }

    function gotUsername(u) {
        username = u;
        var gpgDir = getGpgDir(username);

        if (gpgDir === null) {
            redirectTo(params, '/error/500');
            return;
        }

        var key = uparams.key;
        if ((key.length === 41) && (key[0] === 'k')) {
            // TODO: validate hex param first
            // TODO: sending our own key
            us_users_query('SELECT pa.identifier FROM pubkey_alias AS pa, primarykey AS pk WHERE pa.username=$1 AND pk.fingerprint=$2 AND pa.primarykey=pk.pkey',
                           [username, '\\x' + key.substr(1)],
                           gotPubkeyIdentifier, problem);
        } else if ((key.length === 65) && (key[0] === 'c')) {
            // TODO: validate hex param first
            us_users_query('SELECT sa.identifier,s.secret FROM secrets_alias AS sa, secrets AS s WHERE sa.username=$1 AND s.read_token=$2 AND sa.secret=s.pkey',
                           [username, '\\x' + key.substr(1)],
                           gotSymKeyIdentifier, problem);
        } else {
            sendResponse(params, 400, 'Invalid key value');
            return;
        }
    }

    function gotFormData(params, up) {
        uparams = up
        if (!('key' in uparams) || !('to' in uparams)) {
            sendResponse(params, 400, 'Missing key name or recipient');
            return;
        }
        getUsername(params, gotUsername);
    }

    getFormData(params, gotFormData);
}

function importGroupKey(username, secret, identifier, success, fail) {
    var shasum, hashparts = [], wtokenbuf;

    function insertedAlias(result) {
        if (result === null) {
            fail();
            return;
        }
        success();
    }

    function selectedPkey(result) {
        us_keys_query("INSERT INTO secrets_alias (username, identifier, secret, ignore_new) VALUES ($1, $2, $3, false)",
                      [username, identifier, result.rows[0].pkey],
                      insertedAlias, fail);
    }

    function insertedKey(result) {
        us_users_query('SELECT pkey FROM secrets WHERE secret=$1',
                       ['\\x' + secret.toString('hex')],
                       selectedPkey, fail);
    }

    function shasumRead() {
        var buf = shasum.read();
        if (buf !== null) {
            hashparts.push(buf);
        }
    }

    function readShasumEnd() {
        var rtokenbuf = Buffer.concat(hashparts);
        var rtoken = rtokenbuf.toString('base64');

        us_keys_query("INSERT INTO secrets (secret, write_token, read_token) SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM secrets WHERE secret=$1)",
                      ['\\x' + secret.toString('hex'), '\\x' + wtokenbuf.toString('hex'), '\\x' + rtokenbuf.toString('hex')],
                      insertedKey, fail);
    }

    function shasumEnd() {
        // take the low 144 bits as our Write token
        wtokenbuf = Buffer.concat(hashparts).slice(64 - 18);

        // now derive the Read token from the Write token
        // Note, read_token is the sha256 of the write_token base64,
        // not the write token binary

        hashparts = []
        shasum = crypto.createHash('sha256');
        shasum.on('readable', shasumRead);
        shasum.on('end', readShasumEnd);
        if (wtokenbuf.length !== 0) {
            shasum.write(wtokenbuf.toString('base64'));
        }
        shasum.end();
    }

    // First, do SHA512 of the secret,
    // take the low 144 bits as base64 - this is the Write key.
    // take the sha256 of this to get the Read key.
    // The low 32 bits as hex are the "key id", though any amount
    // of the Read key could be used.

    shasum = crypto.createHash('sha512');
    shasum.on('readable', shasumRead);
    shasum.on('end', shasumEnd);
    shasum.write(secret);
    shasum.end();
}

// FIXME: check for existing identifier first!!
function postGenerateUserKey(params) {
    var identifier, username;

    function success() {
        redirectTo(params, '/keys');
    }

    function fail() {
        sendResponse(params, 500, 'Failed to generate a new key');
    }

    function gotBytes(err, secret) {
        if (err !== null) {
            fail();
            return;
        }

        importGroupKey(username, secret, identifier, success, fail);
    }

    function gotUsername(u) {
        username = u;
        if (username === null) {
            sendResponse(params, 403, 'You must be logged in to generate a new key');
            return;
        }

        crypto.randomBytes(32, gotBytes);
    }

    function gotFormData(params, uparams) {
        if (!('identifier' in uparams) || (uparams.identifier === '')) {
            sendResponse(params, 400, 'Please specify a key identifier');
            return;
        }
        identifier = uparams.identifier;
        getUsername(params, gotUsername);
    }

    getFormData(params, gotFormData);
}

// Assume that ours is the only Ultimately trusted key
var pubKeyRegex = /\npub:u:2048:1:([0-9A-F]{16})/;

function getPublicKeyId(username, cont, fail) {
    var gpg, data = '';

    function gpgRead() {
        var str = gpg.stdout.read();
        if (str !== null) {
            data += str;
        }
    }

    function gotListKeys() {
        var m = pubKeyRegex.exec(data);
        if (m === null) {
            async_log('gpg output had no public key!');
            fail();
            return;
        }

        cont(m[1]);
    }

    var gpgDir = getGpgDir(username);
    if (gpgDir === null) {
        return;
    }

    gpg = child_process.spawn('/usr/bin/gpg',
                              ['--homedir', 'var/gpg/' + gpgDir, '--list-keys', '--with-colons'],
                              { stdio: ['ignore', 'pipe', 'ignore'] });
    gpg.stdout.on('readable', gpgRead);
    gpg.on('close', gotListKeys);
}

function getPublicKey(fingerprint, cont, fail) {
    var gpg, gpgDir, data = '';

    function gotPubKey(status) {
        cont(data);
    }

    function gpgRead() {
        var str = gpg.stdout.read();
        if (str !== null) {
            data += str;
        }
    }

    function gotPublicKeyId(pubkey) {
        data = '';
        gpg = child_process.spawn('/usr/bin/faketime',
                                  ["2000-01-01 00:00:00", '/usr/bin/gpg', '-qa', '--homedir', 'var/gpg/' + gpgDir, '--no-emit-version', '--export', pubkey],
                                  { stdio: ['ignore', 'pipe', 'ignore'] });
        gpg.stdout.on('readable', gpgRead);
        gpg.on('close', gotPubKey);

    }

    function gotTargetUsername(result) {
        if (result.rows.length === 0) {
            fail();
            return;
        }
        var targUsername = result.rows[0].username;
        gpgDir = getGpgDir(targUsername);
        if (gpgDir === null) {
            return;
        }
        getPublicKeyId(targUsername, gotPublicKeyId, fail);
    }

    us_users_query('SELECT po.username FROM pubkey_own AS po, primarykey AS pk WHERE pk.fingerprint=$1 AND po.primarykey=pk.pkey',
                   ['\\x' + fingerprint],
                   gotTargetUsername, fail);
}

function getPublicKeyHtml(params) {
    var gpg, gpgDir, data = '';

    function problem() {
        sendResponse(params, 500, 'error getting public key');
    }

    function gotPublicKey(data) {
        sendResponse(params, 200, '<!DOCTYPE html><html><head></head><body><pre>' + htmlEscape(data) + '</pre></body></html>');
    }

    var fingerprint = params.urlparts.pathname.substring('/pubkey/'.length);
    getPublicKey(fingerprint, gotPublicKey, problem);
}

function formatPubkeyId(pubkey) {
    var rv;
    var len = pubkey.length;
    if (len >= 8) {
        rv = pubkey.substring(len - 8, len);
    } else {
        rv = pubkey;
    }
    return '<span style="hash">' + rv + '</span>';
}

function getKeys(params) {
    var username, groupKeys, knownKeys;

    function gotPublicKey(result) {
        var pubkey = result.rows[0];
        var pubkeyFinger = pubkey.fingerprint.toString('hex').toUpperCase();
        var pubkeyId = pubkeyFinger.substr(32, 8);
        var pubkeyStr = '';

        if (pubkeyStr !== null) {
            pubkeyStr = '<p>Your Key: <a class="hash" href="/pubkey/' + pubkeyFinger + '">' + pubkeyId + '</a> ' + htmlEscape(username) + '</p>';
        }
        var body = '<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body>' + pubkeyStr + '<div><h2>Keys</h2><ul>';

        for (var i = 0, len = knownKeys.length; i < len; ++i) {
            var keyfinger = knownKeys[i].fingerprint.toString('hex').toUpperCase();
            body += '<li><a class="hash" href="/pubkey/' + keyfinger + '">' +  keyfinger.substr(32, 8) + '</a> ' + htmlEscape(knownKeys[i].identifier) + '</li>';
        }
        body += '</ul><form method="POST" action="/key/import"><div><input type="text" name="identifier"></div><div><textarea name="pubkey"></textarea></div><input type="submit" name="action" value="Import"></form><div><h2>Groups</h2><ul>';

        for (var i = 0, len = groupKeys.length; i < len; ++i) {
            body += '<li><span class="hash">' + htmlEscape(groupKeys[i].read_token.toString('hex', 28, 32).toUpperCase()) + '</span> ' + htmlEscape(groupKeys[i].identifier) + '<form action="/posts/form" method="GET"><input type="hidden" name="group" value="' + groupKeys[i].read_token.toString('base64').replace(unreplaceB64Regex, unreplaceB64) + '"><input type="submit" value="Send message"></form><a href="/grouproots?group=' + groupKeys[i].read_token.toString('base64').replace(unreplaceB64Regex, unreplaceB64) + '">View messages</a></li>';
        }
        body += '</ul><form method="POST" action="/key/generate"><input type="text" name="identifier"><input type="submit" name="action" value="Generate"></form></div><div><form action="/key/send" method="POST"><label for="sendkey">Send key</label> <select name="key" id="sendkey">';

        var keyOptions = '';
        for (var i = 0, len = knownKeys.length; i < len; ++i) {
            keyOptions += '<option value="k' + knownKeys[i].fingerprint.toString('hex') + '">' + htmlEscape(knownKeys[i].identifier) + '</option>'
        }
        for (var i = 0, len = groupKeys.length; i < len; ++i) {
            keyOptions += '<option value="c' + groupKeys[i].read_token.toString('hex') + '">' + htmlEscape(groupKeys[i].identifier) + '</option>'
        }
        body += '<option value="k' + pubkeyFinger + '" selected="selected">My Key</option>' + keyOptions;
        body += '</select> <label for="sendto">to</label> <select name="to" id="sendto">';
        body += '<option value="" selected="selected"></option>' + keyOptions;
        body += '</select> <input type="submit" value="Send"></form></div><div><h2>Networks</h2><ul>';

        for (var i = 0, len = 1; i < len; ++i) {
            body += '<li>' + htmlEscape('Tech (public)') + '</li>';
            body += '<li>' + htmlEscape('Friends (private)') + '</li>';
        }
        body += '</ul><form action="/network/publish" method="POST"><label for="networkfrom">Publish network</label> <select id="networkfrom"><option value="" selected="selected"></option><option value="caf3af6d893b5cb8eae9a90a3054f370a92130863450e3299d742c7a65329d94">Tech</option><option value="7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730">Friends</option></select> <label for="keyto">to</label> <select id="keyto"><option value="" selected="selected"></option><option value="7B6931">user2</option><option value="65329D94">keybob</option></select> <input type="submit" value="Send"></form></div><a href="/">Home</a></body></html>';

        sendResponse(params, 200, body);
    }

    function gotPubkeyAliases(result) {
        if (result === null) {
            sendResponse(params, 500, 'Could not get list of known keys');
            return;
        }
        knownKeys = result.rows;
        us_pubkey_alias_query('SELECT pk.fingerprint FROM pubkey_own AS po, primarykey AS pk WHERE po.username=$1 AND po.primarykey=pk.pkey',
                              [username],
                              gotPublicKey);
    }

    function gotKeys(r) {
        if (r === null) {
            sendResponse(params, 500, 'Could not fetch keys list');
            return;
        }
        groupKeys = r.rows;

        us_pubkey_alias_query('SELECT pa.identifier, pk.fingerprint FROM pubkey_alias AS pa, primarykey AS pk WHERE pa.username=$1 AND pa.primarykey=pk.pkey',
                              [username],
                              gotPubkeyAliases);
    }

    function hasGpgDir(exists) {
        if (exists) {
            us_keys_query('SELECT sa.identifier, s.read_token FROM secrets AS s, secrets_alias AS sa WHERE sa.username=$1 AND sa.secret=s.pkey',
                          [username],
                          gotKeys)
        } else {
            sendResponse(params, 200, '<form method="POST" action="/gpg/generate"><input type="submit" name"action" value="Generate GPG keys"></form>');
        }
    }

    function gotUsername(u) {
        username = u;
        if (username === null) {
            sendResponse(params, 403, 'You must be logged in to generate a new key');
            return;
        }

        var gpgDir = getGpgDir(username);

        if (gpgDir === null) {
            sendResponse(params, 500, 'Your username is too long, please register a shorter one');
            return;
        }

        fs.exists('var/gpg/' + gpgDir, hasGpgDir);
    }
    getUsername(params, gotUsername);
}


// TODO: limit upload size to something smallish like 128K. This is
// useful at this level to stop uploads hogging connections and to
// reduce the amount of data being SHA'd.
/*
  Valid combinations
  s g p
        - public, unsigned, only useful if the document is self-authenticating
      X - only useful if document is self-authenticating and needs privacy
    X   - anyone in group could have written it
    X X - like private, but authenticated as group
  X     - public, signed
  X   X - private and signed by us
  X X   - signed by us, readable by rest of group
  X X X - signed by us, and the group, private (why not just use 6?)
 */
function postPostInner(params, useSign, toSymKey, toPubKey, thePost, cont, fail) {
    var hasSign = false, hasGroup = false, hasPrivate = false;
    var keyid = null, gpgDir = null, writeToken;
    var cipher, shasum, username, enc = '', digest;

    function postFinished(params, result) {
        if (!result) {
            fail(params);
            return;
        }
        cont(params, digest);
    }

    function sendPost(hname, hvalue) {
        var headers = { Accept: 'text/plain' };
        headers[hname] = hvalue;

        // TODO: change to PUT when possible
        var options = {
            hostname: '127.0.0.1',
            port: 7443,
            path: '/data',
            method: 'POST',
            headers: headers
        };
        followUntilSuccess(params, 'https:', options, thePost, postFinished, 0);
    }

    function gotPubKeyWriteToken(result) {
        sendPost('X-K', result.rows[0].write_token.toString('base64'));
    }

    function shasumRead() {
        digest = shasum.read(64);

        if (digest === null) {
            return;
        }

        if ((toPubKey !== null) || (toSymKey === null)) {
            us_users_query('SELECT write_token FROM pubkey_own WHERE username=$1',
                           [username],
                           gotPubKeyWriteToken, fail);
        } else {
            sendPost('X-C', writeToken.toString('base64'));
        }
    }

    function finishPost() {
        shasum = crypto.createHash('sha256');
        shasum.setEncoding('hex');
        shasum.on('readable', shasumRead);
        shasum.write(thePost);
        shasum.end();
    }

    function finishSign() {
        thePost = enc;
        hasSign = true;
        continuePost();
    }

    function finishGroup() {
        thePost = enc;
        hasGroup = true;
        continuePost();
    }

    function finishPrivate() {
        thePost = enc;
        hasPrivate = true;
        continuePost();
    }

    function cipherRead() {
        var str = cipher.stdout.read();
        if (str !== null) {
            enc += str;
        }
    }

    function gotUserKey(result) {
        if ((result === null) || (result.rows.length !== 1)) {
            redirectTo(params, '/error/500');
            return;
        }
        var key = result.rows[0].secret;
        writeToken = result.rows[0].write_token;

        var gpgDir = getGpgDir(username);
        if (gpgDir === null) {
            redirectTo(params, '/error/500');
            return;
        }

        /*
          --s2k-count 1024
          Relying on a high s2k-count for security is not good, only
          scrypt would give any real protection.
          Instead security is maintained by the use of 256 bit random
          keys.
          In theory --s2k-mode 0 would be safe, but I've left it at 3
          with a small s2k-count instead.

          --s2k-digest-algo SHA512
          SHA-1 output is 160 bits, which is too small.
          Using SHA-512 instead of SHA-256 because why not?

          --cipher-algo AES256
          Generally the most recommended cipher to use.
         */

        // uses passphrase-fd 0 because adding 'pipe' 3 doesn't seem
        // writeable, even without faketime
        var args = ['2000-01-01 00:00:00', '/usr/bin/gpg', '-qac', '--batch', '--no-emit-version', '--passphrase-fd', '0', '--homedir', 'var/gpg/' + gpgDir,
                    '--s2k-digest-algo', 'SHA512', '--s2k-count', '1024', '--cipher-algo', 'AES256'];
        if (useSign) {
            args.push('-s');
        }

        cipher = child_process.spawn('/usr/bin/faketime', args,
                                     { stdio: ['pipe', 'pipe', 'ignore'] });

        enc = '';
        cipher.stdout.on('readable', cipherRead);
        cipher.stdout.on('end', finishGroup);

        cipher.stdin.write(key.toString('hex') + '\n');
        cipher.stdin.write(thePost);
        cipher.stdin.end();
    }

    function continuePost() {
        if (useSign && (toSymKey === null) && (toPubKey === null) && !hasSign) {
            cipher = child_process.spawn('/usr/bin/faketime',
                                         ["2000-01-01 00:00:00", '/usr/bin/gpg', '-qa', '--clearsign', '--no-emit-version', '--homedir', 'var/gpg/' + gpgDir],
                                         { stdio: ['pipe', 'pipe', 'ignore'] });
            enc = '';
            cipher.stdout.on('readable', cipherRead);
            cipher.stdout.on('end', finishSign);
            cipher.stdin.write(thePost);
            cipher.stdin.end();
            return;
        }

        if ((toSymKey !== null) && !hasGroup) {
            us_keys_query('SELECT s.secret, s.write_token FROM secrets AS s, secrets_alias AS sa WHERE sa.username=$1 AND s.read_token=$2 AND sa.secret=s.pkey',
                          [username, '\\x' + toSymKey],
                          gotUserKey);
            return;
        }

        if ((toPubKey !== null) && !hasPrivate) {
            var args = [ "2000-01-01 00:00:00", '/usr/bin/gpg', '-qae', '--batch', '--always-trust', '--no-emit-version', '--throw-keyids', '--homedir', 'var/gpg/' + gpgDir, '-R', toPubKey];
            if (useSign && (toSymKey === null)) {
                args.push('-s');
            }
            cipher = child_process.spawn('/usr/bin/faketime', args, { stdio: ['pipe', 'pipe', 'ignore'] });
            enc = '';
            cipher.stdout.on('readable', cipherRead);
            cipher.stdout.on('end', finishPrivate);
            cipher.stdin.write(thePost);
            cipher.stdin.end();
            return;
        }

        finishPost();
    }

    function gotUsername(u) {
        username = u;
        if (username === null) {
            sendResponse(params, 403, 'You must be logged in to make a post <a href="/posts">Posts</a>');
        }

        gpgDir = getGpgDir(username);
        if (gpgDir === null) {
            redirectTo(params, '/error/500');
            return;
        }

        continuePost();
    }
    getUsername(params, gotUsername);
}

function postPost(params) {
    var toPubkey = null, toSymKey = null, parent = null, postPart = '';

    function postFinished(params, hex) {
        if (parent !== null) {
            redirectTo(params, '/posts?parent=' + hex);
        } else if (toSymKey !== null) {
            redirectTo(params, '/grouproots?group=' + (new Buffer(toSymKey, 'hex')).toString('base64').replace(unreplaceB64Regex, unreplaceB64));
        } else {
            redirectTo(params, '/post/' + hex);
        }
    }

    function gotPostPost(params, query) {
        if ('pubKey' in query) {
            toPubkey = query.keyid;
        }
        if ('symKey' in query) {
            toSymKey = query.symKey;
        }

        if ('parent' in query) {
            if (!looksLikeSha(query.parent)) {
                // TODO: prettier error handling
                redirectTo(params, '/error/400');
                return;
            }
            parent = query.parent;
            postPart = '[parent]: sha256:' + parent + '\n';
        }
        postPostInner(params, toSymKey === null, toSymKey, toPubkey,
                      query.content + '\n\n[date]: iso8601:' + (new Date()).toISOString() + '\n' + postPart,
                      postFinished, postFailed);
    }

    getFormData(params, gotPostPost);
}

function getFaviconIco(params) {
    params.contentType = 'image/x-icon';
    // 30 days
    params.headers['Cache-Control'] = 'max-age=2592000';
    // TODO: use blank_favicon_gz where possible
    sendRawResponse(params, 200, blank_favicon);
}

////////////////////////////////////////////////////////////////////////////////

var APP_PORT = 1338;

var places_exact = {

    '/': {
        'GET': [
            { type: 'text/html', action: getHomePageHtml }
        ]
    },

    '/login': {
        'POST': postLogin
    },

    '/register': {
        'POST': postRegister
    },

    '/logout': {
        'POST': postLogout
    },

    '/posts': {
        'GET': [
            { type: 'application/json', action: getDataPostsJson },
            { type: 'text/html', action: getDataPostsHtml }
        ],
        'POST': postPost
    },

    '/posts/form': {
        'GET': [
            { type: 'text/html', action: getPostsFormHtml }
        ]
    },

    '/posts/form/result': {
        'GET': [
            { type: 'text/html', action: getPostsFormResultHtml }
        ]
    },

    '/key/generate': {
        'POST': postGenerateUserKey
    },

    '/key/import': {
        'POST': postImportGpg
    },

    '/key/send': {
        'POST': postKeySend
    },

    '/gpg/generate': {
        'POST': postGenerateGpg
    },

    '/keys': {
        'GET': [
            { type: 'text/html', action: getKeys }
        ]
    },

    '/grouproots': {
        'GET': [
            { type: 'text/html', action: getGroupRootsPageHtml }
        ]
    },

    '/style': {
        'GET': [
            { type: 'text/css', action: getStyleCss }
        ]
    },

    '/script': {
        'GET': [
            { type: 'text/javascript', action: getScriptJs }
        ]
    },

    '/jquery': {
        'GET': [
            { type: 'text/javascript', action: getJqueryJs }
        ]
    },

    '/markdown': {
        'GET': [
            { type: 'text/javascript', action: getMarkdownJs }
        ]
    },

    '/favicon.ico': {
        'GET': [
            { type: 'image/x-icon', action: getFaviconIco }
        ]
    },

    // These error pages are only globally GET'able so we can 303 into
    // them from POST actions.

    '/error/404': {
        'GET': [
            { type: 'application/json', action: getJson404 },
            { type: 'text/plain', action: getPlain404 },
            { type: 'text/html', action: getHtml404 }
        ]
    },

    '/error/405': {
        'GET': [
            { type: 'application/json', action: getJson405 },
            { type: 'text/plain', action: getPlain405 },
            { type: 'text/html', action: getHtml405 }
        ]
    },

    '/error/406': {
        'GET': [
            { type: 'application/json', action: getJson406 },
            { type: 'text/plain', action: getPlain406 },
            { type: 'text/html', action: getHtml406 }
        ]
    },

    '/error/500': {
        'GET': [
            { type: 'application/json', action: getJson500 },
            { type: 'text/plain', action: getPlain500 },
            { type: 'text/html', action: getHtml500 }
        ]
    }
};

var places_regex = [
    {
        // unlike GET /data/$hash/entry/$id, we don't need to
        // disambiguate, because the likelihood of any two posts
        // sharing a sha256 is vanishingly small, and can't be
        // maliciously crafted.
        //
        // XXX: but that depends on the format of a post. If we make
        // all fields of a post be optional, it becomes less safe.
        // For the unparented case, this does leave potential for
        // collisions to occur, however, for all posts with a
        // parent(), it is still vanishingly unlikely they'll share
        // the same hash.
        re: /^\/post\/([0-9a-f]{64})$/,
        methods: {
            'GET': [
                { type: 'application/json', action: getPostItemJson },
                { type: 'text/html', action: getPostItemHtml }
            ]
        }
    },
    {
        // XXX: what does the equivalent key server request look like?
        re: /^\/pubkey\/([0-9A-F]{40})$/,
        methods: {
            'GET': [
                { type: 'text/html', action: getPublicKeyHtml }
            ]
        }
    }
];

////////////////////////////////////////////////////////////////////////////////

main();

////////////////////////////////////////////////////////////////////////////////
