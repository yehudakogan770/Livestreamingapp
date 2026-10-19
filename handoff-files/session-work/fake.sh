#!/bin/sh
echo "{\"ok\":false,\"steps\":[{\"name\":\"a | b\",\"ok\":true,\"ms\":120},{\"name\":\"c\",\"ok\":false,\"ms\":5,\"message\":\"line1 x\"}],\"log\":[\"x\"]}" > "$LUMORA_SELFTEST"
