#!/bin/sh

if [ "`curl --insecure -d 'content=foj' 'https://127.0.0.1:7443/data' 2>/dev/null | sed 's/prestate=\w*//'`" != '{ "status": 303, "result": "See Other", "location": "/data/result?sha256=c2c69152c64fd335c24f4bbaaaa0b408d8da3362d68f30b3454aa76d44c99efa&" }' ]; then
    echo "Couldn't post data" >&2
    exit 1
fi

if [ "`curl --insecure 'https://127.0.0.1:7443/data/c2c69152c64fd335c24f4bbaaaa0b408d8da3362d68f30b3454aa76d44c99efa' 2>/dev/null`" != '{"status":200,"result":"OK","content":"foj"}' ]; then
    echo "Couldn't get data" >&2
    exit 1
fi

# TODO: We need to login first
#
#if [ "`curl --insecure -d 'parent=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855&content=bar' 'https://127.0.0.1:8443/posts' 2>/dev/null`" != '{ "status": 303, "result": "See Other", "location": "/posts/form/result?result=ok" }' ]; then
#    echo "Couldn't post post" >&2
#    exit 1
#fi

echo "OK" >&2
