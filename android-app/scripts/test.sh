#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$APP_DIR/build"
TEST_DIR="$(mktemp -d "$APP_DIR/build/url-tests.XXXXXX")"
javac -d "$TEST_DIR" "$APP_DIR/src/es/suturateatro/scrib/UrlPolicy.java" "$APP_DIR/test/UrlPolicyTest.java"
java -cp "$TEST_DIR" es.suturateatro.scrib.UrlPolicyTest
