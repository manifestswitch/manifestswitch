#1/bin/sh

printf 'building\n' >&2

mkdir -p target
python tools/jsmacro/jsmacro.py -f src/frontserv.js >target/frontserv.jsmacro.js
python tools/jsmacro/jsmacro.py -f src/ui.js >target/ui.jsmacro.js

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

