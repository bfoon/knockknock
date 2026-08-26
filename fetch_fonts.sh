#!/bin/sh
# Chalk — put the handwriting fonts where the stylesheet expects them.
#
# Run from the project root (the directory with manage.py):
#
#     sh fetch_fonts.sh
#
# It downloads the thirteen open-licence fonts and their licences straight
# from the Google Fonts repository into static/chalk/fonts/, then checks every
# url() in chalk_fonts.css against what actually landed — which is the same
# check collectstatic makes, done here where a failure costs nothing.
#
# Nothing else is touched. Safe to run twice.

set -e

CSS="static/chalk/css/chalk_fonts.css"
DIR="static/chalk/fonts"
RAW="https://raw.githubusercontent.com/google/fonts/main"

if [ ! -f "$CSS" ]; then
  echo "Cannot find $CSS — run this from the project root."
  exit 2
fi

mkdir -p "$DIR/licences"

get() {
  # get <path in repo> <file to write>
  if [ -s "$DIR/$2" ]; then
    echo "  have  $2"
    return 0
  fi
  if curl -fsSL -o "$DIR/$2.part" "$RAW/$1"; then
    mv "$DIR/$2.part" "$DIR/$2"
    echo "  got   $2"
  else
    rm -f "$DIR/$2.part"
    echo "  FAILED $2  ($RAW/$1)"
    return 1
  fi
}

lic() {
  curl -fsSL -o "$DIR/licences/$2" "$RAW/$1" >/dev/null 2>&1 \
    && echo "  lic   $2" || echo "  no licence file for $2"
}

echo "Fonts into $DIR"
get "ofl/gloriahallelujah/GloriaHallelujah.ttf"            GloriaHallelujah.ttf
get "apache/rocksalt/RockSalt-Regular.ttf"                 RockSalt-Regular.ttf
get "ofl/amaticsc/AmaticSC-Regular.ttf"                    AmaticSC-Regular.ttf
get "ofl/amaticsc/AmaticSC-Bold.ttf"                       AmaticSC-Bold.ttf
get "ofl/indieflower/IndieFlower-Regular.ttf"              IndieFlower-Regular.ttf
get "ofl/patrickhand/PatrickHand-Regular.ttf"              PatrickHand-Regular.ttf
get "ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf" ArchitectsDaughter-Regular.ttf
get "ofl/caveat/Caveat%5Bwght%5D.ttf"                      Caveat.ttf
get "ofl/dancingscript/DancingScript%5Bwght%5D.ttf"        DancingScript.ttf
get "apache/permanentmarker/PermanentMarker-Regular.ttf"   PermanentMarker-Regular.ttf
get "ofl/cabinsketch/CabinSketch-Regular.ttf"              CabinSketch-Regular.ttf
get "ofl/shadowsintolight/ShadowsIntoLight.ttf"            ShadowsIntoLight.ttf
get "apache/specialelite/SpecialElite-Regular.ttf"         SpecialElite-Regular.ttf

echo "Licences into $DIR/licences"
lic "ofl/gloriahallelujah/OFL.txt"       GloriaHallelujah-OFL.txt
lic "ofl/amaticsc/OFL.txt"               AmaticSC-OFL.txt
lic "ofl/indieflower/OFL.txt"            IndieFlower-OFL.txt
lic "ofl/patrickhand/OFL.txt"            PatrickHand-OFL.txt
lic "ofl/architectsdaughter/OFL.txt"     ArchitectsDaughter-OFL.txt
lic "ofl/caveat/OFL.txt"                 Caveat-OFL.txt
lic "ofl/dancingscript/OFL.txt"          DancingScript-OFL.txt
lic "ofl/cabinsketch/OFL.txt"            CabinSketch-OFL.txt
lic "ofl/shadowsintolight/OFL.txt"       ShadowsIntoLight-OFL.txt
lic "apache/rocksalt/LICENSE.txt"        RockSalt-Apache-2.0.txt
lic "apache/permanentmarker/LICENSE.txt" PermanentMarker-Apache-2.0.txt
lic "apache/specialelite/LICENSE.txt"    SpecialElite-Apache-2.0.txt

echo
echo "Checking every url() in the stylesheet, the way collectstatic will:"
missing=0
for f in $(sed -n 's|.*url("\.\./fonts/\([^"]*\)").*|\1|p' "$CSS"); do
  if [ -s "$DIR/$f" ]; then
    # a TrueType file starts with 00 01 00 00; anything else is an error page
    head -c 4 "$DIR/$f" | od -An -tx1 | tr -d ' \n' | grep -q '^00010000$' \
      && echo "  ok    $f" \
      || { echo "  BAD   $f is not a font file"; missing=1; }
  else
    echo "  MISS  $f"
    missing=1
  fi
done

echo
if [ "$missing" = "0" ]; then
  echo "All present. Now rebuild:"
  echo "  docker compose up -d --build web"
else
  echo "Something is missing — collectstatic will fail on exactly that file."
  echo "Fetch it by hand, or delete the matching @font-face block from"
  echo "$CSS and the board will fall back to a system hand."
  exit 1
fi
