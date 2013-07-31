#1/bin/sh

printf 'building\n' >&2

# TODO: js and css resources compression

mkdir -p target
python tools/jsmacro/jsmacro.py -f src/data-server.js | sed "s/_DS_REFERS_PASS_/`cat var/postgresql/ds_refers_pass.txt`/"  | sed "s/_DS_CONTENT_PASS_/`cat var/postgresql/ds_content_pass.txt`/" >target/data-server.jsmacro.js
# TODO: don't base64 plain text, just quote the string contents
python tools/jsmacro/jsmacro.py -f src/ui-server.js | sed "s#_UI_SERVER_JS_#new Buffer('`base64 -w 0 <src/resources/ui-server.js`','base64')#" | sed "s/_US_USERS_PASS_/`cat var/postgresql/us_users_pass.txt`/" | sed "s/_US_SESSIONS_PASS_/`cat var/postgresql/us_sessions_pass.txt`/" | sed "s/_US_KEYS_PASS_/`cat var/postgresql/us_keys_pass.txt`/" | sed "s/_US_NODES_PASS_/`cat var/postgresql/us_nodes_pass.txt`/" >target/ui-server.jsmacro.js

printf 'built\n' >&2

# java -jar tools/closure-compiler/compiler.jar --compilation_level  ADVANCED_OPTIMIZATIONS --externs src/externs.js <target/ui.jsmacro.js >target/ui.jsmacro.closure.js
# --use_types_for_optimization
# --warning_level VERBOSE
# --warnings_whitelist_file VAL
# --use_only_custom_externs
# --summary_detail_level 3
# --language_in ECMASCRIPT5_STRICT
# --jscomp_error
# --formatting PRETTY_PRINT
# --accept_const_keyword

