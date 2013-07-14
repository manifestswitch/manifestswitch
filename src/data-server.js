
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

var crypto,
hash_re,
isHexCode;

var redirectTo,
process,
url,
sendesponse,
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

var data_server_css = '.hash { font-family: monospace; }';
var data_server_css_gzip = new Buffer('H4sICIuczFECA2RhdGEtc2VydmVyLmNzcwDTy0gszlCoVkjLzyvRTUvMzcyptFLIzc/LLy5ITE61VqjlAgB3ZlLSIgAAAA==', 'base64');

////////////////////////////////////////////////////////////////////////////////

var ds_refers_conf = "postgres://ds_refers:_DS_REFERS_PASS_@localhost:5432/ds_refers";
var ds_content_conf = "postgres://ds_content:_DS_CONTENT_PASS_@localhost:5432/ds_content";

function ds_content_query(query, params, cb) {
    perform_query(ds_content_conf, query, params, cb);
}

function ds_refers_query(query, params, cb) {
    perform_query(ds_refers_conf, query, params, cb);
}

////////////////////////////////////////////////////////////////////////////////

function getHomePageHtml(params) {
    var body = ('<!DOCTYPE html>\n' +
            '<html>\n' +
            '  <head>\n' +
            '    <title>Grafiti</title>\n' +
            '  </head>\n' +
            '  <body>\n' +
            '    <div>\n' +
            '      <h1>Grafiti</h1>\n' +
            '      <div><a href="/data">Data list</a></div>\n' +
            '      <div>Page content</div>\n' +
            '    </div>\n' +
            '  </body>\n' +
            '</html>');

    sendResponse(params, 200, body);
}

function getHomePagePlain(params) {
    var body = '';
    body += 'GET /data?first=$uint&count=$uint\n';
    body += 'POST /data{content=$utf8}\n';
    body += 'GET /data/$sha256hex\n';

    sendResponse(params, 200, body);
}

////////////////////////////////////////////////////////////////////////////////

/*

&references=hash1,hash2&references=hash3 means contains (hash1 || hash2) && hash3

If we want to get really meta, we could just return the hash of the
text representing this list of items, and the user should call GET
/data/$hash/ to see the list.

A useful accompanyment to this call would be GET /size taking exactly
the same parameters, to let us know how many items there are without
having to scan through all of them.

*/

// max page size, just limit it to something of trivial cost to the server.
var dataListLimit = 32;

function getDataList(params, cont) {
    var rv = [], first, count, rs = null, rsstr = null;
    var query = url.parse(params.request.url, true).query;

    function gotResults(err, result) {
        var source = result.rows;

        if (first < 0) {
            first = Math.max(0, source.length - count);
            source = source.slice(first);
        }
        cont({ list: source.slice(0, count), total: first + source.length });
    }

    if ('references' in query) {
        // TODO: change to "." character since that is not encoded
        rs = query.references.split(',');

        if (!looksLikeSha(rs[0])) {
            cont(null);
            return;
        }
        rsstr = "'" + rs[0] + "'";

        for (var i = 1, rlen = rs.length; i < rlen; ++i) {
            if (!looksLikeSha(rs[i])) {
                cont(null);
                return;
            }
            rsstr += ",'" + rs[i] + "'";
        }
    }

    if ('count' in query) {
        count = parseInt(query.count, 10);

        if (count !== count) {
            cont(null);
            return;
        } else if (count < 0) {
            cont(null);
            return;
        }

        if (count > dataListLimit) {
            count = dataListLimit;
        }

    } else {
        count = dataListLimit;
    }

    if ('first' in query) {
        first = parseInt(query.first, 10);

        if (first !== first) {
            cont(null);
            return;
        } else if (first < 0) {
            cont(null);
            return;
        }
    } else {
        first = -1;
    }

    if (rsstr === null) {
        if (first < 0) {
            ds_refers_query("SELECT pkey, sha256 FROM refers_hash ORDER BY pkey", [],
                            gotResults);
        } else {
            ds_refers_query("SELECT pkey, sha256 FROM refers_hash ORDER BY pkey OFFSET $1", [first],
                            gotResults);
        }
    } else {
        if (first < 0) {
            ds_refers_query("SELECT rh2.pkey, rh2.sha256 FROM refers as r, refers_hash AS rh1, refers_hash AS rh2 WHERE rh1.sha256 IN (" + rsstr + ") AND rh1.pkey=r.referree AND rh2.pkey=r.referrer ORDER BY r.pkey", [], gotResults);
        } else {
            ds_refers_query("SELECT rh2.pkey, rh2.sha256 FROM refers as r, refers_hash AS rh1, refers_hash AS rh2 WHERE rh1.sha256 IN (" + rsstr + ") AND rh1.pkey=r.referree AND rh2.pkey=r.referrer ORDER BY r.pkey OFFSET $1", [first], gotResults);
        }
    }
}

function getDataListPlain(params) {
    function gotDataListPlain(rv) {
        var body = '', status;

        if (rv !== null) {
            for (var i = 0, len = rv.list.length; i < len; ++i) {
                body += rv.list[i].sha256 + '\n';
            }
            status = 200;
            params.headers['X-Total'] = rv.total;
        } else {
            body = '400: Bad Request: Could not parse query parameters.';
            status = 400;
        }
        sendResponse(params, status, body);
    }
    getDataList(params, gotDataListPlain);
}

function getDataListJson(params) {
    function gotDataListJson(rv) {
        var body = '{ "status": 200, "result": "OK", "items": [\n', status;

        if (rv !== null) {
            for (var i = 0, len = rv.list.length; i < len; ++i) {
                body += '{ "hash": "' + rv.list[i].sha256 + '" },\n';
            }
            body += ']}\n';
            status = 200;
            params.headers['X-Total'] = rv.total;

        } else {
            body = '{ "status": 400, "result": "Bad Request", "code": 1, "message": "Could not parse query parameters." }';
            status = 400;
        }
        sendResponse(params, status, body);
    }
    getDataList(params, gotDataListJson);
}

function getDataListHtml(params) {
    function gotDataListHtml(rv) {
        var body = '<!DOCTYPE html><html><head><link rel="stylesheet" type="text/css" href="/style?v=0"></head><body><ol>\n', status;

        if (rv !== null) {
            for (var i = 0, len = rv.list.length; i < len; ++i) {
                body += '<li><a class="hash" href="/data/' + rv.list[i].sha256 + '">' + rv.list[i].sha256 + '</a></li>\n';
            }

            body += '</ol>\n';
            body += '<div><a href="/data/form">Add</a></div>';
            body += '<div><a href="/">Home</a></div></body></html>';
            status = 200;
            params.headers['X-Total'] = rv.total;

        } else {
            body = '<h1>400: Bad Request: Could not parse query parameters.</h1><a href="/data">Continue</a>';
            status = 400;
        }
        sendResponse(params, status, body);
    }
    getDataList(params, gotDataListHtml);
}

////////////////////////////////////////////////////////////////////////////////

function getDataFormHtml(params) {
    var body = ('    <form action="/data" method="POST">\n' +
                '      <textarea name="content"></textarea>\n' +
                '      <input value="submit" type="submit">\n' +
                '    </form>\n');

    body += '<a href="/data">Back</a>';

    sendResponse(params, 200, body);
}

////////////////////////////////////////////////////////////////////////////////

// XXX FIXME TODO: The best route for collisions is for the server to
// return all content with a specific hash, and allow the client to
// make sense of which one is being referred to.

// So we have something like:
// GET /data/$hash/count
// -> returns a number 0 or more
// GET /data/$hash/0
// -> get the content with a given hash with zero-index

// The data list will also need to be changed so we include the index:
// $hash1,0
// $hash2,0
// $hash1,1
// $hash3,0

// FIXME:
//
// The recipient of the entity MUST NOT ignore any Content-*
// (e.g. Content-Range) headers that it does not understand or
// implement and MUST return a 501 (Not Implemented) response in such
// cases.

// Note, should result in a valid 201 on success.
// Or could do 202 to allow batching?

// FIXME: implement upload quotas. Each IP address can only upload a
// certain amount of data per day, and a max size for each upload.
function postDataItem(params) {
    var shasum, uparams, str = '', hex, references, contentPkey;

    function finis() {
        redirectTo(params, '/data/result?sha256=' + hex + '&prestate=none');
    }

    function insertedRefers(err, result) {
        if (err) {
            async_log(err);
        }
        finis();
    }

    function insertedRefersHashes(err, result) {
        if (err) {
            async_log(err);
        }
        if (references.length === 0) {
            finis();
            return;
        }
        var valuesStr = "('" + result.rows[0].pkey + "','" + result.rows[1].pkey + "')";

        for (var i = 2, len = result.rows.length; i < len; ++i) {
            valuesStr += ",('" + result.rows[0].pkey + "','" + result.rows[i].pkey + "')";
        }

        ds_refers_query("INSERT INTO refers (referrer,referree) VALUES " + valuesStr, [],
                       insertedRefers);
    }

    function deletedDuplicateInsert(err, result) {
        if (err) {
            async_log(err);
        }
        redirectTo(params, '/data/result?sha256=' + hex + '&prestate=same');
    }

    function writeContinue(err, result) {
        if (err) {
            async_log(err);
        }
        if ((result === null) || (result.rows.length === 0)) {
            redirectTo(params, '/data/result?sha256=' + hex + '&prestate=none');
            return;
        }

        for (var j = 0, jlen = result.rows.length; j < jlen; ++j) {
            if ((result.rows[j].content.toString('utf8') === uparams.content) &&
                (result.rows[j].pkey < contentPkey)) {
                ds_content_query("DELETE FROM content WHERE pkey=" + contentPkey, [],
                                 deletedDuplicateInsert);
                return;
            }
        }

        var valuesStr = "('" + hex + "')";
        references = getReferencedHashes(uparams.content);

        for (var i = 0, len = references.length; i < len; ++i) {
            valuesStr += ",('" + references[i] + "')";
        }

        ds_refers_query("INSERT INTO refers_hash (sha256) VALUES " + valuesStr + " RETURNING pkey", [],
                       insertedRefersHashes);
    }

    function selectContinue(err, result) {
        if (err) {
            async_log(err);
        }
        if ((result === null) || (result.rows.length === 0)) {
            redirectTo(params, '/data/result?sha256=' + hex + '&prestate=none');
            return;
        }
        contentPkey = result.rows[0].pkey;

        ds_content_query("SELECT pkey,content FROM content WHERE sha256='" + hex + "'", [], writeContinue);
    }

    function shasumRead() {
        var alreadyHas = null, newdata;
        hex = shasum.read(64);

        if (hex === null) {
            return;
        }

        ds_content_query("INSERT INTO content (sha256, content, gone) VALUES ('" + hex + "', $1, false) RETURNING pkey",
                         [uparams.content],
                         selectContinue);
    }

    function postDataItemEnd() {
        uparams = url.parse('?' + str, true).query;
        shasum = crypto.createHash('sha256');
        shasum.setEncoding('hex');
        shasum.on('readable', shasumRead);
        if (uparams.content !== '') {
            shasum.write(uparams.content);
        }
        shasum.end();
    }

    function postDataItemData() {
        var s = params.request.read();
        if (s !== null) {
            str += s;
        }
    }

    params.request.setEncoding('utf8');
    params.request.on('end', postDataItemEnd);
    params.request.on('readable', postDataItemData);
}

////////////////////////////////////////////////////////////////////////////////

function getDataItem(hash, cb) {
    function selectContinue(err, result) {
        if ((result !== null) && (result.rows.length > 0)) {
            cb(result.rows[0]);
            return;
        }
        cb(null);
    }

    ds_content_query("SELECT content FROM content WHERE sha256='" + hash + "' LIMIT 1", [], selectContinue);
}

// TODO: support Range header
function getDataItemPlain(params) {
    function gotDataItemPlain(rv) {
        var status, body;
        if (rv === null) {
            status = 404;
            body = '404: Not Found';
        } else if (rv.gone === true) {
            status = 410;
            body = '410: Gone';
        } else {
            status = 200;
            body = rv.content.toString('utf8');
        }
        sendResponse(params, status, body);
    }
    getDataItem(params.urlparts.pathname.substring('/data/'.length), gotDataItemPlain);
}

function getDataItemJson(params) {
    function gotDataItemJson(rv) {
        var status, body;
        if (rv === null) {
            status = 404;
            body = '{ "status": 404, "result": "Not Found" }';
        } else if (rv.gone === true) {
            status = 410;
            body = '{ "status": 410, "result": "Gone" }';
        } else {
            status = 200;
            body = JSON.stringify({ status: 200, result: "OK", content: rv.content.toString('utf8') });
        }
        sendResponse(params, status, body);
    }
    getDataItem(params.urlparts.pathname.substring('/data/'.length), gotDataItemJson);
}

function getDataItemHtml(params) {
    function gotDataItemHtml(rv) {
        var status, body;
        if (rv === null) {
            status = 404;
            body = '<!DOCTYPE html><html><head></head><body><h1>404: Not Found</h1><a href="/data">Continue</a></body></html>';
        } else if (rv.gone === true) {
            status = 410;
            body = '<!DOCTYPE html><html><head></head><body><h1>410: Gone</h1><a href="/data">Continue</a></body></html>';
        } else {
            status = 200;
            body = '<!DOCTYPE html><html><head></head><body><h1>200: OK</h1><pre>' + htmlEscape(rv.content.toString('utf8')) + '</pre><a href="/data">Continue</a></body></html>';
        }
        sendResponse(params, status, body);
    }
    getDataItem(params.urlparts.pathname.substring('/data/'.length), gotDataItemHtml);
}

////////////////////////////////////////////////////////////////////////////////

function getDataResult(params, cont) {

    function gotDataResult(err, result) {
        // XXX: this is wrong, because it may match a different
        // content on same hash
        if ((result !== null) && (result.rows.length > 0)) {
            cont({ err: 0, hash: query.sha256, prestate: query.prestate });
            return;
        }
        cont({ err: 2, hash: null, prestate: query.prestate });
    }

    var query = url.parse(params.request.url, true).query;

    if ((!('sha256' in query)) ||
        !looksLikeSha(query.sha256) ||
        ((query.prestate !== 'none') &&
         (query.prestate !== 'same') &&
         (query.prestate !== 'different'))) {
        cont({ err: 1, hash: null, prestate: null });
        return;
    }

    if (query.prestate === 'different') {
        cont({ err: 3, hash: null, prestate: query.prestate });
        return;
    }

    ds_content_query("SELECT content FROM content WHERE sha256='" + query.sha256 + "'", [], gotDataResult);
}

function getDataResultPlain(params) {
    function gotDataResultPlain(rv) {
        var body, status;

        if (rv.err === 1) {
            status = 400;
            body = '400 Bad Request: sha256 or prestate not supplied\n';
        } else if (rv.err === 2) {
            status = 500;
            body = '500 Internal Server Error: Data not uploaded\n';
        } else if (rv.err === 3) {
            status = 409;
            body = '409 Conflict: There is already another content with that hash. Please try altering the content slightly and try again\n';
        } else {
            params.headers.Location = '/data/' + rv.hash;

            if (rv.prestate === 'same') {
                status = 200;
                body = '200 OK: Data exists\n/data/' + rv.hash + '\n';

            } else {
                status = 201;
                body = '201 Created: Data successfully added\n/data/' + rv.hash + '\n';
            }
        }
        sendResponse(params, status, body);
    }
    getDataResult(params, gotDataResultPlain);
}

function getDataResultJson(params) {
    function gotDataResultJson(rv) {
        var body, status;

        if (rv.err === 1) {
            status = 400;
            body = '{ "status": 400, "result": "Bad Request", "message": "sha256 not supplied" }';
        } else if (rv.err === 2) {
            status = 500;
            body = '{ "status": 500, "result": "Internal Server Error", "message": "Data not uploaded" }\n';
        } else if (rv.err === 3) {
            status = 409;
            body = '{ "status": 409, "result": "Conflict", "message": "There is already another content with that hash. Please try altering the content slightly and try again" }\n';
        } else {
            params.headers.Location = '/data/' + rv.hash;

            if (rv.prestate === 'same') {
                status = 200;
                body = '{ "status": 200, "result": "OK", "message": "Data exists", "sha256": "' + rv.hash + '", "uri": "/data/' + rv.hash + '" }';

            } else {
                status = 201;
                body = '{ "status": 201, "result": "Created", "message": "Data successfully added", "sha256": "' + rv.hash + '", "uri": "/data/' + rv.hash + '" }';
            }
        }
        sendResponse(params, status, body);
    }
    getDataResult(params, gotDataResultJson);
}

function getDataResultHtml(params) {
    function gotDataResultHtml(rv) {
        var body, status;

        if (rv.err === 1) {
            status = 400;
            body = '<h1>400 Bad Request: sha256 not supplied</h1><a href="/data">Continue</a>';
        } else if (rv.err === 2) {
            status = 500;
            body = '<h1>500 Internal Server Error: Data not uploaded</h1><a href="/data">Continue</a>';
        } else if (rv.err === 3) {
            status = 409;
            body = '<h1>409 Conflict: There is already another content with that hash. Please try altering the content slightly and try again.</h1><a href="/data">Continue</a>';
        } else {
            params.headers.Location = '/data/' + rv.hash;

            if (rv.prestate === 'same') {
                status = 200;
                body = '<h1>200 OK: Data exists</h1><a href="/data/' + rv.hash + '">' + rv.hash + '</a><div><a href="/data">Continue</a></div>';

            } else {
                status = 201;
                body = '<h1>201 Created: Data successfully added</h1><a href="/data/' + rv.hash + '">' + rv.hash + '</a><div><a href="/data">Continue</a></div>';
            }
        }
        sendResponse(params, status, body);
    }
    getDataResult(params, gotDataResultHtml);
}

////////////////////////////////////////////////////////////////////////////////

function getStyleCss(params) {
    // 365 days
    params.headers['Cache-Control'] = 'max-age=31536000';
    // TODO: pre gzip -9 this into a new Buffer
    sendResponse(params, 200, data_server_css);
}

function getFaviconIco(params) {
    params.contentType = 'image/x-icon';
    // 30 days
    params.headers['Cache-Control'] = 'max-age=2592000';
    // TODO: use blank_favicon_gz where possible
    sendRawResponse(params, 200, blank_favicon);
}

////////////////////////////////////////////////////////////////////////////////

var APP_PORT = 1337;

var places_exact = {

    '/': {
        'GET': [
            { type: 'text/plain', action: getHomePagePlain },
            { type: 'text/html', action: getHomePageHtml }
        ]
    },

    '/data': {
        'GET': [
            { type: 'application/json', action: getDataListJson },
            { type: 'text/plain', action: getDataListPlain },
            { type: 'text/html', action: getDataListHtml }
        ],
        'POST': postDataItem
    },

    '/data/form': {
        'GET': [
            { type: 'text/html', action: getDataFormHtml }
        ],
    },

    '/data/result': {
        'GET': [
            { type: 'application/json', action: getDataResultJson },
            { type: 'text/plain', action: getDataResultPlain },
            { type: 'text/html', action: getDataResultHtml }
        ],
    },

    '/style': {
        'GET': [
            { type: 'text/css', action: getStyleCss }
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
        // Though it's possible to keep track of multiple contents of
        // same hash in the case of collision, this is not likely to
        // happen in the immediate future.
        //re: /\/data\/([0-9a-f]{64})\/entry\/[0-9]+/,
        re: /\/data\/([0-9a-f]{64})/,
        methods: {
            'GET': [
                // Only the text/plain represents the raw data -
                // text/html and application/json both add extra
                // markup around it.
                // XXX: add a binary type here too, in case text/plain
                // isn't known to be applicable.
                { type: 'application/json', action: getDataItemJson },
                { type: 'text/plain', action: getDataItemPlain },
                { type: 'text/html', action: getDataItemHtml }
            ]
            // TODO: support PUT
            //, 'PUT': putDataItem
        }
    }
];

////////////////////////////////////////////////////////////////////////////////

main();

////////////////////////////////////////////////////////////////////////////////
