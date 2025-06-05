# ⛵ Argo GraphQL

`argo-graphql` is the reference implementation of [Argo](https://msolomon.github.io/argo/),
a compact and compressible binary serialization format for [GraphQL](https://graphql.org/).

It is written in TypeScript and distributed on NPM under the name
[argo-graphql](https://www.npmjs.com/package/argo-graphql).
The MIT-licensed source code is available on [GitHub](https://github.com/msolomon/argo/).

It includes a suite of test data that should be usable from other implementations (even in other languages).

Tests may be run with `npm test` or `yarn test`.


### Features

| Feature | Implemented? | Notes |
|---|---|---|
| [InlineEverything](https://msolomon.github.io/argo/spec#inlineeverything)           | ✅ | |
| [SelfDescribing](https://msolomon.github.io/argo/spec#selfdescribing)               | ✅ | |
| [OutOfBandFieldErrors](https://msolomon.github.io/argo/spec#outofbandfielderrors)   | ⚠️ | Inline field errors not supported |
| [SelfDescribingErrors](https://msolomon.github.io/argo/spec#selfdescribingerrors)   | ⚠️ | Non-self-describing not supported |
| [NullTerminatedStrings](https://msolomon.github.io/argo/spec#nullterminatedstrings) | ✅ | |
| [NoDeduplication](https://msolomon.github.io/argo/spec#nodeduplication)             | ✅ | |
| [HasUserFlags](https://msolomon.github.io/argo/spec#hasuserflags)                   | ✅ | No user flags implemented |

### Performance

As the reference implementation, clarity and simplicity are prioritized over performance.
Other implementations may wish to make different tradeoffs.
