# node-sdk

Official ePay Business API SDKs for the JavaScript ecosystem.

Full API documentation: <https://docs.epayethiopia.com/>

| Package                            | What it is                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`@e-pay/node`](packages/node)     | The core client — Node 18+, Bun, Deno. Zero runtime dependencies, dual ESM/CJS, plus Express and Fetch/edge webhook handlers. |
| [`@e-pay/nestjs`](packages/nestjs) | A NestJS 10/11 module wrapping the core: dynamic module, injectable service, webhook guard, and param decorator.              |

These two ship together because `@e-pay/nestjs` depends on `@e-pay/node` and they
release in lockstep. The other ePay SDKs live in sibling projects — see the
[repository index](../README.md).

## Quick start

```sh
npm install @e-pay/node
```

```ts
import { Epay } from "@e-pay/node";

const epay = new Epay(); // reads EPAY_SECRET_KEY

const session = await epay.payments.initialize({
  amount: "250.00",
  currencyCode: "ETB",
  customerPhone: "+251911234567",
  merchantReference: "order_123",
});

redirect(session.checkoutUrl);
```

Full documentation lives in each package's README:
[`@e-pay/node`](packages/node/README.md) · [`@e-pay/nestjs`](packages/nestjs/README.md).

## Development

```sh
pnpm install
pnpm build         # dual ESM + CJS, in dependency order
pnpm test          # builds first, then runs both suites
pnpm check-types
pnpm format
```

Requires Node 24+ and pnpm 11+ to develop; the published packages themselves
support Node 18+.

`pnpm test` runs 101 tests across the two packages. They are hermetic — the
suites inject a fake `fetch` rather than reaching the network, so they need no
credentials and run offline.

### Layout

```
packages/
  node/     @e-pay/node     the core client
  nestjs/   @e-pay/nestjs   depends on ../node via workspace:^
```

Turborepo handles ordering: `@e-pay/node` builds before `@e-pay/nestjs`
type-checks or tests against it.

Tests run against the built output in `dist/`, not `src/`, so they exercise
exactly what gets published.

## Releasing

CI runs on every push and pull request: build, type-check, and the suites on
Node 20/22/24, plus a packaging job that installs the built tarball into a clean
project and imports it through both CJS and ESM.

One-time setup:

1. Create a **granular access token** at npmjs.com → Access Tokens, scoped to
   read/write on the `e-pay` organization.
2. Add it as the repository secret `NPM_TOKEN`.
3. Create a GitHub environment named `release` (Settings → Environments). Add
   required reviewers if you want a manual approval gate before publishing.

To release:

```sh
# Bump both packages to the same version first.
npm version 0.2.0 --workspaces --no-git-tag-version   # or edit by hand
git commit -am "release: v0.2.0"
git tag v0.2.0 && git push --follow-tags
```

The tag triggers `release.yml`, which rebuilds, re-tests, verifies the tag
matches **both** package versions, then publishes `@e-pay/node` followed by
`@e-pay/nestjs` — in that order, since the second depends on the first.

Publishing uses `--provenance`, which attests the artifacts were built by that
workflow from that commit. It requires a **public** repository; drop the flag if
the repo is private.

To rehearse without publishing, run the workflow manually with `dry_run` left
checked.

## License

MIT
