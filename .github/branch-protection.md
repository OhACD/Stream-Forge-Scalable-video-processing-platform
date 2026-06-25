# Branch Protection Baseline (V1)

Use this baseline for the `main` branch.

## Required GitHub settings

1. Require a pull request before merging.
2. Require approvals (minimum 1).
3. Require approval of the most recent reviewable push.
4. Require conversation resolution before merging.
5. Require status checks to pass before merging.
6. Require branches to be up to date before merging.
7. Restrict who can push to matching branches (admins/release managers only).

## Required status checks

Add these exact check names:

- Build and Typecheck
- API Acceptance

Enable this check later when deployment work resumes:

- Validate Deploy Assets

## Optional hardening

- Require signed commits.
- Require linear history.
- Include administrators under branch protection.

## Notes

- Check names come from job names in workflows under `.github/workflows/`.
- If a check name changes in workflow YAML, update branch protection accordingly.
- Keep this file in sync with `README.md` CI and branch protection sections.
