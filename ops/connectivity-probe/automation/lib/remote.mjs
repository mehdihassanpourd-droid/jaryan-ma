// SSH/SCP access to the probe server with a PINNED host key (derived from the same secret as the client key). Commands run by
// this file are fixed strings from the orchestrator; no user text is ever put into a shell command.
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SSH_USER } from "./cloudinit.mjs";
import { knownHostsLine, openSshPrivate } from "./sshkey.mjs";

export function sshArgs({ keyFile, knownHostsFile, ip }) {
  return ["-i", keyFile, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsFile}`,
    "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "PasswordAuthentication=no", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", `${SSH_USER}@${ip}`];
}

export function createSshRemote({ ip, identity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const dir = mkdtempSync(join(tmpdir(), "jm-ssh-"));
  const keyFile = join(dir, "id");
  const knownHostsFile = join(dir, "known_hosts");
  writeFileSync(keyFile, openSshPrivate(identity.client, "jm-probe-client"), { mode: 0o600 });
  writeFileSync(knownHostsFile, `${knownHostsLine(ip, identity.host.publicRaw)}\n`, { mode: 0o600 });
  const base = sshArgs({ keyFile, knownHostsFile, ip });
  const run = (command, { maxBuffer = 16 * 1024 * 1024 } = {}) =>
    new Promise((resolve, reject) => execFile("ssh", [...base, command], { maxBuffer }, (err, stdout, stderr) => (err ? reject(new Error(`ssh failed: ${String(stderr).slice(0, 300)}`)) : resolve(stdout))));
  return {
    run,
    async waitReady({ timeoutMs = 600000, intervalMs = 10000 } = {}) {
      const end = Date.now() + timeoutMs;
      let last = "";
      while (Date.now() < end) {
        try {
          await run("true");
          return;
        } catch (e) {
          last = e.message;
          await sleep(intervalMs);
        }
      }
      throw new Error(`server did not accept SSH in time (${last})`);
    },
    /** copies a local directory to a remote directory (tar over ssh) */
    put: (localDir, remoteDir) =>
      new Promise((resolve, reject) => {
        const tar = spawn("tar", ["czf", "-", "-C", localDir, "."]);
        const ssh = spawn("ssh", [...base, `mkdir -p ${remoteDir} && tar xzf - -C ${remoteDir}`]);
        tar.stdout.pipe(ssh.stdin);
        let err = "";
        ssh.stderr.on("data", (d) => (err += d));
        ssh.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`upload failed: ${err.slice(0, 300)}`))));
        tar.on("error", reject);
      }),
    get: (remotePath) => run(`sudo cat ${remotePath}`),
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
