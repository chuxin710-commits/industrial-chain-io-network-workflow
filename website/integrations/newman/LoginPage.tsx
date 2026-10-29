import { useState, type FormEvent } from "react";

export default function LoginPage({ onLoggedIn }: { onLoggedIn?: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/library/auth/login", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登录失败，请重试");
      setPassword(""); onLoggedIn?.();
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <main className="chainlab-login">
    <a className="chainlab-wordmark" href="/">链研 <span>CHAINLAB</span></a>
    <form onSubmit={login}>
      <p className="chainlab-kicker">RESEARCH TOOLBENCH</p>
      <h1>科研工具台</h1>
      <label htmlFor="toolbench-user">课题组账号</label>
      <input id="toolbench-user" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} />
      <label htmlFor="toolbench-password">密码</label>
      <input id="toolbench-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      {error && <p role="alert" className="chainlab-error">{error}</p>}
      <button disabled={busy} type="submit">{busy ? "正在登录…" : "进入科研工具台"}</button>
      <a href="/workspace.html">返回科研平台</a>
    </form>
    <footer>ChainLab · Powered by Newman / MIT</footer>
  </main>;
}
