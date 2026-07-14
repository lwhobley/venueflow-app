# desktop-web deployment & the API

**This branch deploys the web frontend only.** Read this before changing
anything under `packages/api/` here.

## What actually deploys from `desktop-web`

`.github/workflows/deploy-cloudflare-pages.yml` builds and deploys **only** the
web bundle to Cloudflare Pages:

- `site/` → served at `/`
- `app/`, `components/`, `lib/`, `assets/` → exported by `expo export` and served at `/app`

The build bakes in `EXPO_PUBLIC_API_URL = https://venue-wranglerapi-production.up.railway.app/api`.

## The API is NOT deployed from this branch

The production API is deployed by **Railway from `main`** (API CI in
`.github/workflows/api-ci.yml` runs on `main` only). The web app served from
`desktop-web` therefore talks to **main's API**, not to the `packages/api` tree
on this branch.

Consequences:

- **`packages/api/` on `desktop-web` is not deployed.** It is stale relative to
  `main` and should be treated as reference/dead code. Do not "fix" a backend
  bug here expecting it to reach production — fix it on `main`.
- Because the web app runs against **main's** API, the frontend on this branch
  must stay contract-compatible with main. When main changes a request/response
  shape (e.g. the staff-request `timeCorrection` field, or the 8-char password
  minimum), the corresponding **frontend** change must be ported here or the web
  app breaks even though nothing "in this branch's API" changed.

## Keeping drift under control

- Frontend fixes that land on `main` (`app/`, `components/`, `lib/`) should be
  cherry-picked/ported to `desktop-web`.
- `Desktop Web CI` (`.github/workflows/desktop-web-ci.yml`) typechecks the web
  app on every push so type-level drift is caught before deploy. It does not
  test API contracts — a contract change on main that keeps types valid can
  still break at runtime, so port frontend changes deliberately.

## To verify (not provable from the repo)

- Confirm in the **Railway dashboard** that the API service tracks **`main`**.
  `railway.toml` is identical on both branches and defines a full API build, so
  if Railway were ever pointed at `desktop-web`, every backend hardening commit
  missing from this branch would become a live production gap. This is the one
  assumption the rest of this note depends on.
