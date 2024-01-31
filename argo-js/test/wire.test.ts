import { Typer, Wire } from "../src"
import { StarWarsSchema } from "./equivalence/starwarsequivalence"
import { GraphQLSchema, DocumentNode, buildSchema, parse } from "graphql"

test('Path values', () => {
  const schema = StarWarsSchema;
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
    const typer = new Typer(schema, query);
    const rootWireType = typer.rootWireType();

    function roundTripTest(path: (string | number)[]) {
      const wirePath = Wire.pathToWirePath(rootWireType, path)
      const regularPath = Wire.wirePathToPath(rootWireType, wirePath)
      expect(regularPath).toEqual(path)
    }

    roundTripTest(['data', 'hero', 'id'])
    roundTripTest(['data', 'hero', 'friends', 0, 'name'])
    roundTripTest(['data', 'hero', 'friends', 1, 'aliasedName'])
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

    const prettyWireType = (query: DocumentNode) : string =>
      Wire.print(new Typer(schema, query).rootWireType());

    // Passes
    expect(prettyWireType(droidQuery)).toContain("name?: VARINT{Int}");

    // Fails
    expect(prettyWireType(humanQuery)).toContain("name?: STRING<String>");
})
