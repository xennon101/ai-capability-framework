/** Only an explicit npm E404 denotes an absent registry package/version. */
export function isNpmNotFound(result) {
  if (result?.status !== 1) return false;
  for (const output of [result.stdout, result.stderr]) {
    try {
      if (JSON.parse(String(output)).error?.code === "E404") return true;
    } catch {
      // npm may print its structured error to stdout and diagnostics to stderr.
    }
  }
  return /(?:^|\n)npm (?:error|ERR!) code E404(?:\r?\n|$)/u.test(
    String(result.stderr ?? "")
  );
}
