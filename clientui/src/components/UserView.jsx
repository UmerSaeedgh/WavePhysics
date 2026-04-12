import { useState, useEffect } from "react";
import AdminTab from "./AdminTab";
import { API_BASE } from "../config";

export default function UserView({ apiCall, setError, currentUser, onLogout, isSuperAdmin, authToken, onBusinessSwitch, onRefresh, initialTab }) {
  const [userTab, setUserTab] = useState(initialTab || "settings");
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

            <div style={{ borderTop: "1px solid rgba(129, 147, 164, 0.2)", paddingTop: "2rem", marginTop: "2rem" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                  padding: "1rem 1.25rem",
                  background: showChangeUsername ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                  borderRadius: "0.5rem",
                  border: showChangeUsername ? "1px solid rgba(129, 147, 164, 0.3)" : "1px solid rgba(129, 147, 164, 0.2)",
                  boxShadow: showChangeUsername ? "0 2px 4px rgba(0, 0, 0, 0.05)" : "none",
                  transition: "all 0.2s ease",
                  userSelect: "none"
                }}
                onClick={() => setShowChangeUsername(!showChangeUsername)}
                onMouseEnter={(e) => {
                  if (!showChangeUsername) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showChangeUsername) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.6)";
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
                  color: "#8193A4",
                  fontSize: "0.75rem",
                  flexShrink: 0
                }}>▶</span>
                <h3 style={{ 
                  margin: 0, 
                  fontSize: "1rem", 
                  fontWeight: 600,
                  color: "#2D3234",
                  flex: 1
                }}>
                  Change Username
                </h3>
              </div>
              {showChangeUsername && (
                <div style={{ 
                  padding: "1.5rem", 
                  background: "#ffffff", 
                  borderRadius: "0 0 0.5rem 0.5rem",
                  border: "1px solid rgba(129, 147, 164, 0.3)",
                  borderTop: "none",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  marginTop: "-0.5rem"
                }}>
                  {usernameSuccessMessage && (
                    <div style={{ 
                      background: "rgba(215, 229, 216, 0.3)", 
                      border: "1px solid #8193A4", 
                      color: "#2D3234", 
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
                  background: showChangePassword ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                  borderRadius: "0.5rem",
                  border: showChangePassword ? "1px solid rgba(129, 147, 164, 0.3)" : "1px solid rgba(129, 147, 164, 0.2)",
                  boxShadow: showChangePassword ? "0 2px 4px rgba(0, 0, 0, 0.05)" : "none",
                  transition: "all 0.2s ease",
                  userSelect: "none"
                }}
                onClick={() => setShowChangePassword(!showChangePassword)}
                onMouseEnter={(e) => {
                  if (!showChangePassword) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showChangePassword) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.6)";
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
                  color: "#8193A4",
                  fontSize: "0.75rem",
                  flexShrink: 0
                }}>▶</span>
                <h3 style={{ 
                  margin: 0, 
                  fontSize: "1rem", 
                  fontWeight: 600,
                  color: "#2D3234",
                  flex: 1
                }}>
                  Change Password
                </h3>
              </div>
              {showChangePassword && (
                <div style={{ 
                  padding: "1.5rem", 
                  background: "#ffffff", 
                  borderRadius: "0 0 0.5rem 0.5rem",
                  border: "1px solid rgba(129, 147, 164, 0.3)",
                  borderTop: "none",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  marginTop: "-0.5rem"
                }}>
                  {successMessage && (
                    <div style={{ 
                      background: "rgba(215, 229, 216, 0.3)", 
                      border: "1px solid #8193A4", 
                      color: "#2D3234", 
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
                  background: showOutlookSync ? "#ffffff" : "rgba(255, 255, 255, 0.6)",
                  borderRadius: "0.5rem",
                  border: showOutlookSync ? "1px solid rgba(129, 147, 164, 0.3)" : "1px solid rgba(129, 147, 164, 0.2)",
                  boxShadow: showOutlookSync ? "0 2px 4px rgba(0, 0, 0, 0.05)" : "none",
                  transition: "all 0.2s ease",
                  userSelect: "none"
                }}
                onClick={() => setShowOutlookSync(!showOutlookSync)}
                onMouseEnter={(e) => {
                  if (!showOutlookSync) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)";
                    e.currentTarget.style.borderColor = "rgba(129, 147, 164, 0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0, 0, 0, 0.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!showOutlookSync) {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.6)";
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
                  color: "#8193A4",
                  fontSize: "0.75rem",
                  flexShrink: 0
                }}>▶</span>
                <h3 style={{
                  margin: 0,
                  fontSize: "1rem",
                  fontWeight: 600,
                  color: "#2D3234",
                  flex: 1
                }}>
                  Sync with Outlook Calendar
                </h3>
              </div>
              {showOutlookSync && (
                <div style={{
                  padding: "1.5rem",
                  background: "#ffffff",
                  borderRadius: "0 0 0.5rem 0.5rem",
                  border: "1px solid rgba(129, 147, 164, 0.3)",
                  borderTop: "none",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.05)",
                  marginTop: "-0.5rem"
                }}>
                  <p style={{ color: "#2D3234", fontSize: "0.9rem", marginTop: 0, marginBottom: "1rem" }}>
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
                        background: "#f6f8fa",
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
                    <summary style={{ cursor: "pointer", fontWeight: 500, color: "#2D3234" }}>
                      How to add this to Outlook
                    </summary>
                    <div style={{ padding: "0.75rem 0 0.25rem 0", fontSize: "0.9rem", color: "#2D3234", lineHeight: 1.6 }}>
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
                      <p style={{ color: "#8193A4", marginTop: "0.5rem" }}>
                        Tip: Outlook controls how often it re-reads the feed (usually every few hours). The web and mobile apps don't expose a manual refresh; the Windows desktop app does (<kbd>F9</kbd>).
                      </p>
                    </div>
                  </details>

                  <p style={{ color: "#8193A4", fontSize: "0.8rem", marginBottom: 0 }}>
                    Treat this URL like a password — anyone with it can view your equipment calendar. Click <em>Regenerate</em> if it is ever shared or leaked.
                  </p>
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid #8193A4", paddingTop: "2rem", marginTop: "2rem" }}>
              <h3>Logout</h3>
              <p style={{ color: "#8193A4", fontSize: "0.9rem", marginBottom: "1rem" }}>
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

