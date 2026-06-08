import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    setMsg(null);
    const fn = mode === "signin" ? signIn : signUp;
    const { error } = await fn(email, password);
    setBusy(false);

    if (error) {
      setMsg({ type: "error", text: error.message });
      return;
    }
    if (mode === "signup") {
      setMsg({
        type: "ok",
        text: "Check your email to confirm your account, then sign in.",
      });
      setMode("signin");
    } else {
      navigate("/");
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>GGC Resource Planning</h1>
        <p style={styles.sub}>
          {mode === "signin" ? "Sign in to continue" : "Create your account"}
        </p>

        <label style={styles.label}>Email</label>
        <input
          style={styles.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <label style={styles.label}>Password</label>
        <input
          style={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />

        <button style={styles.button} onClick={handleSubmit} disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign In" : "Sign Up"}
        </button>

        {msg && (
          <div
            style={{
              ...styles.msg,
              color: msg.type === "error" ? "#b91c1c" : "#15803d",
            }}
          >
            {msg.text}
          </div>
        )}

        <button
          style={styles.toggle}
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setMsg(null);
          }}
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f1f5f9",
  },
  card: {
    width: 360,
    background: "#fff",
    borderRadius: 12,
    padding: "2rem",
    boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  },
  title: { margin: 0, fontSize: 20, fontWeight: 700 },
  sub: { marginTop: 4, marginBottom: 20, color: "#64748b", fontSize: 14 },
  label: { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 },
  input: {
    width: "100%",
    padding: "8px 10px",
    marginBottom: 14,
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    padding: "10px",
    background: "#1e293b",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    cursor: "pointer",
  },
  msg: { marginTop: 12, fontSize: 13 },
  toggle: {
    marginTop: 16,
    background: "none",
    border: "none",
    color: "#2563eb",
    cursor: "pointer",
    fontSize: 13,
    width: "100%",
  },
};
