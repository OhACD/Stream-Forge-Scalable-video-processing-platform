# Deployment Artifacts

This folder contains deployment scripts, manifests, and operational checklists.

## Main files

- `gcp-provision.sh`: creates infra and secrets
- `gcp-deploy.sh`: builds image and deploys API + workers
- `gcp-monitoring-setup.sh`: applies baseline alert policies
- `cloudrun/`: Cloud Run service manifests
- `RUNBOOK.md`: detailed operations and troubleshooting
- `ENVIRONMENT_SECRET_MATRIX.md`: environment/secret contract
- `STAGING_DRILL_CHECKLIST.md`: staging and rollback rehearsal checklist

## Recommended flow

1. Provision: `./deploy/gcp-provision.sh`
2. Deploy: `./deploy/gcp-deploy.sh`
3. Monitoring: `./deploy/gcp-monitoring-setup.sh`
4. Drill: execute `deploy/STAGING_DRILL_CHECKLIST.md`

For the concise project-level deployment guide, see `DEPLOYMENT.md` in the repository root.
