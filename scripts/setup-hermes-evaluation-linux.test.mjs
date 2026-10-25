import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HermesSetupError, installHermes, MANAGED_PYTHON_VERSION, RUNTIME_COMMIT, SETUP_TIMEOUT_MS, setupEnvironment, setupPlan, UV_ASSETS, UV_VERSION, verifyArchive } from "./setup-hermes-evaluation-linux.mjs";

test("offline plans pin the real Hermes commit and both official Linux uv digests", () => {
  for (const arch of ["x64", "arm64"]) {
    const plan = setupPlan({ arch });
    assert.equal(plan.runtimeCommit, "7157422022ff06f3e632d1dd394ee1253b17ad37");
    assert.equal(plan.pythonVersion, "3.13.16");
    assert.equal(plan.uv.version, "0.12.23");
    assert.match(plan.uv.url, /^https:\/\/github\.com\/astral-sh\/uv\/releases\/download\/0\.12\.23\//);
    assert.equal(plan.uv.sha256, UV_ASSETS[arch].sha256);
    assert.match(plan.uv.sha256, /^[a-f0-9]{64}$/);
    assert.equal(plan.pythonPath, join(plan.venv, "bin", "python"));
    assert.equal(plan.steps[1].args.at(-1), RUNTIME_COMMIT);
    assert.ok(plan.steps.some((step) => step.args.includes("--check-import")));
    assert.ok(!plan.steps.some((step) => step.args.includes(".[all]") || step.args.includes("install.sh")));
  }
  assert.equal(MANAGED_PYTHON_VERSION, "3.13.16");
  assert.equal(UV_VERSION, "0.12.23");
  assert.ok(SETUP_TIMEOUT_MS < 600_000);
});

test("setup children receive no provider, DB, proxy, import or package-index environment", () => {
  const plan = setupPlan({ arch: "x64" });
  const env = setupEnvironment(plan, {
    PATH: "/usr/bin", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", DATABASE_URL: "secret",
    HTTPS_PROXY: "secret", PYTHONPATH: "private", PIP_INDEX_URL: "private", UV_INDEX: "private", HOME: "private",
  });
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL", "HTTPS_PROXY", "PYTHONPATH", "PIP_INDEX_URL", "UV_INDEX"]) assert.equal(env[key], undefined);
  assert.equal(env.HOME, plan.home);
  assert.equal(env.PIP_CONFIG_FILE, "/dev/null");
  assert.equal(env.UV_PYTHON_INSTALL_DIR, join(plan.home, "python"));
  assert.equal(env.UV_DEFAULT_INDEX, "https://pypi.org/simple");
});

test("a changed uv archive is rejected before extraction", () => {
  const bytes = Buffer.from("isolated fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.doesNotThrow(() => verifyArchive(bytes, digest));
  assert.throws(() => verifyArchive(Buffer.from("changed"), digest), { code: "HERMES_SETUP_UV_CHECKSUM_MISMATCH" });
});

test("Windows installation and unsupported architecture fail before file/network access", async () => {
  await assert.rejects(installHermes({ platform: "win32", root: "not-a-workspace" }), { code: "HERMES_SETUP_LINUX_REQUIRED" });
  assert.throws(() => setupPlan({ arch: "ia32" }), HermesSetupError);
  assert.throws(() => setupPlan({ arch: "ia32" }), { code: "HERMES_SETUP_ARCH_UNSUPPORTED" });
});

test("CLI dry plan works offline while malformed arguments return classified failure", () => {
  const script = fileURLToPath(new URL("./setup-hermes-evaluation-linux.mjs", import.meta.url));
  const good = spawnSync(process.execPath, [script, "--plan", "--arch", "x64"], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).runtimeCommit, RUNTIME_COMMIT);
  const invalid = spawnSync(process.execPath, [script, "--plan", "x64"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).code, "HERMES_SETUP_ARGUMENT_INVALID");
  assert.equal(invalid.stdout, "");
});

test("worker pin and existing PowerShell core selection remain unchanged", async () => {
  const worker = await readFile(new URL("./hermes-evaluation-worker.py", import.meta.url), "utf8");
  const powershell = await readFile(new URL("./setup-hermes-evaluation.ps1", import.meta.url), "utf8");
  const linux = await readFile(new URL("./setup-hermes-evaluation-linux.mjs", import.meta.url), "utf8");
  assert.ok(worker.includes(`RUNTIME_COMMIT = "${RUNTIME_COMMIT}"`));
  for (const expected of ["project[\"project\"][\"dependencies\"]", "\"python_version\": \"3.14\"", "\"python_full_version\": \"3.14.0\"", "requirement.marker = None"]) {
    assert.ok(powershell.includes(expected));
    assert.ok(linux.includes(expected));
  }
});
