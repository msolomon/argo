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
 * Allows us to query for a character's friends.
 */
export declare function getFriends(character: Character): Array<Character | null>;
/**
 * Allows us to fetch the undisputed hero of the Star Wars trilogy, R2-D2.
 */
export declare function getHero(episode: number): Character;
/**
 * Allows us to query for the human with the given id.
 */
export declare function getHuman(id: string): Human | null;
/**
 * Allows us to query for the droid with the given id.
 */
export declare function getDroid(id: string): Droid | null;
import { GraphQLSchema } from 'graphql';
/**
 * Finally, we construct our schema (whose starting query type is the query
 * type we defined above) and export it.
 */
export declare const StarWarsSchema: GraphQLSchema;
