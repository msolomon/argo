import { GraphQLError, Kind, SelectionNode, GraphQLType, FieldNode, DocumentNode, GraphQLSchema } from 'graphql'
import * as graphql from 'graphql'
import { groupBy } from './util'
import { ArgoCodecDirective, ArgoDeduplicateDirective, getArgoCodecDirectiveValue, getArgoDeduplicateDirectiveValue } from './directives'
import { Wire } from './wire'

type SelectedFieldNode = {
  selectedBy: SelectionNode
  field: FieldNode
}

/**
 * Typer converts types from GraphQL schemas and documents (queries) to Argo Wire types.
 */
export class Typer {
  private fragments: Map<string, graphql.FragmentDefinitionNode> = new Map()
  readonly types: Map<FieldNode, Wire.Type> = new Map()

  private _operation: graphql.OperationDefinitionNode | undefined
  public get operation(): graphql.OperationDefinitionNode {
    return this._operation!
  }

  static readonly directives: graphql.GraphQLDirective[] = [ArgoCodecDirective, ArgoDeduplicateDirective]

  constructor(readonly schema: GraphQLSchema, readonly query: DocumentNode, operationName?: string) {
    for (const definition of query.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        if (operationName == null) {
          if (this._operation !== undefined) {
            throw new GraphQLError('Must provide operation name if query contains multiple operations')
          }
          this._operation = definition
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
    if (!type) throw 'Constructed without root type'
    return type
  }

  rootWireType(): Wire.Type {
    const fields = [
      { name: 'data', of: Wire.nullable(this.dataWireType()), omittable: false },
      { name: 'errors', of: Wire.nullable({ type: Wire.TypeKey.ARRAY, of: Wire.DESC }), omittable: true },
    ]
    return { type: Wire.TypeKey.RECORD, fields }
  }

  dataWireType(): Wire.Type {
    const getField = this.makeGetField(this.rootType)
    return this.collectFieldWireTypes(this.rootType, this.operation.selectionSet, getField)
  }

  // this follows the spec's CollectFields, but is modified to require no runtime information
  // we note where we "deviate from the GraphQL spec", however, because this is not an _implementation_
  // of of the spec, it does _not_ violate the spec--it just differs
  collectFieldsStatic = (selectionSet: graphql.SelectionSetNode, visitedFragments: Set<string>): Map<string, SelectedFieldNode[]> => {
    const groupedFields: Map<string, SelectedFieldNode[]> = new Map()
    const getGroupedField = (responseKey: string): SelectedFieldNode[] => {
      if (!groupedFields.has(responseKey)) groupedFields.set(responseKey, [])
      return groupedFields.get(responseKey)!
    }
    for (const selection of selectionSet.selections) {
      if (
        // Spec deviation 3.a.i: skip only if we always skip (cannot depend on arguments)
        selection.directives?.some((dn) => dn.name.value == 'skip' && dn.arguments?.some((an) => (an.value as graphql.BooleanValueNode).value == true))
      )
        continue
      if (
        // Spec deviation 3.b.i: skip only if we always skip (cannot depend on arguments)
        selection.directives?.some((dn) => dn.name.value == 'include' && dn.arguments?.some((an) => (an.value as graphql.BooleanValueNode).value == false))
      )
        continue
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
          groupForResponseKey.push(
            ...fragmentGroup.map((sfn) => {
              return { selectedBy: selection, field: sfn.field }
            })
          )
        }
      } else if (selection.kind == Kind.INLINE_FRAGMENT) {
        // Spec deviation 3.e.i-ii: fragment may apply to anything here
        const fragmentSelectionSet = selection.selectionSet
        const fragmentGroupedFieldSet = this.collectFieldsStatic(fragmentSelectionSet, new Set(visitedFragments))
        for (const [responseKey, fragmentGroup] of fragmentGroupedFieldSet.entries()) {
          const groupForResponseKey = getGroupedField(responseKey)
          groupForResponseKey.push(
            ...fragmentGroup.map((sfn) => {
              return { selectedBy: selection, field: sfn.field }
            })
          )
        }
      } else {
        throw 'Programmer error'
      }
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
   */
  collectFieldWireTypes = (selectionType: GraphQLType, selectionSet: graphql.SelectionSetNode, getField: (n: string, typeCondition?: string) => graphql.GraphQLField<unknown, unknown>): Wire.Type => {
    let recordFields: Wire.Field[] = []
    const exactSelections: Set<string> = new Set()
    const recordNodes: FieldNode[] = []
    for (const [alias, fields] of this.collectFieldsStatic(selectionSet, new Set())) {
      const fieldMap = new Map<FieldNode, graphql.GraphQLField<unknown, unknown>>()
      for (const { field, selectedBy } of fields) {
        let typeCondition: string | undefined = undefined
        if (selectedBy.kind == Kind.FRAGMENT_SPREAD) {
          typeCondition = this.fragments.get(selectedBy.name.value)!.typeCondition.name.value
        } else if (selectedBy.kind == Kind.INLINE_FRAGMENT) {
          typeCondition = selectedBy.typeCondition?.name.value
        }
        let exactSelection = typeCondition === undefined || Typer.unwrap(selectionType).toString() == typeCondition
        if (exactSelection) exactSelections.add(field.alias?.value ?? field.name.value)
        fieldMap.set(field, getField(field.name.value, typeCondition))
      }

      for (const { field, selectedBy } of fields) {
        const f = fieldMap.get(field)!
        const omittable =
          !exactSelections.has(field.alias?.value ?? field.name.value) ||
          this.hasVariableIfDirective('include', field.directives) ||
          this.hasVariableIfDirective('skip', field.directives) ||
          this.hasVariableIfDirective('include', selectedBy.directives) ||
          this.hasVariableIfDirective('skip', selectedBy.directives)

        if (field.selectionSet) {
          const wrapRecord = this.unwrap(this.typeToWireType(f.type)).wrap
          recordNodes.push(field)
          const getField = this.makeGetField(f.type)
          const type = wrapRecord(this.collectFieldWireTypes(f.type, field.selectionSet, getField))
          const wfield: Wire.Field = { name: alias, of: type, omittable }
          recordFields.push(wfield)
        } else {
          const type = this.typeToWireType(f.type)
          this.types.set(field, type)
          recordFields.push({ name: alias, of: type, omittable })
        }
      }
    }

    const record = this.groupOverlapping(recordFields)
    for (const field of recordNodes) {
      this.types.set(field, record)
    }
    return record
  }

  // helper to return true if a @skip/@include has a variable `if` argument
  private hasVariableIfDirective(name: string, directives?: readonly graphql.DirectiveNode[]): boolean {
    const directive = directives?.find((dn) => dn.name.value == name)
    return directive?.arguments?.some((an) => an.name.value == 'if' && an.value.kind == Kind.VARIABLE) || false
  }

  // if we have overlapping selections, merge them into a canonical order
  groupOverlapping(fields: Wire.Field[]): Wire.RECORD {
    const merged: Wire.Field[] = []
    const grouped = groupBy(fields, (f) => f.name)
    for (const [name, fields] of grouped) {
      merged.push(fields.reduce(this.mergeFieldWireType.bind(this)))
    }
    return { type: Wire.TypeKey.RECORD, fields: merged }
  }

  mergeFieldWireType(a: Wire.Field, b: Wire.Field): Wire.Field {
    const { t, wrap } = this.unwrap(a.of)
    let type: Wire.Type
    if (Wire.isRECORD(t)) {
      type = wrap(this.mergeRecordWireType(t, this.unwrap(b.of).t as Wire.RECORD))
      for (const [node, wtype] of this.types) {
        // TODO: optimize, probably with a reverse map
        if (wtype === a.of) {
          this.types.set(node, type)
        }
      }
    } else {
      type = a.of
    }
    return { name: a.name, of: type, omittable: a.omittable || b.omittable }
  }

  mergeRecordWireType(a: Wire.RECORD, b: Wire.RECORD): Wire.RECORD {
    const fields: Wire.Field[] = []
    const afs = new Map(a.fields.map((f) => [f.name, f]))
    const bfs = new Map(b.fields.map((f) => [f.name, f]))
    function* fieldNames() {
      yield* afs.keys()
      yield* bfs.keys()
    }
    for (const name of fieldNames()) {
      if (fields.some((f) => f.name == name)) continue
      const fa = afs.get(name)
      const fb = bfs.get(name)
      if (fa != null && fb != null) {
        fields.push(this.mergeFieldWireType(fa, fb))
      } else if (fa != null && fb == null) {
        fields.push({ ...fa, omittable: true })
      } else if (fa == null && fb != null) {
        fields.push({ ...fb, omittable: true })
      }
    }
    return { type: Wire.TypeKey.RECORD, fields }
  }

  /** Converts a GraphQL type to a wire type, provided it is _not_ a record, union, or interface. */
  typeToWireType = (t: GraphQLType): Wire.Type => {
    if (graphql.isScalarType(t) || graphql.isEnumType(t)) {
      let wtype: Wire.Type
      const codec = getArgoCodecDirectiveValue(t)
      const deduplicate = getArgoDeduplicateDirectiveValue(t)

      const mkBlockType = (type: Wire.Type) => Wire.block(codec ?? type, t.name, deduplicate ?? Wire.deduplicateByDefault(type))

      if (graphql.isEnumType(t)) {
        wtype = mkBlockType(Wire.STRING)
      } else {
        switch (t) {
          case graphql.GraphQLString:
          case graphql.GraphQLID:
            wtype = mkBlockType(Wire.STRING)
            break
          case graphql.GraphQLInt:
            wtype = mkBlockType(Wire.VARINT)
            break
          case graphql.GraphQLFloat:
            wtype = mkBlockType(Wire.FLOAT64)
            break
          case graphql.GraphQLBoolean:
            if (deduplicate) throw 'Boolean fields cannot be deduplicated'
            wtype = Wire.BOOLEAN
            break
          default:
            if (codec == null) throw 'Custom scalars must have a ArgoCodec directive. Missing on ' + t.name
            wtype = mkBlockType(codec)
        }
      }
      return Wire.nullable(wtype)
    } else if (graphql.isListType(t)) {
      return Wire.nullable({ type: Wire.TypeKey.ARRAY, of: this.typeToWireType(t.ofType) })
    } else if (graphql.isObjectType(t) || graphql.isInterfaceType(t) || graphql.isUnionType(t)) {
      return Wire.nullable({ type: Wire.TypeKey.RECORD, fields: [] })
    } else if (graphql.isNonNullType(t)) {
      const nullable = this.typeToWireType(t.ofType)
      return (nullable as { type: Wire.TypeKey.NULLABLE; of: Wire.Type }).of
    } else {
      throw 'unsupported type ' + t
    }
  }

  /** Gets the underlying type, without surrounding nullables, arrays, or blocks */
  unwrap(wt: Wire.Type): { t: Wire.Type; wrap: (r: Wire.Type) => Wire.Type } {
    if (Wire.isNULLABLE(wt)) {
      const { t, wrap } = this.unwrap(wt.of)
      return { t, wrap: (r: Wire.Type) => Wire.nullable(wrap(r)) }
    } else if (Wire.isBLOCK(wt)) {
      const { t, wrap } = this.unwrap(wt.of)
      return {
        t,
        wrap: (r: Wire.Type) => {
          return { type: Wire.TypeKey.BLOCK, of: wrap(r), key: wt.key, dedupe: wt.dedupe }
        },
      }
    } else if (Wire.isARRAY(wt)) {
      const { t, wrap } = this.unwrap(wt.of)
      return {
        t,
        wrap: (r: Wire.Type) => {
          return { type: Wire.TypeKey.ARRAY, of: wrap(r) }
        },
      }
    } else {
      return { t: wt, wrap: (wt: Wire.Type) => wt }
    }
  }

  makeGetField = (t: GraphQLType): ((n: string) => graphql.GraphQLField<unknown, unknown>) => {
    if (graphql.isObjectType(t) || graphql.isInterfaceType(t) || graphql.isUnionType(t)) {
      return this.getFieldFromSelection(t)
    } else if (graphql.isListType(t) || graphql.isNonNullType(t)) {
      return this.makeGetField(t.ofType)
    } else {
      throw 'Unexpected type ' + t
    }
  }

  private getFieldFromSelection = (t: graphql.GraphQLObjectType | graphql.GraphQLInterfaceType | graphql.GraphQLUnionType): ((n: string) => graphql.GraphQLField<unknown, unknown>) => {
    let fields: graphql.GraphQLFieldMap<any, any> | undefined = {}
    return (n: string, typeCondition?: string) => {
      switch (n) {
        case graphql.SchemaMetaFieldDef.name:
          return graphql.SchemaMetaFieldDef
        case graphql.TypeNameMetaFieldDef.name:
          return graphql.TypeNameMetaFieldDef
        case graphql.TypeMetaFieldDef.name:
          return graphql.TypeMetaFieldDef
        default:
          if (graphql.isUnionType(t)) {
            fields = this.schema
              .getPossibleTypes(t)
              .find((ot) => ot.name == typeCondition)
              ?.getFields()
          } else if (graphql.isInterfaceType(t)) {
            fields = {
              ...t.getFields(),
              ...(typeCondition && (this.schema.getType(typeCondition) as graphql.GraphQLInterfaceType | graphql.GraphQLObjectType)?.getFields()),
            }
          } else {
            fields = t.getFields()
          }
          const field = fields && fields[n]
          if (!field) throw `Could not get field ${n} from ${t.toString()} ${typeCondition && typeCondition != t.toString() ? '(does ' + typeCondition + ' implement ' + t + ')?' : ''}`
          return field
      }
    }
  }
}
