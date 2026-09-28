# TypeSafe n8n community node

Evaluate content with fast probabilistic checks, classifications, and custom scoring rubrics using TypeSafe AI

Generated from OpenAPI 0.2.0 with template 1.1.0. Generated files are platform-managed and will be overwritten during regeneration.

## Authentication

Configure the generated bearer token credential in n8n before using the node.

## Supported operations

- `GET /v1/models` - Get Many Models
  - Retry Contract: none
  - Pagination Contract: none
- `POST /v1/systemone` - Evaluate Content
  - Retry Contract: none
  - Pagination Contract: none

## Usage

1. Install this community-node package in n8n.
2. Add the **TypeSafe** node to a workflow.
3. Select a resource and operation, configure its parameters, and execute the workflow.

## Example workflow

Connect **Manual Trigger** -> **TypeSafe** -> a destination node, select an operation, then run the workflow and inspect the returned items.

## Development

```sh
npm install
npm run build
npm run lint
npm run dev
```

`npm run dev` starts a local n8n development instance. Find the integration by its **TypeSafe** display name.
