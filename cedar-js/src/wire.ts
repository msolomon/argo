
import { GraphQLError, Kind, SelectionNode, GraphQLType, FieldNode, DocumentNode, GraphQLSchema } from 'graphql'
import * as graphql from 'graphql'
import { groupBy } from './util'
import { CedarCodecDirective, CedarDeduplicateDirective, getCedarCodecDirectiveValue, getCedarDeduplicateDirectiveValue } from './directives'

export namespace Wire {
  export type Type =
    | Wire.STRING
    | Wire.BOOLEAN
    | Wire.INT32
    | Wire.FLOAT64
    | Wire.BYTES
    | Wire.BLOCK
    | Wire.ARRAY
    | Wire.NULLABLE
    | Wire.RECORD
    | Wire.FIXED

  export type BlockKey = string

  export enum Primitive {
    STRING = "STRING",
    BOOLEAN = "BOOLEAN",
    INT32 = "INT32",
    FLOAT64 = "FLOAT64",
    BYTES = "BYTES",
  }

  export enum Compound {
    BLOCK = "BLOCK",
    NULLABLE = "NULLABLE",
    ARRAY = "ARRAY",
    RECORD = "RECORD",
    FIXED = "FIXED", // not exactly compound, but it's paramaterized by size
  }

  export type STRING = { type: Primitive.STRING }
  export const STRING = { type: Primitive.STRING }
  export type BOOLEAN = { type: Primitive.BOOLEAN }
  export const BOOLEAN = { type: Primitive.BOOLEAN }
  export type INT32 = { type: Primitive.INT32 }
  export const INT32 = { type: Primitive.INT32 }
  export type FLOAT64 = { type: Primitive.FLOAT64 }
  export const FLOAT64 = { type: Primitive.FLOAT64 }
  export type BYTES = { type: Primitive.BYTES }
  export const BYTES = { type: Primitive.BYTES }
  export type BLOCK = { type: Compound.BLOCK, of: Wire.Type, key: BlockKey, dedupe: boolean }
  export type ARRAY = { type: Compound.ARRAY, of: Wire.Type }
  export type NULLABLE = { type: Compound.NULLABLE, of: Wire.Type }
  export type RECORD = { type: Compound.RECORD, fields: Wire.Field[] }
  export type FIXED = { type: Compound.FIXED, length: number }

  export type Field = {
    "name": string,
    type: Wire.Type,
    omittable: boolean
  }

  export function isSTRING(type: Wire.Type): type is Wire.STRING { return type.type == "STRING" }
  export function isBOOLEAN(type: Wire.Type): type is Wire.BOOLEAN { return type.type == "BOOLEAN" }
  export function isINT32(type: Wire.Type): type is Wire.INT32 { return type.type == "INT32" }
  export function isFLOAT64(type: Wire.Type): type is Wire.FLOAT64 { return type.type == "FLOAT64" }
  export function isBYTES(type: Wire.Type): type is Wire.BYTES { return type.type == "BYTES" }
  export function isBLOCK(type: Wire.Type): type is Wire.BLOCK { return (type as Wire.BLOCK).type == "BLOCK" }
  export function isARRAY(type: Wire.Type): type is Wire.ARRAY { return (type as Wire.ARRAY).type == "ARRAY" }
  export function isNULLABLE(type: Wire.Type): type is Wire.NULLABLE { return (type as Wire.NULLABLE).type == "NULLABLE" }
  export function isRECORD(type: Wire.Type): type is Wire.RECORD { return (type as Wire.RECORD).type == "RECORD" }
  export function isFIXED(type: Wire.Type): type is Wire.FIXED { return (type as Wire.FIXED).type == "FIXED" }

  export function isLabeled(wt: Wire.Type): Boolean { // do values start with a Label
    return isNULLABLE(wt) || isSTRING(wt) || isBOOLEAN(wt) || isBYTES(wt) || isARRAY(wt) || (isBLOCK(wt) && isLabeled(wt.of))
  }

  export function nullable(wt: Wire.Type): Wire.NULLABLE {
    return { type: Compound.NULLABLE, of: wt }
  }

  export function block(of: Wire.Type, key: BlockKey, dedupe: boolean): Wire.BLOCK {
    return { type: Compound.BLOCK, of, key, dedupe }
  }

  export function print(wt: Wire.Type, indent: number = 0): string {
    const idnt = (plus: number = 0) => " ".repeat(indent + plus)
    const recurse = (wt: Wire.Type): string => print(wt, indent + 1)
    const inner = () => {
      if (Wire.isSTRING(wt)) return wt.type
      else if (Wire.isINT32(wt)) return wt.type
      else if (Wire.isBOOLEAN(wt)) return wt.type
      else if (Wire.isFLOAT64(wt)) return wt.type
      else if (Wire.isBYTES(wt)) return wt.type
      else if (Wire.isNULLABLE(wt)) return recurse(wt.of) + "?"
      else if (Wire.isBLOCK(wt)) return recurse(wt.of) + wt.dedupe ? "<" : "{" + wt.key + wt.dedupe ? ">" : "}"
      else if (Wire.isARRAY(wt)) return recurse(wt.of) + "[]"
      else if (Wire.isRECORD(wt)) {
        const fs = wt.fields.map(({ name, type, omittable }) => idnt(1) + `${name}${omittable ? "?" : ""}: ${recurse(type).trimStart()}`)
        return "{\n" + fs.join("\n") + "\n" + idnt() + "}"
      }
      else throw "Programmer error: print can't handle " + JSON.stringify(wt)
    }
    return idnt() + inner()
  }
}

export function deduplicateByDefault(t: Wire.Type): boolean {
  switch (t.type) {
    case 'STRING': return true
    case 'BOOLEAN': return false
    case 'INT32': return false
    case 'FLOAT64': return false
    case 'BYTES': return true
    case 'FIXED': return false
    default: throw 'Programmer error: deduplicateByDefault does not make senes for ' + JSON.stringify(t)
  }
}

type SelectedFieldNode = {
  selectedBy: SelectionNode,
  field: FieldNode,
}

/**
 * Typer converts types from GraphQL schemas and documents (queries) to Cedar Wire types.
 */
export class Typer {
  private fragments: Map<string, graphql.FragmentDefinitionNode> = new Map()
  readonly types: Map<FieldNode, Wire.Type> = new Map()

  private _operation: graphql.OperationDefinitionNode | undefined;
  public get operation(): graphql.OperationDefinitionNode { return this._operation! }

  // private _directives: graphql.DirectiveDefinitionNode | undefined;
  public get directives(): graphql.GraphQLDirective[] {
    return [CedarCodecDirective, CedarDeduplicateDirective]
  }

  constructor(readonly schema: GraphQLSchema, readonly query: DocumentNode, operationName?: string) {
    for (const definition of query.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        if (operationName == null) {
          if (this._operation !== undefined) {
            throw new GraphQLError('Must provide operation name if query contains multiple operations')
          }
          this._operation = definition;
        } else if (definition.name?.value === operationName) {
          this._operation = definition
        }
      } else if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        this.fragments.set(definition.name.value, definition)
      }
    }
  }

  get rootType(): graphql.GraphQLObjectType<unknown, unknown> {
    const type = this.schema.getRootType(this.operation.operation)
    if (!type) throw "Constructed without root type"
    return type
  }

  rootWireType(): Wire.Type {
    const getField = this.makeGetField(this.rootType)
    const data = this.collectFieldWireTypes(this.rootType, this.operation.selectionSet, getField)
    return { type: Wire.Compound.RECORD, fields: [{ name: "data", type: Wire.nullable(data), omittable: false }] }
  }

  // this follows the spec's CollectFields, but is modified to require no runtime information
  // we note where we "deviate from the GraphQL spec", however, because this is not an _implementation_
  // of of the spec, it does _not_ violate the spec--it just differs
  collectFieldsStatic = (selectionSet: graphql.SelectionSetNode, visitedFragments: Set<string> = new Set()): Map<string, SelectedFieldNode[]> => {
    const groupedFields: Map<string, SelectedFieldNode[]> = new Map()
    const getGroupedField = (responseKey: string): SelectedFieldNode[] => {
      if (!groupedFields.has(responseKey)) groupedFields.set(responseKey, [])
      return groupedFields.get(responseKey)!
    }
    for (const selection of selectionSet.selections) {
      if ( // Spec deviation 3.a.i: skip only if we always skip (cannot depend on arguments)
        selection.directives?.some(dn => dn.name.value == 'skip' &&
          dn.arguments?.some(an => (an.value as graphql.BooleanValueNode).value == true))
      ) continue
      if ( // Spec deviation 3.b.i: skip only if we always skip (cannot depend on arguments)
        selection.directives?.some(dn => dn.name.value == 'include' &&
          dn.arguments?.some(an => (an.value as graphql.BooleanValueNode).value == false))
      ) continue
      if (selection.kind == Kind.FIELD) {
        const responseKey = selection.alias?.value ?? selection.name.value
        const groupForResponseKey = getGroupedField(responseKey)
        groupForResponseKey.push({ selectedBy: selection, field: selection })
      } else if (selection.kind == Kind.FRAGMENT_SPREAD) {
        const fragmentSpreadName = selection.name.value
        if (visitedFragments.has(fragmentSpreadName)) continue
        visitedFragments.add(fragmentSpreadName)
        const fragment = this.fragments.get(fragmentSpreadName)!
        // Spec deviation 3.d.v: fail instead of continuing
        if (fragment == null) throw `Referenced Fragment did not exist: ${fragmentSpreadName}`
        // Spec deviation 3.d.vi-vii: fragment may apply to anything here
        const fragmentSelectionSet = fragment.selectionSet
        const fragmentGroupedFieldSet = this.collectFieldsStatic(fragmentSelectionSet, new Set(visitedFragments))
        for (const [responseKey, fragmentGroup] of fragmentGroupedFieldSet.entries()) {
          const groupForResponseKey = getGroupedField(responseKey)
          groupForResponseKey.push(...fragmentGroup.map(sfn => { return { selectedBy: selection, field: sfn.field } }))
        }
      } else if (selection.kind == Kind.INLINE_FRAGMENT) {
        // Spec deviation 3.e.i-ii: fragment may apply to anything here
        const fragmentSelectionSet = selection.selectionSet
        const fragmentGroupedFieldSet = this.collectFieldsStatic(fragmentSelectionSet, new Set(visitedFragments))
        for (const [responseKey, fragmentGroup] of fragmentGroupedFieldSet.entries()) {
          const groupForResponseKey = getGroupedField(responseKey)
          groupForResponseKey.push(...fragmentGroup.map(sfn => { return { selectedBy: selection, field: sfn.field } }))
        }
      } else { throw "Programmer error" }
    }
    return groupedFields
  }

  /** Get an underlying type, discarding List and Non-null wrappers */
  static unwrap(t: GraphQLType): graphql.GraphQLType {
    if (graphql.isWrappingType(t)) return Typer.unwrap(t.ofType)
    else return t
  }

  /**
   * This recursively determines the wire types for a given selectionset.
   * It also populates `this.types` so that wire types may be looked up by FieldNode.
   * 
   * @param selectionSet 
   * @param getField 
   * @returns 
   */
  collectFieldWireTypes = (
    selectionType: GraphQLType,
    selectionSet: graphql.SelectionSetNode,
    getField: (n: string) => graphql.GraphQLField<unknown, unknown>
  ): Wire.Type => {
    let recordFields: Wire.Field[] = []
    const recordNodes: FieldNode[] = []
    for (const [alias, fields] of this.collectFieldsStatic(selectionSet)) {
      for (const { field, selectedBy } of fields) {
        let typeCondition: string | undefined = undefined
        if (selectedBy.kind == Kind.FRAGMENT_SPREAD) {
          typeCondition = this.fragments.get(selectedBy.name.value)!.typeCondition.name.value
        } else if (selectedBy.kind == Kind.INLINE_FRAGMENT) {
          typeCondition = selectedBy.typeCondition?.name.value
        }
        const omittable = typeCondition != null && Typer.unwrap(selectionType).toString() != typeCondition

        const f = getField(field.name.value)
        if (field.selectionSet) {
          const wrapRecord = this.unwrapForSelectionSet(this.typeToWireType(f.type)).wrap
          recordNodes.push(field)
          const getField = this.makeGetField(f.type)
          const type = wrapRecord(this.collectFieldWireTypes(f.type, field.selectionSet, getField))
          const wfield: Wire.Field = { name: alias, type, omittable }
          recordFields.push(wfield)
        } else {
          const type = this.typeToWireType(f.type)
          this.types.set(field, type)
          recordFields.push({ name: alias, type, omittable })
        }
      }
    }

    const record = this.groupOverlapping(recordFields)
    for (const field of recordNodes) { this.types.set(field, record) }
    return record
  }

  // if we have overlapping selections, merge them into a canonical order
  groupOverlapping(fields: Wire.Field[]): Wire.RECORD {
    let recordFields = fields
    const grouped = groupBy(recordFields, f => f.name)
    if (Array.from(grouped.values()).some(g => g.length > 1)) { // need to merge overlapping fields
      recordFields = []
      for (const [name, fields] of grouped) {
        let wrapRecord = (n: Wire.Type) => n
        if (fields.length == 1) recordFields.push(...fields)
        else {
          const combinedFields: Wire.Field[] = []
          const nodesToUpdate: FieldNode[] = []
          for (const { type } of fields) {
            const { record, wrap } = this.unwrapForSelectionSet(type)
            wrapRecord = wrap
            combinedFields.push(...record.fields)

            for (const [node, wtype] of this.types) { // TODO: optimize, probably with a reverse map
              if (wtype === type) { nodesToUpdate.push(node) }
            }
          }
          // recurses to merge the subqueries as well
          const type: Wire.Type = wrapRecord(this.groupOverlapping(combinedFields))
          for (const node of nodesToUpdate) {
            this.types.set(node, type)
          }

          recordFields.push({ name, type, omittable: false })
        }
      }
    }
    const record: Wire.Type = { type: Wire.Compound.RECORD, fields: recordFields }
    return record
  }


  /**
   * Converts a GraphQL type to a wire type, provided it is _not_ a record, union, or interface.
   * 
   * @param t 
   * @returns 
   */
  typeToWireType = (t: GraphQLType): Wire.Type => {
    if (graphql.isScalarType(t)) {
      let wtype: Wire.Type
      const codec = getCedarCodecDirectiveValue(t)
      const deduplicate = getCedarDeduplicateDirectiveValue(t)

      switch (t) {
        case graphql.GraphQLString:
        case graphql.GraphQLID:
          wtype = Wire.block(codec ?? Wire.STRING, t.name, deduplicate ?? deduplicateByDefault(Wire.STRING))
          break
        case graphql.GraphQLInt:
          wtype = Wire.block(codec ?? Wire.INT32, t.name, deduplicate ?? deduplicateByDefault(Wire.INT32))
          break
        case graphql.GraphQLFloat:
          wtype = Wire.block(codec ?? Wire.FLOAT64, t.name, deduplicate ?? deduplicateByDefault(Wire.FLOAT64))
          break
        case graphql.GraphQLBoolean:
          if (deduplicate) throw 'Boolean fields cannot be deduplicated'
          wtype = Wire.BOOLEAN; break
        default:
          if (codec == null) throw 'Custom scalars must have a CedarCodec directive. Missing on ' + t.name
          wtype = Wire.block(codec, t.name, deduplicate ?? deduplicateByDefault(codec))
      }
      return Wire.nullable(wtype)
    } else if (graphql.isListType(t)) {
      return Wire.nullable({ type: Wire.Compound.ARRAY, of: this.typeToWireType(t.ofType) })
    } else if (graphql.isObjectType(t) || graphql.isInterfaceType(t) || graphql.isUnionType(t)) {
      return Wire.nullable({ type: Wire.Compound.RECORD, fields: [] })
    } else if (graphql.isNonNullType(t)) {
      const nullable = this.typeToWireType(t.ofType)
      return (nullable as { type: Wire.Compound.NULLABLE, of: Wire.Type }).of
    } else if (graphql.isEnumType(t)) {
      return Wire.nullable(Wire.block(Wire.STRING, t.name, true))
    } else {
      throw 'unsupported type ' + t
    }
  }

  unwrapForSelectionSet(wt: Wire.Type): { record: Wire.RECORD, wrap: (r: Wire.Type) => Wire.Type } {
    if (Wire.isRECORD(wt)) {
      return { record: wt, wrap: (wt: Wire.Type) => wt }
    } else if (Wire.isNULLABLE(wt)) {
      const { record, wrap } = this.unwrapForSelectionSet(wt.of)
      return { record, wrap: (r: Wire.Type) => Wire.nullable(wrap(r)) }
    } else if (Wire.isBLOCK(wt)) {
      const { record, wrap } = this.unwrapForSelectionSet(wt.of)
      return {
        record, wrap: (r: Wire.Type) => {
          return { type: Wire.Compound.BLOCK, of: wrap(r), key: wt.key, dedupe: wt.dedupe }
        }
      }
    } else if (Wire.isARRAY(wt)) {
      const { record, wrap } = this.unwrapForSelectionSet(wt.of)
      return { record, wrap: (r: Wire.Type) => { return { type: Wire.Compound.ARRAY, of: wrap(r) } } }
    } else {
      throw 'tried to unwrap type which does not have selection set: ' + wt.toString()
    }
  }

  makeGetField = (t: GraphQLType): ((n: string) => graphql.GraphQLField<unknown, unknown>) => {
    if ((graphql.isObjectType(t) || graphql.isInterfaceType(t)) || graphql.isUnionType(t)) {
      return this.getFieldFromSelection(t)
    } else if (graphql.isListType(t) || graphql.isNonNullType(t)) {
      return this.makeGetField(t.ofType)
    } else { throw 'Unexpected type ' + t }
  }

  private getFieldFromSelection = (t: graphql.GraphQLObjectType | graphql.GraphQLInterfaceType | graphql.GraphQLUnionType): ((n: string) => graphql.GraphQLField<unknown, unknown>) => {
    let fields: graphql.GraphQLFieldMap<any, any> = {}
    if (graphql.isUnionType(t)) {
      for (const obj of this.schema.getPossibleTypes(t)) {
        fields = { ...obj.getFields(), ...fields }
      }
    } else {
      fields = t.getFields()
    }
    if (graphql.isInterfaceType(t)) { // selection may come from any implementing object
      for (const obj of this.schema.getImplementations(t).objects) {
        fields = { ...obj.getFields(), ...fields }
      }
    }
    return (n: string) => {
      switch (n) {
        case graphql.SchemaMetaFieldDef.name: return graphql.SchemaMetaFieldDef
        case graphql.TypeNameMetaFieldDef.name: return graphql.TypeNameMetaFieldDef
        case graphql.TypeMetaFieldDef.name: return graphql.TypeMetaFieldDef
        default:
          const field = fields[n]
          if (!field) {
            throw `Could not get field ${n} from ${t.toString()}`
          }
          return field
      }
    }
  }
}