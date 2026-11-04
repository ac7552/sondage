# Demo data for the Sondage proof of concept.
# Eleanor Ruiz is a fictional Fellow. Photographs are abstract stand-ins marked DEMO.
# Songs are real recordings, cited (not copied). Clippings are labelled as demo.
#
#   admin@sondage.test       Maya Okafor (admin)
#   historian@sondage.test   Dr. Samuel Reyes (historian)
#   eleanor@sondage.test     Eleanor Ruiz (Fellow)
#   Password for all three:  sondage-demo-2026

PASSWORD = "sondage-demo-2026"
IMAGES = Rails.root.join("db/seed_images")

admin = User.find_or_create_by!(email: "admin@sondage.test") { |u| u.name = "Maya Okafor"; u.role = "admin"; u.password = PASSWORD }
historian = User.find_or_create_by!(email: "historian@sondage.test") { |u| u.name = "Dr. Samuel Reyes"; u.role = "historian"; u.password = PASSWORD }
eleanor_user = User.find_or_create_by!(email: "eleanor@sondage.test") { |u| u.name = "Eleanor Ruiz"; u.role = "fellow"; u.password = PASSWORD }

# ---------------------------------------------------------------- intake questions

if IntakeQuestion.none?
  [
    [ "About you", "What name do you like to be called?", "short_text", nil, true ],
    [ "About you", "What year were you born?", "year", nil, true ],
    [ "About you", "Where were you born?", "short_text", nil, true ],
    [ "About you", "Which languages have you spoken at home?", "multi_select", "English\nSpanish\nPortuguese\nFrench\nItalian\nYiddish\nTagalog\nChinese\nOther" ],
    [ "Family", "Who raised you?", "long_text", nil ],
    [ "Family", "How many brothers and sisters did you have?", "select", "None\n1\n2\n3\n4\n5 or more" ],
    [ "Places", "Where have you lived? Towns, neighborhoods, even streets.", "long_text", nil ],
    [ "Work and life", "What work have you done?", "long_text", nil ],
    [ "Work and life", "Is faith or a community important in your life?", "select", "Very much\nSomewhat\nNot really\nI'd rather talk about it in person" ],
    [ "The interview", "How would you like to be recorded?", "select", "Audio only\nVideo and audio\nI'm not sure yet" ],
    [ "The interview", "Is there anything you would prefer not to talk about?", "long_text", nil ]
  ].each_with_index do |(section, prompt, kind, options, required), i|
    IntakeQuestion.create!(section:, prompt:, kind:, options:, required: !!required, position: (i + 1) * 10)
  end
end

# ---------------------------------------------------------------- the Fellow

eleanor = Fellow.find_or_create_by!(user: eleanor_user) do |f|
  f.preferred_name = "Eleanor Ruiz"
  f.birth_year = 1941
  f.birth_place = "Ponce, Puerto Rico"
  f.admin = admin
  f.stage = "intake"
end

if eleanor.eras.none?
  answers = {
    "What name do you like to be called?" => "Eleanor. My mother called me Nena.",
    "What year were you born?" => "1941",
    "Where were you born?" => "Ponce, Puerto Rico",
    "Which languages have you spoken at home?" => %w[Spanish English].to_json,
    "Who raised you?" => "My mother, Carmen, and my grandmother, who we called Abuela Tita. My father worked the cane fields and later the docks.",
    "How many brothers and sisters did you have?" => "3",
    "Where have you lived? Towns, neighborhoods, even streets." => "Ponce (Calle Mayor). East Harlem, 112th Street. The Bronx, Grand Concourse, then Morris Park since 1975.",
    "What work have you done?" => "Sewing machine operator in the garment district. Then thirty years running Panadería Nena with my husband Luis.",
    "Is faith or a community important in your life?" => "Very much",
    "How would you like to be recorded?" => "Video and audio",
    "Is there anything you would prefer not to talk about?" => "My brother Tomás's illness. Maybe later."
  }
  IntakeQuestion.all.each do |q|
    next unless answers[q.prompt]
    eleanor.intake_answers.create!(intake_question: q, value: answers[q.prompt], answered_by: eleanor_user)
  end

  [
    [ "Childhood in Ponce", 1941, 1953, "ochre", "Sun on the plaza, my grandmother's kitchen, and the sound of the church bells at six." ],
    [ "Coming to New York", 1953, 1961, "slate", "We arrived in February with no coats. East Harlem, a new language, and snow." ],
    [ "The garment district", 1961, 1970, "oxblood", "Eight hours at a machine on 38th Street. I met Luis on the A train." ],
    [ "Raising a family in the Bronx", 1970, 1988, "moss", "Three children, a two-bedroom apartment, and Sunday dinners for twenty." ],
    [ "The bakery years", 1988, 2009, "plum", "Panadería Nena: up at four every morning for twenty-one years." ],
    [ "Grandchildren and gardens", 2009, nil, "teal", "Tomatoes, peppers, roses, and grandchildren who ask questions." ]
  ].map { |t, s, e, tone, summary| eleanor.eras.create!(title: t, start_year: s, end_year: e, tone:, summary:) }

  ev = ->(title, year, stage, **rest) { eleanor.events.create!(title:, year:, stage_added: stage, added_by: rest.delete(:by) || eleanor_user, **rest) }
  photo = lambda do |file, title, year, stage, **rest|
    it = eleanor.items.new(kind: "photo", source: "own", title:, year:, stage_added: stage, added_by: rest.delete(:by) || eleanor_user, **rest)
    it.file.attach(io: File.open(IMAGES.join("#{file}.jpg")), filename: "#{file}.jpg", content_type: "image/jpeg")
    it.save!
    it
  end

  # ---- at intake
  ev.("Born at home on Calle Mayor", 1941, "intake", place_name: "Ponce, Puerto Rico", date_text: "March 1941")
  ev.("Moved to New York with my mother", 1953, "intake", place_name: "East Harlem, New York", date_text: "February 1953")
  ev.("Started at the garment factory", 1961, "intake", place_name: "38th Street, Manhattan")
  ev.("Married Luis Ruiz", 1963, "intake", place_name: "St. Cecilia's, East Harlem")
  ev.("Moved to Morris Park", 1975, "intake", place_name: "The Bronx")
  ev.("Opened Panadería Nena", 1988, "intake", place_name: "Morris Park Avenue, the Bronx")
  ev.("Retired and handed the bakery to Ana", 2009, "intake")
  TimelineVersion.capture!(eleanor, stage: "after_intake", author: eleanor_user, label: "After intake · October 6, 2026")
  eleanor.update!(stage: "ten_by_ten")

  # ---- in the 10x10 session with Maya
  eleanor.ensure_ten_by_ten_lists!
  tens = {
    "events" => [ [ "The day we landed at Idlewild", 1953, "Everyone clapped when the plane touched down. My mother cried." ], [ "My First Communion", 1949, "Abuela Tita sewed the dress by hand." ], [ "Meeting Luis on the A train", 1962, "He gave up his seat and then missed his stop." ], [ "The blackout", 1965, "We sat on the fire escape and sang." ], [ "Ana is born", 1966, nil ], [ "The bakery fire", 1997, "We reopened in nine days. The whole street helped." ] ],
    "photos" => [ [ "The plaza in Ponce", 1948, "The only picture of the fountain before they changed it." ], [ "Wedding at St. Cecilia's", 1963, nil ], [ "Coney Island with the children", 1967, nil ], [ "Opening day at the bakery", 1988, nil ] ],
    "places" => [ [ "Plaza Las Delicias, Ponce", nil, nil ], [ "112th Street, East Harlem", nil, nil ], [ "Morris Park Avenue", nil, nil ] ],
    "songs" => [ [ "Lamento Borincano", nil, "My father sang it when he was homesick." ], [ "Bésame Mucho", nil, "Our wedding dance." ], [ "Oye Como Va", nil, "Every Saturday night in 1963." ] ],
    "lessons" => [ [ "Feed people first, then ask questions", nil, nil ], [ "Keep your receipts", nil, "Luis's rule. He was right." ] ]
  }
  tens.each do |category, rows|
    list = eleanor.ten_by_ten_lists.find_by!(category:)
    rows.each_with_index { |(title, year, note), i| list.entries.create!(rank: i + 1, title:, year:, note:) }
  end
  # Memorable events with years become timeline events (as "Complete the 10x10" does).
  eleanor.ten_by_ten_lists.find_by!(category: "events").entries.each do |e|
    next unless e.year
    e.update!(event: ev.(e.title, e.year, "ten_by_ten", story: e.note, by: admin))
  end
  photo.("ponce-plaza-1948", "Plaza Las Delicias, Ponce", 1948, "ten_by_ten", caption: "The only picture of the fountain before they changed it. My father took it with a borrowed camera.")
  photo.("first-communion-1949", "My First Communion", 1949, "ten_by_ten", caption: "Abuela Tita sewed the dress by hand, from a tablecloth.")
  photo.("wedding-1963", "Wedding at St. Cecilia's", 1963, "ten_by_ten", caption: "Luis borrowed the suit from his cousin Rafi.")
  photo.("coney-island-1967", "Coney Island with the children", 1967, "ten_by_ten")
  photo.("bakery-opening-1988", "Opening day at Panadería Nena", 1988, "ten_by_ten", caption: "We sold out of pan sobao by nine in the morning.")
  eleanor.items.create!(kind: "song", source: "own", title: "Lamento Borincano", creator: "Rafael Hernández (composer)", year: 1950, caption: "My father sang it on the porch when he was homesick for the countryside. Written in 1929; he sang it all through my childhood.", stage_added: "ten_by_ten", added_by: admin)
  eleanor.items.create!(kind: "song", source: "own", title: "Bésame Mucho", creator: "Trío Los Panchos", year: 1963, caption: "Our wedding dance. Luis stepped on my foot twice.", stage_added: "ten_by_ten", added_by: admin)
  eleanor.items.create!(kind: "song", source: "own", title: "Oye Como Va", creator: "Tito Puente", year: 1963, caption: "Saturday nights at the Palladium, before the children.", stage_added: "ten_by_ten", added_by: admin)
  eleanor.items.create!(kind: "place", source: "own", title: "Plaza Las Delicias", place_name: "Plaza Las Delicias, Ponce", latitude: 18.0111, longitude: -66.6141, year: 1947, stage_added: "ten_by_ten", added_by: admin)
  eleanor.items.create!(kind: "place", source: "own", title: "112th Street", place_name: "East 112th Street, East Harlem", latitude: 40.7955, longitude: -73.9426, year: 1955, stage_added: "ten_by_ten", added_by: admin)
  eleanor.items.create!(kind: "place", source: "own", title: "Morris Park Avenue", place_name: "Morris Park Avenue, the Bronx", latitude: 40.8497, longitude: -73.8566, year: 1990, stage_added: "ten_by_ten", added_by: admin)
  TimelineVersion.capture!(eleanor, stage: "after_ten_by_ten", author: admin, label: "After the 10x10 session · October 20, 2026")
  eleanor.update!(stage: "refining")

  # ---- refining
  photo.("east-harlem-1954", "Our building on 112th Street", 1954, "refining", caption: "Fourth floor, the window on the left. You could hear the elevated train.")
  photo.("kitchen-1978", "Sunday dinner", 1978, "refining", caption: "Twenty people in a kitchen built for four.")
  photo.("garden-2015", "The garden behind the house", 2015, "refining", caption: "Tomatoes, peppers and my mother's roses, grown from a cutting she carried from Ponce.")
  eleanor.items.create!(kind: "letter", source: "own", title: "Letter from Abuela Tita", year: 1956, caption: "She wrote every month. This is the one where she tells me the mango tree finally fruited.", stage_added: "refining", added_by: eleanor_user)
  eleanor.items.create!(kind: "article", source: "context", title: "Blackout darkens the city", publication: "Demo clipping", year: 1965, caption: "Added for context: the November 1965 Northeast blackout. (Demo clipping, not a real article.)", stage_added: "refining", added_by: admin)
  eleanor.items.create!(kind: "article", source: "own", title: "Local bakery reopens after fire", publication: "Demo clipping", year: 1997, caption: "Eleanor kept this clipping in the register drawer for twelve years. (Demo clipping.)", stage_added: "refining", added_by: eleanor_user)
  eleanor.items.create!(kind: "song", source: "context", title: "Dancing in the Street", creator: "Martha and the Vandellas", year: 1964, caption: "Added for context: on every radio on 112th Street that summer.", stage_added: "refining", added_by: admin)
  eleanor.items.create!(kind: "song", source: "own", title: "La Vida Es Un Carnaval", creator: "Celia Cruz", year: 1998, caption: "We played it the morning we reopened after the fire.", stage_added: "refining", added_by: eleanor_user)
  ev.("First grandchild, Sofía", 2010, "refining", story: "She was born during the snowstorm. Of course she was.")
  eleanor.update!(stage: "interview")
end

# ---------------------------------------------------------------- meetings

eleanor.meetings.find_or_create_by!(kind: "ten_by_ten") do |m|
  m.host = admin
  m.title = "10x10 session with Eleanor Ruiz"
  m.scheduled_at = Time.zone.parse("2026-10-20 10:00")
  m.status = "completed"
end
eleanor.meetings.find_or_create_by!(kind: "interview") do |m|
  m.host = historian
  m.media_type = "video"
  m.title = "Life history interview with Eleanor Ruiz"
  m.scheduled_at = 1.day.from_now.change(hour: 10)
  m.historian_notes = <<~NOTES
    Open with the plaza photograph. What did Ponce sound like in the morning?
    The flight in 1953: who decided you would leave? What did you carry?
    112th Street: the first winter. School. Learning English.
    Meeting Luis on the A train. The wedding, the dance.
    The blackout of 1965 on the fire escape.
    The bakery: why bread? The fire in 1997 and the nine days.
    (She'd prefer not to discuss Tomás's illness. Don't raise it.)
    Close: what should Sofía know?
  NOTES
end

AuditEvent.record!("seed.loaded", actor: admin, fellow: eleanor) unless eleanor.audit_events.exists?(action: "seed.loaded")
puts "Seeded. Sign in as admin@sondage.test, historian@sondage.test or eleanor@sondage.test with password #{PASSWORD}"
