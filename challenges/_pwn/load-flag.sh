#!/bin/sh
# One-shot worker delivery: the flag exists in this process's environment only.
umask 077
[ -n "$CYBER_RANGE_FLAG" ] || exit 1
printf '%s' "$CYBER_RANGE_FLAG" > /tmp/flag.txt.tmp && mv /tmp/flag.txt.tmp /tmp/flag.txt
