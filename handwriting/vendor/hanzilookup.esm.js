function _classCallCheck(a, n) {
  if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
}
function _defineProperties(e, r) {
  for (var t = 0; t < r.length; t++) {
    var o = r[t];
    o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
  }
}
function _createClass(e, r, t) {
  return r && _defineProperties(e.prototype, r), Object.defineProperty(e, "prototype", {
    writable: false
  }), e;
}
function _toPrimitive(t, r) {
  if ("object" != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r);
    if ("object" != typeof i) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (String )(t);
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, "string");
  return "symbol" == typeof i ? i : i + "";
}

var SubStroke = /*#__PURE__*/_createClass(function SubStroke(direction, length, centerX, centerY) {
  _classCallCheck(this, SubStroke);
  this.direction = direction;
  this.length = length;
  this.centerX = centerX;
  this.centerY = centerY;
});

var AnalyzedStroke = /*#__PURE__*/_createClass(function AnalyzedStroke(points, pivotIndexes, subStrokes) {
  _classCallCheck(this, AnalyzedStroke);
  this.points = points;
  this.pivotIndexes = pivotIndexes;
  this.subStrokes = subStrokes;
});

var MIN_SEGMENT_LENGTH = 12.5;
var MAX_LOCAL_LENGTH_RATIO = 1.1;
var MAX_RUNNING_LENGTH_RATIO = 1.09;

// Gets distance between two points
function dist(a, b) {
  var dx = a[0] - b[0];
  var dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Gets direction, in radians, from point a to b
function dir(a, b) {
  var dx = a[0] - b[0];
  var dy = a[1] - b[1];
  var dir = Math.atan2(dy, dx);
  return Math.PI - dir;
}
var AnalyzedCharacter = /*#__PURE__*/function () {
  function AnalyzedCharacter(rawStrokes) {
    _classCallCheck(this, AnalyzedCharacter);
    this._top = Number.MAX_SAFE_INTEGER;
    this._bottom = Number.MIN_SAFE_INTEGER;
    this._left = Number.MAX_SAFE_INTEGER;
    this._right = Number.MIN_SAFE_INTEGER;
    this._analyzedStrokes = [];
    this._subStrokeCount = 0;

    // Calculate bounding rectangle
    this._getBoundingRect(rawStrokes);
    // Build analyzed strokes
    this._buildAnalyzedStrokes(rawStrokes);

    // Result
    this.top = this._top <= 256 ? this._top : 0;
    this.bottom = this._bottom >= 0 ? this._bottom : 256;
    this.left = this._left <= 256 ? this._left : 0;
    this.right = this._right >= 0 ? this._right : 256;
    this.analyzedStrokes = this._analyzedStrokes;
    this.subStrokeCount = this._subStrokeCount;
  }
  return _createClass(AnalyzedCharacter, [{
    key: "_getBoundingRect",
    value: function _getBoundingRect(rawStrokes) {
      for (var i = 0; i != rawStrokes.length; ++i) {
        for (var j = 0; j != rawStrokes[i].length; ++j) {
          var pt = rawStrokes[i][j];
          if (pt[0] < this._left) this._left = pt[0];
          if (pt[0] > this._right) this._right = pt[0];
          if (pt[1] < this._top) this._top = pt[1];
          if (pt[1] > this._bottom) this._bottom = pt[1];
        }
      }
    }
  }, {
    key: "_normDist",
    value: function _normDist(a, b) {
      var width = this._right - this._left;
      var height = this._bottom - this._top;
      var dimensionSquared = width > height ? width * width : height * height;
      var normalizer = Math.sqrt(dimensionSquared + dimensionSquared);
      var distanceNormalized = dist(a, b) / normalizer;
      return Math.min(distanceNormalized, 1);
    }
  }, {
    key: "_getPivotIndexes",
    value: function _getPivotIndexes(points) {
      var markers = [];
      for (var i = 0; i != points.length; ++i) markers.push(false);
      var prevPtIx = 0;
      var firstPtIx = 0;
      var pivotPtIx = 1;
      markers[0] = true;
      var localLength = dist(points[firstPtIx], points[pivotPtIx]);
      var runningLength = localLength;
      for (var i = 2; i < points.length; ++i) {
        var nextPoint = points[i];
        var pivotLength = dist(points[pivotPtIx], nextPoint);
        localLength += pivotLength;
        runningLength += pivotLength;
        var distFromPrevious = dist(points[prevPtIx], nextPoint);
        var distFromFirst = dist(points[firstPtIx], nextPoint);
        if (localLength > MAX_LOCAL_LENGTH_RATIO * distFromPrevious || runningLength > MAX_RUNNING_LENGTH_RATIO * distFromFirst) {
          if (markers[prevPtIx] && dist(points[prevPtIx], points[pivotPtIx]) < MIN_SEGMENT_LENGTH) {
            markers[prevPtIx] = false;
          }
          markers[pivotPtIx] = true;
          runningLength = pivotLength;
          firstPtIx = pivotPtIx;
        }
        localLength = pivotLength;
        prevPtIx = pivotPtIx;
        pivotPtIx = i;
      }
      markers[pivotPtIx] = true;
      if (markers[prevPtIx] && dist(points[prevPtIx], points[pivotPtIx]) < MIN_SEGMENT_LENGTH && prevPtIx != 0) {
        markers[prevPtIx] = false;
      }
      var res = [];
      for (var i = 0; i != markers.length; ++i) {
        if (markers[i]) res.push(i);
      }
      return res;
    }
  }, {
    key: "_getNormCenter",
    value: function _getNormCenter(a, b) {
      var x = (a[0] + b[0]) / 2;
      var y = (a[1] + b[1]) / 2;
      var side;
      if (this._right - this._left > this._bottom - this._top) {
        side = this._right - this._left;
        var height = this._bottom - this._top;
        x = x - this._left;
        y = y - this._top + (side - height) / 2;
      } else {
        side = this._bottom - this._top;
        var width = this._right - this._left;
        x = x - this._left + (side - width) / 2;
        y = y - this._top;
      }
      return [x / side, y / side];
    }
  }, {
    key: "_buildSubStrokes",
    value: function _buildSubStrokes(points, pivotIndexes) {
      var res = [];
      var prevIx = 0;
      for (var i = 0; i != pivotIndexes.length; ++i) {
        var ix = pivotIndexes[i];
        if (ix == prevIx) continue;
        var direction = dir(points[prevIx], points[ix]);
        direction = Math.round(direction * 256.0 / Math.PI / 2.0);
        if (direction == 256) direction = 0;
        var normLength = this._normDist(points[prevIx], points[ix]);
        normLength = Math.round(normLength * 255);
        var center = this._getNormCenter(points[prevIx], points[ix]);
        center[0] = Math.round(center[0] * 15);
        center[1] = Math.round(center[1] * 15);
        res.push(new SubStroke(direction, normLength, center[0], center[1]));
        prevIx = ix;
      }
      return res;
    }
  }, {
    key: "_buildAnalyzedStrokes",
    value: function _buildAnalyzedStrokes(rawStrokes) {
      for (var i = 0; i != rawStrokes.length; ++i) {
        var pivotIndexes = this._getPivotIndexes(rawStrokes[i]);
        var subStrokes = this._buildSubStrokes(rawStrokes[i], pivotIndexes);
        this._subStrokeCount += subStrokes.length;
        this._analyzedStrokes.push(new AnalyzedStroke(rawStrokes[i], pivotIndexes, subStrokes));
      }
    }
  }]);
}();

var CharacterMatch = /*#__PURE__*/_createClass(function CharacterMatch(character, score) {
  _classCallCheck(this, CharacterMatch);
  this.character = character;
  this.score = score;
});

function CubicCurve2D(x1, y1, ctrlx1, ctrly1, ctrlx2, ctrly2, x2, y2) {

  var _x1 = x1;
  var _y1 = y1;
  var _ctrlX1 = ctrlx1;
  var _ctrlY1 = ctrly1;
  var _ctrlX2 = ctrlx2;
  var _ctrlY2 = ctrly2;
  var _x2 = x2;
  var _y2 = y2;
  function getCubicAx() {
    return _x2 - _x1 - getCubicBx() - getCubicCx();
  }
  function getCubicAy() {
    return _y2 - _y1 - getCubicBy() - getCubicCy();
  }
  function getCubicBx() {
    return 3.0 * (_ctrlX2 - _ctrlX1) - getCubicCx();
  }
  function getCubicBy() {
    return 3.0 * (_ctrlY2 - _ctrlY1) - getCubicCy();
  }
  function getCubicCx() {
    return 3.0 * (_ctrlX1 - _x1);
  }
  function getCubicCy() {
    return 3.0 * (_ctrlY1 - _y1);
  }
  function doSolveForX(x) {
    var solutions = [];
    var a = getCubicAx();
    var b = getCubicBx();
    var c = getCubicCx();
    var d = _x1 - x;
    var f = (3.0 * c / a - b * b / (a * a)) / 3.0;
    var g = (2.0 * b * b * b / (a * a * a) - 9.0 * b * c / (a * a) + 27.0 * d / a) / 27.0;
    var h = g * g / 4.0 + f * f * f / 27.0;
    // There is only one real root
    if (h > 0) {
      var u = 0 - g;
      var r = u / 2 + Math.pow(h, 0.5);
      var s6 = Math.pow(r, 0.333333333333333333333333333);
      var s8 = s6;
      var t8 = u / 2 - Math.pow(h, 0.5);
      var v7 = Math.pow(0 - t8, 0.33333333333333333333);
      var v8 = v7;
      var x3 = s8 - v8 - b / (3 * a);
      solutions.push(x3);
    }
    // All 3 roots are real and equal
    else if (f == 0.0 && g == 0.0 && h == 0.0) {
      solutions.push(-Math.pow(d / a, 1.0 / 3.0));
    }
    // All three roots are real (h <= 0)
    else {
      var i = Math.sqrt(g * g / 4.0 - h);
      var j = Math.pow(i, 1.0 / 3.0);
      var k = Math.acos(-g / (2 * i));
      var l = j * -1;
      var m = Math.cos(k / 3.0);
      var n = Math.sqrt(3.0) * Math.sin(k / 3.0);
      var p = b / (3.0 * a) * -1;
      solutions.push(2.0 * j * Math.cos(k / 3.0) - b / (3.0 * a));
      solutions.push(l * (m + n) + p);
      solutions.push(l * (m - n) + p);
    }
    return solutions;
  }
  return {
    x1: function x1() {
      return _x1;
    },
    x2: function x2() {
      return _x2;
    },
    getYOnCurve: function getYOnCurve(t) {
      var ay = getCubicAy();
      var by = getCubicBy();
      var cy = getCubicCy();
      var tSquared = t * t;
      var tCubed = t * tSquared;
      var y = ay * tCubed + by * tSquared + cy * t + _y1;
      return y;
    },
    solveForX: function solveForX(x) {
      return doSolveForX(x);
    },
    getFirstSolutionForX: function getFirstSolutionForX(x) {
      var solutions = doSolveForX(x);
      for (var i = 0; i != solutions.length; ++i) {
        var d = solutions[i];
        if (d >= -1e-8 && d <= 1.00000001) {
          if (d >= 0.0 && d <= 1.0) return d;
          if (d < 0.0) return 0.0;
          return 1.0;
        }
      }
      return NaN;
    }
  };
}

function decodeCompact(base64) {

  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // Use a lookup table to find the index.
  var lookup = new Uint8Array(256);
  for (var i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  var bufferLength = base64.length * 0.75,
    len = base64.length,
    i,
    p = 0,
    encoded1,
    encoded2,
    encoded3,
    encoded4;
  if (base64[base64.length - 1] === "=") {
    bufferLength--;
    if (base64[base64.length - 2] === "=") {
      bufferLength--;
    }
  }
  var arraybuffer = new ArrayBuffer(bufferLength),
    bytes = new Uint8Array(arraybuffer);
  for (i = 0; i < len; i += 4) {
    encoded1 = lookup[base64.charCodeAt(i)];
    encoded2 = lookup[base64.charCodeAt(i + 1)];
    encoded3 = lookup[base64.charCodeAt(i + 2)];
    encoded4 = lookup[base64.charCodeAt(i + 3)];
    bytes[p++] = encoded1 << 2 | encoded2 >> 4;
    bytes[p++] = (encoded2 & 15) << 4 | encoded3 >> 2;
    bytes[p++] = (encoded3 & 3) << 6 | encoded4 & 63;
  }
  return bytes;
}

function MatchCollector(limit) {

  var _count = 0;
  var _matches = [];
  for (var i = 0; i != limit; ++i) _matches.push(null);
  function findSlot(score) {
    var ix;
    for (ix = 0; ix < _count; ++ix) {
      if (_matches[ix].score < score) return ix;
    }
    return ix;
  }
  function removeExistingLower(match) {
    var ix = -1;
    for (var i = 0; i != _count; ++i) {
      if (_matches[i].character == match.character) {
        ix = i;
        break;
      }
    }
    // Not there yet: we're good, match doesn't need to be skipped
    if (ix == -1) return false;
    // New score is not better: skip this match
    if (match.score <= _matches[ix].score) return true;
    // Remove existing match; don't skip new. Means shifting array left.
    for (var i = ix; i < _matches.length - 1; ++i) _matches[i] = _matches[i + 1];
    --_count;
    return false;
  }
  function doFileMatch(match) {
    // Already at limit: don't bother if new match's score is smaller than current minimum
    if (_count == _matches.length && match.score <= _matches[_matches.length - 1].score) return;
    // Remove if we already have this character with a lower score
    // If "true", we should skip new match (already there with higher score)
    if (removeExistingLower(match)) return;
    // Where does new match go? (Keep array sorted largest score to smallest.)
    var pos = findSlot(match.score);
    // Slide rest to the right
    for (var i = _matches.length - 1; i > pos; --i) _matches[i] = _matches[i - 1];
    // Replace at position
    _matches[pos] = match;
    // Increase count if we're just now filling up
    if (_count < _matches.length) ++_count;
  }
  function doGetMatches() {
    return _matches.slice(0, _count);
  }
  return {
    fileMatch: function fileMatch(match) {
      doFileMatch(match);
    },
    getMatches: function getMatches() {
      return doGetMatches();
    }
  };
}

var data = {};

// Magic constants
var MAX_CHARACTER_STROKE_COUNT = 48;
var MAX_CHARACTER_SUB_STROKE_COUNT = 64;
var DEFAULT_LOOSENESS = 0.15;
var SKIP_PENALTY_MULTIPLIER = 1.75;
var CORRECT_NUM_STROKES_BONUS = 0.1;
var CORRECT_NUM_STROKES_CAP = 10;
var Matcher = /*#__PURE__*/function () {
  function Matcher(dataName, looseness) {
    _classCallCheck(this, Matcher);
    this._looseness = looseness || DEFAULT_LOOSENESS;
    this._repo = data[dataName].chars;
    this._sbin = data[dataName].substrokes;
    this._scoreMatrix = this._buildScoreMatrix();
    this._charsChecked = 0;
    this._subStrokesCompared = 0;
    this.DIRECTION_SCORE_TABLE = null;
    this.LENGTH_SCORE_TABLE = null;
    this.POS_SCORE_TABLE = null;

    // Init score tables
    this._initScoreTables();
  }
  return _createClass(Matcher, [{
    key: "match",
    value: function match(analyzedChar, limit, ready) {
      this._doMatch(analyzedChar, limit, ready);
    }
  }, {
    key: "getCounters",
    value: function getCounters() {
      return {
        chars: this._charsChecked,
        subStrokes: this._subStrokesCompared
      };
    }
  }, {
    key: "_doMatch",
    value: function _doMatch(inputChar, limit, ready) {
      // Diagnostic counters
      this._charsChecked = 0;
      this._subStrokesCompared = 0;

      // This will gather matches
      // MatchCollector is a function in previous step, so we call it.
      // If I converted it to class, I'd use `new MatchCollector`.
      // Wait, in previous step I converted MatchCollector to `export default function MatchCollector(limit) { ... }`
      // So `new MatchCollector(limit)` works if it returns object? 
      // Yes, a function called with `new` returns the object returned by the function if it returns an object.
      // Wait, `MatchCollector` logic:
      // `return { fileMatch: ..., getMatches: ... };`
      // So `new MatchCollector(limit)` will return that object. Correct.
      var matchCollector = new MatchCollector(limit);

      // Edge case: empty input should return no matches; but permissive lookup does find a few...
      if (inputChar.analyzedStrokes.length == 0) return matchCollector.getMatches();

      // Flat format: matching needs this. Only transform once.
      var inputSubStrokes = [];
      for (var i = 0; i != inputChar.analyzedStrokes.length; ++i) {
        var stroke = inputChar.analyzedStrokes[i];
        for (var j = 0; j != stroke.subStrokes.length; ++j) {
          inputSubStrokes.push(stroke.subStrokes[j]);
        }
      }

      // Some pre-computed looseness magic
      var strokeCount = inputChar.analyzedStrokes.length;
      var subStrokeCount = inputChar.subStrokeCount;
      var strokeRange = this._getStrokesRange(strokeCount);
      var minimumStrokes = Math.max(strokeCount - strokeRange, 1);
      var maximumStrokes = Math.min(strokeCount + strokeRange, MAX_CHARACTER_STROKE_COUNT);
      var subStrokesRange = this._getSubStrokesRange(subStrokeCount);
      var minSubStrokes = Math.max(subStrokeCount - subStrokesRange, 1);
      var maxSubStrokes = Math.min(subStrokeCount + subStrokesRange, MAX_CHARACTER_SUB_STROKE_COUNT);

      // Iterate over all characters in repo
      for (var cix = 0; cix != this._repo.length; ++cix) {
        var repoChar = this._repo[cix];
        var cmpStrokeCount = repoChar[1];
        var cmpSubStrokes = repoChar[2];
        if (cmpStrokeCount < minimumStrokes || cmpStrokeCount > maximumStrokes) continue;
        if (cmpSubStrokes.length < minSubStrokes || cmpSubStrokes.length > maxSubStrokes) continue;
        // Match against character in repo
        var match = this._matchOne(strokeCount, inputSubStrokes, subStrokesRange, repoChar);
        // File; collector takes care of comparisons and keeping N-best
        matchCollector.fileMatch(match);
      }
      // When done: just return collected matches
      // This is an array of CharacterMatch objects
      ready(matchCollector.getMatches());
    }
  }, {
    key: "_getStrokesRange",
    value: function _getStrokesRange(strokeCount) {
      if (this._looseness == 0) return 0;
      if (this._looseness == 1) return MAX_CHARACTER_STROKE_COUNT;
      var ctrl1X = 0.35;
      var ctrl1Y = strokeCount * 0.4;
      var ctrl2X = 0.6;
      var ctrl2Y = strokeCount;
      // CubicCurve2D is function returning object, or I should treat it as constructor?
      // In previous step: `export default function CubicCurve2D(...) { ... return { ... } }`
      // So `new CubicCurve2D(...)` returns the object.
      var curve = new CubicCurve2D(0, 0, ctrl1X, ctrl1Y, ctrl2X, ctrl2Y, 1, MAX_CHARACTER_STROKE_COUNT);
      var t = curve.getFirstSolutionForX(this._looseness);
      return Math.round(curve.getYOnCurve(t));
    }
  }, {
    key: "_getSubStrokesRange",
    value: function _getSubStrokesRange(subStrokeCount) {
      if (this._looseness == 1.0) return MAX_CHARACTER_SUB_STROKE_COUNT;
      var y0 = subStrokeCount * 0.25;
      var ctrl1X = 0.4;
      var ctrl1Y = 1.5 * y0;
      var ctrl2X = 0.75;
      var ctrl2Y = 1.5 * ctrl1Y;
      var curve = new CubicCurve2D(0, y0, ctrl1X, ctrl1Y, ctrl2X, ctrl2Y, 1, MAX_CHARACTER_SUB_STROKE_COUNT);
      var t = curve.getFirstSolutionForX(this._looseness);
      return Math.round(curve.getYOnCurve(t));
    }
  }, {
    key: "_buildScoreMatrix",
    value: function _buildScoreMatrix() {
      var dim = MAX_CHARACTER_SUB_STROKE_COUNT + 1;
      var res = [];
      for (var i = 0; i < dim; i++) {
        res.push([]);
        for (var j = 0; j < dim; j++) res[i].push(0);
      }
      for (var i = 0; i < dim; i++) {
        var penalty = -0.33 * SKIP_PENALTY_MULTIPLIER * i;
        res[i][0] = penalty;
        res[0][i] = penalty;
      }
      return res;
    }
  }, {
    key: "_matchOne",
    value: function _matchOne(inputStrokeCount, inputSubStrokes, subStrokesRange, repoChar) {
      ++this._charsChecked;
      var score = this._computeMatchScore(inputStrokeCount, inputSubStrokes, subStrokesRange, repoChar);
      if (inputStrokeCount == repoChar[1] && inputStrokeCount < CORRECT_NUM_STROKES_CAP) {
        var bonus = CORRECT_NUM_STROKES_BONUS * Math.max(CORRECT_NUM_STROKES_CAP - inputStrokeCount, 0) / CORRECT_NUM_STROKES_CAP;
        score += bonus * score;
      }
      // CharacterMatch is class
      return new CharacterMatch(repoChar[0], score);
    }
  }, {
    key: "_computeMatchScore",
    value: function _computeMatchScore(strokeCount, inputSubStrokes, subStrokesRange, repoChar) {
      for (var x = 0; x < inputSubStrokes.length; x++) {
        var inputDirection = inputSubStrokes[x].direction;
        var inputLength = inputSubStrokes[x].length;
        var inputCenter = [inputSubStrokes[x].centerX, inputSubStrokes[x].centerY];
        for (var y = 0; y < repoChar[2]; y++) {
          var newScore = Number.NEGATIVE_INFINITY;
          if (Math.abs(x - y) <= subStrokesRange) {
            var compareDirection = this._sbin[repoChar[3] + y * 3];
            var compareLength = this._sbin[repoChar[3] + y * 3 + 1];
            var compareCenter = null;
            var bCenter = this._sbin[repoChar[3] + y * 3 + 2];
            if (bCenter > 0) compareCenter = [(bCenter & 0xf0) >>> 4, bCenter & 0x0f];
            var skip1Score = this._scoreMatrix[x][y + 1] - inputLength / 256 * SKIP_PENALTY_MULTIPLIER;
            var skip2Score = this._scoreMatrix[x + 1][y] - compareLength / 256 * SKIP_PENALTY_MULTIPLIER;
            var skipScore = Math.max(skip1Score, skip2Score);
            var matchScore = this._computeSubStrokeScore(inputDirection, inputLength, compareDirection, compareLength, inputCenter, compareCenter);
            var previousScore = this._scoreMatrix[x][y];
            newScore = Math.max(previousScore + matchScore, skipScore);
          }
          this._scoreMatrix[x + 1][y + 1] = newScore;
        }
      }
      return this._scoreMatrix[inputSubStrokes.length][repoChar[2]];
    }
  }, {
    key: "_computeSubStrokeScore",
    value: function _computeSubStrokeScore(inputDir, inputLen, repoDir, repoLen, inputCenter, repoCenter) {
      ++this._subStrokesCompared;
      var directionScore = this._getDirectionScore(inputDir, repoDir, inputLen);
      var lengthScore = this._getLengthScore(inputLen, repoLen);
      var score = lengthScore * directionScore;
      if (repoCenter) {
        var dx = inputCenter[0] - repoCenter[0];
        var dy = inputCenter[1] - repoCenter[1];
        var closeness = this.POS_SCORE_TABLE[dx * dx + dy * dy];
        if (score > 0) score *= closeness;else score /= closeness;
      }
      return score;
    }
  }, {
    key: "_initScoreTables",
    value: function _initScoreTables() {
      var dirCurve = new CubicCurve2D(0, 1.0, 0.5, 1.0, 0.25, -2, 1.0, 1.0);
      this.DIRECTION_SCORE_TABLE = this._initCubicCurveScoreTable(dirCurve, 256);
      var lenCurve = new CubicCurve2D(0, 0, 0.25, 1.0, 0.75, 1.0, 1.0, 1.0);
      this.LENGTH_SCORE_TABLE = this._initCubicCurveScoreTable(lenCurve, 129);
      this.POS_SCORE_TABLE = [];
      for (var i = 0; i <= 450; ++i) {
        this.POS_SCORE_TABLE.push(1 - Math.sqrt(i) / 22);
      }
    }
  }, {
    key: "_initCubicCurveScoreTable",
    value: function _initCubicCurveScoreTable(curve, numSamples) {
      var x1 = curve.x1();
      var x2 = curve.x2();
      var range = x2 - x1;
      var x = x1;
      var xInc = range / numSamples;
      var scoreTable = [];
      for (var i = 0; i < numSamples; i++) {
        // Curve object returned by CubicCurve2D(...) has getFirstSolutionForX etc.
        var t = curve.getFirstSolutionForX(Math.min(x, x2));
        scoreTable.push(curve.getYOnCurve(t));
        x += xInc;
      }
      return scoreTable;
    }
  }, {
    key: "_getDirectionScore",
    value: function _getDirectionScore(direction1, direction2, inputLength) {
      var theta = Math.abs(direction1 - direction2);
      var directionScore = this.DIRECTION_SCORE_TABLE[theta];
      if (inputLength < 64) {
        var shortLengthBonusMax = Math.min(1.0, 1.0 - directionScore);
        var shortLengthBonus = shortLengthBonusMax * (1 - inputLength / 64);
        directionScore += shortLengthBonus;
      }
      return directionScore;
    }
  }, {
    key: "_getLengthScore",
    value: function _getLengthScore(length1, length2) {
      var ratio;
      if (length1 > length2) ratio = Math.round((length2 << 7) / length1);else ratio = Math.round((length1 << 7) / length2);
      return this.LENGTH_SCORE_TABLE[ratio];
    }
  }]);
}();

function init(dataName, url, ready) {

  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  xhr.onreadystatechange = function () {
    if (this.readyState !== 4) return;
    if (this.status === 200) {
      dataReceived(dataName, xhr.responseText);
      ready(true);
    } else ready(false);
  };
  xhr.send();
  function dataReceived(dataName, responseText) {
    data[dataName] = JSON.parse(responseText);
    data[dataName].substrokes = decodeCompact(data[dataName].substrokes);
  }
}

export { AnalyzedCharacter, AnalyzedStroke, CharacterMatch, CubicCurve2D, MatchCollector, Matcher, SubStroke, data, decodeCompact, init };
