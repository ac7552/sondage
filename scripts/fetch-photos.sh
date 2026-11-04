#!/usr/bin/env bash
# Downloads photographs from sondagestandard.com into the desktop app and the web
# app. Run it once from the project folder:  bash scripts/fetch-photos.sh
# The apps work without them (they show a plain tone instead), so nothing breaks
# if a download fails.
set -u
cd "$(dirname "$0")/.."
CDN="https://images.squarespace-cdn.com/content/v1/69691516f6173a02905ba20c"
STATIC="https://static1.squarespace.com/static/69691516f6173a02905ba20c"
photos=(
  "fellow-in-session.jpg|$STATIC/t/69e2b51bfd523c3b2594b4c8/1776465179289/FellowInSession.jpg"
  "family-of-six.jpg|$CDN/507f5062-1312-4e2a-87a6-f9afa1da54a9/Portrait_of_a_family_of_six_in_a_living_room_%28AM_74989-1%29.jpg"
  "microphone.jpg|$CDN/31c54f8c-4db9-4a6c-8bf4-bba94e44dacf/unsplash-image-ZDNyhmgkZlQ.jpg"
  "archive.jpg|$CDN/1780453307496-RMAI2N983ESR62JLXRFB/unsplash-image-3_oqbY-Jq8g.jpg"
  "family-outdoors.jpg|$CDN/334c4d56-4471-485f-8651-557cf9559c7b/Family%2C_portrait%2C_kid%2C_mother%2C_tableau_Fortepan_3800.jpg"
  "family-couch.jpg|$CDN/4340d4eb-cfbf-46da-b5c2-edf82989a5e1/Family_portrait_in_living_room_%28AM_88146-1%29.jpg"
  "woman-outdoors.jpg|$CDN/a8bc0976-8188-4146-9742-95d9bc2e755f/Portrait_of_a_woman_in_an_outdoor_setting_%28AM_78900-1%29.jpg"
  "grandmother-and-girls.jpg|$CDN/e62d1f91-d479-49c7-8e8f-d7bfd8687a19/Group_portrait_of_a_woman%2C_a_young_girl_and_a_baby_sitting_on_the_armrest_of_an_armchair_%28AM_74970-1%29.jpg"
)
mkdir -p desktop/src/renderer/photos web/public/photos
ok=0
for entry in "${photos[@]}"; do
  name="${entry%%|*}"; url="${entry#*|}"
  if curl -fsSL "$url?format=1500w" -o "web/public/photos/$name"; then
    cp "web/public/photos/$name" "desktop/src/renderer/photos/$name"
    echo "  got $name"; ok=$((ok + 1))
  else
    echo "  couldn't download $name"
  fi
done
echo "$ok of ${#photos[@]} photos downloaded."
