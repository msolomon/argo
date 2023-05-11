
import { GraphQLCompositeType, GraphQLError, Kind, visit, SelectionNode, GraphQLType, FieldNode, ExecutionResult, ASTNode, OperationTypeNode, ResponsePath, GraphQLTypeResolver, GraphQLFieldResolver, GraphQLAbstractType, DocumentNode, GraphQLResolveInfo, GraphQLSchema, TypedQueryDocumentNode, } from 'graphql'
import * as graphql from 'graphql'

export namespace Wire {
  export type Type =
    | Wire.STRING
    | Wire.NULL
    | Wire.BOOLEAN
    | Wire.INT32
    | Wire.FLOAT64
    | Wire.BYTES
    | Wire.DEDUPE
    | Wire.ARRAY
    | Wire.NULLABLE
    | Wire.RECORD
    | Wire.VARIANT
    | Wire.FIXED

  export type DedupeKey = string

  export type STRING = Primitive.STRING
  export type NULL = Primitive.NULL
  export type BOOLEAN = Primitive.BOOLEAN
  export type INT32 = Primitive.INT32
  export type FLOAT64 = Primitive.FLOAT64
  export type BYTES = Primitive.BYTES
  export type DEDUPE = { type: "DEDUPE", key: DedupeKey, of: Wire.Type }
  export type ARRAY = { type: "ARRAY", of: Wire.Type }
  export type NULLABLE = { type: "NULLABLE", of: Wire.Type }
  export type RECORD = { type: "RECORD", fields: Wire.Field[] }
  export type VARIANT = { type: "VARIANT", members: Wire.Member[] } // TODO: use?
  export type FIXED = { type: "FIXED", length: number } // TODO: use?

  export enum Primitive {
    STRING = "STRING",
    NULL = "NULL",
    BOOLEAN = "BOOLEAN",
    INT32 = "INT32",
    FLOAT64 = "FLOAT64",
    BYTES = "BYTES",
  }

  export type Field = {
    "name": string,
    type: Wire.Type,
    omittable: boolean
  }

  export type Member = {
    "name": string,
    type: Wire.Type
  }

  export function isSTRING(type: Wire.Type): type is Wire.STRING { return type == Primitive.STRING }
  export function isNULL(type: Wire.Type): type is Wire.NULL { return type == Primitive.NULL }
  export function isBOOLEAN(type: Wire.Type): type is Wire.BOOLEAN { return type == Primitive.BOOLEAN }
  export function isINT32(type: Wire.Type): type is Wire.INT32 { return type == Primitive.INT32 }
  export function isFLOAT64(type: Wire.Type): type is Wire.FLOAT64 { return type == Primitive.FLOAT64 }
  export function isBYTES(type: Wire.Type): type is Wire.BYTES { return type == Primitive.BYTES }
  export function isDEDUPE(type: Wire.Type): type is Wire.DEDUPE { return (type as Wire.DEDUPE).type == "DEDUPE" }
  export function isARRAY(type: Wire.Type): type is Wire.ARRAY { return (type as Wire.ARRAY).type == "ARRAY" }
  export function isNULLABLE(type: Wire.Type): type is Wire.NULLABLE { return (type as Wire.NULLABLE).type == "NULLABLE" }
  export function isRECORD(type: Wire.Type): type is Wire.RECORD { return (type as Wire.RECORD).type == "RECORD" }
  export function isVARIANT(type: Wire.Type): type is Wire.VARIANT { return (type as Wire.VARIANT).type == "VARIANT" }
  export function isFIXED(type: Wire.Type): type is Wire.FIXED { return (type as Wire.FIXED).type == "FIXED" }
  export function isLabeled(wt: Wire.Type): Boolean { // do values start with a Label
    return isNULLABLE(wt) || isSTRING(wt) || isBOOLEAN(wt) || isBYTES(wt) || isARRAY(wt) || isVARIANT(wt) || (isDEDUPE(wt) && isLabeled(wt.of))
  }
  export function isPrefixed(wt: Wire.Type): Boolean { // do values start with a Label or null mask?
    return isSTRING(wt) || isBOOLEAN(wt) || isBYTES(wt) || isARRAY(wt) || isVARIANT(wt) || isRECORD(wt) || (isDEDUPE(wt) && isPrefixed(wt.of))
  }
  export function isNullMasked(wt: Wire.Type): Boolean { // do values start with a Label or null mask?
    return isRECORD(wt) || (isDEDUPE(wt) && isNullMasked(wt.of))
  }
  export function nullable(wt: Wire.Type): Wire.NULLABLE {
    return { type: "NULLABLE", of: wt }
  }
  export function print(wt: Wire.Type, indent: number = 0): string {
    const idnt = (plus: number = 0) => " ".repeat(indent + plus)
    const recurse = (wt: Wire.Type): string => print(wt, indent + 1)
    const inner = () => {
      if (Wire.isSTRING(wt)) return "STRING"
      else if (Wire.isNULL(wt)) return "NULL"
      else if (Wire.isINT32(wt)) return "INT32"
      else if (Wire.isBOOLEAN(wt)) return "BOOLEAN"
      else if (Wire.isNULLABLE(wt)) return recurse(wt.of) + "?"
      else if (Wire.isDEDUPE(wt)) return recurse(wt.of) + "{" + wt.key + "}"
      else if (Wire.isARRAY(wt)) return recurse(wt.of) + "[]"
      else if (Wire.isRECORD(wt)) {
        const fs = wt.fields.map(({ name, type, omittable }) => idnt(1) + `${name}${omittable ? "?" : ""}: ${recurse(type).trimStart()}`)
        return "{\n" + fs.join("\n") + "\n" + idnt() + "}"
      }
      else if (Wire.isVARIANT(wt)) {
        return wt.members.map(wt => wt.name + "<" + print(wt.type) + ">").join(" | ").replaceAll("<NULL>", "")
      } else throw wt
    }
    return idnt() + inner()
  }
}

type SelectedFieldNode = {
  selectedBy: SelectionNode,
  field: FieldNode,
}

export class Typer {
  private fragments: Map<string, graphql.FragmentDefinitionNode> = new Map()
  readonly types: Map<FieldNode, Wire.Type> = new Map()

  private _operation: graphql.OperationDefinitionNode | undefined;
  public get operation(): graphql.OperationDefinitionNode { return this._operation! }

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
    return { type: "RECORD", fields: [{ name: "data", type: Wire.nullable(data), omittable: false }] }
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
          // console.log('selected by name', selection.name.value, fragmentGroup.map(sfn => { return sfn.field.alias ?? sfn.field.name.value }))
          groupForResponseKey.push(...fragmentGroup.map(sfn => { return { selectedBy: selection, field: sfn.field } }))
        }
      } else if (selection.kind == Kind.INLINE_FRAGMENT) {
        // Spec deviation 3.e.i-ii: fragment may apply to anything here
        const fragmentSelectionSet = selection.selectionSet
        const fragmentGroupedFieldSet = this.collectFieldsStatic(fragmentSelectionSet, new Set(visitedFragments))
        for (const [responseKey, fragmentGroup] of fragmentGroupedFieldSet.entries()) {
          const groupForResponseKey = getGroupedField(responseKey)
          // console.log('selected inline', selection.typeCondition?.name.value, fragmentGroup.map(sfn => { return sfn.field.alias ?? sfn.field.name.value }))
          groupForResponseKey.push(...fragmentGroup.map(sfn => { return { selectedBy: selection, field: sfn.field } }))
        }
      } else { throw "Programmer error" }
    }
    return groupedFields
  }

  unwrap(t: GraphQLType): graphql.GraphQLType {
    if (graphql.isWrappingType(t)) return this.unwrap(t.ofType)
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
        const omittable = typeCondition != null && this.unwrap(selectionType).toString() != typeCondition

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

    // console.log('@@ wrapping', this.groupOverlapping(recordFields), '\nafter:', wrapRecord(this.groupOverlapping(recordFields)))
    // const result = wrapRecord(this.groupOverlapping(recordFields))
    const record = this.groupOverlapping(recordFields)
    for (const field of recordNodes) { this.types.set(field, record) }
    return record
  }

  // if we have overlapping selections, merge them into a canonical order
  groupOverlapping(fields: Wire.Field[]): Wire.RECORD {
    let recordFields = fields
    // let isList = false
    const grouped = this.groupBy(recordFields, f => f.name)
    if (Array.from(grouped.values()).some(g => g.length > 1)) { // need to merge overlapping fields
      recordFields = []
      for (const [name, fields] of grouped) {
        let wrapRecord = (n: Wire.Type) => n
        if (fields.length == 1) recordFields.push(...fields)
        else {
          // console.warn('@@ grouping', name)
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
    const record: Wire.Type = { type: "RECORD", fields: recordFields }
    return record
  }

  private groupBy<T, K>(array: T[], extract: (t: T) => K): Map<K, T[]> {
    const grouped = new Map<K, T[]>()
    for (const element of array) {
      const key = extract(element)
      const group = grouped.get(key)
      if (group == undefined) grouped.set(key, [element])
      else group.push(element)
    }
    return grouped
  }

  typeToWireType = (t: GraphQLType): Wire.Type => {
    if (graphql.isScalarType(t)) {
      let wtype: Wire.Type
      switch (t) {
        case graphql.GraphQLString:
          wtype = { type: "DEDUPE", key: "String", of: Wire.Primitive.STRING }
          break
        case graphql.GraphQLID:
          wtype = { type: "DEDUPE", key: "ID", of: Wire.Primitive.STRING }
          break
        case graphql.GraphQLInt: wtype = Wire.Primitive.INT32; break
        case graphql.GraphQLBoolean: wtype = Wire.Primitive.BOOLEAN; break
        case graphql.GraphQLFloat: wtype = Wire.Primitive.FLOAT64; break
        default:
          // TODO: don't assume all custom scalars are encoded as strings, respect CedarEncoding directive instead
          // throw 'custom scalars not yet supported; ' + t.toString() // TODO: support
          // console.log('custom scalars not yet supported ', t.toString()) // TODO: support
          // t.astNode?.directives?.find(d => d.name.value == "CedarEncoding")?.arguments
          wtype = { type: "DEDUPE", key: t.toString(), of: Wire.Primitive.STRING }
          break
      }
      return Wire.nullable(wtype)
    } else if (graphql.isListType(t)) {
      return Wire.nullable({ type: "ARRAY", of: this.typeToWireType(t.ofType) })
      // return Wire.nullable(this.typeToWireType(t.ofType))
    } else if (graphql.isObjectType(t) || graphql.isInterfaceType(t)) {
      // const fields: Wire.Field[] = Object.values(t.getFields())
      //   .map(f => { return { name: f.name, type: this.typeToWire.Type(f.type) } })
      return Wire.nullable({ type: "RECORD", fields: [] })
    } else if (graphql.isUnionType(t)) {
      return Wire.nullable({ type: "RECORD", fields: [] })
    } else if (graphql.isNonNullType(t)) {
      const nullable = this.typeToWireType(t.ofType)
      return (nullable as { type: "NULLABLE", of: Wire.Type }).of
    } else if (graphql.isEnumType(t)) {
      // const members: Wire.Member[] = t.getValues()
      //   .map(ev => { return { name: ev.name, type: Wire.Primitive.NULL } })
      // return Wire.nullable({ type: "VARIANT", members })
      return Wire.nullable({ type: "DEDUPE", key: "Enum", of: Wire.Primitive.STRING })

      // } else if (graphql.isInterfaceType(t)) {
      //   const members: WireMember[] = this.schema.getImplementations(t).objects
      //     .map(ot => { return { name: ot.name, type: this.typeToWire.Type(ot) } })
      //   return { type: "VARIANT", members }
      // } else if (graphql.isUnionType(t)) {
      //   const members: Wire.Member[] = t.getTypes()
      //     .map(ot => { return { name: ot.name, type: this.typeToWireType(ot) } })
      //   return Wire.nullable({ type: "VARIANT", members })
    } else if (graphql.isObjectType(t) || graphql.isInterfaceType(t) || graphql.isUnionType(t)) {
      throw "This method should not be used for compound types " + t.toString()
    } else {
      throw 'unsupported type ' + t
    }
  }

  // unwrapSelectionSet(t: GraphQLType): { record: Wire.RECORD, wrap: (r: Wire.Type) => Wire.Type } {
  //   if (graphql.isNonNullType(t)) {
  //     const { record, wrap } = this.unwrapSelectionSet(t.ofType)
  //     return { record, wrap: (r: Wire.Type) => Wire.nullable(wrap(r)) }
  //   } else if (graphql.isListType(t)) {
  //     const { record, wrap } = this.unwrapSelectionSet(t.ofType)
  //     return { record, wrap: (r: Wire.Type) => { return { type: "ARRAY", of: wrap(r) } } }
  //   } else {
  //     throw 'tried to unwrap type which does not have selection set: ' + t.toString()
  //   }
  // }

  unwrapForSelectionSet(wt: Wire.Type): { record: Wire.RECORD, wrap: (r: Wire.Type) => Wire.Type } {
    if (Wire.isRECORD(wt)) {
      return { record: wt, wrap: (wt: Wire.Type) => wt }
    } else if (Wire.isNULLABLE(wt)) {
      const { record, wrap } = this.unwrapForSelectionSet(wt.of)
      return { record, wrap: (r: Wire.Type) => Wire.nullable(wrap(r)) }
    } else if (Wire.isDEDUPE(wt)) {
      const { record, wrap } = this.unwrapForSelectionSet(wt.of)
      return { record, wrap: (r: Wire.Type) => { return { type: "DEDUPE", key: wt.key, of: wrap(r) } } }
    } else if (Wire.isARRAY(wt)) {
      const { record, wrap } = this.unwrapForSelectionSet(wt.of)
      return { record, wrap: (r: Wire.Type) => { return { type: "ARRAY", of: wrap(r) } } }
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