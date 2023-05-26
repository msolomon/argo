import { SelectionNode, GraphQLType, FieldNode, DocumentNode, GraphQLSchema } from 'graphql';
import * as graphql from 'graphql';
import { Wire } from './wire';
type SelectedFieldNode = {
    selectedBy: SelectionNode;
    field: FieldNode;
};
/**
 * Typer converts types from GraphQL schemas and documents (queries) to Argo Wire types.
 */
export declare class Typer {
    readonly schema: GraphQLSchema;
    readonly query: DocumentNode;
    private fragments;
    readonly types: Map<FieldNode, Wire.Type>;
    private _operation;
    get operation(): graphql.OperationDefinitionNode;
    static readonly directives: graphql.GraphQLDirective[];
    constructor(schema: GraphQLSchema, query: DocumentNode, operationName?: string);
    get rootType(): graphql.GraphQLObjectType<unknown, unknown>;
    rootWireType(): Wire.Type;
    collectFieldsStatic: (selectionSet: graphql.SelectionSetNode, visitedFragments?: Set<string>) => Map<string, SelectedFieldNode[]>;
    /** Get an underlying type, discarding List and Non-null wrappers */
    static unwrap(t: GraphQLType): graphql.GraphQLType;
    /**
     * This recursively determines the wire types for a given selectionset.
     * It also populates `this.types` so that wire types may be looked up by FieldNode.
     */
    collectFieldWireTypes: (selectionType: GraphQLType, selectionSet: graphql.SelectionSetNode, getField: (n: string) => graphql.GraphQLField<unknown, unknown>) => Wire.Type;
    groupOverlapping(fields: Wire.Field[]): Wire.RECORD;
    /** Converts a GraphQL type to a wire type, provided it is _not_ a record, union, or interface. */
    typeToWireType: (t: GraphQLType) => Wire.Type;
    unwrapForSelectionSet(wt: Wire.Type): {
        record: Wire.RECORD;
        wrap: (r: Wire.Type) => Wire.Type;
    };
    makeGetField: (t: GraphQLType) => (n: string) => graphql.GraphQLField<unknown, unknown>;
    private getFieldFromSelection;
}
export {};
