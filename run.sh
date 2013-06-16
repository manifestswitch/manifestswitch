#!/bin/bash

function dokill() {
	kill $frontserv_pid
	kill $ui_pid
	kill $tailf_pid
}

trap dokill SIGINT SIGKILL

mkdir -p var
touch var/applog
tailf -n 0 var/applog &
tailf_pid=$!

if [ -x ./tools/node/bin/node ]; then
    nodeprog=./tools/node/bin/node
else
    nodeprog=node
fi

$nodeprog target/frontserv.jsmacro.js 2>>var/frontserv-stderr >>var/frontserv-stdout &
frontserv_pid=$!
$nodeprog target/ui.jsmacro.js 2>>var/ui-stderr >>var/ui-stdout &
ui_pid=$!

printf 'running\n' >&2

wait

