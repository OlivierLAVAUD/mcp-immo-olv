# Security Policy

## Scope

This server runs locally over stdio, makes read-only GET requests to official
French open-data endpoints, requires no credentials and stores nothing on
disk. The main risks to users are therefore:

- responses crafted by a compromised upstream dataset being relayed to an LLM;
- dependency-chain issues.

## Reporting a vulnerability

Please email **olivier.lavaud@gmail.com** with a description and reproduction
steps. Please do not disclose an unpatched vulnerability publicly.

## Supported versions

Only the latest released minor version receives fixes.
