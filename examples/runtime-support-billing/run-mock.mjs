#!/usr/bin/env node
import { runRuntimeSupportBillingMockFlow } from "./support-billing-runtime.mjs";

const summary = await runRuntimeSupportBillingMockFlow();
console.log(JSON.stringify(summary, null, 2));
