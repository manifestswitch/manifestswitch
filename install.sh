#!/bin/sh

sudo apt-get install haproxy stud
sudo apt-get install nodejs npm

# recommended:
# sudo apt-get install haveged

# Generate an SSL cert
sudo apt-get install openssl
mkdir -p var/cert
cd var/cert
openssl genrsa -des3 -passout pass:x -out server.pass.key 2048
openssl rsa -passin pass:x -in server.pass.key -out server.key
rm -f server.pass.key
printf '\n\n\n\n\n\n\n\n\n' | openssl req -new -key server.key -out server.csr ; printf '\n'
openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt
cat server.key server.crt > server.pem
openssl gendh >> server.pem

npm install hiredis redis

