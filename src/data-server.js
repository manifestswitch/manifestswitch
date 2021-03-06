
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

/// TODO: consider some kind of in-memory cache on the HTTP servers,
/// bounded by memory usage.

var ds_refers_conf = "postgres://ds_refers:_DS_REFERS_PASS_@localhost:5432/ds_refers";
var ds_content_conf = "postgres://ds_content:_DS_CONTENT_PASS_@localhost:5432/ds_content";

function ds_content_query(query, params, cb, cberr) {
    perform_query(ds_content_conf, query, params, cb, cberr);
}

function ds_refers_query(query, params, cb, cberr) {
    perform_query(ds_refers_conf, query, params, cb, cberr);
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

function varstring(n) {
    var s;
    if (n === 0) {
        return '';
    }
    s = '$1';
    for (var i = 2; i <= n; ++i) {
        s += ',$' + i;
    }
    return s;
}

////////////////////////////////////////////////////////////////////////////////

function getB64Key(s) {
    var key, buf;
    if (s.match(shab64Regex) === null) {
        return null;
    }
    if (s.length === 43) {
        s += '=';
    }
    return (new Buffer(s.replace(replaceB64Regex, replaceB64), 'base64')).toString('hex');
}

function keyOffsetsHash(cs, isB64) {
    var key, off, len = cs.length, top = len - 1, rv = { err: 0 };

    // unencoded alternative chars are provided as aliases to
    // base64 "/+=" chars
    for (var i = 0; i < top; ++i) {
        if (isB64) {
            key = getB64Key(cs[i]);
            if (key === null) {
                return { err: 9 };
            }
        } else {
            key = cs[i];
            if (key.match(fingerRegex) === null) {
                return { err: 8 };
            }
        }
        ++i;
        off = strPosInt(cs[i]);
        if (off < 0) {
            return { err: 2 };
        }
        rv[key] = off;
    }
    if (i !== len) {
        return { err: 3 };
    }

    return rv;
}

// restricted to a level that results in about 64KB max response size
var maxDataListCount = 256;
// this must be less than maxDataListCount. It's restricted because
// each key results in a separate db query
var maxDataListKeys = 64;

function nullableLength(x) {
    return x === null ? 0 : x.length;
}

function getDataList(params, cont) {
    var waiting = 0, cs_results = [], ks_results = [],
    cs = null, ks = null, csh, ksh, bailed = false, numKeys, countPerKey;

    function checkFinish() {
        --waiting;
        if (waiting !== 0) {
            return;
        }
        cont(cs_results, ks_results, null);
    }

    function problem(err) {
        if (!bailed) {
            bailed = true;
            cont(null, null, {reason:6});
        }
    }

    function gotChannelList(result) {
        if (result.rows.length > 0) {
            cs_results.push(result.rows);
        }
        checkFinish();
    }

    function gotFingerprintList(result) {
        if (result.rows.length > 0) {
            ks_results.push(result.rows);
        }
        checkFinish();
    }

    var query = url.parse(params.request.url, true).query;

    if (('c' in query) && (query.c !== '')) {
        cs = query.c.split('.');
    }
    if (('k' in query) && (query.k !== '')) {
        ks = query.k.split('.');
    }

    if ((cs === null) && (ks === null)) {
        cont(null, null, {reason:4});
        return;
    }

    if (cs !== null) {
        csh = keyOffsetsHash(cs, true);
        if (csh.err !== 0) {
            cont(null, null, {reason:csh.err});
            return;
        }
    }
    if (ks !== null) {
        ksh = keyOffsetsHash(ks, false);
        if (ksh.err !== 0) {
            cont(null, null, {reason:ksh.err});
            return;
        }
    }

    numKeys = Math.floor((nullableLength(cs) + nullableLength(ks)) / 2);

    if (numKeys > maxDataListKeys) {
        cont(null, null, {reason:5});
        return;
    }

    countPerKey = Math.floor(maxDataListCount / numKeys);

    // XXX: will need to spawn one query request per read_key we're
    // interested in.

    if (cs !== null) {
        for (var it in csh) {
            if (it === 'err') {
                continue;
            }
            ++waiting;
            ds_refers_query("SELECT '" + (new Buffer(it, 'hex')).toString('base64') + "' AS read_key,cc.sha256 FROM channel_content AS cc, read_keys AS rk WHERE rk.read_key=$1 AND cc.read_key=rk.pkey ORDER BY cc.pkey OFFSET $2 LIMIT $3",
                            ['\\x' + it, csh[it], csh[it] + countPerKey],
                            gotChannelList, problem);
        }
    }

    if (ks !== null) {
        for (var it in ksh) {
            if (it === 'err') {
                continue;
            }
            ++waiting;
            ds_refers_query("SELECT '" + it + "' AS fingerprint,fc.sha256 FROM fingerprint_content AS fc, fingerprint_alias AS fa WHERE fa.fingerprint=$1 AND fc.fingerprint_alias=fa.pkey ORDER BY fc.pkey OFFSET $2 LIMIT $3",
                            ['\\x' + it, ksh[it], ksh[it] + countPerKey],
                            gotFingerprintList, problem);
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

function getDataListPlain(params) {
    function gotDataListPlain(cs, ks, err) {
        var body = '', status;

        if (err !== null) {
            async_log(JSON.stringify(err));
            sendResponse(params, 500, 'Could not fetch list');
            return;
        }

        for (var i = 0, len = cs.length; i < len; ++i) {
            body += 'c ' + cs[i][0].read_key + '\n';
            for (var j = 0, jlen = cs[i].length; j < jlen; ++j) {
                body += cs[i][j].sha256.toString('hex') + '\n';
            }
        }
        for (var i = 0, len = ks.length; i < len; ++i) {
            body += 'k ' + ks[i][0].fingerprint + '\n';
            for (var j = 0, jlen = ks[i].length; j < jlen; ++j) {
                body += ks[i][j].sha256.toString('hex') + '\n';
            }
        }

        sendResponse(params, 200, body);
    }
    getDataList(params, gotDataListPlain);
}

////////////////////////////////////////////////////////////////////////////////

function getDataCount(params, cont) {
    var waiting = 0, cs_result = null, ks_result = null, cs = null, ks = null, bailed = false;

    function checkFinish() {
        --waiting;
        if (waiting !== 0) {
            return;
        }
        cont(cs_result, ks_result, null);
    }

    function problem(err) {
        if (!bailed) {
            bailed = true;
            cont(null, null, {reason:2});
        }
    }

    function gotChannelCounts(result) {
        cs_result = result.rows;
        checkFinish();
    }

    function gotFingerprintCounts(result) {
        ks_result = result.rows;
        checkFinish();
    }

    var query = url.parse(params.request.url, true).query, key;

    if (('c' in query) && (query.c !== '')) {
        cs = query.c.split('.');
        // unencoded alternative chars are provided as aliases to
        // base64 "/+=" chars
        for (var i = 0, len = cs.length; i < len; ++i) {
            key = getB64Key(cs[i]);
            if (key === null) {
                return { reason: 3 };
            }
            cs[i] = '\\x' + key;
        }
    }

    if (('k' in query) && (query.k !== '')) {
        ks = query.k.split('.');
        for (var i = 0, len = ks.length; i < len; ++i) {
            key = ks[i];
            if (key.match(fingerRegex) === null) {
                return { err: 4 };
            }
            ks[i] = '\\x' + key;
        }
    }

    if ((cs === null) && (ks === null)) {
        cont(null, null, {reason:1});
        return;
    }

    if (cs !== null) {
        ++waiting;
        var csstr = varstring(cs.length);
        ds_refers_query('SELECT rk.read_key,COUNT(cc.pkey) FROM channel_content AS cc, read_keys AS rk WHERE rk.read_key IN (' + csstr + ') AND cc.read_key=rk.pkey GROUP BY rk.read_key',
                        cs,
                        gotChannelCounts, problem);
    }
    if (ks !== null) {
        ++waiting;
        var ksstr = varstring(ks.length);
        ds_refers_query('SELECT fa.fingerprint,COUNT(fc.pkey) FROM fingerprint_content AS fc, fingerprint_alias AS fa WHERE fa.fingerprint IN (' + ksstr + ') AND fc.fingerprint_alias=fa.pkey GROUP BY fa.fingerprint',
                        ks,
                        gotFingerprintCounts, problem);
    }
}

function formatReadKey(buf) {
    return buf.toString('base64');
}
function formatFingerprint(buf) {
    return buf.toString('hex').toUpperCase();
}

// TODO: The entries should probably be sorted either alphabetically
// or by the order given in the query string, to prevent leaking info
// about their add date

function getDataCountPlain(params) {
    function gotDataCountPlain(cs, ks, err) {
        var body = '', status;

        if (err !== null) {
            sendResponse(params, 500, 'Could not fetch list counts');
            return;
        }

        if (cs !== null) {
            for (var i = 0, len = cs.length; i < len; ++i) {
                body += 'c ' + formatReadKey(cs[i].read_key) + ' ' + cs[i].count + '\n';
            }
        }
        if (ks !== null) {
            for (var i = 0, len = ks.length; i < len; ++i) {
                body += 'k ' + formatFingerprint(ks[i].fingerprint) + ' ' + ks[i].count + '\n';
            }
        }

        sendResponse(params, 200, body);
    }
    getDataCount(params, gotDataCountPlain);
}

function getDataCountJson(params) {
    function gotDataCountJson(cs, ks, err) {
        var body = '', status;

        if (err !== null) {
            sendResponse(params, 500, '{ "status": 500, "result": "Internal Server Error", "code": 0, "message": "Could not fetch list counts." }');
            return;
        }

        body = '{ "status": 200, "result": "OK", "keys": {';
        if (cs !== null) {
            for (var i = 0, len = cs.length; i < len; ++i) {
                body += '"' + formatReadKey(cs[i].read_key) + '": ' + cs[i].count + ',\n';
            }
        }
        body += '}, "fingerprints": {';
        if (ks !== null) {
            for (var i = 0, len = ks.length; i < len; ++i) {
                body += '"' + formatFingerprint(ks[i].fingerprint) + '": ' + ks[i].count + ',\n';
            }
        }
        body += '} }';

        sendResponse(params, 200, body);
    }

    getDataCount(params, gotDataCountJson);
}

function getDataCountHtml(params) {
    function gotDataCountHtml(cs, ks, err) {
        var body = '<table><tbody>', status;

        if (err !== null) {
            sendResponse(params, 500, 'Could not fetch list counts');
            return;
        }

        if (cs !== null) {
            for (var i = 0, len = cs.length; i < len; ++i) {
                body += '<tr><td>' + formatReadKey(cs[i].read_key) + '</td><td>' + cs[i].count + '</td></tr>\n';
            }
        }
        if (ks !== null) {
            for (var i = 0, len = ks.length; i < len; ++i) {
                body += '<tr><td>' + formatFingerprint(ks[i].fingerprint) + '</td><td>' + ks[i].count + '</td></tr>\n';
            }
        }
        body += '</tbody></table>';

        sendResponse(params, 200, body);
    }
    getDataCount(params, gotDataCountHtml);
}

////////////////////////////////////////////////////////////////////////////////

function getDataFormHtml(params) {
    var body = ('    <form action="/data" method="POST">\n' +
                '      <input type="text" name="c">\n' +
                '      <input type="text" name="k">\n' +
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

// TODO: some kind of expiry / max size limit
// write_key -> read_pkey
var read_key_cache = {};

// FIXME: implement upload quotas. Each IP address can only upload a
// certain amount of data per day, and a max size for each upload.
function postDataItem(params) {
    var shasum, contentSize = 0, hex, content = '\\x',
    c = null, k = null, hashPkey, rsha, read_key = '', rpkey, waiting = 2, waitingB = 2, aborted = false;

    function problem() {
        aborted = true;
        sendResponse(params, 500, 'Could not insert data');
    }

    // This is a barrier on both the content and its hash in the
    // channel list having been written.
    function checkContinueB() {
        if (aborted) {
            return;
        }
        --waitingB;
        if (waitingB === 0) {
            params.contentType = preferredOutput(params.request.headers.accept,
                                                 ['text/plain', 'application/json', 'text/html']);
            if (params.contentType === 'text/plain') {
                // this is beneficial for scripted programs to know
                // immediately if the post was successful, without
                // having to follow a redirect.
                sendResponse(params, 200, hex);
            } else {
                redirectTo(params, '/data/result?sha256=' + hex + '&prestate=none');
            }
        }
    }

    function insertedChannelContent(result) {
        trace(Date.now() + ' ' + 'inserted channel entry');
        checkContinueB();
    }

    function insertedContent(result) {
        trace(Date.now() + ' ' + 'inserted data');
        checkContinueB();
    }

    // This is a barrier on having both the hash and the channel key
    // Arguably we should also wait until the content is inserted
    // before inserting the channel content. Since anyone accessing
    // will get 404 until then.
    function checkContinueA() {
        if (aborted) {
            return;
        }
        --waiting;
        if (waiting === 0) {
            if (c !== null) {
                ds_refers_query('INSERT INTO channel_content (read_key, sha256) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM channel_content WHERE read_key=$1 AND sha256=$2)',
                                [rpkey, '\\x' + hex],
                                insertedChannelContent, problem);
            } else {
                ds_refers_query('INSERT INTO fingerprint_content (fingerprint_alias, sha256) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM fingerprint_content WHERE fingerprint_alias=$1 AND sha256=$2)',
                                [rpkey, '\\x' + hex],
                                insertedChannelContent, problem);
            }
        }
    }

    function shasumRead() {
        var alreadyHas = null, newdata;

        if (aborted) {
            return;
        }
        hex = shasum.read(64);

        if (hex === null) {
            return;
        }

        trace(Date.now() + ' ' + 'got hex');
        checkContinueA();
        ds_content_query("INSERT INTO content (sha256, content, gone) SELECT $1, $2, false WHERE NOT EXISTS (SELECT 1 FROM content WHERE sha256=$1)",
                         ['\\x' + hex, content],
                         insertedContent, problem);
        content = null;
    }

    function gotFingerprintAlias(result) {
        if (result.rows.length === 0) {
            problem();
            return;
        }
        trace(Date.now() + ' ' + 'got read pkey');
        rpkey = result.rows[0].pkey;
        checkContinueA()
    }

    function gotReadPkey(result) {
        trace(Date.now() + ' ' + 'got read pkey');
        rpkey = result.rows[0].pkey;
        read_key_cache[c] = rpkey;
        checkContinueA();
    }

    function insertedReadPkey(result) {
        if (aborted) {
            return;
        }
        trace(Date.now() + ' ' + 'inserted/ignored read key');
        ds_refers_query('SELECT pkey FROM read_keys WHERE read_key=$1',
                        ['\\x' + read_key],
                        gotReadPkey, problem);
    }

    function rshaEnd() {
        if (aborted) {
            return;
        }
        trace(Date.now() + ' ' + 'got read key');
        // is insert/ignore slow on bytea?
        ds_refers_query('INSERT INTO read_keys (read_key) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM read_keys WHERE read_key=$1)',
                        ['\\x' + read_key],
                        insertedReadPkey, problem);
    }

    function rshaRead() {
        var s = rsha.read();
        if (s !== null) {
            read_key += s;
        }
    }

    function postDataItemEnd() {
        trace(Date.now() + ' ' + 'got data');
        shasum.end();
    }

    function postDataItemData() {
        var ch = params.request.read();
        if (ch !== null) {
            contentSize += ch.length;
            // TODO: have a more intelligent quota check
            if (contentSize > 4096) {
                aborted = true;
                sendResponse(params, 400, 'Maximum input is 4096 bytes');
                return;
            }
            if (ch.length > 0) {
                shasum.write(ch);
            }
            content += ch.toString('hex');
        }
    }

    if (('x-c' in params.request.headers) && (params.request.headers['x-c'] !== '')) {
        c = params.request.headers['x-c'];
    }
    if (('x-k' in params.request.headers) && (params.request.headers['x-k'] !== '')) {
        k = params.request.headers['x-k'];
    }
    if ((c === null) && (k === null)) {
        sendResponse(params, 400, 'Please supply a write token "c" or "k"');
        return;
    }
    if ((c !== null) && (k !== null)) {
        sendResponse(params, 400, 'Please supply only one write token "c" or "k"');
        return;
    }

    trace(Date.now() + ' ' + 'start');

    waiting = 2;
    waitingB = 2;
    if (c !== null) {
        if (c in read_key_cache) {
            rpkey = read_key_cache[c];
            checkContinueA();
        } else {
            // sha256 c into base64
            rsha = crypto.createHash('sha256');
            rsha.setEncoding('hex');
            rsha.on('readable', rshaRead);
            rsha.on('end', rshaEnd);
            if (c !== '') {
                rsha.write(c);
            }
            rsha.end();
        }
    } else {
        // select alias from table
        ds_refers_query('SELECT pkey FROM fingerprint_alias WHERE write_key=$1',
                        ['\\x' + (new Buffer(k, 'base64')).toString('hex')],
                        gotFingerprintAlias, problem);
    }

    shasum = crypto.createHash('sha256');
    shasum.setEncoding('hex');
    shasum.on('readable', shasumRead);

    params.request.on('end', postDataItemEnd);
    params.request.on('readable', postDataItemData);
}

////////////////////////////////////////////////////////////////////////////////

function postWriteToken(params) {
    var fingerprint, token;

    function fail() {
        sendResponse(params, 500, 'Could not generate key');
    }

    function insertedToken(result) {
        sendResponse(params, 200, token.toString('hex'));
    }

    function gotBytes(err, bytes) {
        token = bytes;
        if (err !== null) {
            fail();
            return;
        }

        ds_refers_query('INSERT INTO fingerprint_alias (write_key, fingerprint) VALUES ($1, $2)',
                        ['\\x' + bytes.toString('hex'), '\\x' + fingerprint],
                        insertedToken, fail);

    }

    function gotFormData(params, uparams) {
        fingerprint = uparams.fingerprint
        if (fingerprint.match(fingerRegex) === null) {
            sendResponse(params, 400, 'Invalid fingerprint');
            return;
        }
        crypto.randomBytes(18, gotBytes);
    }

    getFormData(params, gotFormData);
}

////////////////////////////////////////////////////////////////////////////////

function getDataItem(hash, cb) {
    function selectFail(err) {
        cb(null);
    }

    function selectContinue(result) {
        cb(result.rows[0]);
    }

    ds_content_query("SELECT content FROM content WHERE sha256='\\x" + hash + "' LIMIT 1", [], selectContinue, selectFail);
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
            body = rv.content;
        }
        params.contentType = 'text/plain; charset=utf-8';
        sendRawResponse(params, status, body);
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

    function failDataResult(err) {
        cont({ err: 2, hash: null, prestate: query.prestate });
    }

    function gotDataResult(result) {
        // XXX: this is wrong, because it may match a different
        // content on same hash
        cont({ err: 0, hash: query.sha256, prestate: query.prestate });
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

    ds_content_query("SELECT content FROM content WHERE sha256='\\x" + query.sha256 + "'", [],
                     gotDataResult, failDataResult);
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

    '/count': {
        'GET': [
            { type: 'application/json', action: getDataCountJson },
            { type: 'text/plain', action: getDataCountPlain },
            { type: 'text/html', action: getDataCountHtml }
        ]
    },

    '/data': {
        'GET': [
            { type: 'text/plain', action: getDataListPlain }
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

    '/token': {
        'POST': postWriteToken
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
        re: /^\/data\/([0-9a-f]{64})$/,
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
