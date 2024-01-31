# ⛵ Argo

_Compatible with [GraphQL October 2021 Edition](https://spec.graphql.org/October2021)._ View [Argo on GitHub](https://github.com/msolomon/argo).

**Argo is a compact and compressible binary serialization format for** [GraphQL](https://graphql.org).
It aims to:

- **Minimize end-to-end latency** of GraphQL responses
  - Including serialization, transport, and deserialization
- **Minimize bytes on the wire**, with and without external compression
- Be **easy to implement**

Argo\:

- **Takes the place of JSON** in GraphQL responses
- Usually **meets the needs of mobile clients** (and server clients) better than web clients
- **Works best with code generation**, but also works well with interpretation
- Does not currently support [GraphQL Input types](#sec-GraphQL-input-types)

Compressed **Argo responses are typically 5%-15% smaller** than corresponding compressed JSON responses.

Uncompressed **Argo responses are typically 50-80% smaller** than corresponding JSON responses.

## Specification

Argo has a formal specification:

- [Version 1.1.x](https://msolomon.github.io/argo/versions/1.1/spec) (latest)
- [Version 1.0.x](https://msolomon.github.io/argo/versions/1.0/spec)

## Reference implementation

`argo-js` is a reference implementation of Argo in TypeScript,
and can be found in [this repository](https://github.com/msolomon/argo).
It is distributed on NPM under the name [argo-graphql](https://www.npmjs.com/package/argo-graphql).

## 3rd party implementations

These open-source implementations are maintained separately:

- Erlang: [erlang-argo](https://github.com/WhatsApp/erlang-argo) from WhatsApp

## Authors and contributors

Argo was created and authored by [Mike Solomon](https://msol.io).

A big Thank You to these fine folks who have contributed on GitHub!

- [Andrew Bennett](https://github.com/potatosalad)
- [Jimmy Bourassa](https://github.com/jbourassa)
