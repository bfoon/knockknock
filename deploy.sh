cat > /srv/knockknock/deploy.sh <<'EOF'
#!/bin/sh
# Deploy Knock-Knock: bring the server exactly up to GitHub, then restart.
# The server never commits. If it has edits or commits of its own, this
# script stops and says so instead of letting git diverge.
set -e
cd /srv/knockknock

echo "→ Fetching GitHub…"
git fetch origin master

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✗ The server has uncommitted edits to tracked files:"
  git status --short --untracked-files=no
  echo "  Make these changes on your laptop and push them instead."
  echo "  Then discard them here with:  git checkout -- .   and run ./deploy.sh again."
  exit 1
fi

AHEAD=$(git rev-list --count origin/master..HEAD)
if [ "$AHEAD" -gt 0 ]; then
  echo "✗ The server has $AHEAD commit(s) that are not on GitHub:"
  git log --oneline origin/master..HEAD
  echo "  Upload them once with:  git pull --rebase origin master && git push origin master"
  echo "  Then run ./deploy.sh again."
  exit 1
fi

BEFORE=$(git rev-parse --short HEAD)
git merge --ff-only origin/master
AFTER=$(git rev-parse --short HEAD)
[ "$BEFORE" = "$AFTER" ] && echo "✓ Already up to date ($AFTER)" || echo "✓ Updated $BEFORE → $AFTER"

echo "→ Restarting…"
docker compose up -d
docker compose restart web

echo "→ Waiting for the site…"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:8001/; then
    echo "✓ Site is up."
    exit 0
  fi
  sleep 3
done
echo "✗ Site did not answer after 90 s. Last log lines:"
docker compose logs --tail=30 web
exit 1
EOF
chmod +x /srv/knockknock/deploy.sh