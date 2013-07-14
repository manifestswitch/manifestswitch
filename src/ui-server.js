
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

var ui_server_css = '.hash { font-family: monospace; }';
var ui_server_css_gzip = new Buffer('H4sICIuczFECA2RhdGEtc2VydmVyLmNzcwDTy0gszlCoVkjLzyvRTUvMzcyptFLIzc/LLy5ITE61VqjlAgB3ZlLSIgAAAA==', 'base64');

var ui_server_js = _UI_SERVER_JS_;
var ui_server_js_gzip = null;

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
var us_sessions_conf = "postgres://us_sessions:_US_SESSIONS_PASS_@localhost:5432/us_sessions";
var us_keys_conf = "postgres://us_keys:_US_KEYS_PASS_@localhost:5432/us_keys";

function us_users_query(query, params, cb) {
    perform_query(us_users_conf, query, params, cb);
}

function us_sessions_query(query, params, cb) {
    perform_query(us_sessions_conf, query, params, cb);
}

function us_keys_query(query, params, cb) {
    perform_query(us_keys_conf, query, params, cb);
}


// returns a list of all hashes that the user wants to follow
// references of
function userFollowList(username) {
    if (!(username in follows_list)) {
        return [];
    }
    return follows_list[username];
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
var offsets = {
    // "https://example.org/data?references=...,...": 137
};

var currentlyFetchingLists = {
    // basePath: [handler,...]
};

function getDataList(references, cont) {
    // FIXME: at some point this request URI will become too large, as
    // the number of people we are following grows above 50 or
    // 60. This is an annoying problem to have because it is somewhat
    // arbitrary.
    // Possibly have /data?batch=$hash where $hash contains the
    // requested hashes? The batch would be re-usable between
    // requests, so this wouldn't massively spam the data-servers, but
    // it would be less transient what kinds of hashes were being
    // requested.
    // An obvious alternative would be to just perform one API hit per
    // reference, but this would mean hitting hundreds of URLs just to
    // check if one had changed.
    // Go with the batch solution for now.
    var basePath = '/data?references=' + references.join('%2C');
    var hostname = '127.0.0.1';
    var source = hostname + basePath;

    // if the list is already being got, just register interest in the
    // results
    if (source in currentlyFetchingLists) {
        currentlyFetchingLists[source].push(cont);
        return;
    }
    currentlyFetchingLists[source] = [cont];

    if (!(source in offsets)) {
        offsets[source] = 0;
    }

    var options = {
        hostname: hostname,
        port: 7443,
        path: basePath + '&first=' + offsets[source],
        method: 'GET',
        headers: { Accept: 'text/plain' }
    };

    if (hostname === '127.0.0.1') {
        options.rejectUnauthorized = false;
    }

    var req = https.request(options, function(res) {
        res.setEncoding('utf8');

        var ch = '';
        res.on('readable', function () {
            var str = res.read();
            if (str !== null) {
                ch += str;
            }
        });
        res.on('end', function () {
            var ret;

            if (ch === '') {
                ret = [];
            } else {
                ret = getReferencedHashes(ch);
            }
            offsets[source] += ret.length;

            var isEos = (!('x-total' in res.headers)) || (offsets[source] === parseInt(res.headers['x-total'], 10));

            for (var i = 0, len = currentlyFetchingLists[source].length; i < len; ++i) {
                currentlyFetchingLists[source][i](ret, isEos);
            }
            delete currentlyFetchingLists[source];
        });
    });

    req.on('error', logError);
    req.end();
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

function getDataItemAndIndex(hash, cont) {

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
            currentlyFetchingItemsToIndex[hex][i](hex, data);
        }
        delete currentlyFetchingItemsToIndex[hex];
    }

    if (hash in hashed_by) {
        //process.nextTick(cont);
        cont(hash, getDataCached(hash));
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

// Essentially just takes a wedge of the 
function getReferencingHashesFromCache(referencing) {
    var rv = {};
    for (var i = 0, len = referencing.length; i < len; ++i) {
        rv[referencing[i]] = referred_by[referencing[i]];
    }
    return rv;
}

// this just streams across the references list attempting to download
// each in turn.
function updateReferencesGotListFn(stale, cont) {

    var lists = [];
    var waiting = 0;
    var data_eos;

    function fetchedDataItemIndexed(hex, data) {
        --waiting;

        if (waiting === 0) {
            if (data_eos) {
                cont(lists);
            } else {
                getDataList(stale, gotList);
            }
        }
    }

    function gotList(data, eos) {
        if (data.length === 0) {
            if (!eos) {
                async_log('WARN Got 0 data even though not eos');
            }
            cont(lists);
            return;
        }

        lists.push(data);

        data_eos = eos;
        waiting = data.length;

        // update our caches
        for (var i = 0, len = data.length; i < len; ++i) {
            var hex = data[i];
            getDataItemAndIndex(hex, fetchedDataItemIndexed);
        }
    };

    return gotList;
}

function updateReferencingHashesCached(referencing, cont) {
    var stale = [];

    for (var i = 0, len = referencing.length; i < len; ++i) {
        // TODO: filter fl down so that we only try to refetch if our
        // cached data is older than say 1 second.
        // If they're all under 1 second old, there's nothing to do.
        if (true || referencesListIsStale(referencing[i])) {
            stale.push(referencing[i]);
        }
    }

    if (stale.length !== 0) {
        getDataList(stale, updateReferencesGotListFn(stale, cont));
    } else {
        cont();
    }
}

// for the currently logged in user, we would like to loop through
// their peers, re-downloading all of the hashes of content that
// person has ever potentially signed.
// These posts are cached locally as user -> [content, ...]
function refreshPeerContent(username, cont) {
    var fl = userFollowList(username);
    updateReferencingHashesCached(fl, cont);
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
        redirectTo(params, '/login/result');
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
            redirectTo(params, '/login/result');
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
    redirectTo(params, '/logout/result');
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
                             '    </form>\n')
                    ) +
                    '    <div>\n' +
                    '      <h1>Data</h1>\n' +
                    '      <div>Stuff stuff <a href="/posts">posts</a></div>\n' +
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

function getPostsDataListContinue (data) {
    status = 200;
    body = '<h1>200 OK: Page here: ' + data + '</h1><a href="/">Continue</a>';
    sendResponse(params, status, body);
}

var dateRegex = /~date\((\d+)\)/;

// If there is an upvote, returns the thing being upvoted
var upvotes = {
    // 'hex': hex
};

var upvoteRegex = /~upvote\(([0-9a-f]{64})\)/;

function getPostFromData(data) {
    var match = data.match(parentsRegex);
    return (match === null) ? null : match[1];
}

function getUpvoteFromData(data) {
    var match = data.match(upvoteRegex);
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
var signatureRegex = /\n:signature packet:.*keyid ([0-9A-F]{16})\n/;
var sigMadeRegex = /gpg: Signature made .* using .* key ID ([0-9A-F]{8})\n/;

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
function getDecrypt(params, data, cont) {
    var gpgDir, ch = '', hasPubkey = false, verified = null, signkey = null, keys, key, gpg, gpgStatus, decData, sigRes = '';

    // TODO: return the key signed with and encrypted to if present.

    // NB: "signkey" can be 8 or 16 chars if present.

    function endSignature(code) {
        // we only set verified true if a signature packet was found
        if ((verified === false) && (code === 0)) {
            verified = true;
        }

        if (sigRes !== '') {
            var m = sigMadeRegex.exec(sigRes);
            if (m !== null) {
                signkey = m[1];
            }
        }

        cont({ data: ch, verified: verified, group: null, pubkey: hasPubkey, signkey: signkey });
    }

    function checkKeyPackets() {
        var m = signatureRegex.exec(ch);
        if (m !== null) {
            signkey = m[1];
            verified = gpgStatus === 0;
        }
        cont({ data: decData, verified: verified, group: key.identifier, pubkey: hasPubkey, signkey: signkey });
    }

    function signatureRead() {
        var str = gpg.stdout.read();
        if (str !== null) {
            ch += str;
        }
    }

    function signatureResultRead() {
        var str = gpg.stderr.read();
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

    function checkKeyEnd(status) {
        if (ch === '') {
            tryUserKeys();
            return;
        }

        // if it worked, then have perform --list-packets with that
        // shared key to see whether there was a signature.

        gpgStatus = status;
        decdata = ch;

        gpg = child_process.spawn('/usr/bin/gpg',
                                  ['-q', '--passphrase-fd', '3', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--list-packets'],
                                  { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });

        ch = '';
        gpg.stdout.on('readable', listPacketsRead);
        gpg.stdout.on('end', checkKeyPackets);
        gpg.stdio[3].write(key.secret);
        gpg.stdin.write(data);
        gpg.stdin.end();
    }

    function tryUserKeys() {
        if (keys.length === 0) {
            cont({ data: ch, verified: verified, group: false, pubkey: hasPubkey, signkey: signkey });
            return;
        }

        key = keys.pop();
        gpg = child_process.spawn('/usr/bin/gpg',
                                      ['-q', '--batch', '--passphrase-fd', '3', '--homedir', 'var/gpg/' + gpgDir],
                                      { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });

        ch = '';
        gpg.stdout.on('close', checkKeyEnd);
        gpg.stdout.on('readable', signatureRead);
        gpg.stdio[3].write(key.secret);
        gpg.stdin.write(data);
        gpg.stdin.end();
    }

    function gotUserKeys(result) {
        if (result === null) {
            cont(null);
            return;
        }
        keys = result.rows;
    }

    function listPacketsEnd() {
        if (ch.substr(0, symkeyStart.length) === symkeyStart) {
            //loop through the secrets trying each in turn
            us_keys_query('SELECT identifier,secret FROM secrets WHERE username=$1',
                          [username],
                          gotUserKeys);
            return;
        }

        if (ch.substr(0, pubkeyStart.length) === pubkeyStart) {
            var m = signatureRegex.exec(ch);
            if (m !== null) {
                signkey = m[1];
                verified = false;
            }

            hasPubkey = true;
            // fall through

            // FIXME BROKEN
            // The contained message could be Group encrypted

        }

        // FIXME: clearsign list-packets doesn't show us the keyid.
        // Is there any choice other than parse the stderr log?

        // see if it's a valid cleartext signature
        // --verify is not specified because we want the data stripped
        // of signature tags anway.
        verified = false;
        gpg = child_process.spawn('/usr/bin/gpg',
                                      ['-q', '--homedir', 'var/gpg/' + gpgDir, '--batch'],
                                      { stdio: ['pipe', 'pipe', 'pipe'] });
        ch = '';
        sigRes = '';
        gpg.on('close', endSignature);
        gpg.stdout.on('readable', signatureRead);
        gpg.stderr.on('readable', signatureResultRead);
        gpg.stdin.write(data);
        gpg.stdin.end();
    }

    function gotUsername(username) {
        gpgDir = getGpgDir(username);

        if (gpgDir === null) {
            cont(null);
            return;
        }
        gpg = child_process.spawn('/usr/bin/gpg',
                                  ['-q', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--list-packets'],
                                  { stdio: ['pipe', 'pipe', 'ignore'] });

        gpg.stdout.on('readable', listPacketsRead);
        gpg.stdout.on('end', listPacketsEnd);
        gpg.stdin.write(data);
        gpg.stdin.end();
    }

    if (data.substr(0, gpgStart.length) !== gpgStart) {
        cont(null);
        return;
    }

    getUsername(params, gotUsername);
}

// If there is a parent, returns it
var parents = {
    // 'hex': hex
};

var parentsRegex = /~post\(([0-9a-f]{64})\)/;

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

function postGenerateGpg(params) {

    var gpgDir;

    function gpgClose(code) {
        if (code !== 0) {
            async_log('gpg create failed');
            redirectTo(params, '/error/500');
            return;
        }
        redirectTo(params, '/keys');
    }

    function madeDir(err) {
        if (err !== null) {
            async_log('could not mk gpg dir');
            redirectTo(params, '/error/500');
            return;
        }
        var gpg = child_process.spawn('/usr/bin/gpg',
                                      ['-q', '--homedir', 'var/gpg/' + gpgDir, '--batch', '--gen-key'],
                                      { stdio: ['pipe', 'ignore', 'ignore'] });
        gpg.on('exit', gpgClose);

        // Could use 4096 bit, but this is not the weakest link of
        // security, and doing so would use up extra entropy.
        gpg.stdin.write('Key-Type: RSA\n' +
                        'Key-Length: 2048\n' +
                        'Key-Usage: sign\n' +
                        'Subkey-Type: RSA\n' +
                        'Subkey-Length: 2048\n' +
                        'Subkey-Usage: encrypt\n' +
                        'Name-Real: Anonymous\n');
//                        'Name-Comment: \n' +
//                        'Name-Email: \n' +

        gpg.stdin.end();
    }

    function gotUsername(username) {
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

// This returns the list of posts with at least one upvote signed by someone in our network.
function getDataPostsHtml(params) {
    var body, status, hash;
    var waiting = 0, username;

    function sendFinal() {
        var html = '<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body><ul>';
        var posts;
        if ((username in user_posts) && (hash in user_posts[username])) {
            posts = Object.keys(user_posts[username][hash]);
            for (var k = 0, klen = posts.length; k < klen; ++k) {
                html += '<li><a class="hash" href="/post/' + posts[k] + '">' + posts[k] + '</a></li>';
            }
        }
        html += '</ul><div><a href="/posts/form?parent=' + hash + '">Add</a></div>';
        html += '<div><a href="/">Home</a></div></body></html>';

        sendResponse(params, 200, html);
    }

    function decAndCheck() {
        --waiting;
        if (waiting === 0) {
            sendFinal();
        }
    }

    function setParent(hex, parent) {
        // Index even if it's on another parent - we only traverse the
        // stream once so there's no other opportunity to do this.
        if (!(username in user_posts)) {
            user_posts[username] = {};
        }
        if (!(parent in user_posts[username])) {
            user_posts[username][parent] = {};
        }

        // XXX: this will also index encrypted posts
        user_posts[username][parent][hex] = true;
    }

    function fetchedItem(hex, data) {
        var parent = getPostParentCached(hex, data);

        if (parent === null) {
            getDecrypt(params, data, gotDecrypt(hex, true));
            return;
        }

        setParent(hex, parent);
        decAndCheck();
    }

    function verifyAndGet(container, upvoted) {
        // TODO: actually verify the signature
        if (true || verifySignature(container)) {
            getDataItemAndIndex(upvoted, fetchedItem);
        } else {
            decAndCheck();
        }
    }

    function gotDecrypt(hex, isFinal) {
        return function (decrypt) {

            // TODO: keep track of which items look like they're
            // encrypted, bu failed to decrypt. We can try them again
            // if we get a new key at some point.
            if ((decrypt === null) ||
                ((decrypt.group === null) && (decrypt.verified !== true))) {
                decAndCheck();
                return;
            }

            // check to prevent us following upvotes of upvotes
            if (!isFinal) {
                var upvoted = getUpvoteFromData(decrypt.data);

                // XXX: currently this means "~upvote()...~post()" will
                // ignore the post.
                if (upvoted !== null) {
                    // doesn't need a signature because it was encrypted
                    // to a cipher key
                    getDataItemAndIndex(upvoted, fetchedItem);
                    return;
                }
            }
            var post = getPostFromData(decrypt.data);

            if (post !== null) {
                setParent(hex, post);
                decAndCheck();
                return;
            }
            decAndCheck();
        };
    }

    function gotItemForDecrypt(hex, data) {
        getDecrypt(params, data, gotDecrypt(hex, false));
    }

    function gotPeerContent(lists) {
        waiting += 1;
        for (var i = 0, len = lists.length; i < len; ++i) {
            waiting += lists[i].length;

            for (var j = 0, jlen = lists[i].length; j < jlen; ++j) {
                var upvoted = getUpvotedCached(lists[i][j]);
                if (upvoted === null) {
                    getDataItemAndIndex(lists[i][j], gotItemForDecrypt);
                } else {
                    verifyAndGet(lists[i][j], upvoted);
                }
            }
        }
        decAndCheck();
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

        if (!('parent' in query)) {
            // just a helpful starting point
            hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        } else {
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
        refreshPeerContent(username, gotPeerContent);
    }

    getUsername(params, gotUsername);
}

function getPostsFormHtml(params) {
    var query = url.parse(params.request.url, true).query;
    if (!('parent' in query) || !looksLikeSha(query.parent)) {
        // TODO: prettier error handling
        sendResponse(params, 400, 'Doesnt look like a SHA');
        return;
    }
    var body = ('<!DOCTYPE html><html><head></head><body>' +
                '    <form action="/posts" method="POST">\n' +
                '      <input type="hidden" name="parent" value="' + query.parent + '">\n' +
                '      <textarea name="content"></textarea>\n' +
                '      <input value="submit" type="submit">\n' +
                '    </form><a href="/posts">Back</a></body></html>');

    sendResponse(params, 200, body);
}

function gotPostItem(params) {
    var hash, data, parent, decrypt = null;

    function printLiteral() {
        // 5 minutes. Main reason to keep this short is in case
        // javascript or style is accidentally broken and needs to be
        // fixed quickly
        params.headers['Cache-Control'] = 'max-age=300';

        var parentLink = (parent === null) ? '' : '<div><a href="/post/' + parent + '">Parent</a></div>';
        var verified = '<span>(Unverified)</span>', group = '', pubkey = '', by = 'Anonymous';
        if (decrypt !== null) {
            if (decrypt.verified === true) {
                verified = '<span>(Verified)</span>';
            }
            if (decrypt.signkey !== null) {
                by = htmlEscape(decrypt.signkey);
            }
            if (decrypt.group !== null) {
                group = '<span>Group: ' + htmlEscape(decrypt.group) + '</span>';
            }
            if (decrypt.pubkey === true) {
                pubkey = '<span>Private</span>';
            }
        }
        var title = '';
        var body = ('<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body>' + htmlEscape(title) + '<h2 class="hash">' +
                    hash +
                    '</h1><pre>' +
                    htmlEscape(data.replace(parentsRegex, '')) +
                    '</pre><div>By: ' + by + ' ' + verified + '</div>' + group + pubkey + '<form action="/vote" method="POST"><input type="submit" name="vote" value="upvote"></form>' + parentLink + '<div><a href="/posts?parent=' + hash + '">Comments</a><div><a href="/posts/form?parent=' + hash + '">Reply</a></div></div><div></div><script type="text/javascript" src="/script?v=0"></script></body></html>');

        sendResponse(params, 200, body);
    }

    function gotDecrypt(dec) {
        if (dec !== null) {
            decrypt = dec;
            data = dec.data;
            parent = getPostFromData(dec.data);
        }
        printLiteral();
    }

    function gotPostItemLiteral(h, d) {
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

function getPostItemHtml(params) {
    var hash = params.urlparts.pathname.substring('/post/'.length);

    getDataItemAndIndex(hash, gotPostItem(params));
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

function followUntilSuccess(params, protocol, options, payload, cont, scount) {
    function gotResponse(res) {
        if (res.statusCode >= 200 && res.statusCode <= 299) {
            cont(params, true);
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

function postFinished(hex) {
    return function (params, result) {
        if (!result) {
            // if the post didn't make it to the backing store, remove
            // it from the cache to avoid confusion.
            delete hashed_by[hex];
        }
        redirectTo(params, '/posts/form/result?sha256=' + hex);
    };
}

// FIXME: check for existing identifier first!!
function postGenerateUserKey(params) {
    var username, identifier;

    function insertedKey(result) {
        if (result === null) {
            sendResponse(params, 500, 'Failed to generate a new key');
            return;
        }
        redirectTo(params, '/keys');
    }

    function gotBytes(err, buf) {
        if (err !== null) {
            sendResponse(params, 500, 'Failed to generate a new key');
            return;
        }

        us_keys_query("INSERT INTO secrets (username, identifier, secret, modified_date, ignore_new) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, false)",
                      [username, identifier, '\\x' + buf.toString('hex')],
                      insertedKey);
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

function getKeys(params) {
    var username;

    function gotKeys(result) {
        if (result === null) {
            sendResponse(params, 500, 'Could not fetch keys list');
            return;
        }
        var body = '<p>Fingerprint: FEB9 C9F5 D9D1 76D4 ED6C  C5EA A6F3 D557 <span class="keyid" style="text-decoration: underline;">780D 283E</span></p><ul>';
        for (var i = 0, len = result.rows.length; i < len; ++i) {
            // FIXME: not actually escaped!
            body += '<li>' + htmlEscape(result.rows[i].identifier) + '</li>';
        }
        body += '</ul><form method="POST" action="/key/generate"><input type="text" name="identifier"><input type="submit" name"action" value="Generate"></form><a href="/">Home</a>';

        sendResponse(params, 200, body);
    }

    function hasGpgDir(exists) {
        if (exists) {
            us_keys_query('SELECT identifier FROM secrets WHERE username=$1',
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
function postPostInner(params, useSign, useGroup, usePrivate) {
    var hasSign = false, hasGroup = false, hasPrivate = false;
    var identifier = null, keyid = null, gpgDir = null;
    var cipher, shasum, username, enc = '';
    var thepost = '';

    function shasumRead() {
        var digest = shasum.read(64);

        if (digest === null) {
            return;
        }

        // TODO: change to PUT when possible
        var options = {
            hostname: '127.0.0.1',
            port: 7443,
            path: '/data',
            method: 'POST',
            headers: { Accept: 'text/plain' }
        };

        var payload = 'content=' + encodeURIComponent(thepost);
        followUntilSuccess(params, 'https:', options, payload, postFinished(digest), 0);
    }

    function finishPost() {
        shasum = crypto.createHash('sha256');
        shasum.setEncoding('hex');
        shasum.on('readable', shasumRead);
        shasum.write(thepost);
        shasum.end();
    }

    function finishSign() {
        thepost = enc;
        hasSign = true;
        continuePost();
    }

    function finishGroup() {
        thepost = enc;
        hasGroup = true;
        continuePost();
    }

    function finishPrivate() {
        thepost = enc;
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
        var args = ['-qac', '--batch', '--no-emit-version', '--passphrase-fd', '3', '--homedir', 'var/gpg/' + gpgDir,
                    '--s2k-digest-algo', 'SHA512', '--s2k-count', '1024', '--cipher-algo', 'AES256'];
        if (useSign) {
            args.push('-s');
        }
        cipher = child_process.spawn('/usr/bin/gpg', args,
                                     { stdio: ['pipe', 'pipe', 'ignore', 'pipe'] });

        enc = '';
        cipher.stdout.on('readable', cipherRead);
        cipher.stdout.on('end', finishGroup);
        cipher.stdio[3].write(key);
        cipher.stdin.write(thepost);
        cipher.stdin.end();
    }

    function continuePost() {
        if (useSign && !useGroup && !usePrivate && !hasSign) {
            cipher = child_process.spawn('/usr/bin/gpg',
                                         ['-qa', '--clearsign', '--no-emit-version', '--homedir', 'var/gpg/' + gpgDir],
                                         { stdio: ['pipe', 'pipe', 'ignore'] });
            enc = '';
            cipher.stdout.on('readable', cipherRead);
            cipher.stdout.on('end', finishSign);
            cipher.stdin.write(thepost);
            cipher.stdin.end();
            return;
        }

        if (useGroup && !hasGroup) {
            us_keys_query('SELECT secret FROM secrets WHERE username=$1 AND identifier=$2',
                          [username, identifier],
                          gotUserKey);
            return;
        }

        if (usePrivate && !hasPrivate) {
            var args = ['-qae', '--no-emit-version', '--throw-keyids', '--homedir', 'var/gpg/' + gpgDir, '-R', ];
            if (useSign && !useGroup) {
                args.push('-s');
            }
            cipher = child_process.spawn('/usr/bin/gpg', args, { stdio: ['pipe', 'pipe', 'ignore'] });
            enc = '';
            cipher.stdout.on('readable', cipherRead);
            cipher.stdout.on('end', finishPrivate);
            cipher.stdin.write(thepost);
            cipher.stdin.end();
            return;
        }

        finishPost();
    }

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

    function gotPostPost(params, query) {
        if (!('parent' in query) || !looksLikeSha(query.parent)) {
            // TODO: prettier error handling
            redirectTo(params, '/error/400');
            return;
        }

        if (usePrivate) {
            if (!('keyid' in query)) {
                sendResponse(params, 400, 'Please specify key id for the private message');
                return;
            }
            keyid = query.keyid;
        }

        if (useGroup) {
            if (!('identifier' in query)) {
                sendResponse(params, 400, 'Please specify key identifier for group post');
                return;
            }
            identifier = query.identifier;
        }

        gpgDir = getGpgDir(username);
        if (gpgDir === null) {
            redirectTo(params, '/error/500');
            return;
        }

        thepost = '~post(' + query.parent + ')\n~date(' + Date.now() + ')\n';
        thepost += '~cc(04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb)\n';
        thepost +=  query.content;
        continuePost();
    }

    function gotUsername(u) {
        username = u;
        if (username === null) {
            sendResponse(params, 403, 'You must be logged in to make a post <a href="/posts">Posts</a>');
        }
        getFormData(params, gotPostPost);
    }
    getUsername(params, gotUsername);
}

function postPost(params) {
    postPostInner(params, true, false, false);
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

    '/login/result': {
        'GET': [
            { type: 'application/json', action: getLoginResultJson },
            { type: 'text/plain', action: getLoginResultPlain },
            { type: 'text/html', action: getLoginResultHtml }
        ]
    },

    '/logout': {
        'POST': postLogout
    },

    '/logout/result': {
        'GET': [
            { type: 'application/json', action: getLogoutResultJson },
            { type: 'text/plain', action: getLogoutResultPlain },
            { type: 'text/html', action: getLogoutResultHtml }
        ]
    },

    '/posts': {
        'GET': [
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

    '/gpg/generate': {
        'POST': postGenerateGpg
    },

    '/keys': {
        'GET': [
            { type: 'text/html', action: getKeys }
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
        re: /\/post\/([0-9a-f]{64})/,
        methods: {
            'GET': [
                { type: 'text/html', action: getPostItemHtml }
            ]
        }
    }
];

////////////////////////////////////////////////////////////////////////////////

main();

////////////////////////////////////////////////////////////////////////////////
