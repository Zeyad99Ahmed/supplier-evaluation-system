# GitHub submission guide — Group 26 (step by step)

Module rules this guide follows:

1. **One public team repository** with everyone's work, where **each member has their own branch** for their commits.
2. **One public personal repository per member** as individual proof of work. It does not have to run on its own.
3. **No credentials or secrets** anywhere in the code or the commit history.

| | Team repository `supplier-evaluation-system` | Member branch | Personal repository |
|---|---|---|---|
| Zeyad | creates it (Part A) | `zeyad` | `ses-supplier-service-zeyad` |
| Ebraheem | collaborator (Part C) | `ebraheem` | `ses-order-service-ebraheem` |
| Karim | collaborator (Part C) | `karim` | `ses-evaluation-service-karim` |

Files for each member are in `D:\cloud\SUBMISSION\handover\`:
- `FILES_MAIN.txt`, `FILES_ZEYAD.txt`, `FILES_EBRAHEEM.txt`, `FILES_KARIM.txt`: the exact file list of each owner.
- `Ebraheem_team_repo_files.zip`, `Karim_team_repo_files.zip`: their files, already in the right folders.
- `Zeyad_personal_repo.zip`, `Ebraheem_personal_repo.zip`, `Karim_personal_repo.zip`: a ready personal-repository folder each, with a README.

Run every command in **Git Bash** (right-click a folder → *Open Git Bash here*). Use **GitHub Desktop only to publish**. Never use its *Commit … files* button in the team project folder: it would commit everybody's files under your name.

---

## Part 0 — Zeyad: delete the earlier repositories (≈ 3 min, once)

The two repositories published earlier must be deleted first. That also frees their names.

For **each** of these:
- https://github.com/Zeyad99Ahmed/supplier-evaluation-system
- https://github.com/Zeyad99Ahmed/ses-supplier-service-zeyad

1. Open the link while signed in → **Settings** (tab with the gear icon).
2. Scroll to the bottom, **Danger Zone** → **Delete this repository**.
3. Click through *I want to delete this repository* → *I have read and understand these effects*.
4. Type the repository name exactly as shown (e.g. `Zeyad99Ahmed/supplier-evaluation-system`) → **Delete this repository**. Confirm with your password or 2FA if GitHub asks.

Check: both links should now show *404 – page not found*.

The local folder `D:\cloud\_git_backup_do_not_upload` holds the old history. Don't upload it. You can delete it once everything below is done.

---

## Part A — Zeyad: create the team repository and your branch (≈ 15 min)

**A1. Set your identity** (the e-mail must be the one on your GitHub account):

```bash
git config --global user.name "Zeyad Ahmed"
git config --global user.email "the-email-of-your-github-account"
```

**A2. Create the repository with the project skeleton on `main`**

```bash
cd /d/cloud/supplier-evaluation-system
git init -b main
node scripts/secret-scan.js               # must print: 0 finding(s)
git add .gitignore .gitattributes README.md package.json package-lock.json .env.example docs/GITHUB_SUBMISSION_GUIDE.md
git commit -m "Project skeleton: README, gitignore, line endings, root npm scripts, env example, GitHub guide"
git status --ignored --short | grep env   # .env.local and infra/.env.floci must start with !! (ignored)
```

**A3. Your branch `zeyad`, one meaningful commit per part of your work**

```bash
git checkout -b zeyad

git add services/shared services/package.json services/package-lock.json
git commit -m "Shared library: error format, validation, JSON logging, DB pool, secrets loading, JWT/role middleware, service tokens and service client"

git add services/auth-service
git commit -m "Auth Service: scrypt password hashing, login with lock-out, sessions, logout, me, Admin-created Staff accounts, activity API"

git add services/supplier-service
git commit -m "Supplier Service: profiles, search/filter, update, contracts with overlap rule and EGP conversion, status workflow, recommendations, archive with open-order check"

git add frontend/css frontend/js/api.js frontend/js/ui.js frontend/js/auth.js frontend/js/config.js frontend/js/dashboard.js frontend/dashboard.html frontend/pages/dashboard.body.html scripts/build-pages.js
git commit -m "Frontend shell: stylesheet, fetch helper, safe DOM helpers, session and navigation, dashboard, page builder"

git add frontend/index.html frontend/js/login.js frontend/js/admin.js frontend/admin.html frontend/pages/admin.body.html
git commit -m "Login and Admin pages: generic login errors, Staff accounts, security monitoring"

git add frontend/js/suppliers.js frontend/js/supplier.js frontend/suppliers.html frontend/supplier.html frontend/pages/suppliers.body.html frontend/pages/supplier.body.html
git commit -m "Supplier pages: directory with filters and recommendations, supplier details with contracts, contacts, status history and performance"

git add infra/monitoring.sh scripts/log-query.js scripts/capture-floci-dash.js
git commit -m "Monitoring: CloudWatch metric filters and alarms, log query report, Floci Dash evidence"

git add scripts/local-up.js scripts/lib/env.js scripts/static-server.js scripts/secret-scan.js
git commit -m "Local runner with per-service DB roles, static website server, secret scanner"

git log --oneline                          # 8 commits on zeyad + 1 on main
git status --short | grep -v '^??'         # must print nothing (all of your files are committed)
```

The files still listed by `git status` as `??` are Ebraheem's and Karim's. **Leave them uncommitted.**

**A4. Publish with GitHub Desktop**

1. GitHub Desktop → *File* → **Add local repository…** → `D:\cloud\supplier-evaluation-system` → **Add repository**.
2. Ignore the "changed files" list (your teammates' files). **Do not commit them.**
3. Click **Publish repository** → Name `supplier-evaluation-system`, **untick "Keep this code private"** → **Publish repository**. GitHub Desktop pushes `main` and `zeyad`.
4. Check in a browser: the repository shows branches `main` and `zeyad`.

**A5. Pull request, collaborators, files**

1. github.com → repository → **Pull requests** → **New pull request** → base **main**, compare **zeyad** → **Create pull request**. Title: `Zeyad: shared core, Auth Service, monitoring, Supplier Service`.
2. **Settings → Collaborators → Add people**: add Ebraheem and Karim. They accept the invitation e-mail.
3. Ask one of them to **review** your pull request (*Files changed → Review changes → Approve*). Then **Merge pull request** → **Confirm merge**. **Do not delete the branch.**
4. Send Ebraheem `Ebraheem_team_repo_files.zip` + `Ebraheem_personal_repo.zip`, and Karim `Karim_team_repo_files.zip` + `Karim_personal_repo.zip`.

---

## Part B — Ebraheem and Karim: one-time setup (≈ 3 min)

1. Install **Git** (https://git-scm.com) and, optionally, **GitHub Desktop**.
2. Set your identity (the e-mail of **your** GitHub account, or GitHub won't count the commits as yours):
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "the-email-of-your-github-account"
   ```
3. Accept Zeyad's collaborator invitation.

---

## Part C — Ebraheem and Karim: your branch in the team repository (≈ 10 min)

Start after Zeyad's pull request is merged.

```bash
cd /d/
git clone https://github.com/Zeyad99Ahmed/supplier-evaluation-system.git
cd supplier-evaluation-system
git checkout -b ebraheem                  # Karim: git checkout -b karim
```

Right-click `<Name>_team_repo_files.zip` → *Extract All…* → choose this `supplier-evaluation-system` folder and allow it to merge folders. Then:

```bash
git status                                # only your folders/files appear as new
node scripts/secret-scan.js               # must print 0 finding(s)
```

**Ebraheem**:

```bash
git add services/order-service
git commit -m "Order Service: purchase orders with supplier eligibility, EGP conversion, contract limit and approval threshold"
git add frontend/pages/orders.body.html frontend/orders.html frontend/js/orders.js
git commit -m "Orders page: live EGP preview, filters, approval and delivery actions, history, spending summary"
git add infra scripts/package-lambda.js
git commit -m "Floci deployment: compose, least-privilege IAM policies, per-service Lambda/API Gateway/Secrets deploy, S3 website, smoke check"
git add tests/lambda-handler.test.js tests/lib.js tests/run-all.js
git commit -m "Tests: packaged Lambda tests, functional/integration/security test suite"
git add scripts/capture-screenshots.js scripts/capture-api-evidence.js scripts/lib/api-evidence.js scripts/record-demo.js scripts/package-handover.js docs/DOCKER_FLOCI_SETUP.md docs/RECOVERY.md docs/floci-deploy.log docs/deploy-dry-run.log
git commit -m "Deployment evidence tools, demo video recorder, Floci setup and recovery docs, deploy logs"
git add docs/report evidence
git commit -m "Final report and test/monitoring evidence"
git status                                # nothing to commit, working tree clean
git push -u origin ebraheem
```

**Karim**:

```bash
git add database scripts/db-setup.js
git commit -m "Database: one schema and login role per service, least-privilege grants, setup script"
git add services/evaluation-service
git commit -m "Evaluation Service: ratings for delivered orders, performance report, comparison, ExchangeRate API conversion"
git add frontend/pages/evaluations.body.html frontend/evaluations.html frontend/js/evaluations.js
git commit -m "Evaluations page: rating form, edit/delete own rating, history, comparison, currency converter"
git add tests/resilience.test.js
git commit -m "Resilience tests: provider outage, invalid response, stale cache, Evaluation Service down"
git add scripts/seed-demo.js scripts/render-diagrams.js docs/diagrams
git commit -m "Demo data seeding through the APIs, architecture and ER diagrams"
git status                                # nothing to commit, working tree clean
git push -u origin karim
```

If `git push` asks you to sign in, choose **Sign in with your browser** with your own account.

Then github.com → **Compare & pull request** → base **main**, compare your branch → a teammate approves it → **Merge pull request**. **Keep the branch.**

Merge order: Zeyad → Karim → Ebraheem. Ebraheem's branch carries the report and evidence, so it goes last.

---

## Part D — Everyone: your personal repository (≈ 5 min)

1. Right-click your `<Name>_personal_repo.zip` → *Extract All…* → to `D:\`. It creates `D:\ses-supplier-service-zeyad`, `D:\ses-order-service-ebraheem` or `D:\ses-evaluation-service-karim`, holding your component, a README and a `.gitignore`. There are no secret files in it.
2. In Git Bash:
   ```bash
   cd /d/ses-supplier-service-zeyad            # Ebraheem: /d/ses-order-service-ebraheem   Karim: /d/ses-evaluation-service-karim
   git init -b main
   git add README.md .gitignore .gitattributes
   git commit -m "README: owned component, functions, security controls and link to the team repository"
   git add services
   git commit -m "Owned service source code"
   git add .
   git commit -m "Owned frontend page and supporting scripts"
   git status                                  # nothing to commit, working tree clean
   ```
3. GitHub Desktop → *File* → **Add local repository** → that folder → **Publish repository**, untick **Keep this code private** → **Publish**.
4. Send the link to Ebraheem (for the report, Part E).

---

## Part E — Ebraheem: final links in the report (≈ 2 min)

After all repositories exist and the video is uploaded, edit `docs/report/links.json` in your clone:

```json
{
  "repo": "https://github.com/Zeyad99Ahmed/supplier-evaluation-system",
  "video": "https://youtu.be/<id>  (or the Google Drive link)",
  "personalRepos": {
    "zeyad": "https://github.com/Zeyad99Ahmed/ses-supplier-service-zeyad",
    "ebraheem": "https://github.com/<ebraheem-username>/ses-order-service-ebraheem",
    "karim": "https://github.com/<karim-username>/ses-evaluation-service-karim"
  }
}
```

Then:

```bash
npm install                 # first time only
npm run report              # rebuilds docs/report/Group26_Final_Report.docx
git add docs/report && git commit -m "Report: final repository and video links" && git push
```

Merge that small change with a pull request, and use this rebuilt .docx for the e-learning submission.

---

## Part F — Zeyad: upload the demo video (≈ 5 min)

File: `D:\cloud\SUBMISSION\Group26_Demo_Video.mp4`. It runs 4 min 13 s, was recorded on the Floci deployment, and has captions only, no voice.

- **YouTube**: **Create** → **Upload video** → Visibility **Unlisted** → **Save** → copy the link.
- **or Google Drive**: upload → **Share** → *General access*: **Anyone with the link** (Viewer) → **Copy link**.

Check that the link plays in a private/incognito window.

---

## Part G — Final checklist

- [ ] Old repositories deleted (Part 0), new team repository **public** and opens in an incognito window.
- [ ] Branches **zeyad**, **ebraheem**, **karim** exist, each with commits by that member (*Insights → Contributors*).
- [ ] Three **merged** pull requests, each approved by another member; branches kept.
- [ ] Three **public personal repositories**.
- [ ] `node scripts/secret-scan.js` → 0 findings; no `.env`, `.env.local` or `infra/.env.floci` file in any repository.
- [ ] Video link works in incognito; length ≤ 5 minutes.
- [ ] Report rebuilt with the final links (Part E).
- [ ] On e-learning: the report (.docx), the team repository link and the video link.
- [ ] All three members attend the live demonstration (absence = 0%).

## If something goes wrong

| Problem | Fix |
|---|---|
| Commits not linked to your GitHub profile | `git config --global user.email` must be your GitHub e-mail; set it, then make new commits |
| "Repository name already exists" when publishing | Part 0 wasn't finished: delete the old repository first |
| `git push` rejected (non-fast-forward) | `git pull --rebase origin <your-branch>`, then push again |
| Committed a file that is not yours (not pushed yet) | `git reset --soft HEAD~1`, then `git restore --staged <file>`, then commit again |
| A secret file was staged | `git restore --staged <file>`; if it was **pushed**, change (rotate) that secret and tell the team |
