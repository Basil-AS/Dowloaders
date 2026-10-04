#!/usr/bin/env bash
# Собирает zip для Chrome (Web Store / "Load unpacked" можно прямо из папки extension/) и Firefox (.xpi).
set -e
cd "$(dirname "$0")/extension"
mkdir -p ../dist
rm -f ../dist/forum-article-saver.zip ../dist/forum-article-saver.xpi
zip -qr ../dist/forum-article-saver.zip . -x '*.DS_Store'
cp ../dist/forum-article-saver.zip ../dist/forum-article-saver.xpi
echo "OK: dist/forum-article-saver.zip (Chrome), dist/forum-article-saver.xpi (Firefox, нужна подпись/about:debugging)"
