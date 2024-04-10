import { Typer, Wire } from '../src'
import { StarWarsSchema } from './equivalence/starwarsequivalence'
import { DocumentNode, buildSchema, parse } from 'graphql'

test('Path values', () => {
  const schema = StarWarsSchema
  const query = parse(`
    query {
      hero {
        id
        name
        friends {
          name
          aliasedName: name
        }
      }
    }`)
  const typer = new Typer(schema, query)
  const rootWireType = typer.rootWireType()

  function roundTripTest(path: (string | number)[]) {
    const wirePath = Wire.pathToWirePath(rootWireType, path)
    const regularPath = Wire.wirePathToPath(rootWireType, wirePath)
    expect(regularPath).toEqual(path)
  }

  roundTripTest(['data', 'hero', 'id'])
  roundTripTest(['data', 'hero', 'friends', 0, 'name'])
  roundTripTest(['data', 'hero', 'friends', 1, 'aliasedName'])
})

test('omittable: @include', () => {
  const schema = StarWarsSchema
  const query = parse(`query($v: Boolean!){ __typename @include(if: $v) }`)
  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].name', '__typename')
  expect(t).toHaveProperty('fields[0].omittable', true)
})

test('omittable: @include fragment ', () => {
  const schema = StarWarsSchema
  const query = parse(`query($v: Boolean!){ ... on Query @include(if: $v) { __typename } }`)
  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].name', '__typename')
  expect(t).toHaveProperty('fields[0].omittable', true)
})

test('omittable: @skip', () => {
  const schema = StarWarsSchema
  const query = parse(`query($v: Boolean!){ __typename @skip(if: $v) }`)
  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].name', '__typename')
  expect(t).toHaveProperty('fields[0].omittable', true)
})

test('omittable: @skip fragment ', () => {
  const schema = StarWarsSchema
  const query = parse(`query($v: Boolean!){ ... on Query @skip(if: $v) { __typename } }`)
  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].name', '__typename')
  expect(t).toHaveProperty('fields[0].omittable', true)
})

test('omittable: no directive', () => {
  const schema = StarWarsSchema
  const query = parse(`query { __typename }`)
  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].name', '__typename')
  expect(t).toHaveProperty('fields[0].omittable', false)
})

test('omittable: no directive fragment ', () => {
  const schema = StarWarsSchema
  const query = parse(`query { ... on Query { __typename } }`)
  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].name', '__typename')
  expect(t).toHaveProperty('fields[0].omittable', false)
})

test('Spread type conflict', () => {
  const schema = buildSchema(`
    type Query {
      hero: Character
    }

    interface Character { id: ID! }

    type Droid implements Character {
      id: ID!
      name: Int!
    }
    type Human implements Character {
      id: ID!
      name: String!
    }
  `)

  const droidQuery = parse(`
    query {
      hero {
        ... on Droid { name }
      }
    }`)

  const humanQuery = parse(`
    query {
      hero {
        ... on Human { name }
      }
    }`)

  const prettyWireType = (query: DocumentNode): string => Wire.print(new Typer(schema, query).dataWireType())

  expect(prettyWireType(droidQuery)).toContain('name?: VARINT{Int}')
  expect(prettyWireType(humanQuery)).toContain('name?: STRING<String>')
})

test('Fragment with mergeable scalars', () => {
  const schema = StarWarsSchema
  const query = parse(`
    query {
      hero {
        ... on Droid { name }
        ... on Human { name }
      }
    }`)

  const t = new Typer(schema, query).dataWireType()
  expect(t).toHaveProperty('fields[0].of.of.fields[0].name', 'name')
})
