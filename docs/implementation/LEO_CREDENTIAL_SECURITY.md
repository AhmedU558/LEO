# LEO Credential Security

## Abstract
Adapts OwnPilot's credential infrastructure to strictly scope and hide sensitive material from the LLM execution boundary.

## Requirements
* Credentials remain encrypted at rest.
* API keys, passwords, refresh tokens, and master keys are never returned to the LLM.
* Credentials are scoped strictly to the workspace/account/provider.
* Tools receive only the specific credential material they require to perform the approved capability.
* Credential usage is audited in the Action Ledger.
* Secure deletion and revocation are natively supported.
* Explicit encryption keys are required for production deployments.
* Fallback development secrets MUST NOT silently become production secrets.
