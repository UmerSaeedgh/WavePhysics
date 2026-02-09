import { useState } from "react";
import AdminTab from "./AdminTab";

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
        <div className="card-header">
          <h2>User Settings</h2>
        </div>
        
        <nav className="tabs" style={{ marginBottom: "1rem", padding: "0 1rem", paddingTop: "1rem" }}>
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

            <div style={{ borderTop: "1px solid #8193A4", paddingTop: "2rem" }}>
              <h3>Change Username</h3>
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

            <div style={{ borderTop: "1px solid #8193A4", paddingTop: "2rem" }}>
              <h3>Change Password</h3>
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

