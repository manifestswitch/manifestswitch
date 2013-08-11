
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

"use strict";

var cluster = require('cluster');

var domain = require('domain');

var http = require('http');
var url = require('url');
var fs = require('fs');
var crypto = require('crypto');

var pg = require('pg').native;

//// Site Infrastructure

// 80 -> upgrade_success -> 443
// 80 -> upgrade_failed -> 81
// 443 -> STUD (or HAProxy SSL?) -> 81
// 81 -> HAProxy -> 101-10X where X is number of processors
// (Possibility also to route to 192.168.0.N:10X for even more processes)

// 10X holds an instance of node running this server.  There is a
// single Redis instance which all Node instances use as a backing
// database, it is persisted reasonably frequently without degrading
// performance. No PostgreSQL, consistency not needed.

// Could avoid contention by giving each Node process its own Redis
// instance or JS-object store or (potentially expiring) cache. But
// there should still be a single authoratitive Redis store.

// If I do set sticky server allocation with HAProxy (probably helpful
// for caching), then just make it so that server shutdown commits the
// data to a central Redis so another Node can pick up from there.

// Try to use SPDY, may need to add nginx for that

// "airport and fleet can be used to manage processes"
// https://github.com/isaacs/npm-www a good example of webapp
// Can I just ignore that and use HAProxy?

//// Global Infrastructure

// Use a CDN for static images, css, and js
// Use cloudflare for DDOS protection

// First hit to www.blah.com/ should go to either London or East Coast.
// The links in that page are all rewritten to go to dcZ.blah.com
// which should be close to where the IP is expected to be from.

// TODO: Lookup how to do geo DNS

//// Code (micro)performance improvements

// Google Compiler on full optimisation
// JSMacro
// Low level JS
// asm.js

// Everything is Async
// Anything that is not instant must be shoved off to a worker process.
//  - what is the overhead in communication code/memory/cache with the other process?
//  - how many worker processes are possible before diminishing returns?

////

var preferredOutput, places_exact, places_regex;

var blank_favicon = new Buffer('AAABAAEAEBACAAEAAQCwAAAAFgAAACgAAAAQAAAAIAAAAAEAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'base64');
// XXX: is it better to load binary data from files at startup?
var blank_favicon_gz = new Buffer('H4sICPoYx1ECA2Zhdmljb24uaWNvAGNgYARCAQEmML2BgYFBDIg1gFgAiBWAGCSOC/z//59hMAAA592VUsYAAAA=', 'base64');

//@include accept.js
//@end

var APP_PORT;

// XXX: make @Constant
var APPEND_MODE = { mode: 420, flag: 'a' };

////////////////////////////////////////////////////////////////////////////////
/// LOGGING

function do_nothing() {

}

// really bad if it happens
function log_failure(err) {
    if (err !== null) {
        console.error(err);
    }
}

function logError(e) {
    async_log('ERROR', e);
}

var async_will_log = false;
var async_log_jobs = [];
var async_id = '';

// This function should be reasonably fast so as not to get in the way
// of work
function runAsyncLog() {
    async_will_log = false;
    var str = '', date = Date.now() + ' ';

    for (var item, e, i = 0, len = async_log_jobs.length; i < len; ++i) {
        item = async_log_jobs[i];
        e = item.e
        str += date + async_id + item.msg + '\n' + (((e === null) || (e === undefined)) ? '' : e.stack + '\n');
    }

    fs.writeFile('var/log/applog', str, APPEND_MODE, log_failure);
    async_log_jobs = [];
}

// The caller is definitely doing stuff, so we get out of its way -
// hopefully when the setTimeout fires things will be quiet.  This
// also means we're not doing one write per log line, which would be
// silly.
function async_log(msg, e) {
    if (!async_will_log) {
        async_will_log = true;
        setTimeout(runAsyncLog, 0);
    }
    async_log_jobs.push({ msg: msg, e: e });
}

function trace(msg) {
    async_log('TRACE ' + msg);
}

////////////////////////////////////////////////////////////////////////////////
/// BINARY utils

var hashonly_re = /^([0-9a-f]{64})$/;
var hash_re = /([0-9a-f]{64})/g;

var fingerRegex = /^[0-9A-F]{40}$/;
var shab64Regex = /^[0-9a-zA-Z_-]{43}~?$/;
var ushab64Regex = /^[0-9a-zA-Z\/\+]{43}=?$/;

function isHexCode(ch) {
    return ((ch >= 48) && (ch <= 57)) || ((ch >= 97) && (ch <= 104));
}

function looksLikeSha(str) {
    var len = str.length, ch, i;
    if (len !== 64) {
        return false;
    }
    for (i = 0; i < len; ++i) {
        ch = str.charCodeAt(i);
        if (!((ch >= 48) && (ch <= 57)) && !((ch >= 97) && (ch <= 104))) {
            return false;
        }
    }
    return true;
}

function getReferencedHashes(content) {
    var hashes = [];
    var r = hash_re.exec(content);

    while (r !== null) {
        if (((r.index === 0) || !isHexCode(content.charCodeAt(r.index - 1))) &&
            (((r.index + 64) === content.length) || !isHexCode(content.charCodeAt(r.index + 64)))) {
            hashes.push(content.substring(r.index, r.index + 64));
        }
        r = hash_re.exec(content);
    }
    return hashes;
}

function replaceB64(chr) {
    if (chr === '-') {
        return '+';
    }
    if (chr === '_') {
        return '/';
    }
    if (chr === '~') {
        return '=';
    }
    return chr;
}

function unreplaceB64(chr) {
    if (chr === '+') {
        return '-';
    }
    if (chr === '/') {
        return '_';
    }
    if (chr === '=') {
        return '~';
    }
    return chr;
}

var replaceB64Regex = /[_~-]/g;
var unreplaceB64Regex = /[\+\/=]/g;

function strPosInt(x) {
    var rv = parseInt(x, 10);
    if ((rv !== rv) || ((rv + '') !== x)) {
        return -1;
    }
    return rv;
}

////////////////////////////////////////////////////////////////////////////////
/// Database

function perform_query(conf, query, params, cb, cberr) {
    var done_save;

    function got_query(err, result) {
        done_save();

        if (err !== null) {
            async_log('error in query: ' + query, err);
            if (cberr !== null) {
                cberr(err)
            } else {
                cb(null);
            }
            return;
        }
        cb(result);
    }

    function got_connect(err, client, done) {
        done_save = done;
        if (err) {
            cb(err, null);
            return;
        }
        client.query(query, params, got_query);
    }
    pg.connect(conf, got_connect);
}

////////////////////////////////////////////////////////////////////////////////
/// HTML output

function replaceEntities(chr) {
    if (chr === '&') {
        return '&amp;';
    }
    if (chr === '<') {
        return '&lt;';
    }
    if (chr === '>') {
        return '&gt;';
    }
    return chr;
}

var entityRegex = /[&<>]/g;

function htmlEscape(s) {
    return s.replace(entityRegex, replaceEntities);
}

function htmlQuote(s) {
    // FIXME: do the escaping!
    return s;
}

////////////////////////////////////////////////////////////////////////////////
/// COOKIES

// This aims to be a fully compliant implementation, but currently
// might be a partial implementation.
//
// FIXME: this is almost certainly vulnerable to user input
function parseCookies(cookieStr) {
    var cookies = {}, eq, value, parts;

    if (cookieStr) {
        parts = cookieStr.split(';');

        for (var i = 0, len = parts.length; i < len; ++i) {
            eq = parts[i].indexOf('=');

            if (eq == -1) {
                value = null;
            } else {
                value = parts[i].substring(eq + 1);
            }

            cookies[parts[i].substring(0, eq).trimLeft(' ')] = { value: value };
        }
    }

    return cookies;
}

function cookiesToList(cookies) {
    var parts = [], i = 0;

    for (var x in cookies) {
        // TODO: path=/;
        parts[i++] = x + '=' + cookies[x].value + '; HttpOnly; Secure';
    }
    return parts;
}

////////////////////////////////////////////////////////////////////////////////
/// SESSIONS

var rand_pool = null;
var rand_wakeme = [];
var rand_getting = false;

function sessionIdGotRand(ex, buf) {
    var wakes = rand_wakeme;
    rand_getting = false;

    if (ex) {
        async_log('sessionIdGotRand', ex);
    }

    if (rand_pool !== null) {
        rand_pool = Buffer.concat([rand_pool, buf]);
    } else {
        rand_pool = buf;
    }
    rand_wakeme = [];

    for (var i = 0, len = wakes.length; i < len; ++i) {
        createSessionId(wakes[i]);
    }
}

function createSessionId(cont) {
    var mine, idsize = 64;

    if (!rand_getting && (rand_pool === null) || (rand_pool.length < 1024)) {
        rand_getting = true;
        crypto.randomBytes(2048, sessionIdGotRand);
    }

    if ((rand_pool !== null) && (rand_pool.length >= idsize)) {
        mine = rand_pool.slice(0, idsize).toString('base64');
        rand_pool = rand_pool.slice(idsize);
        cont(mine);
    } else {
        rand_wakeme.push(cont);
    }
}

function hasSessionCookie(params) {
    return ('s' in params.cookies);
}

////////////////////////////////////////////////////////////////////////////////
/// REQUEST input

function getFormData(params, cont) {
    var str = '';

    function postDataEnd() {
        var uparams = url.parse('?' + str, true).query;
        cont(params, uparams);
    }

    function postDataRead() {
        var s = params.request.read();
        if (s !== null) {
            str += s;
        }
    }

    params.request.setEncoding('utf8');
    params.request.on('end', postDataEnd);
    params.request.on('readable', postDataRead);
}

////////////////////////////////////////////////////////////////////////////////
/// RESPONSE output

function sendResponse(params, status, body) {
    // assume it is only null for the non-GET/HEAD case
    if (params.contentType !== null) {
        // Accept-Charset is ignored. UTF-8 is the only supported output,
        // and instead of strictly returning 406 if * or utf-8 are not
        // present in Accept-Charset, it's better to just let the client
        // try to process it as ASCII if it comes down to that.
        params.headers['Content-Type'] = params.contentType + '; charset=utf-8';
    }
    params.headers['Content-Length'] = Buffer.byteLength(body, 'utf8');
    params.headers["Set-Cookie"] = cookiesToList(params.cookies);
    params.response.writeHead(status, params.headers);

    if (params.request.method === 'HEAD') {
        params.response.end();
    } else {
        params.response.end(body);
    }

    trace(Date.now() + '\t' + status + ' ' + params.headers['Content-Length']);
}

function sendRawResponse(params, status, body) {
    if (params.contentType !== null) {
        params.headers['Content-Type'] = params.contentType;
    }
    params.headers['Content-Length'] = body.length;
    params.headers["Set-Cookie"] = cookiesToList(params.cookies);
    params.response.writeHead(status, params.headers);

    if (params.request.method === 'HEAD') {
        params.response.end();
    } else {
        params.response.end(body);
    }

    trace(Date.now() + '\t' + status + ' ' + body.length);
}

function redirectTo(params, location) {
    var body;

    params.contentType = preferredOutput(params.request.headers.accept,
                                         ['application/json', 'text/plain', 'text/html']);

    if (params.contentType === null) {
        // it wouldn't be appropriate to 406, so just force html instead.
        params.contentType = 'text/html';
    }

    switch (params.contentType) {
    case 'application/json':
        body = '{ "status": 303, "result": "See Other", "location": "' + location + '" }\n';
        break;
    case 'text/plain':
        body = '303: See Other: ' + location + '\n';
        break;
    case 'text/html':
        body = '303: See Other: <a href="' + htmlQuote(location) + '">' + htmlEscape(location) + '</a>';
        break;
    }

    params.headers.Location = location;
    sendResponse(params, 303, body);
}

////////////////////////////////////////////////////////////////////////////////
/// ERROR pages

function getPlain404(params) {
    var body = '404: Not Found';
    sendResponse(params, 404, body);
}

function getJson404(params) {
    var body = '{ "status": 404, "result": "Not Found" }';
    sendResponse(params, 404, body);
}

function getHtml404(params) {
    var body = '<h1>404: Not Found</h1><a href="/">Continue</a>';
    sendResponse(params, 404, body);
}


// TODO: add header, eg. "Allow: GET, PUT"
function getPlain405(params) {
    var allow = Object.keys(params.place).join(', ');
    var body = "405: Method Not Allowed";
    params.headers.Allow = allow;
    sendResponse(params, 405, body);
}

function getJson405(params) {
    var body = '{ "status": 405: "result": "Method Not Allowed" }';
    params.headers.Allow = Object.keys(params.place).join(', ');
    sendResponse(params, 405, body);
}

function getHtml405(params) {
    var allow = Object.keys(params.place).join(', ');
    var body = "<h1>405: Method Not Allowed</h1>";
    params.headers.Allow = allow;
    sendResponse(params, 405, body);
}


function getPlain406(params) {
    var body = '406: Not Acceptable\n\n';
    body += 'Requested: ' + params.request.headers.accept + '\n';
    body += 'Supported: ' + params.place[params.request.method].types + '\n';
    sendResponse(params, 406, body);
}

function getJson406(params) {
    var body = JSON.stringify({
        status: 406,
        result: "Not Acceptable",
        message: 'This URI does not support any of the requested types, the supported types are listed here.',
        requested: params.request.headers.accept,
        supported: params.place[params.request.method].types
    });

    sendResponse(params, 406, body);
}

function getHtml406(params) {
    var body = '<h1>406: Not Acceptable</h1>';
    body += '<table><tbody><tr><th>Requested</th><td>' + params.request.headers.accept + '</td></tr>\n';
    body += '<tr><th>Supported</th><td>' + params.place[params.request.method].types + '</td></tr></tbody></table>\n';
    sendResponse(params, 406, body);
}

function getPlain500(params) {
    var body = '500: Internal Server Error';
    sendResponse(params, 500, body);
}

function getJson500(params) {
    var body = '{ "status": 500, "result": "Internal Server Error" }';
    sendResponse(params, 500, body);
}

function getHtml500(params) {
    var body = '<h1>500: Internal Server Error</h1>';
    sendResponse(params, 500, body);
}

////////////////////////////////////////////////////////////////////////////////
/// PLACES

// It is very important to maintain the constraint that all error
// pages can respond to all of the supported types across all of the
// supported methods for valid URLs.
// This means we can always respond to failure in the desired type.
function verify_error_pages() {
    for (var key in places_exact) {
        for (var method in places_exact[key]) {
            
        }
    }

}

function getPlace(params) {
    if (params.urlparts.pathname in places_exact_compiled) {
        return places_exact_compiled[params.urlparts.pathname];
    } else {
        // if there are lots of regexps, this could be further
        // optimized into a tree structure, so not every regexp is
        // tried.
        for (var i = 0, len = places_regex_compiled.length; i < len; ++i) {
            if (params.urlparts.pathname.match(places_regex_compiled[i].re)) {
                return places_regex_compiled[i].methods;
            }
        }
    }
    return null;
}

function actionFromPlace(p, t) {
    for (var i = 0, len = p.length; i < len; ++i) {
        if (p[i].type === t) {
            return p[i].action;
        }
    }
    return null;
}

var places_exact_compiled = {};
var places_regex_compiled = [];

function compile_places_preferred() {
    var place, method;

    function getType(x) { return x.type; }

    for (var loc in places_exact) {
        places_exact_compiled[loc] = {};
        place = places_exact[loc];

        for (method in place) {
            if ((method === 'GET') || (method === 'HEAD')) {

                places_exact_compiled[loc][method] = {
                    types: place[method].map(getType),
                    actions: {}
                };

                for (var i = 0, len = place[method].length; i < len; ++i) {
                    places_exact_compiled[loc][method].actions[place[method][i].type] = place[method][i].action;
                }

            } else {
                places_exact_compiled[loc][method] = place[method];
            }
        }
    }

    for (var j = 0, jlen = places_regex.length; j < jlen; ++j) {
        place = places_regex[j];
        var newplace = { re: place.re, methods: {} };
        places_regex_compiled.push(newplace);

        for (method in place.methods) {
            if ((method === 'GET') || (method === 'HEAD')) {

                newplace.methods[method] = {
                    types: place.methods[method].map(getType),
                    actions: {}
                };

                for (var k = 0, klen = place.methods[method].length; k < klen; ++k) {
                    newplace.methods[method].actions[place.methods[method][k].type] = place.methods[method][k].action;
                }

            } else {
                newplace.methods[method] = place.methods[method];
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////

function doError(params, n) {
    if ((params.request.method !== 'GET' ) && (params.request.method !== 'HEAD' )) {
        redirectTo(params, '/error/' + n);

    } else {
        var place = places_exact_compiled['/error/' + n];

        params.contentType = preferredOutput(params.request.headers.accept, place[params.request.method].types);

        if (params.contentType === null) {
            // we're on an error page, and *no* Content-Type was
            // considered acceptable to the client. In this case, we
            // fall back to text/html, since it is least surprising to
            // most clients (all error pages support this type).
            params.contentType = 'text/html';
        }

        var action = place[params.request.method].actions[params.contentType];
        action(params);
    }
}

function domainRunFunction(req, res) {
    return function () {
        var method;
        var params = {
            request: req,
            response: res,
            headers: {},
            contentType: null,
            cookies: null,
            place: null,
            urlparts: null
        };

        try {
            params.urlparts = url.parse(req.url);

            params.cookies = parseCookies(req.headers.cookie);

            // We need two kinds of auth protections:
            // 1) POST login hits should be limited to 1/s per IP
            // 1) POST login hits should be limited to 1/s per username
            // 2) Any other request that requires a valid session,
            // including POST logout, should be limited to 1/s per IP.
            // - really? this would affect valid users too
            //
            // Why can't we only rate-limit invalid requests? So if a
            // given IP has had an invalid request within the last
            // second, we disallow until it's clear.

            if (!hasSessionCookie(params)) {
                // TODO: rate-limit by IP address
                // req.connection.remoteAddress
            }

            params.place = getPlace(params);

            if (params.place === null) {
                doError(params, 404);
                return;
            }

            if ((req.method === 'HEAD') && !('HEAD' in params.place)) {
                method = 'GET';
            } else {
                method = req.method;
            }
            if (!(method in params.place)) {
                doError(params, 405);
                return;
            }

            if ((req.method !== 'GET' ) && (req.method !== 'HEAD' )) {
                params.place[req.method](params);

            } else {
                params.contentType = preferredOutput(req.headers.accept, params.place[method].types);

                if (params.contentType === null) {
                    doError(params, 406);
                    return;
                }

                params.place[method].actions[params.contentType](params);
            }

        } catch (e) {
            async_log('doReq 500', e);
            doError(params, 500);
        }
    };
}

////////////////////////////////////////////////////////////////////////////////
/// DOMAIN error handling

// global, needed so we can shut ourselves down.
var server;

function domainErrorKill() {
    if (process !== undefined) {
        process.exit(1);
    }
}

function domainErrorFunction(req, res) {
    return function(er) {
        var killtimer, params;

        // Note: we're in dangerous territory!
        // By definition, something unexpected occurred,
        // which we probably didn't want.
        // Anything can happen now!  Be very careful!

        try {
            console.error(er);
            async_log('FATAL ', er);

            // make sure we close down within 30 seconds
            killtimer = setTimeout(domainErrorKill, 30000);
            // But don't keep the process open just for that!
            killtimer.unref();

            // stop taking new requests.
            // is there a way to check if it's still running?
            try {
                server.close();
            } catch (e) {
            }

            // Let the master know we're dead.  This will trigger a
            // 'disconnect' in the cluster master, and then it will fork
            // a new worker.
            cluster.worker.disconnect();

            // try to send an error to the request that triggered the problem
            params = {
                request: req,
                response: res,
                headers: {}
            };

            doError(params, 500);

        } catch (er2) {
            // oh well, not much we can do at this point.
            console.error(er2);
        }
    };
}

function clusterDisconnect(worker) {
    async_log('disconnect!');
    cluster.fork();
}

////////////////////////////////////////////////////////////////////////////////
/// CORE HTTP server

function doReq(req, res) {
    trace(Date.now() + '\t' + req.method + ' ' + req.url);

    var d = domain.create();

    d.add(req);
    d.add(res);

    d.on('error', domainErrorFunction(req, res));
    d.run(domainRunFunction(req, res));
}

var ip = '127.0.0.1';

function startServer() {
    //process.on('SIGKILL', cleanlyExit);
    //process.on('SIGINT', cleanlyExit);

    server = http.createServer(doReq);

    server.listen(APP_PORT, ip);
    async_log('Server running at http://' + ip + ':' + APP_PORT + '/', null);
}

////////////////////////////////////////////////////////////////////////////////

function main() {
    async_id = ip + ':' + APP_PORT + '\t' + ((cluster.worker !== null) ? cluster.worker.id + '\t' : '0\t') + __filename.substring(__filename.lastIndexOf('/')) + '\t';

    if (cluster.isMaster) {
        // In real life, you'd probably use more than just 2 workers,
        // and perhaps not put the master and worker in the same file.
        //
        // You can also of course get a bit fancier about logging, and
        // implement whatever custom logic you need to prevent DoS
        // attacks and other bad behavior.
        //
        // See the options in the cluster documentation.
        //
        // The important thing is that the master does very little,
        // increasing our resilience to unexpected errors.
        trace('cluster.fork()');
        cluster.fork();

        //trace('cluster.fork()');
        //cluster.fork();

        cluster.on('disconnect', clusterDisconnect);
    } else {
        trace('verify_error_pages()');
        verify_error_pages();

        compile_places_preferred();

        startServer();
    }
}

////////////////////////////////////////////////////////////////////////////////
