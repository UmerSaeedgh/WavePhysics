import { useState } from "react";
import wavePhysicsLogo from "../assets/image.png";

export default function LoginView({ onLogin, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState(error || "");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      await onLogin(username, password);
    } catch (err) {
      setLoginError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <div className="card" style={{ width: "100%", maxWidth: "420px", padding: "3rem 2.5rem" }}>
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div style={{ marginBottom: "2rem", display: "flex", justifyContent: "center" }}>
            <img 
              src={wavePhysicsLogo} 
              alt="WAVE PHYSICS" 
              style={{ height: "56px", maxWidth: "240px", objectFit: "contain", filter: "drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))" }}
            />
          </div>
          <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.875rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.025em" }}>Welcome back</h2>
          <p style={{ margin: 0, fontSize: "0.9375rem", color: "#64748b", fontWeight: 400 }}>Sign in to continue to your account</p>
        </div>
        {loginError && (
          <div className="error-banner" style={{ marginBottom: "1rem" }}>
            {loginError}
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem" }}
            />
          </label>
          <label style={{ marginTop: "1rem" }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: "100%", padding: "0.75rem", marginTop: "0.5rem" }}
            />
          </label>
          <button
            type="submit"
            className="primary"
            disabled={loading}
            style={{ width: "100%", marginTop: "1.5rem", padding: "0.75rem" }}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}

