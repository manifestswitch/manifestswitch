
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
http,
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
    { 'username': 'user', 'password': 'pass' }
];

// index on username -> userdb[i]
var by_username = {
    'user': userdb[0]
};

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
    process.nextTick(authenticate_checker(username, password, cont));
}

function postLogin(params) {
    var str = '';

    function postLoginEnd() {
        var uparams = url.parse('?' + str, true).query;

        authenticate(uparams.username, uparams.password,
                     authenticate_continue(params, uparams.username));
    }

    function postLoginData(buf) {
        // TODO: take purported encoding from req object
        str += buf.toString();
    }

    params.request.on('end', postLoginEnd);
    params.request.on('data', postLoginData);
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

    function putDataItemData(buf) {
        // TODO: take purported encoding from req object
        str += buf.toString();
    }

    params.request.on('end', putDataItemEnd);
    params.request.on('data', putDataItemData);
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
            '      <div>Stuff stuff</div>\n' +
            '    </div>\n' +
            '  </body>\n' +
            '</html>');

    sendResponse(params, { status: 200, body: body });
}

var options = {
    hostname: '127.0.0.1',
    port: 1337,
    path: '/data',
    method: 'GET'
};

function getHomePageHtmlOld(params) {

    async_log('starting hit');

    var req = http.request(options, function(res) {
        async_log('STATUS: ' + res.statusCode);
        async_log('HEADERS: ' + JSON.stringify(res.headers));
        res.setEncoding('utf8');

        var ch = '';
        res.on('data', function (chunk) {
            ch += chunk.toString();
        });
        res.on('end', function () {
            params.contentType = 'text/plain';
            sendResponse(params, { status: 200, body: ch });
        });


    });

    req.on('error', function(e) {
        async_log('problem with request: ' + e.message);
    });

// write data to request body

    req.end();
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
        ],
    },

    '/logout': {
        'POST': postLogout
    },

    '/logout/result': {
        'GET': [
            { type: 'application/json', action: getLogoutResultJson },
            { type: 'text/plain', action: getLogoutResultPlain },
            { type: 'text/html', action: getLogoutResultHtml }
        ],
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

var places_regex = {};

////////////////////////////////////////////////////////////////////////////////

main();

////////////////////////////////////////////////////////////////////////////////
