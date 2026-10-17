import { campaignCli } from "./evaluation/runner.mjs";

try {
  console.log(JSON.stringify(await campaignCli(process.argv.slice(2)), null, 2));
} catch {
  console.error(
    "Evaluation could not run. Check the explicit configuration, offline gate, campaign lock and fingerprinted evidence; no automatic retry was scheduled."
  );
  process.exitCode = 1;
}
