#!/bin/sh

gzip -9 -c $1 | python -c 'import sys,base64;sys.stdout.write(base64.b64encode(sys.stdin.read()))'

