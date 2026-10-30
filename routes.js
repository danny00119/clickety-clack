// Railway routes for the live quiz. Every list is in travel order: a game uses the first and last station
// and as many stations in between as it has questions, so each correct answer moves a train one station.
// pickRoute() is the stand-in for the AI route picker (T5b): it returns { name, stations } either way.
const ROUTES = [
  { name: 'Sofia – Varna', stations: ['Sofia', 'Svoge', 'Mezdra', 'Cherven Bryag', 'Pleven', 'Levski', 'Gorna Oryahovitsa', 'Strazhitsa', 'Popovo', 'Targovishte', 'Shumen', 'Kaspichan', 'Provadia', 'Varna'] },
  { name: 'London – Edinburgh', stations: ['London', 'Stevenage', 'Peterborough', 'Grantham', 'Newark', 'Retford', 'Doncaster', 'York', 'Northallerton', 'Darlington', 'Durham', 'Newcastle', 'Alnmouth', 'Berwick-upon-Tweed', 'Dunbar', 'Edinburgh'] },
  { name: 'London – Sofia', stations: ['London', 'Ashford', 'Lille', 'Brussels', 'Liège', 'Aachen', 'Cologne', 'Bonn', 'Koblenz', 'Mainz', 'Frankfurt', 'Würzburg', 'Nuremberg', 'Regensburg', 'Passau', 'Linz', 'St. Pölten', 'Vienna', 'Győr', 'Budapest', 'Kiskunhalas', 'Subotica', 'Novi Sad', 'Belgrade', 'Lapovo', 'Jagodina', 'Paraćin', 'Niš', 'Pirot', 'Dimitrovgrad', 'Sofia'] }
];

// Keeps both ends and spreads the stops evenly along the line, in order: n questions → n + 1 stations.
function fitRoute(route, n) {
  const s = route.stations, last = s.length - 1;
  return { name: route.name, stations: Array.from({ length: n + 1 }, (_, k) => s[Math.round(k * last / n)]) };
}

// A random route long enough for n questions. rand(k) returns an integer in [0, k).
function pickRoute(n, rand) {
  const fits = ROUTES.filter(r => r.stations.length > n);
  return fitRoute(fits[rand(fits.length)], n);
}

module.exports = { ROUTES, fitRoute, pickRoute };
