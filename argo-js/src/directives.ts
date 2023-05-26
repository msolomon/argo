import { DirectiveLocation, DirectiveNode, GraphQLBoolean, GraphQLDirective, GraphQLEnumType, GraphQLInt, GraphQLNonNull, ConstDirectiveNode, GraphQLType, GraphQLScalarType, BooleanValueNode, StringValueNode, IntValueNode } from "graphql";
import { Wire } from "./wire";

/** Marks a type for de-duplication. Works best with large values which re-appear often. */
export const ArgoDeduplicateDirective = new GraphQLDirective({
  name: 'ArgoDeduplicate',
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

export enum ArgoCodec {
  String = 'String',
  Int = 'Int',
  Float = 'Float',
  Boolean = 'Boolean',
  BYTES = 'BYTES',
  FIXED = 'FIXED',
}

/** Describes the Argo codecs which are available */
export const ArgoCodecType = new GraphQLEnumType({
  name: 'ArgoCodecType',
  description: 'Specifies how to serialize and deserialize this scalar. Adding, changing, or removing this directive is typically a breaking change.',
  values: {
    String: {
      description: 'Serialize and deserialize a scalar as a GraphQL String (UTF-8).',
      value: ArgoCodec.String,
    },
    Int: {
      description: 'Serialize and deserialize a scalar as a GraphQL Int (32-bit signed integer).',
      value: ArgoCodec.Int,
    },
    Float: {
      description: 'Serialize and deserialize a scalar as a GraphQL Float (IEEE 754 double-precision floating-point).',
      value: ArgoCodec.Float,
    },
    Boolean: {
      description: 'Serialize and deserialize a scalar as a GraphQL Boolean.',
      value: ArgoCodec.Float,
    },
    BYTES: {
      description: 'Serialize and deserialize a scalar as Argo BYTES: a variable-length length-prefixed byte array.',
      value: ArgoCodec.BYTES,
    },
    FIXED: {
      description: 'Serialize and deserialize a scalar as Argo FIXED: a fixed-length byte array.',
      value: ArgoCodec.FIXED,
    },
  }
})

/** Specifies how to encode and decode a (custom) Scalar */
export const ArgoCodecDirective = new GraphQLDirective({
  name: 'ArgoCodec',
  description: 'Specifies how to serialize and deserialize this scalar. This is necessary for custom scalars to work with Argo serialization. Adding, changing, or removing this directive is typically a breaking change.',
  locations: [
    DirectiveLocation.SCALAR,
    DirectiveLocation.ENUM,
    // DirectiveLocation.FIELD, // optionally, we could support dynamic encodings like this
  ],
  args: {
    codec: {
      description: 'The codec to use to serialize and deserialize this scalar.',
      type: new GraphQLNonNull(ArgoCodecType),
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

export function getArgoCodecDirectiveValue(node: GraphQLScalarType | GraphQLEnumType): Wire.Type | undefined {
  const directive = getDirectiveByName(node.astNode?.directives, ArgoCodecDirective.name)
  if (directive == undefined) return undefined
  const codec = (directive.arguments?.find(a => a.name.value === 'codec')?.value as StringValueNode)?.value
  const fixedLengthNode = directive.arguments?.find(a => a.name.value === 'fixedLength')?.value
  let length: number | undefined
  if (fixedLengthNode == undefined || fixedLengthNode?.kind == 'NullValue') { }
  else if (fixedLengthNode?.kind == 'IntValue') length = parseInt(fixedLengthNode.value)
  else throw 'Invalid fixedLength kind on ArgoCodecDirective: ' + fixedLengthNode?.kind
  let wire: Wire.Type
  switch (codec as ArgoCodec) {
    case ArgoCodec.String: wire = Wire.STRING; break
    case ArgoCodec.Int: wire = Wire.VARINT; break
    case ArgoCodec.Float: wire = Wire.FLOAT64; break
    case ArgoCodec.Boolean: wire = Wire.BOOLEAN; break
    case ArgoCodec.BYTES: wire = Wire.BYTES; break
    case ArgoCodec.FIXED:
      if (length == null) throw 'fixedLength argument is required on ArgoCodecDirective for FIXED codec'
      wire = { type: Wire.TypeKey.FIXED, length }
      break
    default: throw 'Invalid codec value on ArgoCodecDirective'
  }
  if (length != null && codec != ArgoCodec.FIXED) {
    throw 'fixedLength argument on ArgoCodecDirective is only allowed for FIXED codec, not ' + codec
  }

  return wire
}

export function getArgoDeduplicateDirectiveValue(node: GraphQLScalarType | GraphQLEnumType): boolean | undefined {
  const directive = getDirectiveByName(node.astNode?.directives, ArgoDeduplicateDirective.name)
  if (directive == undefined) return undefined
  const deduplicateNode = directive.arguments?.find(a => a.name.value === 'deduplicate')?.value
  let deduplicate: boolean | undefined
  if (deduplicateNode?.kind == 'NullValue') { deduplicate = true } // default on ArgoDeduplicateDirective
  else if (deduplicateNode?.kind == 'BooleanValue') deduplicate = deduplicateNode.value
  else throw 'Invalid deduplicate value on ArgoCodecDirective'
}