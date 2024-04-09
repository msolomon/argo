# ⛵ Argo

_Version 1.1.3_.
_Compatible with [GraphQL October 2021 Edition](https://spec.graphql.org/October2021)._

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

** Introduction **

This document defines Argo.
It is intended to be the authoritative specification.
Implementations of Argo must adhere to this document.

[Design notes](#sec-Appendix-Design-notes) and [motivations](#sec-Appendix-Motivation-and-background) are included,
but these sections do not specify necessary technical details.

# Overview

Argo is designed to work with GraphQL queries and schemas which are known in advance, but executed many times.

In advance, Argo walks over a given GraphQL query against a particular GraphQL schema and generates a _Wire schema_ which captures type and serialization information which will be used when \[de]serializing a response. Later, when serializing a GraphQL response, Argo relies on this and does not need to send this information over the network--this reduces the payload size. Similarly when deserializing, each client relies on the Wire schema to read the message.

The serialization format itself is a compact binary format which uses techniques to minimize the payload size,
make it unusually compressible (to further reduce the payload size over the network),
permit high-performance implementations,
and remain relatively simple. These techniques include:

- Scalar values are written into contiguous blocks to improve their compressibility
- Many scalar values are deduplicated
- Many scalars (particularly strings and byte strings) permit zero-copy implementations
- Integers are written in a compact variable-length format

Argo separates its work into two phases: _Registration Time_ and _Execution Time._

:: _Registration Time_ happens once, before a payload is serialized with Argo.
On a mobile client, Registration Time is typically compile time.
On a server, Registration Time is typically when a query is registered by a client application (perhaps whenever a new client version is compiled).

At Registration Time, Argo generates a _Wire schema_ on both the server and the client.
Optionally, code may be generated at Registration Time (based on the Wire schema) to decode messages.
See [Creating a Wire schema](#sec-Creating-a-Wire-schema).

:: _Execution Time_ happens many times, whenever a payload is \[de]serialized with Argo.

At Execution Time, Argo relies on the Wire schema (or code previously generated based on it) to read a binary message.
This only works because information was collected previously during Registration Time.
See [Binary encoding](#sec-Binary-encoding).

Note: Nothing prevents running Registration Time and Execution Time steps at Execution Time.
However, this is a low-performance pattern, and is most likely only useful during development.

# Types

GraphQL uses two type systems:

- _GraphQL types_, which may appear in any given GraphQL Schema
- _GraphQL response types_, which are used when serializing responses

Argo uses these and introduces:

- _Wire types_, used when \[de]serializing to or from byte streams
- _Self-describing types_, primarily used when \[de]serializing errors

## GraphQL types

:: _GraphQL types_ refers to the [types defined in the GraphQL spec](https://spec.graphql.org/October2021/#sec-Types). Briefly, these are:

- `Scalar`, `Enum`, `Object`, `Input Object`, `Interface`, `Union`, `List`
- Scalar includes, at minimum: `Int`, `Float`, `String`, `Boolean`, `ID`

GraphQL also allows for [custom scalars](https://spec.graphql.org/October2021/#sec-Scalars.Custom-Scalars).
Argo supports this, though an `@ArgoCodec` directive is required to tell Argo how to represent it on the wire.

:: _GraphQL response types_ refers to the [serialization types sketched in the GraphQL spec](https://spec.graphql.org/October2021/#sec-Serialization-Format).
These do not have rigorous definitions in the GraphQL spec. These include (but are not limited to):

- `Map`, `List`, `String`, `Null`
- Optionally, `Boolean`, `Int`, `Float`, and `Enum Value`

### GraphQL input types

GraphQL also includes Input types, which encode arguments and requests.
Presently, Argo does not specify how to encode GraphQL input types because the expected benefits are small.
However, this is a natural, straightforward, and backwards-compatible extension which may be added in a future version.
See [#4](https://github.com/msolomon/argo/issues/4) for more discussion.

## Wire types

:: _Wire types_ are used by Argo to encode GraphQL values as bytes.

Argo uses the following named Wire types:

- `STRING`: a UTF-8 string
- `BOOLEAN`: true or false
- `VARINT`: a variable-length integer
- `FLOAT64`: an IEEE 754 double-precision binary floating-point (binary64)
- `BYTES`: a variable-length byte string
- `FIXED`: a fixed-length byte string
- `RECORD`: a selection set, made up of potentially-omittable named fields and their values
- `ARRAY`: a variable-length list of a single type
- `BLOCK`: describes how to store the underlying type in a block of value data
- `NULLABLE`: may be null or have a value
- `DESC`: a self-describing type

### Self-describing types

:: _Self-describing types_ are used by Argo to encode values with types which are not known in advance (e.g. at Registration Time).
Primarily, this is required to comply with the [GraphQL specification on Errors](https://spec.graphql.org/October2021/#sec-Errors).

Argo uses the following named self-describing types:

- `Null`: marks that a value is not present (like `null` in JSON)
- `Object`: an object, made up of named fields and their values
- `List`: a variable-length list of (potentially) mixed types
- `String`: a UTF-8 string
- `Bytes`: a variable-length byte string
- `Boolean`: true or false
- `Int`: a variable-length integer
- `Float`: an IEEE 754 double-precision binary floating-point (binary64)

# Wire schema

:: GraphQL uses a Schema to capture the names and types of data.
GraphQL queries select a portion of data from that Schema.
Given a Schema and a query on it, Argo produces a _Wire schema_ with all the information needed to
\[de]serialize data powering that query against a compatible GraphQL Schema.

Note: In a client-server architecture,
GraphQL schemas frequently change on the server according to certain compatibility rules.
Therefore, while Argo _cannot_ assume the Schema used for serializing data is the Schema used for deserializing,
it _does_ assume they are compatible with each other (i.e. no [breaking changes](https://spec.graphql.org/October2021/#sel-EALJDCAgICCAogH) have been made).

The wire schema is a single WireType which describes how to encode an entire payload:

WireType ::

- `STRING()` | `BOOLEAN()` | `VARINT()` | `FLOAT64()` | `BYTES()` | `DESC()` | `PATH()`
- `FIXED(lengthInBytes: Int)`
- `RECORD(fields: Field[])` where `Field(name: String, of: WireType, omittable: Boolean)`
- `ARRAY(of: WireType)`
- `BLOCK(of: WireType, key: String, dedupe: Boolean)`
- `NULLABLE(of: WireType)`

## Wire schema serialization

A Wire schema or WireType may be serialized in JSON.
It must be a JSON object of the form: `{"type": "typeName" ...attributes...}` where `typeName` is one of the _Wire types_ as a string, and the attributes are as sketched in _WireType_ above.

```json example
{
  "type": "RECORD",
  "fields": [
    {
      "name": "errors",
      "type": {
        "type": "NULLABLE",
        "of": { "type": "ARRAY", "of": { "type": "DESC" } }
      },
      "omittable": true
    }
  ]
}
```

This serialization may be helpful to avoid recomputing Wire schemas on the server.
Other serializations may be more efficient but are out of scope here.

# Creating a Wire schema

Argo is designed to work with GraphQL queries and schemas which are known in advance.
It generates a description of the types which may be returned by a query (one time),
and uses this to serialize or deserialize (many times).
This description is called a _Wire schema_.

It is helpful to first describe this process informally.
Each selection set is walked over with the corresponding GraphQL schema easily available.
Selection sets and selections are handled differently.

- Each selection set collapses direct selections with any fragments, union, or interface selections down into a single Wire `RECORD`
  - This `RECORD` retains the order of the selections, marks any fields which may be omitted in the response as omittable, and de-duplicates repeated selections recursively
- Other selections are transformed into analogous wire types
  - String, ID, and any Enum types become `STRING`
  - Int becomes `VARINT`
  - Float becomes `FLOAT64`
  - Boolean becomes `BOOLEAN`
  - List becomes `ARRAY`
  - All types are non-null by default, and nullable types are wrapped in `NULLABLE`
  - Custom scalars (and any built-ins which set it) use the `@ArgoCodec` directive to choose a wire type
  - Scalars (except Boolean) may use the `@ArgoDeduplicate` directive to opt in or out of deduplication

Note: Though it seems more efficient to represent Enums as `VARINT`, there is no guarantee that the writer's view of the Enum type exactly matches the reader's. The schema may have changed: in the writer's schema, if an Enum's values have been reordered, or if an Enum value has been added before the end (but will otherwise never be sent to this particular reader), the reader and writer do not have enough information to agree on the correct numbering.

The following types will always be marked with `BLOCK`,
with a key set to the GraphQL type was generated from:

`STRING, VARINT, FLOAT64, BYTES, FIXED`

These types will be marked to deduplicate within their Block by default (but it may be overridden by `@ArgoDeduplicate`):

`STRING, BYTES`

## Directives

Argo uses the following directives in a GraphQL schema to customize the wire schema:

```graphql
enum ArgoCodecType {
  String
  Int
  Float
  Boolean
  BYTES
  FIXED
}

directive @ArgoCodec(codec: ArgoCodecType!, fixedLength: Int) on SCALAR | ENUM
directive @ArgoDeduplicate(deduplicate: Boolean! = true) on SCALAR | ENUM
```

These directives may be omitted when custom scalars are not used and default behavior is desired.
Otherwise, they must be added to the GraphQL schema.

@ArgoCodec
: Specifies the Wire type to use for a scalar.
The _@ArgoCodec_ directive is required for custom scalars, and may be used on any scalar or enum.
It specifies the Wire type to use for that scalar or enum.
: `String`, `Int`, `Float`, and `Boolean` match the behavior for these built-in GraphQL types
(i.e. they are transformed to `STRING`, `VARINT`, `FLOAT64`, and `BOOLEAN` respectively).
`BYTES` and `FIXED`, used for binary data, correspond to those _Wire types_.
: The `fixedLength` argument is required for `FIXED` scalars,
and specifies the length of the fixed-length binary data.
It is an error to specify `fixedLength` for any other Wire type.

@ArgoDeduplicate
: Specifies whether to deduplicate a scalar or enum within a _Block_.
: The _@ArgoDeduplicate_ directive is optional, and may be used on any scalar or enum.
The default deduplication behavior (used when the directive is absent) is described above in
[Creating a Wire schema](#sec-Creating-a-Wire-schema), and is based on the codec used.

## Algorithms

A wire schema is generated by the following algorithms.
Typically, _CollectFieldWireTypes()_ should be called with the root type of the GraphQL Schema's operation (typically, `Query`) along with the selection set--usually from a Query, but potentially for that returned by a Mutation or Subscription.

Note: Much of this code may be easier to follow in the
[reference implementation's `Typer` class](https://github.com/msolomon/argo/blob/main/argo-js/src/typer.ts).

Note: _CollectFieldsStatic()_ is based on GraphQLs [CollectFields() algorithm](<https://spec.graphql.org/October2021/#CollectFields()>).

GraphQLTypeToWireType(graphQLType):

- If {graphQLType} is a Scalar or Enum:
  - If {graphQLType} has an {@ArgoCodecDirective}, set {codec} to its argument
  - If {graphQLType} has an {@ArgoDeduplicateDirective}, set {deduplicate} to its argument
  - Otherwise, let {deduplicate} be false
  - If {graphQLType} is an Enum:
  - If {graphQLType} is a String or ID:
    - If {codec} is not set, set it to use the {STRING} codec
    - Set {deduplicate} to true
  - If {graphQLType} is an Int:
    - If {codec} is not set, set it to use the {VARINT} codec
  - If {graphQLType} is a Float:
    - If {codec} is not set, set it to use the {FLOAT64} codec
  - If {graphQLType} is a Boolean:
    - If {deduplicate} is set, fail with an error because {BOOLEAN} cannot be deduplicated
    - return `Nullable(BOOLEAN)`
  - If {graphQLType} is a custom scalar:
    - If {codec} is not set, fail with an error because {codec} is required for custom scalars
    - If {deduplicate} is not set, set it to the corresponding value above for the type of {codec}
  - Set {blockID} to the name of the {graphQLType}'s type
  - Return `Nullable(Block(codec, blockId, deduplicate))`
- If {graphQLType} is a List:
  - Set {underlyingType} to the result of calling {GraphQLTypeToWireType()} with the underlying type of the List
  - Return `Nullable(Array(underlyingType))`
- If {graphQLType} is an Object, Interface, or Union:
  - Set {fields} to the empty list
  - Return `Nullable(Record(fields))`
- If {graphQLType} is NonNull:
  - Set {type} to the result of calling {GraphQLTypeToWireType()} with the underlying type of the NonNull, then removing its Nullable wrapper
  - Return {type}

CollectFieldWireTypes(selectionType, selectionSet):

- Initialize {recordFields} to an empty list.
- For each {alias} and ordered set of {fields} in {CollectFieldsStatic(selectionSet)}:
  - For each {field} in {fields}:
    - Initialize {omittable} to {false}
    - If {field} was selected by a fragment spread, set {typeCondition} to the name of the type condition specified in the fragment definition
    - If {field} was selected by an inline fragment and a type condition has been specified, set {typeCondition} to the name of the type condition specified in the inline fragment
    - If {typeCondition} is set, but not set to the name of {selectionType}, set {omittable} to {true}
    - If {field} provides the directive `@include`, let {includeDirective} be that directive.
      - If {includeDirective}'s {if} argument is variable, set {omittable} to {true}
    - If {field} provides the directive `@skip`, let {skipDirective} be that directive.
      - If {skipDirective}'s {if} argument is variable, set {omittable} to {true}
    - If {field} was selected by a fragment spread or inline fragment that provides the directive `@include`, let {includeDirective} be that directive.
      - If {includeDirective}'s {if} argument is variable, set {omittable} to {true}
    - If {field} was selected by a fragment spread or inline fragment that provides the directive `@skip`, let {skipDirective} be that directive.
      - If {skipDirective}'s {if} argument is variable, set {omittable} to {true}
    - If {field} is a selection set:
      - Set {wrapped} to the result of calling {TypeToWireType()} with the {field}'s GraphQL type
      - Let {wrap(wireType)} be a function which recursively applies `NULLABLE`, `BLOCK`, and `ARRAY` wrappers around {wireType} in the same order they appear in {wrapped}
      - Set {type} to the result of calling `CollectFieldWireTypes(field.type, field.selectionSet)`
      - Set {type} to the result of calling {wrap(type)}
      - Append {Field(alias, type, omittable)} to {recordFields}
    - Otherwise:
      - Set {type} to the result of calling `TypeToWireType(field.type)`
      - Append {Field(alias, type, omittable)} to {recordFields}
    - For any {field} in {recordFields} which shares a name and is a selection set, recursively combine fields into a single selection set {field} which orders selections in the same order as in {recordFields}
    - For any {field} in {recordFields} which shares a name but is not a selection set, remove all but the first from {recordFields} (these will be equivalent in all valid queries)
    - Return {recordFields}

CollectFieldsStatic(selectionSet, visitedFragments) :

- If {visitedFragments} is not provided, initialize it to the empty set.
- Initialize {groupedFields} to an empty ordered map of lists.
- For each {selection} in {selectionSet}:
  - If {selection} provides the directive `@skip`, let {skipDirective} be that
    directive.
    - If {skipDirective}'s {if} argument is always {true},
      continue with the next {selection} in {selectionSet}.
  - If {selection} provides the directive `@include`, let {includeDirective} be
    that directive.
    - If {includeDirective}'s {if} argument is never {true},
      continue with the next {selection} in {selectionSet}.
  - If {selection} is a {Field}:
    - Let {responseKey} be the response key of {selection} (the alias if
      defined, otherwise the field name).
    - Let {groupForResponseKey} be the list in {groupedFields} for
      {responseKey}; if no such list exists, create it as an empty list.
    - Append {selection} to the {groupForResponseKey}.
  - If {selection} is a {FragmentSpread}:
    - Let {fragmentSpreadName} be the name of {selection}.
    - If {fragmentSpreadName} is in {visitedFragments}, continue with the next
      {selection} in {selectionSet}.
    - Add {fragmentSpreadName} to {visitedFragments}.
    - Let {fragment} be the Fragment in the current Document whose name is
      {fragmentSpreadName}.
    - If no such {fragment} exists, fail with an error because the referenced {fragment} must exist.
    - Let {fragmentSelectionSet} be the top-level selection set of {fragment}.
    - Let {fragmentGroupedFieldSet} be the result of calling
      {CollectFieldsStatic(fragmentSelectionSet, visitedFragments)}.
    - For each {fragmentGroup} in {fragmentGroupedFieldSet}:
      - Let {responseKey} be the response key shared by all fields in
        {fragmentGroup}.
      - Let {groupForResponseKey} be the list in {groupedFields} for
        {responseKey}; if no such list exists, create it as an empty list.
      - Append all items in {fragmentGroup} to {groupForResponseKey}.
  - If {selection} is an {InlineFragment}:
    - Let {fragmentSelectionSet} be the top-level selection set of {selection}.
    - Let {fragmentGroupedFieldSet} be the result of calling
      {CollectFieldsStatic(fragmentSelectionSet, visitedFragments)}.
    - For each {fragmentGroup} in {fragmentGroupedFieldSet}:
      - Let {responseKey} be the response key shared by all fields in
        {fragmentGroup}.
      - Let {groupForResponseKey} be the list in {groupedFields} for
        {responseKey}; if no such list exists, create it as an empty list.
      - Append all items in {fragmentGroup} to {groupForResponseKey}.
- Return {groupedFields}.

# Binary encoding

Argo's binary encoding does not include field names, self-contained information about the types of individual bytes, nor field or record separators. Therefore readers are wholly reliant on the Wire schema used when the data was encoded (or any compatible Wire schema), along with any information about custom scalar encodings.

Argo always uses a little-endian byte order.

Note: Reading Argo messages often involves reading length prefixes followed by that many bytes.
As always in situations like this, use bounds checking to avoid buffer over-read.

## Message

:: An Argo _Message_ consists of these concatenated parts:

- A variable-length _Header_
- 0 or more concatenated _Blocks_ containing scalar values, each prefixed by their length
- 1 _Core_, which contains the Message's structure, prefixed by its length

## Header

:: The _Header_ is encoded as a variable-length _BitSet_.
After into a fixed bit array, each bit in the BitSet has a defined meaning described below.

Numbered least to most significant bits:

```
0: InlineEverything
1: SelfDescribing
2: OutOfBandFieldErrors
3: SelfDescribingErrors
4: NullTerminatedStrings
5: NoDeduplication
6: HasUserFlags
```

:: When a given flag is set, Argo's behavior is modified as described below.
Each may also be referred to as a _Mode_ of operation,
and the corresponding bit must be set if and only if the messages uses the corresponding Mode.

InlineEverything
: In this Mode, _Blocks_ are omitted, along with their length prefixes.
_Core_'s length prefix is also omitted.
Instead, scalar values are written inline in _Core_ (i.e. at the current position when they are encountered).
: This generally results in smaller messages which do not compress as well.
Useful when the Message will not be compressed.
For tiny messages (say, dozens of bytes) this usually results in the smallest possible payloads.

SelfDescribing
: In this Mode, _Core_ is written exactly as if its type were `DESC`.
This makes the message value self-describing.
: This generally makes the payload much larger, and is primarily useful when debugging.

OutOfBandFieldErrors
: In this Mode, GraphQL [Field errors](https://spec.graphql.org/October2021/#sec-Errors.Field-errors)
are guaranteed not to be written inline, and instead appear in the `errors` array, if any.
: This makes it easier to convert JSON payloads to Argo after the fact,
but eliminates the benefits of inline errors.

SelfDescribingErrors
: In this Mode, errors are not encoded as usual.
Instead, each is encoded as a self-describing value (which must adhere to the GraphQL spec).
This applies to both Field errors and Request errors.
: This makes it easier to convert JSON payloads to Argo after the fact,
but gives less type safety and generally results in larger error payloads.

NullTerminatedStrings
: In this Mode, all messages of type `String` are suffixed with a UTF-8 NUL (i.e. a 0x00 byte).
This byte is not included in the String's length, and is not considered part of the String.
Other NUL bytes may still appear within each String.
: This makes it possible to implement zero-copy in language environments relying on NUL-terminated strings,
but generally makes the payload larger.

NoDeduplication
: In this Mode, the message is guaranteed to never use backreferences.
This may be because the encoder chose to duplicate values, or because duplicates were never encountered.
The decoder MAY safely skip calculating backreference IDs, which carries a small cost.

HasUserFlags
: In this Mode, the Header BitSet is followed by another variable-length BitSet called _UserFlags_.
The meaning of entries in UserFlags is up to the implementation,
and remain outside the scope of this specification.
: This is useful to prototype custom implementations and extensions of Argo.

## Blocks

:: Argo _Blocks_ are named contiguous blocks of encoded scalar values of the same type.

Each begins with a _Label_ encoding the length of the block in bytes (not counting the length prefix).

Concatenated to this is every value in the block.
The encoding of each value is defined below.
Generally, this will not include any metadata, only values.

The name (or key) of each Block is not encoded in the message.

## Core

:: The _Core_ of a Message contains the primary structure of the payload.

The Core is prefixed with a _Label_ encoding the its length in bytes (not counting the length prefix).
This is omitted when operating in _InlineEverything_ mode.

The rest of the Core consists of a single value which encodes the payload.
This is almost always a `RECORD` corresponding to GraphQL's `ExecutionResult`.

## Label

:: Argo uses a multipurpose binary marker called a _Label_ which combines several use cases into one compact representation.
A Label is written using the _variable-length zig-zag coding_.
A Label is essentially a number which should be interpreted differently according to its value and the context in which it is used.

- For variable-length data, such as a `STRING` or `ARRAY`, non-negative values represent the length of the data that is to follow
  - The units depend on the data: `STRING` lengths are in bytes, while `ARRAY` lengths are in entries
- For `BOOLEAN`s, 0 means `false` and 1 means `true`
- For `NULLABLE` values, -1 means `null`
- For `NULLABLE` values which are not `null` and are not normally prefixed by a Label, 0 means not-null
  - Values which are prefixed by a Label even when non-nullable omit this non-null marker entirely,
    since we can rely on the Label's value to tell us it is not null
- For `NULLABLE` values, -3 means there was a Field Error which terminated its propagation (if any) here
- For fields which may be omitted--such as fields that come from a selection set over a Union, and therefore may not appear at all--the value -2 is used to represent absence, called the _Absent Label_
- All other negative numbers are used for _Backreferences_:
  identification numbers which refer to values which appeared previously in the Message

:: Types whose values are prefixed with a Label or are themselves a Label are called _Labeled_.
For example, `STRING`, `ARRAY`, `BOOLEAN`, and all `NULLABLE` types are _Labeled_.

:: Types whose values are not prefixed with a Label and are not themselves a Label are called _Unlabeled_.
For example, non-nullable `RECORD` and non-nullable `FLOAT64` are _Unlabeled_.

## Data encoding

Data are encoded in binary as described here.

STRING
: `STRING` values are encoded as UTF-8 and written to their _Block_.
In _Core_, a _Label_ is written which is the length of the encoded value in bytes.
Typically, repeated `STRING` values may be deduplicated by instead writing a _backreference_ to _Core_.
: In _NullTerminatedStrings_ mode, an additional UTF-8 NUL (0x00) is written to the block following the UTF-8 value
(this is not counted in the length written to _Core_).

BOOLEAN
: `BOOLEAN` values use the value 0 for `false` and 1 for `true`, and are written as a _Label_ to _Core_.

VARINT
: `VARINT` (variable-length integer) values are written to _Core_ and use the _variable-length zig-zag coding_.

FLOAT64
: `FLOAT64` values are written to their _Block_ as 8 bytes in little endian order according to IEEE 754's `binary64` variant.
Nothing is written to _Core_.

BYTES
: A `BYTES` is encoded as unaltered contiguous bytes and written to its _Block_.
In _Core_, a _Label_ is written which is the length of the encoded value in bytes.
Typically, repeated `BYTES` values may be deduplicated by instead writing a _backreference_ to _Core_.

FIXED
: `FIXED` values are written to their _Block_ as bytes in little endian order.
Nothing is written to _Core_.
The number of bytes is not included in the message in any way, since it is in the _Wire schema_.

RECORD
: `RECORD` values are written as a concatenation of their _Fields_ to _Core_.
Each _Field_ is written recursively in the order it appears in the _Wire schema_.
If a Field is _omittable_ and absent, it is written as the _Absent Label_.
If a Field is _omittable_ and present, but its underlying type is _Unlabeled_,
a non-null Label is written to _Core_ before writing the field's value.
The number of fields and their types are not included in the message in any way, since that is in the _Wire schema_.

ARRAY
: `ARRAY` values are written as a _Label_ in _Core_ which contains the `ARRAY`'s length (in entries),
followed by a concatenation of its entries recursively.

BLOCK
: `BLOCK` is not written to the _Message_ directly.
Instead, it modifies its underlying type,
naming which block it should be written to and whether values should be deduplicated.
Block keys match the name of the type in the GraphQL schema it is generated from.
For example, 'String' for the built-in type, or a custom scalar's name.
Deduplication is configurable with the ArgoDeduplicate directive, with defaults specified under _Wire schema_.

NULLABLE
: `NULLABLE` values are written differently depending on whether the underlying value is _Labeled_ or _Unlabeled_.
The value `null` is always written to _Core_ as the _Null Label_ with the value 0.
If the underlying value is present and _Labeled_, non-null values are simply written recursively and unmodified using the underlying value's encoding.
If the underlying value is present and _Unlabeled_, first the _Non-null Label_ is written to _Core_, then the underlying value is written recursively.

DESC
: `DESC` values are self-describing, and primarily used to encode errors.
This scheme is described in _Self-describing encoding_.

PATH
: `PATH` values represent a path into a GraphQL response, such as are used inside Error values.
Inline field error paths are relative to the location they appear,
and all others are relative to the response root.
First, GraphQL spec-compliant paths are transformed to a list of integers as described in
[Path value transformation](#sec-Path-value-transformation).
Then, this list of integers is encoded exactly as an `ARRAY` of `VARINT` values.

#### Variable-length zig-zag coding

:: The _variable-length zig-zag coding_ is a way to encode signed integers as a variable-length byte sequence.
Argo uses a scheme compatible with Google Protocol Buffers.
It uses fewer bytes for values close to zero, which are more common in practice.
In short, it "zig-zags" back and forth between positive and negative numbers:
0 is encoded as `0`, -1 as `1`, 1 as `10`, 2 as `11`, 2 as `100`, and so on.
A `bigint` variable `n` in TypeScript can be transformed as follows,
then written using the minimum number of bytes (without unnecessary leading zeros):

ToZigZag(n):

- `return n >= 0 ? n << 1n : (n << 1n) ^ (~0n)`

FromZigZag(n):

- `return (n & 0x1n) ? n >> 1n ^ (~0n) : n >> 1n`

#### Self-describing encoding

Argo is intended to rely on known types taken from GraphQL queries and schemas.
However, the `errors` array in GraphQL is very free-form [as specified in the GraphQL Spec](https://spec.graphql.org/October2021/#sec-Errors).
To support this, as well as to ease debugging in certain circumstances, a self-describing format is included.

:: Self-describing values use a _Type marker_,
a _Label_ written to _Core_ with a predetermined value representing the type of the value to follow.

In the self-describing format, most values are encoded as usual, including using _Blocks_.
However, values in this format only use the following Blocks:

- A block with key "String", used for all values marked `String`
- A block with key "Bytes", used for all values marked `Bytes`
- A block with key "Int", used for all values marked `Int`
- A block with key "Float", used for all values marked `Float`

Note: These Blocks may also be used for non-self-describing values. This is intentional.

To write a _Type marker_, encode the given value as a _Label_ and write it to _Core_.

To write a self-describing value, first map the desired value to the closest type described in _Self-describing types_.
Then, write each type as below (reading follows the same pattern):

Null (-1)
: Written as _Type marker_ -1 in _Core_.

Boolean false (0)
: Written as _Type marker_ 0 in _Core_.

Boolean true (1)
: Written as _Type marker_ 1 in _Core_.

Object (2)
: Begins with _Type marker_ 2 in _Core_,
followed by a second _Label_ in _Core_ encoding the number of fields which follow.
All fields follow in order,
each written as a `STRING` capturing the field name (with no preceding _Type marker_),
then recursively written the field's value using the self-describing encoding.
These alternate until completion, concatenated together.

List (3)
: Begins with _Type marker_ 3 in _Core_,
followed by a second _Label_ in _Core_ encoding the length of the list.
Each entry is then written recursively in the self-describing format, concatenated together.
Note that heterogeneous types are allowed: this is important for GraphQL's error representation.

String (4)
: Written as _Type marker_ 4 in _Core_, followed by a non-self-describing `STRING` with Block key "String".

Bytes (5)
: Written as _Type marker_ 5 in _Core_, followed by a non-self-describing `BYTES` with Block key "Bytes".

Int (6)
: Written as _Type marker_ 5 in _Core_, followed by a non-self-describing `VARINT` with Block key "Int".

Float (7)
: Written as _Type marker_ 6 in _Core_, followed by a non-self-describing `FLOAT64` with Block key "Float".

## Backreferences

:: Argo _Backreferences_ are numeric references to values which appeared previously in the Message.
Backreferences are encoded as _Labels_ with negative values.

Argo reduces data size on the wire by avoiding repeated values.
Whenever a potentially-large value is read or written for the first time in a given _Block_,
it is remembered and given the next available backreference ID number (which is always negative).
When it is next used, it can be identified by the backreference ID,
eliminating the need to encode (and later decode) the entire value again.

Each _Block_ has a separate backreference ID space.
This means backreference IDs are not unique across types: a backreference ID -5 refers to a different value for `String` than it does for a hypothetical `MyEnum`.
Backreference IDs count down, beginning at the largest non-reserved negative label value:
this is -4, since the _Error label_ (-3) is the smallest reserved value.

Note: For certain messages, this allows Argo representations to remain small in memory by avoiding duplication even after decompression (and further, after parsing). It also helps keep Argo messages small without compression.

When encoding, the encoder SHOULD deduplicate by returning backreference IDs instead of re-encoding duplicated values.
This is typically implemented with a Map data structure.

Note: The encoder MAY choose to duplicate values instead of returning backreferences whenever it chooses.
For example, an easy optimization is to simply duplicate values which are smaller than the backreference ID itself.

When decoding, the decoder MUST track backreference IDs for _Blocks_ with deduplication enabled,
usually by storing an array of previously-encountered values.
However, this MAY be skipped for messages in `NoDeduplication` mode.

In order to maintain a compact data representation,
backreferences (and therefore deduplication) are only supported for _Labeled_ types.
Note that even _Unlabeled_ values may be written to _Blocks_, to impove compressability.

## Errors

Errors require special treatment for three reasons:

1. [Field errors](#sec-Field-errors) are inlined with data (except in _OutOfBandFieldErrors_ _Mode_).
   This makes it easy to distinguish between null and an error as soon as a value is read,
   and also makes their representation more compact.

2. The "extensions" portion of each errors object must be self-describing.
   This is in contrast to all other data: we don't know the schema/types of "extensions" data, and it may vary between objects.

3. The "path" portion of each error object is not representable directly in GraphQL (or Argo) types.
   This is because it mixes String and Int primitive values, which GraphQL forbids for data.

Note: Normally, Argo does not allow for direction extension to field error objects outside of the extensions field,
even though the GraphQL spec allows for (but discourages) it.
This is on the grounds that it is very easy to recover this information by simply moving it to the
extensions field when migrating to this data format, and it simplifies Argo.
If required, _SelfDescribingErrors_ can be used to allow for this.

### Error values

Error values are written in a specific format,
which has the following schema in GraphQL (and a corresponding schema in Argo):

```graphql
type Location {
  line: Int!
  column: Int!
}

type Error {
  message: String!
  location: [Location!]
  path: PATH
  extensions: DESC
}
```

These all take the values described in the GraphQL spec with these exceptions:

1. The `path` field uses the _Path encoding_ described below.
   Paths should be converted to a more convenient format in the reader's code generator,
   such as intermixed path strings and integer indexes.
2. The `extensions` field is written as a nullable `Object` in the _Self-describing object_ format
   with any values the writer chooses, or as `Null` if there are no extensions.

Note: `path` and `extensions` are not representable as normal GraphQL responses:
`path` mixes String and Int primitive values, which GraphQL forbids for data;
`extensions` must be a map, and has no other restrictions. Based on `path`'s behavior (which violates GraphQL's typing rules), this seems to include values only representable in the transport layer (like JSON, or this spec). There is no information about the extensions map in the schema or any query.

When operating in _SelfDescribingErrors_ mode, errors are not encoded as described here.
Instead, each is encoded as a self-describing value (which must adhere to the GraphQL spec).
This applies to Field errors and Request errors.

### Request errors

Request errors are stored in an `errors` array in the usual response location,
encoded as [Error values](#sec-Error-values).

### Field errors

Nullable fields are the only valid location for
[Field errors](https://spec.graphql.org/October2021/#sec-Errors.Field-errors).
When Field errors are encountered, the errors propagate to the nearest nullable encompassing field,
and then an `Error` _Label_ is written to _Core_.
All relevant field errors should then be written to _Core_
as a `ARRAY` of [Error value](#sec-Error-value)s using the format above.
However, the `path` field should only encode the path from the field which the error propagated to to the field which the error occurred in.
This is because the path from the root of the query is knowable due to where the `Error` Label is encountered.
This makes the representation more compact.
However, implementations should make full path easily available to users.

When operating in _OutOfBandFieldErrors_ mode, errors are not written as described here.
Instead, an Error (preferred) or Null _Label_ is written to _Core_ (with no additional error data following),
and the error is written separately to the errors array.
The `path` must include the full path from the root.

### Path value transformation

Argo transforms GraphQL location paths before encoding them as _PATH_ in order to make them more compact.

_PathToWirePath()_ is used to transform a GraphQL location path into a list of integers,
and _WirePathToPath()_ transforms an encoded list of integers into a GraphQL location path.

PathToWirePath(path, wireType):

- If {wireType} is `RECORD`:
  - Set {fieldName} to the first element of {path}, which must be a string
  - Set {fieldIndex} to the 0-based index of the `RECORD` field which matches {fieldName}
  - Set {tail} to an array equal to {path} with its first element omitted
  - Set {underlyingType} to the underlying type of {wireType}
  - Return `fieldIndex` prepended to `PathToWirePath(tail, underlyingType)`
- If {wireType} is `ARRAY`:
  - Set {arrayIdx} to the first element of {path}, which must be an integer index
  - Set {tail} to an array equal to {path} with its first element omitted
  - Set {underlyingType} to the underlying type of {wireType}
  - Return `arrayIdx` prepended to `PathToWirePath(tail, underlyingType)`
- If {wireType} is `NULLABLE` or `BLOCK`:
  - Set {underlyingType} to the underlying type of {wireType}
  - Return `PathToWirePath(path, underlyingType)`
- Otherwise, return {path} (which must be an empty array)

WirePathToPath(path, wireType):

- If {wireType} is `RECORD`:
  - Set {fieldIndex} to the first element of {path}, which must be a string
  - Set {fieldName} to the name of the field at the 0-based index {fieldIndex} in the `RECORD`
  - Set {tail} to an array equal to {path} with its first element omitted
  - Set {underlyingType} to the underlying type of {wireType}
  - Return `fieldName` prepended to `WirePathToPath(tail, underlyingType)`
- If {wireType} is `ARRAY`:
  - Set {arrayIdx} to the first element of {path}, which must be an integer index
  - Set {tail} to an array equal to {path} with its first element omitted
  - Set {underlyingType} to the underlying type of {wireType}
  - Return `arrayIdx` prepended to `WirePathToPath(tail, underlyingType)`
- If {wireType} is `NULLABLE` or `BLOCK`:
  - Set {underlyingType} to the underlying type of {wireType}
  - Return `WirePathToPath(path, underlyingType)`
- Otherwise, return {path} (which must be an empty array)

# Argo APIs

Argo is suitable for a variety of contexts,
but it is primarily designed for encoding responses to GraphQL queries over HTTP.

## HTTP considerations

If a client initiating an Argo HTTP request prefers a specific Argo _Mode_,
it MAY include the `Argo-Mode` header with the case-insensitive names of the preferred modes
separated by semicolons.

```http example
Argo-Mode: SelfDescribingErrors;OutOfBandFieldErrors
```

### MIME type

When an HTTP client supports Argo,
it SHOULD use the MIME type `application/argo` in the `Accept` header,
ideally with a [Quality Value](https://developer.mozilla.org/en-US/docs/Glossary/Quality_values)
exceeding that of other encodings (such as `application/json`).

When an HTTP response is encoded with Argo,
the `Content-Type` header SHOULD also use the MIME type `application/argo`.

### Compression

Compression of Argo messages is generally recommended.
The _Blocks_ are designed to make Argo particularl amenable to compression.

The reference implementation compares different compression schemes. Based on this,
[Brotli](https://github.com/google/brotli) (at quality level 4) is recommended for most workloads.
This is a nice balance of small payloads, fast compression and decompression, and wide support.
If Brotli is not available, gzip (at level 6) is a good alternative.
Small responses (say, less than 500 bytes) need not be compressed at all.

Without compression, Argo results in much smaller payloads than uncompressed JSON.
If CPU usage is a concern, consider using a very fast compression algorithm (e.g. [LZ4](https://github.com/lz4/lz4)).

# A. Appendix: Motivation and background

GraphQL typically serializes data into JSON, but GraphQL is designed to support other serializations as well.
Argo is purpose-made to improve on serialization for GraphQL.

## JSON

JSON is the standard serialization for GraphQL data.
In the context of GraphQL responses, it has many strengths as well as a few weaknesses.

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
  - 64-bit integers don't work reliably across all platforms
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

- As of today, reference implementation only
  - No stable, high-performance implementations
- Almost no tools for debugging or analysis
- Binary format which is not self-describing in its intended mode of operation
  - Relatively difficult to debug or analyze without tools
  - Requires GraphQL schema and query be known
- Input types not supported
  - Simpler implementation, but JSON still needed

## Recommendation

Overall, **JSON is the best choice for most GraphQL deployments.**
However, Argo is a good choice for systems where performance is paramount.
Please consider the tradeoffs above.

# B. Appendix: Design notes

This section is not a part of the technical specification, but instead provides additional background and insight.

- Argo is intended for use with code generation, where particular queries against a schema are known at code generation time, and a codec can be generated from this information. This is not often a great fit for web clients, but is great for native clients (or servers). Web clients would need to first download the codec, and a Javascript codec is unlikely to be as performant as `JSON.parse`. This could be worked around by supporting both and downloading the codec out-of-band, then upgrading from JSON to Argo. A codec in WASM might meet performance needs. An Argo interpreter (instead of a code-generated codec) might reduce the download size. Even so, the tradeoffs are unfavorable.
- Byte alignment (instead of bit or word alignment) was chosen primarily for ease of implementation (e.g. no need to pack together consecutive booleans) balanced against the resulting size. Most GraphQL responses are unlikely to majorly benefit from bit packing anyway, and the use cases which would are probably better off using a custom scalar binary representation.
- Null vs. present fields are marked with `LABEL` per-field instead of using a bitmask for an entire object. This is a tad easier to implement on both sides. Bitmasks for null and non-null values made payloads larger during development, and were backed out.
- Field Errors can be represented inline for a few reasons:
  - In a reader, after reading a field you are guaranteed to know whether there was an error or just a null (unless operating in _OutOfBandFieldErrors_ mode)
  - We know most of the `path` in the current response from our location, and do not need to write most of it explicitly, saving space.
- Perhaps surprisingly, `Enum`s can't be safely represented as small numbers, since schema evolution rules allow for changes (e.g. reordering) which would alter the number on one side but not the other.
- Argo permits zero-copy for types which tend to be larger (`String` and `Bytes`). Low-level languages can refer to these values directly in the source buffer. The `NullTerminatedStrings` flag can assist here for C-style strings.
- De-duplication is never required on the writer. This permits optimizations like repeating label/value pairs which are shorter than a backreference to a previously-seen value.
- High-performance decoding of `VARINT` is possible with [a vectorized implementation](https://arxiv.org/abs/1503.07387)
- For large payloads with lots of duplication, the de-duplication is valuable even when the entire payload is compressed: values need not be encoded or decoded multiple times, and it can be used to avoid duplicated objects on the client side.
- There are some options to improve on the non-null _Label_:
  - _Nullable_ but otherwise _Unlabeled_ values could have their own _Blocks_, and therefore be eligible for deduplication.
    This would help for large and highly duplicated Float and Int values, which seems like a pretty small win.
  - Another alternative is to use "Blocks and Labels for everything,"
    a scheme where all values (even those presently _Unlabeled_) use Labels and have corresponding Blocks.
    This would mean separate Blocks for each `RECORD` type (requires a naming/numbering scheme),
    and would probably be more efficient for many workloads (due to more contiguous data),
    but less efficient for others (perhaps arrays of data with only slight duplication).
    This was rejected due to its higher complexity and somewhat low expected payoff.
    It would make an interesting prototype, one requiring interesting real-world payloads to test.
- The name "Argo" riffs on the pronunciation of "JSON" as "Jason," who in Greek mythology quested on a ship called the _Argo_.

## Ideas which did not pan out

- Use bitmasks on each selection set to mark null (or absent) fields. See Design Notes for more.
- Require all Field Errors be represented inline. This would be nice, but it makes it more difficult to convert JSON responses to Argo. Therefore, this is left as an optional feature (see the _OutOfBandFieldErrors_ flag).
- Specify a Wire type definition for ExecutionResult, particularly `errors`. Unfortunately, error paths mix string and int, which has no corresponding GraphQL type. We could serialize this all as string and convert back later.
- Make the self-describing format able to describe the Wire format. This made things more complex.
- Avro uses an array format where an arbitrary number of "segments" can be added independently without knowing the final array length,
  which makes streaming encoding easier. During development Argo was focused on stream support and followed suit, but this
  was dropped due to lack of compelling GraphQL use cases, and because it conflicted with other techniques (namely _Blocks_).

## Ideas which were not pursued

- Use Label before Floats to represent the number 0s to pad it with. Due to JSON/JS, many doubles are actually smallish Ints, which in IEEE 754 means leading with 0-bytes. This might work out on average, especially since 0 takes only 1 byte.
- Specify how to write compact Paths to values to represent errors. A series of tags.
  - If errors inlined, path up to propagation stop is implicit. The path from there down into any initiating non-nullable field would need to be explicit though, need to account for
- Whenever a default value in encountered for a scalar type which is deduplicatable, implicitly store it with a backreference ID and use it later. This may break if the schema evolves.
- Bake in default backreferences for common strings: 'line', 'column', 'path'. For certain small messages, this could make a difference. The extra complexity doesn't seem worth it though.
- Instead of a self-describing format, simply embed JSON. This is not a knock-out win, especially for the resulting API.
- Use a variable-length compact float format, such as [vf128](https://github.com/michaeljclark/vf128), [compact float](https://github.com/kstenerud/compact-float), or even ASN.1's REAL BER/DER. This would be most helpful for GraphQL APIs which return many Floats with values near zero. Other options might be [ALP: Adaptive Lossless floating-Point Compression](https://ir.cwi.nl/pub/33334/33334.pdf) or the "Pseudodecimal Encoding" from [BtrBlocks](https://www.cs.cit.tum.de/fileadmin/w00cfj/dis/papers/btrblocks.pdf).
- Encode the entire `ExecutionResult`'s type in each _Wire schema_, including the errors array. In particular, the user would need to provide their intended `extensions` format and stick to it, and we'd need to fudge the type of `path` (which mixes numbers and strings in the GraphQL spec). The upshot would be total elimination of the self-describing format and the inconvenience, inefficiency, and complexity that causes.
- Specifying which types actually use backreferences in a given message could be made more granular.
  For example, the header could be extended with scheme similar to _UserFlags_,
  where a flag is set in the main header and an extra BitSet follows the Flags BitSet.
  This extra BitSet would set one bit in order for each potentially-deduplicatable type encountered in the message,
  in order. This could work around client-side inefficiency in bimodal deduplication patterns.
  However, this seems unlikely to be enough of a problem to justify the complexity.
- Default values. Fields could be marked (in the query or the schema, with query taking precedence) with a default value.
  Ideally, we would reserve a value (similar to Absent, Null, Error) to indicate when the default is used.
  (Alternatively, we could reserve/pun the first slot in the backreferences when a type ever uses a default.)
  This would avoid ever sending the full value, instead of sending it once.
  This would work best for very large strings which first appear very late in the message,
  or for non-deduplicatable types (like VARINT) with large encodings which appear many many times.
  These use cases seem to niche to justify the additional complexity.
- `@stream` and `@defer` will likely require additional support.
  [#12](https://github.com/msolomon/argo/issues/12) covers some of this.
  In addition, _Blocks_ will need to become extensible.
  One scheme for this is to number each block in the same way as _Backreferences_.
  Then each new message begins with a Block section, but each block is prefixed with its backreference number.
  Alternatively, we could include all blocks, but I expect that will mostly be a bunch of zeroes.
  It will also need to support blocks not seen in the original message (though the possibilities will be known from the query).
- Constant values, outside of `CONST_STRING` for stream/defer.
  These are natural extensions, but have no use yet in GraphQL.

# C. Legal

## Copyright notice

Copyright © 2022, Michael Solomon

THESE MATERIALS ARE PROVIDED “AS IS.” The parties expressly disclaim any warranties (express, implied, or otherwise), including implied warranties of merchantability, non-infringement, fitness for a particular purpose, or title, related to the materials. The entire risk as to implementing or otherwise using the materials is assumed by the implementer and user. IN NO EVENT WILL THE PARTIES BE LIABLE TO ANY OTHER PARTY FOR LOST PROFITS OR ANY FORM OF INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES OF ANY CHARACTER FROM ANY CAUSES OF ACTION OF ANY KIND WITH RESPECT TO THIS DELIVERABLE OR ITS GOVERNING AGREEMENT, WHETHER BASED ON BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE, AND WHETHER OR NOT THE OTHER MEMBER HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## License

This specification is licensed under [OWFa 1.0](https://www.openwebfoundation.org/the-agreements/the-owf-1-0-agreements-granted-claims/owfa-1-0).

# D. Formal

## Conformance

A conforming implementation of Argo must fulfill all normative requirements. Conformance requirements are described in this document via both descriptive assertions and key words with clearly defined meanings.

The key words “MUST”, “MUST NOT”, “REQUIRED”, “SHALL”, “SHALL NOT”, “SHOULD”, “SHOULD NOT”, “RECOMMENDED”, “MAY”, and “OPTIONAL” in the normative portions of this document are to be interpreted as described in [IETF RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). These key words may appear in lowercase and still retain their meaning unless explicitly declared as non-normative.

A conforming implementation of Argo may provide additional functionality, but must not where explicitly disallowed or would otherwise result in non-conformance.

## Versioning

Argo is versioned using [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
Each version of Argo explicitly targets one version of the GraphQL spec, which is usually the latest at time of writing.

# E. Authors and contributors

Argo was created and authored by [Mike Solomon](https://msol.io).

A big Thank You to these fine folks who have contributed on GitHub!

- [Andrew Bennett](https://github.com/potatosalad)
- [Jimmy Bourassa](https://github.com/jbourassa)

# F. Changelog

## Version 1.1

### v1.1.3

Clarified merging of fields which are not selection sets in _CollectFieldWireTypes()_ .

### v1.1.2

Added additional notes and links.

### v1.1.1

BREAKING CHANGE - some changes are backwards incompatible, but no known implementation relied on them.

- `@include` and `@skip` directives [now result in omittable fields](https://github.com/msolomon/argo/issues/8)

### v1.1.0

BREAKING CHANGE - some changes are backwards incompatible, but no known implementation relied on them.

- Introduced compact paths for errors (and with an eye to streaming) by encoding as a list of integers,
  described in [Path value transformation](#sec-Path-value-transformation)
- Added new `PATH` wire type - closes [#1](https://github.com/msolomon/argo/issues/1)
- Inline errors are now arrays of errors instead of a single error - closes [#2](https://github.com/msolomon/argo/issues/2)

## Version 1.0

Initial release.
