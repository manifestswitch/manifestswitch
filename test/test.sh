#!/bin/sh

dc=`tempfile`
uc=`tempfile`

if [ "`curl --insecure -c $dc -d 'username=user&password=pass' 'https://127.0.0.1:7443/login' 2>/dev/null`" != '{ "status": 303, "result": "See Other", "location": "/login/result" }' ] || ! grep -P '#HttpOnly_127.0.0.1\tFALSE\t/\tTRUE\t0\ts\t[0-9a-zA-Z/+]{86}==' $dc >/dev/null ; then
    echo "Couldn't login to data-server" >&2
    rm -f $dc ; rm -f $uc ;
    exit 1
fi

if [ "`curl --insecure -d 'content=foj' 'https://127.0.0.1:7443/data' 2>/dev/null | sed 's/prestate=\w*//'`" != '{ "status": 303, "result": "See Other", "location": "/data/result?sha256=c2c69152c64fd335c24f4bbaaaa0b408d8da3362d68f30b3454aa76d44c99efa&" }' ]; then
    echo "Couldn't post data" >&2
    rm -f $dc ; rm -f $uc ;
    exit 1
fi

if [ "`curl --insecure 'https://127.0.0.1:7443/data/c2c69152c64fd335c24f4bbaaaa0b408d8da3362d68f30b3454aa76d44c99efa' 2>/dev/null`" != '{"status":200,"result":"OK","content":"foj"}' ]; then
    echo "Couldn't get data" >&2
    rm -f $dc ; rm -f $uc ;
    exit 1
fi

if [ "`curl --insecure -c $uc -d 'username=user&password=pass' 'https://127.0.0.1:8443/login' 2>/dev/null`" != '{ "status": 303, "result": "See Other", "location": "/login/result" }' ] || ! grep -P '#HttpOnly_127.0.0.1\tFALSE\t/\tTRUE\t0\ts\t[0-9a-zA-Z/+]{86}==' $uc >/dev/null ; then
    echo "Couldn't login to ui" >&2
    rm -f $dc ; rm -f $uc ;
    exit 1
fi

# fixme: Still saying logged out
#if [ "`curl --insecure -c $uc -d 'parent=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855&content=bar' 'https://127.0.0.1:8443/posts' 2>/dev/null`" != '{ "status": 303, "result": "See Other", "location": "/posts/form/result?result=ok" }' ]; then
#    echo "Couldn't post post" >&2
#    rm -f $dc ; rm -f $uc ;
#    exit 1
#fi

if ! curl --insecure -I 'https://127.0.0.1:8443/post/5488b4b042ce5dd01bbb7bc3737f55559a6a6ff13379c3f721613833d658601e' 2>/dev/null | head -n1 | grep "200 OK" >/dev/null ; then
    echo "Couldn't get post" >&2
    rm -f $dc ; rm -f $uc ;
    exit 1
fi

rm -f $dc ; rm -f $uc ;
echo "OK" >&2
