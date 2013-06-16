#!/bin/bash

function dokill() {
	kill $frontserv_pid
	kill $ui_pid
	kill $tailf_pid
}

trap dokill SIGINT SIGKILL

touch /tmp/applog
tailf -n 0 /tmp/applog &
tailf_pid=$!

node target/frontserv.jsmacro.js &
frontserv_pid=$!
node target/ui.jsmacro.js &
ui_pid=$!

printf 'running\n' >&2

wait

