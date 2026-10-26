import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, setCsrfToken, setUnauthorizedHandler } from "./api/client";

export interface SessionUser {
  email: string;
  role: string;
  permissions: string[];
  mediaBaseUrl: string;
}

type SessionState = { status: "loading" } | { status: "anonymous"; expired: boolean } | { status: "authed"; user: SessionUser } | { status: "error" };

interface SessionPayload extends SessionUser {
  csrfToken: string;
}

interface SessionApi {
  state: SessionState;
  /** True when the signed-in user may perform the action. The server still decides; this only hides what cannot work. */
  can(action: string): boolean;
  login(input: { email: string; password: string; totp?: string }): Promise<void>;
  logout(): Promise<void>;
  retry(): void;
}

const Ctx = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  const apply = useCallback((payload: SessionPayload) => {
    setCsrfToken(payload.csrfToken);
    setState({ status: "authed", user: { email: payload.email, role: payload.role, permissions: payload.permissions, mediaBaseUrl: payload.mediaBaseUrl } });
  }, []);

  const probe = useCallback(() => {
    api<SessionPayload>("GET", "/auth/session", { anonymous: true }).then(apply, (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) setState({ status: "anonymous", expired: false });
      else setState({ status: "error" });
    });
  }, [apply]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken("");
      setState({ status: "anonymous", expired: true });
    });
    probe();
  }, [probe]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    probe();
  }, [probe]);

  const value = useMemo<SessionApi>(
    () => ({
      state,
      can: (action) => state.status === "authed" && state.user.permissions.includes(action),
      async login(input) {
        const payload = await api<SessionPayload>("POST", "/auth/login", { body: input, anonymous: true });
        apply(payload);
      },
      async logout() {
        await api("POST", "/auth/logout").catch(() => undefined);
        setCsrfToken("");
        setState({ status: "anonymous", expired: false });
      },
      retry,
    }),
    [state, apply, retry],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

export function useUser(): SessionUser {
  const { state } = useSession();
  if (state.status !== "authed") throw new Error("useUser needs a signed-in user");
  return state.user;
}
