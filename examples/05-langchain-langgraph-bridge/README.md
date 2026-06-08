# 05 LangChain And LangGraph Bridge

Fake data: synthetic support manifests and mock executor calls.

Goal: build AICF-backed LangChain tools and a host-supplied LangGraph ToolNode without
adding model provider packages.

Command:

```bash
npm run test:langchain:mock
```

Expected output:

```text
Test Files
passed
```

No secrets are required. No live provider calls run by default. Optional live LangChain
scaffolding is skipped unless `RUN_LIVE_LANGCHAIN=1` is set by the host.
