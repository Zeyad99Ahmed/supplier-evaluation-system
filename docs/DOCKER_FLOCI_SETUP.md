# Docker + Floci setup on this PC (Windows 10 Pro 19045)

Checked on this PC: CPU virtualization **enabled**, SLAT **yes**, RAM 7.7 GB, winget available.
Blockers found: **WSL 2 not installed** and **only ~2 GB free on C:** (D: has ~17 GB), so Docker is
installed with its program files and its data on **D:**.

These steps need administrator rights and one reboot, so they are done by you (not by a script).

## 1. Enable WSL 2 (admin PowerShell, then reboot)

```powershell
wsl --install --no-distribution
```

Reboot when asked. If the second "Installing" bar stays at 0% for a long time, the Windows feature is
already staged; close the window and reboot anyway. After the reboot install the WSL 2 kernel
(admin PowerShell, opened from the Start menu with "Run as administrator" so it is really elevated):

```powershell
wsl --update --web-download
```

Then check in a **new** window:

```powershell
wsl --version
```

If it prints "The file cannot be accessed by the system", re-register the package (admin PowerShell):

```powershell
Get-AppxPackage MicrosoftCorporationII.WindowsSubsystemForLinux | ForEach-Object { Add-AppxPackage -DisableDevelopmentMode -Register "$($_.InstallLocation)\AppxManifest.xml" }
```

## 2. Install Docker Desktop on D:

Download the installer from the official site (about 600 MB):
https://docs.docker.com/desktop/setup/install/windows-install/  ("Docker Desktop for Windows - x86_64")

Save it to `D:\Downloads`, then in an **admin** PowerShell:

```powershell
Start-Process -Wait -FilePath "D:\Downloads\Docker Desktop Installer.exe" -ArgumentList 'install','--accept-license','--backend=wsl-2','--installation-dir=D:\Docker\DockerDesktop','--wsl-default-data-root=D:\Docker\wsl'
```

Start **Docker Desktop**, wait for "Engine running", then check in a normal terminal:

```powershell
docker version
docker run --rm hello-world
```

Tip: in Docker Desktop > Settings > Resources, set Memory to about 4 GB (this PC has 7.7 GB).

## 3. Install the AWS CLI and the `floci` profile (as in the lab Quick Installation Guide)

```powershell
winget install -e --id Amazon.AWSCLI --location "D:\Tools\AWSCLIV2"
```

(On this PC it was installed to `D:\Tools\AWSCLIV2`; open a new terminal so `aws` is on the PATH.)

Open a new Git Bash window:

```bash
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
```

## 4. Start Floci + Postgres and deploy everything

In Git Bash, in the project folder. Floci must be up before the AWS CLI can answer, so start the
containers first (the first `deploy.sh` run also creates `infra/.env.floci` with random secrets):

```bash
export AWS_PROFILE=floci MSYS_NO_PATHCONV=1
PG_OWNER_PASSWORD=placeholder docker compose -f infra/floci/docker-compose.yml up -d floci
aws sts get-caller-identity --query Account --output text      # 000000000000
bash infra/deploy.sh all       # creates secrets file, starts Postgres, DB roles, 4 services, monitoring, website
bash infra/check-deploy.sh
```

(`PG_OWNER_PASSWORD=placeholder` is only needed so Compose can parse the file when starting Floci on
its own; Postgres itself is started by `deploy.sh` with the real generated password.)

Website: `http://localhost:4566/ses-web/index.html` · Floci Dash: `http://localhost:4566/_floci/ui`

Each student can redeploy only their own service:

```bash
bash infra/deploy.sh supplier-service     # Zeyad
bash infra/deploy.sh order-service        # Ebraheem
bash infra/deploy.sh evaluation-service   # Karim
```

## 5. Demo data and tests against the deployed system

```bash
set -a; source infra/floci-urls.env; source infra/.env.floci; set +a
node scripts/seed-demo.js
SITE_ORIGIN=http://localhost:4566 node tests/run-all.js     # writes evidence/test-results-deployed.md
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker: command not found` after install | Open a new terminal; Docker Desktop must be running |
| Lambda times out reaching the DB | `docker compose ... ps`: ses-postgres must be up; DB_HOST_FOR_LAMBDA=ses-postgres:5432 |
| Runtime not supported | `LAMBDA_RUNTIME=nodejs24.x bash infra/deploy.sh all` (or nodejs20.x) |
| `...localhost.floci.io` not found (no internet) | use `http://<api-id>.execute-api.localhost:4566` instead (Lab 7 tip) |
| Paths become `C:/Program Files/Git/...` | `export MSYS_NO_PATHCONV=1` |
