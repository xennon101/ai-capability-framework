# Policy Broker Adapter

Policy adapters should map host auth, account, tenant, entitlement, and permission data into AICF decision requests.

Host hooks may deny or require approval. They must not override a core denial into allow. If the hook throws, returns ambiguous state, or lacks required context, fail closed.
