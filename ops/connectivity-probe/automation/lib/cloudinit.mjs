// cloud-init user data: one non-root user with the derived key, no password login, and a PINNED host key (derived), so the
// workflows can verify the server instead of trusting the first connection.
import { openSshPrivate, publicLine } from "./sshkey.mjs";

export const SSH_USER = "jmprobe";
const indent = (text, n) => text.trimEnd().split("\n").map((l) => " ".repeat(n) + l).join("\n");

export function buildUserData({ identity }) {
  return `#cloud-config
users:
  - name: ${SSH_USER}
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: true
    ssh_authorized_keys:
      - ${publicLine(identity.client.publicRaw, "jm-probe-client")}
disable_root: true
ssh_pwauth: false
ssh_deletekeys: true
ssh_keys:
  ed25519_private: |
${indent(openSshPrivate(identity.host, "jm-probe-host"), 4)}
  ed25519_public: ${publicLine(identity.host.publicRaw, "jm-probe-host")}
`;
}
