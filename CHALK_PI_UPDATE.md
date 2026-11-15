# Chalk update: Raspberry Pi + board list

Unzip over the repository root; every file sits at its real path.
Then run `python manage.py collectstatic` (no migrations, no new dependencies).

## New files
- static/chalk/js/lab/lab_pi.js         the Raspberry Pi part, its 3.3 V physics, one Linux machine per Pi
- static/chalk/js/lab/lab_pi_os.js      the kernel, file system, SD card, bash, the three distros
- static/chalk/js/lab/lab_pi_cmds.js    every command (ls … apt, pinout, pinctrl, gpioset, gpio readall, nano, python3 …)
- static/chalk/js/lab/lab_pi_py.js      the Python interpreter, gpiozero and RPi.GPIO
- static/chalk/js/lab/lab_pi_term.js    the Terminal tab, nano editor, SD-card Files dialog
- static/chalk/css/chalk_pi.css         terminal styling (one theme per distro)
- tools/chalk_lab/pi_test.js            headless tests (node tools/chalk_lab/run_all.js)

## Changed files
- templates/chalk/board_list.html       the redesigned board list
- chalk/views.py                        BoardListView also counts circuits and power plans per board
- templates/chalk/lab.html              loads the new scripts and stylesheet
- static/chalk/js/lab/lab_examples.js   four Raspberry Pi examples (level "Raspberry Pi")
- static/chalk/js/lab/lab_projects.js   five Raspberry Pi worked projects (category "Raspberry Pi")
- static/chalk/js/lab/lab_studio.js     the project wizard puts a Pi project's SD card on the Pi
- static/chalk/js/lab/lab_app.js, lab_runner.js, lab_coach.js, lab_panels.js,
  lab_helper.js, lab_layers.js, lab_body.js   small hooks so the Pi counts as a board
- tools/chalk_lab/h.js, run_all.js, projects_test.js   test harness knows about the Pi
