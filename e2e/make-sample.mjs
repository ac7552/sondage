// Same content as web/db/seeds.rb, in the TimelineSnapshot shape.
import fs from "node:fs";
const eras = [
  ["Childhood in Ponce", 1941, 1953, "ochre", "Sun on the plaza, my grandmother's kitchen, and the sound of the church bells at six."],
  ["Coming to New York", 1953, 1961, "slate", "We arrived in February with no coats. East Harlem, a new language, and snow."],
  ["The garment district", 1961, 1970, "oxblood", "Eight hours at a machine on 38th Street. I met Luis on the A train."],
  ["Raising a family in the Bronx", 1970, 1988, "moss", "Three children, a two-bedroom apartment, and Sunday dinners for twenty."],
  ["The bakery years", 1988, 2009, "plum", "Panadería Nena: up at four every morning for twenty-one years."],
  ["Grandchildren and gardens", 2009, null, "teal", "Tomatoes, peppers, roses, and grandchildren who ask questions."],
].map(([title, startYear, endYear, tone, summary], i) => ({ id: i + 1, title, startYear, endYear, tone, summary }));
const eraId = (y) => eras.find((e) => y >= e.startYear && (e.endYear == null || y <= e.endYear))?.id;
let n = 1;
const ev = (title, year, extra = {}) => ({ id: n++, title, year, when: extra.when || String(year), place: extra.place || null, story: extra.story || null, eraId: eraId(year), addedBy: extra.by || "Eleanor Ruiz", stageAdded: extra.stage || "intake", capsuleMomentSeconds: null });
const events = [
  ev("Born at home on Calle Mayor", 1941, { when: "March 1941", place: "Ponce, Puerto Rico" }),
  ev("Moved to New York with my mother", 1953, { when: "February 1953", place: "East Harlem, New York" }),
  ev("Started at the garment factory", 1961, { place: "38th Street, Manhattan" }),
  ev("Married Luis Ruiz", 1963, { place: "St. Cecilia's, East Harlem" }),
  ev("Moved to Morris Park", 1975, { place: "The Bronx" }),
  ev("Opened Panadería Nena", 1988, { place: "Morris Park Avenue, the Bronx" }),
  ev("Retired and handed the bakery to Ana", 2009),
  ev("The day we landed at Idlewild", 1953, { story: "Everyone clapped when the plane touched down. My mother cried.", stage: "ten_by_ten", by: "Maya Okafor" }),
  ev("My First Communion", 1949, { story: "Abuela Tita sewed the dress by hand.", stage: "ten_by_ten", by: "Maya Okafor" }),
  ev("Meeting Luis on the A train", 1962, { story: "He gave up his seat and then missed his stop.", stage: "ten_by_ten", by: "Maya Okafor" }),
  ev("The blackout", 1965, { story: "We sat on the fire escape and sang.", stage: "ten_by_ten", by: "Maya Okafor" }),
  ev("Ana is born", 1966, { stage: "ten_by_ten", by: "Maya Okafor" }),
  ev("The bakery fire", 1997, { story: "We reopened in nine days. The whole street helped.", stage: "ten_by_ten", by: "Maya Okafor" }),
  ev("First grandchild, Sofía", 2010, { story: "She was born during the snowstorm. Of course she was.", stage: "refining" }),
];
let m = 100;
const it = (kind, title, year, extra = {}) => ({ id: m++, kind, source: extra.source || "own", title, caption: extra.caption || null, year, when: String(year), creator: extra.creator || null, publication: extra.publication || null, url: null, archiveUrl: null, isrc: null, place: extra.place || null, latitude: null, longitude: null, eventId: null, eraId: eraId(year), addedBy: extra.by || "Eleanor Ruiz", stageAdded: extra.stage || "ten_by_ten", image: extra.image ? `/seed_images/${extra.image}.jpg` : null, fileUrl: extra.image ? `/seed_images/${extra.image}.jpg` : null });
const items = [
  it("photo", "Plaza Las Delicias, Ponce", 1948, { image: "ponce-plaza-1948", caption: "The only picture of the fountain before they changed it. My father took it with a borrowed camera." }),
  it("photo", "My First Communion", 1949, { image: "first-communion-1949", caption: "Abuela Tita sewed the dress by hand, from a tablecloth." }),
  it("photo", "Wedding at St. Cecilia's", 1963, { image: "wedding-1963", caption: "Luis borrowed the suit from his cousin Rafi." }),
  it("photo", "Coney Island with the children", 1967, { image: "coney-island-1967" }),
  it("photo", "Opening day at Panadería Nena", 1988, { image: "bakery-opening-1988", caption: "We sold out of pan sobao by nine in the morning." }),
  it("song", "Lamento Borincano", 1950, { creator: "Rafael Hernández (composer)", caption: "My father sang it on the porch when he was homesick for the countryside." }),
  it("song", "Bésame Mucho", 1963, { creator: "Trío Los Panchos", caption: "Our wedding dance. Luis stepped on my foot twice." }),
  it("song", "Oye Como Va", 1963, { creator: "Tito Puente", caption: "Saturday nights at the Palladium, before the children." }),
  it("place", "Plaza Las Delicias", 1947, { place: "Plaza Las Delicias, Ponce" }),
  it("place", "112th Street", 1955, { place: "East 112th Street, East Harlem" }),
  it("place", "Morris Park Avenue", 1990, { place: "Morris Park Avenue, the Bronx" }),
  it("photo", "Our building on 112th Street", 1954, { image: "east-harlem-1954", stage: "refining", caption: "Fourth floor, the window on the left. You could hear the elevated train." }),
  it("photo", "Sunday dinner", 1978, { image: "kitchen-1978", stage: "refining", caption: "Twenty people in a kitchen built for four." }),
  it("photo", "The garden behind the house", 2015, { image: "garden-2015", stage: "refining", caption: "Tomatoes, peppers and my mother's roses, grown from a cutting she carried from Ponce." }),
  it("letter", "Letter from Abuela Tita", 1956, { stage: "refining", caption: "She wrote every month. This is the one where she tells me the mango tree finally fruited." }),
  it("article", "Blackout darkens the city", 1965, { source: "context", publication: "Demo clipping", by: "Maya Okafor", stage: "refining", caption: "Added for context: the November 1965 Northeast blackout. (Demo clipping, not a real article.)" }),
  it("article", "Local bakery reopens after fire", 1997, { publication: "Demo clipping", stage: "refining", caption: "Eleanor kept this clipping in the register drawer for twelve years. (Demo clipping.)" }),
  it("song", "Dancing in the Street", 1964, { source: "context", creator: "Martha and the Vandellas", by: "Maya Okafor", stage: "refining", caption: "Added for context: on every radio on 112th Street that summer." }),
  it("song", "La Vida Es Un Carnaval", 1998, { creator: "Celia Cruz", stage: "refining", caption: "We played it the morning we reopened after the fire." }),
];
const data = { format: "sondage-timeline/0.1", generatedAt: new Date().toISOString(), fellow: { name: "Eleanor Ruiz", birthYear: 1941, birthPlace: "Ponce, Puerto Rico" }, eras, events, items, tenByTen: [], capsules: [] };
fs.writeFileSync("sample-timeline.json", JSON.stringify(data, null, 2));
console.log("eras", eras.length, "events", events.length, "items", items.length);
