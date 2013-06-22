#!/bin/bash

function dokill() {
	kill $frontserv_pid
	kill $ui_pid
	kill $tailf_pid
}

trap dokill SIGINT SIGKILL

mkdir -p var/{log,gpg}
logfiles="var/log/frontserv-stderr var/log/frontserv-stdout var/log/ui-stderr var/log/ui-stdout var/log/applog"
touch $logfiles
tail -F -n 0 $logfiles &
tailf_pid=$!

if [ -x ./tools/node/bin/node ]; then
    nodeprog=./tools/node/bin/node
else
    nodeprog=node
fi

$nodeprog target/frontserv.jsmacro.js 2>>var/log/frontserv-stderr >>var/log/frontserv-stdout &
frontserv_pid=$!
$nodeprog target/ui.jsmacro.js 2>>var/log/ui-stderr >>var/log/ui-stdout &
ui_pid=$!

printf 'running\n' >&2

wait

