# Chalk Power Lab + 3-D Maker — install

Unzip over the repository root (paths match the repo), then:

    git add -A && git commit -m "Chalk: Power Lab and 3-D Maker" && git push
    # on the server
    ./deploy.sh
    docker compose exec web python manage.py makemigrations chalk
    docker compose exec web python manage.py migrate

**One new table.** `chalk.BoardPlan` (a saved Power Lab plan) is added to
`chalk/models.py`. No migration file is shipped, for the reason INSTALL.md
gives: this repository keeps migrations on the server, and a file from here
could clash with the server's own numbering. `makemigrations chalk` writes
it. Until it has run, the Power Lab page gives a database error; nothing
else is affected.

**No new settings and no new packages.** The AI uses the existing
`GEMINI_API_KEY` through `hanns/ai.py` and shares the Circuit Lab's hourly
allowance (`CHALK_LAB_AI_HOURLY_LIMIT`). With no key, every feature still
works from built-in rules.

## Where it appears

- Board list and the board's HUD/menu: a **Power lab** link beside *Circuit lab*.
  URL: `/chalk/b/<board>/power/`
- Circuit Lab → **Body** space: a **✨ Maker** button and **Print check** in the
  toolbar; 3MF and OBJ in the export dialog.

## Tests

    node tools/power_lab_test.js          # engine: 25 tests, no browser, no packages
    python manage.py test chalk           # 69 tests (existing Circuit Lab + Power Lab)

## Files

New

    chalk/power.py                 views, validation of saved plans
    chalk/power_ai.py              AI prompts and answer cleaning
    chalk/test_power.py
    templates/chalk/power.html
    static/chalk/css/chalk_power.css
    static/chalk/js/power/power_core.js      helpers, cable tables, panels, appliances
    static/chalk/js/power/power_parts.js     32 parts: terminals, settings, drawings
    static/chalk/js/power/power_sun.js       sun position, irradiance, 10 sites
    static/chalk/js/power/power_sim.js       the AC/DC solver and every device's behaviour
    static/chalk/js/power/power_size.js      sizing, auto-wiring, words -> spec
    static/chalk/js/power/power_check.js     design checks, bill of materials
    static/chalk/js/power/power_view.js      the drawing board
    static/chalk/js/power/power_testers.js   12 test instruments
    static/chalk/js/power/power_design.js    wizard, site, costs, fault game, AI panel
    static/chalk/js/power/power_report.js    implementation plan to print
    static/chalk/js/power/power_print.js     print shop
    static/chalk/js/power/power_app.js       the page
    static/chalk/js/lab/lab_print.js         print analysis, orientation, 3MF, OBJ
    static/chalk/js/lab/lab_maker.js         the Maker panel in the Body space
    tools/power_lab_test.js

Changed

    chalk/models.py                + BoardPlan (appended; nothing else touched)
    chalk/urls.py                  + five power routes
    chalk/admin.py                 + BoardPlanAdmin
    chalk/lab_ai.py                + kinds: object, bodyedit, printcoach
    templates/chalk/lab.html       + two script tags, + Power lab link
    templates/chalk/stage.html     + Power lab link (HUD and menu)
    templates/chalk/board_list.html + Power lab link

`lab_body_view.js`, `lab_body.js` and `lab_solid.js` are not edited: the
Maker attaches itself to the Body view from outside.

## Things to set for your market

- Prices in the bill of materials are rough dalasi placeholders. Type real
  supplier prices into the Costs dialog; they are saved with the plan. The
  defaults live in `power_parts.js` (`price:`) and `power_core.js` (`W.PV`).
- The electricity tariff defaults to D 13.5/kWh (Place & sun dialog).
- Sites and their monthly cloud/temperature are in `power_sun.js`
  (`Sun.SITES`). If you add one, add its name to `SITES` in
  `chalk/power_ai.py` too — a test fails if they drift.
