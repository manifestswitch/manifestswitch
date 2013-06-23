#!/bin/bash

function dokill() {
	kill $dataserver_stud_pid
	kill $uiserver_stud_pid
	kill $dataserver_pid
	kill $uiserver_pid
	kill $tailf_pid
}

trap dokill SIGINT SIGKILL

mkdir -p var/{log,gpg}
logfiles="var/log/data-server-stderr var/log/data-server-stdout var/log/ui-server-stderr var/log/ui-server-stdout var/log/applog"
touch $logfiles
tail -F -n 0 $logfiles &
tailf_pid=$!

if [ -x ./tools/node/bin/node ]; then
    nodeprog=./tools/node/bin/node
else
    nodeprog=node
fi

$nodeprog target/data-server.jsmacro.js 2>>var/log/data-server-stderr >>var/log/data-server-stdout &
dataserver_pid=$!
$nodeprog target/ui-server.jsmacro.js 2>>var/log/ui-server-stderr >>var/log/ui-server-stdout &
uiserver_pid=$!

stud --ssl -f '*,7443' -b 127.0.0.1,1337 var/cert/server.pem &
dataserver_stud_pid=$!
stud --ssl -f '*,8443' -b 127.0.0.1,1338 var/cert/server.pem &
uiserver_stud_pid=$!

printf 'running\n' >&2

wait

