import { DirectiveLocation, DirectiveNode, GraphQLBoolean, GraphQLDirective, GraphQLEnumType, GraphQLInt, GraphQLNonNull, ConstDirectiveNode, GraphQLType, GraphQLScalarType, BooleanValueNode, StringValueNode, IntValueNode } from "graphql";
import { Wire } from "./wire";

/** Marks a type for de-duplication. Works best with large values which re-appear often. */
export const CedarDeduplicateDirective = new GraphQLDirective({
  name: 'CedarDeduplicate',
  description: 'Deduplicate values of this type. Adding or removing this directive is typically a breaking change.',
  locations: [
    DirectiveLocation.SCALAR,
    DirectiveLocation.ENUM,
    // DirectiveLocation.FIELD, // optionally, we could support dynamic encodings like this
  ], // TODO: support deduplicating selection sets?
  args: {
    deduplicate: {
      description: 'Should values of this type be deduplicated?',
      type: new GraphQLNonNull(GraphQLBoolean),
      defaultValue: true,
    }
  },
  isRepeatable: false,
})

export enum CedarCodec {
  String = 'String',
  Int = 'Int',
  Float = 'Float',
  Boolean = 'Boolean',
  BYTES = 'BYTES',
  FIXED = 'FIXED',
}

/** Describes the Cedar codecs which are available */
export const CedarCodecType = new GraphQLEnumType({
  name: 'CedarCodecType',
  description: 'Specifies how to serialize and deserialize this scalar. Adding, changing, or removing this directive is typically a breaking change.',
  values: {
    String: {
      description: 'Serialize and deserialize a scalar as a GraphQL String (UTF-8).',
      value: CedarCodec.String,
    },
    Int: {
      description: 'Serialize and deserialize a scalar as a GraphQL Int (32-bit signed integer).',
      value: CedarCodec.Int,
    },
    Float: {
      description: 'Serialize and deserialize a scalar as a GraphQL Float (IEEE 754 double-precision floating-point).',
      value: CedarCodec.Float,
    },
    Boolean: {
      description: 'Serialize and deserialize a scalar as a GraphQL Boolean.',
      value: CedarCodec.Float,
    },
    BYTES: {
      description: 'Serialize and deserialize a scalar as Cedar BYTES: a variable-length length-prefixed byte array.',
      value: CedarCodec.BYTES,
    },
    FIXED: {
      description: 'Serialize and deserialize a scalar as Cedar FIXED: a fixed-length byte array.',
      value: CedarCodec.FIXED,
    },
  }
})

/** Specifies how to encode and decode a (custom) Scalar */
export const CedarCodecDirective = new GraphQLDirective({
  name: 'CedarCodec',
  description: 'Specifies how to serialize and deserialize this scalar. This is necessary for custom scalars to work with Cedar serialization. Adding, changing, or removing this directive is typically a breaking change.',
  locations: [
    DirectiveLocation.SCALAR,
    DirectiveLocation.ENUM,
    // DirectiveLocation.FIELD, // optionally, we could support dynamic encodings like this
  ],
  args: {
    codec: {
      description: 'The codec to use to serialize and deserialize this scalar.',
      type: new GraphQLNonNull(CedarCodecType),
    },
    fixedLength: {
      type: GraphQLInt,
      description: 'For the FIXED codec only: the length of the encoded value in bytes. Required for FIXED, and invalid for all other codecs.',
    },
  },
  isRepeatable: false,
})

function getDirectiveByName(directives: readonly ConstDirectiveNode[] | undefined, name: string): ConstDirectiveNode | undefined {
  return directives?.find(d => d.name.value === name)
}

// TODO: make the directive reading below more robust

export function getCedarCodecDirectiveValue(scalar: GraphQLScalarType): Wire.Type | undefined {
  const directive = getDirectiveByName(scalar.astNode?.directives, CedarCodecDirective.name)
  if (directive == undefined) return undefined
  const codec = (directive.arguments?.find(a => a.name.value === 'codec')?.value as StringValueNode)?.value
  const fixedLengthNode = directive.arguments?.find(a => a.name.value === 'fixedLength')?.value
  let length: number | undefined
  if (fixedLengthNode == undefined || fixedLengthNode?.kind == 'NullValue') { }
  else if (fixedLengthNode?.kind == 'IntValue') length = parseInt(fixedLengthNode.value)
  else throw 'Invalid fixedLength kind on CedarCodecDirective: ' + fixedLengthNode?.kind
  let wire: Wire.Type
  switch (codec as CedarCodec) {
    case CedarCodec.String: wire = Wire.STRING; break
    case CedarCodec.Int: wire = Wire.VARINT; break
    case CedarCodec.Float: wire = Wire.FLOAT64; break
    case CedarCodec.Boolean: wire = Wire.BOOLEAN; break
    case CedarCodec.BYTES: wire = Wire.BYTES; break
    case CedarCodec.FIXED:
      if (length == null) throw 'fixedLength argument is required on CedarCodecDirective for FIXED codec'
      wire = { type: Wire.TypeKey.FIXED, length }
      break
    default: throw 'Invalid codec value on CedarCodecDirective'
  }
  if (length != null && codec != CedarCodec.FIXED) {
    throw 'fixedLength argument on CedarCodecDirective is only allowed for FIXED codec, not ' + codec
  }

  return wire
}

export function getCedarDeduplicateDirectiveValue(scalar: GraphQLScalarType): boolean | undefined {
  const directive = getDirectiveByName(scalar.astNode?.directives, CedarDeduplicateDirective.name)
  if (directive == undefined) return undefined
  const deduplicateNode = directive.arguments?.find(a => a.name.value === 'deduplicate')?.value
  let deduplicate: boolean | undefined
  if (deduplicateNode?.kind == 'NullValue') { deduplicate = true } // default on CedarDeduplicateDirective
  else if (deduplicateNode?.kind == 'BooleanValue') deduplicate = deduplicateNode.value
  else throw 'Invalid deduplicate value on CedarCodecDirective'
}