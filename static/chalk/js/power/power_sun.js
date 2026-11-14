/* Chalk Power Lab — the sun.
 *
 * Where the sun is, and how much of it lands on a tilted panel, for any
 * place, month and hour. A clear-sky model with a cloud factor on top: not
 * a weather forecast, but right about the things a designer needs — noon
 * is best, a wet-season month is worse, a panel facing the wrong way
 * loses a third.
 *
 *   Sun.pos(lat, doy, hour)        {el, az} in degrees (az from north, clockwise)
 *   Sun.at(site, hour)             {G: W/m² on the panels, ghi, el, az, tamb}
 *   Sun.psh(site, month)           peak sun hours on the panels that month
 *   Sun.worstMonth(site)           the month a system must be sized for
 *
 * Pure arithmetic, so it runs under Node for tests.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower;
  var Sun = W.Sun = {};
  var D = Math.PI / 180;

  /* cloud: average share of the sky covered, per month (Jan…Dec);
   * temp: average afternoon temperature, °C. */
  Sun.SITES = {
    banjul:    { name: "Banjul", lat: 13.45, cloud: [.1, .1, .1, .12, .2, .4, .6, .65, .55, .35, .15, .1], temp: [31, 33, 34, 33, 32, 32, 31, 30, 31, 32, 33, 31] },
    brikama:   { name: "Brikama", lat: 13.27, cloud: [.1, .1, .1, .12, .2, .4, .6, .65, .55, .35, .15, .1], temp: [33, 35, 36, 36, 35, 33, 31, 30, 31, 33, 34, 33] },
    farafenni: { name: "Farafenni", lat: 13.57, cloud: [.08, .08, .08, .1, .2, .4, .58, .62, .52, .3, .12, .08], temp: [34, 37, 39, 40, 39, 36, 33, 32, 32, 35, 36, 34] },
    basse:     { name: "Basse", lat: 13.31, cloud: [.07, .07, .08, .1, .2, .4, .58, .62, .52, .3, .1, .07], temp: [35, 38, 40, 41, 40, 36, 33, 32, 33, 35, 37, 35] },
    dakar:     { name: "Dakar", lat: 14.69, cloud: [.12, .12, .12, .12, .18, .35, .55, .6, .5, .3, .15, .12], temp: [26, 26, 26, 26, 27, 29, 30, 30, 31, 31, 30, 28] },
    freetown:  { name: "Freetown", lat: 8.48, cloud: [.25, .25, .3, .4, .55, .7, .85, .88, .75, .6, .45, .3], temp: [30, 31, 31, 31, 31, 29, 28, 27, 28, 29, 30, 30] },
    lagos:     { name: "Lagos", lat: 6.52, cloud: [.4, .4, .45, .5, .6, .75, .75, .7, .7, .6, .5, .4], temp: [32, 33, 33, 32, 31, 29, 28, 28, 29, 30, 32, 32] },
    nairobi:   { name: "Nairobi", lat: -1.29, cloud: [.35, .35, .45, .6, .6, .55, .6, .6, .45, .5, .6, .45], temp: [26, 27, 27, 25, 24, 23, 22, 23, 25, 26, 24, 25] },
    capetown:  { name: "Cape Town", lat: -33.92, cloud: [.2, .2, .25, .35, .45, .5, .5, .45, .4, .35, .25, .2], temp: [26, 27, 25, 23, 20, 18, 17, 18, 19, 21, 24, 25] },
    london:    { name: "London", lat: 51.5, cloud: [.75, .7, .65, .6, .6, .55, .55, .55, .6, .65, .72, .75], temp: [8, 9, 12, 15, 18, 21, 23, 23, 20, 16, 11, 8] }
  };
  Sun.MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MID = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];   /* day of year at mid-month */

  Sun.pos = function (lat, doy, hour) {
    var dec = 23.45 * Math.sin(D * 360 * (284 + doy) / 365), w = 15 * (hour - 12);
    var sinEl = Math.sin(lat * D) * Math.sin(dec * D) + Math.cos(lat * D) * Math.cos(dec * D) * Math.cos(w * D);
    var el = Math.asin(W.clamp(sinEl, -1, 1)) / D;
    var cosAz = (Math.sin(dec * D) - Math.sin(el * D) * Math.sin(lat * D)) / (Math.cos(el * D) * Math.cos(lat * D) || 1e-9);
    var az = Math.acos(W.clamp(cosAz, -1, 1)) / D;
    if (w > 0) az = 360 - az;
    return { el: el, az: az, dec: dec };
  };

  function siteOf(site) {
    var known = null, k;
    for (k in Sun.SITES) if (Sun.SITES[k].name === site.name) known = Sun.SITES[k];
    return known;
  }
  Sun.cloud = function (site) {
    if (site.cloud != null && site.cloud >= 0) return W.clamp(+site.cloud, 0, 1);
    var s = siteOf(site); return s ? s.cloud[W.clamp((site.month || 1) - 1, 0, 11)] : 0.25;
  };
  Sun.temp = function (site) {
    if (site.tamb != null && site.tamb >= 0) return +site.tamb;
    var s = siteOf(site); return s ? s.temp[W.clamp((site.month || 1) - 1, 0, 11)] : 28;
  };

  /* Irradiance on the plane of the array. */
  Sun.at = function (site, hour) {
    var doy = MID[W.clamp((site.month || 1) - 1, 0, 11)], lat = +site.lat || 0, p = Sun.pos(lat, doy, hour);
    var tmax = Sun.temp(site), tamb = tmax - 4.5 + 4.5 * Math.cos(15 * (hour - 15) * D);
    if (p.el <= 0) return { G: 0, ghi: 0, dni: 0, el: p.el, az: p.az, tamb: tamb };
    var am = 1 / (Math.sin(p.el * D) + 0.50572 * Math.pow(p.el + 6.07995, -1.6364));
    var dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678)), dhi = 0.11 * dni * Math.sin(p.el * D) + 18;
    var cl = Sun.cloud(site), k = 1 - 0.75 * Math.pow(cl, 3.4);
    /* cloud takes the beam first and leaves a brighter, flatter sky */
    var beam = dni * Math.max(0, 1 - 1.15 * cl), diff = dhi * (1 + 1.6 * cl) * (0.6 + 0.4 * k);
    var tilt = +site.tilt || 0, paz = site.az == null ? 180 : +site.az;
    var cosI = Math.sin(p.el * D) * Math.cos(tilt * D) + Math.cos(p.el * D) * Math.sin(tilt * D) * Math.cos((p.az - paz) * D);
    var ghi = beam * Math.sin(p.el * D) + diff;
    var G = beam * Math.max(0, cosI) + diff * (1 + Math.cos(tilt * D)) / 2 + ghi * 0.2 * (1 - Math.cos(tilt * D)) / 2;
    G *= 1 - W.clamp(+site.dust || 0, 0, 80) / 100;
    return { G: Math.max(0, G), ghi: ghi, dni: beam, el: p.el, az: p.az, tamb: tamb };
  };

  /* Peak sun hours: the day's energy on the panels, in kWh/m². */
  Sun.psh = function (site, month) {
    var s = {}, k, sum = 0;
    for (k in site) s[k] = site[k];
    if (month) s.month = month;
    for (var h = 4; h <= 20; h += 0.25) sum += Sun.at(s, h).G * 0.25;
    return sum / 1000;
  };
  Sun.worstMonth = function (site) {
    var best = 1, low = 1e9;
    for (var m = 1; m <= 12; m++) { var v = Sun.psh(site, m); if (v < low) { low = v; best = m; } }
    return { month: best, psh: low };
  };
  /* The tilt that does best over the whole year: about the latitude, and
   * never flatter than 10° so that rain can wash the dust off. */
  Sun.bestTilt = function (lat) { return Math.max(10, Math.round(Math.abs(lat))); };
  Sun.bestAz = function (lat) { return lat >= 0 ? 180 : 0; };
})(typeof window !== "undefined" ? window : globalThis);
