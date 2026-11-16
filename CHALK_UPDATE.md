# Chalk update: Raspberry Pi, Chalk Link API, scenes, board list

Unzip over the repository root; every file sits at its real path. Then:

    python manage.py makemigrations chalk     # one new table: BoardLink (the API)
    python manage.py migrate
    python manage.py collectstatic

No migration file is shipped, as with the Power Lab: this repo keeps chalk's
migrations on the server. No new dependencies.

## Chalk Link — the web API (new in this zip)
- chalk/link.py                         the API and the owner's open/rotate/close endpoint
- chalk/models.py                       + BoardLink (one per board: key, tags, short history)
- chalk/urls.py                         + /chalk/b/<id>/link/ and /chalk/api/link/<key>/…
- chalk/lab.py                          tells the lab page where its link lives (one line)
- chalk/test_link.py                    tests
- static/chalk/js/lab/lab_link.js       the Link button and panel; keeps bench and tags in step
- static/chalk/css/chalk_link.css
- static/chalk/link/chalklink.py        client for a REAL Raspberry Pi (standard library only)
- static/chalk/link/chalklink_esp32.ino client sketch for a REAL ESP32

    GET  /chalk/api/link/<key>/                 what this link is, and every tag
    GET  /chalk/api/link/<key>/tags/            ?since=<seq>  ?flat=1
    POST /chalk/api/link/<key>/tags/            {"values": {"lamp": true}, "by": "my-app"}
    GET/PUT/DELETE /chalk/api/link/<key>/tags/<name>/     ?raw=1 for a bare value
    GET  /chalk/api/link/<key>/set/?lamp=on     write from a URL (tiny devices)
    GET  /chalk/api/link/<key>/events/          the last 300 changes

The key in the address is the only secret; CORS is open and there is no CSRF
on these URLs, so any server, page or microcontroller can call them.
Limits: 200 tags per board, values are numbers / true-false / text up to 240
characters, about 1800 requests a minute per key.

## Scenes — light and coloured backgrounds for both labs (new in this zip)
- static/chalk/js/chalk_theme.js, static/chalk/css/chalk_theme.css
- templates/chalk/power.html, static/chalk/js/power/power_view.js   the Power lab follows the scene

## Raspberry Pi (as before, plus the chalklink module and `link` command)
- static/chalk/js/lab/lab_pi.js, lab_pi_os.js, lab_pi_cmds.js, lab_pi_py.js, lab_pi_term.js
- static/chalk/css/chalk_pi.css
- tools/chalk_lab/pi_test.js            node tools/chalk_lab/run_all.js

## Changed
- templates/chalk/board_list.html, chalk/views.py     the redesigned board list
- templates/chalk/lab.html                            loads the new scripts and styles
- static/chalk/js/lab/lab_examples.js, lab_projects.js, lab_studio.js   Pi examples and projects
- static/chalk/js/lab/lab_app.js, lab_runner.js, lab_coach.js, lab_panels.js,
  lab_helper.js, lab_layers.js, lab_body.js           small hooks so the Pi counts as a board
- tools/chalk_lab/h.js, run_all.js, projects_test.js
