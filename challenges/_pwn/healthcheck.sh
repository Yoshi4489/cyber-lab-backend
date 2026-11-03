#!/bin/bash
# Healthy once the flag is delivered and the service accepts a connection on the given port.
[ -s /tmp/flag.txt ] || exit 1
exec 3<>"/dev/tcp/127.0.0.1/$1" || exit 1
