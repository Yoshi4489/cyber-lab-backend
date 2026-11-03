#!/bin/bash
# Workstation is healthy once ttyd is listening on 7681.
exec 3<>/dev/tcp/127.0.0.1/7681 || exit 1
