import { useState, useEffect } from "react";
import AdminTab from "./AdminTab";
import { API_BASE } from "../config";

export default function UserView({ apiCall, setError, currentUser, onLogout, isSuperAdmin, authToken, onBusinessSwitch, onRefresh, initialTab }) {
  const [userTab, setUserTab] = useState(initialTab || "settings");
  const [theme, setTheme] = useState(() => currentUser?.theme || localStorage.getItem("theme") || "default");

  const DEFAULT_PALETTES = {
    default: { bg: "#D7E5D8", surface: "#ffffff", text: "#2D3234", accent: "#8193A4", border: "#8193A4" },
    light:   { bg: "#f5f7fa", surface: "#ffffff", text: "#1a202c", accent: "#64748b", border: "#cbd5e1" },
    dark:    { bg: "#15191c", surface: "#232a30", text: "#e5e7eb", accent: "#9aa8b6", border: "#3a4349" },
  };
  const [customColors, setCustomColors] = useState(() => (
    currentUser?.custom_theme || DEFAULT_PALETTES.light
  ));

  function applyCustomToDom(c) {
    const root = document.documentElement;
    root.setAttribute("data-theme", "custom");
    root.style.setProperty("--custom-bg", c.bg);
    root.style.setProperty("--custom-surface", c.surface);
    root.style.setProperty("--custom-text", c.text);
    root.style.setProperty("--custom-accent", c.accent);
    root.style.setProperty("--custom-border", c.border);
  }

  async function applyTheme(next) {
    setTheme(next);
    localStorage.setItem("theme", next);
    const root = document.documentElement;
    const customKeys = ["--custom-bg", "--custom-surface", "--custom-text", "--custom-accent", "--custom-border"];
    if (next === "default") {
      root.removeAttribute("data-theme");
      customKeys.forEach((k) => root.style.removeProperty(k));
    } else if (next === "custom") {
      applyCustomToDom(customColors);
    } else {
      root.setAttribute("data-theme", next);
      customKeys.forEach((k) => root.style.removeProperty(k));
    }
    try {
      await apiCall("/me/theme", { method: "PUT", body: JSON.stringify({ theme: next }) });
      const updated = { ...(currentUser || {}), theme: next };
      localStorage.setItem("currentUser", JSON.stringify(updated));
    } catch (err) {
      setError(err.message || "Failed to save theme");
    }
  }

  // Debounced server save for custom colors.
  const customSaveTimer = (typeof window !== "undefined") ? window.__customSaveTimer : null;
  function updateCustomColor(key, value) {
    const next = { ...customColors, [key]: value };
    setCustomColors(next);
    applyCustomToDom(next);
    if (window.__customSaveTimer) clearTimeout(window.__customSaveTimer);
    window.__customSaveTimer = setTimeout(async () => {
      try {
        await apiCall("/me/custom-theme", { method: "PUT", body: JSON.stringify(next) });
        const updated = { ...(currentUser || {}), custom_theme: next };
        localStorage.setItem("currentUser", JSON.stringify(updated));
      } catch (err) {
        setError(err.message || "Failed to save custom theme");
      }
    }, 500);
  }

  function seedCustomFrom(presetId) {
    const preset = DEFAULT_PALETTES[presetId];
    if (!preset) return;
    setCustomColors(preset);
    applyCustomToDom(preset);
    if (window.__customSaveTimer) clearTimeout(window.__customSaveTimer);
    window.__customSaveTimer = setTimeout(async () => {
      try {
        await apiCall("/me/custom-theme", { method: "PUT", body: JSON.stringify(preset) });
        const updated = { ...(currentUser || {}), custom_theme: preset };
        localStorage.setItem("currentUser", JSON.stringify(updated));
      } catch (err) {
        setError(err.message || "Failed to save custom theme");
      }
    }, 200);
  }

  // WCAG relative luminance + contrast ratio (returns ratio between two hex colors).
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
  }
  function relLum([r, g, b]) {
    const v = [r, g, b].map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(hexA, hexB) {
    const a = relLum(hexToRgb(hexA));
    const b = relLum(hexToRgb(hexB));
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  }
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  
  // Username change state
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [changingUsername, setChangingUsername] = useState(false);
  const [usernameSuccessMessage, setUsernameSuccessMessage] = useState("");
  
  // Collapsible sections state
  const [showChangeUsername, setShowChangeUsername] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showOutlookSync, setShowOutlookSync] = useState(false);

  // Outlook calendar sync state
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarCopied, setCalendarCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadCalendarToken() {
      setCalendarLoading(true);
      try {
        const data = await apiCall("/me/calendar-token");
        if (!cancelled && data?.ics_path) {
          setCalendarUrl(`${API_BASE}${data.ics_path}`);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || "Failed to load calendar sync URL");
        }
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    }
    loadCalendarToken();
    return () => { cancelled = true; };
    // apiCall is recreated on every App render; intentionally mount-only to
    // avoid re-firing the request on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopyCalendarUrl() {
    if (!calendarUrl) return;
    try {
      await navigator.clipboard.writeText(calendarUrl);
      setCalendarCopied(true);
      setTimeout(() => setCalendarCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard. Select the URL manually.");
    }
  }

  async function handleRegenerateCalendarUrl() {
    if (!window.confirm(
      "Regenerating will invalidate the current URL. Any Outlook calendar subscribed to it will stop updating until you replace it with the new URL. Continue?"
    )) return;
    setRegenerating(true);
    setError("");
    try {
      const data = await apiCall("/me/calendar-token/regenerate", { method: "POST" });
      if (data?.ics_path) {
        setCalendarUrl(`${API_BASE}${data.ics_path}`);
      }
    } catch (err) {
      setError(err.message || "Failed to regenerate calendar URL");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setError("");
    setSuccessMessage("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All fields are required");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters long");
      return;
    }

    setChanging(true);
    try {
      await apiCall("/auth/change-password", {
        method: "PUT",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setSuccessMessage("Password changed successfully!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message || "Failed to change password");
    } finally {
      setChanging(false);
    }
  }

  async function handleChangeUsername(e) {
    e.preventDefault();
    setError("");
    setUsernameSuccessMessage("");

    if (!newUsername || !newUsername.trim()) {
      setError("New username is required");
      return;
    }

    if (!usernamePassword) {
      setError("Password is required to change username");
      return;
    }

    if (newUsername.trim().toLowerCase() === currentUser?.username?.toLowerCase()) {
      setError("New username must be different from current username");
      return;
    }

    setChangingUsername(true);
    try {
      const result = await apiCall("/auth/change-username", {
        method: "PUT",
        body: JSON.stringify({
          new_username: newUsername.trim(),
          password: usernamePassword,
        }),
      });
      setUsernameSuccessMessage("Username changed successfully! Please refresh the page.");
      setNewUsername("");
      setUsernamePassword("");
      // Update current user in localStorage
      const updatedUser = { ...currentUser, username: result.new_username };
      localStorage.setItem("currentUser", JSON.stringify(updatedUser));
      // Optionally refresh the page after a delay to show the success message
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      setError(err.message || "Failed to change username");
    } finally {
      setChangingUsername(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="card-header" style={{ marginBottom: "0.5rem" }}>
          <h2>User Settings</h2>
        </div>
        
        <nav className="tabs" style={{ marginBottom: "1rem" }}>
          <button
            className={userTab === "settings" ? "active" : ""}
            onClick={() => setUserTab("settings")}
          >
            Settings
          </button>
          {currentUser?.is_admin && (
            <button
              className={userTab === "admin" ? "active" : ""}
              onClick={() => setUserTab("admin")}
            >
              Admin
            </button>
          )}
        </nav>
        
        {userTab === "settings" && (
          <div style={{ padding: "1rem" }}>
            <div style={{ marginBottom: "2rem" }}>
              <h3>User Information</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div>
                  <strong>Username:</strong> {currentUser?.username}
                </div>
                <div>
                  <strong>Role:</strong> {
                    currentUser?.is_super_admin ? "Super Admin" :
                    currentUser?.is_admin ? "Admin" : "User"
                  }
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px solid rgba(129, 147, 164, 0.2)", paddingTop: "1.5rem", marginTop: "1.5rem" }}>
              <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>Appearance</h3>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {[
                  { id: "default", label: "Default" },
                  { id: "light", label: "Light" },
                  { id: "dark", label: "Dark" },
                  { id: "custom", label: "Custom" },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => applyTheme(opt.id)}
                    className={theme === opt.id ? "primary" : "secondary"}
                    style={theme === opt.id ? {} : { color: "var(--text-dark)", border: "1px solid var(--border)", background: "transparent" }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: "0.8rem", opacity: 0.75, marginTop: "0.5rem" }}>
                Theme preference is saved to your account and applies on every device.
              </div>

              {theme === "custom" && (
                <div style={{ marginTop: "1rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: "0.5rem", background: "var(--white)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                    <strong style={{ color: "var(--text-dark)" }}>Custom palette</strong>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <label style={{ fontSize: "0.8rem", color: "var(--text-dark)", flexDirection: "row", alignItems: "center", gap: "0.4rem" }}>
                        Start from:
                        <select
                          onChange={(e) => { if (e.target.value) seedCustomFrom(e.target.value); e.target.value = ""; }}
                          defaultValue=""
                          style={{ padding: "0.3rem 0.5rem", fontSize: "0.85rem" }}
                        >
                          <option value="">— preset —</option>
                          <option value="default">Default</option>
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  {[
                    { key: "bg", label: "Page background", contrastWith: "text" },
                    { key: "surface", label: "Card / surface", contrastWith: "text" },
                    { key: "text", label: "Primary text", contrastWith: "surface" },
                    { key: "accent", label: "Accent (buttons)", contrastWith: "surface" },
                    { key: "border", label: "Border / divider", contrastWith: null },
                  ].map(({ key, label, contrastWith }) => {
                    const ratio = contrastWith ? contrast(customColors[key], customColors[contrastWith]) : null;
                    const lowContrast = ratio !== null && ratio < 3.0;
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.6rem" }}>
                        <input
                          type="color"
                          value={customColors[key]}
                          onChange={(e) => updateCustomColor(key, e.target.value)}
                          style={{ width: "44px", height: "32px", padding: 0, border: "1px solid var(--border)", borderRadius: "0.25rem", cursor: "pointer" }}
                        />
                        <input
                          type="text"
                          value={customColors[key]}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            if (/^#[0-9a-fA-F]{6}$/.test(v)) updateCustomColor(key, v);
                            else setCustomColors({ ...customColors, [key]: v });
                          }}
                          style={{ width: "90px", padding: "0.3rem 0.5rem", fontFamily: "monospace", fontSize: "0.85rem" }}
                        />
                        <span style={{ flex: 1, fontSize: "0.9rem", color: "var(--text-dark)" }}>{label}</span>
                        {lowContrast && (
                          <span style={{ fontSize: "0.75rem", color: "#b45309", background: "rgba(245, 158, 11, 0.15)", padding: "0.15rem 0.5rem", borderRadius: "999px", whiteSpace: "nowrap" }}>
                            ⚠ low contrast ({ratio.toFixed(1)}:1)
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div style={{ fontSize: "0.75rem", opacity: 0.75, marginTop: "0.5rem", color: "var(--text-dark)" }}>
                    Changes apply live and save automatically.
                  </div>
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid rgba(129, 147, 164, 0.2)", paddingTop: "2rem", marginTop: "2rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  padding: "1rem 1.25rem",
                  background: showChangeUsername ? "var(--white)" : "rgba(255, 255, 255, 0.06)",
                  borderRadius: "0.5rem",
                  border: showChangeUsername ? "1px solid rgba(129, 147, 164, 0.3)" : "1px solid rgba(129, 147, 164, 0.2)",
                  boxShadow: showChangeUsername ? "0 2px 4px rgba(0, 0, 0, 0.05)" : "none",
                  transition: "all 0.2s ease",
                  userSelect: "none"
                }}
                onClick={() => setShowChangeUsername(!showChangeUsername)}
                onMouseEnter={(e) => {
                  if (!showChangeUsername) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showChangeUsername) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.2)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
                <span style={{ 
                  transform: showChangeUsername ? "rotate(90deg)" : "rotate(0deg)", 
                  transition: "transform 0.2s ease", 
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "20px",
                  height: "20px",
                  marginRight: "0.75rem",
                  color: "var(--primary)",
                  fontSize: "0.75rem",
                  flexShrink: 0
                }}>▶</span>
                <h3 style={{ 
                  margin: 0, 
                  fontSize: "1rem", 
                  fontWeight: 600,
                  color: "var(--text-dark)",
                  flex: 1
                }}>
                  Change Username
                </h3>
              </div>
              {showChangeUsername && (
                <div style={{ 
                  padding: "1.5rem", 
                  background: "var(--white)", 
                  borderRadius: "0 0 0.5rem 0.5rem",
                  border: "1px solid rgba(129, 147, 164, 0.3)",
                  borderTop: "none",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  marginTop: "-0.5rem"
                }}>
                  {usernameSuccessMessage && (
                    <div style={{ 
                      background: "rgba(215, 229, 216, 0.3)", 
                      border: "1px solid var(--primary)", 
                      color: "var(--text-dark)", 
                      padding: "0.75rem 1rem", 
                      borderRadius: "0.5rem", 
                      marginBottom: "1rem" 
                    }}>
                      {usernameSuccessMessage}
                    </div>
                  )}
                  <form onSubmit={handleChangeUsername} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "400px", marginBottom: "2rem" }}>
                    <label>
                      New Username
                      <input
                        type="text"
                        value={newUsername}
                        onChange={(e) => setNewUsername(e.target.value)}
                        placeholder={currentUser?.username}
                        required
                        style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                      />
                    </label>
                    <label>
                      Current Password (required for security)
                      <input
                        type="password"
                        value={usernamePassword}
                        onChange={(e) => setUsernamePassword(e.target.value)}
                        required
                        style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                      />
                    </label>
                    <button
                      type="submit"
                      className="primary"
                      disabled={changingUsername}
                      style={{ alignSelf: "flex-start" }}
                    >
                      {changingUsername ? "Changing..." : "Change Username"}
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div style={{ marginTop: "1.5rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  padding: "1rem 1.25rem",
                  background: showChangePassword ? "var(--white)" : "rgba(255, 255, 255, 0.06)",
                  borderRadius: "0.5rem",
                  border: showChangePassword ? "1px solid rgba(129, 147, 164, 0.3)" : "1px solid rgba(129, 147, 164, 0.2)",
                  boxShadow: showChangePassword ? "0 2px 4px rgba(0, 0, 0, 0.05)" : "none",
                  transition: "all 0.2s ease",
                  userSelect: "none"
                }}
                onClick={() => setShowChangePassword(!showChangePassword)}
                onMouseEnter={(e) => {
                  if (!showChangePassword) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showChangePassword) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.2)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
                <span style={{ 
                  transform: showChangePassword ? "rotate(90deg)" : "rotate(0deg)", 
                  transition: "transform 0.2s ease", 
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "20px",
                  height: "20px",
                  marginRight: "0.75rem",
                  color: "var(--primary)",
                  fontSize: "0.75rem",
                  flexShrink: 0
                }}>▶</span>
                <h3 style={{ 
                  margin: 0, 
                  fontSize: "1rem", 
                  fontWeight: 600,
                  color: "var(--text-dark)",
                  flex: 1
                }}>
                  Change Password
                </h3>
              </div>
              {showChangePassword && (
                <div style={{ 
                  padding: "1.5rem", 
                  background: "var(--white)", 
                  borderRadius: "0 0 0.5rem 0.5rem",
                  border: "1px solid rgba(129, 147, 164, 0.3)",
                  borderTop: "none",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  marginTop: "-0.5rem"
                }}>
                  {successMessage && (
                    <div style={{ 
                      background: "rgba(215, 229, 216, 0.3)", 
                      border: "1px solid var(--primary)", 
                      color: "var(--text-dark)", 
                      padding: "0.75rem 1rem", 
                      borderRadius: "0.5rem", 
                      marginBottom: "1rem" 
                    }}>
                      {successMessage}
                    </div>
                  )}
                  <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: "400px" }}>
                    <label>
                      Current Password
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                      />
                    </label>
                    <label>
                      New Password
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                        style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                      />
                    </label>
                    <label>
                      Confirm New Password
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
                      />
                    </label>
                    <button
                      type="submit"
                      className="primary"
                      disabled={changing}
                      style={{ alignSelf: "flex-start" }}
                    >
                      {changing ? "Changing..." : "Change Password"}
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div style={{ marginTop: "1.5rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  padding: "1rem 1.25rem",
                  background: showOutlookSync ? "var(--white)" : "rgba(255, 255, 255, 0.06)",
                  borderRadius: "0.5rem",
                  border: showOutlookSync ? "1px solid rgba(129, 147, 164, 0.3)" : "1px solid rgba(129, 147, 164, 0.2)",
                  boxShadow: showOutlookSync ? "0 2px 4px rgba(0, 0, 0, 0.05)" : "none",
                  transition: "all 0.2s ease",
                  userSelect: "none"
                }}
                onClick={() => setShowOutlookSync(!showOutlookSync)}
                onMouseEnter={(e) => {
                  if (!showOutlookSync) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showOutlookSync) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.2)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              >
                <span style={{
                  transform: showOutlookSync ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "20px",
                  height: "20px",
                  marginRight: "0.75rem",
                  color: "var(--primary)",
                  fontSize: "0.75rem",
                  flexShrink: 0
                }}>▶</span>
                <h3 style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                  color: "var(--text-dark)",
                  flex: 1
                }}>
                  Sync with Outlook Calendar
                </h3>
              </div>
              {showOutlookSync && (
                <div style={{
                  padding: "1.5rem",
                  background: "var(--white)",
                  borderRadius: "0 0 0.5rem 0.5rem",
                  border: "1px solid rgba(129, 147, 164, 0.3)",
                  borderTop: "none",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  marginTop: "-0.5rem"
                }}>
                  <p style={{ color: "var(--text-dark)", fontSize: "0.9rem", marginTop: 0, marginBottom: "1rem" }}>
                    Subscribe to your Wave Physics calendar in Outlook so every equipment due date appears on your Outlook calendar. Updates sync automatically — Outlook refreshes internet calendars every few hours.
                  </p>

                  <label style={{ display: "block", fontWeight: 500, marginBottom: "0.5rem" }}>
                    Your personal calendar URL
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={calendarLoading ? "Loading…" : calendarUrl}
                      readOnly
                      onFocus={(e) => e.target.select()}
                      style={{
                        flex: "1 1 320px",
                        padding: "0.5rem",
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        background: "var(--white)",
                        color: "var(--text-dark)",
                        border: "1px solid rgba(129, 147, 164, 0.3)",
                        borderRadius: "0.25rem",
                      }}
                    />
                    <button
                      type="button"
                      className="primary"
                      onClick={handleCopyCalendarUrl}
                      disabled={!calendarUrl || calendarLoading}
                    >
                      {calendarCopied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleRegenerateCalendarUrl}
                      disabled={regenerating || calendarLoading}
                      title="Invalidate the current URL and generate a new one"
                    >
                      {regenerating ? "Regenerating…" : "Regenerate"}
                    </button>
                  </div>

                  <details style={{ marginBottom: "0.5rem" }}>
                    <summary style={{ cursor: "pointer", fontWeight: 500, color: "var(--text-dark)" }}>
                      How to add this to Outlook
                    </summary>
                    <div style={{ padding: "0.75rem 0 0.25rem 0", fontSize: "0.9rem", color: "var(--text-dark)", lineHeight: 1.6 }}>
                      <strong>Outlook on the Web / New Outlook:</strong>
                      <ol style={{ marginTop: "0.25rem" }}>
                        <li>Open Outlook and go to the Calendar.</li>
                        <li>In the left sidebar, click <em>Add calendar</em> → <em>Subscribe from web</em>.</li>
                        <li>Paste the URL above, give the calendar a name (e.g. <em>Wave Physics</em>), and click <em>Import</em>.</li>
                      </ol>
                      <strong>Outlook Desktop (Windows):</strong>
                      <ol style={{ marginTop: "0.25rem" }}>
                        <li>Go to the Calendar view.</li>
                        <li>Click <em>Add Calendar</em> → <em>From Internet</em>.</li>
                        <li>Paste the URL and click <em>OK</em>.</li>
                        <li>Press <kbd>F9</kbd> to force a refresh whenever you want the latest changes.</li>
                      </ol>
                      <p style={{ color: "var(--primary)", marginTop: "0.5rem" }}>
                        Tip: Outlook controls how often it re-reads the feed (usually every few hours). The web and mobile apps don't expose a manual refresh; the Windows desktop app does (<kbd>F9</kbd>).
                      </p>
                    </div>
                  </details>

                  <p style={{ color: "var(--primary)", fontSize: "0.8rem", marginBottom: 0 }}>
                    Treat this URL like a password — anyone with it can view your equipment calendar. Click <em>Regenerate</em> if it is ever shared or leaked.
                  </p>
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--primary)", paddingTop: "2rem", marginTop: "2rem" }}>
              <h3>Logout</h3>
              <p style={{ color: "var(--primary)", fontSize: "0.9rem", marginBottom: "1rem" }}>
                Sign out of your account
              </p>
              <button
                onClick={onLogout}
                className="secondary"
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {userTab === "admin" && currentUser?.is_admin && (
          <AdminTab 
            apiCall={apiCall} 
            setError={setError} 
            currentUser={currentUser} 
            isSuperAdmin={isSuperAdmin} 
            authToken={authToken}
            onBusinessSwitch={onBusinessSwitch}
            onRefresh={onRefresh}
          />
        )}
      </div>
    </div>
  );
}

