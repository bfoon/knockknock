/* tt_geo.js — board geometry shared by the phone boards and the 3D stage.
 *
 * Ludo uses the classic 15x15 cross. Coordinates are [row, col] with
 * fractional values allowed (yard spots, home triangle). Colour 0 (red)
 * has the top-left yard and moves clockwise, matching tabletop/engines/ludo.py.
 */
window.TTGeo = (function () {
  "use strict";
  var TRACK = [];
  function run(r0, c0, dr, dc, n) { for (var i = 0; i < n; i++) TRACK.push([r0 + dr * i, c0 + dc * i]); }
  run(6, 1, 0, 1, 5); run(5, 6, -1, 0, 6); run(0, 7, 0, 0, 1);
  run(0, 8, 1, 0, 6); run(6, 9, 0, 1, 6); run(7, 14, 0, 0, 1);
  run(8, 14, 0, -1, 6); run(9, 8, 1, 0, 6); run(14, 7, 0, 0, 1);
  run(14, 6, -1, 0, 6); run(8, 5, 0, -1, 6); run(7, 0, 0, 0, 1); run(6, 0, 0, 0, 1);

  var HOME_COL = [
    function (k) { return [7, 1 + k]; }, function (k) { return [1 + k, 7]; },
    function (k) { return [7, 13 - k]; }, function (k) { return [13 - k, 7]; },
  ];
  var FINISH = [[7, 6.2], [6.2, 7], [7, 7.8], [7.8, 7]];
  var YARD = [[2.5, 2.5], [2.5, 11.5], [11.5, 11.5], [11.5, 2.5]];
  var SPOTS = [[-0.9, -0.9], [-0.9, 0.9], [0.9, -0.9], [0.9, 0.9]];
  var SAFE = [0, 8, 13, 21, 26, 34, 39, 47];

  function ludoCell(colour, rel, token) {
    if (rel < 0) {
      var y = YARD[colour], s = SPOTS[token || 0];
      return [y[0] + s[0], y[1] + s[1]];
    }
    if (rel <= 50) return TRACK[(colour * 13 + rel) % 52];
    if (rel <= 55) return HOME_COL[colour](rel - 51);
    var f = FINISH[colour], o = SPOTS[token || 0];
    return [f[0] + o[0] * 0.22, f[1] + o[1] * 0.22];
  }
  // spread tokens sharing a square so they're all visible
  function ludoLayout(tokens, colours) {
    var out = [], seen = {};
    tokens.forEach(function (row, seat) {
      row.forEach(function (rel, k) {
        var c = ludoCell(colours[seat], rel, k);
        var key = rel >= 0 && rel < 56 ? c[0] + "," + c[1] : null;
        var n = key ? (seen[key] = (seen[key] || 0) + 1) - 1 : 0;
        var off = [[0, 0], [0.22, 0.22], [-0.22, 0.22], [0.22, -0.22], [-0.22, -0.22]][Math.min(n, 4)];
        out.push({ seat: seat, token: k, colour: colours[seat], rel: rel, r: c[0] + off[0], c: c[1] + off[1] });
      });
    });
    return out;
  }
  function chessSq(name) { return { c: name.charCodeAt(0) - 97, r: parseInt(name.charAt(1), 10) - 1 }; }
  function chessName(r, c) { return String.fromCharCode(97 + c) + (r + 1); }

  return { TRACK: TRACK, SAFE: SAFE, YARD: YARD, ludoCell: ludoCell, ludoLayout: ludoLayout,
           chessSq: chessSq, chessName: chessName };
})();
