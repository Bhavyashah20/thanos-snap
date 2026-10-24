#!/bin/sh
# Downloads the MI-GAN 512 generator (Picsart AI Research, MIT) into models/ and checks its hash.
# Third-party ONNX conversion: https://huggingface.co/FreeHugsForRobots/ps-inpaint-migan
set -e
cd "$(dirname "$0")/.."
URL="https://huggingface.co/FreeHugsForRobots/ps-inpaint-migan/resolve/main/migan-512-generator.onnx"
SHA="40b78086443a1104b6aa47b19f91fd8679857ae1583e3730d72d6298f1a232f6"
mkdir -p models
curl -fL -o models/migan-512-generator.onnx.tmp "$URL"
GOT=$(shasum -a 256 models/migan-512-generator.onnx.tmp | cut -d' ' -f1)
if [ "$GOT" != "$SHA" ]; then rm -f models/migan-512-generator.onnx.tmp; echo "hash mismatch: $GOT" >&2; exit 1; fi
mv models/migan-512-generator.onnx.tmp models/migan-512-generator.onnx
echo "ok: models/migan-512-generator.onnx"
