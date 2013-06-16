#!/bin/bash

function dokill() {
	kill $frontserv_pid
	kill $ui_pid
	kill $tailf_pid
}

trap dokill SIGINT SIGKILL

tailf -n 0 /tmp/applog &
tailf_pid=$!

./tools/node-v0.10.5-linux-x64/bin/node target/frontserv.jsmacro.js &
frontserv_pid=$!
./tools/node-v0.10.5-linux-x64/bin/node target/ui.jsmacro.js &
ui_pid=$!

printf 'running\n' >&2

wait

