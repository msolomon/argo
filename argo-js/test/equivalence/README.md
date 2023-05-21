# Equivalence tests

Equivalence tests ensure Argo gives equivalent results to JSON.
They use one directory per suite.
Each suite uses a single GraphQL schema in `schema.graphql`.
Each test case is a pair of files:

* One `<test name>.graphql` file, which contains a query
* One `<test name>.json` file, which contains the JSON representation of the response

Each test case runs as follows:

1. Load up the schema from `schema.graphql`
2. Load up a query, and the corresponding JSON result
3. Use the query and schema to build a Argo type schema
4. Use the JSON result as a data source for a Argo message
5. Serialize the data to a Argo message
6. Deserialize the data from the argo message, then re-serialize it to JSON
7. Compare the expected JSON to what we got after going through Argo
