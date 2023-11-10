import { Typer, Wire } from "../src"
import { StarWarsSchema } from "./equivalence/starwarsequivalence"
import { parse } from "graphql"

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