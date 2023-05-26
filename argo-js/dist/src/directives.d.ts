import { GraphQLDirective, GraphQLEnumType, GraphQLScalarType } from "graphql";
import { Wire } from "./wire";
/** Marks a type for de-duplication. Works best with large values which re-appear often. */
export declare const ArgoDeduplicateDirective: GraphQLDirective;
export declare enum ArgoCodec {
    String = "String",
    Int = "Int",
    Float = "Float",
    Boolean = "Boolean",
    BYTES = "BYTES",
    FIXED = "FIXED"
}
/** Describes the Argo codecs which are available */
export declare const ArgoCodecType: GraphQLEnumType;
/** Specifies how to encode and decode a (custom) Scalar */
export declare const ArgoCodecDirective: GraphQLDirective;
export declare function getArgoCodecDirectiveValue(node: GraphQLScalarType | GraphQLEnumType): Wire.Type | undefined;
export declare function getArgoDeduplicateDirectiveValue(node: GraphQLScalarType | GraphQLEnumType): boolean | undefined;
