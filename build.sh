#!/bin/bash
set -e
set -o pipefail
cd src/utk-ts && npm install && npm run build
cd - && cd src/utk-frontend && npm install && npm run build:web && npm run build:webpack
cd - && python setup.py sdist