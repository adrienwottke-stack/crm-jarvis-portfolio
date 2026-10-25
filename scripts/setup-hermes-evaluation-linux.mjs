#!/usr/bin/env node
/** Pinned Hermes core only. No provider/CRM access; never run the upstream installer. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RUNTIME_COMMIT = "7157422022ff06f3e632d1dd394ee1253b17ad37";
export const UV_VERSION = "0.12.23";
export const MANAGED_PYTHON_VERSION = "3.13.16";
export const SETUP_TIMEOUT_MS = 8 * 60_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "https://github.com/NousResearch/hermes-agent.git";
export const UV_ASSETS = Object.freeze({
  x64: {
    name: "uv-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "9167d72b3319674b6303c4cbe071854bba13ebdf3d76b1a7cbdc175471fb66d6",
  },
  arm64: {
    name: "uv-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "6524bd338177ed50d035d39354e12545e993bbeba2ecbddf0480c5b3a81d313f",
  },
});

export class HermesSetupError extends Error {
  constructor(code) { super(code); this.name = "HermesSetupError"; this.code = code; }
}

export function setupPlan({ root = ROOT, arch = process.arch } = {}) {
  const asset = UV_ASSETS[arch];
  if (!asset) throw new HermesSetupError("HERMES_SETUP_ARCH_UNSUPPORTED");
  const home = join(resolve(root), ".cache", "hermes-evaluation-home");
  const source = join(resolve(root), ".cache", "hermes-evaluation-source");
  const venv = join(resolve(root), ".cache", "hermes-evaluation-venv");
  return {
    platform: "linux", arch, runtimeCommit: RUNTIME_COMMIT,
    pythonVersion: MANAGED_PYTHON_VERSION, source, venv, home,
    pythonPath: join(venv, "bin", "python"),
    uv: { version: UV_VERSION, url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.name}`, sha256: asset.sha256 },
    steps: [
      { command: "git", args: ["clone", "--filter=blob:none", REPOSITORY, source], condition: "source absent" },
      { command: "git", args: ["-C", source, "checkout", "--detach", RUNTIME_COMMIT], condition: "new source only" },
      { command: "git", args: ["-C", source, "rev-parse", "HEAD"], condition: "always; require exact pin" },
      { command: "git", args: ["-C", source, "diff", "--quiet", "HEAD", "--"], condition: "always; require unchanged tracked source" },
      { command: "python3", args: ["-m", "venv", venv], condition: "no existing venv and system Python is 3.13" },
      { command: "uv", args: ["--no-config", "python", "install", MANAGED_PYTHON_VERSION], condition: "system Python unsuitable; pinned official archive verified first" },
      { command: "uv", args: ["--no-config", "venv", "--seed", "--managed-python", "--python", MANAGED_PYTHON_VERSION, venv], condition: "managed Python fallback; no existing venv" },
      { command: join(venv, "bin", "python"), args: ["-m", "pip", "install", "--disable-pip-version-check", "--index-url", "https://pypi.org/simple", "-r", join(home, "core-requirements.txt")], condition: "only pinned project.dependencies; preserve OS/arch markers" },
      { command: join(venv, "bin", "python"), args: [join(resolve(root), "scripts", "hermes-evaluation-worker.py"), "--check-import"], condition: "isolated import only; no provider call" },
    ],
  };
}

export function setupEnvironment(plan, original = process.env) {
  // No inherited credentials, proxies, Python imports, pip indexes or user config.
  const env = {};
  for (const key of ["PATH", "SYSTEMROOT", "WINDIR", "PATHEXT"]) {
    if (original[key]) env[key] = original[key];
  }
  return Object.assign(env, {
    HOME: plan.home, USERPROFILE: plan.home,
    TMPDIR: join(plan.home, "tmp"), TEMP: join(plan.home, "tmp"), TMP: join(plan.home, "tmp"),
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8",
    PIP_CONFIG_FILE: "/dev/null", PIP_CACHE_DIR: join(plan.home, "pip-cache"),
    UV_CACHE_DIR: join(plan.home, "uv-cache"), UV_PYTHON_INSTALL_DIR: join(plan.home, "python"),
    UV_PYTHON_BIN_DIR: join(plan.home, "bin"), UV_NO_CONFIG: "true",
    UV_DEFAULT_INDEX: "https://pypi.org/simple", UV_PYTHON_DOWNLOADS: "automatic",
    HERMES_HOME: plan.home, HERMES_DISABLE_TELEMETRY: "1", HERMES_DISABLE_LAZY_INSTALLS: "1",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
  });
}

export function verifyArchive(bytes, expectedDigest) {
  if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest) {
    throw new HermesSetupError("HERMES_SETUP_UV_CHECKSUM_MISMATCH");
  }
}

const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
const versionScript = "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info[:2] == (3,13) else 1)";
// Same selection as setup-hermes-evaluation.ps1, including its explicit 3.13
// compatibility override of upstream's fresh-install Python3.14 dependency gate.
const requirementScript = String.raw`import pathlib, sys, tomllib
from pip._vendor.packaging.requirements import Requirement
source, destination = map(pathlib.Path, sys.argv[1:])
project = tomllib.loads((source / "pyproject.toml").read_text(encoding="utf-8"))
dependencies = []
for declaration in project["project"]["dependencies"]:
    requirement = Requirement(declaration)
    if requirement.marker and not requirement.marker.evaluate({"python_version": "3.14", "python_full_version": "3.14.0"}):
        continue
    requirement.marker = None
    dependencies.append(str(requirement))
destination.write_text("\n".join(dependencies) + "\n", encoding="utf-8")
`;

export async function installHermes({ root = ROOT, arch = process.arch, platform = process.platform } = {}) {
  // --plan is the only cross-platform entry point. Never touch an existing Windows venv.
  if (platform !== "linux") throw new HermesSetupError("HERMES_SETUP_LINUX_REQUIRED");
  const plan = setupPlan({ root, arch });
  const env = setupEnvironment(plan);
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new HermesSetupError("HERMES_SETUP_TIMEOUT");
    return value;
  };
  const run = (command, args, code, input, optional = false) => new Promise((accept, reject) => {
    let child, timeout;
    try { timeout = remaining(); } catch (error) { reject(error); return; }
    try { child = spawn(command, args, { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { reject(new HermesSetupError(code)); return; }
    let output = "", settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else accept(value);
    };
    const timer = setTimeout(() => {
      // Kill the Linux process group as git/pip can spawn their own children.
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      finish(new HermesSetupError("HERMES_SETUP_TIMEOUT"));
    }, timeout);
    child.stdout.on("data", (data) => {
      // Installer logs are never returned, and output is bounded.
      if (output.length < 1_048_576) output += data.toString("utf8").slice(0, 1_048_576 - output.length);
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", () => finish(optional ? null : new HermesSetupError(code), null));
    child.on("close", (status) => finish(status === 0 || optional ? null : new HermesSetupError(code), status === 0 ? output.trim() : null));
    child.stdin.end(input ?? "");
  });
  await mkdir(join(plan.home, "tmp"), { recursive: true });
  if (!await exists(plan.source)) {
    await run("git", ["clone", "--filter=blob:none", REPOSITORY, plan.source], "HERMES_SETUP_SOURCE_CLONE_FAILED");
    await run("git", ["-C", plan.source, "checkout", "--detach", RUNTIME_COMMIT], "HERMES_SETUP_SOURCE_PIN_FAILED");
  }
  const actualCommit = await run("git", ["-C", plan.source, "rev-parse", "HEAD"], "HERMES_SETUP_SOURCE_PIN_FAILED");
  if (actualCommit !== RUNTIME_COMMIT) throw new HermesSetupError("HERMES_SETUP_SOURCE_PIN_MISMATCH");
  await run("git", ["-C", plan.source, "diff", "--quiet", "HEAD", "--"], "HERMES_SETUP_SOURCE_CHANGED");
  if (await exists(plan.venv)) {
    if (!await exists(plan.pythonPath)) throw new HermesSetupError("HERMES_SETUP_EXISTING_VENV_INVALID");
  } else {
    let systemPython = null;
    for (const candidate of ["python3", "python"]) {
      if (await run(candidate, ["-c", versionScript], "HERMES_SETUP_PYTHON_UNSUITABLE", undefined, true)) {
        systemPython = candidate; break;
      }
    }
    if (systemPython) {
      await run(systemPython, ["-m", "venv", plan.venv], "HERMES_SETUP_VENV_FAILED");
    } else {
      const bootstrap = join(plan.home, "uv-bootstrap");
      const archive = join(bootstrap, "uv.tar.gz");
      await mkdir(bootstrap, { recursive: true });
      let bytes;
      if (await exists(archive)) bytes = await readFile(archive);
      else {
        try {
          const response = await fetch(plan.uv.url, { signal: AbortSignal.timeout(Math.min(remaining(), 120_000)) });
          if (!response.ok) throw new Error("download");
          const length = Number(response.headers.get("content-length"));
          if (length > 30_000_000) throw new Error("size");
          const chunks = []; let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > 30_000_000) throw new Error("size");
            chunks.push(chunk);
          }
          bytes = Buffer.concat(chunks);
        } catch { throw new HermesSetupError("HERMES_SETUP_UV_DOWNLOAD_FAILED"); }
      }
      verifyArchive(bytes, plan.uv.sha256);
      await writeFile(archive, bytes);
      await run("tar", ["-xzf", archive, "--strip-components=1", "-C", bootstrap], "HERMES_SETUP_UV_EXTRACT_FAILED");
      const uv = join(bootstrap, "uv");
      const actualUv = await run(uv, ["--version"], "HERMES_SETUP_UV_VERSION_FAILED");
      if (!actualUv?.startsWith(`uv ${UV_VERSION} `) && actualUv !== `uv ${UV_VERSION}`) throw new HermesSetupError("HERMES_SETUP_UV_VERSION_MISMATCH");
      await run(uv, ["--no-config", "python", "install", MANAGED_PYTHON_VERSION], "HERMES_SETUP_PYTHON_DOWNLOAD_FAILED");
      await run(uv, ["--no-config", "venv", "--seed", "--managed-python", "--python", MANAGED_PYTHON_VERSION, plan.venv], "HERMES_SETUP_VENV_FAILED");
    }
  }
  const pythonVersion = await run(plan.pythonPath, ["-c", versionScript], "HERMES_SETUP_PYTHON_UNSUITABLE");
  const requirements = join(plan.home, "core-requirements.txt");
  await run(plan.pythonPath, ["-", plan.source, requirements], "HERMES_SETUP_REQUIREMENTS_FAILED", requirementScript);
  await run(plan.pythonPath, ["-m", "pip", "install", "--disable-pip-version-check", "--index-url", "https://pypi.org/simple", "-r", requirements], "HERMES_SETUP_CORE_DEPENDENCIES_FAILED");
  const installed = await run(plan.pythonPath, ["-m", "pip", "freeze"], "HERMES_SETUP_FREEZE_FAILED");
  await writeFile(join(plan.home, "installed.txt"), `${installed}\n`, "utf8");
  const payload = { baseUrl: "http://127.0.0.1:1", token: "isolated-import-check", model: "mock-evaluation-model", instructions: "Isolated import only.", history: [], message: "Import check", tools: [], budgets: {} };
  const importOutput = await run(plan.pythonPath, [join(root, "scripts", "hermes-evaluation-worker.py"), "--check-import"], "HERMES_SETUP_IMPORT_FAILED", JSON.stringify(payload));
  try {
    const receipt = JSON.parse(importOutput);
    if (receipt.imported !== true || receipt.runtimeCommit !== RUNTIME_COMMIT) throw new Error("receipt");
  } catch { throw new HermesSetupError("HERMES_SETUP_IMPORT_FAILED"); }
  await writeFile(join(plan.home, "setup.json"), `${JSON.stringify({ runtimeCommit: RUNTIME_COMMIT, pythonVersion, managedPythonVersion: MANAGED_PYTHON_VERSION, uvVersion: UV_VERSION, dependencySource: "pinned project.dependencies; Python3.14 marker gate with native Linux/architecture markers", providerCalls: 0 }, null, 2)}\n`, "utf8");
  return { status: "prepared", pythonPath: plan.pythonPath, runtimeCommit: RUNTIME_COMMIT };
}

async function main(args) {
  let planOnly = false, arch = process.arch, archGiven = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--plan" && !planOnly) planOnly = true;
    else if (args[index] === "--arch" && !archGiven && ["x64", "arm64"].includes(args[index + 1])) {
      arch = args[++index]; archGiven = true;
    } else throw new HermesSetupError("HERMES_SETUP_ARGUMENT_INVALID");
  }
  if (!planOnly && arch !== process.arch) throw new HermesSetupError("HERMES_SETUP_ARCH_MISMATCH");
  const result = planOnly ? setupPlan({ arch }) : await installHermes({ arch });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: "failed", code: error instanceof HermesSetupError ? error.code : "HERMES_SETUP_FAILED" })}\n`);
    process.exitCode = 1;
  });
}
