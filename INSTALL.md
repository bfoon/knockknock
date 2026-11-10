# Chalk Circuit Lab — installing

## 1. Add the code

Either apply the patch on a branch of KnockKnock:

    git checkout -b circuit-lab
    git am chalk-circuit-lab.patch

or copy the files from this folder over the repository. They are all new
files except these small edits:

    README.md                        a section about the lab
    chalk/models.py                  BoardCircuit model (appended at the end)
    chalk/urls.py                    six lab routes
    chalk/admin.py                   BoardCircuit in the admin
    templates/chalk/stage.html       "Circuit lab" button in the corner bar and the lobby
    static/chalk/js/chalk_stage.js   the L key opens the lab
    templates/chalk/board_list.html  a "Circuit lab" link on each board

## 2. Create the table

No migration file is included on purpose. Many apps in this repository keep
their migrations on the server only (chalk's committed migrations stop at
0002 while the models have moved on), and the container runs `migrate` at
start-up — a migration from here could clash with the server's own and stop
it booting. So, on the server:

    python manage.py makemigrations chalk
    python manage.py migrate

That creates only `chalk_boardcircuit`; nothing existing is touched.

## 3. Static files

    python manage.py collectstatic --noinput

## 4. AI (optional)

The lab uses the same Gemini key as Hanns and Kura. Without it, "Ask AI" still
answers from the built-in checker.

    GEMINI_API_KEY=...                 # already set if Hanns AI works
    CHALK_LAB_AI_HOURLY_LIMIT=40       # optional; questions per person per hour

"Write the program" and "Build a circuit" can take 20–60 seconds. If nginx
sits in front, give `/chalk/` the same longer read timeout the Hanns notes
recommend for `/hanns/` (180 s).

## 5. Check it

    python manage.py test chalk.test_lab   # 25 tests: permissions, saving, AI, pinning
    node tools/chalk_lab/run_all.js        # the solver, the Arduino interpreter, every example

Open any board on the projector and press L, or use "Circuit lab" on the
board list. The lab is at /chalk/b/<board-id>/lab/.
