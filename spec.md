# Argo

_Version May 2023 DRAFT_.
_Compatible with [GraphQL October 2021 Edition](https://spec.graphql.org/October2021)._

Argo is a compact, streamable, binary serialization format for [GraphQL](https://graphql.org).

Argo aims to:

- **Minimize end-to-end latency** of GraphQL responses
  - Including serialization, transport, and deserialization
- **Minimize bytes on the wire**, with and without external compression
- Be **easy to implement**

Argo\:

- Takes the place of JSON in GraphQL responses
- Usually meets the needs of mobile clients (and server clients) better than web clients
- Works best with code generation, but also works well with interpretation
- Does not currently support GraphQL Input types

** Notes (TODO: remove) **

hmm... i added in null bitmasks for objects, and it made things a tad worse. trying coalescing null markers and bit masks... still have a problem with error vs. absent vs. null.

- idea: use Label before double to represent length of 0s to pad with. due to json/js, many doubles are actually smallish ints, which in ieee754 means leading w/ 0-bytes. might work out on average, esp. since 0 takes 1 byte (iirc).
- Idea: Compact Paths to values to represent errors. A series of tags.
  - If errors inlined, path up to propagation stop is implicit. The path from there down into any initiating non-nullable field would need to be explicit though, need to account for
- need to handle input vs output types: arguments in particular
  - First version: output types only?
- i32, i64 are useful. but what about just a fixed length byte block in general? could represent that in the type system as well.
- idea: null collapsing. nullable fields would normally start w/ a zero byte if null, 1 otherwise. for enum & union types, this could be collapsed into just the length, if we never used 0 in the type of an enum or union. is that worth it?
- idea: we could explicitly mark values which have backrefs inline by using negative identifiers the first time. however, this would make encoding two-pass.
- Idea. Directive on an object type or fragment to mark it as likely to repeat. Then both sides can keep back refs to it as elsewhere. This is free for nullable and unions, but need an extra byte for non nullable objects. I guess valid on custom scalars.
- Idea: default values, should they have an implicit ref Identifier?
- Document: defend against invalid back references (too low ids)
- Document: limit read length allocations which exceed content size (if known) or a configurable limit, default 64MB
- Idea: default backrefs for common strings: `__typename`, message, id, locations, line, column, path?
- Problem: error extensions assumes self-describing format. so need to define that too
- Idea: never backref empty string? or more generally, when encoding, check if backref length + value <= backref id size. may also combine w: -1 backref = empty string, which avoids separate representations of null + empty string, and can use a single reflen instead
- Idea: as an optional flag, could return error extensions as a json string. this prevents the need for a custom decoder.
- Question: can errors have entries that don't correspond to places in the response? If so need to figure out how to encode. nope, spec doesn't allow it
- Todo: interfaces?
- problem: write label even for nonnullable objects? or write presence label?

** Problems (TODO: remove) **

- Adding an enum: can't produce a reliable tag based on ordering, if the server adds a new enum value before the end, or removes one entirely
- TODO: make sure the bounds of using 64bit varint can encode all the enums etc. that we need
  TODO: JSON encoding. or, should it simply be a view on the binary encoding?
  Named because it sounds sort of like
- @encoding annotation isn't backwards compatible :(
- de-dup all objects as soon as one object type is marked? on the reader, i think you have to, on the writer, seems crazy? i don't see any way around it though, without a verbose communcation of which types opted in... maybe we could do query-only, and ignore schema annotations? kinda anoying too
- TODO: where to interfaces fit in? kinda just tagged selection sets

** Introduction **

This document defines Argo.
It is intended to be the authoritative specification.
Implementations of Argo must adhere to this document.

Design notes and motivations are included, but do not specify necessary technical details.

# Motivation

GraphQL typically serialzes data into JSON, but GraphQL is designed to support other serializations as well.
Argo is purpose-made to improve on serialization for GraphQL.

## JSON

JSON is the standard serialization for GraphQL data.
It has many strengths as well as a few weaknesses.

**Strengths of JSON:**

- Ubiquitous
  - Many stable, high-performance implementations
  - High quality tools for working with JSON
- Self-describing (simple and usable even without tools)
  - Independent of GraphQL schemas, documents, queries, and types
- Human-readable and machine-readable

**Weaknesses of JSON:**

- Large data representation (relative to binary formats)
  - Repetitive data format (e.g. field names) leads to large uncompressed sizes
  - Self-delimited self-describing data uses additional space
- Limited data type availability
  - Byte string data must be "stuffed" into Unicode strings
  - 64-bit integers don't work reliabily across all platforms
  - "Stuffing" other types into e.g. String can introduce inefficiencies

## Tradeoffs

**In most cases JSON is a great choice for GraphQL.**
However, it can be difficult to address the weaknesses.
Primarily, these are related to performance: reducing the size of payloads, and reading and writing them quickly.

The value of reading and writing data quickly is self-evident.
The benefits of reduced payload sizes can be somewhat more subtle:

- Decreased latency across the stack
  - Most importantly, over the network
    - [TCP Slow Start](https://developer.mozilla.org/en-US/docs/Glossary/TCP_slow_start), [QUIC Slow Start](https://www.rfc-editor.org/rfc/rfc9002.html#name-slow-start), and other congestion control mechanisms mean larger first response payloads can significantly increase user-observed latency (especially on app open)
    - Dropped and retried packets are more likely with larger responses, especially over unreliable mobile connections
    - Smaller payloads transfer more quickly
  - Time spent serializing, deserializing, and copying around data
  - Time spent cleaning up data, such as garbage collection
- Increased I/O throughput across the stack

## Argo

To address the aforementioned weaknesses, Argo makes a different set of tradeoffs than JSON.

**Strengths of Argo:**

- Compact binary format
  - Not self-describing: relies on GraphQL types instead
- Unusually compressible
  - Stores data of the same type in blocks to assist compression algorithms, e.g. all Strings are stored together
- Maximizes re-use
  - Deduplicates repeated values, so deserializing and converting to required types happens once
- Flexible type availability
  - GraphQL scalars specify their encoding/decoding with a directive
  - Supports all GraphQL types
  - Also natively supports:
    - Variable-length byte strings
    - Fixed-length byte strings
    - Variable-length integers
- Simple to implement relative to other binary formats (e.g. protobuf, Thrift, Avro)

**Weaknesses of Argo:**

- As of toady, reference implementation only
  - No stable, high-performance implementations
- Almost no tools for debugging or analysis
- Binary format which is not self-describing
  - Relatively difficult to debug or analyze without tools
  - Requires GraphQL schema and query be known
- Input types not supported
  - Simpler implementation, but JSON still needed

## Recommendation

Overall, **JSON is the best choice for most GraphQL deployments.**
However, Argo is a good choice for systems where performance is paramount.
Please consider the tradeoffs above.

# Overview

Argo is designed to work with GraphQL queries and schemas which are known in advance,
but executed many times.
It separates its work into two phases: _Registration Time_ and _Execution Time._

:: _Registration Time_ happens once, before a payload is serialized with Argo.
On a mobile client, Registration Time is typically compile time.
On a server, Registration Time is typically when a query is registered by a client application (perhaps at its compile time).

:: _Execution Time_ happens many times, whenever a payload is \[de]serialized with Argo.
This relies on information generated during Registration Time.

Note: Nothing prevents running Registration Time and Execution Time steps at Execution Time.
However, this is a low-performance pattern, and is most likely only useful during development.

## Argo actions at Registration Time

Argo is designed to work with GraphQL queries and schemas which are known in advance.
It generates a description of the types which may be returned by a query (one time),
and uses this to serialize or deserialize (many times).
This description is called a _wire schema_.

A wire schema is generated by the following high-level algorithm.

### Registration time algorithm

Given a GraphQL `schema`, and a GraphQL `query` on it:

ArgoAlgorithm(schema, query) :

1. Walk over the `schema` to get each type. At each `type`:

   - Produce a corresponding [wire type](#sec-Wire-types), accounting for any `@ArgoCodec` or `@ArgoDeduplicate` directives

2. Store the resulting _wire schema_
3. Walk over the `query` to get the type of everything selected. At each selection, look up the corresponding wire type in the wire schema produced above:

   - For each selection set, produce a new wire type which is a subset of the selected object `type`s
   - For leaf selections, copy the corresponding wire type

4. Return the `wire schema`

## Argo actions at Execution Time

TODO

# Types

GraphQL uses two type systems: _GraphQL types_, which may appear in any given GraphQL Schema, and _response types_, which are used when serializing responses.
Argo introduces a third, called _wire types_, used when \[de]serializing to or from byte streams.
Internally, Argo uses a fourth, called _self-describing types_, primarily used when \[de]serializing errors.

## GraphQL types

:: _GraphQL types_ refers to the [types defined in the GraphQL spec](https://spec.graphql.org/October2021/#sec-Types). Briefly, these are:

- `Scalar`, `Enum`, `Object`, `Input Object`, `Interface`, `Union`, `List`
- Scalar includes, at minimum: `Int`, `Float`, `String`, `Boolean`, `ID`

GraphQL also allows for [custom scalars](https://spec.graphql.org/October2021/#sec-Scalars.Custom-Scalars).
Argo supports this, though a `@ArgoCodec` directive is required to tell Argo how to represent it on the wire.

## Response types

:: _Response types_ refers to the [serialization types sketched in the GraphQL spec](https://spec.graphql.org/October2021/#sec-Serialization-Format).
These do not have rigorous definitions in the GraphQL spec. These include (but are not limited to):

- `Map`, `List`, `String`, `Null`
- Optionally, `Boolean`, `Int`, `Float`, and `Enum Value`

## Wire types

:: _Wire types_ are used by Argo to encode GraphQL values as bytes.

- `STRING`: a UTF-8 string
- `BOOLEAN`: true or false
- `VARINT`: a variable-length integer
- `FLOAT64`: an IEEE 754 double-precision binary floating-point (binary64)
- `BYTES`: a variable-length byte string
- `FIXED`: a fixed-length byte string
- `RECORD`: an object, made up of potentially-omittable named fields and their values
- `ARRAY`: a variable-length list of a single type
- `BLOCK`: describes how to store the underlying type in a block of value data
- `NULLABLE`: may be null or have a value
- `DESC`: a self-describing type

### Self-describing types

:: _Self-describing types_ are used by Argo to encode values with types which are not known in advance (e.g. at Registration Time).
Primarily, this is required to comply with the [GraphQL specification on Errors](https://spec.graphql.org/October2021/#sec-Errors).

- `Absent`: marks that a value is not present (like `undefined` in JSON)
- `Null`: marks that a value is not present (like `null` in JSON)
- `Object`: an object, made up of named fields and their values
- `String`: a UTF-8 string
- `Boolean`: true or false
- `Int`: a variable-length integer
- `Float`: an IEEE 754 double-precision binary floating-point (binary64)
- `List`: a variable-length list of (potentially) mixed types

# Wire schema

:: GraphQL uses a Schema to capture the names and types of data.
GraphQL queries select a portion of data from that Schema.
Given a Schema and a query on it, Argo produces a _wire schema_ with all the information needed to [de]serialize data powering that query against a compatible GraphQL Schema.

Note: In a client-server architecture, GraphQL schemas frequently change on the server according to certain compatibility rules.
Therefore, while Argo _cannot_ assume the Schema used for serializing data is the Schema used for deserializing,
it _does_ assume they are compatible with each other (i.e. no [breaking changes](https://spec.graphql.org/October2021/#sel-EALJDCAgICCAogH) have been made).

The wire schema

Idea: take SDL, possibly with some directives such an @encode("fixed64") or @encode("string"). Also take a query, possibly with directives. Transform this into a wire schema. Use the wire schema to generate a codec.

A Schema is represented in JSON by one of:

- A JSON string, naming a defined type.
- A JSON object, of the form: `{"type": "typeName" ...attributes...}` where typeName is either a primitive or derived type name, as defined below. Attributes not defined in this document are permitted as metadata, but must not affect the format of serialized data.
- A JSON array, representing a union of embedded types.

Primitive Types
The set of primitive type names is taken from the GraphQL spec.

- null: no value
- boolean: a binary value
- int: 32-bit signed integer
- float: double precision (64-bit) IEEE 754 floating-point number
- bytes: sequence of 8-bit unsigned bytes
- string: utf8 character sequence
  Primitive types have no specified attributes.
  Primitive type names are also defined type names. Thus, for example, the schema "string" is equivalent to:
  `{"type": "string"}`

# Binary encoding

Argo's binary encoding does not include field names, self-contained information about the types of individual bytes, nor field or record separators. Therefore readers are wholly reliant on the wire schema used when the data was encoded (or any compatible wire schema), along with any information about custom scalar encodings.

## Message

TODO: flags, then values etc,

### Flags

noBlocks

Every response starts with a flags byte. From most to least significant bits:
0: 1 if big-endian, 0 if little-endian
1: 1 if backreferences may be used for string values in this message, else 0
2: 1 if backreferences may be used for object values in this message, else 0
3: 1 if backreferences may be used for array values in this message, else 0
...

Note that backreferences are always enabled for enum values.

### Primitive Types

Primitive types are encoded in binary as follows:

- `Null` is written as zero bytes
- `Int`, `Boolean`, and `LABEL` values are written using variable-length zig-zag coding. For `Boolean`, 0 is false and 1 is true.
- `Float` is written as `FIXED64`, a fixed-length 8-byte little-endian, same as `memcpy` of equivalent C type `int64_t`
- `String`, `ID`, `Enum`, and custom scalars barked as `BLOCK` are encoded as `BLOCK`. `BLOCK` is encoded as a `LABEL`, possibly followed by data. If a backreference is being used, or if the value is `Null` or an error, the `LABEL` must be written according to the corresponding [Label encoding](#sec-LABELs). Otherwise, the `LABEL` specifies how many bytes of data follow for this value. It is then immediately followed by the bytes of the value. `String`, `ID`, and `Enum` data bytes MUST be UTF-8 encoded.
- `Union`, interfaces, unions are represented as `VARIANT`. `VARIANT` is a `LABEL` where each member is numbered and identified by its order of appearance in the query (starting at 0), followed by corresponding object encoded as usual.
- Interfaces? same as objects?

## LABELs

Argo uses a multipurpose binary marker called a `LABEL` which combines several use cases into one representation.
A `LABEL` is written using variable-length zig-zag coding.
A `LABEL` is essentially a number which should be interpreted differently according to its value.

Non-negative numbers >= 0 are interpreted one of two ways depending on context.

For variable-length data, such as a string or list, it represents the length of the data that is to follow. The units depend on the data: string lengths are in bytes, while list lengths are in entries.

Non-negative numbers are also used to mark which member of a union selection is to follow. These are numbered starting at 0 and counting up.

Argo reserves a few special negative values for certain purposes:

1. -1 represents a `null` value, particularly for fields
2. -2 represents an error

:: All other negative numbers are used for _backreferences_.
Backreferences are identification numbers which refer to values which appeared previously in the response. See [Backreferences](#sec-Backreferences) for more.

Note that `String` pre-fills certain backreference IDs.

TODO: spell out bootstrap values for strings

1. Marking the length of a byte sequence

## Backreferences

Argo reduces data size on the wire by avoiding repeated values. Whenever a potentially-large value is read or written for the first time, it is stored in an array and given the next available backreference ID number (which is always negative). When it is next used, it can be identified by the backreference ID, eliminating the need to send the entire value again.

Note: This is similar to how lossless compression algorithms use a [Huffman coding](https://en.wikipedia.org/wiki/Huffman_coding), but simpler and less effective. The upshot is that Argo representations can remain small even after decompression, in contrast to JSON.

### Write-side

On the write-side, backreferences SHOULD be supported.

:: Before writing a response, a writer SHOULD create several lists (called _memo lists_, one for each type which is eligible for backreferences (see below). Then, the array for `String`s should insert the bootstrap values (see below), [TODO: and lists for all types with defaults should insert their defaults? does this break schema evolution?]. Memo lists are indexed by backreference ID, starting at -3 (the first non-reserved value) and counting down.

Algorithm: Whenever a type which supports backreferences is to be written, the writer MAY first look for an identical value in the corresponding memo list. If it finds a value, it MAY write out the backreference ID in lieu of the value as usual. If it does not, or if it chooses not to (perhaps for simplicity), it writes out the full value as usual (all types which support backreferences begin with a `LABEL`). If it did not write out a backreference, it MUST increment the highest backreference ID for the corresponding type, typically by inserting the value into the memo list.

The writer MAY choose to write out full values when their representation is smaller than the backreference ID representation.

Note: Backreference IDs are not unique across types: a backreference ID -5 refers to a different value for `String` than it does for `Enum`.

### Read-side

On the read-side, backreferences MUST be supported.

:: Before reading a response, a writer MUST create several lists (called _memo lists_, one for each type which is eligible for backreferences (see below). Then, the array for `String`s should insert the bootstrap values (see below), [TODO: and lists for all types with defaults should insert their defaults? does this break schema evolution?]. Memo lists are indexed by backreference ID, starting at -3 (the first non-reserved value) and counting down.

Algorithm: Whenever a type which supports backreferences is to be read, the reader will first read a `LABEL` (see [Labels](#sec-Labels) for details). If the label is a length (and will therefore be followed by a normal value), the value should be read as usual, then stored in the corresponding memo list according to its type and be given the next backreference ID. If the label is instead a backreference, the reader MUST look up the value in the corresponding type's memo list using the ID and yield that value.

### Types which support backreferences

In order to maintain a compact data representation, backreferences are only supported for certain types:

- Supported: `Enum`, `Object`, `Input Object`, `Interface`, `Union`, `List`, `String`, `ID`. Nullable `Int` and `Float` also support backreferences, even though their non-nullable counterparts do not.
- Unsupported: `Int`, `Float`, `Boolean`

TODO: should we support them for optional fields? mayhap

### Disabling backreferences for a given type in a message

While many types support backreferences, checking for equality in the writer can increase serialization costs without reducing response sizes. Writers MAY therefore choose not to de-duplicate data using backreferences, and they SHOULD communicate these choices to readers using [Message flags](#sec-Message-flags). Writers MAY also mark these features as unused in response flags whenever they chose not to for a given response, though this may require serializing most of the message first.

By default, we recommend enabling backreference-based deduplication _only_ for the following types in the writer:

- `String`, `ID`, and `Enum` (all strongly recommended)
- Any type marked with the `@deduplicate` directive in the schema or query

## Complex types

## Nullable types

TODO: lenref. -1 value means null, -2 means error. other negatives = backrefs, other non-negatives = length, if that makes sense. the upshot is lengths don't need to be repeated if required. because of this, all lenrefs should probably reserve -1, -2.

## Objects

An object (technically, a _selection set_) is encoded by encoding the values of its selected fields in the order that they are selected in a query. In other words, an object is encoded as just the concatenation of the encodings of its selected fields. Field values are encoded per their schema.
For example, the query:

```graphql example
type Test {
  a: Int
  b: String
  c: ID
}
query {
  test {
    a
    b
  }
}
```

An instance of this record whose a field has value 27 (encoded as hex 36) and whose b field has value "foo" (encoded as hex bytes 06 66 6f 6f), would be encoded simply as the concatenation of these, namely the hex byte sequence:
36 06 66 6f 6f

## Enums

An enum is represented exactly as a string (or due to the lenref, a reference to a previous string).

Backreferences are always used for enums (i.e. there is no header flag to skip this feature). All enums share the same backreference ID space.

Note: you might expect an integer representation for enums. Unfortunately, we cannot guarantee the writer's view of the enum type matches the reader's, because the schema may have changed: in the writer's schema, if an enum value has been added before the end, or an enum value has been removed, the reader and writer do not have enough information to agree on the correct numbering.

## Lists

Lists are encoded as a series of blocks. Each block consists of a lenref, followed by that many array items. A block with count zero indicates the end of the array. Each item is encoded per the array's item schema.
The blocked representation permits one to read and write arrays without first fully beffering in memory, since one can start writing items without knowing the full length of the array.

## Unions

A union is encoded by first writing an int value indicating the 0-based position within the union of the schema of its value. The value is then encoded per the indicated schema within the union.
[question: should we reserve 0 for null, even in non-nullable types?]
For example, the union schema `["null","string"]` would encode:

- null as zero (the index of "null" in the union):
- the string "a" as one (the index of "string" in the union, encoded as hex 02), followed by the serialized string:02 02 61

## Fixed

Fixed instances are encoded using the number of bytes declared in the schema.

## Errors

Errors have a very special representation for two reasons:

1. Errors are inlined with data

- This makes them available for distinguishing between null and an error, and also makes their representation more compact.

2. The "extensions" portion of each errors object must be self-describing. This is in contrast to all other data: we don't know the schema/types of "extensions" data, and it may vary between objects.

- Note: this spec does not allow for direction extension to error objects outside of the extensions field, even though the GraphQL spec allows for (but discourages) it. This is on the grounds that it is very easy to recover this information by simply moving it to the extensions field when migrating to this data format, and it simplifies this spec.

Nullable fields are the only valid location for errors. See "Nullable fields" for details on how nullable fields may mark the presence of an error.

Error objects have this schema:

```graphql
type Location {
    line: Int!
  column: Int!
}
type Error {
    message: String!
  location: [Location!]
  path: [String | Int]
  extensions: ExtensionsMap
}
```

Note that path and extensions are not representable as normal GraphQL responses:

1. path mixes String and Int primitive values, which GraphQL forbids for data
2. extensions must be a map, and has no other restrictions. Based on path's behavior (which violates GraphQL's typing rules), this seems to include values only representable in the transport layer (like JSON, or this spec). There is no information about the extensions map in the schema or any query.

Errors are encoded as an object with the schema above, ignoring the path and extensions fields.
Then, the representations of path and extensions are respectively concatenated after it.

Path is represented on the wire as a nullable array of unions with schema: ["string", "int"]. The reader's code generator may choose a helpful representation for this.

Extensions are more complex because they must be self-describing. They are encoded according to the following section.

Self-describing data for error extensions
Data in extensions must be a map. This is represented as an array of key value pairs, where all keys are strings, and values are self-describing.

Maps, a new data type, are allowed in extensions.
Maps are encoded as a series of blocks. Each block consists of a lenref value, followed by that many key/value pairs. A block with count zero indicates the end of the map.

- The blocked representation permits one to read and write maps larger than can be buffered in memory, since one can start writing items without knowing the full length of the map.

Each key is a string. Each value is a union with the following schema:
["Null", "String", "Int", "Boolean", "Float", "List", "Map"]
This tells us the type, which is then decoded as usual.
Before values of List are written, an additional union marker is written to indicate the type of all following values in the list. Therefore, all lists must be homogeneous.

Therefore, each key/value pair is written like this:
[key][value type][value]
where [key] is a string as serialized everywhere, [value type] is a lenref union marker (iff it marks a List, it is then followed by a second lenref union marker marking the value type).

# Design notes

- Argo is intended for use with code generation, where particular queries against a schema are known at code generation time, and a codec can be generated from this information. This is not often a great fit for web clients, but is great for native clients (or servers). Web clients would need to first download the codec, and a Javascript codec is unlikely to be as performant as `JSON.parse`. This could be worked around by supporting both and downloading the codec out-of-band, then upgrading from JSON to Argo. A codec in WASM might meet performance needs. A Argo interpreter (instead of a code-generated codec) might reduce the download size. Even so, the tradeoffs are unfavorable.
- Byte alignment (instead of bit or word alignment) was chosen primarily for ease of implementation (e.g. no need to pack together consecutive booleans) balanced against the resulting size. Most GraphQL responses are unlikely to majorly benefit from bit packing anyway, and the use cases which would are probably better off using a custom scalar binary representation.
- Null vs. present fields are marked with `LABEL` per-field instead of using a bitmask for an entire object. This is a tad easier to implement on both sides. Bitmasks for null and non-null values made payloads larger during development, and were backed out.
- Field Errors can be represented inline for a few reasons:
  - In a reader, after reading a field you are guaranteed to know whether there was an error or just a null [TODO: require inline error?]
  - We know most of the `path` in the current response from our location, and do not need to write most of it explicitly, saving space [TODO: do this?]
- Perhaps surprisingly, `Enum`s can't be safely represented as small numbers, since schema evolution rules allow for changes (e.g. reordering) which would alter the number on one side but not the other.

# Legal

## Copyright notice

Copyright © 2022, Michael Solomon

THESE MATERIALS ARE PROVIDED “AS IS.” The parties expressly disclaim any warranties (express, implied, or otherwise), including implied warranties of merchantability, non-infringement, fitness for a particular purpose, or title, related to the materials. The entire risk as to implementing or otherwise using the materials is assumed by the implementer and user. IN NO EVENT WILL THE PARTIES BE LIABLE TO ANY OTHER PARTY FOR LOST PROFITS OR ANY FORM OF INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF ANY CHARACTER FROM ANY CAUSES OF ACTION OF ANY KIND WITH RESPECT TO THIS DELIVERABLE OR ITS GOVERNING AGREEMENT, WHETHER BASED ON BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, AND WHETHER OR NOT THE OTHER MEMBER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## License

This specification is licensed under [OWFa 1.0](https://www.openwebfoundation.org/the-agreements/the-owf-1-0-agreements-granted-claims/owfa-1-0).

# Formal

## Conformance

A conforming implementation of Argo must fulfill all normative requirements. Conformance requirements are described in this document via both descriptive assertions and key words with clearly defined meanings.

The key words “MUST”, “MUST NOT”, “REQUIRED”, “SHALL”, “SHALL NOT”, “SHOULD”, “SHOULD NOT”, “RECOMMENDED”, “MAY”, and “OPTIONAL” in the normative portions of this document are to be interpreted as described in [IETF RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). These key words may appear in lowercase and still retain their meaning unless explicitly declared as non-normative.

A conforming implementation of Argo may provide additional functionality, but must not where explicitly disallowed or would otherwise result in non-conformance.

## Versioning

Argo is versioned using [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
Each version of Argo explicitly targets one version of the GraphQL spec, which is usually the latest at time of writing.

# Authors and contributors

Argo is authored by [Michael Solomon](https://msol.io).
