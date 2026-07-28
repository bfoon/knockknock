/* kura/static/kura/js/section_gate.js
 *
 * Client-side mirror of walk_visibility() in kura/logic.py.
 *
 * It deliberately does NOT contain a condition evaluator. The runner
 * already has one, and two implementations of comparator semantics would
 * drift apart within a month — so you pass yours in and this file only
 * owns the section-gating rule.
 *
 * Rule (identical to the server):
 *   - A "section" item opens a run that ends at the next "section" item.
 *   - While the section's own relevance is false, every item in that run
 *     is hidden — inputs are not rendered, required does not fire, and
 *     the answers are stripped before submit (the server strips them too).
 *   - scope: "self"        header may hide itself, gates nothing after it.
 *   - {type:"section", end:true}   closes a run without opening one.
 *   - Sections do not nest; inside a repeat item the gate starts fresh.
 *
 * Usage in the runner, where isRelevant(item) is your existing
 * "own relevance" check (skip logic AND geofence):
 *
 *     const rows = kuraWalkVisibility(schema.questions, isRelevant);
 *     rows.forEach(({item, visible, section}) => {
 *         if (!visible) { hide(item); return; }
 *         render(item);
 *     });
 *
 * And before POSTing:
 *
 *     answers = kuraStripHidden(schema.questions, answers, isRelevant);
 */

(function (global) {
  "use strict";

  function gatesFollowing(section) {
    return String((section && section.scope) || "until_next") !== "self";
  }

  /**
   * @param {Array}    questions  schema.questions (or a repeat's children)
   * @param {Function} isRelevant (item) => boolean — the item's OWN relevance
   * @returns {Array}  [{item, visible, section}]
   */
  function kuraWalkVisibility(questions, isRelevant) {
    var out = [];
    var gate = true;      // is the current section run switched on?
    var section = null;   // the section item that opened the run

    (questions || []).forEach(function (q) {
      if (!q || typeof q !== "object") return;

      if (q.type === "section") {
        if (q.end) {
          gate = true;
          section = null;
          out.push({ item: q, visible: false, section: null });
          return;
        }
        var own = !!isRelevant(q);
        if (gatesFollowing(q)) {
          gate = own;
          section = q;
        } else {
          gate = true;
          section = null;
        }
        out.push({ item: q, visible: own, section: q });
        return;
      }

      out.push({
        item: q,
        visible: gate && !!isRelevant(q),
        section: section
      });
    });

    return out;
  }

  /** {name: boolean} for every named item — mirrors visibility_map(). */
  function kuraVisibilityMap(questions, isRelevant) {
    var map = {};
    kuraWalkVisibility(questions, isRelevant).forEach(function (row) {
      if (row.item.name) map[row.item.name] = row.visible;
    });
    return map;
  }

  /**
   * Drop answers the respondent could not see, so the payload matches what
   * the server will keep. Recurses into repeat groups; the gate resets at
   * the start of every item, exactly as on the server.
   *
   * @param {Function} isRelevant (item, ctx) => boolean
   */
  function kuraStripHidden(questions, answers, isRelevant) {
    var ctx = answers || {};
    var clean = {};

    kuraWalkVisibility(questions, function (item) {
      return isRelevant(item, ctx);
    }).forEach(function (row) {
      var q = row.item;
      if (!q.name || q.type === "section" || q.type === "note") return;
      if (!row.visible) return;

      var val = ctx[q.name];
      if (val === undefined) return;

      if (q.type === "repeat" && Array.isArray(val)) {
        clean[q.name] = val.map(function (rawItem) {
          var itemCtx = Object.assign({}, ctx, rawItem || {});
          var cleanItem = {};
          kuraWalkVisibility(q.children, function (child) {
            return isRelevant(child, itemCtx);
          }).forEach(function (crow) {
            var ch = crow.item;
            if (!ch.name || ch.type === "section" || ch.type === "note") return;
            if (!crow.visible) return;
            if (itemCtx[ch.name] !== undefined) cleanItem[ch.name] = itemCtx[ch.name];
          });
          return cleanItem;
        });
        return;
      }

      clean[q.name] = val;
    });

    return clean;
  }

  global.kuraWalkVisibility = kuraWalkVisibility;
  global.kuraVisibilityMap = kuraVisibilityMap;
  global.kuraStripHidden = kuraStripHidden;
})(window);
