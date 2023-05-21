// https://github.com/graphql/graphql-js/blob/main/src/__tests__/starWarsData.ts
// MIT licensse
/*
MIT License

Copyright (c) GraphQL Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
/**
 * These are types which correspond to the schema.
 * They represent the shape of the data visited during field resolution.
 */
export interface Character {
  id: string;
  name: string;
  friends: ReadonlyArray<string>;
  appearsIn: ReadonlyArray<number>;
}

export interface Human {
  type: 'Human';
  id: string;
  name: string;
  friends: ReadonlyArray<string>;
  appearsIn: ReadonlyArray<number>;
  homePlanet?: string;
}

export interface Droid {
  type: 'Droid';
  id: string;
  name: string;
  friends: ReadonlyArray<string>;
  appearsIn: ReadonlyArray<number>;
  primaryFunction: string;
}

/**
 * This defines a basic set of data for our Star Wars Schema.
 *
 * This data is hard coded for the sake of the demo, but you could imagine
 * fetching this data from a backend service rather than from hardcoded
 * JSON objects in a more complex demo.
 */

const luke: Human = {
  type: 'Human',
  id: '1000',
  name: 'Luke Skywalker',
  friends: ['1002', '1003', '2000', '2001'],
  appearsIn: [4, 5, 6],
  homePlanet: 'Tatooine',
};

const vader: Human = {
  type: 'Human',
  id: '1001',
  name: 'Darth Vader',
  friends: ['1004'],
  appearsIn: [4, 5, 6],
  homePlanet: 'Tatooine',
};

const han: Human = {
  type: 'Human',
  id: '1002',
  name: 'Han Solo',
  friends: ['1000', '1003', '2001'],
  appearsIn: [4, 5, 6],
};

const leia: Human = {
  type: 'Human',
  id: '1003',
  name: 'Leia Organa',
  friends: ['1000', '1002', '2000', '2001'],
  appearsIn: [4, 5, 6],
  homePlanet: 'Alderaan',
};

const tarkin: Human = {
  type: 'Human',
  id: '1004',
  name: 'Wilhuff Tarkin',
  friends: ['1001'],
  appearsIn: [4],
};

const humanData: { [id: string]: Human } = {
  [luke.id]: luke,
  [vader.id]: vader,
  [han.id]: han,
  [leia.id]: leia,
  [tarkin.id]: tarkin,
};

const threepio: Droid = {
  type: 'Droid',
  id: '2000',
  name: 'C-3PO',
  friends: ['1000', '1002', '1003', '2001'],
  appearsIn: [4, 5, 6],
  primaryFunction: 'Protocol',
};

const artoo: Droid = {
  type: 'Droid',
  id: '2001',
  name: 'R2-D2',
  friends: ['1000', '1002', '1003'],
  appearsIn: [4, 5, 6],
  primaryFunction: 'Astromech',
};

const droidData: { [id: string]: Droid } = {
  [threepio.id]: threepio,
  [artoo.id]: artoo,
};

/**
 * Helper function to get a character by ID.
 */
function getCharacter(id: string): Character | null {
  // Returning a promise just to illustrate that GraphQL.js supports it.
  return humanData[id] ?? droidData[id];
}

/**
 * Allows us to query for a character's friends.
 */
export function getFriends(
  character: Character,
): Array<Character | null> {
  // Notice that GraphQL accepts Arrays of Promises.
  return character.friends.map((id) => getCharacter(id));
}

/**
 * Allows us to fetch the undisputed hero of the Star Wars trilogy, R2-D2.
 */
export function getHero(episode: number): Character {
  if (episode === 5) {
    // Luke is the hero of Episode V.
    return luke;
  }
  // Artoo is the hero otherwise.
  return artoo;
}

/**
 * Allows us to query for the human with the given id.
 */
export function getHuman(id: string): Human | null {
  return humanData[id];
}

/**
 * Allows us to query for the droid with the given id.
 */
export function getDroid(id: string): Droid | null {
  return droidData[id];
}

///////////////////////////////////////////////////////////
// https://raw.githubusercontent.com/graphql/graphql-js/main/src/__tests__/starWarsSchema.ts

import {
  GraphQLEnumType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
  GraphQLSchema,
} from 'graphql';

/**
 * This is designed to be an end-to-end test, demonstrating
 * the full GraphQL stack.
 *
 * We will create a GraphQL schema that describes the major
 * characters in the original Star Wars trilogy.
 *
 * NOTE: This may contain spoilers for the original Star
 * Wars trilogy.
 */

/**
 * Using our shorthand to describe type systems, the type system for our
 * Star Wars example is:
 *
 * ```graphql
 * enum Episode { NEW_HOPE, EMPIRE, JEDI }
 *
 * interface Character {
 *   id: String!
 *   name: String
 *   friends: [Character]
 *   appearsIn: [Episode]
 * }
 *
 * type Human implements Character {
 *   id: String!
 *   name: String
 *   friends: [Character]
 *   appearsIn: [Episode]
 *   homePlanet: String
 * }
 *
 * type Droid implements Character {
 *   id: String!
 *   name: String
 *   friends: [Character]
 *   appearsIn: [Episode]
 *   primaryFunction: String
 * }
 *
 * type Query {
 *   hero(episode: Episode): Character
 *   human(id: String!): Human
 *   droid(id: String!): Droid
 * }
 * ```
 *
 * We begin by setting up our schema.
 */

/**
 * The original trilogy consists of three movies.
 *
 * This implements the following type system shorthand:
 * ```graphql
 * enum Episode { NEW_HOPE, EMPIRE, JEDI }
 * ```
 */
const episodeEnum = new GraphQLEnumType({
  name: 'Episode',
  description: 'One of the films in the Star Wars Trilogy',
  values: {
    NEW_HOPE: {
      value: 4,
      description: 'Released in 1977.',
    },
    EMPIRE: {
      value: 5,
      description: 'Released in 1980.',
    },
    JEDI: {
      value: 6,
      description: 'Released in 1983.',
    },
  },
});

/**
 * Characters in the Star Wars trilogy are either humans or droids.
 *
 * This implements the following type system shorthand:
 * ```graphql
 * interface Character {
 *   id: String!
 *   name: String
 *   friends: [Character]
 *   appearsIn: [Episode]
 *   secretBackstory: String
 * }
 * ```
 */
const characterInterface: GraphQLInterfaceType = new GraphQLInterfaceType({
  name: 'Character',
  description: 'A character in the Star Wars Trilogy',
  fields: () => ({
    id: {
      type: new GraphQLNonNull(GraphQLString),
      description: 'The id of the character.',
    },
    name: {
      type: GraphQLString,
      description: 'The name of the character.',
    },
    friends: {
      type: new GraphQLList(characterInterface),
      description:
        'The friends of the character, or an empty list if they have none.',
    },
    appearsIn: {
      type: new GraphQLList(episodeEnum),
      description: 'Which movies they appear in.',
    },
    secretBackstory: {
      type: GraphQLString,
      description: 'All secrets about their past.',
    },
  }),
  resolveType(character) {
    switch (character.type) {
      case 'Human':
        return humanType.name;
      case 'Droid':
        return droidType.name;
    }
  },
});

/**
 * We define our human type, which implements the character interface.
 *
 * This implements the following type system shorthand:
 * ```graphql
 * type Human : Character {
 *   id: String!
 *   name: String
 *   friends: [Character]
 *   appearsIn: [Episode]
 *   secretBackstory: String
 * }
 * ```
 */
const humanType = new GraphQLObjectType({
  name: 'Human',
  description: 'A humanoid creature in the Star Wars universe.',
  fields: () => ({
    id: {
      type: new GraphQLNonNull(GraphQLString),
      description: 'The id of the human.',
    },
    name: {
      type: GraphQLString,
      description: 'The name of the human.',
    },
    friends: {
      type: new GraphQLList(characterInterface),
      description:
        'The friends of the human, or an empty list if they have none.',
      resolve: (human) => getFriends(human),
    },
    appearsIn: {
      type: new GraphQLList(episodeEnum),
      description: 'Which movies they appear in.',
    },
    homePlanet: {
      type: GraphQLString,
      description: 'The home planet of the human, or null if unknown.',
    },
    secretBackstory: {
      type: GraphQLString,
      description: 'Where are they from and how they came to be who they are.',
      resolve() {
        throw new Error('secretBackstory is secret.');
      },
    },
  }),
  interfaces: [characterInterface],
});

/**
 * The other type of character in Star Wars is a droid.
 *
 * This implements the following type system shorthand:
 * ```graphql
 * type Droid : Character {
 *   id: String!
 *   name: String
 *   friends: [Character]
 *   appearsIn: [Episode]
 *   secretBackstory: String
 *   primaryFunction: String
 * }
 * ```
 */
const droidType = new GraphQLObjectType({
  name: 'Droid',
  description: 'A mechanical creature in the Star Wars universe.',
  fields: () => ({
    id: {
      type: new GraphQLNonNull(GraphQLString),
      description: 'The id of the droid.',
    },
    name: {
      type: GraphQLString,
      description: 'The name of the droid.',
    },
    friends: {
      type: new GraphQLList(characterInterface),
      description:
        'The friends of the droid, or an empty list if they have none.',
      resolve: (droid) => getFriends(droid),
    },
    appearsIn: {
      type: new GraphQLList(episodeEnum),
      description: 'Which movies they appear in.',
    },
    secretBackstory: {
      type: GraphQLString,
      description: 'Construction date and the name of the designer.',
      resolve() {
        throw new Error('secretBackstory is secret.');
      },
    },
    primaryFunction: {
      type: GraphQLString,
      description: 'The primary function of the droid.',
    },
  }),
  interfaces: [characterInterface],
});

/**
 * This is the type that will be the root of our query, and the
 * entry point into our schema. It gives us the ability to fetch
 * objects by their IDs, as well as to fetch the undisputed hero
 * of the Star Wars trilogy, R2-D2, directly.
 *
 * This implements the following type system shorthand:
 * ```graphql
 * type Query {
 *   hero(episode: Episode): Character
 *   human(id: String!): Human
 *   droid(id: String!): Droid
 * }
 * ```
 */
const queryType = new GraphQLObjectType({
  name: 'Query',
  fields: () => ({
    hero: {
      type: characterInterface,
      args: {
        episode: {
          description:
            'If omitted, returns the hero of the whole saga. If provided, returns the hero of that particular episode.',
          type: episodeEnum,
        },
      },
      resolve: (_source, { episode }) => getHero(episode),
    },
    human: {
      type: humanType,
      args: {
        id: {
          description: 'id of the human',
          type: new GraphQLNonNull(GraphQLString),
        },
      },
      resolve: (_source, { id }) => getHuman(id),
    },
    droid: {
      type: droidType,
      args: {
        id: {
          description: 'id of the droid',
          type: new GraphQLNonNull(GraphQLString),
        },
      },
      resolve: (_source, { id }) => getDroid(id),
    },
  }),
});

/**
 * Finally, we construct our schema (whose starting query type is the query
 * type we defined above) and export it.
 */
export const StarWarsSchema: GraphQLSchema = new GraphQLSchema({
  query: queryType,
  types: [humanType, droidType],
});

//////////////////////////////////
