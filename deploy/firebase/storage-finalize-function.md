# Firebase Storage Finalize Bridge

The storage finalize bridge logic lives in:
- `apps/api/src/bridges/storage-finalize-bridge.ts`
- `apps/api/src/functions/storage-finalize.ts`

Use the Firebase Functions runtime or an equivalent trusted ingress to invoke the bridge when Storage finalize events arrive.

Recommended wiring:
1. Validate the event payload with `StorageFinalizeEventSchema`.
2. Reuse the shared bridge handler to enqueue `ingest-orchestration`.
3. Keep the function short-lived and stateless.
4. Protect the deployment with Firebase project IAM and the existing API internal-token boundary where applicable.
