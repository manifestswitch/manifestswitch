
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

'use strict';

////////////////////////////////////////////////////////////////////////////////
/// Stuff to do with HTTP Accept

function parseAccept(accept) {
    var rv = {}, spl;

    if ((accept === undefined) || (accept === null)) {
        return null;
    }

    spl = accept.split(',');

    for (var i = 0, len = spl.length, params, spli, spl2; i < len; ++i) {
        spli = spl[i];
        spl2 = spli.split(';');
        params = {};

        for (var j = 1, len2 = spl2.length, spl3, value; j < len2; ++j) {
            spl3 = spl2[j].split('=');
            value = spl3.length > 1 ? spl3[1].trim() : '';
            params[spl3[0].trim()] = value;
        }

        rv[spl2[0].trim()] = params;
    }

    return rv;
}

function acceptTypeSort(a, b) {
    var sa = a.split('/');
    var sb = b.split('/');
    var na = (sa[0] === '*' ? 2 : 0) + (sa[1] === '*' ? 1 : 0);
    var nb = (sb[0] === '*' ? 2 : 0) + (sb[1] === '*' ? 1 : 0);

    if (na < nb) {
        return -1;
    }
    if (na > nb) {
        return 1;
    }
    return 0;
}

function acceptSort(oa, ob) {
    var a = oa.params, b = ob.params;
    var fa, fb, qa, qb;
    var ha = 'q' in a;
    var hb = 'q' in b;

    if (!ha && !hb) {
        return acceptTypeSort(oa.name, ob.name);
    }
    if (!hb) {
        return 1;
    }
    if (!ha) {
        return -1;
    }

    qa = a.q;
    qb = b.q;

    if (qa === qb) {
        return 0;
    }

    fa = parseFloat(qa, 10);
    fb = parseFloat(qb, 10);

    // If one is NaN and the other isn't
    if (fa !== fa) {
        if (fb === fb) {
            return 1;
        }
    } else if (fb !== fb) {
        return -1;
    }

    if (fa < fb) {
        return 1;
    }
    if (fb > fa) {
        return -1;
    }
    return acceptTypeSort(oa.name, ob.name);
}

function orderedAccept(accept) {
    var rv = [], i = 0;

    if (accept === null) {
        return null;
    }

    for (var a in accept) {
        rv[i++] = { name: a, params: accept[a] };
    }

    rv.sort(acceptSort);
    return rv;
}

function groupAccepts(accept) {
    var prev = accept[0];
    var curr = [prev];
    var rv = [curr];
    var next, j = 1, k = 1;

    for (var i = 1, len = accept.length; i < len; ++i) {
        next = accept[i];

        if (acceptSort(prev, next) === 0) {
            curr[j++] = next;
        } else {
            prev = next;
            curr = [prev];
            rv[k++] = curr;
            j = 1;
        }
    }

    return rv;
}

function objectSize(obj) {
    var rv = 0;
    for (var x in obj) {
        ++rv;
    }
    return rv;
}

function preferredOutput(preferences, canDo) {
    var groups, klen, accept, parsed;

    if (preferences === undefined) {
        return canDo[0];
    }

    parsed = parseAccept(preferences);
    accept = orderedAccept(parsed);
    groups = groupAccepts(accept);
    klen = canDo.length;

    for (var j = 0, jlen = groups.length, group, candidate; j < jlen; ++j) {
        group = groups[j];
        candidate = -1;

        // find the best match in this group
        for (var i = 0, item, name, params, len = group.length; i < len; ++i) {
            item = group[i];
            name = item.name;
            params = item.params;

            if (objectSize(params) > ('q' in params ? 1 : 0)) {
                // XXX: We don't support media type parameters yet.
                continue;
            }

            // try matching each in turn, taking into account wildcards
            for (var k = 0, canItem, spl, splc; k < (candidate === -1 ? klen : candidate); ++k) {
                canItem = canDo[k];

                if (name === canItem) {
                    candidate = k;
                } else {
                    spl = name.split('/');
                    splc = canItem.split('/');

                    if (((spl[0] === '*') || (spl[0] === splc[0])) &&
                        ((spl[1] === '*') || (spl[1] === splc[1]))) {
                        candidate = k;
                    }
                }
            }

            if (candidate === 0) {
                break;
            }
        }

        if (candidate !== -1) {
            // if we've reached the stage where q=0.0, that counts as
            // Not Acceptable
            if ((params.q === '0') || (params.q === '0.0')) {
                return null;
            }
            return canDo[candidate];
        }
    }

    // eek, we should really send 406
    return null;
}
