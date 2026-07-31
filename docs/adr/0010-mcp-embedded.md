# MCP server embedded in the API

The MCP (Model Context Protocol) server that lets external AI assistants (ChatGPT, Claude, Cursor) operate SpellPaw runs as a route group inside the same Node.js process as the REST API, not as a standalone service.

**Why**: An MCP server is essentially a set of SSE streaming endpoints and message handlers — a route module, not an architectural tier. Running it in-process reuses the same database connection pool, auth session, and Customer Graph read models without duplicating infrastructure. The protocol transport (SSE over HTTP) fits naturally into a Next.js API route. A standalone process would require separate deployment, monitoring, authentication, and connection management for no benefit at Phase 1 scale. If the MCP server later needs to scale independently, the route group can be extracted behind a reverse proxy without changing the protocol implementation.

**Considered alternative**: A standalone MCP server process communicating with the API over gRPC. Rejected because the operational overhead (two services to deploy, two auth systems, two connection pools) is unjustified when the MCP server is effectively a thin protocol translation layer on top of the same data access patterns the REST API already serves.
