#!/usr/bin/env bash
set -euo pipefail

if ! command -v pre-commit >/dev/null 2>&1; then
  echo "pre-commit is not installed."
  echo "Install: brew install pre-commit"
  exit 1
fi

pre-commit install
echo "Installed pre-commit hooks."
echo "Test now: pre-commit run --all-files"
