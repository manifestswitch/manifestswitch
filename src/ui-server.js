
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
sessionGet,
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

var userdb = [
    { 'username': 'user', 'password': 'pass', 'gpgdir': 'var/gpg/user' },
    { 'username': 'user2', 'password': 'pass', 'gpgdir': 'var/gpg/user2' }
];

// index on username -> userdb[i]
var by_username = {
    'user': userdb[0],
    'user2': userdb[1]
};

// what we are ultimately looking for is the hashes of all our
// friend's signature fingerprints, and hash of our encryption
// fingerprint
// 'user': ['d283a3...' /*mine*/, 'cd3987af...', ... /*theirs*/ ]
var follows_list = {
    // [sha256("user"), sha256("user2")]
    'user': ['04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb', '6025d18fe48abd45168528f18a82e265dd98d421a7084aa09f61b341703901a3']
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
var offsets = {
    // "https://example.org/data?references=...,...": 137
};

var currentlyFetchingLists = {
    // basePath: [handler,...]
};

function getDataList(references, cont) {
    var basePath = '/data?references=' + references.join(',');
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
        async_log('STATUS: ' + res.statusCode);
        async_log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');

        var ch = '';
        res.on('readable', function () {
            ch += res.read();
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

    req.on('error', function(e) {
        async_log('problem with request: ' + e.message);
    });

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

    if (hostname === '127.0.0.1') {
        options.rejectUnauthorized = false;
    }

    var req = https.request(options, function(res) {
        async_log('STATUS: ' + res.statusCode);
        async_log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');

        var ch = '', shasum;

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
                // this would be a good point to fail over to another data
                // service
                ch = null;
            }

            shasumFinish();
        }

        res.on('readable', function () {
            ch += res.read();
        });
        res.on('end', function () {
            if ((res.statusCode >= 200) && (res.statusCode <= 299)) {
                shasum = crypto.createHash('sha256');
                shasum.setEncoding('hex');
                shasum.on('readable', shasumRead);
                shasum.write(ch);
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
        process.nextTick(cont);
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

// I don't bother SHA'ing the password, it can be cracked easily. The
// only way to fully prevent cracking would be to use scrypt and DOS
// our own server, doesn't seem worth it considering 99% of the data
// is public.
//
// FIXME: However, I should do some limiting - if an IP address shows
// up as repeatedly failing login, say 3 attempts, then A) prevent
// many concurrent connections from that IP, B) add a sleep in to
// thwart any cracking.
//
// If it's easy to add those protections for session id cracking and
// even DOS in general, might as well do so.
function authenticate_checker(username, password, cont) {
    return function() {
        if ((username in by_username) && (by_username[username].password === password)) {
            cont(true);
        } else {
            cont(false);
        }
    };
}

function authenticate_continue(params, username) {
    var savedResult = null;

    function gotSessid() {
        sessionSet(params, 'username', savedResult ? username : null);
        redirectTo(params, '/login/result');
    }

    return function (result) {
        if (!result && !hasSession(params)) {
            redirectTo(params, '/login/result');            

        } else {
            savedResult = result;

            if (hasSession(params)) {
                gotSessid();
            } else {
                sessionStart(params, gotSessid);
            }
        }
    };
}

function authenticate(username, password, cont) {
    // setTimeout(fn, 0); would be closer to desired call semantics,
    // but that would needlessly add up to 10ms to response time.
    authenticate_checker(username, password, cont)();
}

function postLogin(params) {
    var str = '';

    function postLoginEnd() {
        var uparams = url.parse('?' + str, true).query;

        authenticate(uparams.username, uparams.password,
                     authenticate_continue(params, uparams.username));
    }

    function postLoginData() {
        str += params.request.read();
    }

    params.request.setEncoding('utf8');
    params.request.on('end', postLoginEnd);
    params.request.on('readable', postLoginData);
}

////////////////////////////////////////////////////////////////////////////////

function getLoginResultPlain(params) {
    var body, status;
    if (sessionGet(params, 'username') !== null) {
        status = 200;
        body = '200 OK: You have successfully logged in';
    } else {
        status = 403;
        body = '403 Forbidden: Login failed';
    }
    sendResponse(params, { status: status, body: body });
}

function getLoginResultJson(params) {
    var body, status;
    if (sessionGet(params, 'username') !== null) {
        status = 200;
        body = '{ "status": 200, "result": "OK", "message": "You have successfully logged in" }';
    } else {
        status = 403;
        body = '{ "status": 403, "result": "Forbidden", "message": "Login failed" }';
    }
    sendResponse(params, { status: status, body: body });
}

function getLoginResultHtml(params) {
    var body, status;
    if (sessionGet(params, 'usename') !== null) {
        status = 200;
        body = '<h1>200 OK: You have successfully logged in</h1><a href="/">Continue</a>';
    } else {
        status = 403;
        body = '<h1>403 Forbidden: Login failed</h1><a href="/">Continue</a>';
    }
    sendResponse(params, { status: status, body: body });
}

////////////////////////////////////////////////////////////////////////////////

function postLogout(params) {
    delete params.sessions[params.cookies.s.value];
    delete params.cookies.s;
    redirectTo(params, '/logout/result');
}

////////////////////////////////////////////////////////////////////////////////

// FIXME:
//
// The recipient of the entity MUST NOT ignore any Content-*
// (e.g. Content-Range) headers that it does not understand or
// implement and MUST return a 501 (Not Implemented) response in such
// cases.

function putDataItem(params) {
    var str = '';

    function putDataItemEnd() {
        var uparams = url.parse('?' + str, true).query;
    }

    function putDataItemData() {
        str += params.request.read();
    }

    params.request.setEncoding('utf8');
    params.request.on('end', putDataItemEnd);
    params.request.on('readable', putDataItemData);
}

////////////////////////////////////////////////////////////////////////////////

function getLogoutResultPlain(params) {
    var body, status;
    if (sessionGet(params, 'username') === null) {
        status = 200;
        body = '200 OK: You have successfully logged out';
    } else {
        status = 500;
        body = '500 Internal Server Error: Logout failed';
    }
    sendResponse(params, { status: status, body: body });
}

function getLogoutResultJson(params) {
    var body, status;
    if (sessionGet(params, 'username') === null) {
        status = 200;
        body = '{ "status": 200, "result": "OK", "message": "You have successfully logged out" }';
    } else {
        status = 500;
        body = '{ "status": 500, "result": "Internal Server Error", "message": "Logout failed" }';
    }
    sendResponse(params, { status: status, body: body });
}

function getLogoutResultHtml(params) {
    var body, status;
    if (sessionGet(params, 'usename') === null) {
        status = 200;
        body = '<h1>200 OK: You have successfully logged out</h1><a href="/">Continue</a>';
    } else {
        status = 500;
        body = '<h1>500 Internal Server Error: Logout failed</h1><a href="/">Continue</a>';
    }
    sendResponse(params, { status: status, body: body });
}

////////////////////////////////////////////////////////////////////////////////

// Should a signature be detached or inline?
// I'm thinking detached - there doesn't seem much reason to have it
// attached.

//var spawn = require('child_process').spawn;
//ch = spawn("/usr/bin/gpg", ["-as"]);

function getHomePageHtml(params) {
    var body, username = sessionGet(params, 'username');

    body = ('<!DOCTYPE html>\n' +
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

    sendResponse(params, { status: 200, body: body });
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
// ~parent($somehash)
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
    sendResponse(params, { status: status, body: body });
}

// If there is an upvote, returns the thing being upvoted
var upvotes = {
    // 'hex': hex
};

var upvoteRegex = /~upvote\(([0-9a-f]{64})\)/;

function getUpvoted(hex) {
    if (!(hex in upvotes)) {
        var data = getDataCached(hex);
        if (data === null) {
            return null;
        }
        async_log(JSON.stringify(data));
        var match = data.match(upvoteRegex);
        upvotes[hex] = (match === null) ? null : match[1];
    }
    return upvotes[hex];
}

// If there is a parent, returns it
var parents = {
    // 'hex': hex
};

var parentsRegex = /~parent\(([0-9a-f]{64})\)/;

function getPostParent(hex) {
    async_log('h:'+hex);
    if (!(hex in parents)) {
        var data = getDataCached(hex);
        async_log('d:'+data);
        if (data === null) {
            return null;
        }
        var match = data.match(parentsRegex);
        async_log('m:'+match);
        parents[hex] = (match === null) ? null : match[1];
    }
    return parents[hex];
}

var user_posts = {
    // 'user': { 'posthash': set({'childhash1', 'childhash2', ...}), ... }
}

// This returns the list of posts with at least one upvote signed by someone in our network.
function getDataPostsHtml(params) {
    var body, status;

    if (sessionGet(params, 'usename') === null) {
        status = 403;
        body = '<h1>403 Forbidden: You must be logged in </h1><a href="/">Continue</a>';
        sendResponse(params, { status: status, body: body });
        return;
    }

    var query = url.parse(params.request.url, true).query;
    var hash;

    if (!('hash' in query)) {
        // just a helpful starting point
        hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    } else {
        hash = query.hash;
    }

    // a) If we do not yet have an up-to-date list of our network's
    // current upvotes (non-repudiated), retrieve that by looping over
    // each peer.
    // a.1) For each peer, download everything they've ever signed
    // a.2) For each of those content, get a filter list of their upvotes, downvotes, and novotes
    // a.3) Where multiple votes are cast on the same content by a user, take only the most recent one.
    // b) For each of the upvotes above, download the content it references.
    // c) Filter the list to only those containing "~parent($hash)"

    var username = sessionGet(params, 'username');
    refreshPeerContent(username,
                       // lists contains all of the newly discovered
                       // hashes (possibly with duplicates)
                       function (lists) {

                           var waiting = 0;
                           var child_posts = [];

                           function sendFinal() {
                               var html = '<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style"></head><body>';
                               var posts;
                               if ((username in user_posts) && (hash in user_posts[username])) {
                                   posts = Object.keys(user_posts[username][hash]);
                                   for (var k = 0, klen = posts.length; k < klen; ++k) {
                                       html += '<a class="hash" href="/posts/' + posts[k] + '">' + posts[k] + '</a>';
                                   }
                               }
                               html += '</body></html>';
                               sendResponse(params, { status: 200, body: html });
                           }

                           function fetchedItem(hex, data) {
                               --waiting;

                               var parent = getPostParent(hex);

                               if (parent === hash) {
                                   child_posts.push(hex);
                               }

                               if (waiting === 0) {
                                   if (!(username in user_posts)) {
                                       user_posts[username] = {};
                                   }
                                   if (!(hash in user_posts[username])) {
                                       user_posts[username][hash] = {};
                                   }

                                   for (var k = 0, klen = child_posts.length; k < klen; ++k) {
                                       user_posts[username][hash][child_posts[k]] = true;
                                   }

                                   sendFinal();
                               }
                           }

                           for (var i = 0, len = lists.length; i < len; ++i) {
                               for (var j = 0, jlen = lists[i].length; j < jlen; ++j) {
                                   var upvoted = getUpvoted(lists[i][j]);
                                   if (upvoted !== null) {
                                       // TODO: actually verify the signature
                                       if (true || verifySignature(upvoted)) {
                                           ++waiting;
                                           getDataItemAndIndex(upvoted, fetchedItem);
                                       }
                                   }
                               }
                           }

                           if (waiting === 0) {
                               sendFinal();
                           }
                       });
}

function getPostFormHtml(params) {
    var body = ('    <form action="/post" method="POST">\n' +
                '      <input type="hidden" name="_method" value="PUT">\n' +
                '      <input type="text" name="parent">\n' +
                '      <textarea name="content"></textarea>\n' +
                '      <input value="submit" type="submit">\n' +
                '    </form>\n');

    body += '<a href="/posts">Back</a>';

    sendResponse(params, { status: 200, body: body });
}

function getPostItemHtml(params) {
    var body = ('    <h1>Hello</h1>');
    body += '<a href="/posts">Back</a>';

    sendResponse(params, { status: 200, body: body });
}

function getStyleCss(params) {
    sendResponse(params, { status: 200, body: '.hash { font-family: monospace; }' });
}

////////////////////////////////////////////////////////////////////////////////

var APP_PORT = 1338;

var places_exact = {

    '/': {
        'GET': [
            { type: 'text/html', action: getHomePageHtml }
        ]
    },

    '/data': {
        'PUT': putDataItem,
        'POST': putDataItem
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
        ]
    },

    '/post/form': {
        'GET': [
            { type: 'text/html', action: getPostFormHtml }
        ]
    },

    '/style': {
        'GET': [
            { type: 'text/css', action: getStyleCss }
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
