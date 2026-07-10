# medlynq-rx v1 (legacy, plain JS)

This is the version currently live at https://medlynq-rx.azurewebsites.net, deployed via
`deploy/deploy-rx.sh`. That script expects a `medlynq-rx/` folder at the repo root — it was
never actually committed to this repo before now (deploys were run from a local, untracked
copy). This folder preserves that code so the deploy script has a real source of truth.

Superseded by the TypeScript rewrite at `../rx/` — see that folder's README for what's
different and what it'd take to cut the live App Service over to it.
