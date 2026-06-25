# Staging Drill and Rollback Checklist

Use this checklist for P0.4 before production cutover.

## Preconditions

- Provisioning complete (`deploy/gcp-provision.sh`)
- Deploy complete (`deploy/gcp-deploy.sh`)
- Internal token secret is set to a strong non-placeholder value
- Monitoring alerts are applied (`deploy/gcp-monitoring-setup.sh`)

## Drill steps

1. Confirm services are healthy:
   - `gcloud run services list --region=$GCP_REGION | grep stream-forge`
2. Upload a test video and verify final `ready` status.
3. Capture baseline metrics:
   - `/metrics` scrape from API
   - `/internal/metrics` with internal token and operator role
4. Induce a failure:
   - Trigger `/internal/workers/failure/run-once` for a staging test video at `metadata` stage
5. Verify failure handling:
   - Video enters `failed`
   - `ProcessingFailed` event exists
6. Replay from DLQ:
   - Trigger `/internal/dlq/replay`
7. Verify recovery:
   - Video returns to `ready`
   - Pipeline success/failure metrics update as expected
8. Perform rollback rehearsal:
   - Shift traffic to previous Cloud Run revision for API service
   - Verify health and endpoint behavior
   - Return traffic to latest revision
9. Record outcomes and operator sign-off.

## Evidence to capture

- Command output for each service health check
- Relevant API and worker log excerpts
- Screenshot/export of Cloud Monitoring dashboard
- Alert policy list output
- Rollback and restore command history

## Exit criteria

- All steps pass without manual data repair
- Replay and rollback complete within expected SLO window
- No unresolved alerts after test completion
- Operations owner signs off
